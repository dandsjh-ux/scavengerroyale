// Keyboard + mouse (pointer lock) and touch-screen controls, unified into one input state.

export class Input {
  constructor(canvas, touch) {
    this.canvas = canvas;
    this.touch = touch;
    this.keys = new Set();
    this.lookX = 0; this.lookY = 0;
    this.fire = false;
    this.aim = false;
    this.touchCrouch = false;
    this.stick = { x: 0, y: 0 };
    this.pressed = new Set(); // edge-triggered actions: jump, reload, dash, aimTap
    this.showScores = false;
    this.nadeHeld = false;      // grenade aim held (G key / bomb button); releasing throws
    this.locked = false;
    this.enabled = false;
    this.sensitivity = 0.0022;
    this.touchSensitivity = 0.0055;
    this.bindDesktop();
    if (touch) this.bindTouch();
  }

  // ---------- desktop ----------
  bindDesktop() {
    window.addEventListener('keydown', (e) => {
      if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
      if (e.code === 'Tab') { e.preventDefault(); this.showScores = true; }
      if (!this.keys.has(e.code)) {
        if (e.code === 'Space') this.pressed.add('jump');
        if (e.code === 'KeyR') this.pressed.add('reload');
        if (e.code === 'KeyE' || e.code === 'KeyQ') this.pressed.add('dash');
        if (e.code === 'KeyB') this.pressed.add('shop');
        if (e.code === 'KeyG') this.nadeHeld = true;
        if (/^Digit[1-9]$/.test(e.code)) this.pressed.add('buy' + e.code.slice(5));
      }
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') { e.preventDefault(); this.showScores = false; }
      if (e.code === 'KeyG' && this.nadeHeld) { this.nadeHeld = false; this.pressed.add('nadeThrow'); }
    });
    window.addEventListener('blur', () => { this.keys.clear(); this.fire = false; this.aim = false; this.nadeHeld = false; });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.fire = false; this.aim = false; }
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.lookX += e.movementX * this.sensitivity;
      this.lookY += e.movementY * this.sensitivity;
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.fire = true;
      if (e.button === 2) { this.aim = true; this.pressed.add('aimTap'); }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.aim = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  lock() {
    if (this.touch) return;
    try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* ignore */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  // ---------- touch ----------
  bindTouch() {
    const $ = (id) => document.getElementById(id);
    const zone = $('stickZone'), base = $('stickBase'), knob = $('stickKnob');
    const R = 55;
    let stickId = null, sx = 0, sy = 0;
    const baseHome = () => { base.style.left = '70px'; base.style.top = ''; base.style.bottom = '70px'; knob.style.transform = ''; };
    zone.addEventListener('pointerdown', (e) => {
      if (stickId !== null) return;
      stickId = e.pointerId; sx = e.clientX; sy = e.clientY;
      zone.setPointerCapture(e.pointerId);
      base.style.left = (sx - 65) + 'px'; base.style.top = (sy - 65) + 'px'; base.style.bottom = 'auto';
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== stickId) return;
      let dx = e.clientX - sx, dy = e.clientY - sy;
      const L = Math.hypot(dx, dy);
      if (L > R) { dx = dx / L * R; dy = dy / L * R; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.stick.x = dx / R; this.stick.y = -dy / R;
    });
    const endStick = (e) => { if (e.pointerId !== stickId) return; stickId = null; this.stick.x = 0; this.stick.y = 0; baseHome(); };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);

    // look area and the fire button both rotate the camera while dragged
    const lookers = new Map();
    const startLook = (el, e) => { el.setPointerCapture(e.pointerId); lookers.set(e.pointerId, [e.clientX, e.clientY]); };
    const moveLook = (e) => {
      const last = lookers.get(e.pointerId);
      if (!last) return;
      this.lookX += (e.clientX - last[0]) * this.touchSensitivity;
      this.lookY += (e.clientY - last[1]) * this.touchSensitivity;
      lookers.set(e.pointerId, [e.clientX, e.clientY]);
    };
    const endLook = (e) => lookers.delete(e.pointerId);
    const look = $('lookZone');
    look.addEventListener('pointerdown', (e) => { startLook(look, e); this.pressed.add('tap'); });
    look.addEventListener('pointermove', moveLook);
    look.addEventListener('pointerup', endLook);
    look.addEventListener('pointercancel', endLook);

    const fire = $('tFire');
    fire.addEventListener('pointerdown', (e) => { e.preventDefault(); this.fire = true; startLook(fire, e); fire.classList.add('on'); });
    fire.addEventListener('pointermove', moveLook);
    const endFire = (e) => { this.fire = false; endLook(e); fire.classList.remove('on'); };
    fire.addEventListener('pointerup', endFire);
    fire.addEventListener('pointercancel', endFire);

    // bomb button: hold to show the arc (drag to aim), release to throw
    const nade = $('tNade');
    nade.addEventListener('pointerdown', (e) => { e.preventDefault(); this.nadeHeld = true; startLook(nade, e); nade.classList.add('on'); });
    nade.addEventListener('pointermove', moveLook);
    nade.addEventListener('pointerup', (e) => { if (this.nadeHeld) this.pressed.add('nadeThrow'); this.nadeHeld = false; endLook(e); nade.classList.remove('on'); });
    nade.addEventListener('pointercancel', (e) => { this.nadeHeld = false; endLook(e); nade.classList.remove('on'); });

    const tap = (id, fn) => $(id).addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn($(id)); });
    tap('tJump', () => this.pressed.add('jump'));
    tap('tReload', () => this.pressed.add('reload'));
    tap('tAim', (el) => { this.pressed.add('aimTap'); this.pressed.add('dash'); this.aim = !this.aim; el.classList.toggle('on', this.aim); });
    tap('tCrouch', (el) => { this.touchCrouch = !this.touchCrouch; el.classList.toggle('on', this.touchCrouch); });
    tap('tScore', () => { this.showScores = !this.showScores; });
    tap('tShop', () => this.pressed.add('shop'));
  }

  setAimButton(label, toggleable) {
    if (!this.touch) return;
    const el = document.getElementById('tAim');
    el.textContent = label;
    if (!toggleable) { this.aim = false; el.classList.remove('on'); }
  }

  resetTouchToggles() {
    this.aim = false; this.touchCrouch = false;
    if (!this.touch) return;
    document.getElementById('tAim').classList.remove('on');
    document.getElementById('tCrouch').classList.remove('on');
  }

  // ---------- per-frame queries ----------
  moveVector() {
    let x = 0, y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    x += this.stick.x; y += this.stick.y;
    const L = Math.hypot(x, y);
    if (L > 1) { x /= L; y /= L; }
    return { x, y };
  }
  get sprint() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || Math.hypot(this.stick.x, this.stick.y) > 0.92; }
  get crouch() { return this.keys.has('KeyC') || this.keys.has('ControlLeft') || this.touchCrouch; }
  take(name) { const had = this.pressed.has(name); this.pressed.delete(name); return had; }
  takeLook() { const r = [this.lookX, this.lookY]; this.lookX = 0; this.lookY = 0; return r; }
  clearPressed() { this.pressed.clear(); }
}
