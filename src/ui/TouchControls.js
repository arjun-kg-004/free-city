/** Virtual joystick + look pad + action buttons for phones and tablets. */
export class TouchControls {
  constructor(game) {
    this.game = game;
    this.input = game.input;
    this.root = document.getElementById('touch');
    this.zone = document.getElementById('joy-zone');
    this.base = document.getElementById('joy-base');
    this.knob = document.getElementById('joy-knob');
    this.look = document.getElementById('look-zone');
    this.joyId = null;
    this.lookId = null;
    this.enabled = this.input.isTouchDevice;
    if (!this.enabled) return;
    document.body.classList.add('touch');
    this._bindJoystick();
    this._bindLook();
    this._bindButtons();
  }

  show(on) {
    if (!this.enabled) return;
    this.root.classList.toggle('hidden', !on);
    this.input.touch.active = on;
  }

  _bindJoystick() {
    const t = this.input.touch;
    const R = 55;
    let cx = 0, cy = 0;
    this.zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const touch = e.changedTouches[0];
      this.joyId = touch.identifier;
      const r = this.base.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      this._moveJoy(touch.clientX - cx, touch.clientY - cy, R);
    }, { passive: false });
    this.zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const touch of e.changedTouches) if (touch.identifier === this.joyId) this._moveJoy(touch.clientX - cx, touch.clientY - cy, R);
    }, { passive: false });
    const end = (e) => {
      for (const touch of e.changedTouches) if (touch.identifier === this.joyId) {
        this.joyId = null;
        t.moveX = t.moveY = 0;
        this.knob.style.transform = 'translate(0px, 0px)';
      }
    };
    this.zone.addEventListener('touchend', end);
    this.zone.addEventListener('touchcancel', end);
  }

  _moveJoy(dx, dy, R) {
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.input.touch.moveX = dx / R;
    this.input.touch.moveY = -dy / R;
  }

  _bindLook() {
    let lx = 0, ly = 0;
    this.look.addEventListener('touchstart', (e) => {
      const touch = e.changedTouches[0];
      this.lookId = touch.identifier;
      lx = touch.clientX; ly = touch.clientY;
    }, { passive: true });
    this.look.addEventListener('touchmove', (e) => {
      for (const touch of e.changedTouches) if (touch.identifier === this.lookId) {
        this.input.addLook((touch.clientX - lx) * 1.6, (touch.clientY - ly) * 1.6);
        lx = touch.clientX; ly = touch.clientY;
      }
    }, { passive: true });
    const end = (e) => { for (const touch of e.changedTouches) if (touch.identifier === this.lookId) this.lookId = null; };
    this.look.addEventListener('touchend', end);
    this.look.addEventListener('touchcancel', end);
  }

  _bindButtons() {
    const t = this.input.touch;
    for (const b of this.root.querySelectorAll('[data-act]')) {
      const act = b.dataset.act;
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        t.buttons.add(act);
        t.pressed.add(act);
        b.classList.add('active');
      }, { passive: false });
      const up = (e) => { e.preventDefault(); t.buttons.delete(act); b.classList.remove('active'); };
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
    }
  }

  /** Swap button labels between walking and driving. */
  update() {
    if (!this.enabled) return;
    const inVeh = !!this.game.player.vehicle;
    for (const b of this.root.querySelectorAll('.veh')) b.classList.toggle('hidden', !inVeh);
    for (const b of this.root.querySelectorAll('.foot')) b.classList.toggle('hidden', inVeh);
    document.getElementById('tb-jump').textContent = inVeh ? '⏸' : '⤒';
    document.getElementById('tb-sprint').textContent = inVeh && this.game.player.vehicle.kind !== 'bicycle' ? '' : '»';
  }
}
