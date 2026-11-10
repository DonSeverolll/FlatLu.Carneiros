import { query } from '../db';
import { cifraDisponivel } from '../integracoes/cripto';
import { configAgente, credAds, credInstagram, credMetaApp, credWhatsApp } from '../integracoes/store';

/**
 * Visão geral das configurações: tudo de que o site depende, com o estado
 * atual e ONDE se configura (variável de ambiente, tela do painel ou card de
 * integração). Nunca devolve o valor de um segredo — só se ele existe.
 */

export type Estado = 'ok' | 'aviso' | 'pendente';
export type Onde =
  | { tipo: 'env'; variaveis: string[] }
  | { tipo: 'painel'; href: string; rotulo: string }
  | { tipo: 'integracao'; chave: string };

export type Item = { id: string; titulo: string; estado: Estado; detalhe: string; onde: Onde };
export type Grupo = { grupo: string; descricao: string; itens: Item[] };

const env = (nome: string) => Boolean(process.env[nome]?.trim());
const envLonga = (nome: string, min: number) => (process.env[nome]?.length ?? 0) >= min;

export async function diagnostico(): Promise<Grupo[]> {
  const producao = process.env.NODE_ENV === 'production';

  const [espacos, contratos, locadora, admins, semRls] = await Promise.all([
    query<{
      slug: string;
      nome: string;
      tarifa: boolean;
      pix: boolean;
      endereco: boolean;
    }>(
      `SELECT p.slug, COALESCE(p.short_name, p.name) AS nome,
              (p.nightly_rate > 0 OR EXISTS (
                 SELECT 1 FROM rate_weekdays w WHERE w.property_id = p.id AND w.nightly_amount > 0)) AS tarifa,
              (p.pix_key IS NOT NULL AND p.pix_key <> '') AS pix,
              (p.address_line IS NOT NULL AND p.address_city IS NOT NULL) AS endereco
         FROM properties p WHERE p.active = true ORDER BY p.display_order, p.name`
    ),
    query<{ n: number }>(`SELECT count(*)::int AS n FROM contract_templates WHERE active = true`),
    query<{ n: number }>(`SELECT count(*)::int AS n FROM landlords`),
    query<{ n: number }>(
      `SELECT count(*)::int AS n FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND deleted_at IS NULL`
    ),
    query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity`
    )
  ]);

  const [app, wa, ig, ads, agente] = await Promise.all([
    credMetaApp(),
    credWhatsApp(),
    credInstagram(),
    credAds(),
    configAgente()
  ]);

  const grupos: Grupo[] = [];

  grupos.push({
    grupo: 'Essenciais',
    descricao: 'Sem estes o site não sobe ou fica inseguro. Ficam nas variáveis de ambiente do Vercel.',
    itens: [
      {
        id: 'banco',
        titulo: 'Banco de dados',
        estado: producao && process.env.DATABASE_SSL === 'false' ? 'aviso' : 'ok',
        detalhe:
          producao && process.env.DATABASE_SSL === 'false'
            ? 'Conectado, mas sem SSL em produção.'
            : 'Conectado (esta página só abre se o banco responder).',
        onde: { tipo: 'env', variaveis: ['DATABASE_URL', 'DATABASE_SSL'] }
      },
      {
        id: 'sessao',
        titulo: 'Segredo da sessão',
        estado: envLonga('JWT_SECRET', 32) ? 'ok' : 'pendente',
        detalhe: envLonga('JWT_SECRET', 32) ? 'Definido.' : 'Ausente ou com menos de 32 caracteres.',
        onde: { tipo: 'env', variaveis: ['JWT_SECRET'] }
      },
      {
        id: 'cron',
        titulo: 'Rotinas diárias (cron)',
        estado: envLonga('CRON_SECRET', 16) ? 'ok' : 'pendente',
        detalhe: envLonga('CRON_SECRET', 16)
          ? 'Liberação de reservas vencidas, conciliação de pagamentos e métricas de anúncios.'
          : 'Sem CRON_SECRET as rotinas diárias recusam a chamada do Vercel.',
        onde: { tipo: 'env', variaveis: ['CRON_SECRET'] }
      },
      {
        id: 'cifra',
        titulo: 'Chave de cifra das integrações',
        estado: cifraDisponivel() ? 'ok' : 'aviso',
        detalhe: cifraDisponivel()
          ? 'Tokens digitados no painel são gravados cifrados.'
          : 'Sem ela, os tokens só podem vir de variáveis de ambiente. Gere com: openssl rand -base64 32',
        onde: { tipo: 'env', variaveis: ['INTEGRATIONS_ENCRYPTION_KEY'] }
      },
      {
        id: 'site',
        titulo: 'Endereço público do site',
        estado: env('SITE_URL') ? 'ok' : 'aviso',
        detalhe: env('SITE_URL')
          ? `O agente de IA indica ${process.env.SITE_URL} para reservar.`
          : 'Opcional. Com ele, o agente de IA manda o link do site.',
        onde: { tipo: 'env', variaveis: ['SITE_URL'] }
      }
    ]
  });

  grupos.push({
    grupo: 'Espaços e vendas',
    descricao: 'Por espaço: o que falta para vender, cobrar e emitir contrato.',
    itens: espacos.rows.flatMap((e) => [
      {
        id: `tarifa-${e.slug}`,
        titulo: `${e.nome}: tarifas`,
        estado: e.tarifa ? 'ok' : 'pendente',
        detalhe: e.tarifa ? 'Tarifa publicada.' : 'Sem tarifa: a vitrine mostra "sob consulta" e não vende.',
        onde: { tipo: 'painel', href: '/admin', rotulo: 'Menu › Tarifas' }
      } satisfies Item,
      {
        id: `pix-${e.slug}`,
        titulo: `${e.nome}: chave Pix`,
        estado: e.pix ? 'ok' : 'pendente',
        detalhe: e.pix ? 'Chave cadastrada.' : 'Sem chave Pix o sinal não pode ser cobrado.',
        onde: { tipo: 'painel', href: '/admin', rotulo: 'Menu › Pix' }
      } satisfies Item,
      {
        id: `endereco-${e.slug}`,
        titulo: `${e.nome}: endereço do imóvel`,
        estado: e.endereco ? 'ok' : 'pendente',
        detalhe: e.endereco ? 'Cadastrado.' : 'O contrato recusa a emissão sem o endereço completo.',
        onde: { tipo: 'env', variaveis: ['properties.address_line (banco)'] }
      } satisfies Item
    ])
  });

  grupos.push({
    grupo: 'Contrato e pagamentos',
    descricao: 'Instrumento assinado antes da cobrança e meios de pagamento.',
    itens: [
      {
        id: 'contrato',
        titulo: 'Modelo de contrato',
        estado: contratos.rows[0]!.n > 0 ? 'ok' : 'pendente',
        detalhe: contratos.rows[0]!.n > 0 ? 'Há um modelo ativo.' : 'Nenhum modelo ativo: a reserva para no passo do contrato.',
        onde: { tipo: 'env', variaveis: ['contract_templates (banco)'] }
      },
      {
        id: 'locadora',
        titulo: 'Dados da locadora',
        estado: locadora.rows[0]!.n > 0 ? 'ok' : 'pendente',
        detalhe: locadora.rows[0]!.n > 0 ? 'Cadastrados.' : 'Sem locadora o contrato não tem a outra parte.',
        onde: { tipo: 'env', variaveis: ['landlords (banco)'] }
      },
      {
        id: 'cartao',
        titulo: 'Cartão (Mercado Pago)',
        estado: env('MERCADOPAGO_ACCESS_TOKEN') ? 'ok' : 'aviso',
        detalhe: env('MERCADOPAGO_ACCESS_TOKEN')
          ? 'Credencial definida.'
          : 'Opcional. Sem ela, só Pix — o cartão é recusado com aviso ao hóspede.',
        onde: { tipo: 'env', variaveis: ['MERCADOPAGO_ACCESS_TOKEN'] }
      },
      {
        id: 'cartao-webhook',
        titulo: 'Confirmação automática do cartão',
        estado: !env('MERCADOPAGO_ACCESS_TOKEN') ? 'aviso' : env('MERCADOPAGO_WEBHOOK_SECRET') ? 'ok' : 'pendente',
        detalhe: env('MERCADOPAGO_WEBHOOK_SECRET')
          ? 'Webhook assinado.'
          : 'Sem o segredo, o pagamento só é confirmado pela conciliação diária.',
        onde: { tipo: 'env', variaveis: ['MERCADOPAGO_WEBHOOK_SECRET'] }
      },
      {
        id: 'webhook-generico',
        titulo: 'Webhook de pagamento genérico',
        estado: env('PAYMENT_WEBHOOK_SECRET') ? 'ok' : 'aviso',
        detalhe: env('PAYMENT_WEBHOOK_SECRET') ? 'Definido.' : 'Opcional; só para outro provedor de pagamento.',
        onde: { tipo: 'env', variaveis: ['PAYMENT_WEBHOOK_SECRET'] }
      }
    ]
  });

  grupos.push({
    grupo: 'Integrações',
    descricao: 'Configuradas nos cards abaixo — pelo painel ou por variável de ambiente.',
    itens: [
      {
        id: 'meta-app',
        titulo: 'App da Meta',
        estado: app.appSecret && app.verifyToken ? 'ok' : wa.modo === 'meta' || ig.configurado ? 'pendente' : 'aviso',
        detalhe:
          app.appSecret && app.verifyToken
            ? `Webhooks assinados · Graph ${app.graphVersion}.`
            : 'Sem segredo e token de verificação, os webhooks do WhatsApp e do Instagram são recusados.',
        onde: { tipo: 'integracao', chave: 'META_APP' }
      },
      {
        id: 'whatsapp',
        titulo: 'WhatsApp',
        estado: wa.modo === 'meta' ? (wa.phoneNumberId && wa.accessToken ? 'ok' : 'pendente') : 'aviso',
        detalhe:
          wa.modo === 'meta'
            ? wa.phoneNumberId && wa.accessToken
              ? 'Enviando pela WhatsApp Cloud API.'
              : 'Modo produção sem número ou token.'
            : wa.modo === 'simulado'
              ? 'Em simulação: nada sai de verdade.'
              : 'Desligado.',
        onde: { tipo: 'integracao', chave: 'WHATSAPP' }
      },
      {
        id: 'instagram',
        titulo: 'Instagram Direct',
        estado: ig.configurado ? (ig.igAccountId ? 'ok' : 'aviso') : 'aviso',
        detalhe: ig.configurado
          ? ig.igAccountId
            ? 'Conectado.'
            : 'Conectado, sem o ID da conta: importar histórico não funciona.'
          : 'Não conectado.',
        onde: { tipo: 'integracao', chave: 'INSTAGRAM' }
      },
      {
        id: 'ads',
        titulo: 'Anúncios da Meta',
        estado: ads.configurado ? 'ok' : 'aviso',
        detalhe: ads.configurado ? 'Métricas sincronizadas todo dia.' : 'Não conectado: o gasto aparece zerado no Marketing.',
        onde: { tipo: 'integracao', chave: 'META_ADS' }
      },
      {
        id: 'agente',
        titulo: 'Agente de IA',
        estado: agente.modo === 'DESLIGADO' ? 'aviso' : agente.apiKey ? 'ok' : 'pendente',
        detalhe:
          agente.modo === 'DESLIGADO'
            ? 'Desligado.'
            : !agente.apiKey
              ? 'Ligado, mas sem chave da API.'
              : agente.modo === 'SUGERIR'
                ? `Sugerindo respostas com ${agente.modelo}.`
                : `Respondendo sozinho com ${agente.modelo} (até ${agente.limiteAutomatico} por conversa).`,
        onde: { tipo: 'integracao', chave: 'AGENTE_IA' }
      }
    ]
  });

  grupos.push({
    grupo: 'Acesso e segurança',
    descricao: 'Quem entra no painel e o que fica exposto.',
    itens: [
      {
        id: 'admins',
        titulo: 'Administradores',
        estado: admins.rows[0]!.n > 0 ? 'ok' : 'pendente',
        detalhe: `${admins.rows[0]!.n} administrador(es) ativo(s).`,
        onde: { tipo: 'painel', href: '/admin/usuarios', rotulo: 'Usuários' }
      },
      {
        id: 'rls',
        titulo: 'Proteção das tabelas (RLS)',
        estado: semRls.rowCount ? 'pendente' : 'ok',
        detalhe: semRls.rowCount
          ? `Sem RLS: ${semRls.rows.map((r) => r.relname).join(', ')}. Rode npm run db:migrate.`
          : 'Todas as tabelas protegidas contra a Data API do Supabase.',
        onde: { tipo: 'env', variaveis: ['npm run db:migrate'] }
      }
    ]
  });

  return grupos;
}
