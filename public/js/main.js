import * as THREE from 'three';
import {
  CLASSES, BODY_HEIGHT, CROUCH_HEIGHT, EYE_HEIGHT, CROUCH_EYE, GLIDE_FALL_SPEED, GLIDE_MOVE_SPEED, MAX_HP, MAX_SHIELD, MAP_HALF,
  SHOP_ITEMS, SPEED_UPGRADE, JUMP_UPGRADE, MAG_UPGRADE, RADAR_TIME, GRENADE, MUTATORS, mut, BOT_SKILL,
  KNIFE, SETTINGS, defaultSettings, allowedClasses, SHOP_NEEDS_ALIVE,
  STREAKS, AIRSTRIKE, JETPACK, GRAVITY,
} from '../shared/config.js';
import { generateMap } from '../shared/map.js';
import { World, stepBody, stepGrenade, raySphere, rayBox, lineOfSight } from '../shared/physics.js';
import { Renderer, THEMES, themeForSeed } from './render.js';
import { Input } from './input.js';
import * as SFX from './audio.js';
import { voice, killVoice, preloadAllVoices } from './voice.js';

// ------------------------------------------------------------------ setup
const params = new URLSearchParams(location.search);
const touch = params.has('touch') ? params.get('touch') !== '0' : matchMedia('(pointer: coarse)').matches;
if (touch) document.body.classList.add('touch');

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const R = new Renderer(canvas, { touch });
const input = new Input(canvas, touch);
const BASE_FOV = touch ? 72 : 78;

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const S = {
  ws: null, myId: null, phase: 'connecting', lobby: null, addresses: [], port: location.port,
  seed: null, map: null, world: null,
  name: store.get('sr_name', ''), cls: CLASSES[store.get('sr_cls', 'rifle')] ? store.get('sr_cls', 'rifle') : 'rifle',
  info: new Map(), snap: new Map(), zone: null, aliveCount: 0,
  inMatch: false, specId: null,
  me: null, weapon: null, aimK: 0, fireLatch: false, sendT: 0, stepAcc: 0, zoneTickT: 0,
  outside: false,
  points: 0, up: { dmg: 0, speed: 0, jump: 0, mag: 0 }, shopOpen: false, radarUntil: 0,
  nades: 0, maxNades: 0, lastThrow: 0, nadeSims: new Map(),
  mut: 'classic', bountyId: null, marks: new Map(), bloom: 0, fovKick: 0,
  settings: defaultSettings(), locked: false, myKills: 0, respawnAt: 0, livesLeft: -1,
  combo: 0, comboLast: 0, lastSlam: 0, lastKnifeThrow: 0,
  streak: 0, rewards: {}, wallhackUntil: 0, strikes: [], strikeOpen: false, jetFuel: 0, lastJumpPress: -9,
};
const NADE_DT = 0.05; // grenades are stepped at the server's tick rate so client and server paths match
const gScale = () => mut(S.mut).gravity || 1;

// ------------------------------------------------------------------ networking
// A private token kept in this browser lets the server recognise you if you reconnect mid-match
// (closed the tab by accident, Wi-Fi dropped...), so you resume your own character.
let token = store.get('sr_token', '');
if (!token) { token = Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join(''); store.set('sr_token', token); }

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  S.ws = ws;
  ws.onopen = () => { $('connMsg').classList.add('hidden'); send({ t: 'hello', name: S.name, cls: S.cls, token }); };
  ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMessage(m); };
  ws.onclose = () => {
    if (S.full) return;
    $('connMsg').textContent = S.phase === 'playing' && S.inMatch
      ? '📶 Connection lost — reconnecting… your character is still in the match'
      : 'Disconnected from server — retrying…';
    $('connMsg').classList.remove('hidden');
    input.fire = false;
    setTimeout(connect, 1500);
  };
}
function send(m) { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(m)); }

function onMessage(m) {
  switch (m.t) {
    case 'welcome':
      S.myId = m.id; S.addresses = m.addresses || []; S.port = m.port; renderJoinInfo();
      if (m.name && m.name !== S.name) { S.name = m.name; nameInput.value = m.name; store.set('sr_name', m.name); }
      break;
    case 'resume': onResume(m); break;
    case 'dc': {
      const i = S.info.get(m.id);
      if (i) feedLine(m.on ? `📶 <b style="color:${i.color}">${esc(i.name)}</b> lost connection` : `✅ <b style="color:${i.color}">${esc(i.name)}</b> is back`);
      break;
    }
    case 'full': S.full = true; $('connMsg').textContent = 'Server is full (8 players max).'; $('connMsg').classList.remove('hidden'); break;
    case 'lobby': onLobby(m); break;
    case 'start': onStart(m); break;
    case 's': onSnap(m); break;
    case 'fx': onFx(m); break;
    case 'kill': onKill(m); break;
    case 'hurt': onHurt(m); break;
    case 'hitm': onHitMarker(m); break;
    case 'pk': onPickup(m); break;
    case 'end': onEnd(m); break;
    case 'pts': onPoints(m); break;
    case 'shopfail': $('shopMsg').textContent = m.msg; break;
    case 'inv': S.nades = m.nades; S.maxNades = m.max; break;
    case 'nade': onNadeThrown(m); break;
    case 'boom': onBoom(m); break;
    case 'pkadd': R.addPickups(m.list); break;
    case 'drop': banner('📦 Supply drop incoming! Check your minimap'); SFX.sfxDrop(); break;
    case 'bounty': onBounty(m); break;
    case 'respawn': onRespawn(m); break;
    case 'streak': onStreak(m); break;
    case 'streakOn': onStreakOn(m); break;
    case 'strike': onStrike(m); break;
    case 'lock':
      S.locked = true; closeShop();
      banner(`🔒 Final circles! ${S.settings.respawn === 'on' ? 'Respawns' : 'Eliminations are final'} and the shop are now closed`);
      break;
  }
}

// ------------------------------------------------------------------ world
function buildWorld(seed) {
  if (S.seed === seed) return;
  S.seed = seed;
  S.map = generateMap(seed);
  S.world = new World(S.map.boxes);
  R.buildMap(S.map);
  R.setTheme(themeForSeed(seed));
  buildMinimapBase();
}

// ------------------------------------------------------------------ lobby UI
function buildClassCards() {
  const wrap = $('classCards');
  wrap.innerHTML = '';
  for (const [key, c] of Object.entries(CLASSES)) {
    const el = document.createElement('div');
    el.className = 'class-card' + (key === S.cls ? ' sel' : '');
    el.style.setProperty('--c', c.color);
    const bar = (label, v) => `<div class="stat"><span>${label}</span><i><b style="width:${v * 20}%"></b></i></div>`;
    el.innerHTML = `<h3>${c.name}</h3><p>${c.desc}</p>${bar('Speed', c.stats.speed)}${bar('Range', c.stats.range)}${bar('Damage', c.stats.damage)}` +
      `<div class="passive">★ ${c.passive}</div><div class="nades">💣 Grenades: start ${c.grenades.start}, carry up to ${c.grenades.max}</div>`;
    el.dataset.cls = key;
    el.onclick = () => {
      if (!allowedClasses(S.settings).includes(key)) return;
      S.cls = key; store.set('sr_cls', key);
      wrap.querySelectorAll('.class-card').forEach((n) => n.classList.remove('sel'));
      el.classList.add('sel');
      send({ t: 'cfg', cls: key });
    };
    wrap.appendChild(el);
  }
}

const nameInput = $('nameInput');
nameInput.value = S.name;
nameInput.addEventListener('input', () => {
  S.name = nameInput.value.slice(0, 16); store.set('sr_name', S.name);
  clearTimeout(nameInput._t); nameInput._t = setTimeout(() => send({ t: 'cfg', name: S.name }), 300);
});
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });
$('botRange').addEventListener('input', (e) => { $('botVal').textContent = e.target.value; send({ t: 'bots', n: +e.target.value }); });
// ---- host settings panel (built from the SETTINGS list in config.js) ----
function buildSettingsPanel() {
  const grid = $('settingsGrid');
  const groups = {};
  for (const def of SETTINGS) (groups[def.group] ||= []).push(def);
  grid.innerHTML = Object.entries(groups).map(([g, defs]) => `<div class="set-group"><h4>${g}</h4>` + defs.map((d) =>
    `<div class="set-row"><label for="set_${d.key}">${d.label}</label><select id="set_${d.key}">` +
    d.options.map((o, i) => `<option value="${i}">${o[1]}</option>`).join('') + '</select></div>').join('') + '</div>').join('');
  for (const d of SETTINGS) $('set_' + d.key).addEventListener('change', (e) => send({ t: 'set', key: d.key, i: +e.target.value }));
}
buildSettingsPanel();

function applySettings(set, isHost) {
  S.settings = set;
  for (const d of SETTINGS) {
    const el = $('set_' + d.key);
    const i = d.options.findIndex((o) => o[0] === set[d.key]);
    if (i >= 0 && document.activeElement !== el) el.value = i;
    el.disabled = !isHost;
  }
  $('settingsWho').textContent = isHost ? '(you are the host)' : '(set by the host)';
  const allowed = allowedClasses(set);
  document.querySelectorAll('.class-card').forEach((el) => el.classList.toggle('off', !allowed.includes(el.dataset.cls)));
  if (!allowed.includes(S.cls)) $('classCards').querySelector(`[data-cls="${allowed[0]}"]`)?.click();
}

const mutSel = $('mutSelect'), skillSel = $('botSkill');
mutSel.innerHTML = '<option value="random">🎲 Random</option>' + Object.entries(MUTATORS).map(([k, v]) => `<option value="${k}">${v.icon} ${v.name}</option>`).join('');
skillSel.innerHTML = Object.entries(BOT_SKILL).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
const sendOpts = () => send({ t: 'opts', mutator: mutSel.value, botSkill: skillSel.value });
mutSel.addEventListener('change', sendOpts);
skillSel.addEventListener('change', sendOpts);
$('startBtn').addEventListener('click', () => { SFX.unlockAudio(); send({ t: 'cfg', name: S.name, cls: S.cls }); send({ t: 'start' }); });
const voiceVol = $('voiceVol');
voiceVol.value = store.get('sr_voice', '0.9');
SFX.setVoiceVolume(+voiceVol.value);
voiceVol.addEventListener('input', () => { SFX.setVoiceVolume(+voiceVol.value); store.set('sr_voice', voiceVol.value); });
voiceVol.addEventListener('change', () => { SFX.unlockAudio(); voice('kill'); }); // preview
document.addEventListener('pointerdown', () => {
  SFX.unlockAudio();
  preloadAllVoices();
  // tablets: go fullscreen on the first touch during a match
  if (touch && S.phase === 'playing' && !document.fullscreenElement && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}, { capture: true });

function renderJoinInfo() {
  const port = S.port || location.port;
  const host = location.hostname;
  const lan = S.addresses.length ? S.addresses : [];
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  if (!isLocal) { // hosted online, or already opened via a LAN address: share this exact page
    $('joinInfo').innerHTML = `Friends join at: <code>${location.origin}</code>`;
    return;
  }
  const urls = lan.map((ip) => `<code>http://${ip}:${port}</code>`);
  $('joinInfo').innerHTML = urls.length
    ? `Friends on the same Wi-Fi join at: ${urls.join(' or ')}`
    : 'No network address found — connect this computer to Wi-Fi/LAN so friends can join.';
}

function onLobby(m) {
  S.lobby = m;
  S.info.clear();
  for (const p of m.players) S.info.set(p.id, p);
  if (m.phase === 'lobby') {
    buildWorld(m.seed);
    if (S.phase !== 'lobby') enterLobby();
  }
  const list = $('playerList');
  list.innerHTML = '';
  for (const p of m.players) {
    const li = document.createElement('li');
    li.style.setProperty('--c', p.color);
    li.innerHTML = `${p.id === m.host ? '👑 ' : ''}${esc(p.name)}${p.id === S.myId ? ' <i>(you)</i>' : ''}${p.dc ? ' <i>📶 reconnecting</i>' : ''}<span class="cls">${CLASSES[p.cls].name}</span>`;
    list.appendChild(li);
  }
  const humans = m.players.filter((p) => !p.bot).length;
  $('playerCount').textContent = `(${humans}/8)`;
  const isHost = m.host === S.myId;
  if (m.settings) applySettings(m.settings, isHost);
  $('botRange').disabled = mutSel.disabled = skillSel.disabled = !isHost;
  mutSel.value = m.mutator; skillSel.value = m.botSkill;
  $('mutDesc').textContent = m.mutator === 'random' ? 'A surprise mutator is picked each match.' : mut(m.mutator).desc;
  $('startBtn').style.display = isHost ? '' : 'none';
  const sess = m.session || [];
  $('sessionBox').classList.toggle('hidden', !sess.length);
  $('sessionTable').innerHTML = '<tr><th>Player</th><th>Wins</th><th>Kills</th><th>Games</th></tr>' +
    sess.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.wins}</td><td>${r.kills}</td><td>${r.games}</td></tr>`).join('');
  $('waitMsg').style.display = isHost ? 'none' : '';
  const maxBots = Math.max(0, 8 - humans);
  $('botRange').max = maxBots;
  $('botRange').value = Math.min(m.bots, maxBots);
  $('botVal').textContent = Math.min(m.bots, maxBots);
  if (m.phase !== 'lobby') $('waitMsg').textContent = 'A match is in progress — you will join the next one.';
  else $('waitMsg').textContent = 'Waiting for the host to start…';
}

function enterLobby() {
  S.phase = 'lobby';
  S.inMatch = false; S.me = null; S.specId = null; S.zone = null;
  closeShop();
  R.clearAvatars(); R.clearPickups(); R.setZone(null); R.clearNades(); R.clearEffects(); R.setArc(null);
  S.nadeSims.clear();
  S.snap.clear();
  input.unlock();
  ['hud', 'endScreen', 'deathScreen', 'clickToPlay', 'touch', 'scoreboard', 'respawnBox'].forEach((id) => $(id).classList.add('hidden'));
  S.respawnAt = 0;
  $('lobby').classList.remove('hidden');
}

function esc(s) { return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`); }

// ------------------------------------------------------------------ match start
function onStart(m) {
  buildWorld(m.seed);
  R.setPickups(m.pickups || []);
  R.clearNades(); R.clearEffects(); S.nadeSims.clear();
  S.mut = m.mut || 'classic'; S.bountyId = null; S.marks.clear(); S.bloom = 0;
  S.locked = false; S.myKills = 0; S.respawnAt = 0; S.combo = 0; S.lastSlam = 0; S.lastKnifeThrow = 0;
  S.streak = 0; S.rewards = {}; S.wallhackUntil = 0; S.strikes = []; S.jetFuel = 0; closeStrikeMap();
  const mu = mut(S.mut);
  $('mutPill').textContent = S.mut === 'classic' ? '' : `${mu.icon} ${mu.name}`;
  if (S.mut !== 'classic') setTimeout(() => banner(`${mu.icon} ${mu.name}: ${mu.desc}`), 4500);
  S.phase = 'playing';
  S.inMatch = !m.spectator;
  S.specId = null;
  $('lobby').classList.add('hidden');
  $('endScreen').classList.add('hidden');
  $('hud').classList.remove('hidden');
  input.resetTouchToggles();
  input.clearPressed();
  if (S.inMatch) {
    S.points = 0; S.up = { dmg: 0, speed: 0, jump: 0, mag: 0 }; S.radarUntil = 0;
    spawnLocal(m.spawn, m.yaw, 0);
    voice('start');
    flashCenter('Skydive! Steer to a good landing spot', `${THEMES[R.theme].name} · loot medkits, shields & grenades inside buildings`, 4);
  } else {
    S.me = null;
    $('deathScreen').classList.remove('hidden');
    $('deathTitle').textContent = 'MATCH IN PROGRESS';
    $('deathSub').textContent = 'You will join the next round.';
  }
}

// Puts the local player into the world (match start or respawn).
function spawnLocal([x, y, z], yaw, kills) {
  S.me = { x, y, z, vx: 0, vy: 0, vz: 0, h: BODY_HEIGHT, onGround: false, yaw: yaw || 0, pitch: -0.5,
    alive: true, glide: true, hp: MAX_HP, shield: 0, kills, canDouble: true, dashT: 0, dashCd: 0, dashX: 0, dashZ: 0,
    eye: EYE_HEIGHT, lastDashAt: -9, slamming: false };
  const w = CLASSES[S.cls].weapon;
  S.weapon = { ammo: magSize(), reloadEnd: 0, lastFire: 0 };
  S.nades = 0; S.maxNades = 0; S.lastThrow = 0; S.aimK = 0; S.respawnAt = 0;
  R.setViewmodel(S.cls);
  R.vmState.slamHold = false;
  $('crosshair').className = S.cls;
  $('weaponName').textContent = `${CLASSES[S.cls].name} · ${w.name}`;
  input.setAimButton(S.cls === 'melee' ? 'DASH' : S.cls === 'sniper' ? 'SCOPE' : 'AIM', S.cls !== 'melee');
  input.resetTouchToggles();
  $('tKnife').classList.toggle('hidden', S.cls !== 'melee');
  $('tNade').classList.toggle('hidden', S.settings.grenades === 'off');
  $('deathScreen').classList.add('hidden');
  if (touch) $('touch').classList.remove('hidden');
  else if (!input.locked) $('clickToPlay').classList.remove('hidden');
}

function showRespawnBox() {
  $('respawnBox').classList.remove('hidden');
  const wrap = $('respawnClasses');
  wrap.innerHTML = '';
  for (const c of allowedClasses(S.settings)) {
    const b = document.createElement('button');
    b.className = 'mini-btn' + (c === S.cls ? ' sel' : '');
    b.textContent = CLASSES[c].name;
    b.onclick = (e) => {
      e.stopPropagation();
      S.cls = c; store.set('sr_cls', c);
      send({ t: 'cfg', cls: c });
      wrap.querySelectorAll('.mini-btn').forEach((n) => n.classList.toggle('sel', n === b));
    };
    wrap.appendChild(b);
  }
  $('respawnShop').disabled = !shopAvailable();
}
$('respawnShop').addEventListener('click', (e) => { e.stopPropagation(); openShop(); });

// Rejoining a match in progress after a disconnect: rebuild our state from the server's copy.
function onResume(m) {
  buildWorld(m.seed);
  R.setPickups(m.pickups || []);
  R.clearNades(); S.nadeSims.clear();
  const pageSurvived = S.phase === 'playing' && S.inMatch && S.me && S.me.alive && m.alive;
  S.phase = 'playing'; S.inMatch = true;
  S.mut = m.mut || 'classic';
  const mu = mut(S.mut);
  $('mutPill').textContent = S.mut === 'classic' ? '' : `${mu.icon} ${mu.name}`;
  if (CLASSES[m.cls]) S.cls = m.cls;
  S.points = m.pts; S.up = m.up; S.locked = !!m.lk; S.myKills = m.kills; S.livesLeft = m.lives;
  S.streak = m.streak || 0; S.rewards = m.rewards || {}; S.jetFuel = m.jetFuel || 0;
  ['lobby', 'endScreen'].forEach((id) => $(id).classList.add('hidden'));
  $('hud').classList.remove('hidden');
  if (m.alive) {
    if (!pageSurvived) {
      spawnLocal(m.pos, m.yaw, m.kills);
      S.me.glide = !!m.glide;
      if (!m.glide) S.me.pitch = 0;
    }
    S.me.hp = m.hp; S.me.shield = m.shield; S.me.kills = m.kills;
    S.nades = m.nades; S.maxNades = m.maxNades;
  } else {
    S.me = { x: m.pos[0], y: m.pos[1], z: m.pos[2], vx: 0, vy: 0, vz: 0, alive: false, hp: 0, shield: 0, kills: m.kills, yaw: m.yaw, pitch: 0, eye: EYE_HEIGHT };
    S.nades = m.nades; S.maxNades = m.maxNades;
    $('touch').classList.add('hidden'); $('clickToPlay').classList.add('hidden');
    $('deathScreen').classList.remove('hidden');
    if (m.respawnIn > 0 || m.place === 0) {
      S.respawnAt = performance.now() / 1000 + m.respawnIn;
      $('deathTitle').textContent = 'KNOCKED OUT';
      $('deathSub').textContent = 'You reconnected while waiting to respawn.';
      showRespawnBox();
    } else {
      S.respawnAt = 0;
      $('deathTitle').textContent = 'ELIMINATED';
      $('deathSub').innerHTML = `You were knocked out while away — you placed <b>#${m.place}</b>`;
      $('respawnBox').classList.add('hidden');
    }
  }
  banner('📶 Reconnected — welcome back!');
}

function feedLine(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  $('killfeed').prepend(div);
  setTimeout(() => div.remove(), 6000);
  while ($('killfeed').children.length > 6) $('killfeed').lastChild.remove();
}

function onRespawn(m) {
  if (!S.inMatch) return;
  if (CLASSES[m.cls]) S.cls = m.cls;
  closeShop();
  spawnLocal(m.spawn, m.yaw, S.me ? S.me.kills : 0);
  S.livesLeft = m.lives;
  voice('respawn');
  flashCenter('Respawned!', m.lives >= 0 ? `${m.lives} respawn${m.lives === 1 ? '' : 's'} left` : 'Skydive back into the fight', 2.5);
}

// ------------------------------------------------------------------ snapshots & events
function onSnap(m) {
  S.zone = m.z; S.aliveCount = m.a; S.bountyId = m.b ?? null; S.locked = !!m.lk;
  R.syncTurrets(m.tu, (id) => (S.info.get(id) || { color: '#999999' }).color);
  R.setZone(m.z);
  const seen = new Set();
  for (const e of m.p) {
    const [id, x, y, z, yw, pt, cr, gl, alive, hp, sh, kills, sc, pend, dc, jet] = e;
    S.snap.set(id, { id, x, y, z, yaw: yw, pitch: pt, crouch: cr, glide: gl, alive, hp, shield: sh, kills, pending: pend, dc });
    seen.add(id);
    if (id === S.myId) {
      if (S.me && S.me.alive) { S.me.hp = hp; S.me.shield = sh; }
      if (S.me) S.me.kills = kills;
      continue;
    }
    const info = S.info.get(id);
    if (!info) continue;
    if (!alive) { R.removeAvatar(id); continue; }
    const a = R.ensureAvatar(info);
    a.target.set(x, y, z); a.targetYaw = yw; a.crouch = cr; a.glide = gl; a.pitch = pt; a.scope = sc; a.bounty = id === S.bountyId; a.dc = !!dc; a.jet = jet;
  }
  for (const id of [...R.avatars.keys()]) if (!seen.has(id)) R.removeAvatar(id);
  for (const id of [...S.snap.keys()]) if (!seen.has(id)) S.snap.delete(id);
}

function camPos() { return R.camera.position; }

function onFx(m) {
  if (m.k === 'shot') {
    R.addTracer(m.o, m.e, m.c);
    const d = camPos().distanceTo(new THREE.Vector3(...m.o));
    SFX.sfxShot(m.c, Math.max(0, 1 - d / (m.c === 'sniper' ? 450 : 220)) ** 1.5);
    const a = R.avatars.get(m.id); if (a) a.swingT = 0;
  } else if (m.k === 'swing') {
    R.addSwing(m.id, m.v);
    const a = R.avatars.get(m.id);
    if (m.v === 'throw' && m.o && m.e) R.throwKnife(m.o, m.e);
    if (m.v === 'slam' && a) { R.slamFx([a.pos.x, a.pos.y, a.pos.z]); SFX.sfxSlam(Math.max(0, 1 - a.pos.distanceTo(camPos()) / 40)); }
    else if (a) SFX.sfxSwing(Math.max(0, 1 - a.pos.distanceTo(camPos()) / 30), m.v === 'finisher' ? 0.7 : m.v === 'backhand' ? 1.25 : 1);
  }
}

const WEAPON_ICON = { sniper: '🔭', rifle: '🔫', melee: '🔪', throw: '🗡️', nade: '💣', turret: '🤖', strike: '✈️', zone: '☠️', left: '🚪' };
function onKill(m) {
  const k = m.k != null ? S.info.get(m.k) : null, v = S.info.get(m.v);
  const va = R.avatars.get(m.v);
  if (va && m.w !== 'left') {
    const p = va.pos.clone(); p.y += 1;
    R.burst(p, [va.color, '#ffffff', '#ffd60a', '#ff8fab', '#4cc9f0'], 50, 7, 1.6, 0.24);
    R.addPuff(p, 0xffffff, 0.6, 0.5);
  }
  const div = document.createElement('div');
  const nm = (p) => p ? `<b style="color:${p.color}">${esc(p.name)}</b>` : '';
  div.innerHTML = m.w === 'zone' ? `${nm(v)} ${WEAPON_ICON.zone} zone` : m.w === 'left' ? `${nm(v)} left the game`
    : !k && m.w === 'nade' ? `${nm(v)} 💣 own grenade`
    : `${nm(k)} ${WEAPON_ICON[m.w] || '💥'}${m.hs ? ' 🎯' : ''} ${nm(v)}${m.bounty ? ' 👑' : ''}`;
  $('killfeed').prepend(div);
  setTimeout(() => div.remove(), 6000);
  while ($('killfeed').children.length > 6) $('killfeed').lastChild.remove();
  if (m.k === S.myId && m.v !== S.myId) {
    SFX.sfxKill();
    killVoice({ first: S.myKills === 0, weapon: m.w, headshot: m.hs });
    S.myKills++;
    flashCenter(`Eliminated ${v ? esc(v.name) : ''}`, m.bounty ? '👑 BOUNTY CLAIMED! +150 🪙' : m.hs ? 'HEADSHOT!' : '', 2);
  } else if (m.bounty && k) banner(`👑 ${k.name} claimed the bounty on ${v ? v.name : '?'}`);
  if (m.v === S.myId && S.me) {
    S.me.alive = false; S.me.hp = 0; S.me.shield = 0; S.me.jet = false; S.jetFuel = 0;
    closeStrikeMap(); $('streakMenu').classList.add('hidden');
    closeShop();
    input.unlock();
    voice('eliminated');
    $('clickToPlay').classList.add('hidden');
    $('touch').classList.add('hidden');
    $('deathScreen').classList.remove('hidden');
    const by = m.w === 'zone' ? 'The zone got you.' : k ? `by ${nm(k)}` : m.w === 'nade' ? 'Oops, your own grenade.' : '';
    if (m.respawn > 0) {
      S.respawnAt = performance.now() / 1000 + m.respawn;
      $('deathTitle').textContent = 'KNOCKED OUT';
      $('deathSub').innerHTML = by + (m.lives >= 0 ? ` — ${m.lives} respawn${m.lives === 1 ? '' : 's'} left after this one` : '');
      showRespawnBox();
    } else {
      S.respawnAt = 0;
      $('deathTitle').textContent = 'ELIMINATED';
      $('deathSub').innerHTML = by + ` — you placed <b>#${m.place}</b>`;
      $('respawnBox').classList.add('hidden');
    }
    R.setArc(null);
    R.vmState.slamHold = false;
    S.specId = m.k != null && m.k !== S.myId ? m.k : null;
  }
}

function onHurt(m) {
  SFX.sfxHurt();
  const f = $('hurtFlash');
  f.style.transition = 'none'; f.style.opacity = Math.min(1, 0.3 + m.amt / 60);
  requestAnimationFrame(() => { f.style.transition = 'opacity .5s'; f.style.opacity = 0; });
  if (m.from && S.me) {
    const dx = m.from[0] - S.me.x, dz = m.from[1] - S.me.z;
    const fx = -Math.sin(S.me.yaw), fz = -Math.cos(S.me.yaw), rx = Math.cos(S.me.yaw), rz = -Math.sin(S.me.yaw);
    const ang = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
    const d = document.createElement('div');
    d.className = 'dmgdir'; d.style.transform = `rotate(${ang}rad)`;
    $('damageDirs').appendChild(d);
    setTimeout(() => d.remove(), 1000);
  }
}

function onHitMarker(m) {
  const h = $('hitmarker');
  h.className = ''; void h.offsetWidth;
  h.className = 'show' + (m.kill ? ' kill' : m.head ? ' head' : '');
  SFX.sfxHit(m.head);
  if (m.turret) { if (m.kill) flashCenter('🤖 Turret destroyed!', '', 1.2); return; }
  if (m.back) flashCenter('BACKSTAB!', '', 1);
  else if (m.kind && m.kind !== 'slash' && m.kind !== 'backhand') flashCenter({ finisher: 'FINISHER!', lunge: 'LUNGE!', slam: 'SLAM!', throw: 'KNIFE THROW!' }[m.kind], '', 0.8);
  const a = R.avatars.get(m.v);
  if (a) {
    const p = a.pos.clone(); p.y += m.head ? 1.7 : 1.1;
    R.burst(p, [a.color, '#ffffff'], 8, 3.5, 0.5, 0.14, 6);
    p.y += 0.6; p.x += (Math.random() - 0.5) * 0.6;
    showDmgNum(p, m.amt, m.kill ? 'kill' : m.head ? 'head' : '');
  }
  // Sniper passive: spot whoever you hit
  if (S.cls === 'sniper' && m.w === 'sniper') S.marks.set(m.v, performance.now() / 1000 + 6);
}

function showDmgNum(pos, amt, cls) {
  const sp = R.project(pos);
  if (!sp) return;
  const wrap = $('dmgNums');
  if (wrap.children.length > 14) wrap.firstChild.remove();
  const d = document.createElement('div');
  d.className = 'dmgnum ' + cls;
  d.textContent = amt;
  d.style.left = sp[0] + 'px'; d.style.top = sp[1] + 'px';
  wrap.appendChild(d);
  setTimeout(() => d.remove(), 800);
}

function banner(text) {
  const b = $('banner');
  b.textContent = text;
  b.className = ''; void b.offsetWidth; b.className = 'show';
}

function onBounty(m) {
  if (m.id === S.myId) banner('👑 You are the bounty! Everyone sees you on their minimap');
  else { const i = S.info.get(m.id); if (i) banner(`👑 ${i.name} is the bounty: +150 🪙 for taking them out`); }
}

// ------------------------------------------------------------------ grenades
function onNadeThrown(m) {
  S.nadeSims.set(m.id, { g: { x: m.o[0], y: m.o[1], z: m.o[2], vx: m.v[0], vy: m.v[1], vz: m.v[2] }, prev: { x: m.o[0], y: m.o[1], z: m.o[2] }, acc: 0, t: GRENADE.fuse });
  R.addNade(m.id);
  if (m.owner !== S.myId) {
    const d = camPos().distanceTo(new THREE.Vector3(...m.o));
    SFX.sfxThrow(Math.max(0, 1 - d / 40));
  }
}

function onBoom(m) {
  S.nadeSims.delete(m.id);
  R.removeNade(m.id);
  R.explode(m.p);
  const d = camPos().distanceTo(new THREE.Vector3(...m.p));
  SFX.sfxBoom(Math.max(0.05, 1 - d / 160));
  // knockback for the local player
  const me = S.me;
  if (me && me.alive && !me.glide) {
    const dx = me.x - m.p[0], dy = me.y + 1 - m.p[1], dz = me.z - m.p[2];
    const dist = Math.hypot(dx, dy, dz), R2 = GRENADE.radius * 1.3;
    if (dist < R2 && lineOfSight(S.world, m.p[0], m.p[1] + 0.25, m.p[2], me.x, me.y + 1, me.z)) {
      const push = (1 - dist / R2) * 14, L = Math.hypot(dx, dz) || 1;
      me.vx += dx / L * push; me.vz += dz / L * push; me.vy = Math.max(me.vy, push * 0.6);
    }
  }
}

function updateNades(dt) {
  for (const [id, n] of S.nadeSims) {
    n.acc += dt;
    while (n.acc >= NADE_DT) {
      n.prev.x = n.g.x; n.prev.y = n.g.y; n.prev.z = n.g.z;
      stepGrenade(S.world, n.g, NADE_DT, gScale());
      n.acc -= NADE_DT; n.t -= NADE_DT;
    }
    if (n.t < -1) { S.nadeSims.delete(id); R.removeNade(id); continue; } // lost the boom message
    const k = n.acc / NADE_DT;
    R.setNade(id, n.prev.x + (n.g.x - n.prev.x) * k, n.prev.y + (n.g.y - n.prev.y) * k, n.prev.z + (n.g.z - n.prev.z) * k, n.t);
  }
}

function nadeLaunch() {
  const me = S.me;
  R.camera.getWorldDirection(fwd);
  const r2 = (v) => Math.round(v * 100) / 100;
  let o = [me.x + fwd.x * 0.4, me.y + me.eye - 0.1 + fwd.y * 0.4, me.z + fwd.z * 0.4];
  const r = GRENADE.r;
  if (S.world.anyOverlap(o[0] - r, o[1] - r, o[2] - r, o[0] + r, o[1] + r, o[2] + r)) o = [me.x, me.y + me.eye - 0.1, me.z];
  const v = [fwd.x * GRENADE.speed + me.vx * 0.4, fwd.y * GRENADE.speed + GRENADE.lift + Math.max(0, me.vy) * 0.3, fwd.z * GRENADE.speed + me.vz * 0.4];
  return { o: o.map(r2), v: v.map(r2) };
}

function predictArc() {
  const { o, v } = nadeLaunch();
  const g = { x: o[0], y: o[1], z: o[2], vx: v[0], vy: v[1], vz: v[2] };
  const pts = [];
  for (let t = 0, i = 0; t < GRENADE.fuse; t += NADE_DT, i++) {
    stepGrenade(S.world, g, NADE_DT, gScale());
    if (i >= 2) pts.push(g.x, g.y, g.z); // skip the first dots so they don't fill the screen
  }
  R.setArc(pts, [g.x, g.y - GRENADE.r, g.z]);
}

function onPickup(m) {
  R.takePickup(m.id);
  if (m.by === S.myId) {
    SFX.sfxPickup(m.type);
    const label = { med: '+ Health', shield: '+ Shield', coin: 'Coins scavenged!', gem: 'Gem scavenged!', nade: '+1 Grenade', bag: 'Loot bag!', drop: '📦 SUPPLY DROP!' }[m.type];
    flashCenter(label, '', 1.2);
  }
}

function onEnd(m) {
  S.phase = 'ended';
  closeShop();
  input.unlock();
  ['clickToPlay', 'touch', 'deathScreen', 'scoreboard', 'respawnBox'].forEach((id) => $(id).classList.add('hidden'));
  S.respawnAt = 0;
  const me = m.winner === S.myId;
  $('endTitle').textContent = me ? '🏆 VICTORY ROYALE! 🏆' : m.name ? `🏆 ${m.name} wins!` : 'The bots win this round!';
  if (me) { SFX.sfxWin(); voice('victory'); }
  $('awards').innerHTML = (m.awards || []).map((a) =>
    `<div class="award"><div class="ai">${a.icon}</div><div class="at">${a.title}</div><div class="an" style="color:${a.color}">${esc(a.name)}</div><div class="av">${a.value}</div></div>`).join('');
  R.setArc(null);
  $('endTable').innerHTML = '<tr><th>#</th><th>Player</th><th>Class</th><th>Kills</th><th>Damage</th></tr>' + m.standings.map((p) =>
    `<tr><td>${p.place || '-'}</td><td><span class="swatch" style="background:${p.color}"></span>${esc(p.name)}</td><td>${CLASSES[p.cls].name}</td><td>${p.kills}</td><td>${p.dmg ?? ''}</td></tr>`).join('');
  $('endScreen').classList.remove('hidden');
}

// ------------------------------------------------------------------ local player
const fwd = new THREE.Vector3();

function updateLocal(dt) {
  const me = S.me, cls = CLASSES[S.cls], w = cls.weapon;
  const now = performance.now() / 1000;
  const [lx, ly] = input.takeLook();
  const zoomScale = R.camera.fov / BASE_FOV;
  me.yaw -= lx * zoomScale; me.pitch -= ly * zoomScale;
  me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch));

  const mv = input.moveVector();
  const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
  let wx = -sy * mv.y + cy * mv.x, wz = -cy * mv.y - sy * mv.x;

  // crouch (stay crouched if there's no head room)
  let crouching = input.crouch && !me.glide && !me.jet;
  if (!crouching && me.h < BODY_HEIGHT) {
    const r = 0.34;
    if (S.world.anyOverlap(me.x - r, me.y + CROUCH_HEIGHT, me.z - r, me.x + r, me.y + BODY_HEIGHT, me.z + r)) crouching = true;
  }
  me.h = crouching ? CROUCH_HEIGHT : BODY_HEIGHT;

  const reloading = S.weapon.reloadEnd > now;
  const wantAim = input.aim && S.cls !== 'melee' && !reloading && !me.glide;
  S.aimK += ((wantAim ? 1 : 0) - S.aimK) * Math.min(1, dt * (S.cls === 'sniper' ? 9 : 14));

  let speed = cls.speed * (1 + SPEED_UPGRADE * S.up.speed) * (mut(S.mut).speedMult || 1);
  const sprinting = input.sprint && mv.y > 0.3 && S.aimK < 0.3;
  if (sprinting) speed *= 1.3;
  if (crouching) speed *= 0.5;
  if (S.aimK > 0.5) speed *= 0.6;
  if (me.jet) speed *= JETPACK.speedMult;

  me.dashCd = Math.max(0, me.dashCd - dt);
  if (me.glide) {
    const k = Math.min(1, dt * 3);
    me.vx += (wx * GLIDE_MOVE_SPEED - me.vx) * k; me.vz += (wz * GLIDE_MOVE_SPEED - me.vz) * k;
  } else if (me.dashT > 0) {
    me.dashT -= dt;
    me.vx = me.dashX * cls.dash.speed; me.vz = me.dashZ * cls.dash.speed;
  } else {
    const k = Math.min(1, dt * (me.onGround || me.jet ? 14 : 3.5));
    me.vx += (wx * speed - me.vx) * k; me.vz += (wz * speed - me.vz) * k;
  }

  const jumpV = cls.jump * Math.sqrt(1 + JUMP_UPGRADE * S.up.jump);
  if (input.take('jump') && !me.glide) {
    if (me.jet) { me.jet = false; flashCenter('🚀 Jetpack off', '', 0.8); }
    else if (S.jetFuel > 0 && now - S.lastJumpPress < JETPACK.doubleTap) { // double-tap: take off
      me.jet = true; me.jetT = 0; me.vy = Math.max(me.vy, JETPACK.lift); me.slamming = false; SFX.sfxDash();
    } else if (me.onGround) { me.vy = jumpV; SFX.sfxJump(); }
    else if (cls.doubleJump && me.canDouble) { me.vy = jumpV * 0.9; me.canDouble = false; SFX.sfxJump(); }
    S.lastJumpPress = now;
  }
  if (me.jet) {
    me.jetT += dt;
    S.jetFuel = Math.max(0, S.jetFuel - dt);
    let target = me.jetT < JETPACK.liftTime ? JETPACK.lift : input.crouch ? -JETPACK.descend : 0;
    if (me.y > JETPACK.ceiling) target = Math.min(target, 0);
    me.vy += (target - me.vy) * Math.min(1, dt * 5);
    me.vy += GRAVITY * gScale() * dt; // cancels the gravity stepBody applies: hover
    if (S.jetFuel <= 0) { me.jet = false; flashCenter('🚀 Out of fuel!', 'Buy another tank in the shop', 1.5); }
  }
  const dashPressed = input.take('dash') | (S.cls === 'melee' && input.take('aimTap'));
  if (dashPressed && cls.dash && me.dashCd <= 0 && !me.glide) {
    let dx = wx, dz = wz;
    if (Math.hypot(dx, dz) < 0.1) { dx = -sy; dz = -cy; }
    const L = Math.hypot(dx, dz); me.dashX = dx / L; me.dashZ = dz / L;
    me.dashT = cls.dash.time; me.dashCd = cls.dash.cooldown; me.lastDashAt = now;
    me.vy = Math.max(me.vy, 2.5);
    SFX.sfxDash();
  }
  input.take('aimTap');

  const wasAir = !me.onGround, fallV = me.vy;
  stepBody(S.world, me, dt, me.glide ? GLIDE_FALL_SPEED : 0, gScale());
  if (me.slamming && (me.onGround || me.glide)) {
    me.slamming = false; R.vmState.slamHold = false;
    if (me.onGround) {
      send({ t: 'melee', k: 'slam' });
      R.slamFx([me.x, me.y, me.z]); R.vmFire('melee', 'slam');
      SFX.sfxSlam(1);
    }
  }
  if (me.jet && me.onGround && me.jetT > JETPACK.liftTime) me.jet = false; // landed
  if (me.onGround) {
    me.canDouble = true;
    if (me.glide) { me.glide = false; R.shake = 0.5; flashCenter('Landed!', 'Find loot and stay in the zone', 2); }
    else if (wasAir && fallV < -12) R.shake = Math.max(R.shake, Math.min(0.5, (-fallV - 12) / 20));
    const hs = Math.hypot(me.vx, me.vz);
    S.stepAcc += hs * dt;
    if (S.stepAcc > 2.3) { S.stepAcc = 0; SFX.sfxStep(crouching ? 0.02 : 0.06); }
    if (wasAir && me.vy === 0) SFX.sfxStep(0.1);
  }

  // shop
  if (input.take('shop')) S.shopOpen ? closeShop() : openShop();
  if (S.shopOpen) for (let i = 1; i <= SHOP_ITEMS.length; i++) if (input.take('buy' + i)) buy(SHOP_ITEMS[i - 1].id);
  // number keys outside the shop fire kill streak rewards
  if (!S.shopOpen) {
    for (const k of STREAKS) if (input.take('buy' + k.key)) useStreak(k.id);
    for (let i = 1; i <= 10; i++) input.take('buy' + i);
  }
  if (input.take('streakMenu')) toggleStreakMenu();

  // grenades: hold to aim (arc preview), release to throw
  const canNade = !me.glide && !S.shopOpen;
  if (input.nadeHeld && canNade && S.nades > 0) predictArc(); else R.setArc(null);
  if (input.take('nadeThrow') && canNade) {
    if (S.nades <= 0) flashCenter('No grenades', 'Find 💣 loot or buy them in the shop', 1.2);
    else if (now - S.lastThrow >= GRENADE.cooldown) {
      S.lastThrow = now;
      S.nades--;
      const { o, v } = nadeLaunch();
      send({ t: 'nade', o, v });
      SFX.sfxThrow(0.8);
    }
  }

  // knife throw
  if (input.take('knifeThrow') && S.cls === 'melee' && !me.glide) {
    if (now - S.lastKnifeThrow >= KNIFE.throw.cooldown) throwKnife(now);
    else flashCenter('Knife coming back…', '', 0.6);
  }

  // weapon
  S.bloom = Math.max(0, S.bloom - dt * 0.09);
  if (S.weapon.reloadEnd && now >= S.weapon.reloadEnd) { S.weapon.reloadEnd = 0; S.weapon.ammo = magSize(); }
  if (input.take('reload') && w.mag && S.weapon.ammo < magSize() && !reloading) startReload(now);
  if (input.fire && (w.auto || !S.fireLatch) && !me.glide && now - S.weapon.lastFire >= w.rate && !(S.weapon.reloadEnd > now)) {
    if (S.cls === 'melee') doMelee(now);
    else if (S.weapon.ammo > 0) doShoot(now, Math.hypot(me.vx, me.vz) > 1);
    else startReload(now);
    S.fireLatch = true;
  }
  if (!input.fire) S.fireLatch = false;

  // camera
  const eyeT = crouching ? CROUCH_EYE : EYE_HEIGHT;
  me.eye += (eyeT - me.eye) * Math.min(1, dt * 12);
  R.camera.position.set(me.x, me.y + me.eye, me.z);
  R.camera.rotation.set(me.pitch, me.yaw, 0);
  const kick = me.dashT > 0 ? 16 : sprinting && Math.hypot(me.vx, me.vz) > cls.speed ? 7 : 0;
  S.fovKick += (kick - S.fovKick) * Math.min(1, dt * 8);
  const fov = BASE_FOV + S.fovKick * (1 - S.aimK) + (w.zoomFov - BASE_FOV) * S.aimK;
  if (Math.abs(R.camera.fov - fov) > 0.01) { R.camera.fov = fov; R.camera.updateProjectionMatrix(); }

  // network
  S.sendT -= dt;
  if (S.sendT <= 0) {
    S.sendT = 0.05;
    send({ t: 'st', p: [+me.x.toFixed(2), +me.y.toFixed(2), +me.z.toFixed(2)], yw: +me.yaw.toFixed(3), pt: +me.pitch.toFixed(3), cr: crouching ? 1 : 0, gl: me.glide ? 1 : 0, sc: S.cls === 'sniper' && S.aimK > 0.6 ? 1 : 0,
      jp: me.jet ? 1 : 0, jf: Math.round(S.jetFuel * 10) / 10 });
  }
  return { moving: Math.hypot(me.vx, me.vz) > 1 && me.onGround, reloadK: reloadProgress(now, w), nadeAim: input.nadeHeld && canNade && S.nades > 0 };
}

function reloadProgress(now, w) {
  if (!(S.weapon.reloadEnd > now)) return 0;
  const t = 1 - (S.weapon.reloadEnd - now) / w.reload;
  return Math.sin(Math.min(1, t) * Math.PI);
}

function startReload(now) {
  const w = CLASSES[S.cls].weapon;
  if (!w.mag || S.weapon.reloadEnd > now) return;
  S.weapon.reloadEnd = now + w.reload;
  SFX.sfxReload();
}

function doShoot(now, moving) {
  const me = S.me, w = CLASSES[S.cls].weapon;
  S.weapon.lastFire = now;
  S.weapon.ammo--;
  let spread = w.spreadHip + (w.spreadAim - w.spreadHip) * S.aimK + S.bloom;
  if (w.bloom) S.bloom = Math.min(w.bloomMax, S.bloom + w.bloom);
  if (moving) spread *= 1.6;
  if (!me.onGround) spread *= 2;
  R.camera.getWorldDirection(fwd);
  fwd.x += (Math.random() - 0.5) * 2 * spread; fwd.y += (Math.random() - 0.5) * 2 * spread; fwd.z += (Math.random() - 0.5) * 2 * spread;
  fwd.normalize();
  const o = R.camera.position;
  let best = S.world.raycast(o.x, o.y, o.z, fwd.x, fwd.y, fwd.z, w.range);
  let hit = null, head = false;
  for (const [id, a] of R.avatars) {
    if (!a.root.visible) continue;
    const p = a.pos;
    const headY = p.y + (a.crouch ? 1.15 : 1.6);
    const th = raySphere(o.x, o.y, o.z, fwd.x, fwd.y, fwd.z, p.x, headY, p.z, 0.3);
    if (th >= 0 && th < best) { best = th; hit = id; head = true; }
    const tb = rayBox(o.x, o.y, o.z, fwd.x, fwd.y, fwd.z, { x0: p.x - 0.4, y0: p.y, z0: p.z - 0.4, x1: p.x + 0.4, y1: p.y + (a.crouch ? 1.0 : 1.42), z1: p.z + 0.4 });
    if (tb >= 0 && tb < best) { best = tb; hit = id; head = false; }
  }
  const [tBest, hitT] = rayTurrets(o, fwd, best);
  if (hitT != null) { best = tBest; hit = null; head = false; }
  const end = o.clone().addScaledVector(fwd, best);
  const right = new THREE.Vector3(Math.cos(me.yaw), 0, -Math.sin(me.yaw));
  const muzzle = o.clone().addScaledVector(fwd, 0.8).addScaledVector(right, 0.18 * (1 - S.aimK)).add(new THREE.Vector3(0, -0.12, 0));
  const r2 = (v) => Math.round(v * 100) / 100;
  send({ t: 'shot', o: [r2(muzzle.x), r2(muzzle.y), r2(muzzle.z)], e: [r2(end.x), r2(end.y), r2(end.z)], hit, head, hitT });
  R.addTracer(muzzle.toArray(), end.toArray(), S.cls);
  R.vmFire(S.cls);
  SFX.sfxShot(S.cls, 0.8);
  me.pitch += w.recoil * (1 - S.aimK * 0.4);
  me.yaw += (Math.random() - 0.5) * w.recoil * 0.5;
  if (S.weapon.ammo <= 0) startReload(now);
}

// Knife moveset: 3-hit combo (slash, backhand, spinning finisher), lunge right after a dash,
// and a ground slam when attacking while falling.
function doMelee(now) {
  const me = S.me, w = CLASSES.melee.weapon;
  S.weapon.lastFire = now;
  if (!me.onGround && me.vy < -KNIFE.slam.minFall && !me.slamming && now - S.lastSlam >= KNIFE.slam.cooldown) {
    me.slamming = true; me.vy = -KNIFE.slam.speed; S.lastSlam = now;
    R.vmState.slamHold = true;
    SFX.sfxSwing(0.9, 0.6);
    return;
  }
  let kind;
  if (now - me.lastDashAt < KNIFE.lungeWindow) kind = 'lunge';
  else {
    S.combo = now - S.comboLast < KNIFE.comboWindow ? (S.combo + 1) % 3 : 0;
    kind = ['slash', 'backhand', 'finisher'][S.combo];
  }
  S.comboLast = now;
  R.vmFire('melee', kind);
  SFX.sfxSwing(0.8, kind === 'finisher' ? 0.7 : kind === 'backhand' ? 1.25 : kind === 'lunge' ? 0.85 : 1);
  const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
  if (kind === 'lunge') { me.vx += fx * 6; me.vz += fz * 6; }
  let best = null, bd = (kind === 'lunge' ? KNIFE.lungeRange : w.range) + 0.4;
  for (const [id, a] of R.avatars) {
    if (!a.root.visible) continue;
    const dx = a.pos.x - me.x, dy = a.pos.y - me.y, dz = a.pos.z - me.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > bd) continue;
    const hd = Math.hypot(dx, dz) || 1;
    if ((dx * fx + dz * fz) / hd < 0.45 && d > 0.9) continue;
    if (!lineOfSight(S.world, me.x, me.y + me.eye, me.z, a.pos.x, a.pos.y + 1.0, a.pos.z)) continue;
    best = id; bd = d;
  }
  let hitT = null; // enemy turrets can be stabbed too
  for (const [id, t] of R.turrets) {
    if (t.owner === S.myId) continue;
    const p = t.root.position, d = Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z);
    if (d < bd && ((p.x - me.x) * fx + (p.z - me.z) * fz) / (Math.hypot(p.x - me.x, p.z - me.z) || 1) > 0.45) { hitT = id; best = null; bd = d; }
  }
  send({ t: 'melee', hit: best, k: kind, hitT });
}

// Distance and id of the closest enemy turret along a ray (if nearer than `best`).
function rayTurrets(o, d, best) {
  let hitT = null;
  for (const [id, t] of R.turrets) {
    if (t.owner === S.myId) continue;
    const p = t.root.position;
    const tb = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, { x0: p.x - 0.45, y0: p.y, z0: p.z - 0.45, x1: p.x + 0.45, y1: p.y + 1.3, z1: p.z + 0.45 });
    if (tb >= 0 && tb < best) { best = tb; hitT = id; }
  }
  return [best, hitT];
}

function throwKnife(now) {
  S.lastKnifeThrow = now;
  R.camera.getWorldDirection(fwd);
  const o = R.camera.position;
  let best = S.world.raycast(o.x, o.y, o.z, fwd.x, fwd.y, fwd.z, KNIFE.throw.range);
  let hit = null;
  for (const [id, a] of R.avatars) {
    const p = a.pos;
    const th = raySphere(o.x, o.y, o.z, fwd.x, fwd.y, fwd.z, p.x, p.y + (a.crouch ? 1.15 : 1.6), p.z, 0.3);
    if (th >= 0 && th < best) { best = th; hit = id; }
    const tb = rayBox(o.x, o.y, o.z, fwd.x, fwd.y, fwd.z, { x0: p.x - 0.4, y0: p.y, z0: p.z - 0.4, x1: p.x + 0.4, y1: p.y + (a.crouch ? 1.0 : 1.42), z1: p.z + 0.4 });
    if (tb >= 0 && tb < best) { best = tb; hit = id; }
  }
  const [tBest, hitT] = rayTurrets(o, fwd, best);
  if (hitT != null) { best = tBest; hit = null; }
  const r2 = (v) => Math.round(v * 100) / 100;
  const start = o.clone().addScaledVector(fwd, 0.6).add(new THREE.Vector3(0, -0.1, 0));
  const end = o.clone().addScaledVector(fwd, best);
  send({ t: 'melee', k: 'throw', hit, hitT, o: start.toArray().map(r2), e: end.toArray().map(r2) });
  R.throwKnife(start.toArray(), end.toArray());
  R.vmFire('melee', 'throw');
  SFX.sfxThrow(0.9);
}

// ------------------------------------------------------------------ spectating
function nextSpecTarget(after) {
  const alive = [...S.snap.values()].filter((p) => p.alive && p.id !== S.myId && R.avatars.has(p.id));
  if (!alive.length) return null;
  const i = alive.findIndex((p) => p.id === after);
  return alive[(i + 1) % alive.length].id;
}

function updateSpectator(dt) {
  if (S.respawnAt) {
    const left = Math.max(0, S.respawnAt - performance.now() / 1000);
    $('respawnTimer').textContent = left > 0.05 ? `Respawning in ${Math.ceil(left)}…` : 'Respawning…';
    // the shop works while you wait (upgrades only)
    if (input.take('shop')) S.shopOpen ? closeShop() : openShop();
    if (S.shopOpen) for (let i = 1; i <= SHOP_ITEMS.length; i++) if (input.take('buy' + i)) buy(SHOP_ITEMS[i - 1].id);
  }
  if (input.take('tap')) S.specId = nextSpecTarget(S.specId);
  const a = S.specId != null ? R.avatars.get(S.specId) : null;
  if (!a) {
    S.specId = nextSpecTarget(null);
    if (S.specId == null) { orbitCamera(dt); return; }
  }
  const t = R.avatars.get(S.specId);
  if (!t) return;
  const back = new THREE.Vector3(Math.sin(t.yaw), 0, Math.cos(t.yaw)).multiplyScalar(4.5);
  const want = t.pos.clone().add(back).add(new THREE.Vector3(0, 2.6, 0));
  R.camera.position.lerp(want, Math.min(1, dt * 6));
  R.camera.lookAt(t.pos.x, t.pos.y + 1.5, t.pos.z);
  if (R.camera.fov !== BASE_FOV) { R.camera.fov = BASE_FOV; R.camera.updateProjectionMatrix(); }
  const info = S.info.get(S.specId);
  $('specName').textContent = info ? info.name : '';
}

let orbitA = 0;
function orbitCamera(dt) {
  orbitA += dt * 0.05;
  R.camera.position.set(Math.cos(orbitA) * 190, 95, Math.sin(orbitA) * 190);
  R.camera.lookAt(0, 0, 0);
  if (R.camera.fov !== 60) { R.camera.fov = 60; R.camera.updateProjectionMatrix(); }
}

canvas.addEventListener('click', () => {
  SFX.unlockAudio();
  if (S.phase !== 'playing') return;
  if (S.me && S.me.alive) { if (!touch) input.lock(); }
  else input.pressed.add('tap');
});
$('clickToPlay').addEventListener('click', () => { SFX.unlockAudio(); input.lock(); });
document.addEventListener('pointerlockchange', () => {
  const show = !touch && !input.locked && !S.shopOpen && !S.strikeOpen && S.phase === 'playing' && S.me && S.me.alive;
  $('clickToPlay').classList.toggle('hidden', !show);
});

// ------------------------------------------------------------------ points & shop
function magSize() {
  const w = CLASSES[S.cls].weapon;
  return Math.round(w.mag * (1 + MAG_UPGRADE * (S.up.mag || 0)));
}

function onPoints(m) {
  S.points = m.pts;
  if (m.up) S.up = m.up;
  if (m.gain) {
    const why = { kill: 'elimination', coin: 'coins', gem: 'gem', med: 'scavenged', shield: 'scavenged', nade: 'scavenged', bag: 'loot bag', drop: 'supply drop', bounty: 'BOUNTY' }[m.why] || '';
    const pop = $('ptsPop');
    pop.textContent = `+${m.gain} 🪙 ${why}`;
    pop.className = ''; void pop.offsetWidth; pop.className = 'show';
  }
  if (m.bought) {
    const item = SHOP_ITEMS.find((i) => i.id === m.bought);
    $('shopMsg').textContent = '';
    if (m.bought === 'radar') S.radarUntil = performance.now() / 1000 + RADAR_TIME;
    if (m.bought === 'jetpack') { S.jetFuel = JETPACK.fuel; setTimeout(() => flashCenter('🚀 Jetpack ready!', 'Double-tap jump to fly · jump again to land · crouch to sink', 3), 1300); }
    SFX.sfxPickup(m.bought === 'med' ? 'med' : 'shield');
    flashCenter(`Bought ${item.icon} ${item.name}`, '', 1.2);
  }
  renderShop();
}

const itemCost = (it) => Math.round(it.cost * S.settings.prices);
function shopAvailable() {
  return S.inMatch && S.phase === 'playing' && S.settings.shop !== 'off' && !S.locked && S.me && (S.me.alive || S.respawnAt > 0);
}

function renderShop() {
  if (!S.shopOpen) return;
  $('shopPts').textContent = `🪙 ${S.points}`;
  const dead = !S.me || !S.me.alive;
  const wrap = $('shopItems');
  wrap.innerHTML = '';
  SHOP_ITEMS.forEach((it, i) => {
    const lvl = S.up[it.id] || 0;
    const maxed = it.max && lvl >= it.max;
    const blocked = it.notFor === S.cls || (it.id === 'nade' && S.settings.grenades === 'off');
    const needsAlive = dead && SHOP_NEEDS_ALIVE.includes(it.id);
    const cost = itemCost(it);
    const b = document.createElement('button');
    b.className = 'shop-item';
    b.disabled = maxed || blocked || needsAlive || S.points < cost;
    b.innerHTML = `<span class="key">${touch ? '' : (i + 1) % 10}</span>${it.max ? `<span class="lvl">${lvl}/${it.max}</span>` : ''}` +
      `<div class="ic">${it.icon}</div><div class="nm">${it.name}</div><div class="ds">${blocked ? 'Not available' : needsAlive ? 'Buy after you respawn' : it.desc}</div>` +
      `<div class="cost">${maxed ? 'MAXED' : `🪙 ${cost}`}</div>`;
    b.addEventListener('click', () => buy(it.id));
    wrap.appendChild(b);
  });
}

function buy(id) { send({ t: 'buy', item: id }); }

function openShop() {
  if (!shopAvailable()) {
    if (S.inMatch && S.me) flashCenter(S.settings.shop === 'off' ? 'Shop is off' : S.locked ? '🔒 Shop closed' : 'Shop unavailable', S.locked ? 'No shopping in the final circles' : '', 1.5);
    return;
  }
  S.shopOpen = true;
  $('shopMsg').textContent = '';
  input.fire = false;
  input.unlock();
  $('clickToPlay').classList.add('hidden');
  $('shop').classList.remove('hidden');
  renderShop();
}

function closeShop() {
  if (!S.shopOpen) return;
  S.shopOpen = false;
  $('shop').classList.add('hidden');
  if (!touch && S.phase === 'playing' && S.me && S.me.alive && !input.locked) $('clickToPlay').classList.remove('hidden');
}
$('shopClose').addEventListener('click', closeShop);
window.addEventListener('keydown', (e) => { if (e.code === 'Escape') closeShop(); });

// ------------------------------------------------------------------ kill streak rewards
function onStreak(m) {
  S.streak = m.n; S.rewards = m.rewards || {};
  if (m.unlocked) {
    const k = STREAKS.find((s) => s.id === m.unlocked);
    banner(`🔥 ${k.n} kill streak! ${k.icon} ${k.name} ready: ${touch ? 'tap ⭐' : `press ${k.key}`}`);
    SFX.sfxDrop();
  }
}

function useStreak(id) {
  const k = STREAKS.find((s) => s.id === id);
  if (!k || !S.me || !S.me.alive || S.me.glide) return;
  if (!(S.rewards[id] > 0)) { flashCenter(`${k.icon} ${k.name} locked`, `Get ${k.n} kills in a row to earn it`, 1.2); return; }
  $('streakMenu').classList.add('hidden');
  if (id === 'strike') { openStrikeMap(); return; }
  const msg = { t: 'streakUse', k: id };
  if (id === 'turret') {
    const me = S.me, r2 = (v) => Math.round(v * 100) / 100;
    msg.p = [me.x - Math.sin(me.yaw) * 2, me.y, me.z - Math.cos(me.yaw) * 2].map(r2);
  }
  send(msg);
}

function onStreakOn(m) {
  const now = performance.now() / 1000;
  if (m.k === 'radar') { S.radarUntil = now + m.time; flashCenter('📡 Radar online', `All enemies on your minimap for ${m.time} s`, 1.6); }
  if (m.k === 'wallhack') { S.wallhackUntil = now + m.time; flashCenter('👁️ X-Ray Vision', `See enemies through walls for ${m.time} s`, 1.6); }
  if (m.k === 'turret') flashCenter('🤖 Sentry turret deployed', 'It fires at enemies until destroyed', 1.6);
  if (m.k === 'strike') flashCenter('✈️ Airstrike called in!', '', 1.4);
  SFX.sfxPickup('shield');
}

function onStrike(m) {
  const secs = m.delay + AIRSTRIKE.bombs * AIRSTRIKE.interval + 0.5;
  R.strikeMarker(m.x, m.z, secs);
  S.strikes.push({ x: m.x, z: m.z, until: performance.now() / 1000 + secs });
  banner(m.owner === S.myId ? '✈️ Airstrike inbound!' : '⚠️ AIRSTRIKE INCOMING! Get out of the red zone!');
  [0, 0.35, 0.7, 1.05].forEach((d) => setTimeout(() => SFX.sfxZoneTick(), d * 1000));
}

function toggleStreakMenu() {
  const menu = $('streakMenu');
  if (!menu.classList.contains('hidden')) { menu.classList.add('hidden'); return; }
  menu.innerHTML = '';
  for (const k of STREAKS) {
    if (!(S.rewards[k.id] > 0)) continue;
    const b = document.createElement('button');
    b.textContent = `${k.icon} ${k.name}${S.rewards[k.id] > 1 ? ` ×${S.rewards[k.id]}` : ''}`;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); useStreak(k.id); });
    menu.appendChild(b);
  }
  if (menu.children.length) menu.classList.remove('hidden');
}

// Airstrike target picker: a big map with every player's position revealed.
const strikeCanvas = $('strikeCanvas');
function openStrikeMap() {
  S.strikeOpen = true;
  input.fire = false;
  input.unlock();
  $('clickToPlay').classList.add('hidden');
  $('strikeMap').classList.remove('hidden');
}
function closeStrikeMap() {
  if (!S.strikeOpen) return;
  S.strikeOpen = false;
  $('strikeMap').classList.add('hidden');
  if (!touch && S.phase === 'playing' && S.me && S.me.alive && !input.locked) $('clickToPlay').classList.remove('hidden');
}
strikeCanvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const r = strikeCanvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * MAP_HALF * 2 - MAP_HALF, z = ((e.clientY - r.top) / r.height) * MAP_HALF * 2 - MAP_HALF;
  send({ t: 'streakUse', k: 'strike', p: [Math.round(x * 10) / 10, Math.round(z * 10) / 10] });
  closeStrikeMap();
});
$('strikeCancel').addEventListener('click', closeStrikeMap);
window.addEventListener('keydown', (e) => { if (e.code === 'Escape') closeStrikeMap(); });
function drawStrikeMap() {
  if (!S.strikeOpen || !mmBase) return;
  const g = strikeCanvas.getContext('2d'), W = strikeCanvas.width, k = W / (MAP_HALF * 2);
  const X = (v) => (v + MAP_HALF) * k;
  g.drawImage(mmBase, 0, 0, W, W);
  const z = S.zone;
  if (z) { g.strokeStyle = '#ff3cac'; g.lineWidth = 3; g.beginPath(); g.arc(X(z.cx), X(z.cz), Math.max(0, z.r * k), 0, Math.PI * 2); g.stroke(); }
  g.font = 'bold 13px sans-serif'; g.textAlign = 'center';
  for (const p of S.snap.values()) {
    if (!p.alive) continue;
    const me = p.id === S.myId, info = S.info.get(p.id);
    g.fillStyle = me ? '#ffffff' : '#ff2d55'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.arc(X(p.x), X(p.z), me ? 7 : 6, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.fillText(me ? 'YOU' : info ? info.name : '?', X(p.x), X(p.z) - 10);
  }
  g.strokeStyle = 'rgba(255,45,85,.6)'; g.setLineDash([5, 4]); g.lineWidth = 2; // show the bomb spread
  g.beginPath(); g.arc(W - 30, 30, AIRSTRIKE.spread * k, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
}

// ------------------------------------------------------------------ minimap
let mmBase = null;
const MM = 400;
function buildMinimapBase() {
  mmBase = document.createElement('canvas');
  mmBase.width = mmBase.height = MM;
  const g = mmBase.getContext('2d');
  const k = MM / (MAP_HALF * 2);
  const X = (x) => (x + MAP_HALF) * k;
  g.fillStyle = '#7ed957'; g.fillRect(0, 0, MM, MM);
  for (const f of S.map.flats) { g.fillStyle = '#' + f.c.toString(16).padStart(6, '0'); g.fillRect(X(f.x0), X(f.z0), (f.x1 - f.x0) * k, (f.z1 - f.z0) * k); }
  g.fillStyle = '#2d9b4f';
  for (const t of S.map.trees) { g.beginPath(); g.arc(X(t.x), X(t.z), Math.max(1.5, t.r * k), 0, 7); g.fill(); }
  for (const b of S.map.buildings) {
    g.fillStyle = '#' + b.c.toString(16).padStart(6, '0');
    g.fillRect(X(b.x0), X(b.z0), (b.x1 - b.x0) * k, (b.z1 - b.z0) * k);
    g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1 + b.floors * 0.4;
    g.strokeRect(X(b.x0), X(b.z0), (b.x1 - b.x0) * k, (b.z1 - b.z0) * k);
  }
}

const mm = $('minimap'), mmg = mm.getContext('2d');
function drawMinimap() {
  if (!mmBase) return;
  const W = mm.width, k = W / (MAP_HALF * 2);
  const X = (x) => (x + MAP_HALF) * k;
  mmg.drawImage(mmBase, 0, 0, W, W);
  const z = S.zone;
  if (z) {
    mmg.fillStyle = 'rgba(241, 91, 181, 0.35)';
    mmg.beginPath(); mmg.rect(0, 0, W, W); mmg.arc(X(z.cx), X(z.cz), Math.max(0, z.r * k), 0, Math.PI * 2, true); mmg.fill();
    mmg.strokeStyle = '#ff3cac'; mmg.lineWidth = 2;
    mmg.beginPath(); mmg.arc(X(z.cx), X(z.cz), Math.max(0, z.r * k), 0, Math.PI * 2); mmg.stroke();
    if (z.st === 'wait') {
      mmg.strokeStyle = '#fff'; mmg.setLineDash([4, 3]);
      mmg.beginPath(); mmg.arc(X(z.tx), X(z.tz), Math.max(0, z.tr * k), 0, Math.PI * 2); mmg.stroke();
      mmg.setLineDash([]);
    }
  }
  const tNow = performance.now() / 1000;
  S.strikes = S.strikes.filter((s) => s.until > tNow);
  for (const s of S.strikes) {
    mmg.fillStyle = 'rgba(255,45,85,.45)'; mmg.beginPath(); mmg.arc(X(s.x), X(s.z), AIRSTRIKE.spread * k, 0, Math.PI * 2); mmg.fill();
  }
  for (const t of R.turrets.values()) {
    if (t.owner !== S.myId) continue;
    mmg.fillStyle = '#4cc9f0'; mmg.fillRect(X(t.root.position.x) - 3, X(t.root.position.z) - 3, 6, 6);
  }
  if (performance.now() / 1000 < S.radarUntil) {
    for (const p of S.snap.values()) {
      if (!p.alive || p.id === S.myId) continue;
      const i = S.info.get(p.id);
      mmg.fillStyle = i ? i.color : '#f00'; mmg.strokeStyle = '#000'; mmg.lineWidth = 1.5;
      mmg.beginPath(); mmg.arc(X(p.x), X(p.z), 4, 0, Math.PI * 2); mmg.fill(); mmg.stroke();
    }
  }
  // supply drops and loot bags
  for (const m of R.pickupMeshes.values()) {
    if (m.userData.taken || (m.userData.type !== 'drop' && m.userData.type !== 'bag')) continue;
    const drop = m.userData.type === 'drop';
    mmg.fillStyle = drop ? '#ff9e00' : '#b388ff'; mmg.strokeStyle = '#000'; mmg.lineWidth = 1.5;
    const sz = drop ? 6 + Math.sin(performance.now() / 150) : 3.5;
    mmg.fillRect(X(m.position.x) - sz / 2, X(m.position.z) - sz / 2, sz, sz);
    mmg.strokeRect(X(m.position.x) - sz / 2, X(m.position.z) - sz / 2, sz, sz);
  }
  // spotted enemies (sniper passive) and the bounty
  const nowS = performance.now() / 1000;
  for (const [id, until] of S.marks) {
    const p = S.snap.get(id);
    if (until < nowS || !p || !p.alive) { S.marks.delete(id); continue; }
    mmg.strokeStyle = '#ff2d55'; mmg.lineWidth = 2;
    mmg.beginPath(); mmg.arc(X(p.x), X(p.z), 5, 0, Math.PI * 2); mmg.stroke();
  }
  const bp = S.bountyId != null && S.bountyId !== S.myId ? S.snap.get(S.bountyId) : null;
  if (bp && bp.alive) {
    mmg.font = '14px serif'; mmg.textAlign = 'center'; mmg.textBaseline = 'middle';
    mmg.fillText('👑', X(bp.x), X(bp.z));
  }
  let px, pz, yaw;
  if (S.me && S.me.alive) { px = S.me.x; pz = S.me.z; yaw = S.me.yaw; }
  else if (S.specId != null && R.avatars.get(S.specId)) { const a = R.avatars.get(S.specId); px = a.pos.x; pz = a.pos.z; yaw = a.yaw; }
  if (px != null) {
    mmg.save();
    mmg.translate(X(px), X(pz)); mmg.rotate(-yaw);
    mmg.fillStyle = '#fff'; mmg.strokeStyle = '#000'; mmg.lineWidth = 1.5;
    mmg.beginPath(); mmg.moveTo(0, -8); mmg.lineTo(5, 6); mmg.lineTo(0, 3); mmg.lineTo(-5, 6); mmg.closePath(); mmg.fill(); mmg.stroke();
    mmg.restore();
  }
}

// ------------------------------------------------------------------ HUD
let centerT = 0;
function flashCenter(title, sub, secs) {
  $('centerMsg').innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
  centerT = secs;
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
let hudCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }

function updateHud(dt) {
  setText('aliveCount', `👥 ${S.aliveCount} alive`);
  const me = S.me;
  setText('killCount', `💀 ${me ? me.kills : 0}`);
  setText('pointsPill', `🪙 ${S.points}`);
  const z = S.zone;
  if (z) {
    const txt = z.st === 'wait' ? `Zone ${z.ph}/${z.n} shrinks in ${fmt(z.left)}` : z.st === 'shrink' ? `⚠ Zone closing ${fmt(z.left)}` : '⚠ Final zone';
    setText('zoneInfo', txt);
    $('zoneInfo').classList.toggle('warn', z.st !== 'wait');
  }
  if (me) {
    const hp = Math.max(0, me.hp), sh = Math.max(0, me.shield);
    $('hpFill').style.width = (hp / MAX_HP * 100) + '%';
    $('shieldFill').style.width = (sh / MAX_SHIELD * 100) + '%';
    setText('hpText', `❤ ${hp}`);
    setText('shieldText', `🛡 ${sh}`);
    const w = CLASSES[S.cls].weapon;
    const now = performance.now() / 1000;
    setText('ammo', S.cls === 'melee' ? '∞' : S.weapon.reloadEnd > now ? 'Reloading…' : `${S.weapon.ammo} / ${magSize()}`);
    if (S.cls === 'melee') {
      const thr = KNIFE.throw.cooldown - (now - S.lastKnifeThrow);
      setText('ability', `${me.dashCd > 0 ? `Dash ${me.dashCd.toFixed(1)}s` : `Dash ✓${touch ? '' : ' [E]'}`} · ${thr > 0 ? `Throw ${thr.toFixed(1)}s` : `Throw ✓${touch ? '' : ' [F]'}`}${S.combo > 0 && now - S.comboLast < KNIFE.comboWindow ? ` · Combo ${S.combo + 1}/3` : ''}`);
    } else setText('ability', '');
    setText('nadeCount', S.maxNades ? `💣 ${S.nades} / ${S.maxNades}${touch ? '' : '  [G]'}` : '');
    $('tShop').classList.toggle('hidden', !shopAvailable());
    setText('jetFuel', S.jetFuel > 0 ? `🚀 ${Math.ceil(S.jetFuel)} s fuel${me.jet ? ' · flying' : touch ? ' · double-tap JUMP' : ' · double-tap Space'}` : '');
    // kill streak bar: current streak + rewards ready to use
    const ready = STREAKS.filter((k) => S.rewards[k.id] > 0);
    const sk = `${S.streak}|${ready.map((k) => k.id + S.rewards[k.id]).join()}`;
    if (hudCache.streak !== sk) {
      hudCache.streak = sk;
      $('streakBar').innerHTML = (S.streak > 0 ? `<span class="streak-n">🔥 ${S.streak}</span>` : '') +
        ready.map((k) => `<span class="reward">${touch ? '' : `<kbd>${k.key}</kbd> `}${k.icon} ${k.name}${S.rewards[k.id] > 1 ? ` ×${S.rewards[k.id]}` : ''}</span>`).join('');
      $('tStreak').classList.toggle('hidden', !ready.length);
    }
    const xray = performance.now() / 1000 < S.wallhackUntil;
    if (xray) setText('ability', `👁️ X-Ray ${Math.ceil(S.wallhackUntil - performance.now() / 1000)} s`);
    $('nadeCount').classList.toggle('empty', S.nades <= 0);
    const outside = z && me.alive && !me.glide && Math.hypot(me.x - z.cx, me.z - z.cz) > z.r;
    $('zoneVignette').classList.toggle('on', !!outside);
    if (outside) {
      S.zoneTickT -= dt;
      if (S.zoneTickT <= 0) { S.zoneTickT = 1; SFX.sfxZoneTick(); }
      if (centerT <= 0) $('centerMsg').innerHTML = 'OUTSIDE THE ZONE!<small>Get back inside the circle</small>';
    } else if (centerT <= 0 && me.glide && me.alive) {
      $('centerMsg').innerHTML = `SKYDIVING<small>Altitude ${Math.round(me.y)} m — steer with ${touch ? 'the stick' : 'WASD'}</small>`;
    } else if (centerT <= 0) $('centerMsg').innerHTML = '';
    const scoped = S.cls === 'sniper' && S.aimK > 0.85 && me.alive;
    $('scope').classList.toggle('on', scoped);
    $('crosshair').style.display = scoped || !me.alive ? 'none' : '';
    $('crosshair').classList.toggle('wide', Math.hypot(me.vx, me.vz) > 1 && S.aimK < 0.5);
  } else {
    $('zoneVignette').classList.remove('on');
    $('scope').classList.remove('on');
    $('crosshair').style.display = 'none';
    if (centerT <= 0) $('centerMsg').innerHTML = '';
  }
  centerT -= dt;
  drawMinimap();
  drawStrikeMap();

  // scoreboard
  const sb = $('scoreboard');
  if (input.showScores && S.phase === 'playing') {
    sb.classList.remove('hidden');
    const rows = [...S.snap.values()].sort((a, b) => b.alive - a.alive || b.kills - a.kills);
    $('scoreTable').innerHTML = '<tr><th>Player</th><th>Class</th><th>Kills</th><th></th></tr>' + rows.map((p) => {
      const i = S.info.get(p.id) || { name: '?', cls: 'rifle', color: '#fff' };
      return `<tr class="${p.alive ? '' : 'dead'}"><td><span class="swatch" style="background:${i.color}"></span>${esc(i.name)}${p.id === S.myId ? ' (you)' : ''}</td><td>${CLASSES[i.cls].name}</td><td>${p.kills}</td><td>${p.dc ? '📶 ' : ''}${p.alive ? '' : p.pending ? '⏳' : '💀'}</td></tr>`;
    }).join('');
  } else sb.classList.add('hidden');
}

// ------------------------------------------------------------------ main loop
let last = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  let vm = null;
  if (S.phase === 'playing' && S.me && S.me.alive && S.world) {
    vm = updateLocal(dt);
  } else if ((S.phase === 'playing' || S.phase === 'ended') && S.world) {
    updateSpectator(dt);
  } else {
    orbitCamera(dt);
  }
  if (S.world) updateNades(dt);
  R.wallhack = S.phase === 'playing' && performance.now() / 1000 < S.wallhackUntil;
  const showVm = !!vm && !S.me.glide && !(S.cls === 'sniper' && S.aimK > 0.85);
  if (vm) R.updateViewmodel(dt, vm.moving, S.aimK, vm.reloadK, showVm, vm.nadeAim);
  if (S.phase !== 'lobby') updateHud(dt);
  R.render(dt, showVm);
}

if (params.has('debug')) Object.assign(window, { S, R, input });

buildClassCards();
connect();
requestAnimationFrame(frame);
