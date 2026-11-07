'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const G = require('./game');
const B = require('./bot');

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';        // токен от @BotFather
const WEBAPP_URL = (process.env.WEBAPP_URL || '').replace(/\/$/, ''); // https-адрес, где живёт этот сервер
const MINIAPP_LINK = (process.env.MINIAPP_LINK || '').replace(/\/$/, ''); // https://t.me/<бот>/<короткое_имя>

// ---------- HTTP ----------
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/health') { res.end('ok'); return; }
  const STATIC = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/index.html': ['index.html', 'text/html; charset=utf-8'],
    '/game.js': ['game.js', 'application/javascript; charset=utf-8'],
    '/layout.js': ['layout.js', 'application/javascript; charset=utf-8'],
  };
  if (STATIC[url]) {
    res.writeHead(200, { 'content-type': STATIC[url][1], 'cache-control': 'no-cache' });
    res.end(fs.readFileSync(path.join(__dirname, STATIC[url][0])));
    return;
  }
  res.writeHead(404); res.end('not found');
});

// ---------- Проверка initData Telegram ----------
function checkInitData(initData) {
  try {
    const p = new URLSearchParams(initData);
    const hash = p.get('hash');
    if (!hash) return null;
    p.delete('hash');
    const dcs = [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calc = crypto.createHmac('sha256', secret).update(dcs).digest('hex');
    const a = Buffer.from(calc), b = Buffer.from(hash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const age = Date.now() / 1000 - Number(p.get('auth_date') || 0);
    if (age > 86400) return null;
    const u = JSON.parse(p.get('user'));
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ').slice(0, 24) || 'Игрок';
    return { id: 'tg-' + u.id, name };
  } catch (e) { return null; }
}

function authUser(msg) {
  if (BOT_TOKEN) return msg.initData ? checkInitData(String(msg.initData)) : null;
  // режим разработки (без токена): имя и id приходят от клиента
  return { id: 'dev-' + String(msg.devId || '').slice(0, 40), name: String(msg.name || 'Игрок').slice(0, 24) };
}

// ---------- Комнаты ----------
const rooms = new Map();
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  let c;
  do { c = Array.from({ length: 5 }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join(''); } while (rooms.has(c));
  return c;
}
function getRoom(code) {
  if (!rooms.has(code)) rooms.set(code, { code, seats: [null, null, null], game: null, clients: new Set(), touched: Date.now() });
  return rooms.get(code);
}
function inviteLink(code) {
  if (MINIAPP_LINK) return `${MINIAPP_LINK}?startapp=${code}`;
  if (WEBAPP_URL) return `${WEBAPP_URL}/?room=${code}`;
  return null;
}

function view(room, seat) {
  const g = room.game;
  const v = {
    type: 'state', room: room.code, invite: inviteLink(room.code), me: seat,
    seats: room.seats.map((s) => (s ? { name: s.name, bot: !!s.bot } : null)),
    started: !!g,
  };
  if (g) {
    v.board = g.board.map((p) => (p ? p.o + p.t : null));
    v.turn = g.turn; v.alive = g.alive; v.over = g.over; v.winner = g.winner; v.draw = g.draw; v.last = g.last;
    v.check = [0, 1, 2].map((p) => G.inCheck(g, p));
    v.legal = !g.over && seat === g.turn ? G.gen(g, seat).map((m) => [m.from, m.to, m.pr ? 1 : 0]) : [];
  }
  return v;
}
function broadcast(room) {
  for (const ws of room.clients) {
    if (ws.readyState === 1) ws.send(JSON.stringify(view(room, ws.ctx.seat)));
  }
  scheduleBots(room);
}

// ---------- Боты ----------
const BOT_NAMES = ['Бот Альфа', 'Бот Бета', 'Бот Гамма'];
function fillWithBots(room) {
  for (let i = 0; i < 3; i++) if (!room.seats[i]) room.seats[i] = { id: 'bot-' + i, name: BOT_NAMES[i], bot: true };
  if (!room.game) room.game = G.newGame();
}
function scheduleBots(room) {
  const g = room.game;
  if (!g || g.over || room.botTimer || room.clients.size === 0) return;
  const s = room.seats[g.turn];
  if (!s || !s.bot) return;
  const humanAlive = room.seats.some((x, i) => x && !x.bot && g.alive[i]);
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    const cur = room.game;
    if (!cur || cur.over) return;
    const seat = room.seats[cur.turn];
    if (!seat || !seat.bot) return;
    const m = B.chooseMove(cur, cur.turn);
    if (m) G.applyMove(cur, cur.turn, m.from, m.to, 'Q');
    broadcast(room);
  }, humanAlive ? 600 + Math.random() * 700 : 40);
}
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, maxPayload: 4096 });

wss.on('connection', (ws) => {
  ws.ctx = null;
  ws.alive = true;
  ws.on('pong', () => { ws.alive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.type === 'join') {
      if (ws.ctx) return;
      const user = authUser(msg);
      if (!user) { send(ws, { type: 'error', msg: 'Не удалось проверить Telegram-аккаунт. Откройте игру через бота.' }); return; }
      const mode = msg.mode; // 'create' | 'bots' | 'join'
      let code = String(msg.room || '').toUpperCase();
      const okCode = /^[A-Z0-9]{3,8}$/.test(code);
      if (mode === 'create' || mode === 'bots' || !okCode) {
        if (mode === 'join') { send(ws, { type: 'error', code: 'noroom', msg: 'Комната не найдена. Проверьте ссылку или код.' }); return; }
        code = newCode();
      } else if (mode === 'join' && !rooms.has(code)) {
        send(ws, { type: 'error', code: 'noroom', msg: 'Комната не найдена. Проверьте ссылку или код.' });
        return;
      }
      const isNew = !rooms.has(code);
      const room = getRoom(code);
      room.touched = Date.now();
      let seat = room.seats.findIndex((s) => s && s.id === user.id);
      if (seat < 0 && !room.game) seat = room.seats.findIndex((s) => !s);
      if (seat >= 0) room.seats[seat] = { id: user.id, name: user.name };
      ws.ctx = { room, seat, user };
      room.clients.add(ws);
      if (mode === 'bots' && isNew) fillWithBots(room);
      if (!room.game && room.seats.every(Boolean)) room.game = G.newGame();
      broadcast(room);
      return;
    }

    if (!ws.ctx) return;
    const { room, seat } = ws.ctx;
    const g = room.game;
    room.touched = Date.now();

    if (msg.type === 'move' && g && seat >= 0) {
      if (!Number.isInteger(msg.from) || !Number.isInteger(msg.to)) return;
      const r = G.applyMove(g, seat, msg.from, msg.to, msg.promo);
      if (!r.ok) { send(ws, { type: 'error', msg: r.err }); send(ws, view(room, seat)); return; }
      broadcast(room);
    } else if (msg.type === 'resign' && g && seat >= 0) {
      G.resign(g, seat);
      broadcast(room);
    } else if (msg.type === 'fillbots' && !g && seat >= 0) {
      fillWithBots(room);
      broadcast(room);
    } else if (msg.type === 'rematch' && g && g.over && seat >= 0) {
      room.game = G.newGame();
      broadcast(room);
    }
  });

  ws.on('close', () => {
    if (!ws.ctx) return;
    const { room, seat, user } = ws.ctx;
    room.clients.delete(ws);
    // до начала партии освобождаем место, если игрок ушёл
    if (!room.game && seat >= 0) {
      const still = [...room.clients].some((c) => c.ctx && c.ctx.user.id === user.id);
      if (!still) { room.seats[seat] = null; broadcast(room); }
    }
  });
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) { ws.terminate(); continue; }
    ws.alive = false; ws.ping();
  }
}, 30000);

setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) if (r.clients.size === 0 && now - r.touched > 6 * 3600 * 1000) rooms.delete(code);
}, 3600 * 1000);

// ---------- Telegram-бот (long polling) ----------
async function api(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  return r.json();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollBot() {
  await api('deleteWebhook').catch(() => {});
  let offset = 0;
  for (;;) {
    try {
      const r = await api('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] });
      if (!r.ok) { await sleep(3000); continue; }
      for (const u of r.result) {
        offset = u.update_id + 1;
        const m = u.message;
        if (!m || !m.text || !m.text.startsWith('/start')) continue;
        const payload = (m.text.split(' ')[1] || '').replace(/[^A-Za-z0-9]/g, '');
        const url = WEBAPP_URL + (payload ? `/?room=${payload}` : '/');
        await api('sendMessage', {
          chat_id: m.chat.id,
          text: '♟ Шахматы на троих. Нажмите «Играть», создайте комнату и отправьте приглашение двум друзьям.',
          reply_markup: { inline_keyboard: [[{ text: 'Играть', web_app: { url } }]] },
        });
      }
    } catch (e) { console.error('bot:', e.message); await sleep(3000); }
  }
}

server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}${BOT_TOKEN ? '' : ' (режим разработки: без проверки Telegram)'}`);
  if (BOT_TOKEN && WEBAPP_URL) pollBot();
  else if (BOT_TOKEN) console.log('Задайте WEBAPP_URL, чтобы бот отвечал на /start');
});
