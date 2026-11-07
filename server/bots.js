// The regulars: house characters who fill public tables so the pub is never empty.
const { BANTER, CHARACTER_BANTER } = require('./content');
const characters = require('../shared/characters.json').characters;
const races = require('./races');

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((x) => x[1]);

function fill(template, ctx) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (ctx[k] !== undefined ? String(ctx[k]) : ''));
}

function lineFor(bot, event, ctx) {
  const own = CHARACTER_BANTER[bot.characterId]?.[event];
  const pool = own && Math.random() < 0.65 ? own : BANTER[event];
  if (!pool || !pool.length) return null;
  return fill(pick(pool), { ...ctx, name: ctx.name || bot.table.randomOtherName(bot) });
}

function freeCharacter(table) {
  const taken = new Set(table.room.allPlayers().map((p) => p.characterId));
  const free = characters.filter((c) => !taken.has(c.id));
  return free.length ? pick(free) : null;
}

// Several regulars react to a moment, staggered like a real table.
function react(table, event, ctx = {}, { max = 2, chance = 0.8, from = 0.8, to = 4.5, exclude = [] } = {}) {
  const bots = shuffle(table.activePlayers().filter((p) => p.isBot && !p.away && !exclude.includes(p)));
  let n = 0;
  for (const bot of bots) {
    if (n >= max) break;
    if (Math.random() > chance && n > 0) continue;
    n++;
    const delay = rnd(from, to) * 1000 * n * table.scale;
    table.later(delay, () => {
      if (!table.has(bot)) return;
      const text = lineFor(bot, event, ctx);
      if (text) table.room.say(bot, text);
    });
  }
}

function chooseBet(table) {
  const options = races.upcoming();
  if (!options.length) return null;
  const race = pick(options.slice(0, 4));
  const r = race.runners.slice().sort((a, b) => a.odds - b.odds);
  const runner = Math.random() < 0.55 ? pick(r.slice(0, 3)) : pick(r);
  const type = runner.odds > 8 && Math.random() < 0.6 ? 'eachway' : Math.random() < 0.2 ? 'place' : 'win';
  const max = table.maxBet();
  const amount = Math.max(1, Math.min(max, Math.round(max * pick([0.5, 0.75, 1, 1]))));
  return { raceId: race.id, runnerNo: runner.no, type, amount };
}

function takeTurn(table, bot) {
  table.later(rnd(25, 75) * 1000 * table.scale, () => {
    if (table.phase !== 'betting' || table.bettor() !== bot) return;
    const bet = chooseBet(table);
    if (bet) table.placeGroupBet(bot, bet);
  });
}

// While someone is out the back, a regular might slip a sneaky on.
function maybeSneaky(table) {
  const bots = table.activePlayers().filter((p) => p.isBot && !p.away);
  if (!bots.length || Math.random() > 0.45) return;
  table.later(rnd(15, 60) * 1000 * table.scale, () => {
    if (table.phase !== 'betting') return;
    const bot = pick(bots);
    if (!table.has(bot)) return;
    const bet = chooseBet(table);
    if (bet) table.room.placeSneaky(bot, { ...bet, amount: Math.ceil(rnd(5, 50)) });
  });
}

function vote(table) {
  for (const bot of table.activePlayers().filter((p) => p.isBot)) {
    table.later(rnd(2, 9) * 1000 * table.scale, () => {
      if (!table.vote || !table.has(bot)) return;
      table.castVote(bot, Math.random() < 0.7);
      if (Math.random() < 0.3) table.room.say(bot, lineFor(bot, 'vote', {}));
    });
  }
}

function maybeLeave(table) {
  const bots = table.activePlayers().filter((p) => p.isBot);
  if (table.activePlayers().length < 5 || !bots.length || Math.random() > 0.12) return;
  const bot = pick(bots);
  table.later(rnd(6, 14) * 1000 * table.scale, () => {
    if (!table.has(bot) || table.phase !== 'between') return;
    table.room.say(bot, lineFor(bot, 'leave', {}));
    table.later(2500 * table.scale, () => {
      if (!table.has(bot)) return;
      table.cashOut(bot, 'left');
      react(table, 'afterLeave', { leaver: bot.name, count: table.activePlayers().length }, { max: 2 });
    });
  });
}

module.exports = { react, takeTurn, maybeSneaky, vote, maybeLeave, freeCharacter, lineFor };
