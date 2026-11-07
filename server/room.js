const crypto = require('crypto');
const { T, TABLE_SIZE, ROOM_MAX, BOTS, TIME_SCALE } = require('./config');
const { CHERYL } = require('./content');
const races = require('./races');
const bots = require('./bots');
const store = require('./store');
const characters = require('../shared/characters.json').characters;
const CHAR = Object.fromEntries(characters.map((c) => [c.id, c]));

const RITUAL = new Set(['return', 'drumroll', 'reveal']); // §8 the reveal is unskippable and nothing competes with it
const SESSION = new Set(['ensemble', 'countdown', 'cheryl', 'wheel', 'selected', 'betting', 'return', 'drumroll', 'reveal', 'live', 'result', 'between', 'missed']);
const BET_TYPES = new Set(['win', 'place', 'eachway']);
const money = (n) => Math.round(n * 100) / 100;
const pick = (a) => a[Math.floor(Math.random() * a.length)];

class Player {
  constructor({ user, character, isBot }) {
    this.key = isBot ? `bot:${crypto.randomBytes(4).toString('hex')}` : `u:${user.id}`;
    this.userId = user?.id || null;
    this.username = user?.username || null;
    this.characterId = character.id;
    this.name = character.name;
    this.isBot = !!isBot;
    this.sockets = new Set();
    this.seat = -1;
    this.arrived = false;
    this.away = false;
    this.missed = 0;
    this.active = true;
    this.lastChat = 0;
  }
}

class Table {
  constructor(room, no) {
    this.room = room;
    this.no = no;
    this.seats = Array(TABLE_SIZE).fill(null);
    this.phase = 'gathering';
    this.endsAt = null;
    this.timer = null;
    this.timers = new Set();
    this.queue = [];
    this.arriving = null;
    this.arrivals = 0;
    this.ready = false;
    this.fillTimer = null;
    this.pool = 0;
    this.bettorSeat = -1;
    this.bet = null;
    this.result = null;
    this.vote = null;
    this.history = [];
    this.cheryl = null;
    this.wheel = null;
    this.closing = null;
    this.scale = TIME_SCALE;
  }

  // ---- helpers ----
  later(ms, fn) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }
  setPhase(phase, ms, next) {
    clearTimeout(this.timer);
    this.phase = phase;
    this.endsAt = ms ? Date.now() + ms : null;
    if (ms && next) this.timer = setTimeout(next, ms);
    this.room.changed();
  }
  activePlayers() { return this.seats.filter((p) => p && p.active); }
  arrivedPlayers() { return this.activePlayers().filter((p) => p.arrived); }
  humans() { return this.activePlayers().filter((p) => !p.isBot); }
  has(p) { return this.seats[p.seat] === p && p.active; }
  bettor() { return this.bettorSeat >= 0 ? this.seats[this.bettorSeat] : null; }
  freeSeats() { return this.seats.filter((s) => !s).length; }
  inSession() { return SESSION.has(this.phase); }
  randomOtherName(p) { const o = this.arrivedPlayers().filter((x) => x !== p); return o.length ? pick(o).name : 'Cheryl'; }
  channel() { return `${this.room.id}:t${this.no}`; }
  fx(payload) { this.room.io.to(this.channel()).emit('fx', { table: this.no, ...payload }); }

  maxBet() {
    // §6.1 max bet is half the buy-in, rising as the pool reaches the next table's buy-in for six.
    let m = this.room.buyIn / 2;
    for (const [threshold, max] of [[120, 10], [300, 25], [600, 50], [1200, 100]]) if (this.pool >= threshold && max > m) m = max;
    return Math.max(0, Math.min(m, Math.floor(this.pool)));
  }

  // ---- arrivals (§12.4) ----
  seat(player, buyIn) {
    const idx = this.seats.findIndex((s) => !s);
    if (idx < 0) return false;
    player.seat = idx;
    player.table = this;
    this.seats[idx] = player;
    this.pool = money(this.pool + buyIn);
    player.buyIn = buyIn;
    this.queue.push(player);
    this.pump();
    if (!player.isBot && !this.room.private && BOTS && this.phase === 'gathering' && !this.fillTimer) {
      this.fillTimer = this.later(T.fillWait, () => this.fillWithRegulars());
    }
    this.room.changed();
    return true;
  }

  pump() {
    if (this.arriving || !this.queue.length) return;
    // §12.4 Mully can never arrive first.
    let i = this.queue.findIndex((p) => !(p.characterId === 'mully' && this.arrivals === 0));
    if (i < 0) return;
    const p = this.queue.splice(i, 1)[0];
    if (!this.has(p)) return this.pump();
    this.arriving = p;
    p.arrived = true;
    const c = CHAR[p.characterId];
    this.fx({ type: 'arrival', seat: p.seat, characterId: p.characterId, name: p.name, line: c.arrival_line, until: Date.now() + T.arrival });
    this.room.post({ kind: 'arrival', tableNo: this.no, who: whoOf(p), text: c.arrival_line });
    if (this.arrivals > 0) bots.react(this, p.characterId === 'mully' ? 'arrivalMully' : 'arrival', { arrival: p.name }, { max: 1, chance: 0.6, from: 2, to: 3.5, exclude: [p] });
    this.room.changed();
    this.later(T.arrival, () => {
      this.arriving = null;
      this.arrivals++;
      this.pump();
      this.checkStart();
      this.room.changed();
    });
  }

  fillWithRegulars() {
    if (this.phase !== 'gathering' || !this.humans().length) return;
    const n = this.freeSeats();
    for (let k = 0; k < n; k++) {
      this.later(k * T.botArrivalGap, () => {
        if (this.phase !== 'gathering' || !this.freeSeats()) return;
        const c = bots.freeCharacter(this);
        if (c) this.seat(new Player({ character: c, isBot: true }), this.room.buyIn);
      });
    }
  }

  checkStart() {
    if (this.phase !== 'gathering' || this.arriving || this.queue.length) return;
    const n = this.arrivedPlayers().length;
    if (n >= TABLE_SIZE || (this.ready && n >= 2)) this.startSession();
  }

  // ---- opening act (§12.5 – 12.10) ----
  startSession() {
    clearTimeout(this.fillTimer);
    this.setPhase('ensemble', T.ensemble, () => this.setPhase('countdown', T.countdown, () => this.openCheryl()));
  }

  openCheryl() {
    const callout = pick(this.arrivedPlayers()).name;
    const text = CHERYL.opening(callout);
    this.cheryl = { text, at: Date.now() };
    this.fx({ type: 'cheryl', audio: 'opening' });
    this.room.post({ kind: 'cheryl', tableNo: this.no, text, who: { name: 'Cheryl' } }, { quiet: true });
    this.room.lastChatAt = Date.now();
    bots.react(this, 'cheryl', {}, { max: 3, chance: 0.9, from: 7, to: 7 });
    this.setPhase('cheryl', T.cheryl, () => this.spin());
  }

  spin() {
    const players = this.arrivedPlayers();
    if (!players.length) return this.close('empty');
    const chosen = pick(players);
    this.wheel = { seats: players.map((p) => p.seat), target: chosen.seat, at: Date.now(), duration: T.wheel };
    this.fx({ type: 'wheel', ...this.wheel });
    this.setPhase('wheel', T.wheel, () => this.select(chosen.seat));
  }

  select(seat) {
    this.bettorSeat = seat;
    this.bet = null;
    this.result = null;
    const b = this.bettor();
    this.fx({ type: 'selected', seat, name: b.name });
    bots.react(this, 'selected', { bettor: b.name }, { max: 2, exclude: [b] });
    this.setPhase('selected', T.tillFirstBet, () => this.startTurn());
  }

  // ---- turn (§6.2, §6.3, §7) ----
  startTurn() {
    const b = this.bettor();
    if (!b || !this.has(b)) return this.nextTurn();
    b.away = true; // §7 out of the room
    this.setPhase('betting', T.betWindow, () => this.missTurn());
    this.later(T.betReminder, () => {
      if (this.phase === 'betting' && this.bettor() === b) this.room.toPlayer(b, 'toast', { kind: 'reminder', text: 'One minute left to place the group bet.' });
    });
    bots.react(this, 'away', { bettor: b.name }, { max: 4, chance: 0.7, from: 2, to: 9, exclude: [b] });
    bots.maybeSneaky(this);
    if (b.isBot) bots.takeTurn(this, b);
  }

  stepOut(p) {
    if (this.phase === 'selected' && this.bettor() === p) this.startTurn();
  }

  placeGroupBet(p, { raceId, runnerNo, type, amount }) {
    if (this.phase !== 'betting' || this.bettor() !== p) return 'Not your turn.';
    const race = races.upcoming().find((r) => r.id === raceId);
    if (!race) return 'That race has closed. Pick one jumping in the next 10 minutes.';
    const runner = race.runners.find((r) => r.no === Number(runnerNo));
    if (!runner) return 'Pick a runner.';
    if (!BET_TYPES.has(type)) return 'Pick a bet type.';
    amount = Math.floor(Number(amount));
    const max = this.maxBet();
    if (!(amount >= 1 && amount <= max)) return `Group bets are $1 to $${max} at this table.`;
    this.pool = money(this.pool - amount);
    this.bet = { raceId, runnerNo: runner.no, runner: runner.name, odds: runner.odds, type, amount, bettor: p.name, characterId: p.characterId, race: race.title, at: Date.now() };
    p.away = false;
    p.missed = 0;
    // §8 reveal ritual: return + comment, drum roll, three-quarter-screen slip.
    this.fx({ type: 'return', seat: p.seat, name: p.name });
    bots.react(this, 'back', { bettor: p.name }, { max: 2, exclude: [p] });
    this.setPhase('return', T.returnComment, () => {
      this.fx({ type: 'drumroll' });
      if (Math.random() < 0.5) bots.react(this, 'drum', {}, { max: 1, from: 0.5, to: 1.5 });
      this.setPhase('drumroll', T.drumroll, () => {
        this.fx({ type: 'reveal' });
        this.revealReactions();
        this.setPhase('reveal', T.reveal, () => this.goLive());
      });
    });
    return null;
  }

  revealReactions() {
    const b = this.bettor();
    const ctx = { bettor: this.bet.bettor, runner: this.bet.runner, odds: this.bet.odds, type: this.bet.type, no: this.bet.runnerNo };
    if (b?.isBot) this.later(1200 * this.scale, () => this.has(b) && this.room.say(b, bots.lineFor(b, 'revealSelf', ctx)));
    const ev = this.bet.type === 'eachway' && Math.random() < 0.6 ? 'revealEachWay' : this.bet.odds >= 10 ? 'revealRoughie' : this.bet.odds < 3 ? 'revealFav' : 'reveal';
    bots.react(this, ev, ctx, { max: 3, from: 1.5, to: 3, exclude: [b] });
  }

  goLive() {
    this.room.flushBells(this);
    const race = races.get(this.bet.raceId);
    this.setPhase('live', null);
    if (race && race.status === 'final') this.onRaceFinal(race);
  }

  onRaceJump(race) {
    if (!this.bet || this.bet.raceId !== race.id) return;
    this.fx({ type: 'jump', raceId: race.id });
    bots.react(this, 'jump', { runner: this.bet.runner }, { max: 3, from: 1, to: 3 });
    for (const f of [0.45, 0.8]) {
      this.later(T.raceRun * f, () => {
        if (!this.bet || this.bet.raceId !== race.id || race.status !== 'running') return;
        const view = races.publicView(race);
        const leading = view.call && view.call.slice(0, 3).includes(this.bet.runnerNo);
        bots.react(this, leading ? 'leading' : 'trailing', { runner: this.bet.runner }, { max: 2, from: 0.5, to: 2 });
      });
    }
    this.room.changed();
  }

  onRaceFinal(race) {
    if (!this.bet || this.bet.raceId !== race.id || this.phase !== 'live') return;
    const s = races.settle(this.bet);
    this.pool = money(this.pool + s.ret);
    this.result = { ...s, bet: this.bet, finish: race.result.slice(0, 4) };
    this.history.unshift({ bettor: this.bet.bettor, characterId: this.bet.characterId, runner: this.bet.runner, race: this.bet.race, type: this.bet.type, amount: this.bet.amount, ret: s.ret, pos: s.pos });
    this.history = this.history.slice(0, 12);
    const ctx = { bettor: this.bet.bettor, runner: this.bet.runner, no: this.bet.runnerNo };
    bots.react(this, s.won ? 'win' : s.ret > 0 ? 'placed' : 'lose', ctx, { max: 4, from: 0.8, to: 2.5 });
    this.fx({ type: 'result', won: s.won, ret: s.ret });
    this.setPhase('result', T.result, () => {
      this.bet = null;
      if (this.pool < 1) return this.close('busted');
      this.setPhase('between', T.between, () => this.nextTurn());
      bots.maybeLeave(this);
    });
  }

  missTurn() {
    const b = this.bettor();
    if (!b) return this.nextTurn();
    b.away = false;
    b.missed++;
    this.room.post({ kind: 'system', tableNo: this.no, text: `${b.name} ran out of time. Turn passes on.` });
    if (b.missed >= 2) this.cashOut(b, 'missed'); // §6.3 two missed turns: cashed out, table continues
    this.setPhase('missed', T.missed, () => this.nextTurn());
  }

  nextTurn() {
    if (!this.activePlayers().length || !this.humans().length) return this.close('empty');
    if (this.pool < 1) return this.close('busted');
    // §12.10 clockwise from the current bettor.
    for (let k = 1; k <= TABLE_SIZE; k++) {
      const seat = (Math.max(0, this.bettorSeat) + k) % TABLE_SIZE;
      const p = this.seats[seat];
      if (p && p.active && p.arrived) return this.select(seat);
    }
    this.close('empty');
  }

  // ---- cash out (§9) ----
  cashOut(p, reason = 'self') {
    if (!this.has(p)) return 0;
    const n = this.activePlayers().length;
    const share = this.inSession() || this.phase === 'gathering' ? money(Math.floor((this.pool / n) * 100) / 100) : 0;
    this.pool = money(this.pool - share);
    p.active = false;
    p.away = false;
    this.seats[p.seat] = null;
    this.queue = this.queue.filter((q) => q !== p);
    if (this.arriving === p) this.arriving = null;
    if (!p.isBot) this.room.credit(p, share, reason);
    if (reason !== 'left') this.room.post({ kind: 'system', tableNo: this.no, text: `${p.name} cashed out.` });
    if (this.vote) { this.vote.yes.delete(p.key); this.vote.no.delete(p.key); }
    const wasBettor = this.bettorSeat === p.seat;
    if (!this.humans().length) { this.close('empty'); return share; }
    if (wasBettor && ['selected', 'betting'].includes(this.phase)) this.setPhase('missed', T.missed, () => this.nextTurn());
    if (this.phase === 'gathering') this.checkStart();
    this.room.changed();
    return share;
  }

  callVote(p) {
    if (!this.has(p) || this.vote || !this.inSession() || RITUAL.has(this.phase)) return 'You can call a cash-out vote once the reveal is done.';
    this.vote = { by: p.name, endsAt: Date.now() + T.vote, yes: new Set([p.key]), no: new Set() };
    this.vote.timer = setTimeout(() => this.resolveVote(), T.vote);
    this.fx({ type: 'vote', by: p.name });
    bots.vote(this);
    this.room.changed();
    this.checkVote();
    return null;
  }
  castVote(p, yes) {
    if (!this.vote || !this.has(p)) return;
    this.vote.yes.delete(p.key); this.vote.no.delete(p.key);
    (yes ? this.vote.yes : this.vote.no).add(p.key);
    this.room.changed();
    this.checkVote();
  }
  checkVote() {
    if (this.vote && this.vote.yes.size + this.vote.no.size >= this.activePlayers().length) this.resolveVote();
  }
  resolveVote() {
    const v = this.vote;
    if (!v) return;
    clearTimeout(v.timer);
    this.vote = null;
    if (v.yes.size * 2 >= this.activePlayers().length) return this.close('vote'); // §9.1 majority, 50% threshold
    this.room.post({ kind: 'system', tableNo: this.no, text: 'The table lets it ride.' });
    this.room.changed();
  }

  close(reason) {
    if (this.phase === 'closed') return;
    clearTimeout(this.timer);
    clearTimeout(this.vote?.timer);
    this.vote = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    const players = this.activePlayers();
    const share = players.length ? Math.floor((this.pool / players.length) * 100) / 100 : 0;
    this.closing = { reason, share, at: Date.now(), players: players.map((p) => ({ name: p.name, characterId: p.characterId })) };
    for (const p of players) if (!p.isBot) this.room.credit(p, share, 'group', { detach: false });
    this.pool = 0;
    if (reason !== 'empty' && players.some((p) => !p.isBot)) {
      this.room.post({ kind: 'cheryl', tableNo: this.no, text: CHERYL.close, who: { name: 'Cheryl' } }, { quiet: true }); // §12.17
    }
    this.bettorSeat = -1;
    this.bet = null;
    this.setPhase('closed', T.closeLinger, () => this.room.dropTable(this));
  }

  view(me) {
    const isBettor = this.bettor() === me;
    const showBet = this.bet && (isBettor || ['reveal', 'live', 'result'].includes(this.phase));
    const race = showBet ? races.get(this.bet.raceId) : null;
    return {
      no: this.no, phase: this.phase, endsAt: this.endsAt, pool: this.pool, maxBet: this.maxBet(), bettorSeat: this.bettorSeat, ready: this.ready,
      seats: this.seats.map((p, i) => p && {
        seat: i, key: p.key, name: p.name, username: p.username, characterId: p.characterId, arrived: p.arrived, away: p.away, isBot: p.isBot, isMe: p === me, mate: me.userId && p.userId ? this.room.isMate(me, p) : false,
      }),
      arriving: this.arriving ? this.arriving.seat : null,
      queued: this.queue.length,
      bet: showBet ? this.bet : null,
      race: race ? races.publicView(race) : null,
      result: this.phase === 'result' || this.phase === 'between' ? this.result : null,
      vote: this.vote && { by: this.vote.by, endsAt: this.vote.endsAt, yes: this.vote.yes.size, no: this.vote.no.size, of: this.activePlayers().length, mine: this.vote.yes.has(me.key) ? 'yes' : this.vote.no.has(me.key) ? 'no' : null },
      cheryl: this.cheryl, wheel: this.wheel, closing: this.closing, history: this.history,
    };
  }
}

const whoOf = (p) => ({ key: p.key, name: p.name, characterId: p.characterId, username: p.username, isBot: p.isBot });

class Room {
  constructor(manager, { code, name, isPrivate, ownerId, buyIn }) {
    this.manager = manager;
    this.io = manager.io;
    this.id = code ? `r-${code}` : `p-${crypto.randomBytes(4).toString('hex')}`;
    this.code = code || null;
    this.name = name || null;
    this.private = !!isPrivate;
    this.ownerId = ownerId || null;
    this.buyIn = buyIn;
    this.tables = [];
    this.banter = [];
    this.sneakies = [];
    this.pendingBells = [];
    this.lastChatAt = Date.now();
    this.usedSilence = [];
    this.dirty = null;
    this.silence = setInterval(() => this.checkSilence(), 2000);
  }

  allPlayers() { return this.tables.flatMap((t) => t.activePlayers()); }
  humanCount() { return this.allPlayers().filter((p) => !p.isBot).length; }
  findPlayer(userId) { return this.allPlayers().find((p) => p.userId === userId) || null; }
  isMate(me, p) { const u = store.getUser(me.userId); return !!u && u.mates.includes(p.userId); }
  capacity() { return this.private ? ROOM_MAX : TABLE_SIZE; }

  join(user, socket) {
    const character = CHAR[user.characterId];
    if (this.allPlayers().some((p) => p.characterId === character.id)) return { error: 'taken', message: `${character.name} is already at this table. Pick another character.` };
    if (this.humanCount() + this.allPlayers().filter((p) => p.isBot).length >= this.capacity() && !this.tables.some((t) => t.freeSeats())) return { error: 'full', message: 'This room is full.' };
    if (user.balance < this.buyIn) return { error: 'funds', message: `You need $${this.buyIn} to buy in. Top up in the lobby.` };
    let table = this.tables.find((t) => t.phase === 'gathering' && t.freeSeats()) || this.tables.find((t) => t.phase !== 'closed' && t.freeSeats());
    if (!table) {
      if (this.tables.filter((t) => t.phase !== 'closed').length * TABLE_SIZE >= this.capacity()) return { error: 'full', message: 'This room is full.' };
      table = new Table(this, (this.tables.reduce((m, t) => Math.max(m, t.no), 0) || 0) + 1);
      this.tables.push(table);
    }
    user.balance = money(user.balance - this.buyIn);
    store.save();
    const p = new Player({ user, character });
    p.table = table;
    this.bind(p, socket);
    table.seat(p, this.buyIn);
    if (this.private && this.code) {
      const r = store.getRoom(this.code);
      if (r && !r.members.includes(user.id)) { r.members.push(user.id); store.save(); }
    }
    return { ok: true, player: p };
  }

  bind(p, socket) {
    p.sockets.add(socket.id);
    socket.join(this.id);
    if (p.table) socket.join(p.table.channel());
    socket.data.roomId = this.id;
    this.changed();
  }
  attach(p, socket) {
    p.sockets.add(socket.id);
    socket.join(this.id);
    socket.join(p.table.channel());
    socket.data.roomId = this.id;
    this.changed();
  }
  detachSocket(socketId) {
    for (const p of this.allPlayers()) p.sockets.delete(socketId);
  }

  toPlayer(p, ev, data) { for (const sid of p.sockets) this.io.to(sid).emit(ev, data); }

  credit(p, amount, reason, { detach = true } = {}) {
    const u = store.getUser(p.userId);
    if (u) { u.balance = money(u.balance + amount); store.save(); }
    this.toPlayer(p, 'cashedOut', { amount, reason, balance: u?.balance, final: detach });
    if (detach) this.release(p);
  }

  release(p) {
    for (const sid of p.sockets) {
      const s = this.io.sockets.sockets.get(sid);
      if (s) { s.leave(this.id); if (p.table) s.leave(p.table.channel()); s.data.roomId = null; }
    }
    p.sockets.clear();
  }

  // Leaving a finished table (after Cheryl has closed it).
  leave(p) {
    const t = p.table;
    if (!t || t.phase !== 'closed') return false;
    p.active = false;
    if (t.seats[p.seat] === p) t.seats[p.seat] = null;
    this.release(p);
    if (!t.activePlayers().some((x) => !x.isBot)) this.dropTable(t);
    return true;
  }

  post(msg, { quiet = false } = {}) {
    const m = { id: crypto.randomBytes(5).toString('hex'), ts: Date.now(), ...msg };
    this.banter.push(m);
    if (this.banter.length > 200) this.banter.splice(0, this.banter.length - 200);
    if (!quiet && (m.kind === 'chat')) this.lastChatAt = m.ts;
    this.io.to(this.id).emit('banter', m);
    return m;
  }

  say(p, text) {
    if (!text) return;
    this.post({ kind: 'chat', tableNo: p.table.no, who: whoOf(p), text });
  }

  chat(p, raw) {
    const text = String(raw || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
    if (!text) return;
    const now = Date.now();
    if (now - p.lastChat < 700) return;
    p.lastChat = now;
    this.say(p, text);
    const t = p.table;
    if (Math.random() < 0.35) bots.react(t, 'reply', { name: p.name }, { max: 1, from: 1.5, to: 4 });
  }

  // §10 Sneaky side bets: optional, personal account, the room hears the bell but learns nothing else.
  placeSneaky(p, { raceId, runnerNo, type, amount }) {
    const race = races.get(raceId);
    if (!race || race.status !== 'open' || race.jumpAt - Date.now() < 5000) return 'That race has closed.';
    const runner = race.runners.find((r) => r.no === Number(runnerNo));
    if (!runner || !BET_TYPES.has(type)) return 'Pick a runner and bet type.';
    amount = Math.floor(Number(amount));
    if (!(amount >= 1)) return 'Enter an amount.';
    if (!p.isBot) {
      const u = store.getUser(p.userId);
      if (!u || u.balance < amount) return 'Not enough in your account.';
      u.balance = money(u.balance - amount);
      store.save();
    }
    this.sneakies.push({ key: p.key, userId: p.userId, raceId, runnerNo: runner.no, runner: runner.name, odds: runner.odds, type, amount, race: race.title, tableNo: p.table.no });
    const t = p.table;
    if (RITUAL.has(t.phase)) this.pendingBells.push(t.no); // §10.5 never competes with the reveal
    else this.ringBell(t.no);
    if (!p.isBot) this.toPlayer(p, 'toast', { kind: 'sneaky', text: `Sneaky on: ${runner.name} (${race.title}) $${amount} ${type === 'eachway' ? 'each way' : type}.` });
    this.changed();
    return null;
  }

  ringBell(tableNo) {
    const live = this.tables.filter((t) => t.phase !== 'closed').length;
    this.io.to(this.id).emit('fx', { type: 'bell' });
    this.post({ kind: 'sneaky', tableNo, who: { name: 'Cheryl' }, text: CHERYL.sneaky(tableNo, live) });
    for (const t of this.tables) {
      if (!t.inSession() && t.phase !== 'gathering') continue;
      bots.react(t, 'bell', {}, { max: 3, chance: 0.75, from: 1.2, to: 2.5 });
      if (Math.random() < 0.6) bots.react(t, 'denied', {}, { max: 1, from: 6, to: 9 });
    }
  }

  flushBells(table) {
    const mine = this.pendingBells.filter((n) => n === table.no);
    this.pendingBells = this.pendingBells.filter((n) => n !== table.no);
    mine.forEach((n, i) => setTimeout(() => this.ringBell(n), 1500 + i * 2500));
  }

  settleSneakies(race) {
    const done = this.sneakies.filter((s) => s.raceId === race.id);
    this.sneakies = this.sneakies.filter((s) => s.raceId !== race.id);
    for (const s of done) {
      if (!s.userId) continue;
      const r = races.settle(s);
      const u = store.getUser(s.userId);
      if (!u || !r) continue;
      u.balance = money(u.balance + r.ret);
      store.save();
      const p = this.findPlayer(s.userId);
      const text = r.ret > 0 ? `Your sneaky on ${s.runner} paid $${r.ret.toFixed(2)}. Keep it quiet 🤫` : `Your sneaky on ${s.runner} ran ${ordinal(r.pos)}. Nobody needs to know.`;
      if (p) this.toPlayer(p, 'toast', { kind: 'sneaky', text, balance: u.balance });
      else this.manager.notifyUser(s.userId, 'toast', { kind: 'sneaky', text, balance: u.balance });
    }
  }

  checkSilence() {
    const live = this.tables.filter((t) => t.inSession() && !['ensemble', 'countdown', 'cheryl'].includes(t.phase));
    if (!live.length || live.some((t) => RITUAL.has(t.phase))) return;
    if (Date.now() - this.lastChatAt < T.silence) return;
    if (this.usedSilence.length >= CHERYL.silence.length) this.usedSilence = [];
    const options = CHERYL.silence.filter((l) => !this.usedSilence.includes(l));
    const line = pick(options);
    this.usedSilence.push(line);
    this.lastChatAt = Date.now();
    this.post({ kind: 'cheryl', tableNo: live[0].no, who: { name: 'Cheryl' }, text: line }, { quiet: true }); // §12.16
  }

  dropTable(t) {
    if (!this.tables.includes(t)) return;
    for (const p of t.activePlayers()) { if (!p.isBot) { this.toPlayer(p, 'tableGone', {}); this.release(p); } p.active = false; }
    this.tables = this.tables.filter((x) => x !== t);
    if (!this.tables.length) this.destroy();
    else this.changed();
  }
  destroy() {
    clearInterval(this.silence);
    for (const t of this.tables) { clearTimeout(t.timer); for (const x of t.timers) clearTimeout(x); }
    this.tables = [];
    this.manager.remove(this);
  }

  changed() {
    if (this.dirty) return;
    this.dirty = setTimeout(() => { this.dirty = null; this.broadcast(); }, 40);
  }

  broadcast() {
    const upcoming = races.upcoming().map((r) => races.publicView(r));
    const sneakyRaces = races.upcoming(30 * 60000, 5000).map((r) => races.publicView(r));
    for (const t of this.tables) {
      for (const p of t.activePlayers()) {
        if (!p.sockets.size) continue;
        const u = p.userId ? store.getUser(p.userId) : null;
        this.toPlayer(p, 'state', {
          serverNow: Date.now(),
          room: { id: this.id, code: this.code, name: this.name, private: this.private, buyIn: this.buyIn, owner: u && this.ownerId === u.id, tables: this.tables.filter((x) => x.phase !== 'closed').map((x) => ({ no: x.no, players: x.activePlayers().length, phase: x.phase })) },
          me: { key: p.key, seat: p.seat, tableNo: t.no, balance: u?.balance ?? 0, missed: p.missed, sneakies: this.sneakies.filter((s) => s.key === p.key).map(({ runner, race, amount, type, odds }) => ({ runner, race, amount, type, odds })) },
          table: t.view(p),
          races: t.phase === 'betting' && t.bettor() === p ? upcoming : sneakyRaces,
          liveRaces: [...new Set(this.tables.map((x) => x.bet?.raceId).filter(Boolean))].map((id) => races.get(id)).filter(Boolean).map((r) => races.publicView(r)),
        });
      }
    }
  }

  summary() {
    const t = this.tables.find((x) => x.phase !== 'closed');
    const players = this.allPlayers();
    const first = players[0];
    return {
      roomId: this.id, code: this.code, private: this.private, name: this.name || (first ? `${first.name}'s Table` : 'A Table'), buyIn: this.buyIn,
      players: players.length, free: this.tables.reduce((n, x) => n + (x.phase !== 'closed' ? x.freeSeats() : 0), 0) + (this.private ? Math.max(0, ROOM_MAX - this.tables.length * TABLE_SIZE) : 0),
      pool: this.tables.reduce((n, x) => n + x.pool, 0), phase: t?.phase || 'closed', race: t?.bet?.race || null,
      avatars: players.slice(0, 6).map((p) => p.characterId), taken: players.map((p) => p.characterId),
    };
  }
}

function ordinal(n) {
  if (n <= 0) return 'nowhere';
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

module.exports = { Room, Table, Player };
