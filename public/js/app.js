import { unlock, sfx, toggleMute, isMuted, setRaceMode } from './audio.js';
import { RaceCard } from './racecard.js';
import { h, $, clear, money, mmss, avatar, card, arrivalImg, ordinal, when } from './ui.js';

const socket = io({ transports: ['websocket', 'polling'] });
const call = (ev, data = {}) => new Promise((res) => socket.timeout(10000).emit(ev, data, (err, r) => res(err ? { error: 'net', message: 'Lost the connection. Try again.' } : r)));

const S = {
  chars: [], CHAR: {}, me: null, live: [], buyIns: [10, 20, 50, 100], buyIn: 20,
  st: null, offset: 0, screen: 's-splash', profileMode: 'new', pick: null, cat: 'Lads', pendingJoin: null,
  overlays: {}, wheel: null, arrivalTimer: null, typing: null, lastPhase: null, joinedAt: 0,
};
const now = () => Date.now() + S.offset;
let token = null;
try { token = localStorage.getItem('punt.token'); } catch {}
const saveToken = (t) => { token = t; try { localStorage.setItem('punt.token', t); } catch {} };

// ---------- boot ----------
fetch('/shared/characters.json').then((r) => r.json()).then(({ characters }) => {
  S.chars = characters;
  S.CHAR = Object.fromEntries(characters.map((c) => [c.id, c]));
  renderCharGrid();
});
setTimeout(() => $('#begin-wrap').classList.add('show'), 1760);
$('#beginBtn').onclick = () => {
  unlock(S.chars.map((c) => c.voice_file).filter(Boolean));
  hello().then((r) => { if (r?.ok && r.me.seated) return; show('s-pub'); });
};
$('#startBtn').onclick = () => (S.me ? showLobby() : openProfile('new'));
$('#muteBtn').onclick = () => { $('#muteBtn').textContent = toggleMute() ? '🔇' : '🔊'; };
$('#muteBtn').textContent = isMuted() ? '🔇' : '🔊';
$('#race-video').addEventListener('playing', (e) => e.target.classList.add('playing'));

function show(id) {
  S.screen = id;
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

async function hello() {
  if (!token) return null;
  const r = await call('hello', { token });
  if (r.needProfile) { token = null; return null; }
  if (r.ok) onMe(r);
  return r;
}
socket.on('connect', () => { if (token && S.screen !== 's-splash') hello(); });

function onMe(r) {
  if (r.token) saveToken(r.token);
  if (r.serverNow) S.offset = r.serverNow - Date.now();
  if (r.buyIns) S.buyIns = r.buyIns;
  if (r.me) S.me = r.me;
  if (r.live) S.live = r.live;
  if (S.me?.seated && S.screen !== 's-table') enterTable();
  renderLobby();
}

// ---------- profile ----------
function openProfile(mode, taken = []) {
  S.profileMode = mode;
  S.taken = new Set(taken);
  S.pick = mode === 'new' ? null : S.me?.characterId;
  $('#name-block').classList.toggle('hidden', mode !== 'new');
  $('#profile-head').textContent = mode === 'new' ? 'Who are ya?' : 'Change costume';
  $('#profileBack').classList.toggle('hidden', mode === 'new');
  if (S.pick) S.cat = S.CHAR[S.pick]?.category || 'Lads';
  renderCharGrid();
  show('s-profile');
}
$('#profileBack').onclick = () => { S.pendingJoin = null; showLobby(); };
$('#cat-tabs').onclick = (e) => {
  const cat = e.target.dataset?.cat;
  if (!cat) return;
  S.cat = cat;
  renderCharGrid();
};
function renderCharGrid() {
  document.querySelectorAll('#cat-tabs .tab').forEach((t) => t.classList.toggle('sel', t.dataset.cat === S.cat));
  const grid = clear($('#char-grid'));
  for (const c of S.chars.filter((x) => x.category === S.cat)) {
    const taken = S.taken?.has(c.id);
    grid.append(h('button', { class: `char-card${S.pick === c.id ? ' sel' : ''}${taken ? ' taken' : ''}`, onclick: () => { if (taken) return toast(`${c.name} is already at that table.`); S.pick = c.id; renderCharGrid(); } },
      h('img', { src: card(c.id), alt: c.name, loading: 'lazy' }), h('div', { class: 'nm', text: c.name })));
  }
  const c = S.CHAR[S.pick];
  $('#char-detail').classList.toggle('hidden', !c);
  if (c) {
    $('#cd-img').src = avatar(c.id);
    $('#cd-name').textContent = c.name;
    $('#cd-line').textContent = `“${c.arrival_line}”`;
    $('#cd-desc').textContent = c.restrictions?.includes('never_first_arrival') ? `${c.description} Never arrives first.` : c.description;
  }
}
$('#profileGo').onclick = async () => {
  if (!S.pick) return;
  let r;
  if (S.profileMode === 'new') {
    r = await call('register', { username: $('#username').value, characterId: S.pick });
  } else {
    r = await call('profile', { characterId: S.pick });
  }
  if (!r.ok) return toast(r.message || 'Try again.');
  onMe(r);
  if (S.pendingJoin) { const j = S.pendingJoin; S.pendingJoin = null; return join(j.ev, j.data); }
  showLobby();
};

// ---------- lobby ----------
function showLobby() {
  show('s-lobby');
  call('me').then((r) => r.ok && onMe(r));
}
socket.on('lobby', ({ live }) => { S.live = live; renderLobby(); });
socket.on('invite', (i) => { toast(`${i.from} invited you to ${i.name}${i.scheduledAt ? ` (${when(i.scheduledAt)})` : ''}`, { action: { label: 'Join', fn: () => join('room:join', { code: i.code }) } }); refreshMe(); });
socket.on('mateRequest', ({ from }) => { toast(`${from} wants to add you to their punters.`); refreshMe(); });
socket.on('toast', (t) => { toast(t.text, { kind: t.kind }); if (t.balance !== undefined && S.me) { S.me.balance = t.balance; renderLobby(); } });
const refreshMe = () => call('me').then((r) => r.ok && onMe(r));

function renderLobby() {
  if (!S.me) return;
  $('#balance').textContent = money(S.me.balance);
  $('#meAvatar img').src = avatar(S.me.characterId);
  const bi = clear($('#buyins'));
  const labels = { 10: 'CASUAL', 20: 'STANDARD', 50: 'SERIOUS', 100: 'HIGH ROLLER' };
  for (const b of S.buyIns) {
    bi.append(h('button', { class: `buyin-card${S.buyIn === b ? ' sel' : ''}`, onclick: () => { S.buyIn = b; renderLobby(); } },
      h('div', { class: 'buyin-amount', text: `$${b}` }), h('div', { class: 'buyin-label', text: labels[b] || '' })));
  }
  $('#find-sub').textContent = `Match with punters at $${S.buyIn}`;

  const live = clear($('#live-list'));
  if (!S.live.length) live.append(h('div', { class: 'empty-note', text: 'Quiet in here. Find a table and the regulars will pull up a stool.' }));
  for (const r of S.live) {
    live.append(h('button', { class: 'row-card', onclick: () => join('live:join', { roomId: r.roomId }, r.taken) },
      h('div', { class: 'live-chars' }, ...r.avatars.slice(0, 4).map((a) => h('div', { class: 'live-char' }, h('img', { src: avatar(a), alt: '' })))),
      h('div', { style: 'flex:1;padding-left:16px;min-width:0' }, h('div', { class: 'row-title', text: r.name }),
        h('div', { class: 'row-sub', text: `${r.players} players · $${r.buyIn}${r.race ? ` · ${r.race}` : r.phase === 'gathering' ? ' · filling up' : ''}` })),
      h('div', { class: 'live-amount', text: money(r.pool, 0) })));
  }

  const inv = clear($('#invites'));
  const invites = (S.me.invites || []).filter((i) => !S.me.rooms.some((r) => r.code === i.code && r.owner));
  $('#invites-block').classList.toggle('hidden', !invites.length);
  for (const i of invites.slice().reverse()) {
    inv.append(h('button', { class: 'row-card', onclick: () => join('room:join', { code: i.code }) }, h('span', { class: 'icon', text: '✉️' }),
      h('div', {}, h('div', { class: 'row-title', text: i.name }), h('div', { class: 'row-sub', text: `From ${i.from}${i.scheduledAt ? ` · ${when(i.scheduledAt)}` : ''}` })), h('span', { class: 'row-arrow', text: '›' })));
  }

  const rooms = clear($('#rooms'));
  if (!S.me.rooms.length) rooms.append(h('div', { class: 'empty-note', text: 'Name your own room and it’s yours to reopen any time.' }));
  for (const r of S.me.rooms.slice().reverse()) {
    rooms.append(h('div', { class: 'row-card' }, h('span', { class: 'icon', text: r.live ? '🍻' : '🔒' }),
      h('div', { style: 'flex:1;min-width:0' }, h('div', { class: 'row-title', text: r.name }),
        h('div', { class: 'row-sub', text: `Code ${r.code} · $${r.buyIn}${r.scheduledAt ? ` · ${when(r.scheduledAt)}` : ''}${r.live ? ' · on now' : ''}` })),
      h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('button', { class: 'pill small', text: r.live ? 'Join ›' : 'Open ›', onclick: () => join('room:join', { code: r.code }) }),
        h('button', { class: 'pill ghost small', text: 'Invite', onclick: () => inviteSheet(r) }))));
  }

  const req = clear($('#requests'));
  for (const q of S.me.requests || []) {
    req.append(h('div', { class: 'mate-row' }, h('div', { class: 'name', text: `${q.username} wants to be punters` }),
      h('button', { class: 'pill small', text: 'Accept', onclick: async () => { const r = await call('mate:accept', { userId: q.from }); if (r.ok) { onMe(r); toast(r.message); } } }),
      h('button', { class: 'pill ghost small', text: 'Nah', onclick: async () => { const r = await call('mate:decline', { userId: q.from }); if (r.ok) onMe(r); } })));
  }
  const mates = clear($('#mates'));
  if (!S.me.mates.length && !(S.me.requests || []).length) mates.append(h('div', { class: 'empty-note', text: 'Your regulars live here. Add mates by username, or from the table after a good session.' }));
  for (const m of S.me.mates) {
    mates.append(h('div', { class: 'mate-row' }, h('img', { src: avatar(m.characterId), alt: '' }),
      h('div', { class: 'name' }, h('span', { class: `dot${m.online ? ' on' : ''}` }), m.username),
      m.at && !m.at.private ? h('button', { class: 'pill ghost small', text: `At ${m.at.name} ›`, onclick: () => join('live:join', { roomId: m.at.roomId }, m.at.taken) }) : null));
  }
}
$('#meAvatar').onclick = () => openProfile('change');
$('#findBtn').onclick = () => join('table:find', { buyIn: S.buyIn });
$('#privateBtn').onclick = () => privateSheet();
$('#topUp').onclick = async () => { const r = await call('topup'); if (r.ok) { onMe(r); toast('Topped up $500 of play money.'); } };
$('#mateAdd').onclick = async () => {
  const name = $('#mateName').value.trim();
  if (!name) return;
  const r = await call('mate:request', { username: name });
  toast(r.message || (r.ok ? 'Sent.' : 'Couldn’t find that punter.'));
  if (r.ok) { $('#mateName').value = ''; if (r.me) onMe(r); }
};

async function join(ev, data, taken) {
  if (taken && S.me && taken.includes(S.me.characterId)) {
    S.pendingJoin = { ev, data };
    toast(`${S.CHAR[S.me.characterId].name} is already there. Pick another costume.`);
    return openProfile('change', taken);
  }
  const r = await call(ev, data);
  if (r.error === 'taken') { S.pendingJoin = { ev, data }; toast(r.message); return openProfile('change'); }
  if (!r.ok) return toast(r.message || 'Couldn’t get you a seat.');
  if (r.code && ev === 'room:create') return;
  enterTable();
}

function privateSheet() {
  const mates = S.me.mates;
  const picked = new Set();
  const name = h('input', { class: 'field', placeholder: `${S.me.username}'s Punt`, maxlength: 28 });
  const code = h('input', { class: 'field', placeholder: 'ROOM CODE', maxlength: 5, style: 'text-transform:uppercase;letter-spacing:3px;text-align:center' });
  const whenSel = h('select', { class: 'field' }, ...[['now', 'Now'], ['60', 'In an hour'], ['tonight', 'Tonight, 7:30pm'], ['friday', 'Friday arvo, 4pm']].map(([v, t]) => h('option', { value: v, text: t })));
  const list = h('div', { style: 'max-height:150px;overflow-y:auto' }, ...mates.map((m) => h('label', { class: 'mate-row', style: 'cursor:pointer' },
    h('input', { type: 'checkbox', onchange: (e) => (e.target.checked ? picked.add(m.id) : picked.delete(m.id)) }), h('img', { src: avatar(m.characterId), alt: '' }), h('span', { class: 'name', text: m.username }))));
  overlay('private', h('div', { class: 'overlay dim', onclick: (e) => e.target === e.currentTarget && overlay('private', null) },
    h('div', { class: 'sheet' },
      h('h3', { text: 'Private Room' }),
      h('p', { class: 'muted', text: `Your room, your mates, $${S.buyIn} buy-in. Up to 24 punters at connected tables of six.` }),
      name, whenSel,
      mates.length ? h('div', {}, h('div', { class: 'section-label', text: 'INVITE YOUR PUNTERS' }), list) : h('p', { class: 'muted', text: 'Add mates in the lobby to invite them straight in. Or share the code.' }),
      h('button', { class: 'big-btn gold', text: 'Open the room', onclick: async () => {
        const v = whenSel.value;
        const d = new Date();
        let at = null;
        if (v === '60') at = Date.now() + 3600e3;
        if (v === 'tonight') { d.setHours(19, 30, 0, 0); at = d.getTime() > Date.now() ? d.getTime() : d.getTime() + 864e5; }
        if (v === 'friday') { d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7)); d.setHours(16, 0, 0, 0); at = d.getTime(); }
        const r = await call('room:create', { name: name.value, buyIn: S.buyIn, scheduledAt: at, invite: [...picked] });
        if (!r.ok) return toast(r.message || 'Couldn’t open it.');
        onMe(r);
        overlay('private', null);
        if (at) return toast(`Booked for ${when(at)}. Code ${r.code}.`);
        join('room:join', { code: r.code });
      } }),
      h('div', { class: 'section-label', style: 'margin:6px 0 0', text: 'GOT A CODE?' }),
      h('div', { class: 'row' }, code, h('button', { class: 'big-btn ghost', text: 'Join ›', onclick: () => { overlay('private', null); join('room:join', { code: code.value.trim().toUpperCase() }); } })))));
}

function inviteSheet(room) {
  const picked = new Set();
  overlay('invite', h('div', { class: 'overlay dim', onclick: (e) => e.target === e.currentTarget && overlay('invite', null) },
    h('div', { class: 'sheet' }, h('h3', { text: room.name }), h('p', { text: `Room code ${room.code}` }),
      ...(S.me.mates.length ? S.me.mates.map((m) => h('label', { class: 'mate-row' }, h('input', { type: 'checkbox', onchange: (e) => (e.target.checked ? picked.add(m.id) : picked.delete(m.id)) }),
        h('img', { src: avatar(m.characterId), alt: '' }), h('span', { class: 'name', text: m.username }))) : [h('p', { class: 'muted', text: 'No punters yet. Share the code instead.' })]),
      h('button', { class: 'big-btn gold', text: 'Send invites', onclick: async () => { await call('room:invite', { code: room.code, userIds: [...picked] }); overlay('invite', null); toast('Invites sent.'); } }))));
}

// ---------- table ----------
function enterTable() {
  if (S.screen !== 's-table') {
    S.lastPhase = null;
    S.layerSig = null;
    S.st = null;
    S.joinedAt = Date.now();
    show('s-table');
  }
}

socket.on('state', (st) => {
  S.offset = st.serverNow - Date.now();
  const prev = S.st;
  S.st = st;
  if (S.me) S.me.balance = st.me.balance;
  if (S.screen !== 's-table') enterTable();
  renderTable(prev);
});
socket.on('backlog', (msgs) => { clear($('#banter')); msgs.forEach((m) => addMsg(m, true)); });
socket.on('banter', (m) => addMsg(m, false));
socket.on('fx', onFx);
socket.on('cashedOut', (c) => {
  if (!c.final) return;
  overlay('closedSelf', h('div', { class: 'overlay dim' }, h('div', { class: 'sheet' },
    h('h3', { text: c.reason === 'missed' ? 'Missed two turns' : 'Cashed out' }),
    h('p', { text: c.reason === 'missed' ? `The table kept your seat warm, but two missed turns cashes you out with ${money(c.amount)}.` : `You walk out with ${money(c.amount)}. Bar's still open.` }),
    h('button', { class: 'big-btn gold', text: 'Back to the lobby ›', onclick: () => { overlay('closedSelf', null); resetTable(); showLobby(); } }))));
});
socket.on('tableGone', () => { resetTable(); showLobby(); });

function resetTable() {
  for (const k of Object.keys(S.overlays)) if (k !== 'private') overlay(k, null);
  clear($('#banter'));
  clear($('#seats'));
  clearInterval(S.typing);
  S.st = null;
  S.racecard = null;
  setRaceMode(false);
  $('#race-video').pause();
}

function seatPos(i) {
  const x = 11.5 + i * 15.4;
  const top = 14 - (2.5 - Math.abs(i - 2.5)) * 5;
  return { left: `${x}%`, top: `${top}%`, z: 10 + Math.round(Math.abs(i - 2.5) * 2) };
}

function renderTable(prev) {
  const st = S.st;
  const t = st.table;
  const phase = t.phase;
  const changed = phase !== S.lastPhase;
  S.lastPhase = phase;
  const bettor = t.bettorSeat >= 0 ? t.seats[t.bettorSeat] : null;
  const iAmBettor = bettor && bettor.isMe;

  // seats
  const seats = $('#seats');
  for (let i = 0; i < 6; i++) {
    const p = t.seats[i];
    const vis = p && p.arrived;
    let el = seats.querySelector(`[data-seat="${i}"]`);
    const key = vis ? p.key : 'empty';
    if (!el || el.dataset.key !== key) {
      el?.remove();
      if (!vis && phase !== 'gathering') continue;
      const pos = seatPos(i);
      el = h('div', { class: `seat${vis ? '' : ' empty'}${vis && prev ? ' arrive' : ''}`, 'data-seat': i, 'data-key': key, style: `left:${pos.left};top:${pos.top};z-index:${pos.z}`, onclick: () => vis && seatSheet(p) },
        h('div', { class: 'port' }, vis ? h('img', { src: card(p.characterId), alt: p.name }) : null),
        h('div', { class: 'lbl', text: vis ? (p.isMe ? `${p.name} (you)` : p.name) : p ? 'On the way…' : 'Empty' }));
      seats.append(el);
    }
    if (!vis) { if (el) el.querySelector('.lbl').textContent = p ? 'On the way…' : 'Empty'; continue; }
    el.classList.toggle('me', p.isMe);
    el.classList.toggle('bettor', i === t.bettorSeat && ['selected', 'betting', 'return', 'drumroll', 'reveal', 'live', 'result'].includes(phase));
    el.classList.toggle('away', p.away);
    let tag = el.querySelector('.tag');
    const want = p.away ? 'OUT THE BACK' : i === t.bettorSeat && ['selected', 'return', 'drumroll', 'reveal', 'live'].includes(phase) ? 'BETTOR' : '';
    if (want && !tag) { tag = h('div', { class: 'tag' }); el.append(tag); }
    if (tag) { if (!want) tag.remove(); else { tag.textContent = want; tag.classList.toggle('away', p.away); } }
  }
  seats.querySelectorAll('.seat').forEach((el) => { if (phase !== 'gathering' && el.classList.contains('empty')) el.remove(); });

  // TV / race feed
  const race = t.race;
  const racing = race && race.status === 'running' && ['live', 'reveal'].includes(phase);
  $('#stage').classList.toggle('racing', !!racing);
  const video = $('#race-video');
  if (racing) {
    video.classList.remove('hidden');
    if (video.paused) { video.currentTime = Math.max(0, (now() - race.jumpAt) / 1000); video.play().catch(() => {}); }
    setRaceMode(true);
  } else {
    if (!video.paused) video.pause();
    video.classList.add('hidden');
    video.classList.remove('playing');
    setRaceMode(false);
  }

  $('#composer').classList.toggle('hidden', phase === 'closed');
  $('#cashoutBtn').classList.toggle('hidden', phase === 'closed');
  renderHud();
  renderLayer(changed);
  renderOverlays(changed, iAmBettor);
  $('#cheryl-float').classList.toggle('hidden', phase !== 'cheryl');
  $('#banter').classList.toggle('with-cheryl', phase === 'cheryl');
}

function renderHud() {
  const st = S.st, t = st.table;
  const hud = clear($('#hud'));
  const multi = st.room.tables.length > 1;
  hud.append(h('div', { class: 'chip' }, multi ? h('span', { text: `T${t.no} · ` }) : null, 'POOL ', h('b', { text: money(t.pool, 0) }), t.phase !== 'gathering' ? h('span', {}, ' · MAX ', h('b', { text: `$${t.maxBet}` })) : null));
  const label = timerLabel();
  if (label) hud.append(h('div', { class: 'timer-box' }, h('div', { class: 't-label', text: label.label }), h('div', { class: 't-count', 'data-until': label.until, text: mmss(label.until - now()) })));
}

function timerLabel() {
  const t = S.st.table;
  const b = t.bettorSeat >= 0 ? t.seats[t.bettorSeat] : null;
  switch (t.phase) {
    case 'selected': return { label: 'TILL FIRST BET', until: t.endsAt };
    case 'betting': return { label: b?.isMe ? 'YOUR CALL' : `${(b?.name || '').toUpperCase()} OUT THE BACK`, until: t.endsAt };
    case 'return': return { label: 'REVEAL IN', until: t.endsAt + 5000 };
    case 'live': return t.race && t.race.status === 'open' ? { label: `JUMPS ${t.race.title.toUpperCase()}`, until: t.race.jumpAt } : null;
    case 'between': return { label: 'NEXT GROUP BET', until: t.endsAt };
    default: return null;
  }
}

function renderLayer(changed) {
  const st = S.st, t = st.table, phase = t.phase;
  const layer = $('#stage-layer');
  const b = t.bettorSeat >= 0 ? t.seats[t.bettorSeat] : null;
  const sig = JSON.stringify([phase, t.bettorSeat, t.arriving, t.ready, t.seats.map((s) => s && [s.arrived, s.away]), t.result?.ret, t.race?.status, st.room.private, t.queued]);
  if (sig === S.layerSig) return;
  S.layerSig = sig;
  clear(layer);
  const arrived = t.seats.filter((s) => s && s.arrived).length;

  if (phase === 'gathering' && t.arriving === null) {
    layer.append(h('div', { class: 'stage-note', text: st.room.private
      ? (arrived < 2 ? 'Waiting for your mates to walk in…' : 'Everyone here? Call it and the round begins.')
      : arrived >= 6 ? 'Full table.' : `Finding punters… ${arrived}/6 at the table. If it’s quiet, the regulars pull up a stool.` }));
    const acts = h('div', { class: 'stage-actions' });
    if (st.room.private) {
      if (st.room.code) acts.append(h('div', { class: 'code-chip' }, 'Code ', h('b', { text: st.room.code })));
      acts.append(h('button', { class: 'pill ghost small', text: 'Call in the regulars', onclick: () => call('fill') }));
      if (arrived >= 2) acts.append(h('button', { class: 'pill', text: 'We’re all here ›', onclick: () => call('ready').then((r) => r.ok || toast(r.message)) }));
    }
    layer.append(acts);
  }
  if (phase === 'ensemble') layer.append(banner('RIGHT, WE’RE ALL HERE', `${arrived} punters · ${money(t.pool, 0)} in the pool`));
  if (phase === 'countdown') layer.append(h('div', { class: 'banner countdown' }, h('div', { class: 'big', text: 'Round begins in' }), h('div', { class: 'num', 'data-until': t.endsAt, 'data-fmt': 'mmss', text: mmss(t.endsAt - now()) })));
  if (phase === 'wheel') layer.append(h('div', { class: 'stage-note', text: '🎡 Spinning for the group bettor…' }));
  if (phase === 'selected' && b) {
    layer.append(banner(b.isMe ? 'YOU’RE UP!' : `${b.name.toUpperCase()}’S UP`, b.isMe ? 'Step out the back and pick the group bet.' : 'Turn order runs clockwise from here.'));
    if (b.isMe) layer.append(h('div', { class: 'stage-actions' }, h('button', { class: 'pill', text: 'Step out the back ›', onclick: () => call('stepOut') })));
  }
  if (phase === 'betting' && b && !b.isMe) layer.append(h('div', { class: 'stage-note', text: `${b.name} is out the back picking the group bet. What do we reckon they’ll come back with?` }));
  if (phase === 'return' && b) layer.append(banner(`${b.name.toUpperCase()}’S BACK`, 'Get your calls in before the drum roll.'));
  if (phase === 'drumroll') layer.append(h('div', { class: 'drum' }, h('span', { text: '🥁' })));
  if (phase === 'missed') layer.append(banner('TURN PASSES ON', b ? `${b.name} ran out of time.` : ''));
  if (['live', 'result'].includes(phase) && t.bet) {
    const bet = t.bet;
    layer.append(h('div', { class: 'slip-chip' }, h('span', {}, h('b', { text: `#${bet.runnerNo} ${bet.runner}` }), ` ${typeName(bet.type)}`), h('span', { text: `$${bet.amount} @ ${bet.odds.toFixed(2)} · ${bet.race}` })));
  }
  if (phase === 'live' && t.race?.status === 'running') layer.append(h('div', { class: 'call', id: 'race-call' }));
  if (phase === 'result' && t.result) {
    const r = t.result;
    const big = r.won ? 'WINNER! 🏆' : r.ret > 0 ? 'PLACED 💰' : 'NO LUCK 😬';
    layer.append(h('div', { class: `result ${r.ret > 0 ? 'win' : 'lose'}` }, h('div', { class: 'big', text: big }),
      h('div', { class: 'line', text: r.ret > 0 ? `${money(r.ret)} back to the pool` : `${r.bet.runner} ran ${ordinal(r.pos)}` }),
      h('div', { class: 'finish', text: `Result: ${r.finish.slice(0, 3).join(' – ')}` })));
  }
  if (phase === 'between' && t.history[0]) {
    const x = t.history[0];
    layer.append(h('div', { class: 'stage-note', text: `Last: ${x.bettor} · ${x.runner} ${x.ret > 0 ? `returned ${money(x.ret)}` : `ran ${ordinal(x.pos)}`}` }));
  }
}

const banner = (big, sub) => h('div', { class: 'banner' }, h('div', { class: 'big', text: big }), sub ? h('div', { class: 'sub', text: sub }) : null);
const typeName = (t) => ({ win: 'WIN', place: 'PLACE', eachway: 'EACH WAY' }[t] || t);

function renderOverlays(changed, iAmBettor) {
  const st = S.st, t = st.table, phase = t.phase;

  // Out of the room (§7): the bettor leaves the table entirely while choosing.
  if (phase === 'betting' && iAmBettor) {
    if (!S.overlays.backroom) {
      S.racecard = new RaceCard({
        mode: 'group', onPlace: async (bet) => {
          const r = await call('bet', bet);
          if (!r.ok) S.racecard?.error(r.message);
        },
        onClose: null,
      });
      overlay('backroom', h('div', { class: 'overlay backroom' },
        h('div', { class: 'backroom-head' }, h('div', {}, h('div', { class: 't', text: 'Out the back' }), h('div', { class: 's', text: 'The table’s talking about you. Pick the group bet.' })),
          h('div', { class: 'timer-box' }, h('div', { class: 't-label', text: 'GROUP BET' }), h('div', { class: 't-count', 'data-until': t.endsAt, text: mmss(t.endsAt - now()) }))),
        S.racecard.el));
    }
    S.racecard.update({ races: st.races, maxBet: t.maxBet, pool: t.pool, balance: st.me.balance });
  } else if (S.overlays.backroom) {
    overlay('backroom', null);
    S.racecard = null;
  }

  // Reveal (§8.3): three-quarter screen slip, the last quarter stays banter. Unskippable.
  if (phase === 'reveal' && t.bet) {
    if (!S.overlays.reveal) {
      const bet = t.bet, run = t.race?.runners.find((x) => x.no === bet.runnerNo);
      const ret = bet.type === 'win' ? bet.amount * bet.odds : bet.type === 'place' ? bet.amount * (run?.place || 1) : (bet.amount / 2) * bet.odds + (bet.amount / 2) * (run?.place || 1);
      overlay('reveal', h('div', { class: 'reveal-wrap' }, h('div', { class: 'slip' },
        h('div', { class: 'k', text: 'ON THE PUNT! · GROUP BET' }),
        h('div', { class: 'race-t', text: `${bet.race}${t.race ? ` · ${t.race.distance}` : ''}` }),
        h('div', { class: 'runner-t' }, run?.silks ? h('span', { class: 'silk', style: `background:linear-gradient(135deg,${run.silks[0]} 50%,${run.silks[1]} 50%)` }) : null, `#${bet.runnerNo} ${bet.runner}`),
        h('div', { class: 'type', text: typeName(bet.type) }),
        h('div', { class: 'nums' }, h('div', {}, h('b', { text: `$${bet.amount}` }), 'STAKE'), h('div', {}, h('b', { text: `$${bet.odds.toFixed(2)}` }), 'ODDS'), h('div', {}, h('b', { text: money(ret) }), 'COULD RETURN')),
        h('div', { class: 'by' }, h('img', { src: avatar(bet.characterId), alt: '' }), `Picked by ${bet.bettor}`))));
    }
  } else if (S.overlays.reveal) overlay('reveal', null);

  // Group cash-out vote (§9.1).
  if (t.vote) {
    const v = t.vote;
    overlay('vote', h('div', { class: 'overlay dim' }, h('div', { class: 'sheet' },
      h('h3', { text: 'Cash out the table?' }),
      h('p', { text: `${v.by} wants to call it. Majority rules.` }),
      h('div', { class: 'tally' }, h('span', { class: 'y', text: `Cash out ${v.yes}` }), h('span', { class: 'n', text: `Ride ${v.no}` })),
      h('p', { class: 'muted' }, h('span', { 'data-until': v.endsAt, 'data-fmt': 's', text: `${Math.ceil((v.endsAt - now()) / 1000)}` }), 's to vote'),
      h('div', { class: 'row' },
        h('button', { class: 'big-btn red', text: v.mine === 'yes' ? 'Cash Out ✓' : 'Cash Out', onclick: () => call('vote', { yes: true }) }),
        h('button', { class: 'big-btn blue', text: v.mine === 'no' ? 'Let it Ride ✓' : 'Let it Ride', onclick: () => call('vote', { yes: false }) })))));
  } else if (S.overlays.vote) overlay('vote', null);

  // Session close (§12.17).
  if (phase === 'closed' && t.closing) {
    if (!S.overlays.closed) {
      const others = t.seats.filter((p) => p && !p.isMe && !p.isBot);
      overlay('closed', h('div', { class: 'closed' },
        h('div', { class: 'top' }, h('img', { src: '/assets/img/cheryl.jpg', alt: 'Cheryl' }), h('div', { class: 'quote' }, 'Good session people. Bar’s still open.', h('small', { text: '— Cheryl' }))),
        h('div', { class: 'body scroll-quiet' },
          h('div', { class: 'share' }, 'Your share', h('b', { text: money(t.closing.share) })),
          others.length ? h('div', { class: 'section-label', text: 'GOOD SESSION? ADD THEM TO YOUR PUNTERS' }) : null,
          ...others.map((p) => h('div', { class: 'mate-row' }, h('img', { src: avatar(p.characterId), alt: '' }), h('div', { class: 'name', text: `${p.name} · ${p.username}` }),
            p.mate ? h('span', { class: 'row-sub', text: 'One of yours ✓' }) : h('button', { class: 'pill small', text: 'Add', onclick: async (e) => { const r = await call('mate:request', { key: p.key }); toast(r.message || 'Sent.'); e.target.disabled = true; } }))),
          h('button', { class: 'btn-gold', style: 'margin-top:18px', text: 'BACK TO THE LOBBY', onclick: async () => { await call('leave'); resetTable(); showLobby(); } }))));
    }
  } else if (S.overlays.closed) overlay('closed', null);
}

function seatSheet(p) {
  if (p.isMe) return;
  const c = S.CHAR[p.characterId];
  overlay('seat', h('div', { class: 'overlay dim', onclick: (e) => e.target === e.currentTarget && overlay('seat', null) }, h('div', { class: 'sheet' },
    h('img', { src: card(p.characterId), alt: '', style: 'width:120px;align-self:center;border-radius:8px' }),
    h('h3', { text: p.name }), h('p', { class: 'muted', text: p.isBot ? `${c.description} One of the regulars.` : `${c.description} Played by ${p.username}.` }),
    !p.isBot && !p.mate ? h('button', { class: 'big-btn gold', text: 'Add to my punters', onclick: async () => { const r = await call('mate:request', { key: p.key }); toast(r.message || 'Sent.'); overlay('seat', null); } }) : null,
    h('button', { class: 'big-btn ghost', text: 'Back to the table', onclick: () => overlay('seat', null) }))));
}

// ---------- banter ----------
function addMsg(m, old) {
  const box = $('#banter');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  const multi = (S.st?.room.tables.length || 1) > 1;
  const mine = S.st && m.who?.key === S.st.me.key;
  let el;
  if (m.kind === 'system') el = h('div', { class: 'msg system', text: m.text });
  else {
    const av = m.kind === 'sneaky' ? h('div', { class: 'bell', text: '🔔' })
      : m.kind === 'cheryl' ? h('img', { class: 'av', src: '/assets/img/cheryl-avatar.jpg', alt: '' })
        : h('img', { class: 'av', src: avatar(m.who.characterId), alt: '' });
    const line = h('div', { class: 'ln' });
    el = h('div', { class: `msg ${m.kind}${mine ? ' mine' : ''}` }, av,
      h('div', { style: 'min-width:0' }, h('div', { class: 'nm' }, m.who?.name || 'Cheryl', multi && m.tableNo && m.kind !== 'cheryl' ? h('span', { class: 'tbl', text: `T${m.tableNo}` }) : null), line));
    const opening = m.kind === 'cheryl' && m.text.startsWith('Alright people');
    if (opening && !old && Date.now() - S.joinedAt > 300) {
      typeOut(line, m.text);
      if (m.text.includes('(Mully,')) sfx.cheryl(); // the recorded opening calls out Mully
    } else line.textContent = m.text;
  }
  box.append(el);
  while (box.children.length > 150) box.firstChild.remove();
  if (atBottom || mine || old) box.scrollTop = box.scrollHeight;
}

function typeOut(el, text) {
  // Same pacing as the prototype: the whole message over roughly 20 seconds.
  clearInterval(S.typing);
  let i = 0;
  const box = $('#banter');
  const speed = Math.max(15, Math.floor(20000 / text.length));
  S.typing = setInterval(() => {
    el.textContent = text.slice(0, ++i);
    box.scrollTop = box.scrollHeight;
    if (i >= text.length) clearInterval(S.typing);
  }, speed);
}

$('#composer').onsubmit = (e) => {
  e.preventDefault();
  const v = $('#chat').value.trim();
  if (!v) return;
  call('chat', { text: v });
  $('#chat').value = '';
};

// ---------- sneaky (§10) ----------
$('#sneakyBtn').onclick = () => {
  if (!S.st) return;
  const rc = new RaceCard({
    mode: 'sneaky', onPlace: async (bet) => {
      const r = await call('sneaky', bet);
      if (!r.ok) return rc.error(r.message);
      overlay('sneaky', null);
    },
  });
  S.sneakyCard = rc;
  rc.update({ races: S.st.races, balance: S.st.me.balance });
  overlay('sneaky', h('div', { class: 'overlay backroom' },
    h('div', { class: 'backroom-head pink' }, h('div', {}, h('div', { class: 't', text: 'Sneaky Side Bet' }), h('div', { class: 's', text: 'Your own account. The room hears the bell, nothing else.' })),
      h('button', { class: 'pill ghost small', text: 'Back to the table ›', onclick: () => overlay('sneaky', null) })),
    rc.el));
};

// ---------- cash out (§9) ----------
$('#cashoutBtn').onclick = () => {
  const t = S.st?.table;
  if (!t) return;
  const n = t.seats.filter((s) => s && s.arrived).length || 1;
  const ritual = ['return', 'drumroll', 'reveal'].includes(t.phase);
  overlay('cashout', h('div', { class: 'overlay dim', onclick: (e) => e.target === e.currentTarget && overlay('cashout', null) }, h('div', { class: 'sheet' },
    h('h3', { text: 'Cash Out' }),
    h('p', { text: 'Leave whenever you like. No penalty, the table keeps going.' }),
    h('button', { class: 'big-btn red', text: `Just me · about ${money(Math.floor((t.pool / n) * 100) / 100)}`, onclick: async () => { overlay('cashout', null); const r = await call('cashout'); if (!r.ok) toast(r.message); } }),
    t.phase !== 'gathering' ? h('button', { class: 'big-btn gold', text: 'Call a table vote', disabled: ritual, onclick: async () => { overlay('cashout', null); const r = await call('vote:call'); if (!r.ok) toast(r.message); } }) : null,
    h('button', { class: 'big-btn blue', text: 'Let it ride', onclick: () => overlay('cashout', null) }))));
};

// ---------- effects ----------
function onFx(f) {
  if (f.type === 'arrival') showArrival(f);
  if (f.type === 'wheel') spinWheel(f);
  if (f.type === 'drumroll') sfx.drumroll();
  if (f.type === 'bell') sfx.bell();
  if (f.type === 'selected' && S.st && f.seat === S.st.me.seat) navigator.vibrate?.([80, 60, 80]);
  if (f.type === 'vote') navigator.vibrate?.(60);
}

function showArrival(f) {
  const img = $('#arrival-img');
  const plate = $('#nameplate');
  const c = S.CHAR[f.characterId];
  clearTimeout(S.arrivalTimer);
  img.classList.remove('visible');
  void img.offsetWidth;
  img.src = arrivalImg(f.characterId);
  img.classList.add('visible');
  plate.textContent = f.name;
  plate.classList.add('show');
  if (c?.voice_file) sfx.voice(c.voice_file);
  S.arrivalTimer = setTimeout(() => { img.classList.remove('visible'); plate.classList.remove('show'); }, Math.max(1500, f.until - now() - 300));
}

function spinWheel(f) {
  const order = f.seats;
  if (!order.length) return;
  sfx.drumroll();
  const D = f.duration - 700;
  const delays = [];
  for (let tt = 0; tt < D;) { const p = tt / D; const d = p < 0.5 ? 80 : p < 0.7 ? 140 : p < 0.85 ? 260 : 420; delays.push(d); tt += d; }
  const N = delays.length;
  const target = order.indexOf(f.target);
  let idx = ((target - N) % order.length + order.length * 4) % order.length;
  let k = 0;
  const step = () => {
    document.querySelectorAll('.seat.spin').forEach((s) => s.classList.remove('spin'));
    const el = document.querySelector(`.seat[data-seat="${order[idx % order.length]}"]`);
    el?.classList.add('spin');
    if (k >= N) { setTimeout(() => el?.classList.remove('spin'), 1200); return; }
    idx++;
    setTimeout(step, delays[k++]);
  };
  step();
}

// ---------- overlays + toasts ----------
function overlay(name, el) {
  S.overlays[name]?.remove();
  delete S.overlays[name];
  if (el) { S.overlays[name] = el; $('#overlays').append(el); }
}

function toast(text, { kind, action, ms = 4200 } = {}) {
  const box = $('#toasts');
  const el = h('div', { class: `toast${kind === 'sneaky' ? ' pink' : ''}` }, h('div', { class: 'grow', text }),
    action ? h('button', { class: 'pill small', text: action.label, onclick: () => { el.remove(); action.fn(); } }) : null);
  box.append(el);
  setTimeout(() => el.remove(), action ? ms * 2 : ms);
}

// ---------- clock ----------
setInterval(() => {
  document.querySelectorAll('[data-until]').forEach((el) => {
    const ms = Number(el.dataset.until) - now();
    el.textContent = el.dataset.fmt === 's' ? String(Math.max(0, Math.ceil(ms / 1000))) : mmss(ms);
  });
  S.racecard?.tick(now());
  S.sneakyCard?.tick(now());
  const t = S.st?.table;
  const callEl = document.getElementById('race-call');
  if (callEl && t?.race?.call) {
    clear(callEl);
    t.race.call.forEach((no, i) => {
      const r = t.race.runners.find((x) => x.no === no);
      callEl.append(h('div', { class: no === t.bet?.runnerNo ? 'us' : '', text: `${i + 1}. #${no} ${r?.name || ''}` }));
    });
  }
  if (t) {
    const race = t.race || S.st.races?.[0];
    $('#tv-title').textContent = race ? race.title.toUpperCase() : 'RACING';
    $('#tv-jump').textContent = race ? (race.status === 'running' ? 'LIVE' : race.status === 'final' ? 'RESULT' : `JUMPS ${mmss(race.jumpAt - now())}`) : '';
  }
}, 250);

window.__punt = S;
export { S };
