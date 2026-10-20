import test from 'node:test';
import assert from 'node:assert/strict';
import {readPageData,readBattlePage,readListingPage,createPageClient,fetchPublicPage} from '../scripts/scrape-intel.mjs';

const report={albionId:123,startedAt:'2026-10-20T12:00:00Z',finishedAt:'2026-10-20T12:01:00Z',totalPlayers:40,totalFame:100001,
  guilds:[{albionId:'guild',name:'OneUP',players:4,kills:2,deaths:1,killFame:100001}],
  players:[{name:'Player',guildName:'OneUP',role:'tank',weapon:{name:'2H_MACE',type:'T8_2H_MACE',quality:4}}]};
function page(data) {
  const values=[['ShallowReactive',1],{data:2},['ShallowReactive',3],{}];
  function store(value) {
    const index=values.length;values.push(null);
    values[index]=Array.isArray(value)?value.map(store):value && typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,v])=>[key,store(v)])):value;
    return index;
  }
  for(const [key,value] of Object.entries(data))values[3][key]=store(value);
  return `<html><script>throw new Error('must never execute page code')</script><script data-nuxt-data="nuxt-app" id="__NUXT_DATA__" type="application/json">${JSON.stringify(values)}</script></html>`;
}
test('HTML scraper decodes exact fame, roster, weapon and role from server-rendered data',()=>{
  const html=page({'$arbitrary-build-key':report});
  assert.deepEqual(readBattlePage(html),report);
  assert.deepEqual(readPageData(html),[report]);
  assert.deepEqual(readListingPage(page({identity:{name:'OneUP'},'$other-key':[report]})),[report]);
  assert.deepEqual(readListingPage(page({'$empty-key':[]})),[]);
});
test('scraper rejects missing, malformed or incompatible payloads instead of empty success',()=>{
  assert.throws(()=>readBattlePage('<html>Access denied</html>'),/server-rendered data/);
  assert.throws(()=>readListingPage(page({unrelated:{message:'API unavailable'}})),/listing missing/);
  assert.throws(()=>readBattlePage(page({'$key':[report]})),/Battle data missing/);
  const bad=page({x:report}).replace(/"albionId":\d+/,'"albionId":999999');
  assert.throws(()=>readPageData(bad),/out of bounds/);
});
test('page client retrieves listings, single and multi reports using only public website URLs',async()=>{
  const calls=[];
  const request=createPageClient({knownGuilds:[{Id:'guild',Name:'OneUP',file:'private-cache-detail.json'}],fetchPage:async url=>{
    calls.push(url);
    assert.equal(url.origin,'https://europe.albionbb.com');
    return page({data:url.pathname.endsWith('/battles')?[report]:report});
  }});
  assert.deepEqual(await request('/guilds/search',{search:'OneUP'}),[{Id:'guild',Name:'OneUP'}]);
  assert.equal(calls.length,0);
  assert.deepEqual(await request('/battles',{guildId:'guild',minPlayers:40,minGuildPlayers:1,page:2}),[report]);
  assert.equal(calls[0].pathname,'/guilds/guild/battles');assert.equal(calls[0].searchParams.get('minPlayers'),'40');
  assert.equal(calls[0].searchParams.get('page'),'2');
  assert.deepEqual(await request('/battles/123'),report);
  assert.deepEqual(await request('/battles/multi',{ids:'123,124'}),report);
  assert.equal(calls.at(-1).pathname,'/battles/multi');assert.equal(calls.at(-1).searchParams.get('ids'),'123,124');
  assert.ok(calls.every(url=>!url.hostname.startsWith('api.')));
});
test('new guild discovery reads public search and detail pages with encoded names',async()=>{
  const calls=[];
  const request=createPageClient({fetchPage:async url=>{
    calls.push(url);return page({data:url.pathname==='/'?[report]:report});
  }});
  assert.deepEqual(await request('/guilds/search',{search:'OneUP'}),[{Id:'guild',Name:'OneUP'}]);
  assert.equal(calls[0].pathname,'/');assert.equal(calls[0].searchParams.get('search'),'OneUP');
  assert.equal(calls[1].pathname,'/battles/123');
});
test('HTML requests stop on access/rate restrictions and never fetch another origin',async()=>{
  for(const status of [403,429]){
    let calls=0;
    await assert.rejects(fetchPublicPage(new URL('https://europe.albionbb.com/battles/123'),async()=>{
      calls++;return new Response('',{status});
    }),new RegExp(`HTTP ${status}`));
    assert.equal(calls,1);
  }
  await assert.rejects(fetchPublicPage(new URL('https://unrelated.test')),/Unsupported page origin/);
});
