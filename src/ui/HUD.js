import { DISTRICT_INFO } from '../config.js';

const $ = (id) => document.getElementById(id);

/** Unobtrusive in-game HUD: money/clock, objective, speedometer, prompts, toasts, banners. */
export class HUD {
  constructor(game) {
    this.game = game;
    this.el = $('hud');
    this.money = $('hud-money');
    this.clock = $('hud-clock');
    this.weather = $('hud-weather');
    this.district = $('hud-district');
    this.prompt = $('hud-prompt');
    this.promptText = $('hud-prompt-text');
    this.hint = $('hud-hint');
    this.toasts = $('hud-toasts');
    this.bannerEl = $('hud-banner');
    this.objective = $('hud-objective');
    this.speedo = $('hud-speedo');
    this.speedVal = $('speed-value');
    this.speedUnit = $('speed-unit');
    this.speedArc = $('speed-arc');
    this.vehName = $('veh-name');
    this.vehGear = $('veh-gear');
    this.fuelBar = $('fuel-bar');
    this.fuelWrap = $('fuel-wrap');
    this.stamina = $('hud-stamina');
    this.staminaBar = $('stamina-bar');
    this.health = $('hud-health');
    this.healthBar = $('health-bar');
    this.fps = $('hud-fps');
    this.arcLen = this.speedArc ? this.speedArc.getTotalLength() : 0;
    if (this.speedArc) this.speedArc.style.strokeDasharray = `${this.arcLen}`;
    this._lastPrompt = undefined;
    this._lastHint = '';
    this._lastDistrict = '';
    this.game.state.onChange(() => this.updateMoney(true));
    this.updateMoney();
  }

  show(on) {
    this.el.classList.toggle('hidden', !on);
  }

  updateMoney(flash = false) {
    this.money.textContent = `$${this.game.state.money.toLocaleString()}`;
    if (flash) {
      this.money.classList.remove('flash');
      void this.money.offsetWidth;
      this.money.classList.add('flash');
    }
  }

  setPrompt(text) {
    if (text === this._lastPrompt) return;
    this._lastPrompt = text;
    if (!text) { this.prompt.classList.add('hidden'); return; }
    this.promptText.textContent = text;
    this.prompt.classList.remove('hidden');
  }

  toast(text, ms = 2200) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 400);
  }

  banner(title, sub = '', kind = 'info') {
    const b = this.bannerEl;
    b.className = `banner ${kind}`;
    b.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'banner-title';
    h.textContent = title;
    const s = document.createElement('div');
    s.className = 'banner-sub';
    s.textContent = sub;
    b.append(h, s);
    b.classList.add('show');
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => b.classList.remove('show'), kind === 'discover' ? 6000 : 4200);
  }

  setObjective(title, detail = '', timer = '') {
    if (!title) { this.objective.classList.add('hidden'); return; }
    this.objective.classList.remove('hidden');
    this.objective.querySelector('.obj-title').textContent = title;
    this.objective.querySelector('.obj-detail').textContent = detail;
    this.objective.querySelector('.obj-timer').textContent = timer;
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    const v = p.vehicle;
    this.clock.textContent = g.sceneManager.clockString;
    const w = g.sceneManager.weatherName;
    this.weather.textContent = w === 'Cloudy' ? '☁' : '☀';
    this.weather.title = w;
    // district name
    const key = p.interior ? null : g.layout.districtAt(v ? v.x : p.pos.x, v ? v.z : p.pos.z);
    const dName = p.interior ? p.interior.name : key === 'HWY' ? 'Ring Highway' : DISTRICT_INFO[key]?.name || '';
    if (dName !== this._lastDistrict) { this._lastDistrict = dName; this.district.textContent = dName; }

    // speedometer
    if (v) {
      this.speedo.classList.remove('hidden');
      const mph = g.settings.units === 'mph';
      const val = Math.abs(v.speed) * (mph ? 2.237 : 3.6);
      const max = v.spec.maxSpeed * (mph ? 2.237 : 3.6) * 1.1;
      this.speedVal.textContent = Math.round(val);
      this.speedUnit.textContent = mph ? 'mph' : 'km/h';
      this.speedArc.style.strokeDashoffset = `${this.arcLen * (1 - Math.min(1, val / max))}`;
      this.vehName.textContent = v.spec.name;
      if (v.kind === 'bicycle') this.vehGear.textContent = `Gear ${v.gear}/3`;
      else this.vehGear.textContent = v.speed < -0.3 ? 'R' : `${v.autoGear || 1}${v.lightsOn ? ' · ◐' : ''}`;
      this.fuelWrap.classList.toggle('hidden', v.kind === 'bicycle');
      if (v.kind !== 'bicycle') {
        this.fuelBar.style.width = `${v.fuel}%`;
        this.fuelBar.classList.toggle('low', v.fuel < 20);
      }
    } else this.speedo.classList.add('hidden');

    // health (only while hurt)
    const hurt = !v && p.health < 99.5;
    this.health.classList.toggle('hidden', !hurt);
    if (hurt) this.healthBar.style.width = `${p.health}%`;
    // stamina
    const showSt = !v && (p.stamina < 99 || p.boostTime > 0);
    this.stamina.classList.toggle('hidden', !showSt);
    if (showSt) {
      this.staminaBar.style.width = `${p.boostTime > 0 ? 100 : p.stamina}%`;
      this.staminaBar.classList.toggle('boost', p.boostTime > 0);
    }

    // contextual controls
    const mode = g.playerController.mode;
    const touch = g.input.touch.active;
    let hint = '';
    if (!touch) {
      if (mode === 'foot') hint = 'WASD move · Shift sprint · Click punch · E get in any car / bike · Space jump · V garage · C camera · M map · Esc menu';
      else if (mode === 'sit') hint = 'E / move to stand up · C camera';
      else if (mode === 'car') hint = 'W accelerate · S brake/reverse · A/D steer · Space handbrake · H horn · L lights · R reset · E exit';
      else if (mode === 'motorcycle') hint = 'W throttle · S brake · A/D lean · Space rear brake · H horn · L light · R reset · E get off';
      else if (mode === 'bicycle') hint = 'W pedal · Shift pedal hard · 1/2/3 gears · S brake · A/D steer · H bell · E get off';
    }
    if (hint !== this._lastHint) { this._lastHint = hint; this.hint.textContent = hint; }

    if (g.settings.showFps) {
      this.fps.classList.remove('hidden');
      this.fps.textContent = `${Math.round(g.perf.fps)} fps · ${g.renderer.info.render.calls} draws · NPC ${g.npcManager.active} · cars ${g.traffic.active}`;
    } else this.fps.classList.add('hidden');
    void dt;
  }
}
