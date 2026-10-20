// Deterministic procedural city. The server and every client run generateMap(seed) and get the
// exact same world, so only the seed travels over the network.

import { MAP_HALF } from './config.js';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WALL_COLORS = [
  0xff6b6b, 0xffd93d, 0x6bcb77, 0x4d96ff, 0xff8fd8, 0x9b5de5, 0x00bbf9, 0xf15bb5,
  0xfee440, 0x00f5d4, 0xff9f1c, 0x80ed99, 0xffadad, 0xa0c4ff, 0xcaffbf, 0xffc6ff,
];
const TRIM_COLORS = [0xffffff, 0x2b2d42, 0xfff3b0, 0x335c67, 0xe09f3e];
const FLOOR_COLOR = 0xe9d8a6;
const STAIR_COLOR = 0xcdb4db;
const CRATE_COLORS = [0xb5838d, 0x8d6e63, 0x2ec4b6, 0xff9f1c, 0x6d597a];
const CAR_COLORS = [0xef476f, 0xffd166, 0x06d6a0, 0x118ab2, 0xf78c6b, 0xc77dff, 0xffffff];
const ROAD = 0x50566b, LINE = 0xffe066, PAVE = 0xd8d2cc, PLAZA = 0xf2e2c4;
const HEDGE = 0x2d9b4f, ROCK = 0x9aa5b1;

export const FLOOR_H = 3.4;
const WALL_T = 0.3;
const SLAB = 0.25;
const STEP_N = 10;
const STEP_D = 0.5;
const STAIR_W = 1.4;
const STAIR_OFFSET = 1.3; // landing space before the first step
const ROAD_W = 12;
const ROAD_LINES = [-120, -40, 40, 120];

export function generateMap(seed) {
  const rnd = mulberry32(seed >>> 0);
  const R = (a, b) => a + rnd() * (b - a);
  const RI = (a, b) => Math.floor(R(a, b + 1));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const half = MAP_HALF;

  const boxes = [];      // solid colliders (also rendered)
  const flats = [];      // render-only ground decals {x0,z0,x1,z1,y,c}
  const trees = [];      // {x,z,h,r,c}
  const pickupSpots = []; // [x,y,z]
  const buildings = [];  // footprints for the minimap
  let spawnSpots = [];

  const box = (x0, y0, z0, x1, y1, z1, c) => {
    if (x1 - x0 < 0.02 || y1 - y0 < 0.02 || z1 - z0 < 0.02) return;
    boxes.push({ x0, y0, z0, x1, y1, z1, c });
  };

  // ---------- roads ----------
  for (const L of ROAD_LINES) {
    flats.push({ x0: -half, z0: L - ROAD_W / 2, x1: half, z1: L + ROAD_W / 2, y: 0.02, c: ROAD });
    flats.push({ x0: L - ROAD_W / 2, z0: -half, x1: L + ROAD_W / 2, z1: half, y: 0.021, c: ROAD });
    for (let t = -half + 2; t < half - 4; t += 8) {
      const nearCross = ROAD_LINES.some((M) => Math.abs(t + 1.5 - M) < ROAD_W / 2 + 1);
      if (nearCross) continue;
      flats.push({ x0: t, z0: L - 0.15, x1: t + 3, z1: L + 0.15, y: 0.03, c: LINE });
      flats.push({ x0: L - 0.15, z0: t, x1: L + 0.15, z1: t + 3, y: 0.031, c: LINE });
    }
    for (let t = -half + 6; t < half - 6; t += 9) { spawnSpots.push([t, L]); spawnSpots.push([L, t]); }
  }
  // cars parked along the roads (cover)
  for (const L of ROAD_LINES) {
    for (let k = 0; k < 7; k++) {
      const t = R(-half + 8, half - 8);
      if (ROAD_LINES.some((M) => Math.abs(t - M) < ROAD_W / 2 + 3)) continue;
      const lane = L + (rnd() < 0.5 ? -3 : 3);
      const c = pick(CAR_COLORS);
      if (rnd() < 0.5) { // along x
        box(t - 2.1, 0.25, lane - 0.95, t + 2.1, 1.15, lane + 0.95, c);
        box(t - 1.1, 1.15, lane - 0.85, t + 1.0, 1.85, lane + 0.85, 0xdff6ff);
      } else {
        box(lane - 0.95, 0.25, t - 2.1, lane + 0.95, 1.15, t + 2.1, c);
        box(lane - 0.85, 1.15, t - 1.1, lane + 0.85, 1.85, t + 1.0, 0xdff6ff);
      }
    }
  }

  // ---------- building ----------
  function windowsFor(a, b, door) {
    const L = b - a;
    const n = Math.max(0, Math.floor((L - 1) / 3.6));
    const ops = [];
    for (let k = 1; k <= n; k++) {
      const c = a + (L * k) / (n + 1);
      if (door && Math.abs(c - door.c) < door.w / 2 + 1.2) continue;
      ops.push({ c, w: 1.3, b: 1.0, t: 2.3 });
    }
    if (door) ops.push(door);
    ops.sort((p, q) => p.c - q.c);
    return ops;
  }

  // Wall running along `axis` from a to b, occupying [f0,f1] on the other horizontal axis.
  function wall(axis, f0, f1, a, b, yb, h, ops, c) {
    const seg = (u0, u1, y0, y1) => {
      if (axis === 'x') box(u0, y0, f0, u1, y1, f1, c); else box(f0, y0, u0, f1, y1, u1, c);
    };
    let cur = a;
    for (const op of ops) {
      const oa = op.c - op.w / 2, ob = op.c + op.w / 2;
      if (oa < cur + 0.1 || ob > b - 0.1) continue;
      seg(cur, oa, yb, yb + h);
      seg(oa, ob, yb, yb + op.b);
      seg(oa, ob, yb + op.t, yb + h);
      cur = ob;
    }
    seg(cur, b, yb, yb + h);
  }

  function building(x0, z0, w, d, floors, opts = {}) {
    const x1 = x0 + w, z1 = z0 + d;
    const col = opts.color ?? pick(WALL_COLORS);
    const trim = pick(TRIM_COLORS);
    const roofCol = opts.roof ?? pick(WALL_COLORS);
    const T = WALL_T, FH = FLOOR_H;
    const totalH = floors * FH;
    buildings.push({ x0, z0, x1, z1, floors, c: col });

    const sx = x0 + T + STAIR_OFFSET;              // stair start x
    const run = STEP_N * STEP_D;
    const laneA = [z0 + T, z0 + T + STAIR_W];
    const laneB = [z0 + T + STAIR_W, z0 + T + 2 * STAIR_W];
    const stairZoneX = sx + run + 1.6;
    const stairZoneZ = laneB[1] + 0.8;

    const doorW = opts.bigDoors ? 4 : 1.6;
    const doorH = opts.bigDoors ? 3.0 : 2.5;
    const nDoorC = R(x0 + 2 + doorW / 2, x1 - 2 - doorW / 2);
    const eDoorC = R(Math.min(stairZoneZ + doorW / 2 + 0.3, z1 - 2), z1 - 1.2 - doorW / 2);
    const wDoorC = R(Math.min(stairZoneZ + doorW / 2 + 0.3, z1 - 2), z1 - 1.2 - doorW / 2);
    const door = (c) => ({ c, w: doorW, b: 0, t: doorH });

    // interior partition wall
    const hasPart = w >= 17;
    const px = hasPart ? x0 + Math.max(stairZoneX - x0 + 1.5, Math.min(w * 0.55, w - 5)) : 0;
    const partDoor = { c: R(Math.max(stairZoneZ + 1, z0 + 2), z1 - 2), w: 1.5, b: 0, t: 2.5 };

    for (let f = 0; f < floors; f++) {
      const yb = f * FH;
      const g = f === 0;
      // exterior walls
      wall('x', z0, z0 + T, x0, x1, yb, FH, windowsFor(x0 + 1, x1 - 1, null), col);
      wall('x', z1 - T, z1, x0, x1, yb, FH, windowsFor(x0 + 1, x1 - 1, g ? door(nDoorC) : null), col);
      wall('z', x0, x0 + T, z0 + T, z1 - T, yb, FH, windowsFor(z0 + 1, z1 - 1, g ? door(wDoorC) : null), col);
      wall('z', x1 - T, x1, z0 + T, z1 - T, yb, FH, windowsFor(z0 + 1, z1 - 1, g ? door(eDoorC) : null), col);
      // floor-level trim band
      if (f > 0) {
        box(x0 - 0.12, yb - 0.3, z0 - 0.12, x1 + 0.12, yb, z0, trim);
        box(x0 - 0.12, yb - 0.3, z1, x1 + 0.12, yb, z1 + 0.12, trim);
        box(x0 - 0.12, yb - 0.3, z0, x0, yb, z1, trim);
        box(x1, yb - 0.3, z0, x1 + 0.12, yb, z1, trim);
      }
      // interior floor (ground) or slab with stair hole (upper floors)
      if (g) box(x0 + T, 0, z0 + T, x1 - T, 0.05, z1 - T, opts.floorColor ?? FLOOR_COLOR);
      else slabWithHole(x0 + T, z0 + T, x1 - T, z1 - T, yb - SLAB, yb, laneA, sx, run, FLOOR_COLOR);

      // stairs from this floor to the next (or roof)
      const lane = f % 2 === 0 ? laneA : laneB;
      for (let i = 0; i < STEP_N; i++) {
        const rise = (FH / STEP_N) * (i + 1);
        const xa = f % 2 === 0 ? sx + i * STEP_D : sx + run - (i + 1) * STEP_D;
        box(xa, yb, lane[0], xa + STEP_D, yb + rise, lane[1], STAIR_COLOR);
      }

      if (hasPart) wall('z', px - T / 2, px + T / 2, z0 + T, z1 - T, yb, FH, [partDoor], lighten(col));

      // furniture / crates for cover
      const nCrates = opts.crates ?? RI(1, 3);
      const placed = [];
      for (let k = 0; k < nCrates * 3 && placed.length < nCrates; k++) {
        const s = R(0.9, 1.4);
        const cx = R(x0 + T + s, x1 - T - s), cz = R(z0 + T + s, z1 - T - s);
        if (cx < stairZoneX + 0.5 && cz < stairZoneZ + 0.5) continue;
        if (Math.abs(cz - z1) < 2.6 && Math.abs(cx - nDoorC) < doorW / 2 + 1.6) continue;
        if (Math.abs(cx - x0) < 2.6 || Math.abs(cx - x1) < 2.6) { if (Math.abs(cz - eDoorC) < 3 || Math.abs(cz - wDoorC) < 3) continue; }
        if (hasPart && Math.abs(cx - px) < s + 1.2) continue;
        if (placed.some((p) => Math.abs(p[0] - cx) < 2.2 && Math.abs(p[1] - cz) < 2.2)) continue;
        placed.push([cx, cz]);
        const hgt = opts.stackCrates && rnd() < 0.6 ? s * 2 : s;
        box(cx - s / 2, yb, cz - s / 2, cx + s / 2, yb + hgt, cz + s / 2, pick(CRATE_COLORS));
      }
      // loot spot on this floor
      for (let k = 0; k < 10; k++) {
        const cx = R(x0 + 1.5, x1 - 1.5), cz = R(z0 + 1.5, z1 - 1.5);
        if (cx < stairZoneX && cz < stairZoneZ) continue;
        if (placed.some((p) => Math.abs(p[0] - cx) < 1.6 && Math.abs(p[1] - cz) < 1.6)) continue;
        if (hasPart && Math.abs(cx - px) < 1) continue;
        pickupSpots.push([cx, yb + (g ? 0.05 : 0), cz]);
        break;
      }
    }
    // roof slab + parapet
    slabWithHole(x0, z0, x1, z1, totalH - SLAB, totalH, laneA, sx, run, roofCol);
    const P = 1.0;
    box(x0, totalH, z0, x1, totalH + P, z0 + T, trim);
    box(x0, totalH, z1 - T, x1, totalH + P, z1, trim);
    box(x0, totalH, z0 + T, x0 + T, totalH + P, z1 - T, trim);
    box(x1 - T, totalH, z0 + T, x1, totalH + P, z1 - T, trim);
    if (floors >= 3) pickupSpots.push([x0 + w * 0.7, totalH, z0 + d * 0.7]);
  }

  function slabWithHole(x0, z0, x1, z1, y0, y1, lane, sx, run, c) {
    // The hole spans both stair lanes (plus margin) so heads never clip the slab edge.
    const hx0 = sx - 0.05, hx1 = sx + run + 0.05, hz0 = lane[0] - 0.05, hz1 = lane[0] + 2 * STAIR_W + 0.7;
    box(x0, y0, z0, hx0, y1, z1, c);
    box(hx1, y0, z0, x1, y1, z1, c);
    box(hx0, y0, z0, hx1, y1, hz0, c);
    box(hx0, y0, hz1, hx1, y1, z1, c);
  }

  // ---------- block fillers ----------
  function tree(x, z, scale = 1) {
    const h = R(2.5, 4.5) * scale;
    trees.push({ x, z, h, r: R(1.6, 2.6) * scale, c: pick([0x38b000, 0x70e000, 0x2dc653, 0x9ef01a, 0xff8fab, 0xffb703]) });
    box(x - 0.3, 0, z - 0.3, x + 0.3, h, z + 0.3, 0x8b5e34);
  }

  function lot(x0, z0, x1, z1) {
    const m = 2.5;
    const aw = x1 - x0 - 2 * m, ad = z1 - z0 - 2 * m;
    if (aw < 12 || ad < 10) {
      for (let k = 0; k < 3; k++) tree(R(x0 + 2, x1 - 2), R(z0 + 2, z1 - 2));
      return;
    }
    const w = R(Math.max(12, aw * 0.65), aw), d = R(Math.max(10, ad * 0.65), ad);
    const bx = R(x0 + m, x1 - m - w), bz = R(z0 + m, z1 - m - d);
    const floors = rnd() < 0.15 ? 4 : RI(1, 3);
    building(bx, bz, w, d, floors);
    // a couple of trees / crates in the yard
    for (let k = 0; k < 2; k++) {
      const tx = R(x0 + 1.5, x1 - 1.5), tz = R(z0 + 1.5, z1 - 1.5);
      if (tx > bx - 2 && tx < bx + w + 2 && tz > bz - 2 && tz < bz + d + 2) continue;
      if (rnd() < 0.6) tree(tx, tz); else box(tx - 0.7, 0, tz - 0.7, tx + 0.7, 1.4, tz + 0.7, pick(CRATE_COLORS));
    }
  }

  function split(x0, z0, x1, z1, depth) {
    const w = x1 - x0, d = z1 - z0;
    if ((w < 36 && d < 36) || depth > 4) { lot(x0, z0, x1, z1); return; }
    if (w >= d) { const m = R(x0 + w * 0.4, x0 + w * 0.6); split(x0, z0, m, z1, depth + 1); split(m, z0, x1, z1, depth + 1); }
    else { const m = R(z0 + d * 0.4, z0 + d * 0.6); split(x0, z0, x1, m, depth + 1); split(x0, m, x1, z1, depth + 1); }
  }

  function park(x0, z0, x1, z1) {
    // little hut with a loot spot
    let hut = null;
    if (rnd() < 0.6) {
      hut = { w: 13, d: 10 };
      hut.x = R(x0 + 3, x1 - 3 - hut.w); hut.z = R(z0 + 3, z1 - 3 - hut.d);
      building(hut.x, hut.z, hut.w, hut.d, 1, { crates: 1 });
    }
    const clear = (x, z, m) => !hut || x < hut.x - m || x > hut.x + hut.w + m || z < hut.z - m || z > hut.z + hut.d + m;
    const n = RI(14, 24);
    for (let k = 0; k < n; k++) {
      const tx = R(x0 + 2, x1 - 2), tz = R(z0 + 2, z1 - 2);
      if (clear(tx, tz, 2)) tree(tx, tz, R(0.9, 1.4));
    }
    // hedges
    for (let k = 0; k < RI(3, 6); k++) {
      const hx = R(x0 + 4, x1 - 4), hz = R(z0 + 4, z1 - 4), L = R(4, 10);
      if (!clear(hx, hz, 7)) continue;
      if (rnd() < 0.5) box(hx - L / 2, 0, hz - 0.5, hx + L / 2, 1.3, hz + 0.5, HEDGE);
      else box(hx - 0.5, 0, hz - L / 2, hx + 0.5, 1.3, hz + L / 2, HEDGE);
    }
    // rocks
    for (let k = 0; k < RI(3, 7); k++) {
      const rx = R(x0 + 3, x1 - 3), rz = R(z0 + 3, z1 - 3), s = R(1, 2.6);
      if (!clear(rx, rz, 4)) continue;
      box(rx - s, 0, rz - s * 0.8, rx + s, s * R(0.7, 1.3), rz + s * 0.8, ROCK);
    }
    if (clear((x0 + x1) / 2, (z0 + z1) / 2, 1)) pickupSpots.push([(x0 + x1) / 2, 0, (z0 + z1) / 2]);
  }

  function warehouse(x0, z0, x1, z1) {
    flats.push({ x0, z0, x1, z1, y: 0.01, c: PAVE });
    const w = Math.min(x1 - x0 - 6, R(30, 44)), d = Math.min(z1 - z0 - 6, R(18, 26));
    const bx = R(x0 + 3, x1 - 3 - w), bz = R(z0 + 3, z1 - 3 - d);
    building(bx, bz, w, d, 1, { bigDoors: true, crates: 7, stackCrates: true, floorColor: 0xc9c9c9 });
    // shipping containers outside
    for (let k = 0; k < RI(2, 4); k++) {
      const cx = R(x0 + 4, x1 - 4), cz = R(z0 + 4, z1 - 4);
      if (cx > bx - 4 && cx < bx + w + 4 && cz > bz - 4 && cz < bz + d + 4) continue;
      const c = pick([0xe63946, 0x1d3557, 0x2a9d8f, 0xf4a261, 0x7209b7]);
      if (rnd() < 0.5) box(cx - 3, 0, cz - 1.2, cx + 3, 2.6, cz + 1.2, c); else box(cx - 1.2, 0, cz - 3, cx + 1.2, 2.6, cz + 3, c);
    }
  }

  function towerBlock(x0, z0, x1, z1) {
    flats.push({ x0, z0, x1, z1, y: 0.01, c: PLAZA });
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const s = 15;
    building(cx - s / 2, cz - s / 2, s, s, RI(5, 7), { crates: 1 });
    // small surrounding buildings in the corners
    const corners = [[x0 + 3, z0 + 3], [x1 - 17, z0 + 3], [x0 + 3, z1 - 15], [x1 - 17, z1 - 15]];
    for (const [ax, az] of corners) {
      if (rnd() < 0.55) building(ax, az, 14, 12, RI(1, 2));
      else { tree(ax + 5, az + 5); tree(ax + 9, az + 8); }
    }
  }

  // ---------- lay out blocks ----------
  const edges = [-half, ...ROAD_LINES, half];
  for (let i = 0; i < edges.length - 1; i++) {
    for (let j = 0; j < edges.length - 1; j++) {
      const x0 = edges[i] + (i === 0 ? 4 : ROAD_W / 2), x1 = edges[i + 1] - (i === edges.length - 2 ? 4 : ROAD_W / 2);
      const z0 = edges[j] + (j === 0 ? 4 : ROAD_W / 2), z1 = edges[j + 1] - (j === edges.length - 2 ? 4 : ROAD_W / 2);
      if (i === 2 && j === 2) { towerBlock(x0, z0, x1, z1); continue; }
      const r = rnd();
      if (r < 0.55) { flats.push({ x0, z0, x1, z1, y: 0.01, c: PAVE }); split(x0, z0, x1, z1, 0); }
      else if (r < 0.72) park(x0, z0, x1, z1);
      else if (r < 0.86) warehouse(x0, z0, x1, z1);
      else towerBlock(x0, z0, x1, z1);
    }
  }

  // spawn spots must be clear of every box
  spawnSpots = spawnSpots.filter(([x, z]) => !boxes.some((b) => x > b.x0 - 1 && x < b.x1 + 1 && z > b.z0 - 1 && z < b.z1 + 1 && b.y0 < 2));

  return { seed, half, boxes, flats, trees, pickupSpots, spawnSpots, buildings };
}

function lighten(c) {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  const f = (v) => Math.round(v + (255 - v) * 0.45);
  return (f(r) << 16) | (f(g) << 8) | f(b);
}
