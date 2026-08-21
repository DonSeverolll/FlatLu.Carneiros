import { ZodError, type ZodType, type output } from 'zod';
import { AppError, badRequest, forbidden } from './errors';
import { ConfigError } from './config';

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...headers }
  });
}

/**
 * Defesa CSRF. Os cookies de sessão são `SameSite=Lax`, o que já bloqueia o
 * caso clássico, mas navegadores tratam subdomínios como mesmo site — então
 * confirmamos que o `Origin` bate com o host que atendeu a requisição. Como web
 * e API vivem no mesmo domínio, qualquer origem diferente é forjada.
 */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) {
    // Navegadores sempre enviam Origin em requisições que alteram estado.
    throw forbidden('MISSING_ORIGIN');
  }
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw forbidden('INVALID_ORIGIN');
  }
  if (!host || originHost !== host) throw forbidden('CROSS_ORIGIN_BLOCKED');
}

/**
 * `output<S>` e nao um generico solto: com um generico o TypeScript infere o
 * tipo de ENTRADA do schema, entao campos com `.default()` chegam ao servico
 * como `possivelmente undefined` mesmo depois do parse ter preenchido.
 */
export async function parseBody<S extends ZodType>(
  request: Request,
  schema: S
): Promise<output<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw badRequest('INVALID_JSON');
  }
  return schema.parse(raw) as output<S>;
}

export function parseQuery<S extends ZodType>(request: Request, schema: S): output<S> {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  return schema.parse(params) as output<S>;
}

/**
 * Envelope único para toda rota: converte AppError/ZodError em resposta
 * previsível e impede que detalhe interno (SQL, stack) vaze para o cliente.
 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AppError) {
      const headers: Record<string, string> = {};
      if (error.status === 429 && error.details && typeof error.details === 'object') {
        const { retryAfterSeconds } = error.details as { retryAfterSeconds: number };
        headers['retry-after'] = String(retryAfterSeconds);
      }
      return json({ error: error.code, details: error.details }, error.status, headers);
    }
    if (error instanceof ZodError) {
      return json({ error: 'INVALID_INPUT', details: error.flatten() }, 400);
    }
    if (error instanceof ConfigError) {
      console.error('[config]', error.message);
      return json({ error: 'SERVICE_NOT_CONFIGURED' }, 503);
    }
    console.error('[unhandled]', error);
    return json({ error: 'INTERNAL_ERROR' }, 500);
  }
}
