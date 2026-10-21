// Tiny synthesized sound effects (no audio files needed).
let ctx = null, master = null, noiseBuf = null;

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function noise(dur, freq, q, vol, type = 'lowpass', sweepTo = 0) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur);
}

function tone(freq, dur, vol, type = 'sine', toFreq = 0, delay = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur);
}

// vol 0..1 based on distance
export function sfxShot(cls, vol = 1) {
  if (vol < 0.02) return;
  if (cls === 'sniper') { noise(0.5, 1800, 0.7, 0.9 * vol, 'lowpass', 200); tone(90, 0.35, 0.6 * vol, 'sine', 40); }
  else { noise(0.12, 3000, 0.8, 0.45 * vol, 'lowpass', 600); tone(180, 0.08, 0.2 * vol, 'square', 70); }
}
export function sfxSwing(vol = 1) { if (vol > 0.02) noise(0.18, 900, 2, 0.35 * vol, 'bandpass', 3500); }
export function sfxHit(head) { tone(head ? 1500 : 1100, 0.07, 0.25, 'triangle'); if (head) tone(1900, 0.08, 0.2, 'triangle', 0, 0.06); }
export function sfxKill() { [660, 880, 1320].forEach((f, i) => tone(f, 0.15, 0.22, 'triangle', 0, i * 0.07)); }
export function sfxHurt() { tone(160, 0.2, 0.4, 'sawtooth', 60); }
export function sfxPickup(type) { (type === 'med' ? [523, 659, 784] : [440, 660, 990]).forEach((f, i) => tone(f, 0.12, 0.2, 'sine', 0, i * 0.06)); }
export function sfxReload() { tone(300, 0.05, 0.15, 'square'); tone(500, 0.05, 0.15, 'square', 0, 0.25); }
export function sfxJump() { tone(300, 0.1, 0.1, 'sine', 600); }
export function sfxDash() { noise(0.25, 400, 1, 0.3, 'bandpass', 2400); }
export function sfxZoneTick() { tone(220, 0.12, 0.15, 'sine'); }
export function sfxWin() { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, 0.2, 0.25, 'triangle', 0, i * 0.12)); }
export function sfxStep(vol = 0.06) { noise(0.06, 500, 1, vol, 'lowpass'); }
export function sfxBoom(vol = 1) { noise(1.1, 900, 0.6, 1.0 * vol, 'lowpass', 60); tone(70, 0.6, 0.8 * vol, 'sine', 30); }
export function sfxThrow(vol = 1) { if (vol > 0.02) noise(0.2, 600, 1.5, 0.25 * vol, 'bandpass', 1800); }
export function sfxDrop() { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.18, 0.18, 'square', 0, i * 0.09)); }
