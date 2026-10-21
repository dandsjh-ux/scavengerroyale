// Shared game constants used by both the server (Node) and the browser client.

export const MAP_SIZE = 360;            // metres, square map centred on the origin
export const MAP_HALF = MAP_SIZE / 2;
export const MAX_PLAYERS = 8;

export const GRAVITY = 22;
export const STEP_HEIGHT = 0.45;
export const BODY_RADIUS = 0.35;
export const BODY_HEIGHT = 1.8;
export const CROUCH_HEIGHT = 1.25;
export const EYE_HEIGHT = 1.6;
export const CROUCH_EYE = 1.05;

export const DROP_HEIGHT = 150;         // skydive start altitude
export const GLIDE_FALL_SPEED = 11;
export const GLIDE_MOVE_SPEED = 17;

export const MAX_HP = 100;
export const MAX_SHIELD = 100;

export const CLASSES = {
  sniper: {
    name: 'Sniper',
    desc: 'Slow, but deadly from across the map. Right-click to scope.',
    passive: 'Spotter: enemies you hit appear on your minimap for 6 s. Careful, your scope glints!',
    speed: 5.0,
    grenades: { start: 1, max: 2 },
    jump: 7.0,
    color: '#8e5cff',
    weapon: {
      name: 'Longshot', damage: 95, headMult: 2.6, rate: 1.35, range: 600,
      falloffStart: 9999, mag: 5, reload: 2.6, spreadHip: 0.06, spreadAim: 0.0,
      auto: false, zoomFov: 16, recoil: 0.07,
    },
    stats: { speed: 1, range: 5, damage: 5 },
  },
  rifle: {
    name: 'Rifle',
    desc: 'All-rounder. Full-auto, best at medium range. Right-click to aim.',
    passive: 'Armored: starts every match with 50 shield. Fire in bursts to stay accurate.',
    speed: 6.6,
    startShield: 50,
    grenades: { start: 2, max: 3 },
    jump: 7.2,
    color: '#ff8a1f',
    weapon: {
      name: 'Blaster AR', damage: 18, headMult: 1.8, rate: 0.1, range: 220,
      falloffStart: 55, mag: 30, reload: 1.9, spreadHip: 0.032, spreadAim: 0.009,
      auto: true, zoomFov: 50, recoil: 0.012, bloom: 0.0045, bloomMax: 0.03,
    },
    stats: { speed: 3, range: 3, damage: 3 },
  },
  melee: {
    name: 'Melee',
    desc: 'Knife. Very fast, double jump + dash (E / right-click). Backstabs do double.',
    passive: 'Lifesteal +15 HP per hit, takes 15% less damage, carries the most grenades.',
    speed: 9.6,
    lifesteal: 15,
    resist: 0.85,
    grenades: { start: 3, max: 6 },
    jump: 8.0,
    color: '#ff3c8e',
    doubleJump: true,
    dash: { speed: 26, time: 0.18, cooldown: 2.2 },
    weapon: {
      name: 'Neon Knife', damage: 55, headMult: 1, backstabMult: 2, rate: 0.42, range: 2.7,
      falloffStart: 9999, mag: 0, reload: 0, spreadHip: 0, spreadAim: 0,
      auto: true, zoomFov: 75, recoil: 0,
    },
    stats: { speed: 5, range: 1, damage: 4 },
  },
};

// Damage for one hit. dist in metres.
export function computeDamage(cls, dist, head, backstab) {
  const w = CLASSES[cls].weapon;
  let d = w.damage;
  if (head) d *= w.headMult;
  if (backstab && w.backstabMult) d *= w.backstabMult;
  if (dist > w.falloffStart) {
    const t = Math.min(1, (dist - w.falloffStart) / (w.range - w.falloffStart));
    d *= 1 - 0.5 * t;
  }
  return Math.round(d);
}

// Zone timeline. Each phase: wait (s) with the next circle shown, then shrink (s) to radius r.
// dps = damage per second while outside the safe zone during this phase.
export const ZONE_PHASES = [
  { wait: 75, shrink: 60, r: 170, dps: 1 },
  { wait: 60, shrink: 50, r: 110, dps: 2 },
  { wait: 50, shrink: 45, r: 65, dps: 4 },
  { wait: 40, shrink: 35, r: 32, dps: 7 },
  { wait: 30, shrink: 30, r: 12, dps: 10 },
  { wait: 20, shrink: 25, r: 0, dps: 15 },
];
export const ZONE_START_RADIUS = MAP_HALF * 1.45;

export const PLAYER_COLORS = [
  '#ff4d6d', '#3ddc97', '#4cc9f0', '#ffd60a', '#b388ff', '#ff9e00', '#f15bb5', '#00f5d4',
];

export const BOT_NAMES = ['Bubbles', 'Ziggy', 'Pixel', 'Nova', 'Taco', 'Sprout', 'Gizmo', 'Mango', 'Waffles'];

export const MEDKIT_HEAL = 40;
export const SHIELD_GAIN = 50;

// ---------- points & shop ----------
// Points ("coins") come from kills and from scavenging valuables found inside buildings.
export const POINTS = { kill: 100, coin: 20, gem: 50, loot: 10, drop: 150, bounty: 150 };

export const SHOP_ITEMS = [
  { id: 'med', name: 'Medkit', icon: '❤️', desc: '+40 health', cost: 60 },
  { id: 'shield', name: 'Shield Cell', icon: '🛡️', desc: '+50 shield', cost: 80 },
  { id: 'bigshield', name: 'Mega Shield', icon: '💠', desc: 'Shield to full 100', cost: 150 },
  { id: 'dmg', name: 'Power Core', icon: '💥', desc: '+20% weapon damage', cost: 200, max: 2 },
  { id: 'speed', name: 'Turbo Shoes', icon: '👟', desc: '+12% move speed', cost: 150, max: 2 },
  { id: 'jump', name: 'Spring Boots', icon: '🦘', desc: '+30% jump height', cost: 100, max: 1 },
  { id: 'mag', name: 'Extended Mag', icon: '📦', desc: '+50% magazine size', cost: 120, max: 1, notFor: 'melee' },
  { id: 'radar', name: 'Radar Ping', icon: '📡', desc: 'All enemies on your minimap for 12 s', cost: 120 },
  { id: 'nade', name: 'Grenade', icon: '💣', desc: '+1 grenade (up to your class max)', cost: 50 },
];
export const DMG_UPGRADE = 0.2, SPEED_UPGRADE = 0.12, JUMP_UPGRADE = 0.3, MAG_UPGRADE = 0.5;
export const RADAR_TIME = 12;

// ---------- grenades ----------
export const GRENADE = {
  fuse: 2.4,          // seconds from throw to explosion
  radius: 7.5,        // blast radius (m)
  maxDamage: 100,     // at the centre
  minDamage: 15,      // at the edge
  selfMult: 0.5,      // your own grenades hurt you less
  speed: 18,          // throw speed
  lift: 3.5,          // extra upward velocity on throw
  bounce: 0.4,
  friction: 0.7,
  r: 0.15,
  cooldown: 0.8,
};

// ---------- match mutators (host picks one, or random) ----------
export const MUTATORS = {
  classic: { name: 'Classic', icon: '⭐', desc: 'Standard rules.' },
  moon: { name: 'Moon Jump', icon: '🌙', desc: 'Low gravity: huge jumps and floaty grenades.', gravity: 0.45 },
  rush: { name: 'Rush Hour', icon: '⏩', desc: 'The zone moves twice as fast.', zoneSpeed: 2 },
  gold: { name: 'Gold Rush', icon: '💰', desc: 'All points are doubled. Go shopping!', pointsMult: 2 },
  boom: { name: 'Boom Town', icon: '💣', desc: 'Start with max grenades and get a new one every 10 s.', nadeRefill: 10, fullNades: true },
  speed: { name: 'Speed Demons', icon: '⚡', desc: 'Everyone moves 30% faster.', speedMult: 1.3 },
  glass: { name: 'Glass Cannons', icon: '🔥', desc: 'All weapon damage +60%.', dmgMult: 1.6 },
  heads: { name: 'Headhunters', icon: '🎯', desc: 'Headshots deal +50% extra damage.', headMult: 1.5 },
};
export const mut = (id) => MUTATORS[id] || MUTATORS.classic;

export const BOT_SKILL = {
  easy: { name: 'Easy', aim: 0.6, react: 1.6, dmg: 0.55, nades: 0.4 },
  normal: { name: 'Normal', aim: 1, react: 1, dmg: 0.75, nades: 1 },
  hard: { name: 'Hard', aim: 1.45, react: 0.6, dmg: 0.95, nades: 1.6 },
};

export const SUPPLY_DROP_EVERY = 75; // seconds between supply drops
export const DROP_FALL_SPEED = 6;
