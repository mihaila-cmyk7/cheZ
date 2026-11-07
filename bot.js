'use strict';
/*
 * Простой бот: жадный выбор хода на один ход вперёд.
 *  + ценность взятой фигуры (король — выше всего, «серые» фигуры выбывших дешевле)
 *  + превращение пешки
 *  − если фигура встаёт под удар живого соперника
 *  − сильный штраф, если после хода под ударом остаётся свой король
 *  + небольшая тяга к центру и к королям соперников, продвижение пешек, капля случайности
 */
const G0 = require('./game');

const VAL = { P: 1, N: 3, B: 3.2, R: 5, Q: 9, K: 100 };

function attacked(G, g, c, p) {
  for (let q = 0; q < 3; q++) {
    if (q === p || !g.alive[q]) continue;
    if (G.gen(g, q, true).some((m) => m.to === c)) return true;
  }
  return false;
}

function chooseMove(g, p, G) {
  G = G || G0;
  const moves = G.gen(g, p);
  if (!moves.length) return null;
  const b = g.board;
  let best = null, bestScore = -Infinity;

  const kings = [];
  for (let q = 0; q < 3; q++) {
    if (q === p || !g.alive[q]) continue;
    const k = G.kingPos(g, q);
    if (k >= 0) kings.push(k);
  }
  const kingDist = (c) => Math.min(...kings.map((k) => G.kdist(c, k)), 12);

  for (const m of moves) {
    const pc = b[m.from], cap = b[m.to];
    let s = Math.random() * 0.4;

    if (cap) s += (cap.t === 'K' ? 1000 : VAL[cap.t] * (g.alive[cap.o] ? 1 : 0.3));
    if (m.pr) s += 8;
    s += 0.05 * G.central(m.to); // чем ближе к центру, тем лучше
    if (pc.t === 'P') s += 0.1 * G.progress(p, m.to);
    else if (pc.t !== 'K') s += 0.12 * (kingDist(m.from) - kingDist(m.to));

    // примеряем ход
    const oldType = pc.t, oldH = pc.h;
    if (m.pr) pc.t = 'Q';
    if (pc.t === 'P' || oldType === 'P') pc.h = m.nh;
    b[m.from] = null; b[m.to] = pc;
    if (cap && cap.t === 'K') g.alive[cap.o] = false;

    if (!(cap && cap.t === 'K')) {
      if (attacked(G, g, m.to, p)) s -= VAL[pc.t] * 0.85;
      if (G.inCheck(g, p)) s -= 60;
    }

    // откат
    if (cap && cap.t === 'K') g.alive[cap.o] = true;
    b[m.to] = cap; b[m.from] = pc; pc.t = oldType; pc.h = oldH;

    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}

module.exports = { chooseMove };
