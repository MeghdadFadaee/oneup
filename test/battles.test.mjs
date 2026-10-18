import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { battleDetails, renderBattleCards } from '../scripts/render-battles.mjs';
import { directPreview, discoverPreview } from '../scripts/battle-previews.mjs';

const translations=JSON.parse(await readFile(new URL('../content/translations.json',import.meta.url),'utf8'));
const single={title:{en:'A single fight',fa:'یک نبرد'},url:'https://europe.albionbb.com/battles/448776222'};
const combined={title:{en:'A campaign',fa:'مجموعه نبردها'},url:'https://europe.albionbb.com/battles/multi?ids=448776222,441001581,440997498'};
const render=(battles,lang='en',previews={})=>renderBattleCards({battles,lang,previews,base:lang==='fa'?'../':'./',t:translations[lang],icon:()=>'<svg aria-hidden="true"></svg>'});

test('reports use direct images without a cache and keep artwork for unavailable previews',()=>{
  for(const lang of ['en','fa']){
    const html=render([single,combined],lang);
    assert.equal((html.match(/class="battle-art"/g)||[]).length,2);
    assert.equal((html.match(/class="battle-terrain"/g)||[]).length,2);
    assert.match(html,/battle-card--single/);
    assert.match(html,/battle-card--campaign/);
    assert.ok(html.includes(single.title[lang]));
    assert.ok(html.includes(combined.title[lang]));
    assert.match(html,/#441001581/);
    assert.equal((html.match(/class="battle-report-image"/g)||[]).length,2);
    assert.match(html,/src="https:\/\/api.albionbb.com\/eu\/preview\/448776222"/);
    assert.match(html,/src="https:\/\/api.albionbb.com\/eu\/preview\/multi\?ids=448776222,441001581,440997498"/);
    assert.ok(!html.includes('battle-card-stats'));
    assert.ok(!html.includes('<time'));
    assert.ok(!html.includes('undefined'));
  }
});

test('Europe single and combined reports resolve to their respective preview routes',()=>{
  assert.equal(directPreview(single.url),'https://api.albionbb.com/eu/preview/448776222');
  assert.equal(directPreview(single.url+'/'),'https://api.albionbb.com/eu/preview/448776222');
  assert.equal(directPreview(combined.url),'https://api.albionbb.com/eu/preview/multi?ids=448776222,441001581,440997498');
  assert.equal(directPreview('https://europe.albionbb.com/battles/multi?ids=441002770%2C441001581%2C440997498'),'https://api.albionbb.com/eu/preview/multi?ids=441002770,441001581,440997498');
  assert.equal(directPreview('https://europe.albionbb.com/battles/multi/?ids=441002770,441001581'),'https://api.albionbb.com/eu/preview/multi?ids=441002770,441001581');
  assert.equal(directPreview('https://europe.albionbb.com/battles/multi'),null);
  assert.equal(directPreview('https://europe.albionbb.com/battles/multi?ids=441002770,invalid'),null);
  assert.equal(directPreview('https://albionbb.com/battles/448776222'),null);
  assert.equal(directPreview('https://europe.albionbb.com.evil.test/battles/448776222'),null);
  assert.equal(directPreview('invalid'),null);
});

test('automatic discovery prefers report metadata over a derived endpoint',async()=>{
  const image='https://api.albionbb.com/eu/preview/new-format';
  const fetchPage=async url=>{
    assert.equal(url,single.url);
    return new Response(`<meta name="twitter:image" content="${image}">`);
  };
  assert.equal(await discoverPreview(single,fetchPage),image);
});

test('combined reports discover their own preview and overrides skip metadata fetching',async()=>{
  const fetchPage=async()=>new Response('<meta property="og:image" content="/combined-preview.png">');
  assert.equal(await discoverPreview(combined,fetchPage),'https://europe.albionbb.com/combined-preview.png');
  assert.equal(await discoverPreview({...single,preview:'https://example.com/override.png'},()=>{throw Error('Should not fetch metadata');}),'https://example.com/override.png');
});

test('discovery falls back to single and combined endpoints when report metadata is unavailable',async()=>{
  const offline=async()=>{throw Error('Offline');};
  assert.equal(await discoverPreview(single,offline),'https://api.albionbb.com/eu/preview/448776222');
  assert.equal(await discoverPreview(single,async()=>new Response('<html>No image metadata</html>')),'https://api.albionbb.com/eu/preview/448776222');
  assert.equal(await discoverPreview(combined,offline),'https://api.albionbb.com/eu/preview/multi?ids=448776222,441001581,440997498');
  assert.equal(await discoverPreview(combined,async()=>new Response('<html>No metadata</html>')),'https://api.albionbb.com/eu/preview/multi?ids=448776222,441001581,440997498');
  await assert.rejects(discoverPreview({url:'https://albionbb.com/battles/multi?ids=1,2'},offline),/Offline/);
});

test('combined reports deduplicate battle IDs when counting recorded engagements',()=>{
  assert.deepEqual(battleDetails(combined.url).ids,['448776222','441001581','440997498']);
  const html=render([single,combined]);
  assert.match(html,/<strong>2<\/strong><span>Archived reports/);
  assert.match(html,/<strong>3<\/strong><span>Recorded engagements/);
});

test('previews retain underlying artwork and verified zero values remain visible',()=>{
  const battle={...single,preview:'https://example.com/preview.png',kills:0,deaths:7,date:'2026-10-18'};
  const html=render([battle],'fa',{[battle.url]:'assets/battles/cached.png'});
  assert.match(html,/src="\.\.\/assets\/battles\/cached.png"/);
  assert.match(html,/data-battle-preview/);
  assert.match(html,/class="battle-terrain"/);
  assert.match(html,/<dd>۰<\/dd>/);
  assert.match(html,/<dd>۷<\/dd>/);
  assert.match(html,/datetime="2026-10-18"/);
  assert.match(render([battle]),/https:\/\/example.com\/preview.png/);
});

test('empty archives stay empty and report titles are escaped',()=>{
  assert.equal(render([]),'');
  const html=render([{...single,title:'<script>alert("x")</script>'}]);
  assert.ok(!html.includes('<script>'));
  assert.match(html,/&lt;script&gt;/);
});

test('large archives expose twelve initial cards and keep older cards in a native disclosure',()=>{
  const battles=Array.from({length:15},(_,i)=>({...single,title:`Fight ${i}`,date:`2026-10-${String(i+1).padStart(2,'0')}`}));
  for(const lang of ['en','fa']){
    const html=render(battles,lang);
    const [visible,older]=html.split('<details class="battle-ledger battle-more">');
    assert.equal((visible.match(/<article /g)||[]).length,12);
    assert.equal((older.match(/<article /g)||[]).length,3);
    assert.ok(visible.includes('Fight 14'));assert.ok(older.includes('Fight 0'));
    assert.ok(!html.includes('undefined'));
  }
});
