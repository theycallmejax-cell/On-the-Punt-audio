// Simulated racing feed. The pub is always on (§4.3): a continuous card of races across meetings.
// Swap this module for a real wagering provider; tables only use upcoming(), get(), settle() and the events.
const EventEmitter = require('events');
const crypto = require('crypto');
const { T } = require('./config');

const MEETINGS = [
  { name: 'Flemington', kind: 'gallops' }, { name: 'Randwick', kind: 'gallops' }, { name: 'Belmont', kind: 'gallops' },
  { name: 'Doomben', kind: 'gallops' }, { name: 'Caulfield', kind: 'gallops' }, { name: 'Morphettville', kind: 'gallops' },
  { name: 'Eagle Farm', kind: 'gallops' }, { name: 'Rosehill', kind: 'gallops' },
  { name: 'Warragul', kind: 'dogs' }, { name: 'Sandown Park', kind: 'dogs' }, { name: 'Wentworth Park', kind: 'dogs' },
];
const A = ['Clobber', 'Nard', 'Thunder', 'Lucky', 'Rusty', 'Bold', 'Sneaky', 'Big', 'Little', 'Midnight', 'Golden', 'Shifty', 'Dusty', 'Cheeky',
  'Outback', 'Barking', 'Southern', 'Wild', 'Flash', 'Quiet', 'Bush', 'Last', 'Royal', 'Smokin', 'Brave', 'Tidy', 'Hot', 'Silent', 'Captain', 'Sir'];
const B = ['etta', 'ini', 'Bolt', 'Larrikin', 'Punter', 'Dancer', 'Echo', 'Drongo', 'Galah', 'Shout', 'Schooner', 'Pie', 'Willy', 'Thongs',
  'Ute', 'Mate', 'Bloke', 'Dingo', 'Chook', 'Ripper', 'Goanna', 'Brumby', 'Tinnie', 'Swagman', 'Doona', 'Esky', 'Stubbie', 'Cuppa', 'Crumpet', 'Larry'];
const FIXED = ['Clobberetta', 'Nardini', 'Uncle Tom', 'Gnome Sweet Gnome', 'Each Way Eddie', 'Straight Bat', 'Ragrets'];
const SILKS = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#8e24aa', '#fb8c00', '#f5f5f5', '#212121', '#00acc1', '#d81b60', '#6d4c41', '#c0ca33'];

const rand = (n) => crypto.randomInt(n);
const pick = (a) => a[rand(a.length)];

function tote(p) {
  const o = Math.max(1.3, 0.86 / p);
  if (o < 4) return Math.round(o * 10) / 10;
  if (o < 10) return Math.round(o * 2) / 2;
  if (o < 30) return Math.round(o);
  return Math.round(o / 5) * 5;
}

class Races extends EventEmitter {
  constructor() {
    super();
    this.races = new Map();
    this.raceNo = new Map();
    this.lastJump = Date.now();
    this.tick = setInterval(() => this.step(), 1000);
    this.tick.unref?.();
    this.top();
  }

  make(jumpAt) {
    const recent = [...this.races.values()].filter((r) => r.status !== 'final').slice(-3).map((r) => r.meeting);
    const meeting = pick(MEETINGS.filter((m) => !recent.includes(m.name)));
    const no = ((this.raceNo.get(meeting.name) || rand(3)) % 10) + 1;
    this.raceNo.set(meeting.name, no);
    const field = meeting.kind === 'dogs' ? 8 : 6 + rand(7);
    const used = new Set();
    const strengths = Array.from({ length: field }, () => 0.25 + Math.random() ** 2 * 3);
    const total = strengths.reduce((a, b) => a + b, 0);
    const runners = strengths.map((st, i) => {
      let name;
      do {
        const b = pick(B);
        name = Math.random() < 0.12 ? pick(FIXED) : `${pick(A)}${/^[a-z]/.test(b) ? '' : ' '}${b}`;
      } while (used.has(name));
      used.add(name);
      const p = st / total;
      return { no: i + 1, name, p, odds: tote(p), silks: meeting.kind === 'dogs' ? null : [pick(SILKS), pick(SILKS)] };
    });
    const race = {
      id: crypto.randomBytes(5).toString('hex'), meeting: meeting.name, kind: meeting.kind, no,
      title: `R${no} ${meeting.name}`, distance: meeting.kind === 'dogs' ? `${pick([350, 460, 515, 525])}m` : `${pick([1000, 1200, 1400, 1600, 2000, 2400])}m`,
      jumpAt, status: 'open', runners, result: null, placesPaid: field >= 8 ? 3 : 2, checkpoints: null,
    };
    this.races.set(race.id, race);
    return race;
  }

  top() {
    const now = Date.now();
    const open = [...this.races.values()].filter((r) => r.status === 'open');
    let last = Math.max(now, ...open.map((r) => r.jumpAt));
    // Keep the card full: always at least 7 races open, first one never more than a minute away.
    if (!open.length) last = now + T.raceGap * 0.6;
    while ([...this.races.values()].filter((r) => r.status === 'open').length < 7) {
      last += Math.round(T.raceGap * (0.7 + Math.random() * 0.6));
      this.make(last);
    }
  }

  step() {
    const now = Date.now();
    for (const r of this.races.values()) {
      if (r.status === 'open' && now >= r.jumpAt) this.jump(r);
      else if (r.status === 'running' && now >= r.jumpAt + T.raceRun) this.finish(r);
      else if (r.status === 'final' && now > r.jumpAt + T.raceRun + 20 * 60000) this.races.delete(r.id);
    }
    this.top();
  }

  jump(r) {
    // Plackett–Luce finishing order weighted by each runner's chance.
    const left = r.runners.map((x) => ({ no: x.no, w: x.p }));
    const order = [];
    while (left.length) {
      let t = Math.random() * left.reduce((a, b) => a + b.w, 0);
      const i = left.findIndex((x) => (t -= x.w) <= 0);
      order.push(left.splice(i < 0 ? left.length - 1 : i, 1)[0].no);
    }
    r.result = order;
    // Running positions that tighten toward the real finish, for the live call.
    r.checkpoints = [0.2, 0.4, 0.6, 0.8, 0.92].map((f) => {
      const jitter = order.map((no, i) => ({ no, k: i + (1 - f) * (Math.random() * r.runners.length) }));
      return jitter.sort((a, b) => a.k - b.k).map((x) => x.no);
    });
    r.status = 'running';
    this.emit('jump', r);
  }

  finish(r) {
    r.status = 'final';
    this.emit('final', r);
  }

  get(id) { return this.races.get(id) || null; }

  upcoming(windowMs = T.eventStartLimit, minMs = T.minJumpAfterBet) {
    const now = Date.now();
    return [...this.races.values()].filter((r) => r.status === 'open' && r.jumpAt - now >= minMs && r.jumpAt - now <= windowMs)
      .sort((a, b) => a.jumpAt - b.jumpAt);
  }

  publicView(r) {
    const now = Date.now();
    const run = r.status === 'running' ? Math.min(1, (now - r.jumpAt) / T.raceRun) : r.status === 'final' ? 1 : 0;
    let call = null;
    if (r.status === 'running' && r.checkpoints) {
      const idx = Math.min(r.checkpoints.length - 1, Math.floor(run * (r.checkpoints.length + 1)) - 1);
      call = idx >= 0 ? r.checkpoints[idx].slice(0, 4) : null;
    }
    return {
      id: r.id, title: r.title, meeting: r.meeting, kind: r.kind, no: r.no, distance: r.distance, jumpAt: r.jumpAt, status: r.status,
      placesPaid: r.placesPaid, runEndsAt: r.jumpAt + T.raceRun,
      runners: r.runners.map(({ no, name, odds, silks }) => ({ no, name, odds, silks, place: placeOdds(odds, r.runners.length) })),
      call, result: r.status === 'final' ? r.result.slice(0, 4) : null,
    };
  }

  // Returns the total paid back (stake included) for a bet on a finished race.
  settle(bet) {
    const r = this.get(bet.raceId);
    if (!r || r.status !== 'final') return null;
    const runner = r.runners.find((x) => x.no === bet.runnerNo);
    const pos = r.result.indexOf(bet.runnerNo) + 1;
    const won = pos === 1;
    const placed = pos > 0 && pos <= r.placesPaid;
    const pl = placeOdds(runner.odds, r.runners.length);
    let ret = 0;
    if (bet.type === 'win') ret = won ? bet.amount * runner.odds : 0;
    else if (bet.type === 'place') ret = placed ? bet.amount * pl : 0;
    else ret = (won ? (bet.amount / 2) * runner.odds : 0) + (placed ? (bet.amount / 2) * pl : 0);
    return { ret: Math.round(ret * 100) / 100, pos, won, placed };
  }
}

const placeOdds = (odds, field) => Math.max(1.05, Math.round((1 + (odds - 1) / (field >= 8 ? 4 : 3)) * 100) / 100);

module.exports = new Races();
module.exports.placeOdds = placeOdds;
