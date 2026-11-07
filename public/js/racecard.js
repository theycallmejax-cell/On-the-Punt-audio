import { h, clear, mmss, money } from './ui.js';

const TYPES = [['win', 'Win'], ['place', 'Place'], ['eachway', 'Each Way']];

// A race card for picking a bet. Used for the group bet out the back and for sneaky side bets.
export class RaceCard {
  constructor({ mode, onPlace }) {
    this.mode = mode;
    this.onPlace = onPlace;
    this.sel = { raceId: null, runnerNo: null, type: 'win', amount: '' };
    this.open = null;
    this.races = [];
    this.ids = '';
    this.list = h('div', { class: 'backroom-body scroll-quiet' });
    this.pick = h('div', { class: 'pick' });
    this.errEl = h('div', { class: 'err' });
    this.amount = h('input', { class: 'field', type: 'number', inputmode: 'numeric', min: 1, placeholder: '$', oninput: () => { this.sel.amount = this.amount.value; this.renderPick(); } });
    this.quick = h('div', { style: 'display:flex;gap:6px' });
    this.seg = h('div', { class: `seg${mode === 'sneaky' ? ' pink' : ''}` }, ...TYPES.map(([k, label]) => h('button', { type: 'button', 'data-k': k, class: k === 'win' ? 'sel' : '', text: label, onclick: () => this.setType(k) })));
    this.btn = h('button', { class: mode === 'sneaky' ? 'big-btn' : 'big-btn gold', style: mode === 'sneaky' ? 'background:linear-gradient(160deg,#f7b8c8,#e8789a);color:#1a0e00' : '', text: mode === 'sneaky' ? 'Place Sneaky 🔔' : 'Place the group bet ›', onclick: () => this.place() });
    this.el = h('div', { style: 'flex:1;display:flex;flex-direction:column;min-height:0' }, this.list,
      h('div', { class: 'betbar' }, this.pick, this.seg, h('div', { class: 'amount-row' }, this.amount, this.quick), this.errEl, this.btn));
  }

  update({ races = [], maxBet, balance }) {
    this.maxBet = maxBet;
    this.balance = balance;
    this.races = races;
    const ids = races.map((r) => r.id).join();
    if (ids !== this.ids) {
      this.ids = ids;
      if (this.sel.raceId && !races.some((r) => r.id === this.sel.raceId)) {
        this.sel.raceId = null; this.sel.runnerNo = null;
        this.error('That race has jumped. Pick another.');
      }
      if (!this.open || !races.some((r) => r.id === this.open)) this.open = races[0]?.id || null;
      this.renderList();
    }
    const quick = this.mode === 'group' ? [...new Set([Math.max(1, Math.floor(maxBet / 2)), maxBet])].filter((x) => x > 0) : [5, 10, 20, 50];
    clear(this.quick);
    for (const q of quick) this.quick.append(h('button', { type: 'button', class: 'quick', text: q === maxBet && this.mode === 'group' ? `Max $${q}` : `$${q}`, onclick: () => { this.amount.value = q; this.sel.amount = String(q); this.renderPick(); } }));
    this.amount.placeholder = this.mode === 'group' ? `$1 – $${maxBet}` : `Your account ${money(balance, 0)}`;
    this.renderPick();
  }

  renderList() {
    clear(this.list);
    if (!this.races.length) {
      this.list.append(h('div', { class: 'empty-note', text: this.mode === 'group' ? 'Nothing jumping in the next 10 minutes yet. Hang tight, the card refreshes.' : 'Nothing open right now.' }));
      return;
    }
    if (this.mode === 'group') this.list.append(h('div', { class: 'empty-note', style: 'margin-bottom:8px', text: 'Only races jumping within 10 minutes. Pick one, pick a runner, back to the table.' }));
    for (const r of this.races) {
      const open = this.open === r.id;
      const box = h('div', { class: 'race' },
        h('button', { class: 'race-head', onclick: () => { this.open = open ? null : r.id; this.renderList(); } },
          h('div', {}, h('div', { class: 'rt', text: r.title }), h('div', { class: 'rd', text: `${r.distance} · ${r.kind === 'dogs' ? 'Greyhounds' : 'Gallops'} · ${r.runners.length} runners · places pay ${r.placesPaid}` })),
          h('div', { class: 'jt', 'data-jump': r.jumpAt, text: '' })));
      if (open) {
        for (const x of r.runners) {
          const sel = this.sel.raceId === r.id && this.sel.runnerNo === x.no;
          const bg = x.silks ? `linear-gradient(135deg,${x.silks[0]} 50%,${x.silks[1]} 50%)` : ['#e53935', '#1e88e5', '#f5f5f5', '#212121', '#fb8c00', '#000', '#43a047', '#fdd835'][(x.no - 1) % 8];
          box.append(h('button', { class: `runner${sel ? ' sel' : ''}`, onclick: () => { this.sel.raceId = r.id; this.sel.runnerNo = x.no; this.error(''); this.renderList(); this.renderPick(); } },
            h('span', { class: 'no', style: `background:${bg}`, text: x.no }), h('span', { class: 'rn', text: x.name }),
            h('span', { class: 'pl', text: `P ${x.place.toFixed(2)}` }), h('span', { class: 'od', text: x.odds.toFixed(2) })));
        }
      }
      this.list.append(box);
    }
    this.tick(Date.now());
  }

  setType(k) {
    this.sel.type = k;
    this.seg.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.k === k));
    this.renderPick();
  }

  renderPick() {
    const r = this.races.find((x) => x.id === this.sel.raceId);
    const run = r?.runners.find((x) => x.no === this.sel.runnerNo);
    clear(this.pick);
    if (!run) { this.pick.textContent = 'Pick a runner.'; this.btn.disabled = true; return; }
    const amt = Math.floor(Number(this.sel.amount) || 0);
    const ret = this.sel.type === 'win' ? amt * run.odds : this.sel.type === 'place' ? amt * run.place : (amt / 2) * run.odds + (amt / 2) * run.place;
    this.pick.append(h('b', { text: `#${run.no} ${run.name}` }), ` · ${r.title}`, amt ? ` · could return ${money(ret)}` : '');
    if (this.sel.type === 'eachway') this.pick.append(h('div', { class: 'row-sub', text: 'Each way splits the stake: half win, half place.' }));
    this.btn.disabled = !amt;
  }

  error(msg) { this.errEl.textContent = msg || ''; }

  async place() {
    const amount = Math.floor(Number(this.sel.amount) || 0);
    if (this.mode === 'group' && amount > this.maxBet) return this.error(`Max group bet here is $${this.maxBet}.`);
    if (this.mode === 'sneaky' && amount > this.balance) return this.error('Not enough in your account.');
    this.btn.disabled = true;
    await this.onPlace({ raceId: this.sel.raceId, runnerNo: this.sel.runnerNo, type: this.sel.type, amount });
    this.btn.disabled = false;
  }

  tick(now) {
    this.list.querySelectorAll('[data-jump]').forEach((el) => { el.textContent = mmss(Number(el.dataset.jump) - now); });
  }
}
