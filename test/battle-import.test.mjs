import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {groupBattles,importBattles,mergeArchive} from '../scripts/import-battles.mjs';
import {battleDetails} from '../scripts/render-battles.mjs';
import {scanBattleHistory,verifyCombinedReports} from '../scripts/fetch-battles.mjs';

const fixture=(id,minute,{team='enemy',roster=['a','b','c','d','e','f','g','h']}={})=>({
  albionId:id,startedAt:new Date(Date.UTC(2026,9,1,0,minute)).toISOString(),finishedAt:new Date(Date.UTC(2026,9,1,0,minute+1)).toISOString(),ownPlayers:roster,
  guilds:[{albionId:'oneup',name:'OneUP',alliance:'HOME',players:8,kills:3,deaths:2,killFame:1000},{albionId:team,name:team,players:10,kills:2,deaths:3,killFame:1000}]
});
test('nearby fights merge only with both roster and other-team continuity',()=>{
  assert.equal(groupBattles([fixture(2,10),fixture(1,0)],'oneup').length,1);
  assert.equal(groupBattles([fixture(1,0),fixture(2,10,{team:'different'})],'oneup').length,2);
  assert.equal(groupBattles([fixture(1,0),fixture(2,10,{roster:['i','j','k','l','m','n','o','p']})],'oneup').length,2);
  assert.equal(groupBattles([fixture(1,0),fixture(2,10,{roster:['a','b','i','j','k','l','m','n']})],'oneup').length,2);
});
test('allied guilds alone cannot make different opposing teams look related',()=>{
  const a=fixture(1,0),b=fixture(2,10,{team:'different'});
  for(const x of [a,b])x.guilds.push({albionId:'ally',name:'Ally',alliance:'HOME',players:100});
  assert.equal(groupBattles([a,b],'oneup').length,2);
});
test('time gaps and total session duration bound merges and prevent long chains',()=>{
  assert.equal(groupBattles([fixture(1,0),fixture(2,21)],'oneup').length,1);
  assert.equal(groupBattles([fixture(1,0),fixture(2,22)],'oneup').length,2);
  const groups=groupBattles([0,19,38,57,76,95].map((m,i)=>fixture(i+1,m)),'oneup');
  assert.deepEqual(groups.map(g=>g.length),[5,1]);
});
test('anchor comparison prevents gradually changing teams from merging unrelated fights',()=>{
  const a=fixture(1,0),b=fixture(2,10),c=fixture(3,20,{team:'third'});
  b.guilds[1].players=5;b.guilds.push({albionId:'third',name:'third',players:5});
  assert.deepEqual(groupBattles([a,b,c],'oneup').map(g=>g.length),[2,1]);
});

test('imports battle data without season or calendar limits',()=>{
  const old=fixture(1,0),recent=fixture(2,0);
  old.startedAt='2001-01-01T00:00:00.000Z';old.finishedAt='2001-01-01T00:01:00.000Z';
  const {reports}=importBattles({guildId:'oneup',battles:[old,recent]});
  assert.equal(reports.length,2);
  assert.ok(reports.some(b=>b.date==='2001-01-01'));
});

test('history scan exhausts pages, includes old reports, and retains cached and published IDs',async()=>{
  const rows=Array.from({length:21},(_,i)=>fixture(i+1,i));
  rows[20].startedAt='2001-01-01T00:00:00.000Z';rows[20].finishedAt='2001-01-01T00:01:00.000Z';
  const preserved=fixture(22,30),cached=fixture(23,40);
  const byId=new Map([...rows,preserved].map(b=>[b.albionId,b]));
  const config={guildId:'oneup',guildName:'OneUP',apiBaseUrl:'https://example.test',filters:{minPlayers:10,minGuildPlayers:5}};
  const calls=[];
  const fetchImpl=async url=>{
    calls.push(url);const u=new URL(url);
    let value;
    if(u.pathname==='/battles'){
      assert.deepEqual([...u.searchParams.keys()].sort(),['guildId','minGuildPlayers','minPlayers','page']);
      value=u.searchParams.get('page')==='1'?rows.slice(0,20):rows.slice(20);
    }else{
      const b=byId.get(Number(u.pathname.split('/').at(-1)));
      assert.ok(b);
      value={...b,players:b.ownPlayers.map(name=>({name,guildName:'OneUP'}))};
    }
    return new Response(JSON.stringify(value));
  };
  const source=await scanBattleHistory(config,{guildId:'oneup',battles:[cached]},[22],{fetchImpl,delayMs:0});
  assert.equal(calls.filter(url=>new URL(url).pathname==='/battles').length,2);
  assert.equal(source.battles.length,23);
  assert.ok(source.battles.some(b=>b.startedAt.startsWith('2001')));
  assert.ok(source.battles.some(b=>b.albionId===22));
  assert.ok(source.battles.some(b=>b.albionId===23));
  assert.deepEqual(source.preservedIds,[22]);
  assert.ok(!('seasonStart' in source));
});

test('non-advancing pagination fails instead of claiming a complete scan',async()=>{
  const rows=Array.from({length:20},(_,i)=>fixture(i+1,i));
  await assert.rejects(scanBattleHistory({guildId:'oneup',apiBaseUrl:'https://example.test',filters:{}},{},[],{
    fetchImpl:async()=>new Response(JSON.stringify(rows)),delayMs:0
  }),/pagination stopped advancing/);
});

test('new multi groups are verified and mismatched totals fail before publication',async()=>{
  const decisions=[{included:true,ids:[1,2],report:{kills:6,deaths:4}}];
  const source={guildId:'oneup',apiBaseUrl:'https://example.test'};
  const verified=await verifyCombinedReports(source,decisions,[],{
    fetchImpl:async()=>new Response(JSON.stringify({guilds:[{albionId:'oneup',kills:6,deaths:4}]})),delayMs:0
  });
  assert.equal(verified.length,1);
  assert.deepEqual(await verifyCombinedReports(source,decisions,verified,{fetchImpl:()=>assert.fail('Verified cache should be reused')}),verified);
  await assert.rejects(verifyCombinedReports(source,decisions,[],{
    fetchImpl:async()=>new Response(JSON.stringify({guilds:[{albionId:'oneup',kills:7,deaths:4}]})),delayMs:0
  }),/Combined stats mismatch/);
});

test('rebuilding replaces known reports, retains manual additions, and rejects partial overlap',()=>{
  const old={url:'https://europe.albionbb.com/battles/1',title:'Old'};
  const updated={...old,title:'Updated'};
  const manual={url:'https://europe.albionbb.com/battles/2',title:'Manual'};
  assert.deepEqual(mergeArchive([old,manual],[updated],[{albionId:1}]),[updated,manual]);
  assert.throws(()=>mergeArchive([{url:'https://europe.albionbb.com/battles/multi?ids=1,2'}],[updated],[{albionId:1}]),/Partially overlapping/);
});
test('battle import is traceable, preserves original IDs, has no duplicates, and matches API totals',async()=>{
  const source=JSON.parse(await readFile(new URL('../docs/battle-source.json',import.meta.url),'utf8'));
  const site=JSON.parse(await readFile(new URL('../content/site.json',import.meta.url),'utf8'));
  const {reports,decisions}=importBattles(source);
  const sourceIds=new Set(source.battles.map(b=>String(b.albionId)));
  assert.deepEqual(site.battles.filter(b=>battleDetails(b.url).ids.some(id=>sourceIds.has(id))),reports);
  assert.ok(reports.length>0);
  const ids=reports.flatMap(b=>battleDetails(b.url).ids);
  assert.equal(new Set(ids).size,ids.length);
  for(const id of source.preservedIds)assert.ok(ids.includes(String(id)));
  assert.equal(source.verifiedCombined.length,reports.filter(b=>battleDetails(b.url).combined).length);
  const byId=new Map(source.battles.map(b=>[b.albionId,b]));
  for(const d of decisions.filter(d=>d.included)){
    for(const key of ['kills','deaths'])assert.equal(d.report[key],d.ids.reduce((n,id)=>n+byId.get(id).guilds.find(g=>g.albionId===source.guildId)[key],0));
    assert.equal(d.report.outcome,'recorded');
    if(d.ids.length>1){
      const verified=source.verifiedCombined.find(v=>v.ids.join(',')===d.ids.join(','));
      assert.ok(verified);assert.equal(verified.kills,d.report.kills);assert.equal(verified.deaths,d.report.deaths);
    }
  }
  // The former multi mixed a Stability fight with B O N K fights.
  assert.ok(!reports.some(b=>[440997498,441001581,441002770].every(id=>battleDetails(b.url).ids.includes(String(id)))));
  assert.throws(()=>importBattles({...source,battles:[...source.battles,source.battles[0]]}),/Duplicate/);
});
