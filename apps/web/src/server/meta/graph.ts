import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors';
import { credMetaApp } from '../integracoes/store';

/** Comparação em tempo constante (sem importar `auth`, que puxa cookies/argon2). */
export function secretMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Cliente mínimo da Graph API.
 *
 * Por que não o "Meta MCP": um servidor MCP é uma interface para AGENTES de IA
 * consultarem a conta (útil para pedir ao Claude "qual anúncio teve o menor
 * CPL?"). O backend de produção precisa de chamadas determinísticas, com
 * timeout, paginação e erro tipado — isso é a Graph API direta. O MCP e este
 * módulo leem a mesma conta; um não substitui o outro.
 */

const GRAPH_HOST = 'https://graph.facebook.com';

/**
 * Fora de produção, META_GRAPH_HOST aponta para uma Graph API simulada nos
 * testes de ponta a ponta. Em produção é sempre a Meta: uma variável trocada
 * por engano mandaria tokens reais para outro servidor.
 */
function graphHost(): string {
  const alternativo = process.env.META_GRAPH_HOST?.trim();
  if (alternativo && process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(alternativo)) {
    return alternativo;
  }
  return GRAPH_HOST;
}
const TIMEOUT_MS = 15_000;

/** Erro devolvido pela Graph API, sem vazar o token na mensagem. */
export class MetaApiError extends AppError {
  constructor(
    status: number,
    readonly metaCode: number | undefined,
    readonly metaMessage: string
  ) {
    // 429 continua 429 (a tela sabe esperar); o resto é falha do provedor.
    super(status === 429 ? 429 : 502, 'META_API_ERROR', {
      metaCode,
      message: metaMessage.slice(0, 300)
    });
  }
}

/**
 * `appsecret_proof`: HMAC-SHA256 do token com o segredo do app. Com a opção
 * "Exigir prova de segredo do app" ligada, um token vazado sozinho não serve.
 */
export function appSecretProof(accessToken: string, appSecret: string): string {
  return createHmac('sha256', appSecret).update(accessToken).digest('hex');
}

type GraphOptions = {
  token: string;
  method?: 'GET' | 'POST' | 'DELETE';
  params?: Record<string, string | number | undefined>;
  body?: unknown;
  form?: FormData;
};

export function graphUrl(path: string, versao: string): string {
  if (/^https?:\/\//.test(path)) {
    // URL completa só vem de `paging.next`. Ela recebe o token no cabeçalho,
    // então precisa ser da própria Graph API — nunca de outro host.
    const host = graphHost();
    if (path !== host && !path.startsWith(`${host}/`)) {
      throw new MetaApiError(502, undefined, 'URL de paginação fora da Graph API');
    }
    return path;
  }
  return `${graphHost()}/${versao}/${path.replace(/^\//, '')}`;
}

export async function graph<T>(path: string, options: GraphOptions): Promise<T> {
  // Versão e segredo do app vêm do painel (ou da env): ver integracoes/store.
  const app = await credMetaApp();
  const url = new URL(graphUrl(path, app.graphVersion));
  for (const [chave, valor] of Object.entries(options.params ?? {})) {
    if (valor !== undefined) url.searchParams.set(chave, String(valor));
  }
  // URL de paginação (`paging.next`) já traz o token; só completamos o que falta.
  if (!url.searchParams.has('appsecret_proof') && app.appSecret) {
    url.searchParams.set('appsecret_proof', appSecretProof(options.token, app.appSecret));
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${options.token}` };
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store'
    });
  } catch (error) {
    throw new MetaApiError(503, undefined, error instanceof Error ? error.message : 'fetch falhou');
  }

  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: { code?: number; message?: string } })
    | null;
  if (!response.ok || payload?.error) {
    throw new MetaApiError(
      response.status,
      payload?.error?.code,
      payload?.error?.message ?? `HTTP ${response.status}`
    );
  }
  return payload as T;
}

/** Percorre `paging.next` até acabar ou até `limite` páginas. */
export async function graphPages<T>(
  path: string,
  options: GraphOptions,
  limite = 50
): Promise<T[]> {
  const itens: T[] = [];
  let proxima: string | null = path;
  let opcoes: GraphOptions = options;
  for (let pagina = 0; proxima && pagina < limite; pagina += 1) {
    const resposta: { data?: T[]; paging?: { next?: string } } = await graph(proxima, opcoes);
    itens.push(...(resposta.data ?? []));
    proxima = resposta.paging?.next ?? null;
    // A URL de `next` já tem todos os parâmetros.
    opcoes = { token: options.token };
  }
  return itens;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/**
 * Confere `X-Hub-Signature-256` contra o corpo CRU. Tem de ser o texto exato
 * recebido: re-serializar o JSON muda espaços e acentos e a assinatura nunca
 * bate.
 */
export function assinaturaValida(corpoCru: string, cabecalho: string | null, appSecret: string): boolean {
  if (!cabecalho?.startsWith('sha256=')) return false;
  const esperado = createHmac('sha256', appSecret).update(corpoCru, 'utf8').digest('hex');
  return secretMatches(esperado, cabecalho.slice('sha256='.length));
}

/** Handshake GET da Meta: devolve o `hub.challenge` se o token bater. */
export async function respostaDeVerificacao(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const modo = params.get('hub.mode');
  const token = params.get('hub.verify_token') ?? '';
  const desafio = params.get('hub.challenge') ?? '';
  const { verifyToken } = await credMetaApp();
  if (!verifyToken) {
    return new Response('webhook não configurado', { status: 503 });
  }
  if (modo === 'subscribe' && secretMatches(verifyToken, token)) {
    return new Response(desafio, { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  return new Response('forbidden', { status: 403 });
}
