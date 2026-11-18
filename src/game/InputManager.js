// Keyboard, mouse (pointer-lock or drag-to-look) and touch input in one place.
const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  interact: ['KeyE'],
  camera: ['KeyC'],
  pause: ['Escape', 'KeyP'],
  map: ['KeyM'],
  lights: ['KeyL'],
  horn: ['KeyH'],
  reset: ['KeyR'],
  garage: ['KeyV'],
  missions: ['KeyJ'],
  useItem: ['KeyF'],
  attack: ['Mouse0'],     // left mouse button (see _onMouseDown)
  gear1: ['Digit1'],
  gear2: ['Digit2'],
  gear3: ['Digit3'],
  zoomIn: ['Equal', 'NumpadAdd'],
  zoomOut: ['Minus', 'NumpadSubtract'],
};

export class InputManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.lookDX = 0;
    this.lookDY = 0;
    this.wheel = 0;
    this.enabled = true;
    this.pointerLocked = false;
    this.lockWanted = true;
    this.lockFailed = false;
    this.dragging = false;
    this.lastLookTime = 0;
    this.onPointerUnlock = null;
    this.touch = { active: false, moveX: 0, moveY: 0, buttons: new Set(), pressed: new Set() };
    this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this._bind();
  }

  _bind() {
    this._onKeyDown = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => this.keys.clear();
    this._onMouseMove = (e) => {
      if (!this.enabled) return;
      if (this.pointerLocked || this.dragging) {
        this.lookDX += e.movementX || 0;
        this.lookDY += e.movementY || 0;
        if (e.movementX || e.movementY) this.lastLookTime = performance.now();
      }
    };
    this._onMouseDown = (e) => {
      if (!this.enabled || e.target !== this.canvas) return;
      // a left click attacks, except the click that only grabs the mouse (pointer lock)
      const grabbing = this.lockWanted && !this.pointerLocked && !this.lockFailed && !this.isTouchDevice;
      if (e.button === 0 && !grabbing) this.pressed.add('Mouse0');
      if (grabbing) this.requestLock();
      this.dragging = true;
    };
    this._onMouseUp = () => (this.dragging = false);
    this._onWheel = (e) => {
      if (!this.enabled || e.target !== this.canvas) return;
      this.wheel += Math.sign(e.deltaY);
    };
    this._onLockChange = () => {
      const was = this.pointerLocked;
      this.pointerLocked = document.pointerLockElement === this.canvas;
      if (was && !this.pointerLocked && this.onPointerUnlock) this.onPointerUnlock();
    };
    this._onLockError = () => {
      this.lockFailed = true; // sandboxed iframe etc. -> drag-to-look fallback
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('wheel', this._onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('pointerlockerror', this._onLockError);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  requestLock() {
    try {
      const p = this.canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => (this.lockFailed = true));
    } catch (err) {
      this.lockFailed = true;
    }
  }

  releaseLock() {
    if (document.pointerLockElement) {
      const cb = this.onPointerUnlock;
      this.onPointerUnlock = null;
      document.exitPointerLock();
      setTimeout(() => (this.onPointerUnlock = cb), 50);
    }
  }

  down(action) {
    const codes = BINDINGS[action];
    if (this.touch.buttons.has(action)) return true;
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  justPressed(action) {
    if (this.touch.pressed.has(action)) return true;
    for (const c of BINDINGS[action]) if (this.pressed.has(c)) return true;
    return false;
  }

  /** Movement axes in [-1,1]: x = right, y = forward. */
  get moveX() {
    let v = (this.down('right') ? 1 : 0) - (this.down('left') ? 1 : 0);
    if (this.touch.active && Math.abs(this.touch.moveX) > 0.05) v = this.touch.moveX;
    return v;
  }
  get moveY() {
    let v = (this.down('forward') ? 1 : 0) - (this.down('back') ? 1 : 0);
    if (this.touch.active && Math.abs(this.touch.moveY) > 0.05) v = this.touch.moveY;
    return v;
  }

  consumeLook() {
    const r = { dx: this.lookDX, dy: this.lookDY, wheel: this.wheel };
    this.lookDX = this.lookDY = this.wheel = 0;
    return r;
  }

  addLook(dx, dy) {
    this.lookDX += dx;
    this.lookDY += dy;
    this.lastLookTime = performance.now();
  }

  /** Call at the end of every frame. */
  endFrame() {
    this.pressed.clear();
    this.touch.pressed.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('pointerlockerror', this._onLockError);
  }
}
