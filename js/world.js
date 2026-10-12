// Живой фон сайта: настоящая спутниковая карта (MapLibre + снимки Esri).
// Сцены: hero — Земля из космоса, intro — Казахстан, route — четыре точки маршрута,
// stop — геоглиф крупно; внутри остановки вид «space» (сверху) или «ground» (с земли).
// Контуры геоглифов рисуются поверх снимка по геометрии из js/geo.js.

const World = (function () {
  const GOLD = '#ffc95e';
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const fine = matchMedia('(pointer: fine)').matches;
  const EMPTY = { type: 'FeatureCollection', features: [] };

  let map, ui = {}, scene = 'hero', view = 'space', stop = null, geo = null;
  let figOn = true, eraseStart = 0, eraseFrom = 0;
  let drawStart = 0, drawFrame = 0, spinFrame = 0, pins = [], notes = [], dimMarker = null;

  // Точка, с которой смотрим «с земли», и куда смотрим (метры от центра фигуры)
  const GROUND = {
    ushtogay: { from: [-81, -159], look: [0, 0] },
    swastika: { from: [10, -66], look: [0, 0] },
    shili: { from: [38, -140], look: [0, 0] },
    ashutasty: { from: [25, -222], look: [0, 0] },
  };
  // Поворот карты в виде сверху: фигура встаёт ровно
  // Что держать в кадре в виде сверху: размер (м) и смещение центра кадра от центра фигуры
  const FRAME = { ushtogay: { size: 330 }, swastika: { size: 110 }, shili: { size: 560, at: [-20, -10] }, ashutasty: { size: 470 } };
  const LABEL_BELOW = ['swastika'];
  const EYE = 4; // высота глаз в виде с земли, м
  const BEARING = { ushtogay: 28, swastika: 0, shili: -15, ashutasty: -3 };

  // ---------- геометрия ----------
  const rad = d => (d * Math.PI) / 180;
  const MPP0 = 78271.517; // метров на пиксель на экваторе при zoom 0 (MapLibre, тайлы 512 px)
  const toLL = (c, p) => [c[1] + p[0] / (111320 * Math.cos(rad(c[0]))), c[0] + p[1] / 111320];

  function smoothLine(pts, steps) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let s = 0; s < steps; s++) {
        const t = s / steps, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map(k => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  function sliceLine(pts, f) {
    if (f >= 1) return pts;
    let total = 0;
    const seg = [];
    for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); seg.push(d); total += d; }
    let left = total * f;
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (left >= seg[i - 1]) { out.push(pts[i]); left -= seg[i - 1]; continue; }
      const t = left / seg[i - 1];
      out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
      break;
    }
    return out;
  }

  function circle(c, x, y, r, n) {
    const ring = [];
    for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; ring.push(toLL(c, [x + Math.cos(a) * r, y + Math.sin(a) * r])); }
    return ring;
  }

  function resample(pts, step) {
    const out = [pts[0]];
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let t = step - carry;
      while (t <= d) { out.push([a[0] + ((b[0] - a[0]) * t) / d, a[1] + ((b[1] - a[1]) * t) / d]); t += step; }
      carry = d - (t - step);
    }
    return out;
  }

  // Подготовка фигуры остановки: линии, насыпи, объёмные насыпи для вида с земли
  function prepare(id) {
    const g = GEO[id], c = g.center;
    const lines = g.lines.map(l => (g.smooth ? smoothLine(l, 10) : l));
    const mounds = (g.mounds || []).map(m => ({ x: m[0], y: m[1], r: m[2] }));
    // Порядок появления насыпей — от центра наружу
    mounds.forEach(m => { m.order = Math.hypot(m.x, m.y); });
    const maxO = Math.max(1, ...mounds.map(m => m.order));
    mounds.forEach(m => { m.order /= maxO; });

    // Объём: насыпь — три ступени, вал — цепочка таких же «бусин»
    const solids = [];
    const KS = [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.63, 0.56, 0.49, 0.42, 0.35, 0.28, 0.2, 0.12];
    const dome = (x, y, r, h) => KS.forEach((k, i) => {
      const kn = KS[i + 1] !== undefined ? KS[i + 1] : 0;
      solids.push({ type: 'Feature', properties: { h: h * Math.pow(1 - kn * kn, 0.75) }, geometry: { type: 'Polygon', coordinates: [circle(c, x, y, r * k, 20)] } });
    });
    mounds.forEach(m => dome(m.x, m.y, m.r, 2.2));
    (g.ramparts || []).forEach(l => resample(g.smooth ? smoothLine(l, 10) : l, 3).forEach(p => dome(p[0], p[1], g.rampartW / 2, 1.8)));

    const rings = (g.rings || []).map(r => circle(c, r[0], r[1], r[2], 48).map(ll => ll));
    return { id, g, c, lines, mounds, rings, solids: { type: 'FeatureCollection', features: solids } };
  }

  // ---------- отрисовка фигуры с анимацией ----------
  function frame() {
    if (!geo) return;
    const now = performance.now();
    const t = eraseStart ? Math.max(0, eraseFrom * (1 - (now - eraseStart) / 900)) : (now - drawStart) / 1000;
    const f = Math.min(1, Math.max(0, (t - 0.2) / 2.6)), e = 1 - Math.pow(1 - f, 3);
    const c = geo.c;

    const feats = geo.lines.map(l => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: sliceLine(l, e).map(p => toLL(c, p)) } }));
    const rf = Math.min(1, Math.max(0, (t - 1.6) / 1.6));
    geo.rings.forEach(r => feats.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.slice(0, Math.max(2, Math.ceil(r.length * rf))) } }));
    map.getSource('fig-lines').setData({ type: 'FeatureCollection', features: feats });

    const mf = geo.mounds.map(m => {
      const k = Math.min(1, Math.max(0, (t - 0.1 - m.order * 1.6) / 0.5));
      const s = k <= 0 ? 0.001 : 1 - Math.pow(1 - k, 3);
      return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circle(c, m.x, m.y, m.r * s, 16)] } };
    });
    map.getSource('fig-mounds').setData({ type: 'FeatureCollection', features: mf });

    const dimOn = t > 2.4;
    if (dimMarker) dimMarker.getElement().firstChild.classList.toggle('on', dimOn && view === 'space');
    notes.forEach(n => n.getElement().firstChild.classList.toggle('on', t > 3 && view === 'space'));

    if (eraseStart ? t > 0 : t < 4.2) drawFrame = requestAnimationFrame(frame);
  }

  function clearFigure() {
    cancelAnimationFrame(drawFrame);
    geo = null;
    if (ui.container) ui.container.classList.remove('world--fig');
    if (!map.getSource('fig-lines')) return;
    ['fig-lines', 'fig-mounds', 'fig-solids', 'fig-dim'].forEach(s => map.getSource(s).setData(EMPTY));
    if (dimMarker) { dimMarker.remove(); dimMarker = null; }
    notes.forEach(n => n.remove()); notes = [];
  }

  function buildFigure(s) {
    clearFigure();
    geo = prepare(s.id);
    drawStart = 0; eraseStart = 0;
    ui.container.classList.add('world--fig');
    const g = geo.g, c = geo.c;
    map.getSource('fig-solids').setData(geo.solids);

    // Размерная линия с засечками
    let [a, b] = g.dim;
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    let ox = -dy / L, oy = dx / L;
    if (ox * (a[0] + b[0]) + oy * (a[1] + b[1]) < 0) { ox = -ox; oy = -oy; }
    a = [a[0] + ox * 24, a[1] + oy * 24]; b = [b[0] + ox * 24, b[1] + oy * 24];
    const nx = ox * 6, ny = oy * 6;
    map.getSource('fig-dim').setData({ type: 'FeatureCollection', features: [
      [a, b], [[a[0] - nx, a[1] - ny], [a[0] + nx, a[1] + ny]], [[b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny]],
    ].map(l => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: l.map(p => toLL(c, p)) } })) });
    const el = document.createElement('div');
    el.innerHTML = `<div class="dim-tag">${g.label}</div>`;
    dimMarker = new maplibregl.Marker({ element: el }).setLngLat(toLL(c, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])).addTo(map);

    notes = (g.notes || []).map(n => {
      const e = document.createElement('div');
      e.innerHTML = `<div class="map-note"><i></i><span>${n.text}</span></div>`;
      return new maplibregl.Marker({ element: e, anchor: 'left', offset: [-4, 0] }).setLngLat(toLL(c, n.at)).addTo(map);
    });

  }

  function startDraw() {
    if (!geo || !figOn) return;
    eraseStart = 0;
    drawStart = performance.now();
    cancelAnimationFrame(drawFrame);
    drawFrame = requestAnimationFrame(frame);
  }

  // ---------- предзагрузка снимков ----------
  // Тайлы следующих сцен заранее скачиваются в кэш браузера, чтобы при перелёте
  // снимок не «проявлялся» на глазах. Не больше 4 запросов одновременно.
  const queue = [], queued = new Set();
  let active = 0;
  function pump() {
    while (active < 4 && queue.length) {
      const url = queue.shift();
      active++;
      fetch(url, { mode: 'cors', credentials: 'same-origin', priority: 'low' })
        .catch(() => {}).finally(() => { active--; pump(); });
    }
  }
  function tileXY(lng, lat, z) {
    const n = Math.pow(2, z);
    return [Math.floor(((lng + 180) / 360) * n), Math.floor(((1 - Math.asinh(Math.tan(rad(lat))) / Math.PI) / 2) * n)];
  }
  // Область вокруг точки в размер экрана (с запасом) на уровне снимков, который выберет карта, и на уровень ниже
  function prefetch(lng, lat, zoom, spread) {
    const mpp = (MPP0 * Math.cos(rad(lat))) / Math.pow(2, zoom);
    const dLng = (innerWidth * mpp * spread) / 2 / (111320 * Math.cos(rad(lat))), dLat = (innerHeight * mpp * spread) / 2 / 111320;
    const tz = Math.min(17, Math.round(zoom + 1));
    [tz, tz - 1].forEach(z => {
      const [x0, y0] = tileXY(lng - dLng, lat + dLat, z), [x1, y1] = tileXY(lng + dLng, lat - dLat, z);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const url = ESRI.replace('{z}', z).replace('{y}', y).replace('{x}', x);
        if (!queued.has(url)) { queued.add(url); queue.push(url); }
      }
    });
    pump();
  }
  function prefetchAll(stops) {
    prefetch(65.4, 50.3, 3.4, 1.6);
    prefetch(65.745, 50.3, 7.5, 2.2);
    stops.forEach(s => {
      const p = spacePose(s);
      prefetch(p.center[0], p.center[1], p.zoom, 1.5);
    });
  }

  // Вызвать, когда снимок на экране догрузился (но не дольше 1,5 с)
  function whenSharp(cb) {
    if (map.areTilesLoaded()) { cb(); return; }
    let done = false;
    const go = () => { if (done) return; done = true; map.off('idle', go); cb(); };
    map.on('idle', go);
    setTimeout(go, 1500);
  }

  // ---------- камера ----------
  function padding() {
    const w = innerWidth, h = innerHeight;
    if (w > 900) return { left: Math.min(560, w * 0.42), right: 90, top: 90, bottom: 60 };
    return { left: 20, right: 20, top: 70, bottom: h * 0.35 };
  }

  function fitZoom(size, lat) {
    const p = padding(), avail = Math.min(innerWidth - p.left - p.right, innerHeight - p.top - p.bottom);
    const mpp = size / (avail * 0.78);
    return Math.min(17, Math.log2((MPP0 * Math.cos(rad(lat))) / mpp));
  }

  function spacePose(s) {
    const f = FRAME[s.id], c = GEO[s.id].center, at = toLL(c, f.at || [0, 0]);
    return { center: at, zoom: fitZoom(f.size, c[0]), pitch: 0, bearing: BEARING[s.id] || 0, padding: padding() };
  }

  function setLook(kind) {
    const night = kind === 'night';
    map.setPaintProperty('sat', 'raster-brightness-max', night ? 0.62 : 1);
    map.setPaintProperty('sat', 'raster-saturation', night ? -0.35 : 0.08);
    map.setPaintProperty('sat', 'raster-contrast', night ? 0.05 : 0.12);
    ui.container.classList.toggle('world--night', night);
  }

  function fly(opts, duration) {
    stopSpin();
    map.stop();
    const o = { duration: duration || 3200, essential: true, ...opts };
    if (o.minZoom === undefined) o.curve = 1.5;
    map.flyTo(o);
  }

  // Медленное вращение: Земля в hero, лёгкий облёт фигуры в виде сверху
  function stopSpin() { cancelAnimationFrame(spinFrame); spinFrame = 0; }
  function startSpin(kind) {
    stopSpin();
    let last = performance.now();
    const base = map.getBearing();
    const t0 = last;
    const step = now => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (kind === 'globe') {
        const c = map.getCenter();
        map.jumpTo({ center: [c.lng + dt * 2.2, c.lat] });
      } else {
        map.jumpTo({ bearing: base + Math.sin((now - t0) / 9000) * 7 });
      }
      spinFrame = requestAnimationFrame(step);
    };
    spinFrame = requestAnimationFrame(step);
  }

  function setInteractive(on) {
    const h = ['dragPan', 'dragRotate', 'touchZoomRotate', 'doubleClickZoom', 'keyboard'];
    h.forEach(k => (on ? map[k].enable() : map[k].disable()));
    ui.container.classList.toggle('world--live', on);
  }

  // ---------- публичные методы ----------
  function init(container, opts) {
    ui = { container, alt: opts.altEl, onReady: opts.onReady };
    const small = innerWidth < 700;
    map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        projection: { type: 'globe' },
        sky: {
          'sky-color': '#16243f', 'horizon-color': '#f4cf98', 'fog-color': '#e8d6b0',
          'sky-horizon-blend': 0.55, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.75,
          'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 8, 0],
        },
        transition: { duration: 1400, delay: 0 },
        sources: {
          sat: { type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom: 17, attribution: 'Снимки © Esri, Maxar, Earthstar Geographics' },
        },
        layers: [{ id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-fade-duration': 400 } }],
      },
      center: [58, 44], zoom: small ? 0.9 : 1.6, pitch: 0, bearing: 0,
      maxPitch: 85, interactive: true, scrollZoom: false, attributionControl: false,
      fadeDuration: 300,
      maxTileCacheSize: 2500,
      cancelPendingTileRequestsWhileZooming: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    setInteractive(false);

    map.on('load', () => {
      map.addSource('route', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round' },
        paint: { 'line-color': GOLD, 'line-width': 2, 'line-dasharray': [0.5, 3], 'line-opacity': 0 } });

      ['fig-lines', 'fig-mounds', 'fig-solids', 'fig-dim'].forEach(s => map.addSource(s, { type: 'geojson', data: EMPTY }));
      map.addLayer({ id: 'fig-mound-fill', type: 'fill', source: 'fig-mounds', paint: { 'fill-color': GOLD, 'fill-opacity': 0.2 } });
      map.addLayer({ id: 'fig-halo', type: 'line', source: 'fig-lines', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': GOLD, 'line-opacity': 0.35, 'line-blur': 8,
          'line-width': ['interpolate', ['exponential', 2], ['zoom'], 12, 3, 16, 14, 19, 60] } });
      map.addLayer({ id: 'fig-core', type: 'line', source: 'fig-lines', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffe2a3', 'line-opacity': 0.95,
          'line-width': ['interpolate', ['exponential', 2], ['zoom'], 12, 0.8, 16, 2.2, 19, 8] } });
      map.addLayer({ id: 'fig-mound-line', type: 'line', source: 'fig-mounds',
        paint: { 'line-color': '#fff1cc', 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.6, 18, 1.6] } });
      map.addLayer({ id: 'fig-dim', type: 'line', source: 'fig-dim', paint: { 'line-color': '#ffffff', 'line-opacity': 0.75, 'line-width': 1 } });
      map.addLayer({ id: 'fig-solids', type: 'fill-extrusion', source: 'fig-solids',
        paint: { 'fill-extrusion-color': '#b49f6a', 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0,
          'fill-extrusion-vertical-gradient': false } });
      map.setLight({ anchor: 'map', color: '#fff4e0', intensity: 0.22, position: [1.15, 250, 35] });
      [['fig-halo', 'line'], ['fig-core', 'line'], ['fig-mound-line', 'line'], ['fig-dim', 'line'],
        ['fig-mound-fill', 'fill'], ['fig-solids', 'fill-extrusion']].forEach(([l, k]) =>
        map.setPaintProperty(l, k + '-opacity-transition', { duration: 700, delay: 0 }));
      setLook('night');
      startSpin('globe');
      if (ui.onReady) ui.onReady();
    });

    map.on('move', () => {
      if (!ui.alt) return;
      const z = map.getZoom(), mpp = (MPP0 * Math.cos(rad(map.getCenter().lat))) / Math.pow(2, z);
      const alt = view === 'ground' && scene === 'stop' ? 1.7 : 1.5 * innerHeight * mpp * Math.cos(rad(map.getPitch()));
      ui.alt.textContent = alt > 20000 ? Math.round(alt / 1000).toLocaleString('ru-RU') + ' км' : Math.max(2, Math.round(alt)).toLocaleString('ru-RU') + ' м';
    });
  }

  function setPins(stops, onClick) {
    map.getSource('route').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: stops.map(s => [GEO[s.id].center[1], GEO[s.id].center[0]]) } });
    pins = stops.map((s, i) => {
      const el = document.createElement('div');
      el.className = 'pin-wrap' + (LABEL_BELOW.includes(s.id) ? ' pin-wrap--below' : '');
      el.innerHTML = `<button class="pin" aria-label="${s.name}"><span class="pin__ring"></span><span class="pin__n">${i + 1}</span><span class="pin__label">${s.name}</span></button>`;
      el.firstChild.addEventListener('click', () => onClick(i));
      return new maplibregl.Marker({ element: el }).setLngLat([GEO[s.id].center[1], GEO[s.id].center[0]]).addTo(map);
    });
  }

  function showPins(on) {
    ui.container.classList.toggle('world--pins', on);
    map.setPaintProperty('route', 'line-opacity', on ? 0.9 : 0);
  }

  function leaveGround() { if (window.Ground3D) Ground3D.hide(); }

  function showHero() {
    leaveGround();
    scene = 'hero'; stop = null; clearFigure(); showPins(false); setLook('night'); setInteractive(false);
    map.setPaintProperty('fig-solids', 'fill-extrusion-opacity', 0);
    const small = innerWidth < 700;
    fly({ center: [58, 44], zoom: small ? 0.9 : 1.6, pitch: 0, bearing: 0, padding: { left: 0, right: 0, top: 0, bottom: 0 } }, 3000);
    map.once('moveend', () => { if (scene === 'hero') startSpin('globe'); });
  }

  function showIntro() {
    leaveGround();
    scene = 'intro'; stop = null; clearFigure(); showPins(false); setLook('night'); setInteractive(false);
    const wide = innerWidth > 900;
    fly({ center: [65.4, 50.3], zoom: innerWidth < 700 ? 2.6 : 3.4, pitch: 0, bearing: 0,
      padding: wide ? { left: innerWidth * 0.35, right: 0, top: 0, bottom: 0 } : { left: 0, right: 0, top: 0, bottom: 0 } }, 3000);
  }

  function showRoute() {
    leaveGround();
    scene = 'route'; stop = null; clearFigure(); setLook('day'); showPins(true); setInteractive(false);
    map.setPaintProperty('fig-solids', 'fill-extrusion-opacity', 0);
    const wide = innerWidth > 900;
    const col = Math.max(16, (innerWidth - 1280) / 2) + 470 + 40;
    fly({ center: [65.745, 50.3], zoom: wide ? 7.5 : 7.4, pitch: 40, bearing: -12,
      padding: wide ? { left: col, right: 220, top: 110, bottom: 60 } : { left: 0, right: 0, top: 230, bottom: 300 } }, 3400);
  }

  function showStop(s) {
    leaveGround();
    scene = 'stop'; stop = s; view = 'space'; showPins(false); setLook('day');
    buildFigure(s);
    applyView(false);
    const from = map.getZoom();
    fly({ ...spacePose(s), ...(from > 9 ? { minZoom: 9.5 } : {}) }, 3400);
    map.once('moveend', () => whenSharp(() => {
      if (scene !== 'stop' || stop !== s) return;
      startDraw();
      if (view === 'space') startSpin('orbit');
    }));
    setInteractive(fine);
  }

  function groundPose(s) {
    const g = GEO[s.id], c = g.center, gp = GROUND[s.id];
    const dx = gp.look[0] - gp.from[0], dy = gp.look[1] - gp.from[1], L = Math.hypot(dx, dy);
    const eye = EYE, ahead = eye * Math.tan(rad(81));
    const target = [gp.from[0] + (dx / L) * ahead, gp.from[1] + (dy / L) * ahead];
    const from = toLL(c, gp.from), to = toLL(c, target);
    const cam = map.calculateCameraOptionsFromTo(new maplibregl.LngLat(from[0], from[1]), eye, new maplibregl.LngLat(to[0], to[1]), 0);
    return { ...cam, padding: { left: 0, right: 0, top: 0, bottom: 0 } };
  }

  // Сверху — светящийся контур; с земли — только объёмные насыпи
  function applyView(ground) {
    const top = !ground && figOn, low = ground && figOn;
    map.setPaintProperty('fig-solids', 'fill-extrusion-opacity', 0); // объём с земли рисует Ground3D
    map.setPaintProperty('fig-halo', 'line-opacity', top ? 0.35 : 0);
    map.setPaintProperty('fig-core', 'line-opacity', top ? 0.95 : 0);
    map.setPaintProperty('fig-mound-fill', 'fill-opacity', top ? 0.2 : 0);
    map.setPaintProperty('fig-mound-line', 'line-opacity', top ? 0.85 : 0);
    map.setPaintProperty('fig-dim', 'line-opacity', top ? 0.75 : 0);
    const drawn = drawStart > 0 && performance.now() - drawStart > 3000;
    if (dimMarker) dimMarker.getElement().firstChild.classList.toggle('on', top && drawn);
    notes.forEach(n => n.getElement().firstChild.classList.toggle('on', top && drawn));
  }

  function toggleView() {
    if (scene !== 'stop' || !stop) return view;
    view = view === 'space' ? 'ground' : 'space';
    const ground = view === 'ground';
    applyView(ground);
    if (ground) {
      // Карта опускается к земле, затем плавно проявляется 3D-сцена на уровне глаз
      fly(groundPose(stop), 2800);
      const s = stop;
      setTimeout(() => { if (scene === 'stop' && stop === s && view === 'ground' && window.Ground3D) Ground3D.show(s.id, GROUND[s.id]); }, 600);
    } else {
      leaveGround();
      fly(spacePose(stop), 3600);
      const s = stop;
      map.once('moveend', () => { if (scene === 'stop' && stop === s && view === 'space') startSpin('orbit'); });
    }
    return view;
  }

  // Скрыть рисунок — он «стирается» в обратном порядке; показать — прорисовывается заново
  function setFigure(on) {
    if (on === figOn) return;
    figOn = on;
    ui.container.classList.toggle('world--nofig', !on);
    if (on) {
      eraseStart = 0;
      applyView(view === 'ground');
      startDraw();
      return;
    }
    map.setPaintProperty('fig-solids', 'fill-extrusion-opacity', 0);
    map.setPaintProperty('fig-dim', 'line-opacity', 0);
    if (!geo || !drawStart) { applyView(view === 'ground'); return; }
    eraseFrom = Math.min(4.2, (performance.now() - drawStart) / 1000);
    eraseStart = performance.now();
    cancelAnimationFrame(drawFrame);
    drawFrame = requestAnimationFrame(frame);
  }

  function pause(p) {
    if (p) { leaveGround(); stopSpin(); setInteractive(false); scene = 'off'; }
  }

  return { init, setPins, prefetchAll, showHero, showIntro, showRoute, showStop, toggleView, setFigure, pause, getView: () => view };
})();
