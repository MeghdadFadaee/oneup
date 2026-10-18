import { escapeHtml as e, localized } from './lib.mjs';
import { directPreview } from './battle-previews.mjs';

export function battleDetails(url) {
  const u=new URL(url);
  const combined=/\/battles\/multi\/?$/.test(u.pathname);
  const ids=combined?[...new Set((u.searchParams.get('ids')||'').split(',').filter(id=>/^\d+$/.test(id)))]:[u.pathname.split('/').filter(Boolean).pop()].filter(id=>/^\d+$/.test(id));
  return {combined,ids,region:u.hostname==='europe.albionbb.com'?'europe':u.hostname};
}

export function renderBattleCards({battles,previews,lang,base,icon,t}) {
  if (!battles.length) return '';
  const number=n=>new Intl.NumberFormat(lang==='fa'?'fa-IR':'en-US').format(n);
  const sorted=[...battles].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  // Combined reports may overlap with single reports; count unique, explicit battle IDs.
  const engagements=new Set(battles.flatMap(b=>battleDetails(b.url).ids)).size;
  const cards=sorted.map((battle,index)=>{
    const info=battleDetails(battle.url);
    const preview=previews[battle.url]||battle.preview||directPreview(battle.url);
    const image=preview?`<img class="battle-report-image" data-battle-preview src="${e(preview.startsWith('assets/')?base+preview:preview)}" alt="${e(localized(battle.title,lang))} — AlbionBB" loading="lazy">`:'';
    const outcome=battle.outcome||'recorded';
    const date=battle.date?`<time datetime="${e(battle.date)}">${new Intl.DateTimeFormat(lang==='fa'?'fa-IR':'en-GB',{dateStyle:'medium',timeZone:'UTC'}).format(new Date(battle.date))}</time>`:e(t.battleArchive);
    return `<article class="battle-card ${info.combined?'battle-card--campaign':'battle-card--single'}"><a class="battle-card-link" href="${e(battle.url)}" target="_blank" rel="noopener noreferrer"><div class="battle-art"><div class="battle-terrain" aria-hidden="true"></div>${image}<div class="battle-art-top"><span class="battle-type">${icon(info.combined?'shield':'swords')}${e(info.combined?t.combinedReport:t.singleReport)}</span><span class="battle-region">${e(info.region==='europe'?t.europe:info.region)}</span></div><div class="battle-crest" aria-hidden="true"><img src="${base}assets/logo.jpg" alt="" width="88" height="88" loading="lazy"></div><div class="battle-art-bottom"><span class="battle-record-number" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><span class="battle-engagements"><strong>${number(info.ids.length||1)}</strong>${e(info.ids.length===1?t.engagement:t.engagements)}</span><span class="battle-art-seal" aria-hidden="true">ONEUP<br>WAR ARCHIVE</span></div></div><div class="battle-card-content"><div class="battle-card-meta"><span>${date}</span><span class="outcome ${e(outcome)}">${e(t[outcome])}</span></div><h3>${e(localized(battle.title,lang))}</h3><div class="battle-id-list" aria-label="${e(t.reportIds)}">${info.ids.map(id=>`<span dir="ltr">#${e(id)}</span>`).join('')}</div>${battle.kills!=null||battle.deaths!=null?`<dl class="battle-card-stats"><div><dt>${e(t.kills)}</dt><dd>${battle.kills==null?'—':number(battle.kills)}</dd></div><div><dt>${e(t.deaths)}</dt><dd>${battle.deaths==null?'—':number(battle.deaths)}</dd></div></dl>`:''}<div class="battle-card-footer"><span class="battle-source">ALBIONBB <span>↗</span></span><span class="battle-open">${e(t.report)}<span class="battle-open-icon">${icon('diagonal')}</span></span></div></div></a></article>`;
  });
  const visible=12;
  const older=cards.length>visible?`<details class="battle-ledger battle-more"><summary>${icon('shield')}<span>${e(t.moreBattleReports.replace('{count}',number(cards.length-visible)))}</span><span class="ledger-toggle" aria-hidden="true">+</span></summary><div class="battle-card-grid">${cards.slice(visible).join('')}</div></details>`:'';
  return `<div class="battle-archive-strip"><div><strong>${number(battles.length)}</strong><span>${e(t.archivedReports)}</span></div><div><strong>${number(engagements)}</strong><span>${e(t.loggedEngagements)}</span></div><p>${icon('shield')}${e(t.archiveMotto)}</p></div><div class="battle-card-grid">${cards.slice(0,visible).join('')}</div>${older}`;
}
