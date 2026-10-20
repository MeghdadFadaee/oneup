// Pure report logic shared by the browser and the verification suite.
export const ROLES = ['tank', 'healer', 'support', 'range', 'melee', 'battlemount', 'unknown'];
export const normalizeName = value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US');
export const ownGuild = (battle, guildId) => battle.guilds?.find(g => g.albionId === guildId);
export const ownPlayers = (battle, guildId) => {
  const guild = ownGuild(battle, guildId);
  return (battle.players || []).filter(p => guild && normalizeName(p.guildName) === normalizeName(guild.name));
};
const millis = value => Date.parse(value);
const overlap = (a, b) => {
  const shared = [...a].reduce((sum, [key, count]) => sum + Math.min(count, b.get(key) || 0), 0);
  const smaller = Math.min(...[a, b].map(m => [...m.values()].reduce((sum, n) => sum + n, 0)));
  return { shared, ratio: smaller ? shared / smaller : 0 };
};
function otherTeams(battle, guildId) {
  const guild = ownGuild(battle, guildId), teams = new Map();
  for (const g of battle.guilds || []) {
    if (g.albionId === guildId || (guild?.alliance && guild.alliance === g.alliance)) continue;
    const key = g.alliance ? `alliance:${g.alliance}` : `guild:${g.albionId}`;
    teams.set(key, (teams.get(key) || 0) + g.players);
  }
  return teams;
}
export function compatible(a, b, guildId) {
  const roster = overlap(...[a, b].map(x => new Map(ownPlayers(x, guildId).map(p => [p.name, 1]))));
  const teams = overlap(otherTeams(a, guildId), otherTeams(b, guildId));
  return roster.shared >= 3 && roster.ratio >= .5 && teams.shared >= 3 && teams.ratio >= .5;
}
export function groupReports(battles, guildId, merge = true) {
  const sorted = [...new Map(battles.map(b => [b.albionId, b])).values()]
    .sort((a, b) => millis(a.startedAt) - millis(b.startedAt) || a.albionId - b.albionId);
  const groups = [];
  let active = [];
  for (const battle of sorted) {
    const start = millis(battle.startedAt), end = millis(battle.finishedAt || battle.startedAt);
    // Old encounters can never match a later battle. Keep only the bounded active window.
    active = active.filter(g => start-g.lastEnd<=20*60_000 && start-g.firstStart<=90*60_000);
    const candidates = merge ? active.filter(g => Math.max(g.end,end)-g.firstStart<=90*60_000 &&
      compatible(g.rows.at(-1),battle,guildId) && compatible(g.rows[0],battle,guildId)) : [];
    candidates.sort((a,b)=>b.lastEnd-a.lastEnd);
    if (candidates.length) {
      const chosen=candidates[0];chosen.rows.push(battle);chosen.lastEnd=end;chosen.end=Math.max(chosen.end,end);
    } else {
      const rows=[battle];groups.push(rows);active.push({rows,firstStart:start,lastEnd:end,end});
    }
  }
  return groups;
}
export function selectBattles(battles, guildId, { since, until, minPlayers }) {
  return battles.filter(b => millis(b.startedAt) >= since && millis(b.startedAt) <= until &&
    ownGuild(b, guildId) && b.totalPlayers >= minPlayers);
}
export function makeReport(group, combined, guildId) {
  const battle = combined || group[0];
  if (!ownGuild(battle, guildId) || !Array.isArray(battle.players)) throw Error('Invalid guild report');
  return {
    ids: group.map(b => b.albionId), battle, guild: ownGuild(battle, guildId),
    players: ownPlayers(battle, guildId),
    startedAt: new Date(Math.min(...group.map(b => millis(b.startedAt)))).toISOString(),
    // The multi API's end timestamp is not reliably the maximum end time.
    finishedAt: new Date(Math.max(...group.map(b => millis(b.finishedAt || b.startedAt)))).toISOString(),
    url: `https://europe.albionbb.com/battles/${group.length > 1 ? `multi?ids=${group.map(b => b.albionId).join(',')}` : group[0].albionId}`,
  };
}
export function summarize(reports) {
  const summary = { kills: 0, deaths: 0, killFame: 0, deathFame: 0, attendance: 0, ip: 0, ipCount: 0,
    roles: Object.fromEntries(ROLES.map(r => [r, 0])), weapons: new Map(), players: new Map(), daily: new Map() };
  for (const report of reports) {
    const guild = report.guild;
    summary.kills += guild.kills || 0; summary.deaths += guild.deaths || 0;
    summary.killFame += guild.killFame || 0; summary.attendance += guild.players || 0;
    const date = report.startedAt.slice(0, 10);
    summary.daily.set(date, (summary.daily.get(date) || 0) + (guild.killFame || 0));
    for (const p of report.players) {
      const role = ROLES.includes(p.role) ? p.role : 'unknown';
      summary.roles[role]++;
      summary.deathFame += p.deathFame || 0;
      if (p.ip > 0) { summary.ip += p.ip; summary.ipCount++; }
      const equipment = role === 'battlemount' && typeof p.mount === 'string'
        ? { name: p.mount, type: p.mount, quality: 1 } : p.weapon;
      if (equipment?.name) {
        const key = `${role}:${equipment.name}`;
        const weapon = summary.weapons.get(key) || { ...equipment, role, count: 0 };
        weapon.count++; summary.weapons.set(key, weapon);
      }
      const player = summary.players.get(p.name) || { name: p.name, kills: 0, deaths: 0, killFame: 0, attendance: 0, heal: 0, damage: 0 };
      for (const key of ['kills', 'deaths', 'killFame', 'heal', 'damage']) player[key] += p[key] || 0;
      player.attendance++; summary.players.set(p.name, player);
    }
  }
  summary.averageAttendance = reports.length ? summary.attendance / reports.length : 0;
  summary.averageIp = summary.ipCount ? summary.ip / summary.ipCount : 0;
  return summary;
}

export async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0, failed = false;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed) {
      const index = next++;
      if (index >= items.length) return;
      try { results[index] = await task(items[index], index); }
      catch (error) { failed = true; throw error; }
    }
  }));
  return results;
}

export async function scanListings(api, guildId, since, signal, progress = () => {}, minPlayers = 1) {
  const found = new Map();
  // Fetch every page in range; do not present a fixed first-page sample as a full history.
  for (let page = 1; page <= 1000; page++) {
    signal?.throwIfAborted();
    const rows = await api('/battles', { guildId, minPlayers, minGuildPlayers: 1, page }, signal);
    if (!Array.isArray(rows)) throw Error('Invalid battle listing');
    let added = 0;
    for (const row of rows) {
      if (!Number.isSafeInteger(row.albionId) || !Number.isFinite(millis(row.startedAt))) throw Error('Invalid battle listing');
      if (!found.has(row.albionId)) added++;
      found.set(row.albionId, row);
    }
    progress(page, found.size);
    if (rows.length < 20 || rows.every(b => millis(b.startedAt) < since)) {
      return [...found.values()].filter(b => millis(b.startedAt) >= since);
    }
    if (!added) throw Error('Pagination stopped advancing');
  }
  throw Error('History scan exceeded 1000 pages; narrow the date range.');
}
