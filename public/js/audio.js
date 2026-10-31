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

// ---------- 3D-ish positioning ----------
// Sounds from the world fade with distance (silent past their range), get muffled the further away
// they are, and are panned toward where they came from.
const lis = { x: 0, y: 0, z: 0, yaw: 0 };
export function setListener(x, y, z, yaw) { lis.x = x; lis.y = y; lis.z = z; lis.yaw = yaw; }

// Returns how a sound at position p (array or {x,y,z}) should be heard, or null if it's out of earshot.
export function at(p, range) {
  const px = p.x ?? p[0], py = p.y ?? p[1], pz = p.z ?? p[2];
  const dx = px - lis.x, dy = py - lis.y, dz = pz - lis.z;
  const d = Math.hypot(dx, dy, dz);
  if (d >= range) return null;
  const near = 1 - d / range;
  const rx = Math.cos(lis.yaw), rz = -Math.sin(lis.yaw); // listener's right-hand direction
  const pan = d > 0.5 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / Math.hypot(dx, dz || 1e-6))) * 0.8 : 0;
  return { vol: near * near, cut: 300 + 17700 * near * near * near, pan };
}

// Turns a volume (number, for your own sounds) or an at() result into a gain + output node.
function route(sp) {
  if (!ctx || sp == null) return null;
  if (typeof sp === 'number') return sp > 0.01 ? { g: sp, out: master } : null;
  if (sp.vol < 0.01) return null;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = sp.cut;
  let tail = lp;
  if (ctx.createStereoPanner) { const pn = ctx.createStereoPanner(); pn.pan.value = sp.pan; lp.connect(pn); tail = pn; }
  tail.connect(master);
  setTimeout(() => { try { tail.disconnect(); } catch { /* already gone */ } }, 2500);
  return { g: sp.vol, out: lp };
}

function noise(dur, freq, q, vol, type = 'lowpass', sweepTo = 0, out = master) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(out);
  src.start(t); src.stop(t + dur);
}

function tone(freq, dur, vol, type = 'sine', toFreq = 0, delay = 0, out = master) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
  if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + dur);
}

// The sounds below take either a plain volume (your own actions) or SFX.at(position, range).
export function sfxShot(cls, sp = 1) {
  const r = route(sp); if (!r) return;
  if (cls === 'sniper') { noise(0.5, 1800, 0.7, 0.9 * r.g, 'lowpass', 200, r.out); tone(90, 0.35, 0.6 * r.g, 'sine', 40, 0, r.out); }
  else { noise(0.12, 3000, 0.8, 0.45 * r.g, 'lowpass', 600, r.out); tone(180, 0.08, 0.2 * r.g, 'square', 70, 0, r.out); }
}
export function sfxSwing(sp = 1, pitch = 1) { const r = route(sp); if (r) noise(0.18 / pitch, 900 * pitch, 2, 0.35 * r.g, 'bandpass', 3500 * pitch, r.out); }
export function sfxSlam(sp = 1) { const r = route(sp); if (!r) return; noise(0.5, 500, 0.8, 0.8 * r.g, 'lowpass', 80, r.out); tone(110, 0.3, 0.5 * r.g, 'sine', 45, 0, r.out); }
export function sfxSiren(sp = 1) { const r = route(sp); if (!r) return; tone(660, 0.3, 0.25 * r.g, 'square', 440, 0, r.out); }
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
export function sfxBoom(sp = 1) { const r = route(sp); if (!r) return; noise(1.1, 900, 0.6, 1.0 * r.g, 'lowpass', 60, r.out); tone(70, 0.6, 0.8 * r.g, 'sine', 30, 0, r.out); }
export function sfxThrow(sp = 1) { const r = route(sp); if (r) noise(0.2, 600, 1.5, 0.25 * r.g, 'bandpass', 1800, r.out); }
export function sfxDrop() { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.18, 0.18, 'square', 0, i * 0.09)); }

// ---------- recorded voice lines ----------
const voiceCache = new Map();
let voiceSrc = null, voiceGain = null, voiceVolume = 0.9;
export function setVoiceVolume(v) { voiceVolume = v; if (voiceGain) voiceGain.gain.value = v; }
function loadVoice(url) {
  if (!voiceCache.has(url)) {
    voiceCache.set(url, fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
      .then((a) => ctx.decodeAudioData(a)).catch(() => null));
  }
  return voiceCache.get(url);
}
export function preloadVoices(urls) { if (ctx) urls.forEach(loadVoice); }
// Plays one line at a time: a new line cuts off the previous one.
export async function playVoice(url) {
  if (!ctx || voiceVolume <= 0) return;
  const buf = await loadVoice(url);
  if (!buf) return;
  if (!voiceGain) { voiceGain = ctx.createGain(); voiceGain.connect(ctx.destination); }
  voiceGain.gain.value = voiceVolume;
  if (voiceSrc) { try { voiceSrc.stop(); } catch { /* already ended */ } }
  voiceSrc = ctx.createBufferSource();
  voiceSrc.buffer = buf;
  voiceSrc.connect(voiceGain);
  voiceSrc.start();
}
export function sfxWordGood() { [784, 1047, 1319].forEach((f, i) => tone(f, 0.1, 0.2, 'triangle', 0, i * 0.05)); }
export function sfxWordBad() { tone(180, 0.25, 0.3, 'square', 120); }
export function sfxCash() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.14, 0.22, 'triangle', 0, i * 0.07)); }
