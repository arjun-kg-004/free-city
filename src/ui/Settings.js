import { QUALITY, SETTINGS_KEY } from '../config.js';

const DEFAULTS = {
  quality: 'medium',
  shadows: true,
  bloom: true,
  drawDistance: 0,        // 0 = use the quality preset
  masterVolume: 0.8,
  sfxVolume: 0.9,
  ambientVolume: 0.7,
  muted: false,
  mouseSensitivity: 1,
  invertY: false,
  trafficSide: 'left',    // left (India / UK) or right
  npcDensity: 1,          // multiplier on preset
  trafficDensity: 1,
  weather: 'clear',
  showFps: false,
  units: 'kmh',
  lockMouse: true,
};

/** Settings model (persisted) + the settings panel UI. */
export class Settings {
  constructor() {
    Object.assign(this, DEFAULTS);
    this.load();
    if (!this._loaded) this.quality = guessQuality();
  }

  get qualityPreset() {
    return QUALITY[this.quality] || QUALITY.medium;
  }

  get drawDistanceValue() {
    return this.drawDistance || this.qualityPreset.drawDistance;
  }

  get npcCount() {
    return Math.round(this.qualityPreset.npcs * this.npcDensity);
  }

  get trafficCount() {
    return Math.round(this.qualityPreset.traffic * this.trafficDensity);
  }

  load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) { Object.assign(this, DEFAULTS, JSON.parse(raw)); this._loaded = true; }
    } catch { /* storage blocked: keep defaults */ }
  }

  save() {
    const out = {};
    for (const k of Object.keys(DEFAULTS)) out[k] = this[k];
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(out)); } catch { /* ignore */ }
  }
}

function guessQuality() {
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
  if (mobile) return 'low';
  // High (GTAO, 1.5x resolution, 4k shadows) is opt-in; slow machines step down further at runtime
  return 'medium';
}

/** Builds the settings form inside `container`; calls onChange(key) after each change. */
export function buildSettingsPanel(container, settings, onChange) {
  const rows = [
    { section: 'Graphics' },
    { key: 'quality', label: 'Quality preset', type: 'select', options: [['low', 'Low (fast)'], ['medium', 'Medium'], ['high', 'High (pretty)']] },
    { key: 'shadows', label: 'Shadows', type: 'toggle' },
    { key: 'bloom', label: 'Post effects (AO, grading, glow)', type: 'toggle' },
    { key: 'drawDistance', label: 'View distance', type: 'range', min: 0, max: 800, step: 20, fmt: (v) => (v ? `${v} m` : 'Auto') },
    { key: 'showFps', label: 'Show FPS', type: 'toggle' },
    { section: 'Audio' },
    { key: 'masterVolume', label: 'Master volume', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
    { key: 'sfxVolume', label: 'Effects', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
    { key: 'ambientVolume', label: 'City ambience', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
    { key: 'muted', label: 'Mute all', type: 'toggle' },
    { section: 'Controls' },
    { key: 'mouseSensitivity', label: 'Mouse sensitivity', type: 'range', min: 0.3, max: 2.5, step: 0.1, fmt: (v) => `${v.toFixed(1)}×` },
    { key: 'invertY', label: 'Invert camera Y', type: 'toggle' },
    { key: 'lockMouse', label: 'Lock mouse on click', type: 'toggle' },
    { key: 'units', label: 'Speed units', type: 'select', options: [['kmh', 'km/h'], ['mph', 'mph']] },
    { section: 'World' },
    { key: 'trafficSide', label: 'Drive on the', type: 'select', options: [['left', 'Left (India / UK)'], ['right', 'Right (US / EU)']] },
    { key: 'npcDensity', label: 'Pedestrians', type: 'range', min: 0, max: 1.5, step: 0.1, fmt: pct },
    { key: 'trafficDensity', label: 'Traffic', type: 'range', min: 0, max: 1.5, step: 0.1, fmt: pct },
    { key: 'weather', label: 'Weather', type: 'select', options: [['clear', 'Clear'], ['cloudy', 'Cloudy']] },
  ];
  container.innerHTML = '';
  for (const r of rows) {
    if (r.section) {
      const h = document.createElement('h3');
      h.textContent = r.section;
      container.appendChild(h);
      continue;
    }
    const row = document.createElement('label');
    row.className = 'set-row';
    const name = document.createElement('span');
    name.textContent = r.label;
    row.appendChild(name);
    let input;
    if (r.type === 'toggle') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!settings[r.key];
      input.addEventListener('change', () => { settings[r.key] = input.checked; settings.save(); onChange(r.key); });
    } else if (r.type === 'select') {
      input = document.createElement('select');
      for (const [v, t] of r.options) {
        const o = document.createElement('option');
        o.value = String(v); o.textContent = t;
        if (String(settings[r.key]) === String(v)) o.selected = true;
        input.appendChild(o);
      }
      input.addEventListener('change', () => {
        const raw = input.value;
        settings[r.key] = typeof DEFAULTS[r.key] === 'number' ? Number(raw) : raw;
        settings.save(); onChange(r.key);
      });
    } else {
      const wrap = document.createElement('span');
      wrap.className = 'range-wrap';
      input = document.createElement('input');
      input.type = 'range'; input.min = r.min; input.max = r.max; input.step = r.step;
      input.value = settings[r.key];
      const val = document.createElement('em');
      val.textContent = r.fmt(Number(settings[r.key]));
      input.addEventListener('input', () => {
        settings[r.key] = Number(input.value);
        val.textContent = r.fmt(settings[r.key]);
        settings.save(); onChange(r.key);
      });
      wrap.append(input, val);
      row.appendChild(wrap);
      container.appendChild(row);
      continue;
    }
    row.appendChild(input);
    container.appendChild(row);
  }
}

function pct(v) {
  return `${Math.round(v * 100)}%`;
}
