(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./game'));
  else root.Chess3Layout = factory(root.Chess3);
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';
  /*
   * Раскладка доски на плоскости.
   *
   * Клетки склеены в замкнутую поверхность (см. game.js), поэтому «настоящих» координат у неё нет —
   * их считаем сами: границу доски (24 нижних ребра) кладём на контур с тремя мягкими выемками
   * между секторами, а положение остальных углов находим релаксацией (каждый угол — в среднем
   * по соседям). Получается гладкая карта, где горизонтали обходят центр дугами,
   * а вертикали сходятся к центру, как на схеме.
   *
   * Координаты — «математические» (ось y вверх), сектор 0 лежит внизу.
   * Углы клетки: 0 — левый верхний, 1 — правый верхний, 2 — правый нижний, 3 — левый нижний
   * («верх» клетки смотрит на центр).
   */
  const NC = G.NC;
  let cache = null;

  function compute(opt) {
    opt = opt || {};
    const eps = opt.eps == null ? 0.12 : opt.eps;
    const R = opt.R || 1;
    const iters = opt.iters || 4000;

    // 1. склеиваем углы клеток в вершины
    const par = new Int16Array(NC * 4);
    for (let i = 0; i < par.length; i++) par[i] = i;
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
    for (let c = 0; c < NC; c++) {
      for (let k = 0; k < 4; k++) {
        const g = G.glue[c * 4 + k];
        if (g < 0) continue;
        const c2 = g >> 2, k2 = g & 3;
        uni(c * 4 + k, c2 * 4 + ((k2 + 1) & 3));
        uni(c * 4 + ((k + 1) & 3), c2 * 4 + k2);
      }
    }
    const ids = new Map(), vid = new Int16Array(NC * 4);
    for (let i = 0; i < NC * 4; i++) {
      const r = find(i);
      if (!ids.has(r)) ids.set(r, ids.size);
      vid[i] = ids.get(r);
    }
    const NV = ids.size;

    // 2. соседи по рёбрам
    const adj = Array.from({ length: NV }, () => new Set());
    for (let c = 0; c < NC; c++) {
      for (let k = 0; k < 4; k++) {
        const a = vid[c * 4 + k], b = vid[c * 4 + ((k + 1) & 3)];
        if (a !== b) { adj[a].add(b); adj[b].add(a); }
      }
    }

    // 3. граница: нижние рёбра клеток нулевой горизонтали
    const pos = Array.from({ length: NV }, () => [0, 0]);
    const fixed = new Uint8Array(NV);
    const rad = (d) => d * Math.PI / 180;
    // Контур — «надутый» треугольник: углы — стыки игроков (шов центр→угол ровно вдвое длиннее
    // расстояния до середины стороны), стороны выгнуты наружу на eps.
    const corner = (j) => { const a = rad(-150 + 120 * j); return [R * Math.cos(a), R * Math.sin(a)]; };
    const bpt = (m) => {
      const s = Math.floor(m / 8) % 3, t = (m % 8) / 8; // m == 24 даёт тот же угол, что и m == 0
      const a = corner(s), b = corner(s + 1);
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      // нормаль наружу: от центра к середине стороны
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, ml = Math.hypot(mx, my);
      const bulge = eps * R * Math.sin(Math.PI * t);
      return [x + mx / ml * bulge, y + my / ml * bulge];
    };
    for (let s = 0; s < 3; s++) {
      for (let f = 0; f < 8; f++) {
        const c = G.cid(s, f, 0), m = s * 8 + f;
        const vl = vid[c * 4 + 3], vr = vid[c * 4 + 2];
        pos[vl] = bpt(m); fixed[vl] = 1;
        pos[vr] = bpt(m + 1); fixed[vr] = 1;
      }
    }

    // 4. релаксация внутренних вершин (взвешенная: любые положительные веса сохраняют корректность
    //    раскладки; после каждого круга усиливаем длинные рёбра и ослабляем короткие — клетки
    //    выравниваются по размеру)
    const inner = [];
    for (let v = 0; v < NV; v++) if (!fixed[v]) inner.push(v);
    const W = new Map(); // ключ a*1000+b (a<b)
    const key = (a, b) => (a < b ? a * 1000 + b : b * 1000 + a);
    for (let a = 0; a < NV; a++) for (const b of adj[a]) if (a < b) W.set(key(a, b), 1);
    const relax = (n) => {
      for (let it = 0; it < n; it++) {
        for (const v of inner) {
          let x = 0, y = 0, sw = 0;
          for (const u of adj[v]) { const w = W.get(key(v, u)); x += w * pos[u][0]; y += w * pos[u][1]; sw += w; }
          pos[v][0] = x / sw; pos[v][1] = y / sw;
        }
      }
    };
    relax(iters);
    const rounds = opt.rounds == null ? 8 : opt.rounds;
    for (let rd = 0; rd < rounds; rd++) {
      let sum = 0, cnt = 0;
      for (const [k] of W) { const a = (k / 1000) | 0, b = k % 1000; sum += Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]); cnt++; }
      const mean = sum / cnt;
      for (const [k, w] of W) {
        const a = (k / 1000) | 0, b = k % 1000;
        const len = Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]);
        W.set(k, w * Math.min(1.6, Math.max(0.6, Math.pow(len / mean, opt.pow == null ? 0.4 : opt.pow))));
      }
      relax(60);
    }

    // 5. многоугольники клеток
    const poly = [], center = [];
    let minArea = Infinity, maxArea = 0, sign = 0, bad = 0;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let c = 0; c < NC; c++) {
      const p = [0, 1, 2, 3].map((k) => pos[vid[c * 4 + k]].slice());
      poly.push(p);
      center.push([(p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4, (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4]);
      let a = 0;
      for (let k = 0; k < 4; k++) { const q = p[k], w = p[(k + 1) & 3]; a += q[0] * w[1] - w[0] * q[1]; }
      a /= 2;
      if (!sign) sign = a < 0 ? -1 : 1;
      if (a * sign <= 1e-9) bad++;
      minArea = Math.min(minArea, Math.abs(a)); maxArea = Math.max(maxArea, Math.abs(a));
      for (const q of p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    }
    return { poly, center, vid, NV, bbox: [x0, y0, x1, y1], minArea, maxArea, bad };
  }

  function get() { return cache || (cache = compute()); }

  // поворот так, чтобы сектор me оказался внизу
  function rot(p, me) {
    const a = -2 * Math.PI / 3 * (me < 0 ? 0 : me), co = Math.cos(a), si = Math.sin(a);
    return [p[0] * co - p[1] * si, p[0] * si + p[1] * co];
  }

  return { compute, get, rot };
});
