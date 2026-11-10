import { z } from 'zod';

/**
 * Tradução dos webhooks da Meta (WhatsApp Cloud API e Instagram Messaging)
 * para eventos internos. Código puro, testável sem banco nem rede.
 *
 * Um lote da Meta pode trazer dezenas de itens. Item malformado é descartado
 * sozinho, em vez de recusar o lote: devolver erro faria a Meta reenviar
 * tudo, e o item ruim continuaria ruim.
 */

export type Canal = 'WHATSAPP' | 'INSTAGRAM';
export type TipoMensagem =
  | 'TEXTO'
  | 'IMAGEM'
  | 'PDF'
  | 'VIDEO'
  | 'AUDIO'
  | 'DOCUMENTO'
  | 'TEMPLATE'
  | 'OUTRO';
export type StatusMensagem = 'PENDENTE' | 'ENVIADA' | 'ENTREGUE' | 'LIDA' | 'FALHOU' | 'RECEBIDA';

/** Anúncio que originou a conversa (click-to-WhatsApp / click-to-Direct). */
export type Referral = {
  adId: string | null;
  sourceType: string | null;
  sourceUrl: string | null;
  headline: string | null;
  ctwaClid: string | null;
};

export type EventoMensagem = {
  evento: 'mensagem';
  canal: Canal;
  /** Quem enviou do lado de fora (wa_id ou IGSID). */
  contatoId: string;
  contatoNome: string | null;
  telefone: string | null;
  direcao: 'ENTRADA' | 'SAIDA';
  idExterno: string;
  em: Date;
  tipo: TipoMensagem;
  corpo: string | null;
  midiaId: string | null;
  midiaUrl: string | null;
  midiaMime: string | null;
  midiaNomeArquivo: string | null;
  referral: Referral | null;
  bruto: unknown;
};

export type EventoStatus = {
  evento: 'status';
  canal: Canal;
  idExterno: string;
  status: Exclude<StatusMensagem, 'PENDENTE' | 'RECEBIDA'>;
  em: Date;
  erro: string | null;
  /** Instagram confirma leitura por "tudo até aqui", não por mensagem. */
  ateAqui: boolean;
  contatoId: string | null;
};

export type Evento = EventoMensagem | EventoStatus;

const ORDEM_STATUS: Record<StatusMensagem, number> = {
  PENDENTE: 0,
  FALHOU: 0,
  RECEBIDA: 0,
  ENVIADA: 1,
  ENTREGUE: 2,
  LIDA: 3
};

/**
 * Webhooks chegam fora de ordem: "lida" pode chegar antes de "entregue". O
 * status só avança. "Falhou" só vale enquanto a mensagem não foi entregue —
 * a Meta às vezes manda falha de um reenvio depois da entrega do original.
 */
export function proximoStatus(atual: StatusMensagem, novo: StatusMensagem): StatusMensagem {
  if (novo === 'FALHOU') return ORDEM_STATUS[atual] >= 2 ? atual : 'FALHOU';
  if (atual === 'FALHOU') return novo;
  return ORDEM_STATUS[novo] > ORDEM_STATUS[atual] ? novo : atual;
}

function quando(segundosOuMs: string | number | undefined): Date {
  const n = Number(segundosOuMs);
  if (!Number.isFinite(n) || n <= 0) return new Date();
  // WhatsApp manda segundos; Instagram, milissegundos.
  return new Date(n < 1e12 ? n * 1000 : n);
}

const texto = (valor: unknown, max = 4096) =>
  typeof valor === 'string' && valor.trim() ? valor.slice(0, max) : null;

// ---------------------------------------------------------------------------
// WhatsApp Cloud API
// ---------------------------------------------------------------------------

const waMidia = z
  .object({
    id: z.string().optional(),
    mime_type: z.string().optional(),
    caption: z.string().optional(),
    filename: z.string().optional(),
    link: z.string().optional()
  })
  .passthrough();

const waMensagem = z
  .object({
    from: z.string().regex(/^\d{6,20}$/),
    id: z.string().min(1).max(200),
    timestamp: z.union([z.string(), z.number()]).optional(),
    type: z.string(),
    text: z.object({ body: z.string() }).partial().optional(),
    image: waMidia.optional(),
    video: waMidia.optional(),
    audio: waMidia.optional(),
    document: waMidia.optional(),
    sticker: waMidia.optional(),
    button: z.object({ text: z.string() }).partial().optional(),
    interactive: z
      .object({
        button_reply: z.object({ title: z.string() }).partial().optional(),
        list_reply: z.object({ title: z.string() }).partial().optional()
      })
      .partial()
      .optional(),
    location: z
      .object({ latitude: z.number(), longitude: z.number(), name: z.string() })
      .partial()
      .optional(),
    referral: z
      .object({
        source_url: z.string(),
        source_id: z.string(),
        source_type: z.string(),
        headline: z.string(),
        ctwa_clid: z.string()
      })
      .partial()
      .optional()
  })
  .passthrough();

const waStatus = z
  .object({
    id: z.string().min(1).max(200),
    status: z.string(),
    timestamp: z.union([z.string(), z.number()]).optional(),
    recipient_id: z.string().optional(),
    errors: z
      .array(z.object({ code: z.number().optional(), title: z.string().optional(), message: z.string().optional() }).passthrough())
      .optional()
  })
  .passthrough();

const waContato = z
  .object({ wa_id: z.string(), profile: z.object({ name: z.string() }).partial().optional() })
  .passthrough();

const waEnvelope = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          field: z.string(),
          value: z
            .object({
              contacts: z.array(z.unknown()).optional(),
              messages: z.array(z.unknown()).optional(),
              statuses: z.array(z.unknown()).optional()
            })
            .passthrough()
        })
      )
    })
  )
});

const STATUS_WA: Record<string, EventoStatus['status']> = {
  sent: 'ENVIADA',
  delivered: 'ENTREGUE',
  read: 'LIDA',
  failed: 'FALHOU'
};

function referralWhatsApp(ref: z.infer<typeof waMensagem>['referral']): Referral | null {
  if (!ref) return null;
  const adId = ref.source_type === 'ad' && /^\d{5,25}$/.test(ref.source_id ?? '') ? ref.source_id! : null;
  return {
    adId,
    sourceType: ref.source_type ?? null,
    sourceUrl: texto(ref.source_url, 500),
    headline: texto(ref.headline, 200),
    ctwaClid: texto(ref.ctwa_clid, 500)
  };
}

function conteudoWhatsApp(m: z.infer<typeof waMensagem>): Pick<
  EventoMensagem,
  'tipo' | 'corpo' | 'midiaId' | 'midiaMime' | 'midiaNomeArquivo'
> {
  const vazio = { midiaId: null, midiaMime: null, midiaNomeArquivo: null };
  const midia = (tipo: TipoMensagem, dado: z.infer<typeof waMidia> | undefined) => ({
    tipo,
    corpo: texto(dado?.caption),
    midiaId: texto(dado?.id, 160),
    midiaMime: texto(dado?.mime_type, 120),
    midiaNomeArquivo: texto(dado?.filename, 240)
  });

  switch (m.type) {
    case 'text':
      return { tipo: 'TEXTO', corpo: texto(m.text?.body) ?? '', ...vazio };
    case 'image':
      return midia('IMAGEM', m.image);
    case 'sticker':
      return midia('IMAGEM', m.sticker);
    case 'video':
      return midia('VIDEO', m.video);
    case 'audio':
      return midia('AUDIO', m.audio);
    case 'document': {
      const pdf =
        m.document?.mime_type === 'application/pdf' ||
        /\.pdf$/i.test(m.document?.filename ?? '');
      return midia(pdf ? 'PDF' : 'DOCUMENTO', m.document);
    }
    case 'button':
      return { tipo: 'TEXTO', corpo: texto(m.button?.text) ?? '[botão]', ...vazio };
    case 'interactive':
      return {
        tipo: 'TEXTO',
        corpo:
          texto(m.interactive?.button_reply?.title) ??
          texto(m.interactive?.list_reply?.title) ??
          '[resposta interativa]',
        ...vazio
      };
    case 'location': {
      const l = m.location;
      const coordenadas = l?.latitude !== undefined ? `${l.latitude}, ${l.longitude}` : '';
      return { tipo: 'OUTRO', corpo: `📍 ${[l?.name, coordenadas].filter(Boolean).join(' — ')}`, ...vazio };
    }
    default:
      return { tipo: 'OUTRO', corpo: `[${m.type} não suportado no painel]`, ...vazio };
  }
}

export function eventosWhatsApp(payload: unknown): Evento[] {
  const envelope = waEnvelope.safeParse(payload);
  if (!envelope.success) return [];

  const eventos: Evento[] = [];
  for (const entrada of envelope.data.entry) {
    for (const mudanca of entrada.changes) {
      if (mudanca.field !== 'messages') continue;
      const valor = mudanca.value;

      const nomes = new Map<string, string>();
      for (const bruto of valor.contacts ?? []) {
        const contato = waContato.safeParse(bruto);
        if (contato.success && contato.data.profile?.name) {
          nomes.set(contato.data.wa_id, contato.data.profile.name.slice(0, 160));
        }
      }

      for (const bruto of valor.messages ?? []) {
        const m = waMensagem.safeParse(bruto);
        // Reação não é mensagem: viraria um balão vazio no histórico.
        if (!m.success || m.data.type === 'reaction') continue;
        eventos.push({
          evento: 'mensagem',
          canal: 'WHATSAPP',
          contatoId: m.data.from,
          contatoNome: nomes.get(m.data.from) ?? null,
          telefone: m.data.from,
          direcao: 'ENTRADA',
          idExterno: m.data.id,
          em: quando(m.data.timestamp),
          midiaUrl: null,
          referral: referralWhatsApp(m.data.referral),
          bruto,
          ...conteudoWhatsApp(m.data)
        });
      }

      for (const bruto of valor.statuses ?? []) {
        const s = waStatus.safeParse(bruto);
        const status = s.success ? STATUS_WA[s.data.status] : undefined;
        if (!s.success || !status) continue;
        const erro = s.data.errors?.[0];
        eventos.push({
          evento: 'status',
          canal: 'WHATSAPP',
          idExterno: s.data.id,
          status,
          em: quando(s.data.timestamp),
          erro: erro ? `${erro.code ?? ''} ${erro.title ?? erro.message ?? ''}`.trim().slice(0, 500) : null,
          ateAqui: false,
          contatoId: s.data.recipient_id ?? null
        });
      }
    }
  }
  return eventos;
}

// ---------------------------------------------------------------------------
// Instagram Messaging (Direct)
// ---------------------------------------------------------------------------

const igReferral = z
  .object({
    ad_id: z.string(),
    source: z.string(),
    type: z.string(),
    ref: z.string(),
    ads_context_data: z.object({ ad_title: z.string(), post_id: z.string() }).partial()
  })
  .partial()
  .passthrough();

const igItem = z
  .object({
    sender: z.object({ id: z.string().regex(/^\d{3,40}$/) }),
    recipient: z.object({ id: z.string().regex(/^\d{3,40}$/) }),
    timestamp: z.union([z.string(), z.number()]).optional(),
    message: z
      .object({
        mid: z.string().min(1).max(200),
        text: z.string().optional(),
        is_echo: z.boolean().optional(),
        is_deleted: z.boolean().optional(),
        is_unsupported: z.boolean().optional(),
        attachments: z
          .array(
            z
              .object({ type: z.string(), payload: z.object({ url: z.string() }).partial().optional() })
              .passthrough()
          )
          .optional(),
        referral: igReferral.optional()
      })
      .passthrough()
      .optional(),
    read: z.object({ mid: z.string() }).partial().optional(),
    referral: igReferral.optional()
  })
  .passthrough();

const igEnvelope = z.object({
  object: z.literal('instagram'),
  entry: z.array(
    z
      .object({ id: z.string().optional(), messaging: z.array(z.unknown()).optional() })
      .passthrough()
  )
});

function referralInstagram(ref: z.infer<typeof igReferral> | undefined): Referral | null {
  if (!ref) return null;
  return {
    adId: /^\d{5,25}$/.test(ref.ad_id ?? '') ? ref.ad_id! : null,
    sourceType: ref.source ?? null,
    sourceUrl: null,
    headline: texto(ref.ads_context_data?.ad_title, 200),
    ctwaClid: null
  };
}

const TIPO_ANEXO_IG: Record<string, TipoMensagem> = {
  image: 'IMAGEM',
  video: 'VIDEO',
  audio: 'AUDIO',
  file: 'DOCUMENTO',
  ig_reel: 'VIDEO',
  reel: 'VIDEO',
  share: 'OUTRO',
  story_mention: 'OUTRO'
};

/**
 * @param contaPropria ID da conta profissional. Mensagem cujo REMETENTE é a
 * própria conta é eco do que nós enviamos (pelo painel ou pelo app do
 * Instagram) e entra como SAÍDA, com o contato sendo o destinatário.
 */
export function eventosInstagram(payload: unknown, contaPropria: string | null): Evento[] {
  const envelope = igEnvelope.safeParse(payload);
  if (!envelope.success) return [];

  const eventos: Evento[] = [];
  for (const entrada of envelope.data.entry) {
    const propria = contaPropria ?? entrada.id ?? null;
    for (const bruto of entrada.messaging ?? []) {
      const item = igItem.safeParse(bruto);
      if (!item.success) continue;
      const { sender, recipient, message, read } = item.data;
      const eco = Boolean(message?.is_echo) || (propria !== null && sender.id === propria);
      const contatoId = eco ? recipient.id : sender.id;

      if (read?.mid) {
        eventos.push({
          evento: 'status',
          canal: 'INSTAGRAM',
          idExterno: read.mid,
          status: 'LIDA',
          em: quando(item.data.timestamp),
          erro: null,
          ateAqui: true,
          contatoId
        });
        continue;
      }

      if (!message || message.is_deleted) continue;

      const anexo = message.attachments?.[0];
      const tipo: TipoMensagem = anexo
        ? (TIPO_ANEXO_IG[anexo.type] ?? 'OUTRO')
        : message.is_unsupported
          ? 'OUTRO'
          : 'TEXTO';
      const corpo =
        texto(message.text) ??
        (tipo === 'OUTRO' ? `[${anexo?.type ?? 'conteúdo'} do Instagram]` : null);

      eventos.push({
        evento: 'mensagem',
        canal: 'INSTAGRAM',
        contatoId,
        contatoNome: null,
        telefone: null,
        direcao: eco ? 'SAIDA' : 'ENTRADA',
        idExterno: message.mid,
        em: quando(item.data.timestamp),
        tipo,
        corpo: corpo ?? (anexo?.payload?.url ? null : '[mensagem vazia]'),
        midiaId: null,
        midiaUrl: texto(anexo?.payload?.url, 2000),
        midiaMime: null,
        midiaNomeArquivo: null,
        referral: referralInstagram(message.referral ?? item.data.referral),
        bruto
      });
    }
  }
  return eventos;
}

/** Prévia de uma linha para a lista de conversas. */
export function previa(tipo: TipoMensagem, corpo: string | null): string {
  const rotulo: Partial<Record<TipoMensagem, string>> = {
    IMAGEM: '📷 Foto',
    VIDEO: '🎬 Vídeo',
    AUDIO: '🎤 Áudio',
    PDF: '📄 PDF',
    DOCUMENTO: '📎 Documento'
  };
  // Modelo já chega com corpo "Modelo: nome"; prefixar de novo duplicaria.
  if (tipo === 'TEMPLATE') return `📋 ${corpo ?? 'Modelo'}`.slice(0, 200);
  const base = corpo?.replace(/\s+/g, ' ').trim() ?? '';
  const prefixo = rotulo[tipo];
  const linha = prefixo ? (base ? `${prefixo} · ${base}` : prefixo) : base;
  return linha.slice(0, 200) || '—';
}
