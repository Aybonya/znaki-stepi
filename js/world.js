// Живой фон сайта: настоящая спутниковая карта (MapLibre + снимки Esri).
// Сцены: hero — Земля из космоса, intro — Казахстан, route — четыре точки маршрута,
// stop — геоглиф крупно; внутри остановки вид «space» (сверху) или «orbit» (3D: наклон и облёт, насыпи объёмные).
// Контуры геоглифов рисуются поверх снимка по геометрии из js/geo.js.

const World = (function () {
  const GOLD = '#ffc95e';
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const fine = matchMedia('(pointer: fine)').matches;
  const EMPTY = { type: 'FeatureCollection', features: [] };

  let map, ui = {}, scene = 'hero', stop = null, geo = null;
  let figOn = true, eraseStart = 0, eraseFrom = 0;
  let drawStart = 0, drawFrame = 0, spinFrame = 0, pins = [], notes = [], dimMarker = null;

  // Поворот карты в виде сверху: фигура встаёт ровно
  // Что держать в кадре в виде сверху: размер (м) и смещение центра кадра от центра фигуры
  const FRAME = { ushtogay: { size: 330 }, swastika: { size: 110 }, shili: { size: 560, at: [-20, -10] }, ashutasty: { size: 470 } };
  const LABEL_BELOW = ['swastika'];
  // В 3D рельеф и насыпи увеличены по высоте одинаково — насыпи остаются частью ландшафта
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

  // Подготовка фигуры остановки: линии, насыпи, кольцевые курганы
  function prepare(id) {
    const g = GEO[id], c = g.center;
    const lines = g.lines.map(l => (g.smooth ? smoothLine(l, 10) : l));
    const mounds = (g.mounds || []).map(m => ({ x: m[0], y: m[1], r: m[2] }));
    // Порядок появления насыпей — от центра наружу
    mounds.forEach(m => { m.order = Math.hypot(m.x, m.y); });
    const maxO = Math.max(1, ...mounds.map(m => m.order));
    mounds.forEach(m => { m.order /= maxO; });

    const rings = (g.rings || []).map(r => circle(c, r[0], r[1], r[2], 48).map(ll => ll));
    return { id, g, c, lines, mounds, rings };
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
    if (dimMarker) dimMarker.getElement().firstChild.classList.toggle('on', dimOn && !exploring);
    notes.forEach(n => n.getElement().firstChild.classList.toggle('on', t > 3));

    if (eraseStart ? t > 0 : t < 4.2) drawFrame = requestAnimationFrame(frame);
  }

  function clearFigure() {
    cancelAnimationFrame(drawFrame);
    geo = null;
    if (ui.container) ui.container.classList.remove('world--fig');
    if (!map.getSource('fig-lines')) return;
    ['fig-lines', 'fig-mounds', 'fig-dim'].forEach(s => map.getSource(s).setData(EMPTY));
    if (dimMarker) { dimMarker.remove(); dimMarker = null; }
    notes.forEach(n => n.remove()); notes = [];
  }

  function buildFigure(s) {
    clearFigure();
    geo = prepare(s.id);
    drawStart = 0; eraseStart = 0;
    ui.container.classList.add('world--fig');
    const g = geo.g, c = geo.c;

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
      e.innerHTML = `<div class="map-note"><i></i><span data-ru="${n.text}">${I18N.word(n.text)}</span></div>`;
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
    prefetch(66.0, 50.45, 7.3, 2.2);
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
    return { left: 20, right: 20, top: 120, bottom: h * 0.38 };
  }

  // На телефоне текст главной стоит внизу экрана — глобус поднимаем над ним
  const heroPad = () => ({ left: 0, right: 0, top: 0, bottom: innerWidth < 700 ? Math.round(innerHeight * 0.34) : 0 });

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
    if (exploring) return;
    let last = performance.now();
    const base = map.getBearing();
    const t0 = last;
    const step = now => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (kind === 'globe') {
        const c = map.getCenter();
        map.jumpTo({ center: [c.lng + dt * 2.2, c.lat] });
      } else if (kind === 'turn') {
        map.jumpTo({ bearing: map.getBearing() + dt * 6 });
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
        layers: [
          { id: 'sat', type: 'raster', source: 'sat', paint: { 'raster-fade-duration': 400 } },
        ],
      },
      center: [58, 44], zoom: small ? 0.9 : 1.6, pitch: 0, bearing: 0,
      maxPitch: 85, maxZoom: 18.5, interactive: true, scrollZoom: false, attributionControl: false,
      fadeDuration: 300,
      maxTileCacheSize: 2500,
      cancelPendingTileRequestsWhileZooming: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
    map.setPadding(heroPad());
    setInteractive(false);

    map.on('load', () => {
      map.addSource('route', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round' },
        paint: { 'line-color': GOLD, 'line-width': 2, 'line-dasharray': [0.5, 3], 'line-opacity': 0 } });

      // План поездки: дороги — сплошные, грунтовки и броды — пунктир; у каждого дня свой цвет
      const dayColor = ['match', ['get', 'day'], 1, GOLD, '#ff9560'];
      map.addSource('trip', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'trip-case', type: 'line', source: 'trip', filter: ['==', ['get', 'kind'], 'road'],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0b0c10', 'line-width': 7, 'line-opacity': 0, 'line-blur': 1 } });
      map.addLayer({ id: 'trip-road', type: 'line', source: 'trip', filter: ['==', ['get', 'kind'], 'road'],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': dayColor, 'line-width': 3.4, 'line-opacity': 0 } });
      map.addLayer({ id: 'trip-track', type: 'line', source: 'trip', filter: ['==', ['get', 'kind'], 'track'],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': dayColor, 'line-width': 2.6, 'line-dasharray': [1.2, 1.8], 'line-opacity': 0 } });

      ['fig-lines', 'fig-mounds', 'fig-dim'].forEach(s => map.addSource(s, { type: 'geojson', data: EMPTY }));
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
      [['fig-halo', 'line'], ['fig-core', 'line'], ['fig-mound-line', 'line'], ['fig-dim', 'line'],
        ['fig-mound-fill', 'fill']].forEach(([l, k]) =>
        map.setPaintProperty(l, k + '-opacity-transition', { duration: 700, delay: 0 }));
      setLook('night');
      startSpin('globe');
      if (ui.onReady) ui.onReady();
    });

    map.on('move', () => {
      if (!ui.alt) return;
      const z = map.getZoom(), mpp = (MPP0 * Math.cos(rad(map.getCenter().lat))) / Math.pow(2, z);
      const alt = 1.5 * innerHeight * mpp * Math.cos(rad(map.getPitch()));
      ui.alt.textContent = alt > 20000 ? Math.round(alt / 1000).toLocaleString('ru-RU') + ' км' : Math.max(2, Math.round(alt)).toLocaleString('ru-RU') + ' м';
    });
  }

  function setPins(stops, onClick) {
    stopsList = stops;
    map.getSource('route').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: stops.map(s => [GEO[s.id].center[1], GEO[s.id].center[0]]) } });
    pins = stops.map((s, i) => {
      const el = document.createElement('div');
      el.className = 'pin-wrap' + (LABEL_BELOW.includes(s.id) ? ' pin-wrap--below' : '');
      el.innerHTML = `<button class="pin" aria-label="${s.name}"><span class="pin__ring"></span><span class="pin__n">${i + 1}</span><span class="pin__label">${s.name}</span></button>`;
      el.firstChild.addEventListener('click', () => (exploring ? exploreTo(i) : onClick(i)));
      return new maplibregl.Marker({ element: el }).setLngLat([GEO[s.id].center[1], GEO[s.id].center[0]]).addTo(map);
    });
  }

  function showPins(on, line = true) {
    ui.container.classList.toggle('world--pins', on);
    map.setPaintProperty('route', 'line-opacity', on && line ? 0.9 : 0);
  }

  // ---------- план поездки ----------
  let trip = null, tripDrawn = false, tripFrame = 0, placeEls = [];
  function setTrip(t, places) {
    trip = t;
    placeEls = places.map(p => {
      const el = document.createElement('div');
      el.innerHTML = `<div class="place"><i></i><span><b>${p.name}</b><small>${p.tag}</small></span></div>`;
      new maplibregl.Marker({ element: el, anchor: 'left', offset: [-6, 0] }).setLngLat(p.at).addTo(map);
      return el;
    });
  }

  // Смена языка: переписать подписи, не трогая маркеры
  function relabel(stops, places) {
    pins.forEach((m, i) => {
      const b = m.getElement().querySelector('.pin');
      b.setAttribute('aria-label', stops[i].name);
      b.querySelector('.pin__label').textContent = stops[i].name;
    });
    placeEls.forEach((el, i) => {
      el.querySelector('b').textContent = places[i].name;
      el.querySelector('small').textContent = places[i].tag;
    });
    notes.forEach(m => { const sp = m.getElement().querySelector('[data-ru]'); sp.textContent = I18N.word(sp.dataset.ru); });
  }

  // Маршрут прорисовывается по порядку — от старта до финиша
  function drawTrip() {
    tripDrawn = true;
    const segs = trip.segments, lens = segs.map(sg => {
      let d = 0;
      for (let i = 1; i < sg.c.length; i++) d += Math.hypot(sg.c[i][0] - sg.c[i - 1][0], sg.c[i][1] - sg.c[i - 1][1]);
      return d;
    });
    const total = lens.reduce((a, b) => a + b, 0), t0 = performance.now();
    const step = now => {
      const f = Math.min(1, (now - t0) / 3200), e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      let left = total * e;
      const feats = [];
      segs.forEach((sg, i) => {
        if (left <= 0) return;
        const k = Math.min(1, left / (lens[i] || 1));
        left -= lens[i];
        feats.push({ type: 'Feature', properties: { day: sg.day, kind: sg.kind }, geometry: { type: 'LineString', coordinates: sliceLine(sg.c, k) } });
      });
      map.getSource('trip').setData({ type: 'FeatureCollection', features: feats });
      if (f < 1) tripFrame = requestAnimationFrame(step);
    };
    cancelAnimationFrame(tripFrame);
    tripFrame = requestAnimationFrame(step);
  }

  function tripPadding() {
    if (innerWidth > 900) return { left: Math.max(16, (innerWidth - 1280) / 2) + 520 + 40, right: 120, top: 110, bottom: 70 };
    return { left: 30, right: 30, top: 80, bottom: innerHeight * 0.5 };
  }

  // day: 'all' | 1 | 2 — какой день показать (остальное притушено)
  function showTrip(day) {
    if (!trip) return;
    leaveGround();
    scene = 'trip'; stop = null; clearFigure(); setLook('day'); setInteractive(false);
    showPins(true, false);
    ui.container.classList.add('world--trip');
    const d = day === 'all' ? 0 : +day;
    const op = hi => (d ? ['case', ['==', ['get', 'day'], d], hi, hi * 0.22] : hi);
    map.setPaintProperty('trip-road', 'line-opacity', op(1));
    map.setPaintProperty('trip-track', 'line-opacity', op(0.95));
    map.setPaintProperty('trip-case', 'line-opacity', op(0.55));
    if (!tripDrawn) drawTrip();
    // Кадр считаем сами: центр — середина маршрута, масштаб — чтобы он поместился в свободную часть экрана
    const pts = [].concat(...trip.segments.filter(sg => !d || sg.day === d).map(sg => sg.c));
    const lngs = pts.map(p => p[0]), lats = pts.map(p => p[1]);
    const lng0 = Math.min(...lngs), lng1 = Math.max(...lngs), lat0 = Math.min(...lats), lat1 = Math.max(...lats);
    const lat = (lat0 + lat1) / 2, pad = tripPadding();
    const wM = (lng1 - lng0) * 111320 * Math.cos(rad(lat)), hM = (lat1 - lat0) * 111320;
    const availW = Math.max(200, innerWidth - pad.left - pad.right), availH = Math.max(200, innerHeight - pad.top - pad.bottom);
    const mpp = Math.max(wM / availW, hM / (availH * 0.8));
    const zoom = Math.log2((MPP0 * Math.cos(rad(lat))) / mpp) - 0.15;
    fly({ center: [(lng0 + lng1) / 2, lat], zoom, bearing: -10, pitch: 38, padding: pad }, 3000);
  }

  // Подлететь к точке плана (по клику на шаг)
  function flyToPlace(at, zoom) {
    if (scene !== 'trip') return;
    fly({ center: at, zoom: zoom || 12.5, pitch: 50, bearing: map.getBearing(), padding: tripPadding() }, 2600);
  }

  function leaveGround() {
    ui.container.classList.remove('world--trip');
    if (map && map.getLayer && map.getLayer('trip-road')) ['trip-road', 'trip-track', 'trip-case'].forEach(l => map.setPaintProperty(l, 'line-opacity', 0));
  }

  function showHero() {
    leaveGround();
    scene = 'hero'; stop = null; clearFigure(); showPins(false); setLook('night'); setInteractive(false);
    const small = innerWidth < 700;
    fly({ center: [58, 44], zoom: small ? 0.9 : 1.6, pitch: 0, bearing: 0, padding: heroPad() }, 3000);
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
    const wide = innerWidth > 900;
    const col = Math.max(16, (innerWidth - 1280) / 2) + 470 + 40;
    fly({ center: [65.745, 50.3], zoom: wide ? 7.5 : 7.4, pitch: 40, bearing: -12,
      padding: wide ? { left: col, right: 220, top: 110, bottom: 60 } : { left: 0, right: 0, top: 230, bottom: 300 } }, 3400);
  }

  function showStop(s) {
    leaveGround();
    scene = 'stop'; stop = s; showPins(false); setLook('day');
    buildFigure(s);
    applyView(false);
    const from = map.getZoom();
    fly({ ...spacePose(s), ...(from > 9 ? { minZoom: 9.5 } : {}) }, 3400);
    map.once('moveend', () => whenSharp(() => {
      if (scene !== 'stop' || stop !== s) return;
      startDraw();
      startSpin('orbit');
    }));
    setInteractive(fine);
  }

  // Сверху — яркий контур; под наклоном контур приглушён, чтобы были видны сами насыпи на снимке
  function applyView(orbit) {
    const on = figOn;
    map.setPaintProperty('fig-halo', 'line-opacity', on ? (orbit ? 0.2 : 0.35) : 0);
    map.setPaintProperty('fig-core', 'line-opacity', on ? (orbit ? 0.55 : 0.95) : 0);
    map.setPaintProperty('fig-mound-fill', 'fill-opacity', on ? (orbit ? 0.1 : 0.2) : 0);
    map.setPaintProperty('fig-mound-line', 'line-opacity', on ? (orbit ? 0.5 : 0.85) : 0);
    map.setPaintProperty('fig-dim', 'line-opacity', on && !orbit ? 0.75 : 0);
    const drawn = drawStart > 0 && performance.now() - drawStart > 3000;
    if (dimMarker) dimMarker.getElement().firstChild.classList.toggle('on', on && !orbit && drawn);
    notes.forEach(n => n.getElement().firstChild.classList.toggle('on', on && drawn));
  }

  function orbitPose(s) {
    const p = spacePose(s);
    return { ...p, zoom: p.zoom + 0.1, pitch: 64, bearing: p.bearing + 35 };
  }

  // Скрыть рисунок — он «стирается» в обратном порядке; показать — прорисовывается заново
  function setFigure(on) {
    if (on === figOn) return;
    figOn = on;
    ui.container.classList.toggle('world--nofig', !on);
    if (on) {
      eraseStart = 0;
      applyView(exploring && map.getPitch() > 25);
      startDraw();
      return;
    }
    map.setPaintProperty('fig-dim', 'line-opacity', 0);
    if (!geo || !drawStart) { applyView(exploring && map.getPitch() > 25); return; }
    eraseFrom = Math.min(4.2, (performance.now() - drawStart) / 1000);
    eraseStart = performance.now();
    cancelAnimationFrame(drawFrame);
    drawFrame = requestAnimationFrame(frame);
  }

  // ---------- 3D: свободный просмотр, карта целиком в руках зрителя ----------
  const ZERO = { left: 0, right: 0, top: 0, bottom: 0 };
  const FREE = ['scrollZoom', 'boxZoom', 'dragPan', 'dragRotate', 'touchZoomRotate', 'touchPitch', 'doubleClickZoom', 'keyboard'];
  let exploring = false, navCtl = null, stopsList = [], exploreFrom = -1, exploreIdx = -1, pitchRaf = 0;

  // Наклонили карту — контур приглушён; смотрим сверху — светящийся рисунок
  function onExplorePitch() {
    if (pitchRaf) return;
    pitchRaf = requestAnimationFrame(() => { pitchRaf = 0; if (exploring) applyView(map.getPitch() > 25); });
  }

  function exploreTo(i) {
    const s = stopsList[i];
    exploreIdx = i; scene = 'stop'; stop = s;
    buildFigure(s);
    applyView(map.getPitch() > 25);
    const p = spacePose(s);
    fly({ center: p.center, zoom: p.zoom, pitch: map.getPitch(), bearing: map.getBearing(), padding: ZERO }, 2800);
    map.once('moveend', () => whenSharp(() => { if (exploring && stop === s) startDraw(); }));
  }

  // Включить / выключить. При выходе возвращает номер остановки, если зритель перелетел к другому геоглифу (иначе -1)
  function explore(on) {
    if (on === exploring) return -1;
    exploring = on;
    stopSpin(); map.stop();
    ui.container.classList.toggle('world--explore', on);
    if (on) {
      exploreFrom = exploreIdx = stop ? stopsList.indexOf(stop) : -1;
      FREE.forEach(k => map[k].enable());
      navCtl = new maplibregl.NavigationControl({ visualizePitch: true });
      map.addControl(navCtl, 'top-right');
      setLook('day');
      showPins(true);
      map.on('pitch', onExplorePitch);
      // С остановки — плавный облёт к геоглифу под наклоном
      if (scene === 'stop' && stop) fly({ ...orbitPose(stop), padding: ZERO }, 2600);
      else map.easeTo({ padding: ZERO, duration: 800 });
      return -1;
    }
    map.off('pitch', onExplorePitch);
    FREE.forEach(k => map[k].disable());
    if (navCtl) { map.removeControl(navCtl); navCtl = null; }
    showPins(scene === 'route');
    if (exploreIdx !== exploreFrom && exploreIdx >= 0) return exploreIdx; // страница сама прокрутится к этой остановке
    if (scene === 'stop' && stop) {
      const s = stop;
      applyView(false);
      setInteractive(fine);
      fly(spacePose(s), 2200);
      map.once('moveend', () => { if (scene === 'stop' && stop === s && !exploring) startSpin('orbit'); });
    } else if (scene === 'route') {
      showRoute();
    }
    return -1;
  }

  function pause(p) {
    if (p) { leaveGround(); stopSpin(); setInteractive(false); scene = 'off'; }
  }

  return { init, setPins, setTrip, relabel, showTrip, flyToPlace, prefetchAll, showHero, showIntro, showRoute, showStop, setFigure, explore, pause };
})();
