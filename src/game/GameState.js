import { SAVE_KEY, START_MONEY } from '../config.js';
import { STARTER_VEHICLES } from '../vehicles/VehicleTypes.js';

/** Persistent progress: money, owned vehicles, tokens, landmarks, best times, position. */
export class GameState {
  constructor() {
    this.reset();
  }

  reset() {
    this.money = START_MONEY;
    this.owned = [...STARTER_VEHICLES];
    this.collected = [];
    this.discovered = [];
    this.bestTimes = {};
    this.completed = {};
    this.talked = [];
    this.flags = { mapRevealed: false };
    this.inventory = {};
    this.player = null;   // { x, z, yaw }
    this.timeOfDay = 9;
    this.playSeconds = 0;
    this.listeners = new Set();
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  _changed() {
    for (const fn of this.listeners) fn(this);
  }

  earn(n) {
    this.money += n;
    this._changed();
  }

  spend(n) {
    if (this.money < n) return false;
    this.money -= n;
    this._changed();
    return true;
  }

  toJSON() {
    return {
      v: 1, money: this.money, owned: this.owned, collected: this.collected, discovered: this.discovered,
      bestTimes: this.bestTimes, completed: this.completed, talked: this.talked, flags: this.flags,
      inventory: this.inventory, player: this.player, timeOfDay: this.timeOfDay, playSeconds: this.playSeconds,
    };
  }

  static hasSave() {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch {
      return false;
    }
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.toJSON()));
      return true;
    } catch (err) {
      console.warn('[Save] Could not write save game', err);
      return false;
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d || d.v !== 1) return false;
      this.money = Number.isFinite(d.money) ? d.money : START_MONEY;
      this.owned = Array.isArray(d.owned) && d.owned.length ? d.owned : [...STARTER_VEHICLES];
      this.collected = Array.isArray(d.collected) ? d.collected : [];
      this.discovered = Array.isArray(d.discovered) ? d.discovered : [];
      this.bestTimes = d.bestTimes || {};
      this.completed = d.completed || {};
      this.talked = d.talked || [];
      this.flags = { mapRevealed: false, ...(d.flags || {}) };
      this.inventory = d.inventory || {};
      this.player = d.player || null;
      this.timeOfDay = Number.isFinite(d.timeOfDay) ? d.timeOfDay : 9;
      this.playSeconds = d.playSeconds || 0;
      return true;
    } catch (err) {
      console.warn('[Save] Save game unreadable, starting fresh', err);
      return false;
    }
  }

  static clear() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* storage unavailable */ }
  }
}
