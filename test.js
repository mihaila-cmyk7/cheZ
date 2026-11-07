'use strict';
const assert = require('assert');
const G = require('./game');
const L = require('./layout');
const B = require('./bot');

const C = G.cid;
const nm = (c) => `${G.secOf(c)}:${G.fileOf(c)}r${G.rankOf(c)}`;
const empty = () => { const g = G.newGame(); g.board.fill(null); return g; };
const put = (g, s, f, r, t, o, extra) => { g.board[C(s, f, r)] = Object.assign({ t, o }, extra || {}); };
const targets = (g, p, c) => G.gen(g, p).filter((m) => m.from === c).map((m) => m.to);
const kings = (g) => { put(g, 0, 4, 0, 'K', 0); put(g, 1, 4, 0, 'K', 1); put(g, 2, 4, 0, 'K', 2); };

// 1. Стартовая позиция: 96 клеток, у каждого 16 фигур и 24 хода, край доски — 24 ребра
{
  const g = G.newGame();
  assert.strictEqual(g.board.length, 96);
  for (let p = 0; p < 3; p++) {
    assert.strictEqual(g.board.filter((c) => c && c.o === p).length, 16);
    assert.strictEqual(G.gen(g, p).length, 24, 'ходов у игрока ' + p);
  }
  assert.strictEqual([...G.glue].filter((x) => x < 0).length, 24);
}

// 2. Склейка симметрична: если сторона A склеена с B, то B склеена с A
{
  for (let c = 0; c < 96; c++) for (let k = 0; k < 4; k++) {
    const g = G.glue[c * 4 + k];
    if (g < 0) continue;
    assert.strictEqual(G.glue[(g >> 2) * 4 + (g & 3)], c * 4 + k, `склейка ${nm(c)}/${k}`);
  }
}

// 3. Раскладка карты на плоскости корректна: 109 вершин, ни одна клетка не вывернута, центр — 6 клеток
{
  const lay = L.compute();
  assert.strictEqual(lay.NV, 109);
  assert.strictEqual(lay.bad, 0, 'вывернутых клеток: ' + lay.bad);
  assert.ok(lay.minArea > 0.003, 'самая мелкая клетка слишком мала: ' + lay.minArea);
  assert.ok(lay.maxArea / lay.minArea < 8, 'разброс размеров клеток');
  const st = G.star(C(0, 3, 3), 1);
  assert.ok(st.closed && st.list.length === 6, 'в центре сходятся 6 клеток');
}

// 4. Ладья: вертикаль через центр в соседний сектор (зеркально), горизонталь — кольцо из 24 клеток
{
  assert.strictEqual(G.ROOK_RAY[C(0, 2, 0) * 4].map(nm).join(' '), '0:2r1 0:2r2 0:2r3 2:5r3 2:5r2 2:5r1 2:5r0');
  assert.strictEqual(G.ROOK_RAY[C(0, 5, 0) * 4].map(nm).join(' '), '0:5r1 0:5r2 0:5r3 1:2r3 1:2r2 1:2r1 1:2r0');
  assert.strictEqual(G.ROOK_RAY[C(0, 0, 1) * 4 + 1].length, 23, 'кольцо: 23 клетки до самой себя');
  assert.strictEqual(G.ROOK_RAY[C(0, 0, 1) * 4 + 3].length, 23);
  // ладья на пустой доске: вертикаль (до первой линии соседа) + кольцо
  const g = empty(); kings(g); put(g, 0, 5, 1, 'R', 0);
  const t = targets(g, 0, C(0, 5, 1));
  for (const c of [C(0, 5, 2), C(0, 5, 3), C(1, 2, 3), C(1, 2, 0), C(0, 5, 0), C(0, 6, 1), C(1, 0, 1), C(2, 7, 1)]) assert.ok(t.includes(c), 'ладья -> ' + nm(c));
}

// 5. Слон и ферзь идут по диагонали через центр в соседний сектор и дальше по кольцу
{
  assert.strictEqual(G.BISHOP_RAY[C(0, 0, 0) * 4 + 1].map(nm).join(' '), '0:1r1 0:2r2 0:3r3 1:4r3 1:5r2 1:6r1 1:7r0');
  assert.strictEqual(G.BISHOP_RAY[C(0, 7, 0) * 4].map(nm).join(' '), '0:6r1 0:5r2 0:4r3 2:3r3 2:2r2 2:1r1 2:0r0');
  const g = empty(); kings(g); put(g, 0, 3, 0, 'Q', 0);
  const t = targets(g, 0, C(0, 3, 0));
  assert.ok(t.includes(C(0, 3, 3)) && t.includes(C(2, 4, 3)), 'ферзь как ладья и как слон');
}

// 6. Король и конь у центра достают в соседние сектора
{
  const g = empty(); put(g, 1, 4, 0, 'K', 1); put(g, 2, 4, 0, 'K', 2); put(g, 0, 4, 3, 'K', 0);
  const t = targets(g, 0, C(0, 4, 3));
  for (const c of [C(1, 3, 3), C(1, 4, 3), C(2, 3, 3), C(2, 4, 3), C(0, 3, 3), C(0, 5, 3), C(0, 4, 2)]) assert.ok(t.includes(c), 'король -> ' + nm(c));
  const g2 = empty(); kings(g2); put(g2, 0, 6, 3, 'N', 0);
  const tn = targets(g2, 0, C(0, 6, 3));
  for (const c of [C(1, 0, 2), C(1, 2, 2), C(0, 7, 1), C(0, 5, 1)]) assert.ok(tn.includes(c), 'конь -> ' + nm(c));
}

// 7. Пешка: ход на 1 и 2, взятие по диагонали, путь через центр, превращение в чужом секторе
{
  const g = empty(); kings(g); put(g, 0, 3, 1, 'P', 0, { h: 0, st: true });
  assert.deepStrictEqual(targets(g, 0, C(0, 3, 1)).sort((a, b) => a - b), [C(0, 3, 2), C(0, 3, 3)].sort((a, b) => a - b));
  put(g, 1, 0, 0, 'P', 1); put(g, 0, 4, 2, 'N', 1);
  assert.ok(targets(g, 0, C(0, 3, 1)).includes(C(0, 4, 2)), 'пешка бьёт по диагонали');
  // путь пешки от (5,1) к первой линии соседа
  const g2 = empty(); kings(g2); put(g2, 0, 5, 1, 'P', 0, { h: 0, st: false });
  let cur = C(0, 5, 1), h = 0; const route = [];
  for (let i = 0; i < 10; i++) { const fw = G.PFWD[cur * 4 + h]; if (!fw) break; route.push(nm(fw.c)); cur = fw.c; h = fw.h; }
  assert.strictEqual(route.join(' '), '0:5r2 0:5r3 1:2r3 1:2r2 1:2r1 1:2r0');
  // превращение на первой линии чужого сектора
  const g4 = empty(); kings(g4); put(g4, 1, 2, 1, 'P', 0, { h: 2, st: false });
  const m = G.gen(g4, 0).find((x) => x.from === C(1, 2, 1));
  assert.ok(m && m.to === C(1, 2, 0) && m.pr, 'превращение на первой линии чужого сектора');
  assert.ok(G.applyMove(g4, 0, C(1, 2, 1), C(1, 2, 0), 'N').ok);
  assert.strictEqual(g4.board[C(1, 2, 0)].t, 'N');
}

// 8. Взятие короля выбывает игрока; ход идёт по часовой; последний оставшийся побеждает
{
  const g = empty(); kings(g);
  g.board[C(1, 4, 0)] = null; put(g, 1, 2, 0, 'K', 1);
  put(g, 0, 5, 0, 'R', 0);
  assert.ok(G.inCheck(g, 1));
  assert.strictEqual(G.applyMove(g, 0, C(0, 5, 0), C(1, 2, 0)).ok, true);
  assert.strictEqual(g.alive[1], false);
  assert.strictEqual(g.turn, 2, 'ход переходит мимо выбывшего');
  G.resign(g, 2);
  assert.strictEqual(g.over, true);
  assert.strictEqual(g.winner, 0);
}

// 9. Порядок хода по часовой: 0 → 2 → 1; чужой и неверный ход отклоняются
{
  const g = G.newGame();
  assert.strictEqual(G.applyMove(g, 1, C(1, 1, 1), C(1, 1, 2)).ok, false);
  assert.strictEqual(G.applyMove(g, 0, C(0, 3, 1), C(0, 3, 0)).ok, false);
  assert.strictEqual(G.applyMove(g, 0, C(0, 3, 1), C(0, 3, 3)).ok, true);
  assert.strictEqual(g.turn, 2);
  const mv = G.gen(g, 2).find((x) => g.board[x.from].t === 'P');
  assert.ok(G.applyMove(g, 2, mv.from, mv.to).ok);
  assert.strictEqual(g.turn, 1);
}

// 10. Случайные партии: нет падений, у ходящего всегда есть ход, партии заканчиваются
{
  let finished = 0;
  for (let n = 0; n < 100; n++) {
    const g = G.newGame();
    let guard = 0;
    while (!g.over && guard++ < 3000) {
      const ms = G.gen(g, g.turn);
      assert.ok(ms.length > 0);
      const m = ms[Math.floor(Math.random() * ms.length)];
      assert.ok(G.applyMove(g, g.turn, m.from, m.to, 'Q').ok);
    }
    assert.ok(g.over);
    finished++;
  }
  console.log('случайных партий завершено:', finished);
}

// 11. Боты: играют только легально, берут короля, не портят доску при расчёте
{
  let wins = [0, 0, 0], draws = 0;
  for (let n = 0; n < 20; n++) {
    const g = G.newGame();
    let guard = 0;
    while (!g.over && guard++ < 1000) {
      const m = B.chooseMove(g, g.turn);
      assert.ok(m);
      assert.ok(G.applyMove(g, g.turn, m.from, m.to, 'Q').ok);
    }
    if (g.draw) draws++; else wins[g.winner]++;
  }
  console.log('партий бот-бот: победы по местам', wins, 'ничьих', draws);

  const g = empty();
  put(g, 0, 4, 0, 'K', 0); put(g, 2, 4, 0, 'K', 2); put(g, 1, 2, 0, 'K', 1);
  put(g, 0, 5, 1, 'R', 0);
  const m = B.chooseMove(g, 0);
  assert.strictEqual(m.to, C(1, 2, 0), 'бот берёт короля, когда может');
  assert.strictEqual(g.board[C(0, 5, 1)].t, 'R');
  assert.ok(g.alive.every(Boolean));
}

console.log('OK: все тесты пройдены');
