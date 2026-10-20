// Box-based collision world shared by the client (local player) and the server (bots).
// Every solid is an axis-aligned box {x0,y0,z0,x1,y1,z1}. Bodies are AABBs standing on their feet.

import { GRAVITY, STEP_HEIGHT, BODY_RADIUS, MAP_HALF } from './config.js';

const EPS = 0.001;

export class World {
  constructor(boxes, half = MAP_HALF) {
    this.boxes = boxes;
    this.half = half + 20;
    this.cell = 8;
    this.n = Math.ceil((this.half * 2) / this.cell);
    this.grid = new Array(this.n * this.n);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = [];
    this.stamp = 1;
    this.marks = new Uint32Array(boxes.length);
    boxes.forEach((b, idx) => {
      const [i0, j0] = this.cellOf(b.x0, b.z0);
      const [i1, j1] = this.cellOf(b.x1, b.z1);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) this.grid[i * this.n + j].push(idx);
    });
  }

  cellOf(x, z) {
    const c = this.cell, n = this.n;
    let i = Math.floor((x + this.half) / c), j = Math.floor((z + this.half) / c);
    if (i < 0) i = 0; else if (i >= n) i = n - 1;
    if (j < 0) j = 0; else if (j >= n) j = n - 1;
    return [i, j];
  }

  // Calls fn(box) for each box whose cells touch the xz rectangle (each box once).
  query(x0, z0, x1, z1, fn) {
    const s = ++this.stamp;
    const [i0, j0] = this.cellOf(x0, z0);
    const [i1, j1] = this.cellOf(x1, z1);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const list = this.grid[i * this.n + j];
      for (let k = 0; k < list.length; k++) {
        const idx = list[k];
        if (this.marks[idx] === s) continue;
        this.marks[idx] = s;
        if (fn(this.boxes[idx]) === true) return;
      }
    }
  }

  // Returns all boxes overlapping the given AABB.
  overlapping(x0, y0, z0, x1, y1, z1) {
    const out = [];
    this.query(x0, z0, x1, z1, (b) => {
      if (x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0 && z0 < b.z1 && z1 > b.z0) out.push(b);
    });
    return out;
  }

  anyOverlap(x0, y0, z0, x1, y1, z1) {
    let hit = false;
    this.query(x0, z0, x1, z1, (b) => {
      if (x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0 && z0 < b.z1 && z1 > b.z0) { hit = true; return true; }
    });
    return hit;
  }

  // Ray against boxes and the ground plane (y=0). Returns distance to first hit, or maxDist.
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let best = maxDist;
    if (dy < -1e-6) { const tg = -oy / dy; if (tg >= 0 && tg < best) best = tg; }
    const s = ++this.stamp;
    const c = this.cell, n = this.n, half = this.half;
    let i = Math.floor((ox + half) / c), j = Math.floor((oz + half) / c);
    const stepI = dx > 0 ? 1 : -1, stepJ = dz > 0 ? 1 : -1;
    const tDeltaI = Math.abs(dx) > 1e-9 ? c / Math.abs(dx) : Infinity;
    const tDeltaJ = Math.abs(dz) > 1e-9 ? c / Math.abs(dz) : Infinity;
    let tMaxI = Math.abs(dx) > 1e-9 ? (((dx > 0 ? i + 1 : i) * c - half) - ox) / dx : Infinity;
    let tMaxJ = Math.abs(dz) > 1e-9 ? (((dz > 0 ? j + 1 : j) * c - half) - oz) / dz : Infinity;
    let t = 0;
    for (let guard = 0; guard < 400; guard++) {
      if (i >= 0 && j >= 0 && i < n && j < n) {
        const list = this.grid[i * n + j];
        for (let k = 0; k < list.length; k++) {
          const idx = list[k];
          if (this.marks[idx] === s) continue;
          this.marks[idx] = s;
          const h = rayBox(ox, oy, oz, dx, dy, dz, this.boxes[idx]);
          if (h >= 0 && h < best) best = h;
        }
      } else if ((i < 0 && stepI < 0) || (j < 0 && stepJ < 0) || (i >= n && stepI > 0) || (j >= n && stepJ > 0)) break;
      t = Math.min(tMaxI, tMaxJ);
      if (t > best || t === Infinity) break;
      if (tMaxI < tMaxJ) { tMaxI += tDeltaI; i += stepI; } else { tMaxJ += tDeltaJ; j += stepJ; }
    }
    return best;
  }
}

// Slab test, returns entry distance or -1.
export function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0, tmax = Infinity;
  if (Math.abs(dx) < 1e-9) { if (ox < b.x0 || ox > b.x1) return -1; }
  else {
    let t1 = (b.x0 - ox) / dx, t2 = (b.x1 - ox) / dx;
    if (t1 > t2) { const q = t1; t1 = t2; t2 = q; }
    if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1;
  }
  if (Math.abs(dy) < 1e-9) { if (oy < b.y0 || oy > b.y1) return -1; }
  else {
    let t1 = (b.y0 - oy) / dy, t2 = (b.y1 - oy) / dy;
    if (t1 > t2) { const q = t1; t1 = t2; t2 = q; }
    if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1;
  }
  if (Math.abs(dz) < 1e-9) { if (oz < b.z0 || oz > b.z1) return -1; }
  else {
    let t1 = (b.z0 - oz) / dz, t2 = (b.z1 - oz) / dz;
    if (t1 > t2) { const q = t1; t1 = t2; t2 = q; }
    if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1;
  }
  return tmin;
}

// Ray vs sphere, returns distance or -1.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return -1;
  const thc = Math.sqrt(r * r - d2);
  const t = tca - thc;
  return t >= 0 ? t : (tca + thc >= 0 ? 0 : -1);
}

// A body: {x,y,z,vx,vy,vz,h,onGround,glide}. Advances it by dt with gravity and collisions.
export function stepBody(world, b, dt, glideFall = 0) {
  b.vy -= GRAVITY * dt;
  if (glideFall && b.vy < -glideFall) b.vy = -glideFall;
  const maxMove = Math.max(Math.abs(b.vx), Math.abs(b.vy), Math.abs(b.vz)) * dt;
  const steps = Math.max(1, Math.ceil(maxMove / 0.2));
  const sub = dt / steps;
  for (let s = 0; s < steps; s++) {
    moveH(world, b, 'x', b.vx * sub);
    moveH(world, b, 'z', b.vz * sub);
    moveV(world, b, b.vy * sub);
  }
  const lim = world.half - 20 - 1;
  if (b.x > lim) { b.x = lim; b.vx = 0; } else if (b.x < -lim) { b.x = -lim; b.vx = 0; }
  if (b.z > lim) { b.z = lim; b.vz = 0; } else if (b.z < -lim) { b.z = -lim; b.vz = 0; }
}

function bodyBoxes(world, b) {
  const r = BODY_RADIUS;
  return world.overlapping(b.x - r, b.y, b.z - r, b.x + r, b.y + b.h, b.z + r);
}

function bodyFree(world, b) {
  const r = BODY_RADIUS;
  return !world.anyOverlap(b.x - r, b.y, b.z - r, b.x + r, b.y + b.h, b.z + r);
}

function moveH(world, b, axis, d) {
  if (d === 0) return;
  b[axis] += d;
  let hits = bodyBoxes(world, b);
  if (!hits.length) return;
  // Step up onto low obstacles (stairs, kerbs).
  if (b.onGround) {
    let top = 0;
    for (const h of hits) if (h.y1 > top) top = h.y1;
    if (top - b.y <= STEP_HEIGHT && top > b.y) {
      const oy = b.y;
      b.y = top + EPS;
      if (bodyFree(world, b)) return;
      b.y = oy;
    }
  }
  const r = BODY_RADIUS;
  const lo = axis === 'x' ? 'x0' : 'z0', hi = axis === 'x' ? 'x1' : 'z1';
  if (d > 0) {
    let m = Infinity; for (const h of hits) if (h[lo] < m) m = h[lo];
    b[axis] = Math.max(b[axis] - d, m - r - EPS);
  } else {
    let m = -Infinity; for (const h of hits) if (h[hi] > m) m = h[hi];
    b[axis] = Math.min(b[axis] - d, m + r + EPS);
  }
  if (axis === 'x') b.vx = 0; else b.vz = 0;
}

function moveV(world, b, d) {
  b.onGround = false;
  b.y += d;
  if (b.y <= 0) { b.y = 0; b.vy = 0; b.onGround = true; return; }
  const hits = bodyBoxes(world, b);
  if (!hits.length) return;
  if (d <= 0) {
    let top = -Infinity; for (const h of hits) if (h.y1 > top) top = h.y1;
    if (top - b.y <= -d + 0.05) b.y = top + EPS; // landed on a surface
    else b.y -= d;                               // wedged against something tall: don't teleport up
    b.vy = 0; b.onGround = true;
  } else {
    let bot = Infinity; for (const h of hits) if (h.y0 < bot) bot = h.y0;
    b.y = bot - b.h - EPS; b.vy = 0;
  }
}

// Line of sight between two points (true if nothing solid in between).
export function lineOfSight(world, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const L = Math.hypot(dx, dy, dz);
  if (L < 1e-6) return true;
  return world.raycast(ax, ay, az, dx / L, dy / L, dz / L, L) >= L - 0.05;
}
