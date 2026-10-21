// Scavenger Royale LAN server. Zero dependencies: serves the game files over HTTP and runs the
// match over a tiny built-in WebSocket implementation. Start with `node server.js`.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';

import {
  CLASSES, MAX_PLAYERS, ZONE_PHASES, ZONE_START_RADIUS, PLAYER_COLORS, BOT_NAMES, MAX_HP, MAX_SHIELD,
  MEDKIT_HEAL, SHIELD_GAIN, DROP_HEIGHT, EYE_HEIGHT, BODY_HEIGHT, computeDamage, MAP_HALF,
  POINTS, SHOP_ITEMS, DMG_UPGRADE, GRENADE, MUTATORS, mut, BOT_SKILL, SUPPLY_DROP_EVERY, DROP_FALL_SPEED,
} from './public/shared/config.js';
import { generateMap } from './public/shared/map.js';
import { World, stepBody, stepGrenade, lineOfSight } from './public/shared/physics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, 'public');
const START_PORT = Number(process.env.PORT) || 3000;
const NO_OPEN = process.argv.includes('--no-open') || process.env.NO_OPEN;

// ------------------------------------------------------------------ HTTP
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

// ------------------------------------------------------------------ minimal WebSocket
class WsConn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frag = [];
    this.open = true;
    socket.setNoDelay(true);
    socket.on('data', (d) => { this.buf = Buffer.concat([this.buf, d]); this.parse(); });
    socket.on('close', () => this.closed());
    socket.on('error', () => this.closed());
  }
  closed() { if (this.open) { this.open = false; this.emit('close'); } }
  parse() {
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20) { this.socket.destroy(); return; }
      const need = off + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      let payload = this.buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = this.buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      this.buf = this.buf.subarray(need);
      if (op === 0x8) { this.sendFrame(0x8, Buffer.alloc(0)); this.socket.end(); this.closed(); return; }
      if (op === 0x9) { this.sendFrame(0xA, payload); continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x2 || op === 0x0) {
        this.frag.push(payload);
        if (fin) { const msg = Buffer.concat(this.frag).toString('utf8'); this.frag = []; this.emit('message', msg); }
      }
    }
  }
  sendFrame(op, data) {
    if (!this.open) return;
    const len = data.length;
    let header;
    if (len < 126) header = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | op; header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x80 | op; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
    this.socket.write(Buffer.concat([header, data]));
  }
  send(str) { this.sendFrame(0x1, Buffer.from(str, 'utf8')); }
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  onConnection(new WsConn(socket), req.socket.remoteAddress || '');
});

// ------------------------------------------------------------------ game state
const TICK = 1 / 20;
let nextId = 1;
const players = new Map();   // id -> player (humans and bots)
const game = {
  phase: 'lobby',            // lobby | playing | ended
  seed: newSeed(),
  map: null, world: null,
  bots: 3,
  hostId: null,
  zone: null,
  pickups: [],
  startedWith: 0,
  endAt: 0,
  time: 0,
  mutator: 'random',         // host's choice (or 'random')
  mut: 'classic',            // the mutator actually in play
  botSkill: 'normal',
  nades: [],
  nextNadeId: 1,
  nextPickupId: 0,
  nextDropAt: 0,
  bountyId: null,
};
const session = new Map();   // name -> { name, wins, kills, games } for this server run
const M = () => mut(game.mut);
buildMap();

function newSeed() { return (Math.random() * 0xffffffff) >>> 0; }
function buildMap() {
  const t = Date.now();
  game.map = generateMap(game.seed);
  game.world = new World(game.map.boxes);
  console.log(`  Map generated (seed ${game.seed}, ${game.map.boxes.length} solids) in ${Date.now() - t} ms`);
}

const humans = () => [...players.values()].filter((p) => !p.isBot);
const inMatch = () => [...players.values()].filter((p) => p.inMatch);
const aliveList = () => [...players.values()].filter((p) => p.inMatch && p.alive);

function freeColor() {
  const used = new Set([...players.values()].map((p) => p.color));
  return PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[nextId % PLAYER_COLORS.length];
}

function makePlayer(fields) {
  return {
    id: nextId++, name: 'Player', cls: 'rifle', color: freeColor(), isBot: false, ws: null,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: 0, glide: 0,
    hp: MAX_HP, shield: 0, alive: false, inMatch: false, kills: 0, place: 0,
    lastShot: 0, joinedAt: Date.now(), points: 0, up: newUpgrades(), nades: 0, lastNade: 0, scope: 0,
    stats: newStats(), ...fields,
  };
}

function newUpgrades() { return { dmg: 0, speed: 0, jump: 0, mag: 0 }; }
function newStats() { return { dmg: 0, longest: 0, earned: 0, nadeKills: 0 }; }
const dmgMult = (p) => (1 + DMG_UPGRADE * p.up.dmg) * (M().dmgMult || 1);
const maxNades = (p) => CLASSES[p.cls].grenades.max;

function givePoints(p, n, why) {
  if (p.isBot || !n) return;
  n = Math.round(n * (M().pointsMult || 1));
  p.points += n;
  p.stats.earned += n;
  send(p, { t: 'pts', pts: p.points, up: p.up, gain: n, why });
}

function sendInv(p) { send(p, { t: 'inv', nades: p.nades, max: maxNades(p) }); }

function onBuy(p, id) {
  const item = SHOP_ITEMS.find((i) => i.id === id);
  if (!item || !p.inMatch || !p.alive) return;
  const fail = (msg) => send(p, { t: 'shopfail', msg });
  if (item.notFor === p.cls) return fail(`${item.name} doesn't work with your class`);
  if (item.max && (p.up[id] || 0) >= item.max) return fail(`${item.name} is already maxed`);
  if (id === 'med' && p.hp >= MAX_HP) return fail('Health is already full');
  if ((id === 'shield' || id === 'bigshield') && p.shield >= MAX_SHIELD) return fail('Shield is already full');
  if (id === 'nade' && p.nades >= maxNades(p)) return fail(`You can only carry ${maxNades(p)} grenades`);
  if (p.points < item.cost) return fail(`Need ${item.cost - p.points} more points`);
  p.points -= item.cost;
  if (id === 'med') p.hp = Math.min(MAX_HP, p.hp + MEDKIT_HEAL);
  else if (id === 'shield') p.shield = Math.min(MAX_SHIELD, p.shield + SHIELD_GAIN);
  else if (id === 'bigshield') p.shield = MAX_SHIELD;
  else if (id === 'nade') { p.nades++; sendInv(p); }
  else if (item.max) p.up[id] = (p.up[id] || 0) + 1;
  send(p, { t: 'pts', pts: p.points, up: p.up, gain: 0, bought: id });
}

function send(p, msg) { if (p.ws) p.ws.send(JSON.stringify(msg)); }
function broadcast(msg, except) {
  const s = JSON.stringify(msg);
  for (const p of players.values()) if (p.ws && p !== except) p.ws.send(s);
}

function pickHost() {
  const h = humans().sort((a, b) => a.joinedAt - b.joinedAt);
  game.hostId = h.length ? h[0].id : null;
}

function lobbyState() {
  return {
    t: 'lobby', phase: game.phase, seed: game.seed, host: game.hostId, bots: game.bots,
    mutator: game.mutator, botSkill: game.botSkill,
    session: [...session.values()].sort((a, b) => b.wins - a.wins || b.kills - a.kills).slice(0, 8),
    players: [...players.values()].map((p) => ({ id: p.id, name: p.name, cls: p.cls, color: p.color, bot: p.isBot, inMatch: p.inMatch })),
  };
}

// ------------------------------------------------------------------ connections
function onConnection(ws, addr) {
  let me = null;
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!me) {
      if (m.t !== 'hello') return;
      if (humans().length >= MAX_PLAYERS) { ws.send(JSON.stringify({ t: 'full' })); ws.socket.end(); return; }
      me = makePlayer({ ws, name: cleanName(m.name), cls: CLASSES[m.cls] ? m.cls : 'rifle' });
      players.set(me.id, me);
      if (game.hostId == null) pickHost();
      console.log(`  + ${me.name} joined from ${addr.replace('::ffff:', '')}`);
      send(me, { t: 'welcome', id: me.id, addresses: lanAddresses(), port: actualPort });
      if (game.phase !== 'lobby') {
        send(me, { t: 'start', seed: game.seed, spectator: true, mut: game.mut, pickups: game.pickups.map(pickupWire) });
      }
      broadcast(lobbyState());
      return;
    }
    handle(me, m);
  });
  ws.on('close', () => {
    if (!me) return;
    console.log(`  - ${me.name} left`);
    if (me.inMatch && me.alive) killPlayer(me, null, 'left');
    players.delete(me.id);
    if (game.hostId === me.id) pickHost();
    if (humans().length === 0) resetToLobby();
    broadcast(lobbyState());
  });
}

function cleanName(n) {
  n = String(n || '').replace(/[<>&"']/g, '').trim().slice(0, 16);
  return n || 'Player' + Math.floor(Math.random() * 100);
}

function handle(p, m) {
  switch (m.t) {
    case 'cfg':
      if (game.phase === 'lobby' || !p.inMatch) {
        if (m.name != null) p.name = cleanName(m.name);
        if (m.cls && CLASSES[m.cls]) p.cls = m.cls;
        broadcast(lobbyState());
      }
      break;
    case 'bots':
      if (p.id === game.hostId && game.phase === 'lobby') { game.bots = Math.max(0, Math.min(7, m.n | 0)); broadcast(lobbyState()); }
      break;
    case 'opts':
      if (p.id === game.hostId && game.phase === 'lobby') {
        if (m.mutator === 'random' || MUTATORS[m.mutator]) game.mutator = m.mutator;
        if (BOT_SKILL[m.botSkill]) game.botSkill = m.botSkill;
        broadcast(lobbyState());
      }
      break;
    case 'start':
      if (p.id === game.hostId && game.phase === 'lobby') startMatch();
      break;
    case 'st':
      if (!p.inMatch || !p.alive || !Array.isArray(m.p)) break;
      p.x = +m.p[0] || 0; p.y = +m.p[1] || 0; p.z = +m.p[2] || 0;
      p.yaw = +m.yw || 0; p.pitch = +m.pt || 0; p.crouch = m.cr ? 1 : 0; p.glide = m.gl ? 1 : 0; p.scope = m.sc ? 1 : 0;
      break;
    case 'shot': onShot(p, m); break;
    case 'melee': onMelee(p, m); break;
    case 'nade': onNade(p, m); break;
    case 'buy': onBuy(p, String(m.item)); break;
    case 'chat': if (typeof m.s === 'string') broadcast({ t: 'chat', id: p.id, s: m.s.slice(0, 120) }); break;
  }
}

// ------------------------------------------------------------------ combat
function onShot(p, m) {
  if (!p.inMatch || !p.alive || p.glide || p.cls === 'melee') return;
  const w = CLASSES[p.cls].weapon;
  const now = game.time;
  if (now - p.lastShot < w.rate * 0.5) return;
  p.lastShot = now;
  if (Array.isArray(m.o) && Array.isArray(m.e)) broadcast({ t: 'fx', k: 'shot', id: p.id, c: p.cls, o: m.o, e: m.e }, p);
  if (m.hit == null) return;
  const v = players.get(m.hit);
  if (!v || v === p || !v.inMatch || !v.alive) return;
  const dist = Math.hypot(v.x - p.x, v.y - p.y, v.z - p.z);
  if (dist > w.range + 8) return;
  const head = !!m.head;
  const dmg = computeDamage(p.cls, dist, head, false) * dmgMult(p) * (head ? M().headMult || 1 : 1);
  if (applyDamage(v, Math.round(dmg), p, p.cls, head)) p.stats.longest = Math.max(p.stats.longest, Math.round(dist));
}

function onMelee(p, m) {
  if (!p.inMatch || !p.alive || p.glide || p.cls !== 'melee') return;
  const w = CLASSES.melee.weapon;
  const now = game.time;
  if (now - p.lastShot < w.rate * 0.6) return;
  p.lastShot = now;
  broadcast({ t: 'fx', k: 'swing', id: p.id }, p);
  if (m.hit == null) return;
  const v = players.get(m.hit);
  if (!v || v === p || !v.inMatch || !v.alive) return;
  const dist = Math.hypot(v.x - p.x, v.y - p.y, v.z - p.z);
  if (dist > w.range + 1.6) return;
  const back = isBehind(v, p);
  applyDamage(v, Math.round(computeDamage('melee', dist, false, back) * dmgMult(p)), p, 'melee', false, back);
  lifesteal(p);
}

function lifesteal(p) {
  const ls = CLASSES[p.cls].lifesteal;
  if (ls && p.alive) p.hp = Math.min(MAX_HP, p.hp + ls);
}

// ------------------------------------------------------------------ grenades
function onNade(p, m) {
  if (!p.inMatch || !p.alive || p.glide || p.nades <= 0) return;
  if (game.time - p.lastNade < GRENADE.cooldown * 0.8) return;
  if (!Array.isArray(m.o) || !Array.isArray(m.v)) return;
  let o = m.o.map((n) => +n || 0), v = m.v.map((n) => +n || 0);
  if (Math.hypot(o[0] - p.x, o[1] - p.y - EYE_HEIGHT, o[2] - p.z) > 3) o = [p.x, p.y + EYE_HEIGHT, p.z];
  const sp = Math.hypot(v[0], v[1], v[2]), maxSp = GRENADE.speed + GRENADE.lift + 14;
  if (sp > maxSp) v = v.map((n) => n * maxSp / sp);
  p.nades--; p.lastNade = game.time;
  sendInv(p);
  throwNade(p, o, v);
}

function throwNade(p, o, v) {
  const g = { id: game.nextNadeId++, owner: p.id, x: o[0], y: o[1], z: o[2], vx: v[0], vy: v[1], vz: v[2], t: GRENADE.fuse };
  game.nades.push(g);
  broadcast({ t: 'nade', id: g.id, owner: p.id, o, v });
}

function updateNades(dt) {
  for (let i = game.nades.length - 1; i >= 0; i--) {
    const g = game.nades[i];
    stepGrenade(game.world, g, dt, M().gravity || 1);
    g.t -= dt;
    if (g.t <= 0) { game.nades.splice(i, 1); explode(g); }
  }
}

function explode(g) {
  broadcast({ t: 'boom', id: g.id, p: [r2(g.x), r2(g.y), r2(g.z)] });
  const owner = players.get(g.owner) || null;
  const R = GRENADE.radius;
  for (const v of aliveList()) {
    const cy = v.y + 1.0;
    const d = Math.hypot(v.x - g.x, cy - g.y, v.z - g.z);
    if (d > R) continue;
    // walls block the blast (check chest and head so ducking behind a car helps but isn't perfect)
    if (!lineOfSight(game.world, g.x, g.y + 0.25, g.z, v.x, cy, v.z) && !lineOfSight(game.world, g.x, g.y + 0.25, g.z, v.x, v.y + 1.6, v.z)) continue;
    let dmg = GRENADE.maxDamage + (GRENADE.minDamage - GRENADE.maxDamage) * (d / R);
    if (owner === v) dmg *= GRENADE.selfMult;
    else if (owner) dmg *= dmgMult(owner) * (owner.isBot ? BOT_SKILL[game.botSkill].dmg : 1);
    const killed = applyDamage(v, Math.round(dmg), owner && owner !== v ? owner : null, 'nade', false, false, [g.x, g.z]);
    if (killed && owner && owner !== v) owner.stats.nadeKills++;
  }
}

function isBehind(victim, attacker) {
  const fx = -Math.sin(victim.yaw), fz = -Math.cos(victim.yaw);
  let ax = attacker.x - victim.x, az = attacker.z - victim.z;
  const L = Math.hypot(ax, az) || 1; ax /= L; az /= L;
  return fx * ax + fz * az < -0.4;
}

function applyDamage(v, amount, attacker, weapon, head = false, backstab = false, from = null) {
  if (!v.alive) return false;
  const resist = CLASSES[v.cls].resist;
  if (resist && weapon !== 'zone') amount = Math.round(amount * resist);
  let rest = amount;
  if (v.shield > 0) { const a = Math.min(v.shield, rest); v.shield -= a; rest -= a; }
  v.hp -= rest;
  const killed = v.hp <= 0;
  if (attacker) attacker.stats.dmg += amount;
  send(v, { t: 'hurt', amt: amount, from: from || (attacker ? [attacker.x, attacker.z] : null), w: weapon });
  if (attacker) send(attacker, { t: 'hitm', v: v.id, head, kill: killed, back: backstab, amt: amount, w: weapon });
  if (killed) killPlayer(v, attacker, weapon, head);
  return killed;
}

function killPlayer(v, killer, weapon, head = false) {
  v.alive = false; v.hp = 0;
  v.place = aliveList().length + 1;
  const wasBounty = game.bountyId === v.id;
  if (killer && killer !== v) {
    killer.kills++;
    givePoints(killer, POINTS.kill, 'kill');
    if (wasBounty) givePoints(killer, POINTS.bounty, 'bounty');
    if (!killer.isBot) sessionEntry(killer).kills++;
  }
  broadcast({ t: 'kill', k: killer ? killer.id : null, v: v.id, w: weapon, hs: head, place: v.place, bounty: wasBounty });
  // the fallen drop a loot bag: some of their points plus a grenade
  if (weapon !== 'left' && game.phase === 'playing') {
    addPickup('bag', v.x, Math.max(0, v.y), v.z, { value: 40 + Math.floor(v.points * 0.5), nades: v.nades > 0 ? 1 : 0 });
  }
  checkEnd();
}

function sessionEntry(p) {
  if (!session.has(p.name)) session.set(p.name, { name: p.name, wins: 0, kills: 0, games: 0 });
  return session.get(p.name);
}

// ------------------------------------------------------------------ dynamic pickups (loot bags, supply drops)
function pickupWire(pk) {
  const fall = pk.landAt ? Math.max(0, r2(pk.landAt - game.time)) : 0;
  return [pk.id, pk.type, r2(pk.x), r2(pk.y), r2(pk.z), pk.taken ? 1 : 0, fall];
}

function addPickup(type, x, y, z, extra = {}) {
  const pk = { id: game.nextPickupId++, type, x, y, z, taken: false, ...extra };
  game.pickups.push(pk);
  broadcast({ t: 'pkadd', list: [pickupWire(pk)] });
  return pk;
}

function spawnSupplyDrop() {
  const z = game.zone;
  const cx = z.stage === 'wait' ? z.tx : z.cx, cz = z.stage === 'wait' ? z.tz : z.cz;
  const r = Math.max(4, (z.stage === 'wait' ? z.tr : z.r) * 0.6);
  for (let tries = 0; tries < 12; tries++) {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
    const x = Math.max(-MAP_HALF + 8, Math.min(MAP_HALF - 8, cx + Math.cos(a) * d));
    const zz = Math.max(-MAP_HALF + 8, Math.min(MAP_HALF - 8, cz + Math.sin(a) * d));
    const top = 90;
    const y = top - game.world.raycast(x, top, zz, 0, -1, 0, top);
    if (game.world.anyOverlap(x - 0.8, y + 0.05, zz - 0.8, x + 0.8, y + 1.5, zz + 0.8)) continue;
    const pk = addPickup('drop', x, y, zz, { landAt: game.time + (top - y) / DROP_FALL_SPEED });
    broadcast({ t: 'drop', x: r2(x), z: r2(zz) });
    return pk;
  }
}

// ------------------------------------------------------------------ match flow
function startMatch() {
  const hs = humans();
  if (!hs.length) return;
  // remove leftover bots and add new ones
  for (const p of [...players.values()]) if (p.isBot) players.delete(p.id);
  const ids = Object.keys(MUTATORS);
  game.mut = game.mutator === 'random' ? ids[Math.floor(Math.random() * ids.length)] : game.mutator;
  const nb = Math.min(game.bots, MAX_PLAYERS - hs.length);
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
  const clsList = ['sniper', 'rifle', 'melee'];
  for (let i = 0; i < nb; i++) {
    const b = makePlayer({ isBot: true, name: names[i] + ' (bot)', cls: clsList[i % 3] });
    b.ai = { goal: null, goalT: 0, target: null, think: 0, react: 0, stuckT: 0, lastX: 0, lastZ: 0, detour: 0, dx: 0, dz: 0, nadeT: 4 + Math.random() * 6 };
    players.set(b.id, b);
  }
  const all = [...players.values()];
  const R = 140;
  const startAngle = Math.random() * Math.PI * 2;
  all.forEach((p, i) => {
    const C = CLASSES[p.cls];
    p.inMatch = true; p.alive = true; p.hp = MAX_HP; p.shield = C.startShield || 0; p.kills = 0; p.place = 0; p.lastShot = 0;
    p.points = 0; p.up = newUpgrades(); p.stats = newStats(); p.scope = 0; p.lastNade = 0; p.nadeAcc = 0;
    p.nades = M().fullNades ? C.grenades.max : C.grenades.start;
    if (!p.isBot) sessionEntry(p).games++;
    if (p.isBot) {
      const spots = game.map.spawnSpots;
      const s = spots[Math.floor(Math.random() * spots.length)];
      Object.assign(p, { x: s[0], y: 0, z: s[1], vx: 0, vy: 0, vz: 0, h: BODY_HEIGHT, onGround: true, glide: 0 });
    } else {
      const a = startAngle + (i / all.length) * Math.PI * 2;
      p.x = Math.cos(a) * R; p.z = Math.sin(a) * R; p.y = DROP_HEIGHT; p.glide = 1;
      p.yaw = Math.atan2(p.x, p.z); // face the centre
    }
  });
  game.startedWith = all.length;
  // pickups
  const spots = [...game.map.pickupSpots].sort(() => Math.random() - 0.5).slice(0, 140);
  const lootType = () => { const r = Math.random(); return r < 0.27 ? 'med' : r < 0.49 ? 'shield' : r < 0.6 ? 'nade' : r < 0.86 ? 'coin' : 'gem'; };
  game.pickups = spots.map((s, i) => ({ id: i, type: lootType(), x: s[0], y: s[1], z: s[2], taken: false }));
  game.nextPickupId = game.pickups.length;
  game.nades = [];
  game.bountyId = null;
  game.nextDropAt = 50;
  // zone
  game.zone = { cx: 0, cz: 0, r: ZONE_START_RADIUS, fx: 0, fz: 0, fr: ZONE_START_RADIUS, tx: 0, tz: 0, tr: 0, idx: 0, stage: 'wait', t: 0 };
  pickZoneTarget();
  game.phase = 'playing';
  game.time = 0;
  console.log(`  Match started: ${hs.length} player(s), ${nb} bot(s), mutator: ${M().name}`);
  const pk = game.pickups.map(pickupWire);
  for (const p of all) {
    if (p.isBot) continue;
    send(p, { t: 'start', seed: game.seed, spawn: [p.x, p.y, p.z], yaw: p.yaw, pickups: pk, spectator: false, mut: game.mut });
    send(p, { t: 'pts', pts: 0, up: p.up, gain: 0 });
    sendInv(p);
  }
  broadcast(lobbyState());
}

function pickZoneTarget() {
  const z = game.zone, ph = ZONE_PHASES[z.idx];
  const maxOff = Math.max(0, Math.min(z.r, MAP_HALF) - ph.r);
  const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * maxOff * 0.85;
  let tx = z.cx + Math.cos(a) * d, tz = z.cz + Math.sin(a) * d;
  const lim = MAP_HALF - ph.r - 5;
  if (lim > 0) { tx = Math.max(-lim, Math.min(lim, tx)); tz = Math.max(-lim, Math.min(lim, tz)); } else { tx = 0; tz = 0; }
  z.tx = tx; z.tz = tz; z.tr = ph.r;
  z.fx = z.cx; z.fz = z.cz; z.fr = z.r;
}

function updateZone(dt) {
  const z = game.zone;
  if (!z || z.idx >= ZONE_PHASES.length) return;
  const ph = ZONE_PHASES[z.idx];
  z.t += dt;
  if (z.stage === 'wait') {
    if (z.t >= ph.wait) { z.stage = 'shrink'; z.t = 0; }
  } else {
    const k = Math.min(1, z.t / ph.shrink);
    z.cx = z.fx + (z.tx - z.fx) * k; z.cz = z.fz + (z.tz - z.fz) * k; z.r = z.fr + (z.tr - z.fr) * k;
    if (k >= 1) {
      if (z.idx < ZONE_PHASES.length - 1) { z.idx++; z.stage = 'wait'; z.t = 0; pickZoneTarget(); }
      else { z.stage = 'closed'; }
    }
  }
}

function zoneInfo() {
  const z = game.zone;
  const ph = ZONE_PHASES[Math.min(z.idx, ZONE_PHASES.length - 1)];
  const left = z.stage === 'wait' ? ph.wait - z.t : z.stage === 'shrink' ? ph.shrink - z.t : 0;
  return { cx: r2(z.cx), cz: r2(z.cz), r: r2(z.r), tx: r2(z.tx), tz: r2(z.tz), tr: r2(z.tr), st: z.stage, left: Math.max(0, Math.round(left)), ph: z.idx + 1, n: ZONE_PHASES.length };
}
const r2 = (v) => Math.round(v * 100) / 100;

function zoneDps() {
  const z = game.zone;
  return ZONE_PHASES[Math.min(z.idx, ZONE_PHASES.length - 1)].dps;
}

function checkEnd() {
  if (game.phase !== 'playing') return;
  const alive = aliveList();
  if (game.startedWith <= 1) { if (!alive.length) endMatch(null); return; } // solo practice
  if (alive.length <= 1) return endMatch(alive[0] || null);
  if (!alive.some((p) => !p.isBot)) endMatch(null); // every human is out: the bots win
}

function endMatch(winner) {
  game.phase = 'ended';
  if (winner) winner.place = 1;
  for (const p of aliveList()) p.place = 1;
  const ps = inMatch();
  const standings = ps.sort((a, b) => (a.place || 99) - (b.place || 99) || b.kills - a.kills)
    .map((p) => ({ id: p.id, name: p.name, cls: p.cls, color: p.color, kills: p.kills, place: p.place, dmg: p.stats.dmg }));
  if (winner && !winner.isBot) sessionEntry(winner).wins++;
  const best = (key, min, fmt) => {
    const top = ps.reduce((a, p) => (p.stats[key] > (a ? a.stats[key] : 0) ? p : a), null);
    return top && top.stats[key] >= min ? { name: top.name, color: top.color, value: fmt(top.stats[key]) } : null;
  };
  const awards = [
    ['💥', 'Damage Dealer', best('dmg', 1, (v) => `${v} damage`)],
    ['🎯', 'Longest Shot', best('longest', 25, (v) => `${v} m`)],
    ['🪙', 'Scavenger King', best('earned', 1, (v) => `${v} points`)],
    ['💣', 'Demolition', best('nadeKills', 1, (v) => `${v} grenade kill${v > 1 ? 's' : ''}`)],
  ].filter((a) => a[2]).map(([icon, title, a]) => ({ icon, title, ...a }));
  broadcast({ t: 'end', winner: winner ? winner.id : null, name: winner ? winner.name : null, standings, awards });
  console.log(`  Match over. Winner: ${winner ? winner.name : 'nobody'}`);
  game.endAt = Date.now() + 10000;
}

function resetToLobby() {
  for (const p of [...players.values()]) {
    if (p.isBot) players.delete(p.id);
    else { p.inMatch = false; p.alive = false; }
  }
  game.phase = 'lobby';
  game.zone = null;
  game.seed = newSeed();
  buildMap();
  broadcast(lobbyState());
}

// ------------------------------------------------------------------ bots
const BOT_SIGHT = { sniper: 170, rifle: 90, melee: 70 };

function updateBot(b, dt) {
  const ai = b.ai, z = game.zone, w = game.world;
  ai.think -= dt;
  if (ai.think <= 0) {
    ai.think = 0.4 + Math.random() * 0.3;
    // nearest visible enemy
    let best = null, bd = BOT_SIGHT[b.cls];
    for (const o of players.values()) {
      if (o === b || !o.inMatch || !o.alive || o.glide) continue;
      const d = Math.hypot(o.x - b.x, o.z - b.z);
      if (d > bd) continue;
      if (!lineOfSight(w, b.x, b.y + EYE_HEIGHT, b.z, o.x, o.y + 1.3, o.z)) continue;
      best = o; bd = d;
    }
    if (best && ai.target !== best.id) ai.react = (0.7 + Math.random() * 0.6) * BOT_SKILL[game.botSkill].react;
    ai.target = best ? best.id : null;
  }
  const t = ai.target != null ? players.get(ai.target) : null;
  const zr = z.stage === 'wait' ? z.tr : z.r;
  const zcx = z.stage === 'wait' ? z.tx : z.cx, zcz = z.stage === 'wait' ? z.tz : z.cz;
  const outside = Math.hypot(b.x - z.cx, b.z - z.cz) > z.r - 4;

  // choose where to go
  let gx, gz, speed = CLASSES[b.cls].speed * 0.9;
  if (outside) { gx = z.cx; gz = z.cz; }
  else if (t && t.alive) {
    const d = Math.hypot(t.x - b.x, t.z - b.z);
    if (b.cls === 'melee') { gx = t.x; gz = t.z; }
    else if (b.cls === 'rifle') {
      if (d > 35) { gx = t.x; gz = t.z; } else { // strafe
        const a = Math.atan2(t.z - b.z, t.x - b.x) + Math.PI / 2 * (Math.sin(game.time * 0.7 + b.id) > 0 ? 1 : -1);
        gx = b.x + Math.cos(a) * 5; gz = b.z + Math.sin(a) * 5;
      }
    } else { gx = b.x; gz = b.z; speed = 0; if (d < 25) { gx = b.x * 2 - t.x; gz = b.z * 2 - t.z; speed = CLASSES.sniper.speed; } }
  } else {
    ai.goalT -= dt;
    if (!ai.goal || ai.goalT <= 0 || Math.hypot(ai.goal[0] - b.x, ai.goal[1] - b.z) < 3 ||
        Math.hypot(ai.goal[0] - zcx, ai.goal[1] - zcz) > zr) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * Math.max(5, zr * 0.75);
      ai.goal = [zcx + Math.cos(a) * d, zcz + Math.sin(a) * d];
      ai.goalT = 12 + Math.random() * 10;
    }
    [gx, gz] = ai.goal;
  }
  let dx = gx - b.x, dz = gz - b.z;
  const L = Math.hypot(dx, dz);
  if (L > 0.5) { dx /= L; dz /= L; } else { dx = 0; dz = 0; }
  // unstick
  ai.stuckT += dt;
  if (ai.stuckT > 1) {
    const moved = Math.hypot(b.x - ai.lastX, b.z - ai.lastZ);
    if (moved < 0.6 && speed > 0 && L > 2) {
      ai.detour = 1.2;
      const a = Math.random() * Math.PI * 2; ai.dx = Math.cos(a); ai.dz = Math.sin(a);
      if (b.onGround) b.vy = CLASSES[b.cls].jump;
    }
    ai.stuckT = 0; ai.lastX = b.x; ai.lastZ = b.z;
  }
  if (ai.detour > 0) { ai.detour -= dt; dx = ai.dx; dz = ai.dz; }
  speed *= M().speedMult || 1;
  b.vx = dx * speed; b.vz = dz * speed;
  stepBody(w, b, dt, 0, M().gravity || 1);

  b.scope = b.cls === 'sniper' && t && t.alive ? 1 : 0; // sniper bots glint while aiming
  // face target or movement direction
  if (t && t.alive) {
    b.yaw = Math.atan2(-(t.x - b.x), -(t.z - b.z));
    b.pitch = Math.atan2(t.y + 1.3 - (b.y + EYE_HEIGHT), Math.hypot(t.x - b.x, t.z - b.z));
  } else if (dx || dz) b.yaw = Math.atan2(-dx, -dz);

  // attack
  ai.react -= dt;
  if (!t || !t.alive || ai.react > 0) return;
  const skill = BOT_SKILL[game.botSkill];
  // lob a grenade now and then at mid range
  ai.nadeT -= dt * skill.nades;
  const dn = Math.hypot(t.x - b.x, t.z - b.z);
  if (b.nades > 0 && ai.nadeT <= 0 && dn > 7 && dn < 30) {
    ai.nadeT = 7 + Math.random() * 8;
    const T = Math.max(0.7, Math.min(1.6, dn / 14)), G = 22 * (M().gravity || 1);
    const o = [b.x, b.y + EYE_HEIGHT, b.z];
    const tx = t.x + (Math.random() - 0.5) * 3 / skill.aim, tz = t.z + (Math.random() - 0.5) * 3 / skill.aim;
    b.nades--;
    throwNade(b, o, [(tx - o[0]) / T, (t.y + 0.3 - o[1] + 0.5 * G * T * T) / T, (tz - o[2]) / T]);
    return;
  }
  const wp = CLASSES[b.cls].weapon;
  if (game.time - b.lastShot < wp.rate * (b.cls === 'rifle' ? 2.2 : 1.4)) return;
  const d3 = Math.hypot(t.x - b.x, t.y - b.y, t.z - b.z);
  if (b.cls === 'melee') {
    if (d3 > wp.range) return;
    b.lastShot = game.time;
    broadcast({ t: 'fx', k: 'swing', id: b.id });
    const back = isBehind(t, b);
    applyDamage(t, Math.round(computeDamage('melee', d3, false, back) * skill.dmg * (M().dmgMult || 1)), b, 'melee', false, back);
    lifesteal(b);
    return;
  }
  if (d3 > wp.range) return;
  if (!lineOfSight(w, b.x, b.y + EYE_HEIGHT, b.z, t.x, t.y + 1.3, t.z)) { ai.target = null; return; }
  b.lastShot = game.time;
  // snipers are clumsy up close (no time to scope), rifles lose accuracy with range
  const chance = (b.cls === 'sniper' ? (d3 < 20 ? 0.22 : 0.5 - d3 / 700) : 0.42 - d3 / 260) * skill.aim;
  const hit = Math.random() < Math.max(0.06, chance) * (t.crouch ? 0.8 : 1);
  const head = hit && Math.random() < (b.cls === 'sniper' ? 0.05 : 0.12);
  const o = [r2(b.x), r2(b.y + EYE_HEIGHT - 0.2), r2(b.z)];
  const e = hit ? [r2(t.x), r2(t.y + (head ? 1.6 : 1.0)), r2(t.z)]
    : [r2(t.x + (Math.random() - 0.5) * 3), r2(t.y + Math.random() * 2.5), r2(t.z + (Math.random() - 0.5) * 3)];
  broadcast({ t: 'fx', k: 'shot', id: b.id, c: b.cls, o, e });
  if (hit) applyDamage(t, Math.round(computeDamage(b.cls, d3, head, false) * skill.dmg * (M().dmgMult || 1) * (head ? M().headMult || 1 : 1)), b, b.cls, head);
}

// ------------------------------------------------------------------ main loop
setInterval(() => {
  const dt = TICK;
  if (game.phase === 'playing') {
    game.time += dt;
    updateZone(dt * (M().zoneSpeed || 1));
    updateNades(dt);
    if (game.time >= game.nextDropAt && game.zone.stage !== 'closed') { spawnSupplyDrop(); game.nextDropAt = game.time + SUPPLY_DROP_EVERY; }
    // bounty: the outright kill leader (2+ kills) is marked for everyone
    const leader = aliveList().reduce((a, p) => (p.kills > (a ? a.kills : 1) ? p : a), null);
    const tied = leader && aliveList().some((p) => p !== leader && p.kills === leader.kills);
    const bounty = leader && !tied ? leader.id : null;
    if (bounty !== game.bountyId) {
      game.bountyId = bounty;
      if (bounty) broadcast({ t: 'bounty', id: bounty });
    }
    const z = game.zone;
    const dps = zoneDps();
    for (const p of aliveList()) {
      if (p.isBot) updateBot(p, dt);
      if (!p.alive) continue;
      // Boom Town mutator: grenades recharge
      if (M().nadeRefill && p.nades < maxNades(p)) {
        p.nadeAcc += dt;
        if (p.nadeAcc >= M().nadeRefill) { p.nadeAcc = 0; p.nades++; sendInv(p); }
      }
      // zone damage
      if (Math.hypot(p.x - z.cx, p.z - z.cz) > z.r && !p.glide) {
        p.zoneAcc = (p.zoneAcc || 0) + dps * dt;
        if (p.zoneAcc >= 1) {
          const a = Math.floor(p.zoneAcc); p.zoneAcc -= a;
          p.hp -= a;
          send(p, { t: 'hurt', amt: a, from: null, w: 'zone' });
          if (p.hp <= 0) killPlayer(p, null, 'zone');
        }
      }
      // pickups
      for (const pk of game.pickups) {
        if (pk.taken || Math.abs(pk.y - p.y) > 1.5 || Math.hypot(pk.x - p.x, pk.z - p.z) > (pk.type === 'drop' ? 2 : 1.4)) continue;
        if (pk.landAt && game.time < pk.landAt) continue;
        if (pk.type === 'med' && p.hp >= MAX_HP) continue;
        if (pk.type === 'shield' && p.shield >= MAX_SHIELD) continue;
        if (pk.type === 'nade' && p.nades >= maxNades(p)) continue;
        pk.taken = true;
        if (pk.type === 'med') p.hp = Math.min(MAX_HP, p.hp + MEDKIT_HEAL);
        else if (pk.type === 'shield') p.shield = Math.min(MAX_SHIELD, p.shield + SHIELD_GAIN);
        else if (pk.type === 'nade') { p.nades++; sendInv(p); }
        else if (pk.type === 'bag' && pk.nades && p.nades < maxNades(p)) { p.nades++; sendInv(p); }
        else if (pk.type === 'drop') {
          p.hp = Math.min(MAX_HP, p.hp + 50); p.shield = MAX_SHIELD;
          p.nades = Math.min(maxNades(p), p.nades + 2); sendInv(p);
        }
        givePoints(p, pk.type === 'bag' ? pk.value : POINTS[pk.type] || POINTS.loot, pk.type);
        broadcast({ t: 'pk', id: pk.id, by: p.id, type: pk.type });
      }
    }
  }
  if (game.phase === 'playing' || game.phase === 'ended') {
    const snap = {
      t: 's',
      z: game.zone ? zoneInfo() : null,
      a: aliveList().length,
      b: game.bountyId,
      p: inMatch().map((p) => [p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.yaw), r2(p.pitch), p.crouch, p.glide, p.alive ? 1 : 0, Math.max(0, Math.ceil(p.hp)), Math.ceil(p.shield), p.kills, p.scope]),
    };
    broadcast(snap);
  }
  if (game.phase === 'ended' && Date.now() > game.endAt) resetToLobby();
}, TICK * 1000);

// ------------------------------------------------------------------ startup
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal && !/^169\.254\./.test(a.address)) out.push({ name, address: a.address });
    }
  }
  // Prefer typical home-LAN ranges first.
  out.sort((a, b) => score(b.address) - score(a.address));
  return out.map((a) => a.address);
  function score(ip) { return ip.startsWith('192.168.') ? 3 : ip.startsWith('10.') ? 2 : ip.startsWith('172.') ? 1 : 0; }
}

let actualPort = START_PORT;
function listen(port, triesLeft) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && triesLeft > 0) { listen(port + 1, triesLeft - 1); }
    else { console.error('Could not start server:', err.message); process.exit(1); }
  });
  server.listen(port, '0.0.0.0', () => {
    actualPort = port;
    const ips = lanAddresses();
    const line = '='.repeat(60);
    console.log(`\n${line}\n  SCAVENGER ROYALE server is running!\n${line}`);
    console.log(`  On this computer:  http://localhost:${port}`);
    if (ips.length) {
      console.log(`  Friends on the same Wi-Fi/LAN join at:`);
      for (const ip of ips) console.log(`      http://${ip}:${port}`);
    } else console.log('  (No LAN address found - are you connected to a network?)');
    console.log(`\n  Keep this window open while playing. Press Ctrl+C to stop.\n${line}\n`);
    if (!NO_OPEN) openBrowser(`http://localhost:${port}`);
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

listen(START_PORT, 10);
