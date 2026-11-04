// Cloudflare Pages Function: forwards /api/* to the backend so the site and API share one origin.
export async function onRequest({ request, env }) {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, env.BACKEND_URL);
  const headers = new Headers(request.headers);
  headers.delete('host');
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  try {
    return await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: 'manual',
    });
  } catch {
    return new Response(JSON.stringify({ message: 'السيرفر بيصحى، حاول تاني بعد ثواني' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}
