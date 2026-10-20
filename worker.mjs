import { proxyAlbion } from './scripts/albion-proxy.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/albion/')) {
      // An optional separately hosted API only shares public reports with the configured site.
      const origin = request.headers.get('Origin');
      const allowed = !origin || origin === url.origin || origin === env.SITE_ORIGIN;
      if (!allowed) return new Response('Forbidden', { status: 403 });
      const response = await proxyAlbion(request);
      if (origin && origin === env.SITE_ORIGIN) {
        response.headers.set('Access-Control-Allow-Origin', origin);
        response.headers.set('Vary', 'Origin');
      }
      return response;
    }
    return env.ASSETS.fetch(request);
  },
};
