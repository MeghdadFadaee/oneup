import { normalizeName } from '../src/intel-core.js';

const SITE = 'https://europe.albionbb.com';
const REFS = new Set(['Reactive','ShallowReactive','Ref','ShallowRef']);

// Nuxt serializes its server-rendered page data as a flattened reference graph.
// Decode JSON only; never evaluate scripts downloaded from the source site.
export function readPageData(html) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const script = scripts.find(([,attrs]) => /type\s*=\s*["']application\/json["']/i.test(attrs) && /data-nuxt-data|__NUXT_DATA__/i.test(attrs));
  if (!script) throw Error('AlbionBB page does not contain server-rendered data');
  const values = JSON.parse(script[2]);
  if (!Array.isArray(values) || !values.length) throw Error('Invalid AlbionBB page payload');
  const seen = new Map();
  function decode(index, depth = 0) {
    if (depth>200 || !Number.isInteger(index)) throw Error('Invalid payload reference');
    if (index<0) {
      if (index===-1 || index===-2) return undefined;
      if (index===-3) return NaN;
      if (index===-4) return Infinity;
      if (index===-5) return -Infinity;
      if (index===-6) return -0;
      throw Error('Unknown payload reference');
    }
    if (index>=values.length) throw Error('Payload reference out of bounds');
    if (seen.has(index)) return seen.get(index);
    const value = values[index];
    if (!value || typeof value!=='object') return value;
    if (Array.isArray(value) && typeof value[0]==='string') {
      if (REFS.has(value[0])) return decode(value[1],depth+1);
      if (value[0]==='Date') return new Date(value[1]).toISOString();
      if (value[0]==='EmptyRef' || value[0]==='EmptyShallowRef') return undefined;
      throw Error(`Unsupported page data type: ${value[0]}`);
    }
    const result = Array.isArray(value)?[]:{};
    seen.set(index,result);
    for (const [key,ref] of Object.entries(value)) {
      Object.defineProperty(result,key,{value:decode(ref,depth+1),enumerable:true,writable:true,configurable:true});
    }
    return result;
  }
  let root = 0;
  const visited = new Set();
  while (Array.isArray(values[root]) && REFS.has(values[root][0])) {
    if (visited.has(root)) throw Error('Cyclic root payload');
    visited.add(root);root=values[root][1];
  }
  if (typeof values[root]?.data!=='number') throw Error('Missing page data root');
  const data = decode(values[root].data);
  if (!data || typeof data!=='object' || Array.isArray(data)) throw Error('Invalid page data root');
  return Object.values(data);
}
export function readBattlePage(html) {
  const battle = readPageData(html).find(value => value && !Array.isArray(value) && Number.isSafeInteger(value.albionId) && Array.isArray(value.guilds) && Array.isArray(value.players));
  if (!battle) throw Error('Battle data missing from AlbionBB HTML');
  return battle;
}
export function readListingPage(html) {
  const rows = readPageData(html).find(value => Array.isArray(value) && value.every(b=>Number.isSafeInteger(b?.albionId) && typeof b.startedAt==='string' && Array.isArray(b.guilds)));
  if (!rows) throw Error('Battle listing missing from AlbionBB HTML');
  return rows;
}
export function createPageClient({ fetchPage, knownGuilds=[] }) {
  const battles = new Map();
  async function detail(id) {
    if (!/^\d+$/.test(String(id))) throw Error('Invalid battle ID');
    if (!battles.has(Number(id))) {
      const battle = readBattlePage(await fetchPage(new URL(`/battles/${id}`,SITE)));
      if (battle.albionId!==Number(id)) throw Error('Unexpected battle page');
      battles.set(Number(id),battle);
    }
    return battles.get(Number(id));
  }
  return async function request(path,query={}) {
    if (path==='/guilds/search') {
      const known = knownGuilds.filter(g=>normalizeName(g.Name)===normalizeName(query.search));
      if (known.length) return known.map(g=>({Id:g.Id,Name:g.Name}));
      // Public search pages list matching fights; the detail pages identify guild IDs.
      const url = new URL('/',SITE);
      url.search = new URLSearchParams({search:query.search,minPlayers:1,page:1}).toString();
      const rows = readListingPage(await fetchPage(url));
      const matches = new Map();
      for (const row of rows) {
        if (!row.guilds.some(g=>normalizeName(g.name)===normalizeName(query.search))) continue;
        const battle = await detail(row.albionId);
        for (const guild of battle.guilds) if (normalizeName(guild.name)===normalizeName(query.search)) matches.set(guild.albionId,{Id:guild.albionId,Name:guild.name});
        if (matches.size) break;
      }
      return [...matches.values()];
    }
    if (path==='/battles') {
      if (!/^[\w-]{1,64}$/.test(query.guildId)) throw Error('Invalid guild ID');
      const url = new URL(`/guilds/${query.guildId}/battles`,SITE);
      url.search = new URLSearchParams({minPlayers:query.minPlayers??1,minGuildPlayers:query.minGuildPlayers??1,page:query.page??1}).toString();
      return readListingPage(await fetchPage(url));
    }
    if (path==='/battles/multi') {
      if (!/^\d+(,\d+)+$/.test(query.ids)) throw Error('Invalid combined battle IDs');
      const url = new URL('/battles/multi',SITE);url.searchParams.set('ids',query.ids);
      return readBattlePage(await fetchPage(url));
    }
    if (/^\/battles\/\d+$/.test(path)) return detail(path.split('/').at(-1));
    throw Error('Unsupported page request');
  };
}

export async function fetchPublicPage(url,fetchImpl=fetch) {
  if (url.origin!==SITE) throw Error('Unsupported page origin');
  for (let attempt=0;attempt<3;attempt++) {
    try {
      const response = await fetchImpl(url,{headers:{Accept:'text/html'},redirect:'error',signal:AbortSignal.timeout(30_000)});
      if (!response.ok) throw Error(`AlbionBB page returned HTTP ${response.status}: ${url}`);
      const html = await response.text();
      if (html.length>20_000_000) throw Error('AlbionBB page exceeds size limit');
      return html;
    } catch(error) {
      if (attempt===2 || /HTTP (401|403|429)/.test(error.message)) throw error;
      await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
    }
  }
}
