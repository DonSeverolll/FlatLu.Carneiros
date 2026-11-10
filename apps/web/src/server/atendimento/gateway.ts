import { randomUUID } from 'node:crypto';
import { AppError } from '../errors';
import { credInstagram, credWhatsApp } from '../integracoes/store';
import { graph } from '../meta/graph';
import type { Canal, TipoMensagem } from './payloads';

/**
 * Saída de mensagens. Um adaptador por provedor, todos com o mesmo contrato,
 * para que trocar Meta Cloud API por Evolution API ou Z-API seja escrever um
 * adaptador novo — o inbox, o webhook e o banco não mudam.
 */

export type Saida = {
  canal: Canal;
  /** wa_id (só dígitos, com DDI) ou IGSID. */
  para: string;
  tipo: TipoMensagem;
  corpo?: string | null;
  /** Mídia hospedada publicamente (vídeo do flat no CDN, por exemplo). */
  midiaUrl?: string | null;
  /** Mídia já enviada ao provedor (upload pelo painel). */
  midiaId?: string | null;
  midiaNomeArquivo?: string | null;
  template?: { nome: string; idioma: string } | null;
};

export type Envio = { idExterno: string; simulado: boolean };

export const notConfigured = (detalhe: string) =>
  new AppError(503, 'MESSAGING_NOT_CONFIGURED', { detalhe });

/** O modo do WhatsApp em vigor (painel ou env). `null` = envio desligado. */
export async function modoWhatsApp() {
  return (await credWhatsApp()).modo;
}

export async function instagramConfigurado(): Promise<boolean> {
  return (await credInstagram()).configurado;
}

/** Credenciais completas da Cloud API, ou erro dizendo qual falta. */
async function cloudApi() {
  const c = await credWhatsApp();
  if (!c.phoneNumberId || !c.accessToken) throw notConfigured('WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN');
  return { phoneNumberId: c.phoneNumberId, token: c.accessToken };
}

async function paginaInstagram() {
  const c = await credInstagram();
  if (!c.pageId || !c.pageToken) throw notConfigured('META_PAGE_ID / META_PAGE_ACCESS_TOKEN');
  return { pageId: c.pageId, token: c.pageToken };
}

export async function enviar(saida: Saida): Promise<Envio> {
  if (saida.canal === 'INSTAGRAM') {
    if (!(await instagramConfigurado())) {
      // Conversa do Direct sem token não tem simulador: a resposta precisa sair
      // pelo Instagram de verdade ou não sair.
      if ((await modoWhatsApp()) === 'simulado') return { idExterno: `sim.${randomUUID()}`, simulado: true };
      throw notConfigured('META_PAGE_ID / META_PAGE_ACCESS_TOKEN');
    }
    return enviarInstagram(saida);
  }

  const modo = await modoWhatsApp();
  if (modo === 'simulado') return { idExterno: `sim.${randomUUID()}`, simulado: true };
  if (modo === 'meta') return enviarWhatsAppCloud(saida);
  throw notConfigured('WHATSAPP_PROVIDER');
}

// ---------------------------------------------------------------------------
// WhatsApp Cloud API
// ---------------------------------------------------------------------------

const TIPO_CLOUD: Partial<Record<TipoMensagem, 'image' | 'video' | 'audio' | 'document'>> = {
  IMAGEM: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
  PDF: 'document',
  DOCUMENTO: 'document'
};

export function corpoWhatsAppCloud(saida: Saida): Record<string, unknown> {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: saida.para };

  if (saida.tipo === 'TEMPLATE') {
    if (!saida.template) throw new AppError(400, 'TEMPLATE_REQUIRED');
    return {
      ...base,
      type: 'template',
      template: { name: saida.template.nome, language: { code: saida.template.idioma } }
    };
  }

  const tipoMidia = TIPO_CLOUD[saida.tipo];
  if (!tipoMidia) {
    return { ...base, type: 'text', text: { body: saida.corpo ?? '', preview_url: true } };
  }

  const midia: Record<string, string> = saida.midiaId
    ? { id: saida.midiaId }
    : { link: saida.midiaUrl ?? '' };
  // Áudio não aceita legenda; documento aceita nome de arquivo.
  if (saida.corpo && tipoMidia !== 'audio') midia.caption = saida.corpo;
  if (tipoMidia === 'document' && saida.midiaNomeArquivo) midia.filename = saida.midiaNomeArquivo;
  return { ...base, type: tipoMidia, [tipoMidia]: midia };
}

async function enviarWhatsAppCloud(saida: Saida): Promise<Envio> {
  const api = await cloudApi();
  const resposta = await graph<{ messages?: { id: string }[] }>(`${api.phoneNumberId}/messages`, {
    token: api.token,
    method: 'POST',
    body: corpoWhatsAppCloud(saida)
  });
  const id = resposta.messages?.[0]?.id;
  if (!id) throw new AppError(502, 'META_API_ERROR', { message: 'resposta sem id de mensagem' });
  return { idExterno: id, simulado: false };
}

/**
 * Upload de arquivo para a Cloud API, devolvendo o id de mídia. Usado para o
 * PDF do contrato e fotos enviadas do computador do atendente.
 */
export async function uploadMidiaWhatsApp(arquivo: File): Promise<{ midiaId: string; simulado: boolean }> {
  const modo = await modoWhatsApp();
  if (modo === 'simulado') return { midiaId: `sim-midia.${randomUUID()}`, simulado: true };
  if (modo !== 'meta') throw notConfigured('WHATSAPP_PROVIDER');

  const form = new FormData();
  form.set('messaging_product', 'whatsapp');
  form.set('type', arquivo.type || 'application/octet-stream');
  form.set('file', arquivo, arquivo.name);
  const api = await cloudApi();
  const resposta = await graph<{ id?: string }>(`${api.phoneNumberId}/media`, {
    token: api.token,
    method: 'POST',
    form
  });
  if (!resposta.id) throw new AppError(502, 'META_API_ERROR', { message: 'upload sem id' });
  return { midiaId: resposta.id, simulado: false };
}

/**
 * Baixa mídia RECEBIDA. A Cloud API não entrega a mídia no webhook: dá um id,
 * que vira uma URL temporária (≈5 min) que exige o token. Por isso o painel
 * busca sob demanda, pelo servidor, em vez de guardar uma URL que expira.
 */
export async function baixarMidiaWhatsApp(midiaId: string): Promise<Response> {
  const { token } = await cloudApi();
  const info = await graph<{ url?: string; mime_type?: string }>(midiaId, { token });
  if (!info.url) throw new AppError(404, 'MEDIA_NOT_FOUND');
  const arquivo = await fetch(info.url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store'
  });
  if (!arquivo.ok || !arquivo.body) throw new AppError(502, 'MEDIA_DOWNLOAD_FAILED');
  return new Response(arquivo.body, {
    headers: {
      'content-type': info.mime_type ?? arquivo.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'private, max-age=300'
    }
  });
}

// ---------------------------------------------------------------------------
// Instagram Direct (via Página do Facebook)
// ---------------------------------------------------------------------------

const ANEXO_IG: Partial<Record<TipoMensagem, string>> = {
  IMAGEM: 'image',
  VIDEO: 'video',
  AUDIO: 'audio',
  PDF: 'file',
  DOCUMENTO: 'file'
};

async function enviarInstagram(saida: Saida): Promise<Envio> {
  const anexo = ANEXO_IG[saida.tipo];
  if (anexo && !saida.midiaUrl) {
    // O Direct não aceita id de mídia do WhatsApp; precisa de URL pública.
    throw new AppError(400, 'INSTAGRAM_NEEDS_MEDIA_URL');
  }
  const message = anexo
    ? { attachment: { type: anexo, payload: { url: saida.midiaUrl } } }
    : { text: saida.corpo ?? '' };

  const pagina = await paginaInstagram();
  const resposta = await graph<{ message_id?: string }>(`${pagina.pageId}/messages`, {
    token: pagina.token,
    method: 'POST',
    body: { recipient: { id: saida.para }, messaging_type: 'RESPONSE', message }
  });
  if (!resposta.message_id) throw new AppError(502, 'META_API_ERROR', { message: 'resposta sem message_id' });

  // Legenda junto de anexo vai como segunda mensagem: o Direct não tem caption.
  if (anexo && saida.corpo) {
    await graph(`${pagina.pageId}/messages`, {
      token: pagina.token,
      method: 'POST',
      body: { recipient: { id: saida.para }, messaging_type: 'RESPONSE', message: { text: saida.corpo } }
    });
  }
  return { idExterno: resposta.message_id, simulado: false };
}

