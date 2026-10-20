import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBattles, groupReports, makeReport, summarize, scanListings, mapLimit, normalizeName } from '../src/intel-core.js';
import { proxyAlbion, upstreamUrl } from '../scripts/albion-proxy.mjs';
import { renderIntel } from '../scripts/render-intel.mjs';

const battle = (id, minute = 0, options = {}) => ({
  albionId:id, startedAt:new Date(Date.UTC(2026,9,20,10,minute)).toISOString(), finishedAt:new Date(Date.UTC(2026,9,20,10,minute+2)).toISOString(),
  totalPlayers:options.total ?? 40,
  guilds:[{ albionId:'guild', name:'OneUP', players:4, kills:2, deaths:1, killFame:1000 }, { albionId:options.enemy || 'enemy', name:'Enemy', players:36 }],
  players:['a','b','c','d'].map(name => ({ name,guildName:'OneUP',role:'healer',kills:0,deaths:0,killFame:250,deathFame:50,ip:1500,weapon:{name:'MAIN_HOLYSTAFF',type:'T6_MAIN_HOLYSTAFF'} })),
});
test('minimum attendance is ALL players, inclusive, and applied before merging', () => {
  const rows = [battle(1,0,{total:39}),battle(2,1,{total:40}),battle(3,2,{total:41})];
  const chosen = selectBattles(rows,'guild',{since:Date.UTC(2026,9,20),until:Date.UTC(2026,9,21),minPlayers:40});
  assert.deepEqual(chosen.map(b => b.albionId),[2,3]);
  assert.equal(chosen[0].guilds[0].players,4);
  assert.deepEqual(groupReports(chosen,'guild')[0].map(b=>b.albionId),[2,3]);
});
test('rolling date boundaries include the exact start and exclude older or future records', () => {
  const row = battle(1), since = Date.parse(row.startedAt), until = since+1000;
  const before = {...row,albionId:2,startedAt:new Date(since-1).toISOString()};
  const future = {...row,albionId:3,startedAt:new Date(until+1).toISOString()};
  assert.deepEqual(selectBattles([before,row,future],'guild',{since,until,minPlayers:1}),[row]);
});
test('merge requires time, roster AND other-team continuity and supports disabled merging', () => {
  const a=battle(1),b=battle(2,10),c=battle(3,15,{enemy:'unrelated'}),d=battle(4,40);
  assert.deepEqual(groupReports([d,b,c,a,a],'guild').map(g=>g.map(b=>b.albionId)),[[1,2],[3],[4]]);
  assert.equal(groupReports([a,b],'guild',false).length,2);
  b.players=b.players.map(p=>({...p,name:`other-${p.name}`}));
  assert.equal(groupReports([a,b],'guild').length,2);
});
test('summary uses merged roster once, maintains exact fame and recovers end time from originals', () => {
  const a=battle(1),b=battle(2,10),combined=battle(1);
  combined.finishedAt=a.finishedAt;
  combined.guilds[0]={...combined.guilds[0],kills:4,deaths:2,killFame:2000};
  const report=makeReport([a,b],combined,'guild');
  assert.equal(report.finishedAt,b.finishedAt);
  assert.match(report.url,/multi\?ids=1,2/);
  const s=summarize([report]);
  assert.equal(s.roles.healer,4);assert.equal(s.killFame,2000);assert.equal(s.deathFame,200);
  assert.equal(s.averageAttendance,4);assert.equal(s.averageIp,1500);assert.equal(s.players.size,4);
  assert.equal([...s.weapons.values()][0].count,4);
  combined.players[0].ip=0;
  assert.equal(summarize([report]).averageIp,1500);
});
test('scan paginates through a date boundary and sends total-player filter to API', async () => {
  const recent=Array.from({length:20},(_,i)=>battle(i+1,i));
  const old={...battle(21),startedAt:'2026-01-01T00:00:00Z'};
  const calls=[];
  const rows=await scanListings(async(path,query)=>{
    calls.push(query);assert.equal(path,'/battles');assert.equal(query.minPlayers,40);assert.equal(query.minGuildPlayers,1);
    return query.page===1?recent:[old];
  },'guild',Date.UTC(2026,9,19),undefined,()=>{},40);
  assert.equal(calls.length,2);assert.equal(rows.length,20);
  await assert.rejects(scanListings(async()=>recent,'guild',0),/Pagination stopped advancing/);
});
test('battle-mount composition counts the mount instead of the rider weapon', () => {
  const b=battle(1);
  b.players[0]={...b.players[0],role:'battlemount',mount:'T8_MOUNT_MAMMOTH_BATTLE'};
  const s=summarize([makeReport([b],null,'guild')]);
  assert.equal(s.roles.battlemount,1);
  assert.equal(s.weapons.get('battlemount:T8_MOUNT_MAMMOTH_BATTLE').count,1);
  assert.equal(s.weapons.get('healer:MAIN_HOLYSTAFF').count,3);
});
test('bounded concurrency preserves order and propagates failures', async () => {
  let active=0,peak=0;
  const out=await mapLimit([1,2,3,4,5],2,async n=>{
    peak=Math.max(peak,++active);await new Promise(resolve=>setTimeout(resolve,5));active--;return n*2;
  });
  assert.deepEqual(out,[2,4,6,8,10]);assert.equal(peak,2);
  await assert.rejects(mapLimit([1,2],1,async()=>{throw Error('failed report');}),/failed report/);
});
test('proxy only permits public whitelisted read endpoints and strips browser headers', async () => {
  assert.throws(()=>upstreamUrl('https://oneup.test/api/albion/https://evil.test'));
  assert.throws(()=>upstreamUrl('https://oneup.test/api/albion/battles?url=https://evil.test'));
  assert.throws(()=>upstreamUrl('https://oneup.test/api/albion/battles/multi?ids=1,evil'));
  assert.equal(upstreamUrl('https://oneup.test/api/albion/guilds/search?search=OneUP').hostname,'api.albionbb.com');
  const request=new Request('https://oneup.test/api/albion/battles/123',{headers:{Authorization:'private',Cookie:'private'}});
  const result=await proxyAlbion(request,async(url,options)=>{
    assert.equal(url.href,'https://api.albionbb.com/eu/battles/123');
    assert.deepEqual(options.headers,{Accept:'application/json'});
    return Response.json({albionId:123});
  });
  assert.deepEqual(await result.json(),{albionId:123});
  assert.equal((await proxyAlbion(new Request(request.url,{method:'POST'}))).status,405);
  assert.equal((await proxyAlbion(request,async()=>new Response('',{status:429}))).status,429);
});
test('bilingual page has accessible filters, correct total-player copy and escaped configuration', () => {
  assert.equal(normalizeName('  OneUP  '),'oneup');
  for(const lang of ['en','fa']){
    const html=renderIntel(lang,'https://oneup.test','/api/albion');
    assert.match(html,new RegExp(`<html lang="${lang}" dir="${lang==='fa'?'rtl':'ltr'}">`));
    assert.match(html,/value="7" checked/);assert.match(html,/value="30"/);assert.match(html,/value="60"/);
    assert.match(html,/aria-live="polite"/);assert.match(html,/id="min-help"/);
    assert.ok(!html.includes('undefined'));
  }
  assert.match(renderIntel('en','https://oneup.test'),/All guilds combined, before merging/);
  assert.match(renderIntel('fa','https://oneup.test'),/مجموع بازیکنان همهٔ گیلدها/);
});
