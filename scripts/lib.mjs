export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
export const localized = (value, lang) => typeof value === 'string' ? value : value?.[lang] ?? value?.en ?? '';
export function youtubeId(value) {
  try {
    const u = new URL(value);
    if (['youtu.be', 'www.youtu.be'].includes(u.hostname)) return /^[\w-]{11}$/.test(u.pathname.slice(1)) ? u.pathname.slice(1) : null;
    if (!['youtube.com','www.youtube.com','m.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com'].includes(u.hostname)) return null;
    const id = u.searchParams.get('v') || u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})/)?.[1];
    return /^[\w-]{11}$/.test(id ?? '') ? id : null;
  } catch { return null; }
}
export function safeUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:'; } catch { return false; }
}
export function assetPath(value) {
  return typeof value === 'string' && /^assets\/[a-zA-Z0-9_./-]+$/.test(value) && !value.split('/').includes('..');
}
export function validate(site, rewards) {
  const fail = msg => { throw new Error(`Content error: ${msg}`); };
  if (!safeUrl(site.siteUrl)) fail('siteUrl must use HTTPS.');
  const origin = new URL(site.siteUrl);
  if (origin.search || origin.hash || origin.pathname !== '/') fail('siteUrl must be a domain without a path, query, or fragment.');
  for (const key of ['socials','clips','battles']) if (!Array.isArray(site[key])) fail(`${key} must be an array.`);
  for (const s of site.socials) if (s.url && !safeUrl(s.url)) fail(`Invalid social URL: ${s.name}`);
  for (const c of site.clips) {
    if (!safeUrl(c.url)) fail(`Invalid clip URL: ${localized(c.title,'en')}`);
    if (!['youtube','direct'].includes(c.type)) fail('Clip type must be youtube or direct.');
    if (c.type === 'youtube' && !youtubeId(c.url)) fail(`Unrecognized YouTube URL: ${c.url}`);
    if (c.poster && !safeUrl(c.poster) && !assetPath(c.poster)) fail('Poster must be an HTTPS URL or an assets/ path.');
    if (!localized(c.title,'en')) fail('Clips need an English title.');
  }
  for (const b of site.battles) {
    if (!safeUrl(b.url) || !/(^|\.)albionbb\.com$/.test(new URL(b.url).hostname)) fail('Battle URLs must be HTTPS albionbb.com links.');
    if (b.date != null && (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || Number.isNaN(Date.parse(b.date)))) fail('Battle date must be YYYY-MM-DD when provided.');
    if (!localized(b.title,'en')) fail('Battles need an English title.');
    if (b.preview && !safeUrl(b.preview) && !assetPath(b.preview)) fail('Battle preview must be an HTTPS URL or assets/ path.');
    if (b.outcome && !['victory','defeat','draw','recorded'].includes(b.outcome)) fail('Unknown battle outcome.');
    for (const key of ['kills','deaths']) if (b[key] != null && (!Number.isInteger(b[key]) || b[key] < 0)) fail(`${key} must be a nonnegative integer.`);
  }
  if (!assetPath(rewards.jerseyImage)) fail('Jersey image must be an assets/ path.');
  if (!Number.isFinite(rewards.firstToTargetSilver) || rewards.firstToTargetSilver <= 0) fail('Invalid milestone reward.');
  if (!rewards.categories?.length) fail('Add at least one reward category.');
  for (const r of rewards.categories) {
    if (!Number.isFinite(r.target) || r.target <= 0 || !r.podium?.length || r.podium.length > 3 || r.podium.some(n => !Number.isFinite(n) || n <= 0)) fail(`Invalid rewards for ${r.id}`);
  }
}
