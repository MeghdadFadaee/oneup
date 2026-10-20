import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBattles, groupReports, makeReport, summarize, scanListings, mapLimit, normalizeName } from '../src/intel-core.js';
import { createDataSource, validateIndex, validateSnapshot, DataError } from '../src/intel-data.js';
import { collectGuild, requiredMultis, compactBattle } from '../scripts/sync-intel.mjs';
import { renderIntel } from '../scripts/render-intel.mjs';
import { readFile } from 'node:fs/promises';
import { groupBattles } from '../scripts/import-battles.mjs';

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
test('bounded active-window grouping preserves the existing real archive grouping',async()=>{
  const source=JSON.parse(await readFile(new URL('../docs/battle-source.json',import.meta.url),'utf8'));
  const rows=source.battles.map(b=>({...b,players:b.ownPlayers.map(name=>({name,guildName:b.guilds.find(g=>g.albionId===source.guildId).name}))}));
  assert.deepEqual(groupReports(rows,source.guildId).map(g=>g.map(b=>b.albionId)),groupBattles(source.battles,source.guildId).map(g=>g.map(b=>b.albionId)));
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
test('static collector fetches complete details and verified multis for all filter boundaries', async () => {
  const rows=[battle(1),battle(2,10),battle(3,20,{total:60})];
  const merged={...battle(1),guilds:[{...rows[0].guilds[0],kills:6,deaths:3,killFame:3000},rows[0].guilds[1]]};
  const pair={...battle(1),guilds:[{...rows[0].guilds[0],kills:4,deaths:2,killFame:2000},rows[0].guilds[1]]};
  const calls=[];
  const request=async(path,query={})=>{
    calls.push([path,query]);
    if(path==='/guilds/search')return [{Id:'guild',Name:'OneUP'}];
    if(path==='/battles')return rows;
    if(path==='/battles/multi')return query.ids==='1,2,3'?merged:pair;
    return rows.find(b=>path===`/battles/${b.albionId}`);
  };
  const snapshot=await collectGuild('OneUP',null,{request,asOf:'2026-10-20T12:00:00Z'});
  assert.equal(snapshot.battles.length,3);assert.equal(snapshot.coverageDays,60);
  assert.ok(snapshot.multis['1,2,3']);
  assert.equal(calls.filter(([p])=>p==='/battles').length,1);
  await assert.rejects(collectGuild('OneUP',null,{asOf:snapshot.asOf,request:async(p,q)=>p==='/battles/multi'?{...merged,guilds:[{...merged.guilds[0],kills:99}]}:request(p,q)}),/Unverified multi/);
});
test('precomputed multis cover non-default total-player thresholds and time windows',()=>{
  const rows=[battle(1,0,{total:40}),battle(2,10,{total:60}),battle(3,20,{total:80})];
  const groups=requiredMultis(rows,'guild','2026-10-20T12:00:00Z');
  assert.ok(groups.has('1,2,3'));assert.ok(groups.has('2,3'));
  for(const minimum of [1,40,41,50,60,61,80,81]){
    for(const group of groupReports(rows.filter(b=>b.totalPlayers>=minimum),'guild')) {
      if(group.length>1)assert.ok(groups.has(group.map(b=>b.albionId).join(',')));
    }
  }
  const source=battle(9);source.players.push({name:'enemy',guildName:'Enemy'});
  assert.equal(compactBattle(source,'guild').players.length,4);
  assert.equal(compactBattle(source,'guild').guilds.length,2);
});
test('static loader requests only same-origin data and validates bundle identity',async()=>{
  const entry={Id:'guild',Name:'OneUP',file:'guild-123abc.json',asOf:'2026-10-20T12:00:00Z',coverageDays:60};
  const snapshot={schemaVersion:1,guild:{Id:'guild',Name:'OneUP'},asOf:entry.asOf,coverageDays:60,battles:[battle(1)],multis:{}};
  const index={schemaVersion:1,guilds:[entry]};
  const calls=[];
  const source=createDataSource({baseUrl:'https://oneup.test/data/intel/',fetchImpl:async(url,options)=>{
    calls.push(url.href);assert.equal(url.origin,'https://oneup.test');assert.equal(options.mode,'same-origin');assert.equal(options.credentials,'omit');
    return Response.json(url.pathname.endsWith('manifest.json')?index:snapshot);
  }});
  const manifest=await source.index();assert.deepEqual(manifest,index);
  assert.deepEqual(await source.load(manifest.guilds[0]),snapshot);
  await source.load(entry);assert.equal(calls.length,2);
  assert.throws(()=>validateIndex({...index,guilds:[{...entry,file:'../../evil.json'}]}),DataError);
  assert.throws(()=>validateSnapshot({...snapshot,guild:{Id:'other'}},entry),DataError);
  assert.throws(()=>validateSnapshot({...snapshot,battles:[battle(1),battle(1)]},entry),DataError);
});
test('missing files and cancellation cannot masquerade as empty reports',async()=>{
  const source=createDataSource({baseUrl:'https://oneup.test/data/intel/',fetchImpl:async()=>new Response('',{status:404})});
  await assert.rejects(source.index(),error=>error.code==='missing');
  const controller=new AbortController();controller.abort();
  await assert.rejects(source.index(controller.signal),{name:'AbortError'});
});
test('published real datasets contain every required multi and verified guild totals',async()=>{
  const directory=new URL('../public/data/intel/',import.meta.url);
  const index=validateIndex(JSON.parse(await readFile(new URL('manifest.json',directory),'utf8')));
  assert.ok(index.guilds.some(g=>normalizeName(g.Name)==='oneup'));
  for(const entry of index.guilds){
    const snapshot=validateSnapshot(JSON.parse(await readFile(new URL(entry.file,directory),'utf8')),entry);
    for(const [key,group] of requiredMultis(snapshot.battles,entry.Id,snapshot.asOf)){
      const multi=snapshot.multis[key];assert.ok(multi,`Missing multi ${key}`);
      for(const field of ['kills','deaths','killFame']){
        assert.equal(multi.guilds.find(g=>g.albionId===entry.Id)[field],group.reduce((sum,b)=>sum+b.guilds.find(g=>g.albionId===entry.Id)[field],0));
      }
    }
  }
});
test('bilingual static page exposes prepared guilds and contains no proxy setup',()=>{
  for(const lang of ['en','fa']){
    const html=renderIntel(lang,'https://oneup.test');
    assert.match(html,new RegExp(`<html lang="${lang}" dir="${lang==='fa'?'rtl':'ltr'}">`));
    assert.match(html,/value="7" checked/);assert.match(html,/value="30"/);assert.match(html,/value="60"/);
    assert.match(html,/id="snapshot-status"/);assert.match(html,/id="prepared-guilds"/);
    assert.ok(!html.includes('undefined'));assert.ok(!html.includes('/api/albion'));
    assert.ok(!html.includes('connection-form'));assert.ok(!html.includes('apiKey'));
  }
  assert.match(renderIntel('en','https://oneup.test'),/All guilds combined, before merging/);
  assert.match(renderIntel('fa','https://oneup.test'),/مجموع بازیکنان همهٔ گیلدها/);
});
