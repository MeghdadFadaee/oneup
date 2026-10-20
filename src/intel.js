import { ROLES, normalizeName, ownGuild, groupReports, selectBattles, makeReport, summarize, mapLimit } from './intel-core.js';
import { textFor } from './intel-text.js';
import { createDataSource, DataError, groupKey } from './intel-data.js';

const fa = document.documentElement.lang === 'fa', t = textFor(fa ? 'fa' : 'en');
const locale = fa ? 'fa-IR' : 'en-GB', form = document.querySelector('#intel-form');
const results = document.querySelector('#intel-results'), empty = document.querySelector('#intel-empty');
const errorBox = document.querySelector('#intel-error'), status = document.querySelector('#intel-status');
const cancel = document.querySelector('#intel-cancel');
const source = createDataSource();
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const number = (value, decimals = 0) => new Intl.NumberFormat(locale, { maximumFractionDigits: decimals }).format(value);
const compact = value => {
  const unit = value >= 1e9 ? [1e9,'B'] : value >= 1e6 ? [1e6,'M'] : value >= 1e3 ? [1e3,'K'] : [1,''];
  return `${number(value / unit[0], unit[0] === 1 ? 0 : 1)}${unit[1]}`;
};
const full = value => new Intl.NumberFormat(locale).format(value);
const date = value => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(value));
const clock = value => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(value));
const roleLabel = role => t[`${role}s`] || t.unknowns;
const roleColor = { tank:'#d5a65c', healer:'#6ac5a3', support:'#9d8de2', range:'#71a8d8', melee:'#ed727c', battlemount:'#b8b6a7', unknown:'#646c73' };
let controller, generation = 0, loaded, forcedGuild;

class ReportError extends Error {}
function progress(message, run) {
  if (run !== generation) return;
  document.querySelector('#status-text').textContent = message;
}
function saveQuery(config) {
  const query = new URLSearchParams({ guild:config.name, days:config.days, minimum:config.minimum, merge:config.merge ? '1' : '0' });
  history.replaceState(null, '', `${location.pathname}?${query}`);
  document.querySelectorAll('[data-intel-language]').forEach(a => { a.search = query.toString(); });
}
function showError(message) {
  errorBox.hidden = false;
  document.querySelector('#error-text').textContent = message;
}
async function analyze(event) {
  event?.preventDefault();
  if (!form.reportValidity()) return;
  controller?.abort();
  const run = ++generation;
  controller = new AbortController();
  const { signal } = controller;
  const config = { name:form.elements.guild.value.trim(), days:Number(form.elements.days.value), minimum:Number(form.elements.minimum.value), merge:form.elements.merge.checked };
  saveQuery(config);
  results.hidden = true; empty.hidden = true; errorBox.hidden = true;
  document.querySelector('#guild-choices').replaceChildren();
  form.querySelector('[type=submit]').disabled = true;
  cancel.hidden = false; status.classList.add('is-loading');
  results.setAttribute('aria-busy','true');
  progress(t.finding, run);
  try {
    const index = await source.index(signal);
    showAvailable(index);
    const candidates = index.guilds;
    const exact = candidates.filter(g => normalizeName(g.Name) === normalizeName(config.name));
    if (!exact.length) throw new ReportError(t.notFound);
    if (forcedGuild && !exact.some(g => g.Id === forcedGuild)) forcedGuild = undefined;
    if (exact.length > 1 && !forcedGuild) {
      showError(t.ambiguous);
      document.querySelector('#intel-retry').hidden = true;
      const choices = document.querySelector('#guild-choices');
      for (const guild of exact) {
        const button = document.createElement('button');
        button.className = 'guild-choice'; button.type = 'button'; button.textContent = `${guild.Name} · ${guild.Id}`;
        button.addEventListener('click', () => { forcedGuild = guild.Id; analyze(); }); choices.append(button);
      }
      return;
    }
    const guild = exact.find(g => g.Id === forcedGuild) || exact[0];
    const snapshot = await source.load(guild,signal);
    const until = Date.parse(snapshot.asOf), since = until - config.days * 86_400_000;
    const battles = snapshot.battles;
    const stamp = new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(new Date(until));
    document.querySelector('#snapshot-status').textContent = `${guild.Name} · ${t.snapshotAt} ${stamp} UTC${Date.now()-until>36*3_600_000 ? ` · ${t.staleSnapshot}` : ''}`;
    const selected = selectBattles(battles, guild.Id, { since, until, minPlayers:config.minimum });
    const groups = groupReports(selected, guild.Id, config.merge);
    let count = 0;
    const reports = await mapLimit(groups, 2, async group => {
      const combined = group.length > 1 ? snapshot.multis[groupKey(group.map(b => b.albionId))] : null;
      if (group.length>1 && !combined) throw new DataError('invalid');
      if (combined) {
        const guildTotal = ownGuild(combined, guild.Id);
        for (const key of ['kills', 'deaths', 'killFame']) {
          if (guildTotal?.[key] !== group.reduce((sum, b) => sum + (ownGuild(b, guild.Id)[key] || 0), 0)) throw new ReportError(t.partial);
        }
      }
      progress(`${t.merging} · ${number(++count)} / ${number(groups.length)}`, run);
      return makeReport(group, combined, guild.Id);
    });
    signal.throwIfAborted();
    if (run !== generation) return;
    loaded = { guild, config, reports, since, until, originalCount:selected.length };
    render(loaded);
    progress(`${guild.Name} · ${number(reports.length)} ${t.encounters} · ${t.loaded} ${clock(until)} UTC`, run);
  } catch (error) {
    if (run !== generation) return;
    controller.abort();
    const cancelled = error?.name === 'AbortError';
    if (cancelled) {
      empty.hidden = false; progress(t.cancelled, run);
    } else {
      showError(error instanceof DataError ? t.dataError : error instanceof ReportError ? error.message : t.error);
      progress(error instanceof DataError ? t.dataError : t.error, run);
    }
  } finally {
    if (run === generation) {
      status.classList.remove('is-loading'); cancel.hidden = true;
      form.querySelector('[type=submit]').disabled = false;
      results.setAttribute('aria-busy','false');
      if (!document.querySelector('#guild-choices').children.length) document.querySelector('#intel-retry').hidden = false;
    }
  }
}

function metric(label, value, foot = '', featured = false, exact) {
  return `<article class="intel-metric ${featured ? 'featured-metric' : ''}"><span>${e(label)}</span><strong dir="ltr" ${exact !== undefined ? `title="${e(full(exact))}"` : ''}>${e(value)}</strong><small>${foot}</small></article>`;
}
function render(data) {
  const { reports, guild, config } = data;
  if (!reports.length) {
    results.innerHTML = `<section class="intel-no-results"><p class="eyebrow">${e(guild.Name)} / ${config.days} ${e(t.days)}</p><h2>${e(t.emptyTitle)}</h2><p>${e(t.emptyCopy)}</p></section>`;
    results.hidden = false; return;
  }
  const s = summarize(reports);
  const roleTotal = Object.values(s.roles).reduce((sum, n) => sum + n, 0);
  const delta = s.killFame - s.deathFame;
  results.innerHTML = `
  <div class="intel-result-heading"><div><p class="eyebrow">${e(t.overview)}</p><h2><bdi>${e(guild.Name)}</bdi><span class="guild-region">EU</span></h2><p>${e(date(data.since))} — ${e(date(data.until))} · ${number(config.days)} ${e(t.days)} · ${number(config.minimum)}+ ${e(t.totalPlayers)}<br><span>${e(t.filtered)}</span></p></div><button class="intel-download" id="export-csv" type="button">↓ ${e(t.export)}</button></div>
  <div class="intel-metrics">
    ${metric(t.killFame, compact(s.killFame), `${e(t.netFame)} <bdi class="${delta >= 0 ? 'positive' : 'negative'}">${delta >= 0 ? '+' : '−'}${e(compact(Math.abs(delta)))}</bdi>`, true, s.killFame)}
    ${metric(t.encounters, number(reports.length), `${number(data.originalCount)} ${e(t.original)}`)}
    ${metric(t.kd, s.deaths ? number(s.kills/s.deaths, 2) : s.kills ? '∞' : '—', `<span class="positive">${number(s.kills)}</span> ${e(t.kills)} / <span class="negative">${number(s.deaths)}</span> ${e(t.deaths)}`)}
    ${metric(t.attendance, number(s.averageAttendance, 1), `${number(s.players.size)} ${e(t.unique)}`)}
    ${metric(t.deathFame, compact(s.deathFame), `${number(s.deaths)} ${e(t.deaths)}`, false, s.deathFame)}
    ${metric(t.avgIp, s.averageIp ? number(s.averageIp) : '—', `${number(s.ipCount)} ${e(t.appearances)}`)}
  </div>
  <div class="intel-analysis-grid"><section class="intel-panel trend-panel"><div class="panel-heading"><div><p class="eyebrow">01 / MOMENTUM</p><h3>${e(t.trend)}</h3><p>${e(t.trendHint)}</p></div><span class="chart-key"><i></i> ${e(t.killFame)}</span></div>${trend(s, data)}</section>
  <section class="intel-panel composition-panel"><div class="panel-heading"><div><p class="eyebrow">02 / COMPOSITION</p><h3>${e(t.composition)}</h3><p>${e(t.compositionHint)}</p></div></div><div class="composition-body">${donut(s.roles)}<div class="role-legend">${ROLES.filter(r => s.roles[r]).map(r => `<div><i style="--role:${roleColor[r]}"></i><span>${e(roleLabel(r))}</span><b>${number(s.roles[r])}</b><small>${number(s.roles[r]/roleTotal*100,1)}%</small></div>`).join('')}</div></div></section></div>
  <div class="intel-detail-grid"><section class="intel-panel weapons-panel"><div class="panel-heading"><div><p class="eyebrow">03 / ARSENAL</p><h3>${e(t.weapons)}</h3><p>${e(t.weaponHint)}</p></div><select id="weapon-role" aria-label="${e(t.allRoles)}"><option value="all">${e(t.allRoles)}</option>${ROLES.filter(r => r !== 'unknown').map(r => `<option value="${r}">${e(roleLabel(r))}</option>`).join('')}</select></div><div id="weapons-list"></div></section>
  <section class="intel-panel players-panel"><div class="panel-heading"><div><p class="eyebrow">04 / PEOPLE</p><h3>${e(t.leaderboard)}</h3></div><select id="player-sort" aria-label="${e(t.leaderboard)}">${['killFame','kills','attendance','heal','damage'].map(key => `<option value="${key}">${e(t[key === 'killFame' ? 'killFame' : key === 'attendance' ? 'presence' : key])}</option>`).join('')}</select></div><div id="player-list" class="intel-table-wrap"></div></section></div>
  <section class="intel-ledger"><div class="panel-heading"><div><p class="eyebrow">05 / ENCOUNTERS</p><h3>${e(t.ledger)}</h3><p>${e(t.ledgerHint)}</p></div><span class="ledger-count">${number(reports.length)}</span></div>
  <div class="ledger-controls"><input id="battle-search" type="search" placeholder="${e(t.searchBattle)}" aria-label="${e(t.searchBattle)}"><select id="battle-sort" aria-label="${e(t.ledger)}"><option value="recent">${e(t.recent)}</option><option value="fame">${e(t.mostFame)}</option><option value="players">${e(t.mostPlayers)}</option></select></div><div id="battle-list"></div><button type="button" id="more-battles" class="intel-more" hidden>${e(t.more)} ↓</button></section>`;
  results.hidden = false;
  const weaponSelect = document.querySelector('#weapon-role'), playerSelect = document.querySelector('#player-sort');
  const updateWeapons = () => { document.querySelector('#weapons-list').innerHTML = weaponList([...s.weapons.values()], weaponSelect.value); };
  weaponSelect.addEventListener('change', updateWeapons); updateWeapons();
  const updatePlayers = () => { document.querySelector('#player-list').innerHTML = playersTable([...s.players.values()], playerSelect.value); };
  playerSelect.addEventListener('change', updatePlayers); updatePlayers();
  let visible = 20;
  const updateBattles = () => {
    const search = normalizeName(document.querySelector('#battle-search').value);
    const sort = document.querySelector('#battle-sort').value;
    const filtered = reports.filter(r => !search || r.ids.some(id => String(id).includes(search)) || r.battle.guilds.some(g => normalizeName(g.name).includes(search)));
    filtered.sort((a,b) => sort === 'fame' ? b.guild.killFame - a.guild.killFame : sort === 'players' ? b.guild.players - a.guild.players : Date.parse(b.startedAt) - Date.parse(a.startedAt));
    document.querySelector('#battle-list').innerHTML = filtered.length ? filtered.slice(0,visible).map(r => battleRow(r, guild.Id)).join('') : `<p class="list-empty">${e(t.noMatch)}</p>`;
    document.querySelector('#more-battles').hidden = visible >= filtered.length;
  };
  for (const id of ['battle-search','battle-sort']) document.querySelector(`#${id}`).addEventListener(id === 'battle-search' ? 'input' : 'change', () => { visible = 20; updateBattles(); });
  document.querySelector('#more-battles').addEventListener('click', () => { visible += 20; updateBattles(); }); updateBattles();
  document.querySelector('#export-csv').addEventListener('click', exportCsv);
}
function trend(s, data) {
  const dates = [];
  for (let day = Date.parse(new Date(data.since).toISOString().slice(0,10)); day <= data.until; day += 86_400_000) dates.push(new Date(day).toISOString().slice(0,10));
  const max = Math.max(...s.daily.values(), 1), width = 800, height = 195, gap = 3, unit = width / dates.length;
  return `<div class="fame-chart"><div class="chart-scale"><span>${e(compact(max))}</span><span>${e(compact(max/2))}</span><span>0</span></div><svg viewBox="0 0 ${width} ${height+30}" role="img" aria-label="${e(t.trend)}"><defs><linearGradient id="fame-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#ed727c"/><stop offset="1" stop-color="#a42a39" stop-opacity=".35"/></linearGradient></defs>${[0,.5,1].map(f => `<line x1="0" y1="${f*height}" x2="800" y2="${f*height}" stroke="#ffffff12" stroke-dasharray="3 5"/>`).join('')}${dates.map((day,i) => {
    const value = s.daily.get(day) || 0, h = value / max * (height-12);
    return `<rect class="fame-bar" tabindex="0" role="img" aria-label="${e(date(day))}: ${e(full(value))}" x="${i*unit+gap/2}" y="${height-Math.max(h,2)}" width="${Math.max(unit-gap,2)}" height="${Math.max(h,2)}" rx="2" fill="${value ? 'url(#fame-fill)' : '#ffffff0a'}"><title>${e(date(day))} · ${e(full(value))} ${e(t.killFame)}</title></rect>`;
  }).join('')}<text x="0" y="220" fill="#a5a59d" font-size="13">${e(date(dates[0]))}</text><text x="800" y="220" text-anchor="end" fill="#a5a59d" font-size="13">${e(date(dates.at(-1)))}</text></svg></div>`;
}
function donut(roles) {
  const total = Object.values(roles).reduce((n,v) => n+v,0); let start = 0;
  const stops = ROLES.filter(r => roles[r]).map(r => { const end = start + roles[r]/total*100; const stop = `${roleColor[r]} ${start}% ${end}%`; start = end; return stop; });
  return `<div class="role-donut" style="background:conic-gradient(${stops.join(',') || '#333 0% 100%'})" role="img" aria-label="${e(t.compositionHint)}"><div><strong>${number(total)}</strong><span>${e(t.appearances)}</span></div></div>`;
}
const weaponNames = {
  '2H_MACE':'Heavy Mace', 'MAIN_MACE':'Mace', 'MAIN_MACE_CRYSTAL':'Dreadstorm Monarch', '2H_MACE_MORGANA':'Camlann Mace', '2H_DUALMACE_AVALON':'Oathkeepers',
  'MAIN_HAMMER':'Hammer', '2H_HAMMER':'Great Hammer', '2H_HAMMER_UNDEAD':'Tombhammer', '2H_HAMMER_AVALON':'Hand of Justice',
  'MAIN_NATURESTAFF':'Nature Staff', '2H_NATURESTAFF':'Great Nature Staff', '2H_NATURESTAFF_HELL':'Blight Staff', 'MAIN_NATURESTAFF_AVALON':'Ironroot Staff',
  'MAIN_HOLYSTAFF':'Holy Staff', 'MAIN_HOLYSTAFF_AVALON':'Hallowfall', '2H_HOLYSTAFF':'Great Holy Staff', '2H_HOLYSTAFF_HELL':'Fallen Staff',
  '2H_LONGBOW':'Longbow', '2H_BOW_AVALON':'Mistpiercer', '2H_CROSSBOW_CANNON_AVALON':'Energy Shaper', 'MAIN_DAGGER_HELL':'Demonfang',
  '2H_DUALSCIMITAR_UNDEAD':'Galatine Pair', '2H_FIRE_RINGPAIR_AVALON':'Dawnsong', '2H_HALBERD':'Halberd', '2H_AXE_AVALON':'Realmbreaker',
  '2H_KNUCKLES_SET3':'Spiked Gauntlets', '2H_KNUCKLES_HELL':'Hellfire Hands', '2H_SHAPESHIFTER_KEEPER':'Primal Staff', '2H_SHAPESHIFTER_AVALON':'Lightcaller',
  '2H_ENIGMATICSTAFF':'Enigmatic Staff', '2H_ARCANESTAFF_HELL':'Occult Staff', '2H_ARCANESTAFF':'Great Arcane Staff', 'MAIN_ARCANESTAFF':'Arcane Staff',
};
function weaponName(name) { return weaponNames[name] || name.replace(/^T\d+_/, '').replace(/^(MAIN_|2H_|MOUNT_)/, '').replaceAll('_',' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); }
function weaponList(weapons, role = 'all', limit = 12) {
  const items = weapons.filter(w => role === 'all' || w.role === role).sort((a,b) => b.count-a.count).slice(0,limit);
  const max = Math.max(...items.map(w => w.count),1);
  return items.length ? items.map(w => `<div class="weapon-row"><img src="https://render.albiononline.com/v1/item/${encodeURIComponent(w.type)}.png?quality=${Number(w.quality)||1}&size=80" width="42" height="42" alt="" loading="lazy"><div><div class="weapon-label"><span dir="ltr">${e(weaponName(w.name))}</span><strong>${number(w.count)}</strong></div><div class="weapon-track"><i style="width:${w.count/max*100}%;--role:${roleColor[w.role] || roleColor.unknown}"></i></div><small>${e(roleLabel(w.role))}</small></div></div>`).join('') : `<p class="list-empty">${e(t.noWeapons)}</p>`;
}
function playersTable(players, sort = 'killFame') {
  const metricLabel = sort === 'attendance' ? t.presence : t[sort];
  return `<table class="intel-table"><thead><tr><th>#</th><th>${e(t.name)}</th><th>${e(metricLabel)}</th><th>${e(t.kills)} / ${e(t.deaths)}</th></tr></thead><tbody>${players.sort((a,b) => b[sort]-a[sort] || a.name.localeCompare(b.name)).slice(0,10).map((p,i) => `<tr><td>${new Intl.NumberFormat(locale,{minimumIntegerDigits:2}).format(i+1)}</td><td><bdi>${e(p.name)}</bdi><small>${number(p.attendance)} ${e(t.encounters)}</small></td><td title="${e(full(p[sort]))}"><bdi>${e(['attendance','kills'].includes(sort) ? number(p[sort]) : compact(p[sort]))}</bdi></td><td><span class="positive">${number(p.kills)}</span> <span class="muted">/</span> ${number(p.deaths)}</td></tr>`).join('')}</tbody></table>`;
}
function battleRow(report, guildId) {
  const other = report.battle.guilds.filter(g => g.albionId !== guildId).sort((a,b) => b.players-a.players);
  const opponents = other.slice(0,3).map(g => g.name).join(' / ');
  const s = summarize([report]);
  return `<details class="encounter"><summary><div class="encounter-date"><strong>${e(date(report.startedAt))}</strong><small dir="ltr">${clock(report.startedAt)} UTC</small></div><div class="encounter-name"><span class="encounter-type ${report.ids.length > 1 ? 'is-merged' : ''}">${report.ids.length > 1 ? `${number(report.ids.length)} ${e(t.merged)}` : e(t.single)}</span><h4><bdi>${e(opponents || '—')}</bdi></h4><small>${e(t.otherGuilds)}</small></div><div class="encounter-stat"><strong title="${e(full(report.guild.killFame))}">${e(compact(report.guild.killFame))}</strong><small>${e(t.killFame)}</small></div><div class="encounter-stat"><strong>${number(report.guild.players)}</strong><small>${e(t.guildPlayers)}</small></div><div class="encounter-stat encounter-kd"><strong><span class="positive">${number(report.guild.kills)}</span><span class="muted"> / </span>${number(report.guild.deaths)}</strong><small>${e(t.kills)} / ${e(t.deaths)}</small></div><span class="encounter-expand" aria-hidden="true">+</span></summary><div class="encounter-body"><div class="encounter-detail-top"><span dir="ltr">${clock(report.startedAt)} — ${clock(report.finishedAt)} UTC</span><span>${number(report.battle.totalPlayers)} ${e(t.totalPlayers)}</span><a href="${e(report.url)}" target="_blank" rel="noopener noreferrer">${e(t.report)} ↗</a></div><div class="encounter-role-strip">${ROLES.filter(r => s.roles[r]).map(r => `<span><i style="--role:${roleColor[r]}"></i>${e(roleLabel(r))}<b>${number(s.roles[r])}</b></span>`).join('')}</div><div class="encounter-weapons">${weaponList([...s.weapons.values()], 'all', 100)}</div><div class="encounter-ids">${report.ids.map(id => `<a href="https://europe.albionbb.com/battles/${id}" target="_blank" rel="noopener noreferrer">#${id} ↗</a>`).join('')}</div></div></details>`;
}
function exportCsv() {
  if (!loaded) return;
  const escape = value => `"${String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"','""')}"`;
  const rows = [['Guild','Start UTC','End UTC','Battle IDs','Guild members','Kills','Deaths','Kill fame','Death fame','Report'], ...loaded.reports.map(r => [loaded.guild.Name,r.startedAt,r.finishedAt,r.ids.join(','),r.guild.players,r.guild.kills,r.guild.deaths,r.guild.killFame,r.players.reduce((sum,p) => sum+(p.deathFame||0),0),r.url])];
  const blob = new Blob(['\uFEFF', rows.map(row => row.map(escape).join(',')).join('\r\n')], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `guild-intelligence-${loaded.config.days}d.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showAvailable(index) {
  const container = document.querySelector('#available-guilds');
  const datalist = document.querySelector('#prepared-guilds');
  container.replaceChildren(); datalist.replaceChildren();
  for (const guild of index.guilds) {
    const button = document.createElement('button');button.type='button';button.textContent=guild.Name;
    button.addEventListener('click',()=>{form.elements.guild.value=guild.Name;analyze();});container.append(button);
    const option = document.createElement('option');option.value=guild.Name;datalist.append(option);
  }
}
form.addEventListener('submit', analyze);
cancel.addEventListener('click', () => controller?.abort());
document.querySelector('#intel-retry').addEventListener('click', () => analyze());
const query = new URLSearchParams(location.search);
form.elements.guild.value = query.get('guild') || '';
if (['7','30','60'].includes(query.get('days'))) form.elements.days.value = query.get('days');
if (/^\d+$/.test(query.get('minimum') || '') && Number(query.get('minimum')) >= 1 && Number(query.get('minimum')) <= 1000) form.elements.minimum.value = query.get('minimum');
if (query.get('merge') === '0') form.elements.merge.checked = false;
document.querySelectorAll('[data-intel-language]').forEach(a => { a.search = query.toString(); });
async function initialize() {
  try {
    const index = await source.index();
    showAvailable(index);
    document.querySelector('#snapshot-status').textContent = `${t.availableGuilds}: ${index.guilds.map(g=>g.Name).join(' / ')}`;
    if (!form.elements.guild.value && index.guilds.length) form.elements.guild.value=index.guilds[0].Name;
    if (form.elements.guild.value) analyze();
  } catch { document.querySelector('#snapshot-status').textContent=t.dataError; }
}
initialize();
