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
  { wait: 80, shrink: 40, r: 235, dps: 1 },  // wide first circle: the map edges stay safe at the start
  { wait: 50, shrink: 50, r: 170, dps: 1 },
  { wait: 55, shrink: 50, r: 110, dps: 2 },
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
  { id: 'jetpack', name: 'Jetpack', icon: '🚀', desc: '30 s of flight. Double-tap jump to fly, jump again to land', cost: 500 },
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

// ---------- knife moveset ----------
export const KNIFE = {
  comboWindow: 0.9,      // seconds between swings to keep a combo going
  finisherMult: 1.35,    // 3rd hit of a combo
  lungeMult: 1.4,        // attack right after a dash
  lungeWindow: 0.45,
  lungeRange: 4.2,
  slam: { damage: 50, radius: 3.4, minFall: 5, cooldown: 1.5, speed: 26 }, // attack while falling: ground slam
  throw: { damage: 40, range: 32, cooldown: 4 },                           // F / 🗡️ button
};

// ---------- respawns ----------
export const RESPAWN_DROP_HEIGHT = 70;
// Shop items that only make sense while you're alive (upgrades can be bought while waiting to respawn).
export const SHOP_NEEDS_ALIVE = ['med', 'shield', 'bigshield', 'nade', 'radar', 'jetpack'];

// ---------- jetpack (shop) ----------
export const JETPACK = {
  fuel: 30,          // seconds of flight per tank
  lift: 7,           // climb speed right after take-off (m/s)
  liftTime: 1.4,     // seconds of climbing before it settles into a hover
  descend: 6,        // crouch to sink
  speedMult: 1.25,   // horizontal speed while flying
  ceiling: 90,       // max altitude
  doubleTap: 0.35,   // seconds between jump presses
};

// ---------- kill streak rewards (kills in a row without dying) ----------
export const STREAKS = [
  { id: 'radar', n: 3, key: 1, name: 'Radar', icon: '📡', desc: 'All enemies on your minimap for 30 s', time: 30 },
  { id: 'turret', n: 6, key: 2, name: 'Sentry Turret', icon: '🤖', desc: 'Drops an auto-firing turret in front of you' },
  { id: 'wallhack', n: 8, key: 3, name: 'X-Ray Vision', icon: '👁️', desc: 'See enemies through walls for 60 s', time: 60 },
  { id: 'strike', n: 10, key: 4, name: 'Airstrike', icon: '✈️', desc: 'Pick a spot on the map for a massive bombing run' },
];
export const TURRET = { hp: 150, range: 45, rate: 0.3, damage: 11, accuracy: 0.6 };
export const AIRSTRIKE = { delay: 2.5, bombs: 14, spread: 16, interval: 0.18, radius: 8, maxDamage: 110, minDamage: 20 };

// ---------- host settings (lobby) ----------
// Each setting is a dropdown; the host picks an option and the server validates it against this list.
const ONOFF = [['on', 'On'], ['off', 'Off']];
export const SETTINGS = [
  { key: 'respawn', group: 'Respawns', label: 'Respawns', def: 'on', options: ONOFF },
  { key: 'respawnDelay', group: 'Respawns', label: 'Respawn delay', def: 6, options: [[3, '3 s'], [6, '6 s'], [10, '10 s'], [15, '15 s']] },
  { key: 'lives', group: 'Respawns', label: 'Respawns per player', def: 0, options: [[0, 'Unlimited'], [1, '1'], [2, '2'], [3, '3'], [5, '5']] },
  { key: 'lockCircles', group: 'Respawns', label: 'No respawns / shop in final', def: 2, options: [[1, '1 circle'], [2, '2 circles'], [3, '3 circles']] },
  { key: 'shop', group: 'Shop', label: 'Shop', def: 'on', options: ONOFF },
  { key: 'prices', group: 'Shop', label: 'Shop prices', def: 1, options: [[0.5, 'Half price'], [1, 'Normal'], [1.5, '×1.5'], [2, '×2']] },
  { key: 'pointsMult', group: 'Shop', label: 'Points earned', def: 1, options: [[0.5, '×0.5'], [1, 'Normal'], [2, '×2'], [3, '×3']] },
  { key: 'dmg', group: 'Combat', label: 'Weapon damage', def: 1, options: [[0.75, '×0.75'], [1, 'Normal'], [1.25, '×1.25'], [1.5, '×1.5']] },
  { key: 'startShield', group: 'Combat', label: 'Bonus starting shield', def: 0, options: [[0, 'None'], [50, '+50'], [100, '+100']] },
  { key: 'grenades', group: 'Combat', label: 'Grenades', def: 'normal', options: [['off', 'Off'], ['normal', 'Normal'], ['double', 'Double']] },
  { key: 'streaks', group: 'Combat', label: 'Kill streak rewards', def: 'on', options: ONOFF },
  { key: 'sniper', group: 'Classes', label: 'Sniper allowed', def: 'on', options: ONOFF },
  { key: 'rifle', group: 'Classes', label: 'Rifle allowed', def: 'on', options: ONOFF },
  { key: 'melee', group: 'Classes', label: 'Melee allowed', def: 'on', options: ONOFF },
  { key: 'zoneSpeed', group: 'Zone', label: 'Zone speed', def: 1, options: [[0.6, 'Slow'], [1, 'Normal'], [1.5, 'Fast']] },
  { key: 'zoneDmg', group: 'Zone', label: 'Zone damage', def: 1, options: [[0.5, 'Low'], [1, 'Normal'], [2, 'High']] },
  { key: 'loot', group: 'World', label: 'Loot amount', def: 140, options: [[80, 'Low'], [140, 'Normal'], [220, 'High']] },
  { key: 'drops', group: 'World', label: 'Supply drops', def: 75, options: [[0, 'Off'], [45, 'Every 45 s'], [75, 'Every 75 s'], [120, 'Every 2 min']] },
  { key: 'bounty', group: 'World', label: 'Bounty on kill leader', def: 'on', options: ONOFF },
];
export const defaultSettings = () => Object.fromEntries(SETTINGS.map((s) => [s.key, s.def]));
export const allowedClasses = (set) => Object.keys(CLASSES).filter((c) => set[c] !== 'off');
