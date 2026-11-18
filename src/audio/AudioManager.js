/**
 * Fully procedural Web Audio: engines, tyres, wind, ocean, city hum, birds, rain,
 * footsteps and UI sounds. No audio files are required (licence-free).
 */
export class AudioManager {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.ready = false;
    this.listener = { x: 0, z: 0 };
  }

  /** Must be called from a user gesture (Start button). */
  init() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch (err) {
      console.warn('[Audio] Web Audio unavailable', err);
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.amb = c.createGain(); this.amb.connect(this.master);
    this.engineBus = c.createGain(); this.engineBus.connect(this.sfx);
    this.noise = this._noiseBuffer(2);
    this.brown = this._brownBuffer(4);
    this._buildEngine();
    this._buildAmbience();
    this.applyVolumes();
    this.ready = true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.masterVolume, t, 0.05);
    this.sfx.gain.setTargetAtTime(s.sfxVolume, t, 0.05);
    this.amb.gain.setTargetAtTime(s.ambientVolume, t, 0.05);
  }

  suspend() { this.ctx && this.ctx.state === 'running' && this.ctx.suspend(); }
  resume() { this.ctx && this.ctx.state === 'suspended' && this.ctx.resume(); }

  _noiseBuffer(sec) {
    const c = this.ctx;
    const b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  _brownBuffer(sec) {
    const c = this.ctx;
    const b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    return b;
  }

  _loopNoise(buffer, filterType, freq, q, dest) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = Math.random();
    const f = c.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(0, Math.random());
    return { src, f, g };
  }

  _buildEngine() {
    const c = this.ctx;
    this.eng = {};
    const o1 = c.createOscillator(); o1.type = 'sawtooth';
    const o2 = c.createOscillator(); o2.type = 'square';
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 3;
    const g = c.createGain(); g.gain.value = 0;
    // amplitude "putter" for motorbikes
    const am = c.createGain(); am.gain.value = 1;
    const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 20;
    const lfoDepth = c.createGain(); lfoDepth.gain.value = 0;
    lfo.connect(lfoDepth); lfoDepth.connect(am.gain);
    o1.connect(lp); o2.connect(lp); lp.connect(am); am.connect(g); g.connect(this.engineBus);
    o1.start(); o2.start(); lfo.start();
    Object.assign(this.eng, { o1, o2, lp, g, lfo, lfoDepth });
    this.tyre = this._loopNoise(this.noise, 'bandpass', 1400, 6, this.sfx);
    this.brakeHiss = this._loopNoise(this.noise, 'bandpass', 3200, 2, this.sfx);
    this.wind = this._loopNoise(this.noise, 'bandpass', 500, 0.8, this.sfx);
    this.freewheelTimer = 0;
  }

  _buildAmbience() {
    this.city = this._loopNoise(this.brown, 'lowpass', 380, 0.7, this.amb);
    this.ocean = this._loopNoise(this.brown, 'lowpass', 900, 0.5, this.amb);
    this.chatter = this._loopNoise(this.noise, 'bandpass', 900, 3, this.amb);
    this.trafficHum = this._loopNoise(this.brown, 'lowpass', 220, 1, this.amb);
    this.birdTimer = 2;
    this.oceanPhase = 0;
  }

  // ---------- one-shots ----------
  _beep(freq, dur, type = 'sine', vol = 0.2, when = 0, slideTo = null, dest = null) {
    if (!this.ready) return;
    const c = this.ctx;
    const t = c.currentTime + when;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  _burst(dur, freq, vol, type = 'lowpass', when = 0) {
    if (!this.ready) return;
    const c = this.ctx;
    const t = c.currentTime + when;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfx);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  _dist(x, z) {
    return Math.hypot(x - this.listener.x, z - this.listener.z);
  }

  footstep(sand) { this._burst(0.07, sand ? 900 : 2200, sand ? 0.05 : 0.07, sand ? 'lowpass' : 'bandpass'); }
  click() { this._beep(880, 0.06, 'triangle', 0.12); }
  error() { this._beep(220, 0.18, 'square', 0.08); this._beep(170, 0.22, 'square', 0.07, 0.12); }
  coin() { this._beep(988, 0.08, 'square', 0.08); this._beep(1319, 0.25, 'square', 0.08, 0.07); }
  cash() { this._beep(1200, 0.06, 'triangle', 0.12); this._beep(1600, 0.12, 'triangle', 0.1, 0.06); this._burst(0.08, 5000, 0.04, 'highpass', 0.04); }
  checkpoint() { this._beep(784, 0.12, 'triangle', 0.16); this._beep(1175, 0.2, 'triangle', 0.14, 0.08); }
  missionStart() { [523, 659, 784].forEach((f, i) => this._beep(f, 0.18, 'triangle', 0.14, i * 0.12)); }
  missionComplete() { [523, 659, 784, 1047].forEach((f, i) => this._beep(f, 0.3, 'triangle', 0.15, i * 0.13)); }
  discover() { [659, 880, 1319].forEach((f, i) => this._beep(f, 0.4, 'sine', 0.13, i * 0.15)); }
  vehicleEnter(v) { this._burst(0.12, 300, 0.25); if (v.kind !== 'bicycle') this._beep(60, 0.5, 'sawtooth', 0.12, 0.1, 140); }
  vehicleExit() { this._burst(0.1, 260, 0.2); }

  crash(strength) {
    const v = Math.min(0.9, strength * 0.06);
    this._burst(0.4, 700, v);
    this._beep(70, 0.3, 'sine', v * 0.8, 0, 40);
  }

  horn(x = null, z = null, vol = 1) {
    if (!this.ready) return;
    const d = x === null ? 0 : this._dist(x, z);
    const a = vol * Math.max(0, 1 - d / 60) * 0.12;
    if (a < 0.005) return;
    this._beep(415, 0.35, 'square', a);
    this._beep(523, 0.35, 'square', a * 0.8);
  }

  shout(x, z) {
    const d = this._dist(x, z);
    const a = Math.max(0, 1 - d / 25) * 0.06;
    if (a > 0.005) this._beep(500 + Math.random() * 200, 0.25, 'sawtooth', a, 0, 800);
  }

  swing() { this._burst(0.12, 1600, 0.05, 'bandpass'); }
  punch() { this._burst(0.08, 380, 0.35); this._beep(110, 0.12, 'sine', 0.22, 0, 55); }
  kick() { this._burst(0.12, 260, 0.45); this._beep(80, 0.18, 'sine', 0.3, 0, 40); }

  bell() { this._beep(2200, 0.4, 'sine', 0.1); this._beep(2200, 0.4, 'sine', 0.08, 0.15); }

  // ---------- continuous ----------
  update(dt, game) {
    if (!this.ready) return;
    const c = this.ctx;
    const t = c.currentTime;
    const p = game.player;
    const v = p.vehicle;
    const lx = v ? v.x : p.pos.x, lz = v ? v.z : p.pos.z;
    this.listener.x = lx; this.listener.z = lz;
    const inside = !!p.interior;
    const paused = game.paused;

    // engine
    const E = this.eng;
    if (v && v.kind !== 'bicycle' && v.fuel > 0 && !paused) {
      const moto = v.kind === 'motorcycle';
      const base = moto ? (v.spec.style === 'scooter' ? 70 : 55) : v.spec.shape === 'sports' ? 48 : v.spec.shape === 'suv' ? 34 : 40;
      const f = base * (1 + v.rpm * 3.2);
      E.o1.frequency.setTargetAtTime(f, t, 0.05);
      E.o2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
      E.lp.frequency.setTargetAtTime(300 + v.rpm * 1600 + v.throttle * 600, t, 0.05);
      E.g.gain.setTargetAtTime(0.05 + v.rpm * 0.07 + v.throttle * 0.03, t, 0.08);
      E.lfo.frequency.setTargetAtTime(f / 4, t, 0.05);
      E.lfoDepth.gain.setTargetAtTime(moto ? 0.5 : 0.12, t, 0.1);
    } else E.g.gain.setTargetAtTime(0, t, 0.1);

    // tyres / brakes / wind
    const speed = v ? Math.abs(v.speed) : 0;
    const squeal = v && v.kind === 'car' && !paused ? Math.min(1, Math.max(0, v.slip - 2.5) / 6) : 0;
    this.tyre.g.gain.setTargetAtTime(squeal * 0.12, t, 0.05);
    this.brakeHiss.g.gain.setTargetAtTime(v && v.brakeInput > 0.3 && speed > 3 && !paused ? Math.min(0.05, speed * 0.002) : 0, t, 0.05);
    const windAmt = paused || inside ? 0 : Math.min(0.12, speed * 0.0025 + (game.layout.districtAt(lx, lz) === 'BEACH' ? 0.03 : 0.008));
    this.wind.g.gain.setTargetAtTime(windAmt, t, 0.3);
    this.wind.f.frequency.setTargetAtTime(400 + speed * 18, t, 0.3);

    // bicycle freewheel ticks
    if (v && v.kind === 'bicycle' && v.throttle === 0 && speed > 1.5 && !paused) {
      this.freewheelTimer -= dt * speed * 3;
      if (this.freewheelTimer <= 0) { this.freewheelTimer = 1; this._burst(0.015, 6000, 0.03, 'highpass'); }
    }

    if (v && v.impact > 3) {
      this.crash(v.impact);
      game.cameraManager.shake = Math.min(1.2, v.impact * 0.08);
    }

    // ambience
    const district = game.layout.districtAt(lx, lz);
    const mute = paused ? 0 : 1;
    const outside = inside ? 0.15 : 1;
    const cityAmt = (district === 'DT' || district === 'COM' ? 0.35 : district === 'BEACH' || district === 'PARK' ? 0.12 : 0.22);
    this.city.g.gain.setTargetAtTime(cityAmt * mute * outside, t, 0.5);
    const beachDist = Math.max(0, 300 - lx);
    this.oceanPhase += dt;
    const swell = 0.6 + 0.4 * Math.sin(this.oceanPhase * 0.7) * Math.sin(this.oceanPhase * 0.23 + 1);
    const oceanAmt = Math.max(0, 1 - beachDist / 120) * 0.55 * swell;
    this.ocean.g.gain.setTargetAtTime(oceanAmt * mute * outside, t, 0.3);
    const near = game.npcManager.queryNear(lx, lz, 18).length;
    this.chatter.g.gain.setTargetAtTime(Math.min(0.05, near * 0.006) * mute * outside, t, 0.5);
    const td = game.traffic.nearestDistance(lx, lz);
    this.trafficHum.g.gain.setTargetAtTime(Math.max(0, 1 - td / 45) * 0.35 * mute * outside, t, 0.3);

    // birds near trees / parks / beach
    this.birdTimer -= dt;
    if (this.birdTimer <= 0 && !paused && !inside) {
      this.birdTimer = 1.5 + Math.random() * 5;
      if (['PARK', 'RES', 'BEACH', 'APT', 'PLAZA'].includes(district)) {
        const f0 = 2500 + Math.random() * 1800;
        const n = 2 + Math.floor(Math.random() * 4);
        for (let k = 0; k < n; k++) this._beep(f0, 0.08, 'sine', 0.025, k * 0.11, f0 * (1.2 + Math.random() * 0.4), this.amb);
      }
    }
  }
}
