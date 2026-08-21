/** Erro de domínio que o handler HTTP sabe traduzir em status + código. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown
  ) {
    super(code);
    this.name = 'AppError';
  }
}

export const unauthorized = (code = 'UNAUTHORIZED') => new AppError(401, code);
export const forbidden = (code = 'FORBIDDEN') => new AppError(403, code);
export const notFound = (code: string) => new AppError(404, code);
export const conflict = (code: string) => new AppError(409, code);
export const badRequest = (code: string, details?: unknown) => new AppError(400, code, details);
export const tooManyRequests = (retryAfterSeconds: number) =>
  new AppError(429, 'TOO_MANY_REQUESTS', { retryAfterSeconds });
