const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const config = require('./config');
const store = require('./store');
const races = require('./races');
const { Room } = require('./room');
const characters = require('../shared/characters.json').characters;
const CHAR = Object.fromEntries(characters.map((c) => [c.id, c]));

const ROOT = path.join(__dirname, '..');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000 });

app.disable('x-powered-by');
app.use(express.static(path.join(ROOT, 'public'), { maxAge: '1h', extensions: ['html'] }));
app.get('/shared/characters.json', (req, res) => res.sendFile(path.join(ROOT, 'shared/characters.json')));
// The audio lives at the repo root (the prototype links to it there too).
app.get('/audio/:file', (req, res) => {
  const file = path.basename(req.params.file);
  if (!file.endsWith('.m4a')) return res.sendStatus(404);
  res.sendFile(path.join(ROOT, file), { maxAge: '7d' }, (err) => err && !res.headersSent && res.sendStatus(404));
});
app.get('/healthz', (req, res) => res.json({ ok: true, rooms: manager.rooms.size }));

// ---- room manager ----
const manager = {
  io,
  rooms: new Map(),
  online: new Map(), // userId -> Set(socketId)
  remove(room) { this.rooms.delete(room.id); pushLobby(); },
  roomOf(userId, { includeClosed = false } = {}) {
    for (const r of this.rooms.values()) {
      const p = r.findPlayer(userId);
      if (p && (includeClosed || p.table.phase !== 'closed')) return { room: r, player: p };
    }
    return null;
  },
  notifyUser(userId, ev, data) { for (const sid of this.online.get(userId) || []) io.to(sid).emit(ev, data); },
};

races.on('jump', (race) => { for (const r of manager.rooms.values()) { r.tables.forEach((t) => t.onRaceJump(race)); r.changed(); } });
races.on('final', (race) => {
  for (const r of manager.rooms.values()) { r.tables.forEach((t) => t.onRaceFinal(race)); r.settleSneakies(race); r.changed(); }
});
setInterval(() => { for (const r of manager.rooms.values()) if (r.tables.some((t) => t.bet || t.phase === 'betting')) r.changed(); }, 2000).unref();

function meView(u) {
  const mates = u.mates.map((id) => store.getUser(id)).filter(Boolean).map((m) => ({ id: m.id, username: m.username, characterId: m.characterId, online: manager.online.has(m.id), at: manager.roomOf(m.id)?.room.summary() || null }));
  return {
    id: u.id, username: u.username, characterId: u.characterId, balance: u.balance, mates,
    requests: u.mateRequests.map((r) => ({ ...r, username: store.getUser(r.from)?.username })).filter((r) => r.username),
    invites: u.invites.slice(-10),
    rooms: store.roomsFor(u.id).map((r) => ({ code: r.code, name: r.name, buyIn: r.buyIn, scheduledAt: r.scheduledAt, owner: r.ownerId === u.id, live: manager.rooms.has(`r-${r.code}`) })),
    seated: manager.roomOf(u.id) ? manager.roomOf(u.id).room.id : null,
  };
}

function lobby() {
  return [...manager.rooms.values()].filter((r) => !r.private && r.tables.length).map((r) => r.summary()).filter((s) => s.players > 0).slice(0, 20);
}
function pushLobby() { io.to('lobby').emit('lobby', { live: lobby() }); }
setInterval(pushLobby, 5000).unref();

function release(socket, u) {
  const old = manager.roomOf(u.id, { includeClosed: true });
  if (old) old.room.leave(old.player);
}

function enter(socket, room) {
  const u = socket.data.user;
  release(socket, u);
  const res = room.join(u, socket);
  if (res.error) {
    if (!room.tables.length) manager.remove(room);
    return res;
  }
  socket.leave('lobby');
  pushLobby();
  return { ok: true, roomId: room.id };
}

function activeRoomFor(code) {
  const saved = store.getRoom(code);
  if (!saved) return null;
  const id = `r-${saved.code}`;
  if (!manager.rooms.has(id)) {
    manager.rooms.set(id, new Room(manager, { code: saved.code, name: saved.name, isPrivate: true, ownerId: saved.ownerId, buyIn: saved.buyIn }));
  }
  return manager.rooms.get(id);
}

io.on('connection', (socket) => {
  const authed = (fn) => (...args) => {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : () => {};
    const u = socket.data.user && store.getUser(socket.data.user.id);
    if (!u) return cb({ error: 'auth', message: 'Sign in first.' });
    socket.data.user = u;
    try { cb(fn(u, ...args) || { ok: true }); } catch (e) { console.error(e); cb({ error: 'server', message: 'Something went wrong.' }); }
  };
  const seated = (fn) => authed((u, ...args) => {
    const at = manager.roomOf(u.id, { includeClosed: true });
    if (!at) return { error: 'seat', message: 'You are not at a table.' };
    return fn(u, at.room, at.player, ...args);
  });

  function online(u) {
    socket.data.user = u;
    if (!manager.online.has(u.id)) manager.online.set(u.id, new Set());
    manager.online.get(u.id).add(socket.id);
    socket.join('lobby');
    const at = manager.roomOf(u.id, { includeClosed: true });
    if (at) at.room.attach(at.player, socket); // reconnect straight back to your seat
  }

  socket.on('hello', ({ token } = {}, cb = () => {}) => {
    const u = store.userByToken(token);
    if (!u) return cb({ needProfile: true });
    online(u);
    cb({ ok: true, token: u.token, me: meView(u), live: lobby(), serverNow: Date.now(), buyIns: config.BUY_INS });
  });

  socket.on('register', ({ username, characterId } = {}, cb = () => {}) => {
    const name = store.cleanName(username);
    if (name.length < 2) return cb({ error: 'name', message: 'Pick a name with at least 2 letters.' });
    if (store.userByName(name)) return cb({ error: 'name', message: 'That name’s taken at this pub.' });
    if (!CHAR[characterId]) return cb({ error: 'character', message: 'Pick who you’re coming as.' });
    const u = store.createUser(name, characterId);
    online(u);
    cb({ ok: true, token: u.token, me: meView(u), live: lobby(), serverNow: Date.now(), buyIns: config.BUY_INS });
  });

  socket.on('me', authed((u) => ({ ok: true, me: meView(u), live: lobby() })));

  socket.on('profile', authed((u, { characterId }) => {
    if (!CHAR[characterId]) return { error: 'character' };
    if (manager.roomOf(u.id)) return { error: 'seated', message: 'Finish your session before changing costume.' };
    u.characterId = characterId;
    store.save();
    return { ok: true, me: meView(u) };
  }));

  socket.on('topup', authed((u) => {
    u.balance = Math.round((u.balance + config.TOP_UP) * 100) / 100;
    store.save();
    return { ok: true, me: meView(u) };
  }));

  socket.on('table:find', authed((u, { buyIn }) => {
    if (manager.roomOf(u.id)) return { ok: true, roomId: manager.roomOf(u.id).room.id };
    buyIn = config.BUY_INS.includes(Number(buyIn)) ? Number(buyIn) : 20;
    const open = [...manager.rooms.values()].find((r) => !r.private && r.buyIn === buyIn && r.tables.some((t) => t.phase === 'gathering' && t.freeSeats()) && !r.allPlayers().some((p) => p.characterId === u.characterId));
    const room = open || new Room(manager, { buyIn });
    manager.rooms.set(room.id, room);
    return enter(socket, room);
  }));

  socket.on('live:join', authed((u, { roomId }) => {
    if (manager.roomOf(u.id)) return { ok: true, roomId: manager.roomOf(u.id).room.id };
    const room = manager.rooms.get(roomId);
    if (!room || room.private) return { error: 'gone', message: 'That table has wrapped up.' };
    return enter(socket, room);
  }));

  socket.on('room:create', authed((u, { name, buyIn, scheduledAt, invite = [] }) => {
    const clean = String(name || '').replace(/[^\p{L}\p{N} '!&.-]/gu, '').trim().slice(0, 28) || `${u.username}'s Punt`;
    buyIn = config.BUY_INS.includes(Number(buyIn)) ? Number(buyIn) : 20;
    const when = scheduledAt && Number(scheduledAt) > Date.now() ? Number(scheduledAt) : null;
    const r = store.createRoom({ name: clean, ownerId: u.id, buyIn, scheduledAt: when });
    inviteTo(u, r, invite);
    return { ok: true, code: r.code, me: meView(u) };
  }));

  socket.on('room:join', authed((u, { code }) => {
    if (manager.roomOf(u.id)) return { ok: true, roomId: manager.roomOf(u.id).room.id };
    const room = activeRoomFor(code);
    if (!room) return { error: 'code', message: 'No room with that code.' };
    return enter(socket, room);
  }));

  socket.on('room:invite', authed((u, { code, userIds }) => {
    const r = store.getRoom(code);
    if (!r || !r.members.includes(u.id)) return { error: 'code' };
    inviteTo(u, r, userIds);
    return { ok: true };
  }));

  function inviteTo(u, r, ids) {
    for (const id of (ids || []).filter((x) => u.mates.includes(x))) {
      const m = store.getUser(id);
      if (!m) continue;
      if (!r.members.includes(id)) r.members.push(id);
      m.invites = m.invites.filter((i) => i.code !== r.code).concat({ code: r.code, name: r.name, from: u.username, scheduledAt: r.scheduledAt, at: Date.now() });
      manager.notifyUser(id, 'invite', { code: r.code, name: r.name, from: u.username, scheduledAt: r.scheduledAt });
    }
    store.save();
  }

  // §11 recurring social groups: private, mutual, no counts or rankings.
  socket.on('mate:request', authed((u, { username, key }) => {
    let target = username ? store.userByName(username) : null;
    if (!target && key && key.startsWith('u:')) target = store.getUser(key.slice(2));
    if (!target || target.id === u.id) return { error: 'mate', message: 'Couldn’t find that punter.' };
    if (u.mates.includes(target.id)) return { ok: true, message: `${target.username} is already one of your punters.` };
    const theirs = u.mateRequests.find((r) => r.from === target.id);
    if (theirs) return acceptMate(u, target);
    if (!target.mateRequests.some((r) => r.from === u.id)) target.mateRequests.push({ from: u.id, at: Date.now() });
    store.save();
    manager.notifyUser(target.id, 'mateRequest', { from: u.username });
    return { ok: true, message: `Asked ${target.username} to join your punters.` };
  }));
  socket.on('mate:accept', authed((u, { userId }) => {
    const other = store.getUser(userId);
    if (!other || !u.mateRequests.some((r) => r.from === userId)) return { error: 'mate' };
    return acceptMate(u, other);
  }));
  socket.on('mate:decline', authed((u, { userId }) => {
    u.mateRequests = u.mateRequests.filter((r) => r.from !== userId);
    store.save();
    return { ok: true, me: meView(u) };
  }));
  function acceptMate(u, other) {
    u.mateRequests = u.mateRequests.filter((r) => r.from !== other.id);
    other.mateRequests = other.mateRequests.filter((r) => r.from !== u.id);
    if (!u.mates.includes(other.id)) u.mates.push(other.id);
    if (!other.mates.includes(u.id)) other.mates.push(u.id);
    store.save();
    manager.notifyUser(other.id, 'toast', { kind: 'mate', text: `${u.username} is now one of your punters.` });
    return { ok: true, me: meView(u), message: `${other.username} is now one of your punters.` };
  }

  // ---- at the table ----
  socket.on('chat', seated((u, room, p, { text }) => { room.chat(p, text); }));
  socket.on('ready', seated((u, room, p) => {
    const t = p.table;
    if (t.phase !== 'gathering') return { error: 'phase' };
    if (t.arrivedPlayers().length < 2 && !t.queue.length && !t.arriving) return { error: 'few', message: 'Need at least two at the table.' };
    t.ready = true;
    t.checkStart();
    room.changed();
  }));
  socket.on('fill', seated((u, room, p) => {
    if (!config.BOTS) return { error: 'bots', message: 'Regulars are switched off.' };
    p.table.fillWithRegulars();
  }));
  socket.on('stepOut', seated((u, room, p) => { p.table.stepOut(p); }));
  socket.on('bet', seated((u, room, p, bet) => {
    const err = p.table.placeGroupBet(p, bet || {});
    return err ? { error: 'bet', message: err } : { ok: true };
  }));
  socket.on('sneaky', seated((u, room, p, bet) => {
    const err = room.placeSneaky(p, bet || {});
    return err ? { error: 'sneaky', message: err } : { ok: true };
  }));
  socket.on('cashout', seated((u, room, p) => {
    const amount = p.table.cashOut(p, 'self');
    pushLobby();
    return { ok: true, amount, me: meView(store.getUser(u.id)) };
  }));
  socket.on('vote:call', seated((u, room, p) => {
    const err = p.table.callVote(p);
    return err ? { error: 'vote', message: err } : { ok: true };
  }));
  socket.on('vote', seated((u, room, p, { yes }) => { p.table.castVote(p, !!yes); }));
  socket.on('leave', seated((u, room, p) => {
    if (!room.leave(p)) return { error: 'phase', message: 'Cash out to leave a live table.' };
    socket.join('lobby');
    return { ok: true, me: meView(u), live: lobby() };
  }));

  socket.on('disconnect', () => {
    const u = socket.data.user;
    if (u) {
      const set = manager.online.get(u.id);
      set?.delete(socket.id);
      if (set && !set.size) manager.online.delete(u.id);
    }
    for (const r of manager.rooms.values()) r.detachSocket(socket.id);
  });
});

server.listen(config.PORT, () => {
  console.log(`On the Punt! open at http://localhost:${config.PORT} (time scale ${config.TIME_SCALE}, regulars ${config.BOTS ? 'on' : 'off'})`);
});

module.exports = { app, server, io, manager };
