(() => {
  document.querySelectorAll('[data-battle-preview]').forEach(img => {
    const ready = () => img.closest('.battle-art').classList.add('has-report-preview');
    const fallback = () => { img.hidden = true; img.closest('.battle-art').classList.remove('has-report-preview'); };
    img.addEventListener('load', ready);
    img.addEventListener('error', fallback);
    if (img.complete) img.naturalWidth ? ready() : fallback();
  });
  const lang = document.documentElement.lang;
  const fa = lang === 'fa';
  const base = new URL(fa ? '../' : './', location.href);
  const query = new URLSearchParams(location.search);
  const explicit = query.get('lang');
  const remembered = document.cookie.split('; ').find(c => c.startsWith('oneup_language='))?.split('=')[1];
  const persist = value => {
    document.cookie = `oneup_language=${value}; Max-Age=31536000; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  };
  if (['en', 'fa'].includes(explicit)) {
    persist(explicit);
    if (explicit !== lang) {
      const target = new URL(explicit === 'fa' ? 'fa/' : './', base);
      target.search = `?lang=${explicit}`; target.hash = location.hash;
      location.replace(target); return;
    }
    query.delete('lang');
    history.replaceState(null, '', location.pathname + (query.size ? `?${query}` : '') + location.hash);
  } else if (!fa && remembered === 'fa') {
    const target = new URL('fa/', base); target.search = location.search; target.hash = location.hash;
    location.replace(target); return;
  }
  document.querySelectorAll('[data-language]').forEach(a => a.addEventListener('click', () => persist(a.dataset.language)));

  const menu = document.querySelector('.menu-toggle');
  const nav = document.querySelector('#navigation');
  const closeMenu = () => { menu.setAttribute('aria-expanded', 'false'); nav.classList.remove('open'); };
  menu.addEventListener('click', () => {
    const open = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(open)); nav.classList.toggle('open', open);
  });
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });

  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function activate(tab) {
    tabs.forEach(t => {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected)); t.tabIndex = selected ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !selected;
    });
  }
  tabs.forEach((tab,index) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (event.key === 'ArrowRight') next = (index + (fa ? -1 : 1) + tabs.length) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + (fa ? 1 : -1) + tabs.length) % tabs.length;
      if (next != null) { event.preventDefault(); activate(tabs[next]); tabs[next].focus(); }
    });
  });
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    let visible = 0;
    document.querySelectorAll('.clip-card').forEach(card => {
      card.hidden = button.dataset.filter !== 'all' && card.dataset.type !== button.dataset.filter;
      if (!card.hidden) visible++;
    });
    document.querySelector('.filter-empty').hidden = visible > 0;
  }));

  const videoDialog = document.getElementById('video-dialog');
  const container = document.getElementById('video-container');
  document.querySelectorAll('[data-video]').forEach(button => button.addEventListener('click', () => {
    document.getElementById('video-title').textContent = button.dataset.title;
    const error = document.getElementById('video-error'); error.hidden = true;
    document.getElementById('video-original').href = button.dataset.video;
    let player;
    if (button.dataset.videoType === 'youtube') {
      const url = new URL(button.dataset.video);
      const id = url.hostname.endsWith('youtu.be') ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.split('/')[2];
      player = document.createElement('iframe');
      player.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`;
      player.title = button.dataset.title;
      player.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      player.allowFullscreen = true; player.referrerPolicy = 'strict-origin-when-cross-origin';
    } else {
      player = document.createElement('video');
      player.controls = true; player.autoplay = true; player.playsInline = true;
      player.src = button.dataset.video;
      player.addEventListener('error', () => { error.textContent = document.body.dataset.videoError; error.hidden = false; });
    }
    container.replaceChildren(player); videoDialog.showModal();
  }));
  videoDialog.addEventListener('close', () => { const video=container.querySelector('video'); if(video) video.pause(); container.replaceChildren(); });
  const jerseyDialog = document.getElementById('jersey-dialog');
  document.querySelector('[data-jersey]').addEventListener('click', event => { event.preventDefault(); jerseyDialog.showModal(); });
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
    });
  });
})();
