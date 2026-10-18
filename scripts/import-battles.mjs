import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { scanBattleHistory, verifyCombinedReports } from './fetch-battles.mjs';

export const rules = Object.freeze({ maxGapMinutes: 20, maxSpanMinutes: 90, minRosterOverlap: 0.5, minTeamOverlap: 0.5, minSharedPlayers: 3, minGuildPlayers: 8, minGuildEvents: 5, minGuildFame: 1_000_000 });
const time = value => Date.parse(value);
const overlap = (a, b) => {
  const shared = [...a].reduce((n, [key, count]) => n + Math.min(count, b.get(key) || 0), 0);
  const smaller = Math.min([...a.values()].reduce((a,b)=>a+b,0), [...b.values()].reduce((a,b)=>a+b,0));
  return { shared, ratio: smaller ? shared / smaller : 0 };
};
const own = (battle, guildId) => battle.guilds.find(g => g.albionId === guildId);
const reportIds = report => {
  const u=new URL(report.url);
  return (u.pathname.includes('/multi')?(u.searchParams.get('ids')||'').split(','):[u.pathname.split('/').at(-1)]).filter(id=>/^\d+$/.test(id)).map(Number);
};

export function mergeArchive(existing, reports, battles) {
  const scannedIds=new Set(battles.map(b=>b.albionId));
  const untouched=existing.filter(b=>{
    const ids=reportIds(b);
    if (ids.some(id=>scannedIds.has(id)) && ids.some(id=>!scannedIds.has(id))) throw Error('Partially overlapping existing report needs review');
    return !ids.some(id=>scannedIds.has(id));
  });
  return [...reports,...untouched];
}
function composition(battle, guildId) {
  const guild = own(battle, guildId), teams = new Map();
  for (const g of battle.guilds) {
    if (g.albionId === guildId) continue;
    const sameAlliance = Boolean(guild.alliance && g.alliance === guild.alliance);
    if (sameAlliance) continue;
    const key = g.alliance ? `alliance:${g.alliance}` : `guild:${g.albionId}`;
    teams.set(key, (teams.get(key) || 0) + g.players);
  }
  return teams;
}

export function compatible(a, b, guildId) {
  const roster = overlap(new Map(a.ownPlayers.map(p=>[p,1])), new Map(b.ownPlayers.map(p=>[p,1])));
  const teams = overlap(composition(a,guildId), composition(b,guildId));
  if (teams.shared < rules.minSharedPlayers || teams.ratio < rules.minTeamOverlap) return false;
  return roster.shared >= rules.minSharedPlayers && roster.ratio >= rules.minRosterOverlap;
}

export function groupBattles(battles, guildId) {
  const sorted=[...battles].sort((a,b)=>time(a.startedAt)-time(b.startedAt)||a.albionId-b.albionId);
  const groups=[];
  for (const b of sorted) {
    const candidates=groups.filter(group=>{
      const last=group.at(-1), end=Math.max(...group.map(x=>time(x.finishedAt)),time(b.finishedAt));
      return time(b.startedAt)-time(last.finishedAt) <= rules.maxGapMinutes*60_000 &&
        end-time(group[0].startedAt) <= rules.maxSpanMinutes*60_000 &&
        compatible(last,b,guildId) && compatible(group[0],b,guildId);
    });
    candidates.sort((a,b)=>time(b.at(-1).finishedAt)-time(a.at(-1).finishedAt));
    if (candidates.length) candidates[0].push(b); else groups.push([b]);
  }
  return groups;
}

export function importBattles(source) {
  const { guildId, preservedIds=[], battles }=source;
  const seen=new Set();
  for (const b of battles) {
    if (!Number.isSafeInteger(b.albionId) || seen.has(b.albionId)) throw Error('Duplicate or invalid battle ID');
    seen.add(b.albionId);
    const g=own(b,guildId);
    if (!g || !Array.isArray(b.ownPlayers) || !Number.isFinite(time(b.startedAt)) || !Number.isFinite(time(b.finishedAt)) || time(b.finishedAt)<time(b.startedAt)) throw Error(`Invalid battle ${b.albionId}`);
    for (const key of ['kills','deaths','players','killFame']) if (!Number.isSafeInteger(g[key]) || g[key]<0) throw Error(`Invalid guild ${key}`);
  }
  if (preservedIds.some(id=>!seen.has(id))) throw Error('A previously archived battle is missing');
  const decisions=groupBattles(battles,guildId).map(group=>{
    const guilds=group.map(b=>own(b,guildId));
    const kills=guilds.reduce((n,g)=>n+g.kills,0), deaths=guilds.reduce((n,g)=>n+g.deaths,0);
    const peakGuildPlayers=Math.max(...guilds.map(g=>g.players));
    const killFame=guilds.reduce((n,g)=>n+g.killFame,0);
    const preserved=group.some(b=>preservedIds.includes(b.albionId));
    const included=preserved || (peakGuildPlayers>=rules.minGuildPlayers && (kills+deaths>=rules.minGuildEvents || killFame>=rules.minGuildFame));
    const ids=group.map(b=>b.albionId);
    const url=`https://europe.albionbb.com/battles/${ids.length===1?ids[0]:`multi?ids=${ids.join(',')}`}`;
    const participants=new Map();
    for (const b of group) for (const g of b.guilds) {
      const ours=own(b,guildId);
      if (g.albionId===guildId || (ours.alliance && g.alliance===ours.alliance)) continue;
      const prev=participants.get(g.albionId);
      if (!prev || prev.players<g.players) participants.set(g.albionId,g);
    }
    const names=[...participants.values()].sort((a,b)=>b.players-a.players||a.name.localeCompare(b.name)).slice(0,2).map(g=>g.name).join(' / ') || 'Battle report';
    const clock=group[0].startedAt.slice(11,16);
    const report={title:{en:`OneUP · ${names} · ${clock} UTC`,fa:`وان‌آپ · ${names} · ${clock} UTC`},date:group[0].startedAt.slice(0,10),url,outcome:'recorded',kills,deaths};
    return {ids,included,reason:preserved?'Previously archived':included?'Guild participation and activity threshold':'Below participation or activity threshold',startedAt:group[0].startedAt,finishedAt:new Date(Math.max(...group.map(b=>time(b.finishedAt)))).toISOString(),peakGuildPlayers,killFame,report};
  });
  decisions.sort((a,b)=>time(b.startedAt)-time(a.startedAt));
  if (source.verifiedCombined) for (const d of decisions.filter(d=>d.included&&d.ids.length>1)) {
    const verified=source.verifiedCombined.find(v=>v.ids.join(',')===d.ids.join(','));
    if (!verified || verified.kills!==d.report.kills || verified.deaths!==d.report.deaths) throw Error(`Combined report needs API verification: ${d.ids}`);
  }
  return {reports:decisions.filter(d=>d.included).map(d=>d.report),decisions};
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const args=process.argv.slice(2);
  if (args.some(arg=>arg!=='--offline')) throw Error('Usage: npm run import:battles [-- --offline]');
  const sourcePath=new URL('../docs/battle-source.json',import.meta.url);
  let previous={};
  try { previous=JSON.parse(await readFile(sourcePath,'utf8')); } catch(error) { if(error.code!=='ENOENT')throw error; }
  const sitePath=new URL('../content/site.json',import.meta.url);
  const site=JSON.parse(await readFile(sitePath,'utf8'));
  const preservedIds=[...new Set([...(previous.preservedIds||[]),...site.battles.flatMap(reportIds)])];
  const config=JSON.parse(await readFile(new URL('../content/battle-import.json',import.meta.url),'utf8'));
  const cachedIds=new Set((previous.battles||[]).map(b=>b.albionId));
  const offlinePreserved=[...new Set([...(previous.preservedIds||[]),...preservedIds.filter(id=>cachedIds.has(id))])];
  const source=args.includes('--offline')?{...previous,preservedIds:offlinePreserved}:await scanBattleHistory(config,previous,preservedIds,{log:console.log});
  if (!source.battles) throw Error('No saved source; run the importer online first');
  let result=importBattles(source);
  if (!args.includes('--offline')) {
    source.verifiedCombined=await verifyCombinedReports(source,result.decisions,previous.verifiedCombined,{log:console.log});
    result=importBattles(source);
  }
  const {reports,decisions}=result;
  // Replace only known IDs. Reports outside the fetched/cached history survive.
  site.battles=mergeArchive(site.battles,reports,source.battles);
  const audit={scannedAt:source.scannedAt,guildId:source.guildId,sourceUrl:source.sourceUrl,filters:source.filters,rules,scannedBattles:source.battles.length,importedReports:reports.length,importedEngagements:decisions.filter(d=>d.included).reduce((n,d)=>n+d.ids.length,0),combinedReports:decisions.filter(d=>d.included&&d.ids.length>1).length,verifiedCombinedReports:source.verifiedCombined?.length||0,decisions};
  // Fetching, grouping, and verification must all finish before saved data changes.
  await writeFile(sourcePath,JSON.stringify(source,null,2)+'\n');
  await writeFile(new URL('../docs/battle-import-audit.json',import.meta.url),JSON.stringify(audit,null,2)+'\n');
  await writeFile(sitePath,JSON.stringify(site,null,2)+'\n');
  console.log(`Imported ${audit.importedEngagements} engagements as ${reports.length} reports (${audit.combinedReports} combined).`);
}
