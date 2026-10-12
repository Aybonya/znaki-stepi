(function () {
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  let worldOk = false;
  let activeStop = -1;

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
    box.innerHTML = STOPS.map((s, i) => {
      const mins = Math.max(1, Math.round(s.audio.split(/\s+/).length / 120));
      return `
      <section class="chapter" id="stop-${i + 1}" data-scene="stop" data-i="${i}">
        <div class="wrap chapter__wrap">
          <article class="chapter__panel">
            <header class="cp-head">
              <div class="cp-kicker">
                <span class="cp-step">Остановка <b>${pad(i + 1)}</b> / ${pad(n)}</span>
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
              <blockquote class="cp-meaning"><span>Смысл</span>${s.meaning}</blockquote>
              <p class="chapter__text">${s.text}</p>
            </div>
            <div class="chapter__actions">
              <button class="audio" data-i="${i}">
                <span class="audio__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" class="i-play"><path d="M8 5v14l11-7z"/></svg>
                  <svg viewBox="0 0 24 24" class="i-stop"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>
                </span>
                <span class="audio__label"><b>Аудиогид</b><small>≈ ${mins} мин</small></span>
                <span class="audio__wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
              </button>
              <button class="switch" data-i="${i}" aria-label="Переключить вид">
                <span class="switch__opt on" data-v="space">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10l6-6 4 4-6 6zM14 14l6 6M10 14l-6 6M17 7l3-3"/></svg>Космос
                </span>
                <span class="switch__opt" data-v="ground">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"/><path d="M12 8v7M9 21l3-6 3 6M8 11h8"/></svg>С земли
                </span>
                <span class="switch__knob" aria-hidden="true"></span>
              </button>
            </div>
          </article>
          <p class="chapter__hint">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="3"/></svg>
            Потяните, чтобы осмотреться
          </p>
        </div>
      </section>`;
    }).join('');

    $('rail').innerHTML = STOPS.map((s, i) =>
      `<a href="#stop-${i + 1}" data-i="${i}"><span>${s.name}</span><i>${pad(i + 1)}</i></a>`).join('');
  }

  // ---------- Список маршрута (точки рисует фоновая карта) ----------
  function buildRoute() {
    $('routeList').innerHTML = STOPS.map((s, i) => `
      <li><button data-i="${i}">
        <span class="route__n">${pad(i + 1)}</span>
        <span class="route__t"><b>${s.name}</b><small>${s.place} · ${s.facts[0][1]}</small></span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      </button></li>`).join('');
    $('routeList').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) go(+b.dataset.i);
    });
  }

  function go(i) { $('stop-' + (i + 1)).scrollIntoView({ behavior: 'smooth' }); }

  // ---------- Состояние сцены по прокрутке ----------
  let sceneEl = null;

  function applyScene(el) {
    const sc = el.dataset.scene, hud = $('hud'), rail = $('rail');
    document.body.dataset.scene = sc;
    if (!worldOk) return;
    hud.classList.toggle('on', sc !== 'off');
    rail.classList.toggle('on', sc === 'stop');
    $('veil').className = 'veil veil--' + sc;

    if (sc === 'stop') {
      const i = +el.dataset.i;
      if (i === activeStop) return;
      activeStop = i;
      stopSpeech();
      World.showStop(STOPS[i]);
      setHud(STOPS[i], STOPS[i].name);
      document.querySelectorAll('.switch').forEach(resetSwitch);
      rail.querySelectorAll('a').forEach((a, k) => a.classList.toggle('active', k === i));
      return;
    }
    activeStop = -1;
    stopSpeech();
    if (sc === 'hero') { World.showHero(); $('hudName').textContent = 'Земля · вид из космоса'; $('hudCoords').textContent = '48° N · 58° E'; }
    else if (sc === 'intro') { World.showIntro(); $('hudName').textContent = 'Казахстан'; $('hudCoords').textContent = 'Тургайская степь · 50.3° N · 65.4° E'; }
    else if (sc === 'route') { World.showRoute(); $('hudName').textContent = 'Маршрут экскурсии'; $('hudCoords').textContent = 'Костанайская область'; }
    else World.pause(true);
  }

  function watchScenes() {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting || e.target === sceneEl) return;
        sceneEl = e.target;
        applyScene(sceneEl);
      });
    }, { rootMargin: '-50% 0px -50% 0px' });
    document.querySelectorAll('[data-scene]').forEach(s => io.observe(s));
  }

  function setHud(s, name) {
    const c = GEO[s.id].center;
    $('hudName').textContent = name;
    $('hudCoords').textContent = c[0].toFixed(4) + '° N · ' + c[1].toFixed(4) + '° E';
  }

  // ---------- Переключатель вида ----------
  function resetSwitch(sw) {
    document.body.classList.remove('view-ground');
    sw.classList.remove('ground');
    sw.querySelectorAll('.switch__opt').forEach(o => o.classList.toggle('on', o.dataset.v === 'space'));
  }

  document.addEventListener('click', e => {
    const sw = e.target.closest('.switch');
    if (!sw || !worldOk) return;
    const v = World.toggleView();
    sw.classList.toggle('ground', v === 'ground');
    document.body.classList.toggle('view-ground', v === 'ground');
    sw.querySelectorAll('.switch__opt').forEach(o => o.classList.toggle('on', o.dataset.v === v));
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
    b.querySelector('span').textContent = figOn ? 'Скрыть рисунок' : 'Показать рисунок';
  });

  // ---------- Аудиогид ----------
  let playing = null;

  function ruVoice() {
    const vs = speechSynthesis.getVoices();
    return vs.find(v => /^ru/i.test(v.lang) && /natural|online|google/i.test(v.name)) || vs.find(v => /^ru/i.test(v.lang));
  }

  function stopSpeech() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (playing) playing.classList.remove('playing');
    playing = null;
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest('.audio');
    if (!btn) return;
    if (!('speechSynthesis' in window)) { btn.querySelector('small').textContent = 'Озвучка не поддерживается'; return; }
    if (playing === btn) { stopSpeech(); return; }
    stopSpeech();
    const u = new SpeechSynthesisUtterance(STOPS[+btn.dataset.i].audio);
    u.lang = 'ru-RU'; u.rate = 0.95;
    const v = ruVoice(); if (v) u.voice = v;
    u.onend = u.onerror = () => { if (playing === btn) stopSpeech(); };
    speechSynthesis.speak(u);
    btn.classList.add('playing');
    playing = btn;
  });

  // ---------- Тест ----------
  function buildQuiz() {
    const box = $('quizBox');
    let idx = 0, score = 0;
    const L = ['А', 'Б', 'В', 'Г'];

    function show() {
      if (idx >= QUIZ.length) return finish();
      const q = QUIZ[idx];
      box.innerHTML = `
        <div class="quiz__top">
          <span class="quiz__count"><b>${pad(idx + 1)}</b> / ${pad(QUIZ.length)}</span>
          <span class="quiz__stop">Остановка ${idx + 1} · ${STOPS[idx].name}</span>
        </div>
        <div class="quiz__bar"><i style="width:${(idx / QUIZ.length) * 100}%"></i></div>
        <h3 class="quiz__q">${q.q}</h3>
        <div class="quiz__opts">${q.options.map((o, k) => `<button data-k="${k}"><i>${L[k]}</i><span>${o}</span></button>`).join('')}</div>
        <div class="quiz__foot" hidden>
          <p class="quiz__explain"></p>
          <button class="btn btn--primary quiz__next">${idx === QUIZ.length - 1 ? 'Узнать результат' : 'Следующий вопрос'}
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
        ex.innerHTML = `<b class="${ok ? 'ok' : 'no'}">${ok ? 'Верно!' : 'Не совсем.'}</b> ${q.explain}`;
        box.querySelector('.quiz__foot').hidden = false;
      }));
      box.querySelector('.quiz__next').addEventListener('click', () => { idx++; show(); });
    }

    function finish() {
      const msg = score === QUIZ.length ? 'Безупречно! Вы настоящий знаток геоглифов Тургая.'
        : score >= 2 ? 'Хороший результат! Загляните ещё раз в экскурсию.'
        : 'Степь хранит много тайн — попробуйте пройти экскурсию ещё раз.';
      const R = 54, C = 2 * Math.PI * R;
      box.innerHTML = `
        <div class="quiz__result">
          <svg viewBox="0 0 140 140" class="ring" aria-hidden="true">
            <circle cx="70" cy="70" r="${R}" class="ring__bg"/>
            <circle cx="70" cy="70" r="${R}" class="ring__fg" style="stroke-dasharray:${C};stroke-dashoffset:${C}"/>
          </svg>
          <b>${score}<small>/${QUIZ.length}</small></b>
          <p>${msg}</p>
          <button class="btn btn--ghost">Пройти заново</button>
        </div>`;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        box.querySelector('.ring__fg').style.strokeDashoffset = C * (1 - score / QUIZ.length);
      }));
      box.querySelector('button').addEventListener('click', () => { idx = 0; score = 0; show(); });
    }

    show();
  }

  // ---------- Появление, шапка ----------
  function reveal() {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.reveal, .chapter__panel').forEach(el => io.observe(el));
    const nav = $('nav');
    addEventListener('scroll', () => nav.classList.toggle('nav--solid', scrollY > 60), { passive: true });
  }

  // ---------- Запуск ----------
  buildChapters();
  buildRoute();
  buildQuiz();
  reveal();

  try {
    World.init($('world'), {
      altEl: $('hudAlt'),
      onReady() {
        worldOk = true;
        World.setPins(STOPS, go);
        setTimeout(() => World.prefetchAll(STOPS), 1500);
        if (sceneEl) applyScene(sceneEl);
      },
    });
  } catch (err) {
    document.body.classList.add('no-webgl');
  }
  watchScenes();
  if ('speechSynthesis' in window) speechSynthesis.getVoices();

  const done = () => document.body.classList.add('ready');
  Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise(r => setTimeout(r, 2500))])
    .then(() => setTimeout(done, 400));
})();
