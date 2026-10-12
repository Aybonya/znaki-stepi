// Вид «с земли»: лёгкая 3D-сцена поверх карты (Three.js).
// Степь, трава на ветру, низкое солнце; насыпи, валы и кольцевые курганы —
// в реальном масштабе и на тех же местах, что и рисунок на снимке (геометрия из js/geo.js).
// Сцена рисуется только пока включён вид с земли.

const Ground3D = (function () {
  const EYE = 1.7;
  const fine = matchMedia('(pointer: fine)').matches;
  const C = h => new THREE.Color(h);

  let renderer, scene, camera, canvas, sun, skyMat, grass, grassShader, figure = null;
  let raf = 0, active = false, built = '', start = 0, hideAt = 0, ext = 60;
  let from = [0, 0], yaw0 = 0, yaw = 0, pitch = 0, drag = null;

  // ---------- шум ----------
  function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y) { let f = 0, a = 0.5; for (let i = 0; i < 4; i++) { f += a * vnoise(x, y); x *= 2; y *= 2; a *= 0.5; } return f; }
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

  // ---------- линии ----------
  function catmull(pts, steps) {
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
  function resample(pts, step) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(d / step));
      for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    return out;
  }

  // ---------- сцена ----------
  function detailTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#cfc8b0'; g.fillRect(0, 0, 512, 512);
    const tones = ['#e6dcbc', '#b3ad92', '#c4ba96', '#9fa07f', '#ddd0a8', '#93937a'];
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = tones[(Math.random() * tones.length) | 0];
      g.globalAlpha = 0.25 + Math.random() * 0.5;
      g.save(); g.translate(Math.random() * 512, Math.random() * 512); g.rotate(Math.random() * Math.PI);
      g.fillRect(0, 0, 1 + Math.random() * 5, 1 + Math.random() * 1.5); g.restore();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(700, 700);
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  }

  function buildWorld() {
    scene = new THREE.Scene();
    const horizon = C('#efc792');
    scene.fog = new THREE.Fog(horizon, 160, 2600);

    skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: C('#3f6fae') }, horizon: { value: horizon }, glow: { value: C('#ffd59a') }, sunDir: { value: new THREE.Vector3(1, 0.2, 0) } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
      fragmentShader: `uniform vec3 top, horizon, glow, sunDir; varying vec3 vDir;
        void main(){ float h = max(vDir.y, 0.0); vec3 col = mix(horizon, top, pow(h, 0.5));
          float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
          col += glow * (pow(s, 600.0) * 1.6 + pow(s, 10.0) * 0.4 + pow(s, 3.0) * 0.12);
          if (vDir.y < 0.0) col = horizon; gl_FragColor = vec4(col, 1.0); }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 32, 16), skyMat);
    sky.frustumCulled = false;
    sky.onBeforeRender = () => sky.position.copy(camera.position);
    scene.add(sky);

    scene.add(new THREE.HemisphereLight(C('#dce6f2'), C('#6b5a3a'), 0.72));
    sun = new THREE.DirectionalLight(C('#ffd6a0'), 1.15);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);

    // Земля: ровная у геоглифа, пологие холмы к горизонту
    const S = 9000, seg = 180, geo = new THREE.PlaneGeometry(S, S, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position, col = new Float32Array(p.count * 3);
    const dry = C('#a39456'), olive = C('#6f7442'), pale = C('#bcae78'), tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), d = Math.hypot(x, z);
      p.setY(i, (fbm(x / 1500, z / 1500) - 0.45) * 90 * smooth(700, 3000, d));
      tmp.copy(olive).lerp(dry, smooth(0.3, 0.7, fbm(x / 600 + 9, z / 600))).lerp(pale, smooth(0.55, 0.85, fbm(x / 110, z / 110 + 4)) * 0.6);
      col.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, map: detailTexture() }));
    ground.receiveShadow = true;
    scene.add(ground);
  }

  // Трава вокруг точки обзора; на насыпях — тоже
  function buildGrass(mounds) {
    if (grass) { scene.remove(grass); grass.geometry.dispose(); grass.material.dispose(); }
    const count = fine ? 34000 : 12000;
    const blade = new THREE.BufferGeometry();
    blade.setAttribute('position', new THREE.Float32BufferAttribute([-0.012, 0, 0, 0.012, 0, 0, 0.002, 1, 0], 3));
    blade.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0.15, 0, 1, 0.15, 0, 1, 0.15], 3));
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    mat.onBeforeCompile = sh => {
      sh.uniforms.uTime = { value: 0 };
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>
         float ph = instanceMatrix[3].x * 0.35 + instanceMatrix[3].z * 0.22;
         float w = sin(uTime * 1.8 + ph) * 0.6 + sin(uTime * 3.1 + ph * 1.7) * 0.25;
         transformed.x += w * 0.18 * position.y * position.y;`);
      grassShader = sh;
    };
    grass = new THREE.InstancedMesh(blade, mat, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const tones = [C('#a8984f'), C('#8a8844'), C('#c2b06a'), C('#77783d'), C('#b8a35a')];
    for (let i = 0; i < count; i++) {
      const r = 0.6 + Math.pow(Math.random(), 1.6) * 55, a = Math.random() * Math.PI * 2;
      const gx = from[0] + Math.cos(a) * r, gy = from[1] + Math.sin(a) * r;
      let h0 = 0;
      for (const md of mounds) {
        const d = Math.hypot(gx - md.x, gy - md.y);
        if (d < md.r) h0 = Math.max(h0, md.h * Math.pow(Math.cos((d / md.r) * Math.PI / 2), 1.6));
      }
      v.set(gx, h0, -gy);
      e.set((Math.random() - 0.5) * 0.7, Math.random() * Math.PI, (Math.random() - 0.5) * 0.7);
      q.setFromEuler(e);
      s.set(0.8 + Math.random() * 1.2, 0.18 + Math.pow(Math.random(), 2) * 0.5, 1);
      m.compose(v, q, s);
      grass.setMatrixAt(i, m);
      grass.setColorAt(i, tones[(Math.random() * tones.length) | 0]);
    }
    grass.frustumCulled = false;
    scene.add(grass);
  }

  // ---------- геоглиф ----------
  const domeGeo = (() => {
    const pts = [];
    for (let i = 16; i >= 0; i--) { const t = i / 16; pts.push(new THREE.Vector2(t, Math.pow(Math.cos((t * Math.PI) / 2), 1.6))); }
    return new THREE.LatheGeometry(pts, 40);
  })();

  // Земляной вал: гладкий гребень вдоль линии
  function ridge(pts, closed, W, H, mat) {
    const P = closed ? pts.concat([pts[0]]) : pts, N = P.length, M = 9;
    const pos = new Float32Array(N * M * 3), idx = [];
    for (let i = 0; i < N; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(N - 1, i + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1];
      const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
      const taper = closed ? 1 : smooth(0, 1, Math.min(i, N - 1 - i) / 5);
      for (let j = 0; j < M; j++) {
        const sx = (j / (M - 1)) * 2 - 1, off = (sx * W) / 2;
        const h = H * taper * Math.pow(Math.cos((sx * Math.PI) / 2), 2);
        pos.set([P[i][0] - ty * off, h, -(P[i][1] + tx * off)], (i * M + j) * 3);
      }
    }
    for (let i = 0; i < N - 1; i++) for (let j = 0; j < M - 1; j++) {
      const a = i * M + j, b = (i + 1) * M + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const k = Math.floor(M / 2) * 3 + 1;
    if (g.attributes.normal.array[k] < 0) { g.setIndex(idx.reverse()); g.computeVertexNormals(); }
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }

  function buildFigure(id) {
    if (figure) {
      scene.remove(figure);
      figure.traverse(o => { if (o.geometry && o.geometry !== domeGeo) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
    const g = GEO[id];
    figure = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: C('#a99b5e'), side: THREE.DoubleSide });
    const mounds = (g.mounds || []).map(m => ({ x: m[0], y: m[1], r: m[2] * (0.9 + Math.random() * 0.2), h: 1.6 + Math.random() * 0.6 }));
    mounds.forEach(m => {
      const mesh = new THREE.Mesh(domeGeo, mat);
      mesh.position.set(m.x, 0, -m.y);
      mesh.scale.set(m.r, m.h, m.r);
      mesh.castShadow = mesh.receiveShadow = true;
      figure.add(mesh);
    });
    (g.ramparts || []).forEach(l => {
      const pts = g.smooth ? resample(catmull(l, 10), 1.2) : resample(l, 1.5);
      figure.add(ridge(pts, false, g.rampartW, 1.4, mat));
    });
    (g.rings || []).forEach(r => {
      const pts = [];
      for (let i = 0; i < 72; i++) { const a = (i / 72) * Math.PI * 2; pts.push([r[0] + Math.cos(a) * r[2] * 0.78, r[1] + Math.sin(a) * r[2] * 0.78]); }
      figure.add(ridge(pts, true, r[2] * 0.42, 0.9, mat));
    });
    scene.add(figure);

    // Тени — на всю фигуру
    ext = 60;
    (g.mounds || []).concat((g.ramparts || []).flat(), (g.rings || [])).forEach(p => { ext = Math.max(ext, Math.abs(p[0]) + 30, Math.abs(p[1]) + 30); });
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -ext; sc.right = sc.top = ext; sc.near = 1; sc.far = ext * 5 + 400;
    sc.updateProjectionMatrix();
    return mounds;
  }

  // ---------- камера и кадр ----------
  function resize() {
    if (!renderer) return;
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 62 : 48;
    if (w > 900) camera.setViewOffset(w, h, -w * 0.17, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  function tick(now) {
    if (!active && now - hideAt > 1000) { raf = 0; return; }
    raf = requestAnimationFrame(tick);
    const t = Math.min(1, (now - start) / 2600), e = 1 - Math.pow(1 - t, 3);
    const sway = Math.sin(now / 3200) * 0.02;
    // Спуск: с высоты ~16 м, глядя вниз, — к уровню глаз
    const y = 16 + (EYE - 16) * e, pt = -0.5 * (1 - e) + pitch * e;
    const yw = yaw0 + yaw + sway;
    camera.position.set(from[0], y, -from[1]);
    camera.lookAt(from[0] + Math.cos(yw) * 10, y + Math.tan(pt) * 10, -(from[1] + Math.sin(yw) * 10));
    if (grassShader) grassShader.uniforms.uTime.value = now / 1000;
    renderer.render(scene, camera);
  }

  function init(el) {
    canvas = el;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    camera = new THREE.PerspectiveCamera(48, 1, 0.2, 12000);
    buildWorld();
    addEventListener('resize', resize);
    resize();

    // Осмотреться: потянуть мышью или пальцем
    canvas.addEventListener('pointerdown', ev => { drag = { x: ev.clientX, y: ev.clientY, yaw, pitch }; canvas.setPointerCapture(ev.pointerId); });
    canvas.addEventListener('pointermove', ev => {
      if (!drag) return;
      yaw = drag.yaw + (ev.clientX - drag.x) * 0.004;
      pitch = Math.max(-0.35, Math.min(0.45, drag.pitch - (ev.clientY - drag.y) * 0.003));
    });
    const up = () => { drag = null; };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  // id — геоглиф; view — { from: [x, y], look: [x, y] } в метрах от центра фигуры
  function show(id, view) {
    if (!window.THREE) return false;
    try { if (!renderer) init(document.getElementById('ground3d')); } catch (err) { return false; }
    from = view.from;
    yaw0 = Math.atan2(view.look[1] - from[1], view.look[0] - from[0]);
    yaw = 0; pitch = 0;
    if (built !== id) { buildGrass(buildFigure(id)); built = id; }

    // Солнце — низко, сбоку от направления взгляда: длинные тени подчёркивают насыпи
    const sa = yaw0 + 1.2, dir = new THREE.Vector3(Math.cos(sa), 0.2, -Math.sin(sa)).normalize();
    skyMat.uniforms.sunDir.value.copy(dir);
    sun.position.copy(dir).multiplyScalar(ext * 2 + 150);
    sun.target.position.set(0, 0, 0);

    active = true;
    start = performance.now();
    canvas.classList.add('on');
    if (!raf) raf = requestAnimationFrame(tick);
    return true;
  }

  function hide() {
    if (!canvas || !active) return;
    active = false;
    hideAt = performance.now();
    canvas.classList.remove('on');
  }

  return { show, hide, isActive: () => active };
})();
