// Rolling FPS / frame-time monitor. Feeds the optional FPS overlay and a low-FPS hint.
export class PerformanceMonitor {
  constructor() {
    this.samples = new Float32Array(120);
    this.i = 0;
    this.count = 0;
    this.fps = 60;
    this.frameMs = 16.7;
    this.lowSince = 0;
    this.onLowPerformance = null;
    this.warned = false;
  }
  tick(dt, now) {
    this.samples[this.i] = dt;
    this.i = (this.i + 1) % this.samples.length;
    this.count = Math.min(this.count + 1, this.samples.length);
    let sum = 0;
    for (let k = 0; k < this.count; k++) sum += this.samples[k];
    const avg = sum / this.count;
    this.frameMs = avg * 1000;
    this.fps = avg > 0 ? 1 / avg : 60;
    if (this.fps < 30 && this.count === this.samples.length) {
      if (!this.lowSince) this.lowSince = now;
      if (!this.warned && now - this.lowSince > 4 && this.onLowPerformance) {
        this.warned = true;
        this.onLowPerformance(this.fps);
      }
    } else {
      this.lowSince = 0;
    }
  }
  /** Forget the history (after a quality change) so the next check measures the new settings. */
  reset() {
    this.i = 0;
    this.count = 0;
    this.lowSince = 0;
    this.warned = false;
  }
}
