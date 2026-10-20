import { readFile, writeFile, mkdir, rename, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { fetchJson } from './fetch-battles.mjs';
import { groupReports, ownGuild, ownPlayers, normalizeName, selectBattles, scanListings, mapLimit } from '../src/intel-core.js';
import { validateIndex } from '../src/intel-data.js';

const API = 'https://api.albionbb.com/eu';
export const groupKey = ids => [...ids].map(Number).sort((a,b)=>a-b).join(',');
export function compactBattle(raw, guildId) {
  const guild = ownGuild(raw,guildId);
  if (!guild || !Array.isArray(raw.players) || !Number.isFinite(Date.parse(raw.startedAt)) || !Number.isFinite(Date.parse(raw.finishedAt))) throw Error('Incomplete guild report');
  return {
    albionId:raw.albionId,startedAt:raw.startedAt,finishedAt:raw.finishedAt,
    totalFame:raw.totalFame,totalKills:raw.totalKills,totalPlayers:raw.totalPlayers,
    guilds:raw.guilds,players:ownPlayers(raw,guildId),
  };
}
export function requiredMultis(battles, guildId, asOf) {
  const needed = new Map(), until = Date.parse(asOf);
  // Every attendance value changes inclusion only at one of these boundaries.
  // Preload multi reports for ALL supported day windows and player thresholds.
  for (const days of [7,30,60]) {
    const rows = selectBattles(battles,guildId,{since:until-days*86_400_000,until,minPlayers:1});
    const thresholds = new Set([1,...rows.map(b=>b.totalPlayers+1)]);
    for (const minPlayers of thresholds) {
      for (const group of groupReports(rows.filter(b=>b.totalPlayers>=minPlayers),guildId)) {
        if (group.length>1) needed.set(groupKey(group.map(b=>b.albionId)),group);
      }
    }
  }
  return needed;
}
export async function collectGuild(name, previous, {request,asOf=new Date().toISOString(),log=()=>{}}) {
  const candidates = await request('/guilds/search',{search:name});
  const matches = candidates.filter(g=>normalizeName(g.Name)===normalizeName(name));
  if (matches.length!==1) throw Error(`Expected one exact Europe guild match for ${name}; found ${matches.length}`);
  const guild = matches[0], until = Date.parse(asOf), since = until-60*86_400_000;
  if (!/^[\w-]{1,64}$/.test(guild.Id)) throw Error('Invalid guild identity');
  const listings = await scanListings(request,guild.Id,since,undefined,(page,count)=>log(`${guild.Name}: history page ${page}, ${count} battles`));
  const cached = new Map((previous?.guild?.Id===guild.Id?previous.battles||[]:[]).map(b=>[b.albionId,b]));
  let done = 0;
  const battles = await mapLimit(listings.filter(b=>Date.parse(b.startedAt)<=until),3,async row=>{
    const old = cached.get(row.albionId);
    const raw = old && until-Date.parse(row.startedAt)>86_400_000 ? old : await request(`/battles/${row.albionId}`);
    if (raw.albionId!==row.albionId) throw Error('Mismatched battle ID');
    const detail = compactBattle(raw,guild.Id);
    if (++done%25===0 || done===listings.length) log(`${guild.Name}: details ${done}/${listings.length}`);
    return detail;
  });
  const required = requiredMultis(battles,guild.Id,asOf), multis = {};
  log(`${guild.Name}: ${required.size} unique combined reports across all filters`);
  done = 0;
  await mapLimit([...required],2,async([key,group])=>{
    const old = previous?.guild?.Id===guild.Id && previous.multis?.[key];
    const fresh = group.some(b=>until-Date.parse(b.startedAt)<86_400_000);
    const raw = old && !fresh ? old : await request('/battles/multi',{ids:key});
    const total = ownGuild(raw,guild.Id);
    for (const field of ['kills','deaths','killFame']) {
      if (total?.[field]!==group.reduce((sum,b)=>sum+(ownGuild(b,guild.Id)[field]||0),0)) throw Error(`Unverified multi ${key}: ${field}`);
    }
    multis[key] = compactBattle(raw,guild.Id);
    if (++done%10===0 || done===required.size) log(`${guild.Name}: combined reports ${done}/${required.size}`);
  });
  return {schemaVersion:1,guild,asOf,coverageDays:60,battles,multis};
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const directory = new URL('../public/data/intel/',import.meta.url);
  await mkdir(directory,{recursive:true});
  let manifest = {schemaVersion:1,guilds:[]};
  try { manifest=validateIndex(JSON.parse(await readFile(new URL('manifest.json',directory),'utf8'))); } catch(error) { if(error.code!=='ENOENT')throw error; }
  const configured = JSON.parse(await readFile(new URL('../content/intel-guilds.json',import.meta.url),'utf8'));
  const supplied = process.env.INTEL_GUILD_NAME?.trim();
  const names = [...new Map([...configured,...manifest.guilds.map(g=>g.Name),...(supplied?[supplied]:[])].map(name=>[normalizeName(name),name.trim()])).values()];
  let nextStart = 0;
  const request = async(path,query={})=>{
    const start = Math.max(Date.now(),nextStart); nextStart = start+220;
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,start-Date.now())));
    const url = new URL(API+path);
    for (const [key,value] of Object.entries(query)) url.searchParams.set(key,value);
    return fetchJson(url);
  };
  const entries = [], asOf = new Date().toISOString();
  for (const name of names) {
    const old = manifest.guilds.find(g=>normalizeName(g.Name)===normalizeName(name));
    let previous;
    if (old) previous=JSON.parse(await readFile(new URL(old.file,directory),'utf8'));
    const snapshot = await collectGuild(name,previous,{request,asOf,log:console.log});
    const json = JSON.stringify(snapshot);
    const digest = createHash('sha256').update(json).digest('hex').slice(0,12);
    const file = `${snapshot.guild.Id}-${digest}.json`;
    await writeFile(new URL(file,directory),json+'\n');
    entries.push({...snapshot.guild,file,asOf,coverageDays:60,battleCount:snapshot.battles.length});
  }
  const result = {schemaVersion:1,updatedAt:asOf,guilds:entries};
  await writeFile(new URL('manifest.json.tmp',directory),JSON.stringify(result,null,2)+'\n');
  await rename(new URL('manifest.json.tmp',directory),new URL('manifest.json',directory));
  const retained = new Set(['manifest.json',...entries.map(g=>g.file)]);
  for (const file of await readdir(directory)) {
    if (/^[\w-]+\.json$/.test(file) && !retained.has(file)) await rm(new URL(file,directory));
  }
  console.log(`Published ${entries.length} complete guild datasets in public/data/intel/`);
}
