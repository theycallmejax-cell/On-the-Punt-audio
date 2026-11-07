// Same behaviour as the prototype: unlock on the first tap, quiet pub atmos underneath, ducked under voices.
const FILES = {
  atmos: 'On the Punt! atmos.m4a',
  cheryl: 'Cheryl opening fixed.m4a',
  drumroll: 'Table slap drum roll.m4a',
  bell: 'Sneaky Bell.m4a',
};
const AMBIENCE_NORMAL = 0.0163;
const AMBIENCE_DUCK = 0.004;

const els = {};
let ready = false;
let muted = false;
try { muted = localStorage.getItem('punt.muted') === '1'; } catch {}

const url = (f) => `/audio/${encodeURIComponent(f)}`;

function el(key, file) {
  if (!els[key]) {
    const a = new Audio(url(file));
    a.preload = 'auto';
    els[key] = a;
  }
  return els[key];
}

export function unlock(voiceFiles = []) {
  if (ready) return;
  ready = true;
  for (const [k, f] of Object.entries(FILES)) el(k, f);
  for (const f of voiceFiles) el(`voice:${f}`, f);
  const atmos = els.atmos;
  atmos.loop = true;
  atmos.volume = AMBIENCE_NORMAL;
  // iOS only lets audio play later if each element is started inside a user gesture.
  for (const [k, a] of Object.entries(els)) {
    if (k === 'atmos') continue;
    a.muted = true;
    a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
  }
  if (!muted) atmos.play().catch(() => {});
}

function duck() { if (els.atmos) els.atmos.volume = AMBIENCE_DUCK; }
export function restore() { if (els.atmos) els.atmos.volume = AMBIENCE_NORMAL; }

function play(a, { onEnd } = {}) {
  if (!a || muted) { onEnd?.(); return; }
  duck();
  a.currentTime = 0;
  a.onended = () => { a.onended = null; restore(); onEnd?.(); };
  a.play().catch(() => { restore(); onEnd?.(); });
}

export const sfx = {
  voice(file) { if (file) play(el(`voice:${file}`, file)); },
  cheryl() { play(els.cheryl); },
  drumroll() { play(els.drumroll); },
  bell() { play(els.bell); },
};

export function setRaceMode(on) {
  if (!els.atmos) return;
  els.atmos.volume = on ? 0.001 : AMBIENCE_NORMAL;
}

export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('punt.muted', muted ? '1' : '0'); } catch {}
  if (els.atmos) { if (muted) els.atmos.pause(); else els.atmos.play().catch(() => {}); }
  if (muted) for (const a of Object.values(els)) if (a !== els.atmos) a.pause();
  return muted;
}
export const isMuted = () => muted;
