const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));

export async function fetchJson(url, fetchImpl=fetch) {
  for (let attempt=0;attempt<3;attempt++) {
    try {
      const response=await fetchImpl(url,{signal:AbortSignal.timeout(30_000)});
      if (!response.ok) throw Error(`AlbionBB returned HTTP ${response.status}: ${url}`);
      return await response.json();
    } catch (error) {
      if (attempt===2) throw error;
      await pause(1000*(attempt+1));
    }
  }
}

export async function scanBattleHistory(config, previous={}, preservedIds=[], {fetchImpl=fetch,log=()=>{},delayMs=150}={}) {
  const {guildId,apiBaseUrl,sourceUrl,filters}=config;
  const listed=new Map(),refresh=new Set();
  // Exhaust pagination; neither the battle dates nor a season determine where
  // scanning stops. A non-progressing page is an error, not a successful scan.
  for (let page=1;;page++) {
    const query=new URLSearchParams({guildId,...filters,page});
    const rows=await fetchJson(`${apiBaseUrl}/battles?${query}`,fetchImpl);
    if (!Array.isArray(rows)) throw Error('Unexpected AlbionBB battle listing');
    let added=0;
    for (const b of rows) {
      if (!Number.isSafeInteger(b.albionId)) throw Error('Invalid listed battle ID');
      if (!listed.has(b.albionId)) added++;
      listed.set(b.albionId,b);
      if (page===1) refresh.add(b.albionId);
    }
    log(`Scanned page ${page}: ${listed.size} battle IDs`);
    if (rows.length<20) break;
    if (!added) throw Error('AlbionBB pagination stopped advancing');
    await pause(delayMs);
  }
  const cached=new Map((previous.guildId===guildId?previous.battles||[]:[]).map(b=>[b.albionId,b]));
  const ids=new Set([...listed.keys(),...cached.keys(),...preservedIds]);
  const battles=[];
  let completed=0;
  for (const id of ids) {
    let battle=cached.get(id);
    if (!battle || refresh.has(id)) {
      const raw=await fetchJson(`${apiBaseUrl}/battles/${id}`,fetchImpl);
      if (raw.albionId!==id || !raw.guilds?.some(g=>g.albionId===guildId) || !Array.isArray(raw.players)) throw Error(`Guild/detail mismatch: ${id}`);
      battle=Object.fromEntries(['albionId','startedAt','finishedAt','totalKills','totalPlayers','totalFame','guilds'].map(key=>[key,raw[key]]));
      const guild=raw.guilds.find(g=>g.albionId===guildId);
      battle.ownPlayers=raw.players.filter(p=>p.guildName===guild.name).map(p=>p.name).sort();
      await pause(delayMs);
    }
    battles.push(battle);
    if (++completed%25===0 || completed===ids.size) log(`Loaded details ${completed}/${ids.size}`);
  }
  battles.sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.albionId-b.albionId);
  return {guildId,guildName:config.guildName,region:config.region,apiBaseUrl,sourceUrl,filters,scannedAt:new Date().toISOString(),preservedIds:[...new Set(preservedIds)],battles};
}

export async function verifyCombinedReports(source, decisions, previous=[], {fetchImpl=fetch,log=()=>{},delayMs=150}={}) {
  const verified=[];
  for (const d of decisions.filter(d=>d.included&&d.ids.length>1)) {
    const cached=previous.find(v=>v.ids.join(',')===d.ids.join(',') && v.kills===d.report.kills && v.deaths===d.report.deaths);
    if (cached) { verified.push(cached); continue; }
    const sourceUrl=`${source.apiBaseUrl}/battles/multi?ids=${d.ids.join(',')}`;
    const raw=await fetchJson(sourceUrl,fetchImpl);
    const guild=raw.guilds?.find(g=>g.albionId===source.guildId);
    if (!guild || guild.kills!==d.report.kills || guild.deaths!==d.report.deaths) throw Error(`Combined stats mismatch: ${d.ids}`);
    verified.push({ids:d.ids,kills:guild.kills,deaths:guild.deaths,sourceUrl});
    log(`Verified combined report: ${d.ids.join(',')}`);
    await pause(delayMs);
  }
  return verified;
}
