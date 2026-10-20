import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, cp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { escapeHtml, youtubeId, validate } from '../scripts/lib.mjs';
import { socialImage, battleKey } from '../scripts/battle-previews.mjs';
const site=JSON.parse(await readFile(new URL('../content/site.json',import.meta.url)));
const rewards=JSON.parse(await readFile(new URL('../content/rewards.json',import.meta.url)));
test('editable guild and reward content passes publication validation',()=>{
 validate(site,rewards);
 assert.equal(new Set(rewards.categories.map(c=>c.id)).size,rewards.categories.length);
});
test('YouTube parsing accepts supported URLs and rejects lookalike domains',()=>{
 for(const u of ['https://youtu.be/dQw4w9WgXcQ','https://www.youtube.com/watch?v=dQw4w9WgXcQ','https://youtube.com/shorts/dQw4w9WgXcQ','https://youtube.com/live/dQw4w9WgXcQ']) assert.equal(youtubeId(u),'dQw4w9WgXcQ');
 for(const u of ['javascript:alert(1)','https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ','https://youtube.com/watch?v=bad']) assert.equal(youtubeId(u),null);
 assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');
});
test('content validation rejects unsafe links and image paths',()=>{
 for(const url of ['javascript:alert(1)','http://example.com']) assert.throws(()=>validate({...site,socials:[{name:'bad',url}]},rewards));
 assert.throws(()=>validate({...site,battles:[{url:'https://albionbb.com.evil.test/battles/1'}]},rewards));
 assert.throws(()=>validate({...site,clips:[{title:'test',type:'direct',url:'https://example.com/test.mp4',poster:'assets/../../private'}]},rewards));
});
test('battle preview metadata supports Twitter, Open Graph, attribute order and relative URLs',()=>{
 const page='https://europe.albionbb.com/battles/448776222';
 assert.equal(socialImage('<meta content="/image.png?a=1&amp;b=2" name="twitter:image">',page),'https://europe.albionbb.com/image.png?a=1&b=2');
 assert.equal(socialImage("<meta property='og:image' content='https://example.com/battle.jpg'>",page),'https://example.com/battle.jpg');
 assert.equal(socialImage('<meta name="twitter:image" content="javascript:alert(1)">',page),null);
 assert.equal(socialImage('<html>No image</html>',page),null);
 assert.equal(battleKey(page),'europe.albionbb.com-448776222');
 const combined='https://europe.albionbb.com/battles/multi?ids=441002770,441001581,440997498';
 const otherCombined='https://europe.albionbb.com/battles/multi?ids=441002770,441001581';
 assert.notEqual(battleKey(combined),battleKey(otherCombined));
 assert.equal(battleKey(combined),battleKey(combined));
});
test('static output includes indexable bilingual content, metadata, and domain files',async()=>{
 const result=spawnSync(process.execPath,['scripts/build.mjs'],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 const read=p=>readFile(new URL(`../dist/${p}`,import.meta.url),'utf8');
 const [en,fa,sitemap,cname,robots]=await Promise.all(['index.html','fa/index.html','sitemap.xml','CNAME','robots.txt'].map(read));
 assert.match(en,/<html lang="en" dir="ltr">/);
 assert.match(fa,/<html lang="fa" dir="rtl">/);
 for(const html of [en,fa]){
  assert.match(html,/application\/ld\+json/);assert.match(html,/hreflang="fa"/);assert.match(html,/rel="canonical"/);
  assert.match(html,/og:image/);assert.match(html,/twitter:image/);
  assert.equal((html.match(/<h1 /g)||[]).length,1);
  assert.match(html,/id="rewards"/);
  const archive=html.match(/<section id="battles"[\s\S]*?<\/section>/)[0];
  assert.equal((archive.match(/<article /g)||[]).length,Math.min(6,site.battles.length));
  assert.equal((archive.match(/<tr>/g)||[]).length,site.battles.length+1);
  assert.ok(!archive.includes('battle-more'));
  assert.ok(!html.includes('undefined'));assert.ok(!html.includes('javascript:'));
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size);
 }
 assert.match(fa,/\.\.\/assets\/styles\.css/);
 assert.match(sitemap,/\/fa\//);assert.equal(cname.trim(),new URL(site.siteUrl).hostname);
 assert.match(robots,/Sitemap:/);
});
test('populated archive builds YouTube and direct clips, battle previews, and verified stats in both languages',async()=>{
 const fixture=await mkdtemp(join(tmpdir(),'oneup-content-'));
 try {
  for(const file of ['scripts','content','src','public','package.json']) await cp(new URL(`../${file}`,import.meta.url),join(fixture,file),{recursive:true});
  const configured=structuredClone(site);
  configured.socials[0].url='https://discord.gg/example';
  configured.clips=[
   {title:{en:'YouTube fight',fa:'نبرد یوتیوب'},type:'youtube',url:'https://youtu.be/dQw4w9WgXcQ'},
   {title:'Direct fight',type:'direct',url:'https://example.com/fight.mp4',poster:'assets/logo.jpg'}
  ];
  configured.battles=[{title:{en:'Test battle',fa:'نبرد آزمایشی'},date:'2026-10-18',url:'https://europe.albionbb.com/battles/448776222',preview:'assets/logo.jpg',kills:42,deaths:7,outcome:'victory'}];
  await writeFile(join(fixture,'content/site.json'),JSON.stringify(configured));
  const result=spawnSync(process.execPath,['scripts/build.mjs'],{cwd:fixture,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  for(const path of ['index.html','fa/index.html']){
   const html=await readFile(join(fixture,'dist',path),'utf8');
   assert.match(html,/battle-card-grid/);assert.match(html,/battle-table/);assert.match(html,/data-video-type="youtube"/);
   assert.match(html,/data-video-type="direct"/);assert.match(html,/discord.gg\/example/);assert.match(html,/2026-10-18/);
   assert.ok(!html.includes('undefined'));
   assert.match(html,/hqdefault.jpg/);
  }
 }finally{await rm(fixture,{recursive:true,force:true});}
});
