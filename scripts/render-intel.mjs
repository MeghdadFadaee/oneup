import { escapeHtml as e } from './lib.mjs';
import { textFor } from '../src/intel-text.js';

export function renderIntel(lang, origin, apiBase = '/api/albion') {
  const fa = lang === 'fa', t = textFor(lang), base = fa ? '../../' : '../';
  return `<!doctype html><html lang="${lang}" dir="${fa ? 'rtl' : 'ltr'}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(t.title)} | OneUP</title><meta name="description" content="${e(t.intro)}"><meta name="theme-color" content="#101111"><meta name="color-scheme" content="dark">
<link rel="canonical" href="${origin}/${fa ? 'fa/' : ''}intel/"><link rel="alternate" hreflang="en" href="${origin}/intel/"><link rel="alternate" hreflang="fa" href="${origin}/fa/intel/">
<link rel="icon" href="${base}assets/favicon.svg"><link rel="stylesheet" href="${base}assets/styles.css"><link rel="stylesheet" href="${base}assets/intel.css">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Barlow:wght@400;500;600;700&family=Vazirmatn:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<script type="module" src="${base}assets/intel.js"></script></head>
<body class="intel-page" data-api-base="${e(apiBase)}">
<a class="skip-link" href="#intel-main">${fa ? 'رفتن به محتوا' : 'Skip to content'}</a>
<header class="intel-header"><a class="brand" href="${base}${fa ? 'fa/' : ''}" aria-label="OneUP"><img src="${base}assets/logo.jpg" alt="" width="44" height="44"><span>ONE<span class="brand-up">UP</span><small>GUILD INTELLIGENCE</small></span></a>
<a class="intel-back" href="${base}${fa ? 'fa/' : ''}">${e(t.back)} <span aria-hidden="true">↗</span></a>
<div class="languages"><a href="${base}intel/" lang="en" data-intel-language ${!fa ? 'aria-current="page"' : ''}>EN</a><span>/</span><a href="${base}fa/intel/" lang="fa" data-intel-language ${fa ? 'aria-current="page"' : ''}>فا</a></div></header>
<main id="intel-main" class="intel-main">
<section class="intel-hero"><div><p class="eyebrow">${e(t.eyebrow)}</p><h1>${e(t.hero)}<br><span>${e(t.accent)}</span></h1><p class="intel-intro">${e(t.intro)}</p></div><div class="intel-signal" aria-hidden="true"><div class="signal-orbit"></div><div class="signal-orbit orbit-inner"></div><span class="signal-center">1<span>UP</span></span><i></i><b>EU / INTEL</b></div><div class="intel-source"><span class="live-dot"></span>${e(t.region)}<span class="source-divider">/</span>${e(t.live)}</div></section>
<section class="intel-controls" aria-label="${e(t.title)}"><form id="intel-form">
<div class="intel-search"><label for="guild-name">${e(t.guild)}</label><div class="search-field"><span aria-hidden="true">⌕</span><input id="guild-name" name="guild" placeholder="${e(t.placeholder)}" dir="ltr" required minlength="2" maxlength="100" autocomplete="off" spellcheck="false"></div></div>
<fieldset class="period-field"><legend>${e(t.period)}</legend><div class="period-options">${[7,30,60].map(days => `<label><input type="radio" name="days" value="${days}" ${days === 7 ? 'checked' : ''}><span>${days} <small>${e(t.days)}</small></span></label>`).join('')}</div></fieldset>
<div class="minimum-field"><label for="min-members">${e(t.minimum)}</label><input id="min-members" name="minimum" type="number" min="1" max="1000" step="1" value="10" required aria-describedby="min-help"></div>
<button class="button intel-submit" type="submit">${e(t.analyze)} <span aria-hidden="true">↗</span></button>
<div class="intel-control-bottom"><label class="merge-control"><input type="checkbox" name="merge" checked><span class="switch" aria-hidden="true"></span>${e(t.merge)}</label><p id="min-help">${e(t.minimumHelp)}</p></div></form></section>
<div id="intel-status" class="intel-status" role="status" aria-live="polite"><span class="status-mark"></span><span id="status-text">${e(t.ready)}</span><button id="intel-cancel" type="button" hidden>${e(t.cancel)}</button></div>
<section id="intel-empty" class="intel-empty"><div class="empty-crosshair" aria-hidden="true">✦</div><p class="eyebrow">GUILD / BATTLE / COMPOSITION</p><h2>${e(t.idleTitle)}</h2><p>${e(t.idleCopy)}</p><div class="intel-steps">${[t.step1,t.step2,t.step3].map((x,i) => `<span><b>0${i+1}</b>${e(x)}</span>`).join('')}</div></section>
<section id="intel-error" class="intel-error" hidden role="alert"><h2>${fa ? 'گزارش آماده نشد' : 'Report unavailable'}</h2><p id="error-text"></p><div id="guild-choices"></div><button class="button" type="button" id="intel-retry">${e(t.retry)}</button></section>
<div id="intel-results" hidden></div>
<details class="intel-method"><summary>${e(t.methodology)} <span aria-hidden="true">+</span></summary><p>${e(t.caveat)}</p><p>${e(t.mergeHelp)}</p><p>${e(t.minimumHelp)}</p></details>
</main><footer class="intel-footer"><span>ONE<span>UP</span> / INTELLIGENCE</span><p>${e(t.service)}</p><a href="https://europe.albionbb.com/" target="_blank" rel="noopener noreferrer">ALBIONBB ↗</a></footer>
<noscript><p class="intel-error">${fa ? 'برای دریافت گزارش زنده، جاوااسکریپت مرورگر را فعال کن.' : 'Enable JavaScript to load live reports.'}</p></noscript>
</body></html>`;
}
