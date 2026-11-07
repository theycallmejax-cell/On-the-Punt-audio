// Plays full sessions against a real server at 50x speed: arrival ritual, Cheryl, wheel, turns, reveal, race, sneaky, vote, payout.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 3900 + Math.floor(Math.random() * 90);
const DATA = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'punt-')), 'store.json');
let srv;

test.before(async () => {
  srv = spawn(process.execPath, [path.join(__dirname, '../server/index.js')], { env: { ...process.env, PORT, TIME_SCALE: '0.02', DATA_FILE: DATA }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res) => srv.stdout.on('data', (d) => String(d).includes('open at') && res()));
});
test.after(() => srv.kill());

function client() {
  const s = io(`http://localhost:${PORT}`, { transports: ['websocket'], forceNew: true });
  s.states = [];
  s.fxs = [];
  s.banter = [];
  s.on('state', (st) => { s.last = st; s.states.push(st.table.phase); });
  s.on('fx', (f) => s.fxs.push(f));
  s.on('banter', (m) => s.banter.push(m));
  s.call = (ev, data = {}) => new Promise((res) => s.emit(ev, data, res));
  return s;
}
const until = (fn, ms = 20000) => new Promise((res, rej) => {
  const t0 = Date.now();
  const iv = setInterval(() => { const v = fn(); if (v) { clearInterval(iv); res(v); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout')); } }, 20);
});

test('a public table runs the full ritual and pays out', async () => {
  const a = client();
  const reg = await a.call('register', { username: `Punter${PORT}`, characterId: 'banana' });
  assert.ok(reg.ok, JSON.stringify(reg));
  assert.equal(reg.me.balance, 1000);
  const found = await a.call('table:find', { buyIn: 20 });
  assert.ok(found.ok, JSON.stringify(found));

  // Regulars fill the table one arrival at a time, then the opening act runs.
  await until(() => a.last && a.last.table.seats.filter(Boolean).length === 6);
  await until(() => a.states.includes('countdown'));
  const arrivals = a.fxs.filter((f) => f.type === 'arrival');
  assert.equal(arrivals.length, 6, 'six sequential entrances');
  assert.notEqual(arrivals[0].characterId, 'mully', 'Mully never arrives first');
  assert.equal(a.last.table.pool, 120);
  assert.equal(a.last.table.maxBet, 10);
  await until(() => a.banter.some((m) => m.kind === 'cheryl' && m.text.startsWith('Alright people, welcome to The Cup')));
  await until(() => a.fxs.some((f) => f.type === 'wheel'));

  // Play until a race has settled on this table, placing the group bet whenever it's our turn.
  let placedSneaky = false;
  await until(() => {
    const st = a.last;
    if (!placedSneaky && st.races.length && st.table.phase !== 'gathering') {
      placedSneaky = true;
      const r = st.races[0];
      a.call('sneaky', { raceId: r.id, runnerNo: r.runners[0].no, type: 'win', amount: 5 });
    }
    if (st.table.phase === 'betting' && st.table.bettorSeat === st.me.seat && !a.betting) {
      a.betting = true;
      const r = st.races[0];
      a.call('bet', { raceId: r.id, runnerNo: r.runners[1].no, type: 'eachway', amount: 50 }).then((res) => {
        assert.equal(res.error, 'bet', 'max bet is enforced');
        return a.call('bet', { raceId: r.id, runnerNo: r.runners[1].no, type: 'eachway', amount: 10 });
      }).then((res) => assert.ok(res.ok, JSON.stringify(res)));
    }
    return st.table.phase === 'result';
  }, 60000);
  for (const p of ['return', 'drumroll', 'reveal', 'live', 'result']) assert.ok(a.states.includes(p), `reveal ritual phase ${p}`);
  assert.ok(a.fxs.some((f) => f.type === 'bell'), 'sneaky bell rang');
  const bell = a.banter.find((m) => m.kind === 'sneaky');
  assert.equal(bell.text, "Someone's placed a sneaky.");
  assert.ok(!JSON.stringify(bell).includes('banana'), 'sneaky never discloses who');

  await until(() => !['return', 'drumroll', 'reveal'].includes(a.last.table.phase) && a.last.table.phase !== 'result');
  const v = await a.call('vote:call');
  assert.ok(v.ok, JSON.stringify(v));
  const done = await new Promise((res) => a.on('cashedOut', res));
  assert.equal(done.reason, 'group');
  await until(() => a.last.table.phase === 'closed');
  await until(() => a.banter.some((m) => m.kind === 'cheryl' && m.text === "Good session people. Bar's still open."));
  const left = await a.call('leave');
  assert.ok(left.ok, JSON.stringify(left));
  assert.ok(left.me.balance > 0);
  a.close();
});

test('a private room fills only with invited mates and needs two to start', async () => {
  const h = client();
  const g = client();
  const hr = await h.call('register', { username: `Host${PORT}`, characterId: 'mully' });
  const gr = await g.call('register', { username: `Mate${PORT}`, characterId: 'the_hen' });
  assert.ok(hr.ok && gr.ok);
  const req = await h.call('mate:request', { username: `Mate${PORT}` });
  assert.ok(req.ok);
  const acc = await g.call('mate:accept', { userId: hr.me.id });
  assert.ok(acc.ok);
  assert.equal(acc.me.mates[0].username, `Host${PORT}`);
  const room = await h.call('room:create', { name: 'Friday Arvo', buyIn: 10, invite: [gr.me.id] });
  assert.ok(room.code);
  const invited = await g.call('me');
  assert.equal(invited.me.invites[0].code, room.code);

  assert.ok((await h.call('room:join', { code: room.code })).ok);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(h.fxs.filter((f) => f.type === 'arrival').length, 0, 'Mully waits for someone else to arrive first');
  assert.ok((await g.call('room:join', { code: room.code })).ok);
  await until(() => h.fxs.filter((f) => f.type === 'arrival').length === 2);
  assert.equal(h.fxs.find((f) => f.type === 'arrival').characterId, 'the_hen');
  await until(() => !h.last.table.arriving && h.last.table.queued === 0);
  assert.ok((await h.call('ready')).ok);
  await until(() => h.states.includes('countdown'));
  assert.equal(h.last.table.seats.filter(Boolean).length, 2, 'no regulars in a private room unless asked');
  const out = await g.call('cashout');
  assert.equal(out.amount, 10);
  h.close();
  g.close();
});
