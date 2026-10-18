import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
const built = spawnSync(process.execPath, ['scripts/build.mjs'], { stdio:'inherit' });
if (built.status) process.exit(built.status);
const root=resolve('dist');
const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.jpg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.xml':'application/xml','.txt':'text/plain'};
http.createServer(async(req,res)=>{
 try {
  let path=resolve(root, '.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(path!==root && !path.startsWith(root+sep)){res.writeHead(403).end();return;}
  if((await stat(path)).isDirectory()) path=resolve(path,'index.html');
  const bytes=await readFile(path);
  res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
 }catch{res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'}).end(await readFile(resolve(root,'404.html')));}
}).listen(Number(process.env.PORT)||4173,'127.0.0.1',()=>console.log(`OneUP preview: http://localhost:${Number(process.env.PORT)||4173}`));
