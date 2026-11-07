// All ritual timings come from the Design Bible v5.7. TIME_SCALE shrinks them for testing only.
const SCALE = Math.max(0.01, Number(process.env.TIME_SCALE || 1));
const s = (seconds) => Math.round(seconds * 1000 * SCALE);

module.exports = {
  PORT: Number(process.env.PORT || 3000),
  TIME_SCALE: SCALE,
  BOTS: process.env.BOTS !== 'off',
  DATA_FILE: process.env.DATA_FILE || require('path').join(__dirname, '..', 'data', 'store.json'),

  TABLE_SIZE: 6, // §4.1 public tables fixed at 6 punters
  ROOM_MAX: 24, // §4.1 private rooms up to 24, as connected tables of 6
  STARTING_BALANCE: 1000,
  TOP_UP: 500,
  BUY_INS: [10, 20, 50, 100], // §6.1

  T: {
    arrival: s(5.5), // each entrance is its own witnessed moment (§12.4)
    fillWait: s(Number(process.env.FILL_WAIT || 20)), // public tables call in regulars after this wait
    botArrivalGap: s(4),
    ensemble: s(5), // §12.5 the table sees itself whole
    countdown: s(45), // §12.6
    cheryl: s(24), // §12.7 opening message delivery
    wheel: s(6), // §12.8
    tillFirstBet: s(20), // §12.9
    betWindow: s(300), // §6.3 five minutes
    betReminder: s(240), // §6.3 reminder at four minutes
    eventStartLimit: s(600), // §6.3 event must start within 10 minutes
    minJumpAfterBet: s(40), // leaves room for the full reveal ritual before the jump
    returnComment: s(15), // §8.1
    drumroll: s(5), // §8.2
    reveal: s(9), // §8.3 8–10 seconds
    raceRun: s(70),
    result: s(10),
    between: s(30),
    missed: s(6),
    silence: s(60), // §12.16
    vote: s(30),
    closeLinger: s(120),
    raceGap: s(95), // average gap between race jumps across all meetings
  },
};
