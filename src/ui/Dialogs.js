import { CREDITS } from './Credits.js';
import { VEHICLES } from '../vehicles/VehicleTypes.js';
import { buildSettingsPanel } from './Settings.js';
import { formatTime } from '../game/MissionSystem.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Modal windows: shop, dealership, garage / vehicle selection, mission card, journal, settings, controls. */
export class Dialogs {
  constructor(game) {
    this.game = game;
    this.modal = $('modal');
    this.body = $('modal-body');
    this.title = $('modal-title');
    this.onClose = null;
    $('modal-close').onclick = () => this.close();
    this.modal.addEventListener('mousedown', (e) => { if (e.target === this.modal) this.close(); });
    this.dialogEl = $('hud-dialog');
    this.dialogEl.addEventListener('click', () => this.dialogEl.classList.add('hidden'));
  }

  get open() {
    return !this.modal.classList.contains('hidden');
  }

  _open(title, wide = true) {
    this.title.textContent = title;
    this.body.innerHTML = '';
    $('modal-panel').classList.toggle('narrow', !wide);
    this.modal.classList.remove('hidden');
    this.game.onModalOpen();
    return this.body;
  }

  close() {
    if (!this.open) return;
    this.modal.classList.add('hidden');
    const cb = this.onClose;
    this.onClose = null;
    if (cb) cb();
    this.game.onModalClose();
  }

  dialog(speaker, text, ms = 6000) {
    const d = this.dialogEl;
    d.querySelector('.speaker').textContent = speaker;
    d.querySelector('.line').textContent = text;
    d.classList.remove('hidden');
    clearTimeout(this._dt);
    this._dt = setTimeout(() => d.classList.add('hidden'), ms);
  }

  confirm(title, text, okLabel, onOk) {
    const b = this._open(title, false);
    b.appendChild(el('p', 'muted', text));
    const row = el('div', 'row-buttons');
    const ok = el('button', 'btn primary inline', okLabel);
    const cancel = el('button', 'btn inline', 'Cancel');
    ok.onclick = () => { this.close(); onOk(); };
    cancel.onclick = () => this.close();
    row.append(ok, cancel);
    b.appendChild(row);
  }

  settings() {
    const b = this._open('Settings');
    const wrap = el('div');
    b.appendChild(wrap);
    buildSettingsPanel(wrap, this.game.settings, (key) => this.game.applySettings(key));
  }

  credits() {
    const b = this._open('Credits');
    b.appendChild(el('p', 'muted small', 'Realistic models and textures by these artists. Thank you!'));
    const t = el('table', 'controls-table');
    for (const [what, who, lic] of CREDITS) {
      const tr = el('tr');
      tr.appendChild(el('td', '', what));
      tr.appendChild(el('td', '', `${who} — ${lic}`));
      t.appendChild(tr);
    }
    b.appendChild(t);
  }

  controls() {
    const b = this._open('Controls');
    const rows = [
      ['On foot', ''], ['Move', 'W A S D / Arrow keys'], ['Sprint', 'Shift'], ['Jump', 'Space'], ['Interact / enter vehicle', 'E'],
      ['Look around', 'Mouse (click to lock) · drag'], ['Zoom camera', 'Mouse wheel / + −'], ['Change camera', 'C'],
      ['Vehicles', ''], ['Accelerate / brake & reverse', 'W / S'], ['Steer', 'A / D'], ['Handbrake (drift)', 'Space'],
      ['Exit vehicle', 'E'], ['Headlights', 'L'], ['Horn / bell', 'H'], ['Reset stuck vehicle', 'R'], ['Bicycle gears', '1 2 3'],
      ['Use fuel can', 'F'], ['General', ''], ['Garage (call a vehicle)', 'V'], ['City map', 'M'], ['Journal', 'J'], ['Pause / menu', 'Esc / P'],
    ];
    const t = el('table', 'controls-table');
    for (const [a, k] of rows) {
      const tr = el('tr');
      if (!k) { const td = el('td'); td.colSpan = 2; td.appendChild(el('h3', '', a)); tr.appendChild(td); t.appendChild(tr); continue; }
      tr.appendChild(el('td', '', a));
      const td = el('td');
      k.split(' / ').forEach((part, i) => {
        if (i) td.append(' / ');
        const kb = el('kbd', '', part);
        td.appendChild(kb);
      });
      tr.appendChild(td);
      t.appendChild(tr);
    }
    b.appendChild(t);
    b.appendChild(el('p', 'muted small', 'Touch screens: left thumb moves / steers, drag on the right to look, buttons for interact, jump/handbrake, sprint, camera and map.'));
  }

  shop(title, items, onBuy) {
    const b = this._open(title, false);
    const money = el('div', 'money-line');
    const refresh = () => (money.textContent = `Wallet: $${this.game.state.money}`);
    refresh();
    b.appendChild(money);
    for (const it of items) {
      const row = el('div', 'shop-item');
      const info = el('div', 'info');
      info.append(el('div', 'name', it.name), el('div', 'desc', it.desc));
      const btn = el('button', 'btn inline', `$${it.price}`);
      btn.onclick = () => { if (onBuy(it)) refresh(); };
      row.append(info, btn);
      b.appendChild(row);
    }
  }

  _statBars(spec) {
    const wrap = el('div');
    const stats = [['Speed', spec.maxSpeed / 64], ['Accel', spec.accel / 15], ['Handling', spec.steer / 0.8]];
    for (const [n, v] of stats) {
      const s = el('div', 'stat');
      s.append(el('span', '', n.padEnd(8, ' ')));
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.width = `${Math.round(Math.min(1, v) * 100)}%`;
      bar.appendChild(fill);
      s.appendChild(bar);
      wrap.appendChild(s);
    }
    return wrap;
  }

  dealership() {
    const g = this.game;
    const b = this._open('Motor Row Dealership');
    const money = el('div', 'money-line', `Wallet: $${g.state.money}`);
    b.appendChild(money);
    const cards = el('div', 'cards');
    for (const [type, spec] of Object.entries(VEHICLES)) {
      if (spec.dealer === false) continue;
      const owned = g.state.owned.includes(type);
      const c = el('div', 'card');
      const sw = el('div', 'swatch'); sw.style.background = spec.color;
      c.append(sw, el('div', 'name', spec.name), el('div', 'meta', `${spec.kind[0].toUpperCase()}${spec.kind.slice(1)} · top ${Math.round(spec.maxSpeed * 3.6)} km/h`), el('div', 'desc', spec.desc), this._statBars(spec));
      const btn = el('button', `btn inline ${owned ? '' : 'primary'}`, owned ? 'Owned' : `Buy $${spec.price}`);
      btn.disabled = owned;
      btn.onclick = () => {
        if (!g.state.spend(spec.price)) { g.hud.toast('Not enough money — try missions and tokens', 2000); g.audio.error(); return; }
        g.state.owned.push(type);
        g.audio.cash();
        g.save();
        btn.textContent = 'Owned'; btn.disabled = true; btn.classList.remove('primary');
        money.textContent = `Wallet: $${g.state.money}`;
        g.hud.toast(`${spec.name} purchased! It's parked outside.`, 2600);
        const site = g.ctx.sites.dealer;
        const spot = site && g.vehicles.findSpawnSpot(site.deliverX, site.deliverZ, spec);
        if (spot) g.vehicles.spawn(type, spot.x, spot.z, spot.heading);
      };
      c.appendChild(btn);
      cards.appendChild(c);
    }
    b.appendChild(cards);
  }

  /** Pick an owned vehicle and have it delivered to the nearest road. */
  garage() {
    const g = this.game;
    const b = this._open('Garage');
    b.appendChild(el('p', 'muted', 'Pick a vehicle and it will be delivered to the nearest road.'));
    const cards = el('div', 'cards');
    for (const type of g.state.owned.length ? g.state.owned : Object.keys(VEHICLES)) {
      const spec = VEHICLES[type];
      if (!spec) continue;
      const c = el('div', 'card');
      const sw = el('div', 'swatch'); sw.style.background = spec.color;
      c.append(sw, el('div', 'name', spec.name), el('div', 'meta', spec.kind), el('div', 'desc', spec.desc), this._statBars(spec));
      const btn = el('button', 'btn inline', 'Deliver');
      btn.onclick = () => {
        this.close();
        g.resume();
        g.vehicles.deliver(type);
      };
      c.appendChild(btn);
      cards.appendChild(c);
    }
    b.appendChild(cards);
  }

  missionCard(def, onStart) {
    const g = this.game;
    const b = this._open(def.name, false);
    b.appendChild(el('p', '', def.desc));
    const meta = el('div', 'mission-meta');
    const req = { car: 'Car', motorcycle: 'Motorcycle', bicycle: 'Bicycle', any: 'Any vehicle', none: 'On foot' }[def.vehicle];
    const best = g.state.bestTimes[def.id];
    meta.innerHTML = '';
    for (const [k, v] of [['Reward', `$${def.reward}${def.par ? ` (+$100 under ${formatTime(def.par)})` : ''}`], ['Needs', req], ['Time limit', def.limit ? formatTime(def.limit) : '—'], ['Best', best ? formatTime(best) : '—']]) {
      const s = el('span');
      s.append(el('b', '', `${k}: `), document.createTextNode(v));
      meta.appendChild(s);
    }
    b.appendChild(meta);
    const row = el('div', 'row-buttons');
    const go = el('button', 'btn primary inline', 'Start');
    go.onclick = () => { this.close(); onStart(); };
    const later = el('button', 'btn inline', 'Not now');
    later.onclick = () => this.close();
    row.append(go, later);
    b.appendChild(row);
  }

  journal() {
    const g = this.game;
    const b = this._open('Journal');
    b.appendChild(el('h3', '', 'Missions'));
    for (const d of g.missions.defs) {
      const row = el('div', 'journal-item');
      const done = g.state.completed[d.id];
      const state = el('span', `state ${done ? 'done' : ''}`, done ? `Done ×${done}` : 'Open');
      const info = el('div');
      const best = g.state.bestTimes[d.id];
      info.append(el('div', 'name', d.name), el('div', 'muted small', `${d.desc}${best ? ` Best: ${formatTime(best)}.` : ''}`));
      row.append(state, info);
      if (d.start && !g.missions.active) {
        const btn = el('button', 'btn inline', 'Route');
        btn.onclick = () => { g.setWaypoint(d.start); this.close(); g.resume(); g.hud.toast(`GPS set to ${d.name}`, 1800); };
        row.appendChild(btn);
      }
      b.appendChild(row);
    }
    if (g.missions.defs.find((d) => d.id === 'hello') && !g.state.completed.hello) {
      b.appendChild(el('p', 'muted small', `Locals met: ${g.missions.talked.size}/3`));
    }
    b.appendChild(el('h3', '', `Tokens · ${g.state.collected.length}/${g.missions.tokens.length}`));
    b.appendChild(el('p', 'muted small', g.state.flags.mapRevealed ? 'Remaining tokens are marked on your map.' : 'Buy the City Explorer Map at FreshMart to reveal them on the map.'));
    b.appendChild(el('h3', '', `Landmarks · ${g.state.discovered.length}/${g.landmarks.landmarks.length}`));
    const chips = el('div', 'chips');
    for (const l of g.landmarks.landmarks) {
      const on = g.state.discovered.includes(l.id);
      chips.appendChild(el('span', `chip ${on ? 'on' : ''}`, on ? l.name : '???'));
    }
    b.appendChild(chips);
    b.appendChild(el('h3', '', 'Stats'));
    b.appendChild(el('p', 'muted small', `Play time ${Math.floor(g.state.playSeconds / 60)} min · Vehicles owned ${g.state.owned.length} · Wallet $${g.state.money}`));
  }
}
