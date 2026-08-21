/** Dados do cliente atrás do proxy do Vercel. */
export function requestContext(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null;
  return { ip, userAgent: request.headers.get('user-agent') };
}
