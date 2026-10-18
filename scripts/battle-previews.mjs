import { safeUrl } from './lib.mjs';
import { createHash } from 'node:crypto';
const decode = value => value.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
// Europe preview routes supplied from AlbionBB's Twitter metadata.
export function directPreview(url) {
 try {
  const u=new URL(url);
  if(u.protocol!=='https:'||u.hostname!=='europe.albionbb.com') return null;
  if(/^\/battles\/multi\/?$/.test(u.pathname)){
   const ids=u.searchParams.get('ids');
   return /^\d+(?:,\d+)*$/.test(ids||'')?`https://api.albionbb.com/eu/preview/multi?ids=${ids}`:null;
  }
  const id=u.pathname.match(/^\/battles\/(\d+)\/?$/)?.[1];
  return id?`https://api.albionbb.com/eu/preview/${id}`:null;
 } catch { return null; }
}
export function socialImage(html, pageUrl) {
  const images = new Map();
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = {};
    for (const a of tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[a[1].toLowerCase()] = decode(a[2]??a[3]??a[4]);
    const key=(attrs.property||attrs.name||'').toLowerCase();
    if (attrs.content) images.set(key,attrs.content);
  }
  const value=images.get('twitter:image')||images.get('twitter:image:src')||images.get('og:image:secure_url')||images.get('og:image');
  if (!value) return null;
  try { const url=new URL(value,pageUrl).href; return safeUrl(url)?url:null; } catch { return null; }
}
export async function discoverPreview(battle, fetchImpl=fetch) {
  if (battle.preview) return battle.preview;
  let metadataError;
  try {
    const page=await fetchImpl(battle.url,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'OneUP-Guild-Preview/1.0'}});
    if (!page.ok) throw Error(`Report returned HTTP ${page.status}`);
    const discovered=socialImage(await page.text(),battle.url);
    if (discovered) return discovered;
  } catch(error) { metadataError=error; }
  const fallback=directPreview(battle.url);
  if (fallback) return fallback;
  throw metadataError||Error('No Twitter/Open Graph preview found for this report.');
}
export function battleKey(url) {
 const u=new URL(url);
 const queryKey=u.search?`-${createHash('sha256').update(u.search).digest('hex').slice(0,16)}`:'';
 return `${u.hostname.replace(/[^a-z0-9.-]/gi,'-')}-${u.pathname.split('/').filter(Boolean).pop().replace(/[^a-z0-9-]/gi,'-')}${queryKey}`;
}
