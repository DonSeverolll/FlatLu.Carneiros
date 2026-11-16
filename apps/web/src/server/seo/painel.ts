import { headers } from 'next/headers';
import { query } from '@/server/db';
import { recordAudit } from '@/server/audit';

/**
 * Estado real do SEO para a tela do painel.
 *
 * Duas fontes, sem tabela nova:
 *  - passos que só o dono faz fora do site (Search Console, Perfil da Empresa…)
 *    ficam como eventos `SEO_PASSO_FEITO` / `SEO_PASSO_DESFEITO` no log de
 *    auditoria — o último evento de cada passo diz o estado, e fica registrado
 *    quem marcou e quando;
 *  - visitas do robô do Google às páginas públicas viram `GOOGLE_VISITA`, no
 *    máximo uma por página por hora, para o painel mostrar "o Google passou
 *    aqui em…" sem lotar o log.
 */

export const PASSOS = [
  {
    id: 'search_console',
    titulo: 'Site verificado no Google Search Console',
    como: 'Propriedade "Prefixo do URL" verificada pela Tag HTML (o código fica em GOOGLE_SITE_VERIFICATION na Vercel).'
  },
  {
    id: 'sitemap',
    titulo: 'Sitemap enviado',
    como: 'Search Console › Indexação › Sitemaps › digite sitemap.xml › Enviar.'
  },
  {
    id: 'indexacao',
    titulo: 'Indexação solicitada da página inicial e da de aluguel',
    como: 'Search Console › lupa no topo › cole o endereço da página › Solicitar indexação. O Google limita pedidos por dia: se der "cota excedida", tente no dia seguinte.'
  },
  {
    id: 'perfil_empresa',
    titulo: 'Perfil da Empresa no Google (Google Maps)',
    como: 'business.google.com › cadastrar como hospedagem, com endereço, fotos e o link do site. É o que faz aparecer no mapa.'
  },
  {
    id: 'instagram',
    titulo: 'Link do site no Instagram e no WhatsApp',
    como: 'Coloque o endereço do site na bio do Instagram e na mensagem de boas-vindas do WhatsApp.'
  },
  {
    id: 'avaliacoes',
    titulo: 'Pedido de avaliação no Google aos hóspedes',
    como: 'Depois do check-out, mande o link de avaliação do Perfil da Empresa. Avaliações contam muito para o mapa.'
  },
  {
    id: 'dominio',
    titulo: 'Domínio próprio (.com.br)',
    como: 'Registre no Registro.br, aponte para a Vercel e defina SITE_URL com o novo endereço.'
  }
] as const;

export type PassoId = (typeof PASSOS)[number]['id'];
export const PASSO_IDS = PASSOS.map((p) => p.id) as [PassoId, ...PassoId[]];

export type EstadoPasso = {
  id: PassoId;
  titulo: string;
  como: string;
  feito: boolean;
  /** "manual" quando alguém marcou; "automatico" quando o próprio site comprova. */
  origem: 'manual' | 'automatico' | null;
  quando: string | null;
  quem: string | null;
  detalhe: string | null;
};

type Evidencias = {
  verificacaoGoogle: boolean;
  dominioProprio: boolean;
  /** Última leitura do sitemap pelo robô do Google. */
  sitemapLidoEm: string | null;
};

export async function estadoDosPassos(ev: Evidencias): Promise<EstadoPasso[]> {
  let marcados = new Map<string, { feito: boolean; quando: string; quem: string | null }>();
  try {
    const r = await query<{ passo: string; event_type: string; created_at: string; quem: string | null }>(
      `SELECT DISTINCT ON (a.metadata->>'passo')
              a.metadata->>'passo' AS passo, a.event_type, a.created_at, u.full_name AS quem
         FROM audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.entity_type = 'SEO' AND a.event_type IN ('SEO_PASSO_FEITO', 'SEO_PASSO_DESFEITO')
        ORDER BY a.metadata->>'passo', a.created_at DESC`
    );
    marcados = new Map(
      r.rows.map((row) => [row.passo, { feito: row.event_type === 'SEO_PASSO_FEITO', quando: row.created_at, quem: row.quem }])
    );
  } catch (error) {
    console.error('[seo] passos', error);
  }

  return PASSOS.map((p) => {
    const manual = marcados.get(p.id);
    const base = { id: p.id, titulo: p.titulo, como: p.como };
    // A marcação manual vale mais: se alguém desmarcou, é porque sabe de algo.
    if (manual) {
      return { ...base, feito: manual.feito, origem: 'manual' as const, quando: manual.quando, quem: manual.quem, detalhe: null };
    }
    const auto =
      p.id === 'search_console' && ev.verificacaoGoogle
        ? 'A tag de verificação está publicada no site.'
        : p.id === 'sitemap' && ev.sitemapLidoEm
          ? 'O robô do Google já leu o sitemap.'
          : p.id === 'dominio' && ev.dominioProprio
            ? 'SITE_URL aponta para um domínio próprio.'
            : null;
    return {
      ...base,
      feito: Boolean(auto),
      origem: auto ? ('automatico' as const) : null,
      quando: p.id === 'sitemap' ? ev.sitemapLidoEm : null,
      quem: null,
      detalhe: auto
    };
  });
}

export async function marcarPasso(passo: PassoId, feito: boolean, actorUserId: string) {
  await recordAudit({
    actorUserId,
    entityType: 'SEO',
    eventType: feito ? 'SEO_PASSO_FEITO' : 'SEO_PASSO_DESFEITO',
    metadata: { passo }
  });
}

// --------------------------------------------------------------------------
// Visitas do robô do Google
// --------------------------------------------------------------------------

/** Robôs do Google que interessam (busca, imagens, inspeção do Search Console). */
const ROBO_GOOGLE = /(Googlebot(?:-Image|-Video)?|Google-InspectionTool|GoogleOther|Storebot-Google)/i;

export function roboDoGoogle(userAgent: string | null): string | null {
  return userAgent?.match(ROBO_GOOGLE)?.[1] ?? null;
}

/**
 * Chamado pelas páginas públicas. Pelo user-agent (o Google não assina de outro
 * jeito sem DNS reverso) — serve de termômetro, não de prova. Nunca derruba a
 * página: qualquer erro é engolido.
 */
export async function registrarVisitaDoGoogle(caminho: string): Promise<void> {
  try {
    const robo = roboDoGoogle((await headers()).get('user-agent'));
    if (!robo) return;
    await query(
      `INSERT INTO audit_events (entity_type, event_type, metadata)
       SELECT 'SEO', 'GOOGLE_VISITA', jsonb_build_object('caminho', $1::text, 'robo', $2::text)
        WHERE NOT EXISTS (
          SELECT 1 FROM audit_events
           WHERE event_type = 'GOOGLE_VISITA' AND metadata->>'caminho' = $1::text
             AND created_at > now() - interval '1 hour'
        )`,
      [caminho, robo]
    );
  } catch (error) {
    console.error('[seo] visita do google', error);
  }
}

export type VisitaGoogle = { caminho: string; ultima: string; visitas30d: number; robo: string | null };

export async function visitasDoGoogle(): Promise<Map<string, VisitaGoogle>> {
  try {
    const r = await query<{ caminho: string; ultima: string; visitas30d: string; robo: string | null }>(
      `SELECT metadata->>'caminho' AS caminho, max(created_at) AS ultima,
              count(*) FILTER (WHERE created_at > now() - interval '30 days') AS visitas30d,
              (array_agg(metadata->>'robo' ORDER BY created_at DESC))[1] AS robo
         FROM audit_events
        WHERE event_type = 'GOOGLE_VISITA'
        GROUP BY 1`
    );
    return new Map(r.rows.map((row) => [row.caminho, { ...row, visitas30d: Number(row.visitas30d) }]));
  } catch (error) {
    console.error('[seo] visitas', error);
    return new Map();
  }
}
