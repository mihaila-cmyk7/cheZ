(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Chess3T = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
/*
 * Шахматы на троих — вариант «Т» (квадратные клетки, обычные ходы фигур).
 * Доска 14×11, клетка (x, y), y растёт вниз, id = y*14 + x:
 *   центр 8×8: x 3..10, y 0..7;  нижний рукав (игрок 0): x 3..10, y 8..10
 *   левый рукав (игрок 1): x 0..2, y 0..7;  правый рукав (игрок 2): x 11..13, y 0..7
 * Игрок 0 ходит пешками вверх, игрок 1 — вправо, игрок 2 — влево. Очередь 0 → 1 → 2.
 * Шаха/мата нет: игра до взятия короля; потерявший короля выбывает, его фигуры — серые «камни».
 * Интерфейс тот же, что у game.js (клетки — числа, ходы {from,to,pr}).
 */
const W = 14, H = 11, NC = W * H;
const ORDER = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
const DIR = [[0, -1], [1, 0], [-1, 0]];
const MAX_MOVES = 450;

const idx = (x, y) => y * W + x;
const xOf = (c) => c % W, yOf = (c) => Math.floor(c / W);
function valid(x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  if (x >= 3 && x <= 10) return true;
  return y <= 7;
}
const isStart = (p, x, y) => (p === 0 ? y === 9 : p === 1 ? x === 1 : x === 12);
const isPromo = (p, x, y) => (p === 0 ? y === 0 : p === 1 ? x === 10 : x === 3);

function newGame() {
  const board = new Array(NC).fill(null);
  const put = (x, y, t, o) => { board[idx(x, y)] = { t, o }; };
  for (let i = 0; i < 8; i++) {
    put(3 + i, 10, ORDER[i], 0); put(3 + i, 9, 'P', 0);
    put(0, i, ORDER[i], 1);      put(1, i, 'P', 1);
    put(13, 7 - i, ORDER[i], 2); put(12, 7 - i, 'P', 2);
  }
  return { board, turn: 0, alive: [true, true, true], over: false, winner: null, draw: false, last: null, moves: 0 };
}

const KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const KING = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

function gen(g, p, attackOnly) {
  const out = [];
  const b = g.board;
  for (let from = 0; from < NC; from++) {
    const pc = b[from];
    if (!pc || pc.o !== p) continue;
    const x = xOf(from), y = yOf(from);
    const add = (tx, ty) => out.push({ from, to: idx(tx, ty), pr: pc.t === 'P' && isPromo(p, tx, ty) });
    const step = (tx, ty) => {
      if (!valid(tx, ty)) return;
      const t = b[idx(tx, ty)];
      if (!t || t.o !== p) add(tx, ty);
    };
    const slide = (dx, dy) => {
      for (let k = 1; ; k++) {
        const tx = x + dx * k, ty = y + dy * k;
        if (!valid(tx, ty)) return;
        const t = b[idx(tx, ty)];
        if (t) { if (t.o !== p) add(tx, ty); return; }
        add(tx, ty);
      }
    };
    switch (pc.t) {
      case 'P': {
        const [dx, dy] = DIR[p];
        const fx = x + dx, fy = y + dy;
        if (!attackOnly && valid(fx, fy) && !b[idx(fx, fy)]) {
          add(fx, fy);
          if (isStart(p, x, y)) {
            const sx = fx + dx, sy = fy + dy;
            if (valid(sx, sy) && !b[idx(sx, sy)]) add(sx, sy);
          }
        }
        const caps = dx === 0 ? [[fx - 1, fy], [fx + 1, fy]] : [[fx, fy - 1], [fx, fy + 1]];
        for (const [cx, cy] of caps) {
          if (!valid(cx, cy)) continue;
          const t = b[idx(cx, cy)];
          if (attackOnly || (t && t.o !== p)) add(cx, cy);
        }
        break;
      }
      case 'N': for (const [dx, dy] of KNIGHT) step(x + dx, y + dy); break;
      case 'K': for (const [dx, dy] of KING) step(x + dx, y + dy); break;
      case 'R': for (const [dx, dy] of ROOK) slide(dx, dy); break;
      case 'B': for (const [dx, dy] of BISHOP) slide(dx, dy); break;
      case 'Q': for (const [dx, dy] of ROOK) slide(dx, dy); for (const [dx, dy] of BISHOP) slide(dx, dy); break;
    }
  }
  return out;
}

function kingPos(g, p) {
  for (let i = 0; i < NC; i++) { const pc = g.board[i]; if (pc && pc.o === p && pc.t === 'K') return i; }
  return -1;
}
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
    const q = (from + i) % 3;
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
  if (m.pr) pc.t = ['Q', 'R', 'B', 'N'].includes(promo) ? promo : 'Q';
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
  else advance(g, (g.turn + 2) % 3);
}

// подсказки для ботов
const kdist = (a, b) => Math.max(Math.abs(xOf(a) - xOf(b)), Math.abs(yOf(a) - yOf(b)));
const central = (c) => 6 - (Math.abs(xOf(c) - 6.5) + Math.abs(yOf(c) - 3.5)) / 2; // 0..~6
const progress = (p, c) => (p === 0 ? 9 - yOf(c) : p === 1 ? xOf(c) - 1 : 12 - xOf(c));

return { W, H, NC, valid, idx, xOf, yOf, newGame, gen, inCheck, kingPos, applyMove, resign, kdist, central, progress };
});
