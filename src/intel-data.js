// The browser reads only JSON files hosted with this static site.
export class DataError extends Error {
  constructor(code) { super(code); this.name='DataError'; this.code=code; }
}
export const groupKey = ids => [...ids].map(Number).sort((a,b)=>a-b).join(',');
export function validateIndex(index) {
  if (index?.schemaVersion!==1 || !Array.isArray(index.guilds)) throw new DataError('invalid');
  const seen = new Set();
  for (const guild of index.guilds) {
    if (!/^[\w-]{1,64}$/.test(guild.Id) || typeof guild.Name!=='string' || !guild.Name.trim() ||
      !/^[\w-]+\.json$/.test(guild.file) || !Number.isFinite(Date.parse(guild.asOf)) || guild.coverageDays!==60 || seen.has(guild.Id)) throw new DataError('invalid');
    seen.add(guild.Id);
  }
  return index;
}
export function validateSnapshot(snapshot, entry) {
  if (snapshot?.schemaVersion!==1 || snapshot.guild?.Id!==entry.Id || snapshot.guild?.Name!==entry.Name ||
    snapshot.asOf!==entry.asOf || snapshot.coverageDays!==60 || !Array.isArray(snapshot.battles) ||
    !snapshot.multis || typeof snapshot.multis!=='object' || Array.isArray(snapshot.multis)) throw new DataError('invalid');
  const seen = new Set();
  for (const battle of snapshot.battles) {
    if (!Number.isSafeInteger(battle.albionId) || seen.has(battle.albionId) || !Number.isSafeInteger(battle.totalPlayers) || battle.totalPlayers<0 ||
      !Number.isFinite(Date.parse(battle.startedAt)) || !Number.isFinite(Date.parse(battle.finishedAt)) ||
      !Array.isArray(battle.players) || !battle.guilds?.some(g=>g.albionId===entry.Id)) throw new DataError('invalid');
    seen.add(battle.albionId);
  }
  for (const key of Object.keys(snapshot.multis)) if (!/^\d+(,\d+)+$/.test(key) || key.split(',').some(id=>!seen.has(Number(id)))) throw new DataError('invalid');
  return snapshot;
}
export function createDataSource({ baseUrl=new URL('../data/intel/',import.meta.url), fetchImpl=fetch }={}) {
  const base = new URL(baseUrl), cache = new Map();
  async function read(file, signal) {
    signal?.throwIfAborted();
    try {
      const response = await fetchImpl(new URL(file,base), { mode:'same-origin', credentials:'omit',cache:'no-cache',signal });
      if (!response.ok) throw new DataError(response.status===404?'missing':'network');
      return await response.json();
    } catch(error) {
      if (signal?.aborted) throw signal.reason;
      throw error instanceof DataError?error:new DataError('network');
    }
  }
  return {
    async index(signal) { return validateIndex(await read('manifest.json',signal)); },
    async load(entry, signal) {
      signal?.throwIfAborted();
      // Validate filenames before constructing a request, even for callers other than index().
      validateIndex({schemaVersion:1,guilds:[entry]});
      if (cache.has(entry.file)) return cache.get(entry.file);
      const snapshot = validateSnapshot(await read(entry.file,signal),entry);
      cache.set(entry.file,snapshot);
      if (cache.size>8) cache.delete(cache.keys().next().value);
      return snapshot;
    },
  };
}
