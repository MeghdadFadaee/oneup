// Shared by the local server and the optional Cloudflare Worker. No arbitrary upstream URLs.
const API = 'https://api.albionbb.com/eu';
export function upstreamUrl(requestUrl) {
  const input = new URL(requestUrl), path = input.pathname.replace(/^\/api\/albion/, '');
  const allowed = path === '/guilds/search' || path === '/battles' || path === '/battles/multi' || /^\/battles\/\d+$/.test(path);
  if (!input.pathname.startsWith('/api/albion/') || !allowed) throw Error('Unsupported API path');
  const url = new URL(API + path);
  const allowedKeys = path === '/guilds/search' ? ['search'] : path === '/battles' ? ['guildId','page','minPlayers','minGuildPlayers'] : path === '/battles/multi' ? ['ids'] : [];
  for (const [key, value] of input.searchParams) {
    if (!allowedKeys.includes(key) || value.length > 2000) throw Error('Invalid API parameter');
    url.searchParams.set(key, value);
  }
  if (path === '/guilds/search' && (!url.searchParams.get('search')?.trim() || url.searchParams.get('search').length > 100)) throw Error('Invalid guild name');
  if (path === '/battles') {
    if (!/^[\w-]{1,64}$/.test(url.searchParams.get('guildId') || '')) throw Error('Invalid guild ID');
    for (const key of ['page','minPlayers','minGuildPlayers']) if (url.searchParams.has(key) && !/^\d{1,5}$/.test(url.searchParams.get(key))) throw Error('Invalid numeric parameter');
  }
  if (path === '/battles/multi' && !/^\d+(,\d+){1,99}$/.test(url.searchParams.get('ids') || '')) throw Error('Invalid battle IDs');
  return url;
}
export async function proxyAlbion(request, fetchImpl = fetch) {
  if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET' } });
  let url;
  try { url = upstreamUrl(request.url); }
  catch { return Response.json({ error: 'Invalid Albion API request' }, { status: 400 }); }
  try {
    const result = await fetchImpl(url, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30_000) });
    if (!result.ok) return Response.json({ error: 'AlbionBB is temporarily unavailable', upstreamStatus: result.status }, { status: result.status === 429 ? 429 : 502 });
    const body = await result.json();
    return Response.json(body, { headers: { 'Cache-Control': 'public, max-age=120', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return Response.json({ error: 'Unable to reach AlbionBB' }, { status: 502 }); }
}
