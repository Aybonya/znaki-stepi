(function () {
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  let worldOk = false;
  let activeStop = -1;
  const t = I18N.t;
  // Остановки и поездка на текущем языке
  const S = i => I18N.pick(STOPS[i]);
  const stopsL = () => STOPS.map((_, i) => S(i));
  const placesL = () => TRIP.places.map(I18N.pick);

  // Маленькая схема фигуры для шапки панели — по той же геометрии, что и рисунок на снимке
  const ICON_ROT = { ushtogay: 28, swastika: 0, shili: -15, ashutasty: -3 };
  function catmull(pts, steps) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let k = 0; k < steps; k++) {
        const t = k / steps, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map(j => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  function glyphSvg(id) {
    const g = GEO[id], lines = g.lines.map(l => (g.smooth ? catmull(l, 6) : l));
    const pts = [].concat(...lines, g.mounds || []);
    (g.rings || []).forEach(r => pts.push([r[0] + r[2], r[1]], [r[0] - r[2], r[1]], [r[0], r[1] + r[2]], [r[0], r[1] - r[2]]));
    const k = 42 / Math.max(...pts.map(p => Math.hypot(p[0], p[1])));
    const f = v => (v * k).toFixed(1);
    const many = (g.mounds || []).length > 60;
    return `<svg class="cp-glyph" viewBox="-50 -50 100 100" aria-hidden="true"><g transform="rotate(${-(ICON_ROT[id] || 0)})">` +
      lines.map(l => `<polyline points="${l.map(p => f(p[0]) + ',' + f(-p[1])).join(' ')}"/>`).join('') +
      (g.rings || []).map(r => `<circle class="ring" cx="${f(r[0])}" cy="${f(-r[1])}" r="${f(r[2] * 0.8)}"/>`).join('') +
      (g.mounds || []).map(m => `<circle class="dot" cx="${f(m[0])}" cy="${f(-m[1])}" r="${many ? 1.15 : 1.7}"/>`).join('') +
      '</g></svg>';
  }

  // «287 м» → крупное число и мелкая единица; длинный текст — отдельным стилем
  function factHtml(v) {
    const m = /^(≈?\s?\d+(?:[.,]\d+)?)\s*(.*)$/.exec(v);
    if (m && m[2].length <= 3) return `<dd>${m[1]}${m[2] ? `<small>${m[2]}</small>` : ''}</dd>`;
    return `<dd class="is-text">${v}</dd>`;
  }

  // ---------- Остановки (главы) ----------
  function buildChapters() {
    const box = $('chapters'), n = STOPS.length;
    box.innerHTML = stopsL().map((s, i) => {
      const mins = Math.max(1, Math.round(s.audio.split(/\s+/).length / 120));
      return `
      <section class="chapter" id="stop-${i + 1}" data-scene="stop" data-i="${i}">
        <div class="wrap chapter__wrap">
          <article class="chapter__panel">
            <header class="cp-head">
              <div class="cp-kicker">
                <span class="cp-step">${t('stop')} <b>${pad(i + 1)}</b> / ${pad(n)}</span>
                <span class="cp-progress" aria-hidden="true">${STOPS.map((_, k) => `<i class="${k < i ? 'done' : k === i ? 'on' : ''}"></i>`).join('')}</span>
              </div>
              <div class="cp-title">
                <div>
                  <h3>${s.name}</h3>
                  ${s.nameAlt ? `<p class="cp-alt">${s.nameAlt}</p>` : ''}
                  <p class="cp-place">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>
                    ${s.place}
                  </p>
                </div>
                ${glyphSvg(s.id)}
              </div>
            </header>
            <div class="chapter__scroll">
              <dl class="cp-facts">
                ${s.facts.map(f => `<div><dt>${f[0]}</dt>${factHtml(f[1])}</div>`).join('')}
              </dl>
              <p class="cp-coords">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg>
                ${s.coordsText.replace(', ', ' · ')}
              </p>
              <blockquote class="cp-meaning"><span>${t('meaning')}</span>${s.meaning}</blockquote>
              <p class="chapter__text">${s.text}</p>
            </div>
            <div class="chapter__actions">
              <button class="audio" data-i="${i}">
                <span class="audio__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" class="i-play"><path d="M8 5v14l11-7z"/></svg>
                  <svg viewBox="0 0 24 24" class="i-stop"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>
                </span>
                <span class="audio__label"><b>${t('audio')}</b><small>≈ ${mins} ${t('min')}</small></span>
                <span class="audio__wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
              </button>
              <button class="switch" data-i="${i}" aria-label="${t('switchAria')}">
                <span class="switch__opt on" data-v="space">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16"/></svg>${t('top')}
                </span>
                <span class="switch__opt" data-v="orbit">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>3D
                </span>
                <span class="switch__knob" aria-hidden="true"></span>
              </button>
            </div>
          </article>
          <p class="chapter__hint">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="3"/></svg>
            ${t('hint')}
          </p>
        </div>
      </section>`;
    }).join('');

    $('rail').innerHTML = stopsL().map((s, i) =>
      `<a href="#stop-${i + 1}" data-i="${i}"><span>${s.name}</span><i>${pad(i + 1)}</i></a>`).join('');
  }

  // ---------- План поездки ----------
  const TRIP_ICON = {
    town: '<svg viewBox="0 0 24 24"><path d="M4 21V9l5-3v15M9 21V4l7 4v13M16 21v-9l4 2v7M3 21h18"/></svg>',
    sight: '<svg viewBox="0 0 24 24"><path d="M6 21h12M8 21v-7h8v7M7 14l5-9 5 9"/></svg>',
    night: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  };
  function buildTrip() {
    const T = I18N.pick(TRIP);
    $('tripCol').innerHTML = `
      <div class="trip__card trip__intro" data-scene="trip" data-day="all">
        <p class="eyebrow">${t('tripEyebrow')}</p>
        <h2>${t('tripH')}</h2>
        <p class="trip__lead">${t('tripLead')}</p>
        <div class="trip__stats">${T.summary.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}</div>
        <div class="trip__legend">
          <span><i class="lg lg--d1"></i>${t('day')(1)}</span><span><i class="lg lg--d2"></i>${t('day')(2)}</span>
          <span><i class="lg lg--road"></i>${t('road')}</span><span><i class="lg lg--track"></i>${t('track')}</span>
        </div>
      </div>
      ${T.days.map(I18N.pick).map(d => `
      <article class="trip__card trip__day trip__day--${d.n}" data-scene="trip" data-day="${d.n}">
        <header><span class="trip__daynum">${t('day')(d.n)}</span><span class="trip__km">${d.km}</span></header>
        <h3>${d.title}</h3>
        <ol class="trip__steps">
          ${d.steps.map(I18N.pick).map(st => `
          <li class="st st--${st.kind}">
            <button data-at="${st.at.join(',')}" data-zoom="${st.kind === 'glyph' ? 15 : 12}">
              <span class="st__dot">${st.kind === 'glyph' ? pad(st.stop + 1) : TRIP_ICON[st.kind]}</span>
              <span class="st__body"><b>${st.name}</b><small>${st.note}</small></span>
              ${st.km ? `<span class="st__km">${st.km}</span>` : ''}
            </button>
          </li>`).join('')}
        </ol>
      </article>`).join('')}
      <div class="trip__card trip__tips" data-scene="trip" data-day="all">
        <h3>${t('tipsH')}</h3>
        <div class="tips">${T.tips.map(([h, t]) => `<div class="tip"><b>${h}</b><p>${t}</p></div>`).join('')}</div>
        <p class="trip__source">${T.source}</p>
      </div>`;
  }
  $('tripCol').addEventListener('click', e => {
    const b = e.target.closest('button[data-at]');
    if (b && worldOk) World.flyToPlace(b.dataset.at.split(',').map(Number), +b.dataset.zoom);
  });

  // ---------- Список маршрута (точки рисует фоновая карта) ----------
  function buildRoute() {
    $('routeList').innerHTML = stopsL().map((s, i) => `
      <li><button data-i="${i}">
        <span class="route__n">${pad(i + 1)}</span>
        <span class="route__t"><b>${s.name}</b><small>${s.place} · ${s.facts[0][1]}</small></span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </button></li>`).join('');
  }
  $('routeList').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) go(+b.dataset.i);
  });

  function go(i) { $('stop-' + (i + 1)).scrollIntoView({ behavior: 'smooth' }); }

  // ---------- Состояние сцены по прокрутке ----------
  let sceneEl = null, sceneKey = '';

  function applyScene(el) {
    const sc = el.dataset.scene, hud = $('hud'), rail = $('rail');
    document.body.dataset.scene = sc;
    if (!worldOk) return;
    hud.classList.toggle('on', sc !== 'off');
    rail.classList.toggle('on', sc === 'stop');
    $('veil').className = 'veil veil--' + sc;
    setHud(sc, el);
    rail.querySelectorAll('a').forEach((a, k) => a.classList.toggle('active', sc === 'stop' && k === +el.dataset.i));
    // Та же сцена (например, после смены языка) — только подписи, без перелёта
    const key = sc + (el.dataset.i || el.dataset.day || '');
    if (key === sceneKey) return;
    sceneKey = key;

    if (sc === 'stop') {
      const i = +el.dataset.i;
      activeStop = i;
      stopSpeech();
      World.showStop(STOPS[i]);
      document.querySelectorAll('.switch').forEach(resetSwitch);
      return;
    }
    activeStop = -1;
    stopSpeech();
    if (sc === 'hero') World.showHero();
    else if (sc === 'intro') World.showIntro();
    else if (sc === 'trip') World.showTrip(el.dataset.day);
    else if (sc === 'route') World.showRoute();
    else World.pause(true);
  }

  const sceneIO = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting || e.target === sceneEl) return;
      sceneEl = e.target;
      applyScene(sceneEl);
    });
  }, { rootMargin: '-50% 0px -50% 0px' });
  const watchScenes = () => document.querySelectorAll('[data-scene]').forEach(s => sceneIO.observe(s));

  function setHud(sc, el) {
    let name, coords;
    if (sc === 'stop') {
      const s = S(+el.dataset.i), c = GEO[s.id].center;
      name = s.name;
      coords = c[0].toFixed(4) + '° N · ' + c[1].toFixed(4) + '° E';
    } else if (t('hud')[sc]) [name, coords] = t('hud')[sc];
    else return;
    $('hudName').textContent = name;
    $('hudCoords').textContent = coords;
  }

  // ---------- Переключатель вида ----------
  function setSwitch(sw, v) {
    sw.classList.toggle('ground', v === 'orbit');
    document.body.classList.toggle('view-3d', v === 'orbit');
    sw.querySelectorAll('.switch__opt').forEach(o => o.classList.toggle('on', o.dataset.v === v));
  }
  const resetSwitch = sw => setSwitch(sw, 'space');

  document.addEventListener('click', e => {
    const sw = e.target.closest('.switch');
    if (!sw || !worldOk) return;
    setSwitch(sw, World.toggleView());
  });

  // ---------- Показать / скрыть рисунок поверх снимка ----------
  let figOn = true;
  $('figToggle').addEventListener('click', () => {
    if (!worldOk) return;
    figOn = !figOn;
    World.setFigure(figOn);
    const b = $('figToggle');
    b.setAttribute('aria-pressed', String(!figOn));
    b.classList.toggle('off', !figOn);
    figLabel();
  });
  const figLabel = () => { $('figToggle').querySelector('span').textContent = t(figOn ? 'figHide' : 'figShow'); };

  // ---------- Свободный просмотр ----------
  function setExplore(on) {
    if (!worldOk) return;
    document.documentElement.classList.toggle('exploring', on);
    document.body.classList.toggle('exploring', on);
    const idx = World.explore(on);
    if (!on && idx >= 0 && idx !== activeStop) go(idx);
  }
  $('exploreBtn').addEventListener('click', () => setExplore(true));
  $('exploreExit').addEventListener('click', () => setExplore(false));
  addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('exploring')) setExplore(false); });

  // ---------- Поворот в 3D ----------
  document.querySelectorAll('[data-rot]').forEach(b => b.addEventListener('click', () => { if (worldOk) World.rotate(+b.dataset.rot); }));

  // ---------- Аудиогид ----------
  let playing = null;

  function voiceFor(lang) {
    const vs = speechSynthesis.getVoices(), re = new RegExp('^' + lang, 'i');
    return vs.find(v => re.test(v.lang) && /natural|online|google/i.test(v.name)) || vs.find(v => re.test(v.lang));
  }

  function stopSpeech() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (playing) playing.classList.remove('playing');
    playing = null;
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest('.audio');
    if (!btn) return;
    if (!('speechSynthesis' in window)) { btn.querySelector('small').textContent = t('audioNo'); return; }
    if (playing === btn) { stopSpeech(); return; }
    stopSpeech();
    const i = +btn.dataset.i;
    let text = S(i).audio, lang = I18N.lang, v = voiceFor(lang);
    // Казахского голоса в браузере может не быть — тогда гид читает русский текст
    if (!v && lang === 'kk') {
      text = STOPS[i].audio; lang = 'ru'; v = voiceFor('ru');
      btn.querySelector('small').textContent = '≈ ' + Math.max(1, Math.round(text.split(/\s+/).length / 120)) + ' ' + t('min') + ' · ' + t('audioRu');
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === 'kk' ? 'kk-KZ' : 'ru-RU'; u.rate = 0.95;
    if (v) u.voice = v;
    u.onend = u.onerror = () => { if (playing === btn) stopSpeech(); };
    speechSynthesis.speak(u);
    btn.classList.add('playing');
    playing = btn;
  });

  // ---------- Тест ----------
  function buildQuiz() {
    const box = $('quizBox');
    let idx = 0, score = 0;
    const L = t('letters');

    function show() {
      if (idx >= QUIZ.length) return finish();
      const q = I18N.pick(QUIZ[idx]);
      box.innerHTML = `
        <div class="quiz__top">
          <span class="quiz__count"><b>${pad(idx + 1)}</b> / ${pad(QUIZ.length)}</span>
          <span class="quiz__stop">${t('stopN')(idx + 1)} · ${S(idx).name}</span>
        </div>
        <div class="quiz__bar"><i style="width:${(idx / QUIZ.length) * 100}%"></i></div>
        <h3 class="quiz__q">${q.q}</h3>
        <div class="quiz__opts">${q.options.map((o, k) => `<button data-k="${k}"><i>${L[k]}</i><span>${o}</span></button>`).join('')}</div>
        <div class="quiz__foot" hidden>
          <p class="quiz__explain"></p>
          <button class="btn btn--primary quiz__next">${t(idx === QUIZ.length - 1 ? 'result' : 'next')}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
        </div>`;
      box.classList.remove('swap'); void box.offsetWidth; box.classList.add('swap');

      box.querySelectorAll('.quiz__opts button').forEach(b => b.addEventListener('click', () => {
        const k = +b.dataset.k, ok = k === q.correct;
        box.querySelectorAll('.quiz__opts button').forEach(x => {
          x.disabled = true;
          if (+x.dataset.k === q.correct) x.classList.add('right');
        });
        if (ok) score++; else b.classList.add('wrong');
        const ex = box.querySelector('.quiz__explain');
        ex.innerHTML = `<b class="${ok ? 'ok' : 'no'}">${t(ok ? 'right' : 'wrong')}</b> ${q.explain}`;
        box.querySelector('.quiz__foot').hidden = false;
      }));
      box.querySelector('.quiz__next').addEventListener('click', () => { idx++; show(); });
    }

    function finish() {
      const msg = t(score === QUIZ.length ? 'best' : score >= 2 ? 'good' : 'low');
      const R = 54, C = 2 * Math.PI * R;
      box.innerHTML = `
        <div class="quiz__result">
          <svg viewBox="0 0 140 140" class="ring" aria-hidden="true">
            <circle cx="70" cy="70" r="${R}" class="ring__bg"/>
            <circle cx="70" cy="70" r="${R}" class="ring__fg" style="stroke-dasharray:${C};stroke-dashoffset:${C}"/>
          </svg>
          <b>${score}<small>/${QUIZ.length}</small></b>
          <p>${msg}</p>
          <button class="btn btn--ghost">${t('again')}</button>
        </div>`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        box.querySelector('.ring__fg').style.strokeDashoffset = C * (1 - score / QUIZ.length);
      }));
      box.querySelector('button').addEventListener('click', () => { idx = 0; score = 0; show(); });
    }

    show();
  }

  // ---------- Появление, шапка ----------
  const revealIO = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); revealIO.unobserve(e.target); }
  }), { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
  function reveal() {
    document.querySelectorAll('.reveal:not(.in), .chapter__panel:not(.in)').forEach(el => revealIO.observe(el));
  }
  addEventListener('scroll', () => $('nav').classList.toggle('nav--solid', scrollY > 60), { passive: true });

  // ---------- Язык ----------
  function render() {
    document.querySelectorAll('#chapters [data-scene], #tripCol [data-scene]').forEach(s => sceneIO.unobserve(s));
    buildChapters();
    buildRoute();
    buildTrip();
    buildQuiz();
    figLabel();
    reveal();
    watchScenes();
  }
  document.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => I18N.set(b.dataset.lang)));
  I18N.onChange(() => {
    stopSpeech();
    render();
    if (!worldOk) return;
    World.relabel(stopsL(), placesL());
    if (World.getView() === 'orbit') document.querySelectorAll('.switch').forEach(sw => setSwitch(sw, 'orbit'));
    if (sceneEl) applyScene(sceneEl);
  });

  // ---------- Запуск ----------
  I18N.apply();
  render();

  try {
    World.init($('world'), {
      altEl: $('hudAlt'),
      onReady() {
        worldOk = true;
        World.setPins(stopsL(), go);
        World.setTrip(TRIP, placesL());
        setTimeout(() => World.prefetchAll(STOPS), 1500);
        if (sceneEl) applyScene(sceneEl);
      },
    });
  } catch (err) {
    document.body.classList.add('no-webgl');
  }
  if ('speechSynthesis' in window) speechSynthesis.getVoices();

  const done = () => document.body.classList.add('ready');
  Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise(r => setTimeout(r, 2500))])
    .then(() => setTimeout(done, 400));
})();
