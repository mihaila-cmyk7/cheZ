(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Chess3 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /*
   * Шахматы на троих — правила и геометрия.
   *
   * Доска: 3 сектора по 8 вертикалей (f = 0..7, слева направо) и 4 горизонтали (r = 0..3;
   * r = 0 — «домашняя» линия игрока, r = 3 — ближе всего к центру). Всего 96 клеток.
   * Клетка = s*32 + r*8 + f, где s — номер сектора (игрока).
   *
   * Склейка краёв (как на схеме):
   *  - Горизонтали замкнуты в кольцо: правый край сектора s стыкуется с левым краем сектора s+1.
   *    Так что каждая горизонталь — кольцо из 24 клеток через все три сектора.
   *  - Вертикали проходят через центр: верх клетки (f, 3) сектора s стыкуется с верхом клетки (7-f, 3)
   *    соседнего сектора: вертикали e–h уходят в сектор s+1, a–d — в сектор s-1. Вертикаль = 8 клеток.
   *  - В центре сходятся 6 клеток; диагональ, дошедшая до центра, идёт на противоположную клетку.
   *
   * Стороны клетки: 0 — верх (к центру), 1 — право, 2 — низ, 3 — лево.
   * Углы клетки (по часовой, от левого верхнего): 0 — ЛВ, 1 — ПВ, 2 — ПН, 3 — ЛН.
   * Сторона k идёт от угла k к углу k+1.
   *
   * Шаха и мата нет: партия идёт до взятия короля. Потерявший короля выбывает, его фигуры
   * остаются «камнями» (их можно брать). Нет рокировки и взятия на проходе.
   */

  const NC = 96;
  const ORDER = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  const MAX_MOVES = 450;

  const cid = (s, f, r) => s * 32 + r * 8 + f;
  const secOf = (c) => (c / 32) | 0;
  const rankOf = (c) => ((c % 32) / 8) | 0;
  const fileOf = (c) => c % 8;

  // ---------- склейка сторон ----------
  const glue = new Int16Array(NC * 4).fill(-1); // glue[c*4+k] = c2*4+k2
  const setG = (c, k, c2, k2) => { glue[c * 4 + k] = c2 * 4 + k2; };
  for (let s = 0; s < 3; s++) {
    for (let r = 0; r < 4; r++) {
      for (let f = 0; f < 8; f++) {
        const c = cid(s, f, r);
        if (r < 3) setG(c, 0, cid(s, f, r + 1), 2);
        else setG(c, 0, cid(f >= 4 ? (s + 1) % 3 : (s + 2) % 3, 7 - f, 3), 0);
        if (f < 7) setG(c, 1, cid(s, f + 1, r), 3);
        else setG(c, 1, cid((s + 1) % 3, 0, r), 3);
        if (r > 0) setG(c, 2, cid(s, f, r - 1), 0);
        if (f > 0) setG(c, 3, cid(s, f - 1, r), 1);
        else setG(c, 3, cid((s + 2) % 3, 7, r), 1);
      }
    }
  }

  // ---------- звезда вершины: клетки вокруг угла ----------
  function crossCw(c, k) {
    const g = glue[c * 4 + k]; if (g < 0) return null;
    return { c: g >> 2, k: ((g & 3) + 1) & 3 };
  }
  function crossCcw(c, k) {
    const g = glue[c * 4 + ((k + 3) & 3)]; if (g < 0) return null;
    return { c: g >> 2, k: g & 3 };
  }
  const STAR = new Array(NC * 4);
  function star(c, k) {
    const key = c * 4 + k;
    if (STAR[key]) return STAR[key];
    let list = [{ c, k }], closed = false, cur = { c, k };
    for (let i = 0; i < 12; i++) {
      const n = crossCw(cur.c, cur.k);
      if (!n) break;
      if (n.c === c && n.k === k) { closed = true; break; }
      list.push(n); cur = n;
    }
    if (!closed) {
      const pre = []; cur = { c, k };
      for (let i = 0; i < 12; i++) {
        const n = crossCcw(cur.c, cur.k);
        if (!n) break;
        pre.unshift(n); cur = n;
      }
      list = pre.concat(list);
    }
    return (STAR[key] = { list, closed });
  }
  // клетка «напротив» через угол k (для диагоналей); null — если вершина граничная или с валентностью 2
  function diagNext(c, k) {
    const st = star(c, k);
    const n = st.list.length;
    if (!st.closed || n < 4 || n % 2) return null;
    const o = st.list[n / 2];
    return { c: o.c, k: o.k };
  }
  // перенос «курса» d через steps переходов вокруг вершины
  function walk(c, k, steps, h) {
    let cur = c, ck = k, hh = h;
    for (let i = 0; i < steps; i++) {
      const g = glue[cur * 4 + ck];
      const k2 = g & 3;
      hh = (hh - ck + k2 + 2) & 3;
      cur = g >> 2; ck = (k2 + 1) & 3;
    }
    return { c: cur, h: hh };
  }

  // ---------- таблицы ходов ----------
  function rookRayFrom(c, k) {
    const out = [], seen = new Set();
    let cc = c, ex = k;
    for (;;) {
      const key = cc * 4 + ex;
      if (seen.has(key)) break;
      seen.add(key);
      const g = glue[cc * 4 + ex];
      if (g < 0) break;
      const n = g >> 2;
      if (n === c) break;
      out.push(n);
      ex = ((g & 3) + 2) & 3; cc = n;
    }
    return out;
  }
  function bishopRayFrom(c, k) {
    const out = [], seen = new Set();
    let cc = c, kk = k;
    for (;;) {
      const key = cc * 4 + kk;
      if (seen.has(key)) break;
      seen.add(key);
      const nx = diagNext(cc, kk);
      if (!nx || nx.c === c) break;
      out.push(nx.c);
      cc = nx.c; kk = (nx.k + 2) & 3;
    }
    return out;
  }
  const ROOK_RAY = [], BISHOP_RAY = [], KNIGHT = [], KING = [];
  const PFWD = new Array(NC * 4).fill(null), PCAP = new Array(NC * 4);
  for (let c = 0; c < NC; c++) {
    for (let k = 0; k < 4; k++) {
      ROOK_RAY[c * 4 + k] = rookRayFrom(c, k);
      BISHOP_RAY[c * 4 + k] = bishopRayFrom(c, k);
    }
    // король: все клетки, которые касаются клетки хотя бы углом
    const ks = new Set();
    for (let k = 0; k < 4; k++) for (const x of star(c, k).list) if (x.c !== c) ks.add(x.c);
    KING[c] = [...ks];
    // конь: две клетки прямо и одна вбок
    const ns = new Set();
    for (let k0 = 0; k0 < 4; k0++) {
      const g1 = glue[c * 4 + k0]; if (g1 < 0) continue;
      const c1 = g1 >> 2, e1 = ((g1 & 3) + 2) & 3;
      const g2 = glue[c1 * 4 + e1]; if (g2 < 0) continue;
      const c2 = g2 >> 2, h2 = ((g2 & 3) + 2) & 3;
      for (const t of [(h2 + 1) & 3, (h2 + 3) & 3]) {
        const g3 = glue[c2 * 4 + t]; if (g3 < 0) continue;
        const c3 = g3 >> 2;
        if (c3 !== c) ns.add(c3);
      }
    }
    KNIGHT[c] = [...ns];
    // пешка: шаг вперёд и взятия, зависят от курса h (сторона клетки, куда она идёт)
    for (let h = 0; h < 4; h++) {
      const g = glue[c * 4 + h];
      PFWD[c * 4 + h] = g < 0 ? null : { c: g >> 2, h: ((g & 3) + 2) & 3 };
      const caps = [];
      for (const k of [h, (h + 1) & 3]) {
        const st = star(c, k), n = st.list.length;
        if (!st.closed || n < 4 || n % 2) continue;
        const w = walk(c, k, n / 2, h);
        if (!caps.some((x) => x.c === w.c)) caps.push(w);
      }
      PCAP[c * 4 + h] = caps;
    }
  }

  // расстояние в ходах короля (для ботов)
  let KD = null;
  function kdist(a, b) {
    if (!KD) {
      KD = [];
      for (let s = 0; s < NC; s++) {
        const d = new Array(NC).fill(99); d[s] = 0;
        const q = [s];
        for (let i = 0; i < q.length; i++) for (const n of KING[q[i]]) if (d[n] === 99) { d[n] = d[q[i]] + 1; q.push(n); }
        KD.push(d);
      }
    }
    return KD[a][b];
  }

  // ---------- партия ----------
  function newGame() {
    const board = new Array(NC).fill(null);
    for (let s = 0; s < 3; s++) {
      for (let f = 0; f < 8; f++) {
        board[cid(s, f, 0)] = { t: ORDER[f], o: s };
        board[cid(s, f, 1)] = { t: 'P', o: s, h: 0, st: true };
      }
    }
    return { board, turn: 0, alive: [true, true, true], over: false, winner: null, draw: false, last: null, moves: 0 };
  }

  // Псевдолегальные ходы игрока p. attackOnly — только клетки, которые он бьёт.
  function gen(g, p, attackOnly) {
    const out = [], b = g.board, seen = new Uint8Array(NC);
    for (let c = 0; c < NC; c++) {
      const pc = b[c];
      if (!pc || pc.o !== p) continue;
      seen.fill(0);
      const add = (to, nh) => {
        if (seen[to]) return; seen[to] = 1;
        out.push({ from: c, to, pr: pc.t === 'P' && secOf(to) !== p && rankOf(to) === 0, nh });
      };
      const step = (t) => { const x = b[t]; if (!x || x.o !== p) add(t); };
      const slide = (ray) => {
        for (const t of ray) {
          const x = b[t];
          if (!x) add(t);
          else { if (x.o !== p) add(t); break; }
        }
      };
      switch (pc.t) {
        case 'P': {
          const h = pc.h || 0;
          const fw = PFWD[c * 4 + h];
          if (!attackOnly && fw && !b[fw.c]) {
            add(fw.c, fw.h);
            if (pc.st) {
              const fw2 = PFWD[fw.c * 4 + fw.h];
              if (fw2 && !b[fw2.c]) add(fw2.c, fw2.h);
            }
          }
          for (const cp of PCAP[c * 4 + h]) {
            const t = b[cp.c];
            if (attackOnly || (t && t.o !== p)) add(cp.c, cp.h);
          }
          break;
        }
        case 'N': for (const t of KNIGHT[c]) step(t); break;
        case 'K': for (const t of KING[c]) step(t); break;
        case 'R': for (let k = 0; k < 4; k++) slide(ROOK_RAY[c * 4 + k]); break;
        case 'B': for (let k = 0; k < 4; k++) slide(BISHOP_RAY[c * 4 + k]); break;
        case 'Q':
          for (let k = 0; k < 4; k++) { slide(ROOK_RAY[c * 4 + k]); slide(BISHOP_RAY[c * 4 + k]); }
          break;
      }
    }
    return out;
  }

  function kingPos(g, p) {
    for (let c = 0; c < NC; c++) { const x = g.board[c]; if (x && x.o === p && x.t === 'K') return c; }
    return -1;
  }

  // Король игрока p под ударом хотя бы одного живого соперника?
  function inCheck(g, p) {
    if (!g.alive[p]) return false;
    const k = kingPos(g, p);
    if (k < 0) return false;
    for (let q = 0; q < 3; q++) {
      if (q === p || !g.alive[q]) continue;
      if (gen(g, q, true).some((m) => m.to === k)) return true;
    }
    return false;
  }

  function advance(g, from) {
    const n = g.alive.filter(Boolean).length;
    if (n <= 1) { g.over = true; g.winner = g.alive.findIndex(Boolean); return; }
    if (g.moves >= MAX_MOVES) { g.over = true; g.draw = true; return; }
    for (let i = 1; i <= 3; i++) {
      const q = (from + 3 - i) % 3; // по часовой стрелке: сосед слева от игрока
      if (g.alive[q] && gen(g, q).length) { g.turn = q; return; }
    }
    g.over = true; g.draw = true;
  }

  function applyMove(g, p, from, to, promo) {
    if (g.over) return { ok: false, err: 'Игра окончена' };
    if (g.turn !== p || !g.alive[p]) return { ok: false, err: 'Сейчас не ваш ход' };
    const m = gen(g, p).find((q) => q.from === from && q.to === to);
    if (!m) return { ok: false, err: 'Так ходить нельзя' };
    const b = g.board, pc = b[from], cap = b[to];
    b[from] = null;
    if (pc.t === 'P') {
      pc.h = m.nh; pc.st = false;
      if (m.pr) pc.t = ['Q', 'R', 'B', 'N'].includes(promo) ? promo : 'Q';
    }
    b[to] = pc;
    g.last = { from, to };
    g.moves++;
    if (cap && cap.t === 'K') g.alive[cap.o] = false;
    advance(g, p);
    return { ok: true };
  }

  function resign(g, p) {
    if (g.over || !g.alive[p]) return;
    g.alive[p] = false;
    if (g.turn === p) advance(g, p);
    else advance(g, (g.turn + 1) % 3);
  }

  return {
    NC, cid, secOf, rankOf, fileOf, glue, star, diagNext,
    ROOK_RAY, BISHOP_RAY, KNIGHT, KING, PFWD, PCAP, kdist,
    newGame, gen, inCheck, kingPos, applyMove, resign,
    central: rankOf,
    progress: (p, c) => (secOf(c) === p ? rankOf(c) : 4 + (3 - rankOf(c))),
  };
});
