import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { battleKey, discoverPreview } from './battle-previews.mjs';
import { safeUrl, validate } from './lib.mjs';
const site=JSON.parse(await readFile(new URL('../content/site.json',import.meta.url),'utf8'));
const rewards=JSON.parse(await readFile(new URL('../content/rewards.json',import.meta.url),'utf8'));
validate(site,rewards);
const folder=new URL('../public/assets/battles/',import.meta.url);
await mkdir(folder,{recursive:true});
const mapPath=new URL('previews.json',folder);
let previews={};
try{previews=JSON.parse(await readFile(mapPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
// An optional URL inspects/downloads a report without adding it to the public battle archive.
const inputs=process.argv[2]?[{url:process.argv[2]}]:site.battles;
for (const battle of inputs) {
 try {
  if (!safeUrl(battle.url) || !/(^|\.)albionbb\.com$/.test(new URL(battle.url).hostname)) throw Error('Expected an HTTPS AlbionBB report URL.');
  if (battle.preview?.startsWith('assets/')) continue;
  const imageUrl=await discoverPreview(battle);
  // Keep the discovered URL usable by browsers even if downloading it fails here.
  // Preserve an existing local cache when the remote image is temporarily unavailable.
  if(!previews[battle.url]?.startsWith('assets/')) previews[battle.url]=imageUrl;
  const response=await fetch(imageUrl,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`Image returned HTTP ${response.status}`);
  const type=response.headers.get('content-type')?.split(';')[0];
  const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[type];
  if(!ext)throw Error(`Unsupported image type ${type}`);
  if(Number(response.headers.get('content-length'))>10_000_000)throw Error('Preview exceeds 10 MB.');
  const reader=response.body.getReader(); const chunks=[]; let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>10_000_000){await reader.cancel();throw Error('Preview exceeds 10 MB.');}chunks.push(value);}
  const file=`${battleKey(battle.url)}.${ext}`;
  await writeFile(new URL(file,folder),Buffer.concat(chunks));
  previews[battle.url]=`assets/battles/${file}`;
  console.log(`Downloaded ${imageUrl} → public/assets/battles/${file}`);
 }catch(error){console.warn(`Preview unavailable for ${battle.url}: ${error.message}. Existing preview or report link will be used.`);}
}
await writeFile(mapPath,JSON.stringify(previews,null,2)+'\n');
