export const $ = (s, r = document) => r.querySelector(s);

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    // Wrapped so a handler that happens to return false never cancels the default action.
    else if (k.startsWith('on') && typeof v === 'function') el[k] = (e) => { v(e); };
    else if (k === 'disabled' || k === 'checked') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

export function money(n, dp = 2) {
  const v = Number(n) || 0;
  const s = dp === 0 ? Math.round(v).toLocaleString('en-AU') : v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `$${s}`;
}

export function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const avatar = (id) => `/assets/characters/${id}/avatar.jpg`;
export const card = (id) => `/assets/characters/${id}/card.jpg`;
export const arrivalImg = (id) => `/assets/characters/${id}/arrival.jpg`;

export function ordinal(n) {
  if (!n || n <= 0) return 'nowhere';
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function when(ts) {
  const d = new Date(ts);
  const today = new Date();
  const time = d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase();
  if (d.toDateString() === today.toDateString()) return `today ${time}`;
  return `${d.toLocaleDateString('en-AU', { weekday: 'short' })} ${time}`;
}
