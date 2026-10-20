// All three.js rendering: the city, players, pickups, zone wall, tracers and first-person weapons.
import * as THREE from 'three';
import { CLASSES } from '../shared/config.js';

const tmpColor = new THREE.Color();

export class Renderer {
  constructor(canvas, { touch }) {
    this.highQuality = !touch;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !touch, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, touch ? 1.25 : 1.75));
    this.renderer.autoClear = false;
    if (this.highQuality) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    this.scene = new THREE.Scene();
    const sky = new THREE.Color(0x8fdcff);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 120, 420);

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.08, 900);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    const hemi = new THREE.HemisphereLight(0xdff6ff, 0x9bd17a, 1.35);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff4d6, 2.1);
    this.sun.position.set(80, 140, 50);
    if (this.highQuality) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const s = this.sun.shadow.camera;
      s.left = -70; s.right = 70; s.top = 70; s.bottom = -70; s.near = 10; s.far = 400;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.03;
    }
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.mapGroup = null;
    this.avatars = new Map();
    this.effects = [];
    this.pickupMeshes = new Map();
    this.time = 0;

    this.buildSkyDecor();
    this.buildZone();
    this.buildViewmodels();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h; this.vmCamera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------- static decor
  buildSkyDecor() {
    const clouds = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xbfd8ff, emissiveIntensity: 0.35, fog: false });
    const geo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 40; i++) {
      const c = new THREE.Group();
      const n = 3 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(geo, mat);
        m.scale.set(10 + Math.random() * 10, 6 + Math.random() * 4, 9 + Math.random() * 8);
        m.position.set(k * 12 - n * 6, Math.random() * 4, Math.random() * 8);
        c.add(m);
      }
      const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 450;
      c.position.set(Math.cos(a) * d, 170 + Math.random() * 90, Math.sin(a) * d);
      clouds.add(c);
    }
    this.clouds = clouds;
    this.scene.add(clouds);
    // water + beach around the island
    const water = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshLambertMaterial({ color: 0x3ec8f0 }));
    water.rotation.x = -Math.PI / 2; water.position.y = -0.6;
    this.scene.add(water);
  }

  buildZone() {
    const geo = new THREE.CylinderGeometry(1, 1, 260, 96, 1, true);
    this.zoneMat = new THREE.MeshBasicMaterial({ color: 0xff3cac, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, fog: false });
    this.zoneMesh = new THREE.Mesh(geo, this.zoneMat);
    this.zoneMesh.position.y = 100;
    this.zoneMesh.visible = false;
    this.zoneMesh.renderOrder = 5;
    this.scene.add(this.zoneMesh);
    const ringGeo = new THREE.RingGeometry(0.995, 1, 128);
    this.nextRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    this.nextRing.rotation.x = -Math.PI / 2; this.nextRing.position.y = 0.3; this.nextRing.visible = false;
    this.scene.add(this.nextRing);
  }

  setZone(z) {
    if (!z) { this.zoneMesh.visible = false; this.nextRing.visible = false; return; }
    this.zoneMesh.visible = true;
    this.zoneMesh.position.x = z.cx; this.zoneMesh.position.z = z.cz;
    const r = Math.max(0.5, z.r);
    this.zoneMesh.scale.set(r, 1, r);
    this.nextRing.visible = z.st === 'wait' && z.tr > 0;
    this.nextRing.position.x = z.tx; this.nextRing.position.z = z.tz;
    this.nextRing.scale.setScalar(Math.max(1, z.tr));
  }

  // ------------------------------------------------------------- map
  buildMap(map) {
    if (this.mapGroup) {
      this.scene.remove(this.mapGroup);
      this.mapGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    const g = new THREE.Group();
    this.mapGroup = g;
    const half = map.half;

    // ground + beach
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 + 30, half * 2 + 30), new THREE.MeshLambertMaterial({ color: 0xffe29a }));
    sand.rotation.x = -Math.PI / 2; sand.position.y = -0.05; sand.receiveShadow = true;
    g.add(sand);
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), new THREE.MeshLambertMaterial({ color: 0x7ed957 }));
    grass.rotation.x = -Math.PI / 2; grass.receiveShadow = true;
    g.add(grass);

    // flat decals (roads, pavements, lines)
    g.add(this.mergeFlats(map.flats));

    // solids, merged per 60m chunk with vertex colours
    const chunk = 60;
    const groups = new Map();
    for (const b of map.boxes) {
      const key = Math.floor(((b.x0 + b.x1) / 2 + half) / chunk) + ',' + Math.floor(((b.z0 + b.z1) / 2 + half) / chunk);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(b);
    }
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const list of groups.values()) {
      const mesh = new THREE.Mesh(boxesGeometry(list), mat);
      mesh.castShadow = this.highQuality; mesh.receiveShadow = this.highQuality;
      g.add(mesh);
    }

    // trees: instanced foliage blobs (trunks are boxes in the solids list)
    const leafGeo = new THREE.IcosahedronGeometry(1, 1);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ flatShading: true }), map.trees.length * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let n = 0;
    for (const t of map.trees) {
      p.set(t.x, t.h + t.r * 0.4, t.z); s.set(t.r, t.r * 0.9, t.r);
      m4.compose(p, q, s); leaves.setMatrixAt(n, m4); leaves.setColorAt(n, tmpColor.setHex(t.c)); n++;
      p.set(t.x + t.r * 0.3, t.h + t.r * 1.1, t.z - t.r * 0.2); s.set(t.r * 0.65, t.r * 0.6, t.r * 0.65);
      m4.compose(p, q, s); leaves.setMatrixAt(n, m4); leaves.setColorAt(n, tmpColor.setHex(t.c).offsetHSL(0, 0, 0.08)); n++;
    }
    leaves.castShadow = this.highQuality;
    g.add(leaves);

    this.scene.add(g);
    this.clearPickups();
  }

  mergeFlats(flats) {
    const pos = [], col = [], idx = [];
    for (const f of flats) {
      const i = pos.length / 3;
      pos.push(f.x0, f.y, f.z0, f.x1, f.y, f.z0, f.x1, f.y, f.z1, f.x0, f.y, f.z1);
      tmpColor.setHex(f.c);
      for (let k = 0; k < 4; k++) col.push(tmpColor.r, tmpColor.g, tmpColor.b);
      idx.push(i, i + 2, i + 1, i, i + 3, i + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    mesh.receiveShadow = this.highQuality;
    return mesh;
  }

  // ------------------------------------------------------------- pickups
  clearPickups() {
    for (const m of this.pickupMeshes.values()) this.scene.remove(m);
    this.pickupMeshes.clear();
  }

  setPickups(list) {
    this.clearPickups();
    for (const [id, type, x, y, z, taken] of list) {
      const grp = new THREE.Group();
      if (type === 'med') {
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.45), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x442222 }));
        const red = new THREE.MeshBasicMaterial({ color: 0xff2d55 });
        const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.47), red);
        const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.47), red);
        grp.add(base, c1, c2);
      } else if (type === 'coin') {
        const gold = new THREE.MeshLambertMaterial({ color: 0xffc300, emissive: 0x664400 });
        for (let k = 0; k < 3; k++) {
          const c = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.07, 16), gold);
          c.position.set(k * 0.05 - 0.05, k * 0.09 - 0.1, 0); grp.add(c);
        }
        const up = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 16), gold);
        up.rotation.x = Math.PI / 2; up.position.set(0.15, 0.2, 0); grp.add(up);
      } else if (type === 'gem') {
        const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), new THREE.MeshLambertMaterial({ color: 0xff5ef0, emissive: 0x7a1070, flatShading: true }));
        gem.scale.y = 1.4;
        grp.add(gem);
      } else {
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), new THREE.MeshLambertMaterial({ color: 0x4cc9f0, emissive: 0x2050a0 }));
        gem.scale.y = 1.3;
        grp.add(gem);
      }
      const ringCol = { med: 0xff4d6d, shield: 0x4cc9f0, coin: 0xffc300, gem: 0xff5ef0 }[type];
      const glow = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 24), new THREE.MeshBasicMaterial({ color: ringCol, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      glow.rotation.x = -Math.PI / 2; glow.position.y = -0.55;
      grp.add(glow);
      grp.position.set(x, y + 0.65, z);
      grp.userData.baseY = y + 0.65;
      grp.visible = !taken;
      grp.userData.taken = !!taken;
      this.scene.add(grp);
      this.pickupMeshes.set(id, grp);
    }
  }

  takePickup(id) { const m = this.pickupMeshes.get(id); if (m) { m.visible = false; m.userData.taken = true; } }

  // ------------------------------------------------------------- avatars
  ensureAvatar(info) {
    let a = this.avatars.get(info.id);
    if (a && a.cls === info.cls) return a;
    if (a) this.removeAvatar(info.id);
    a = makeAvatar(info);
    a.pos = new THREE.Vector3(); a.target = new THREE.Vector3(); a.yaw = 0; a.targetYaw = 0; a.walk = 0; a.fresh = true;
    this.scene.add(a.root);
    this.avatars.set(info.id, a);
    return a;
  }

  removeAvatar(id) {
    const a = this.avatars.get(id);
    if (!a) return;
    this.scene.remove(a.root);
    this.avatars.delete(id);
  }

  clearAvatars() { for (const id of [...this.avatars.keys()]) this.removeAvatar(id); }

  updateAvatars(dt) {
    for (const a of this.avatars.values()) {
      if (a.fresh) { a.pos.copy(a.target); a.yaw = a.targetYaw; a.fresh = false; }
      const before = a.pos.clone();
      a.pos.lerp(a.target, Math.min(1, dt * 14));
      let dy = a.targetYaw - a.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      a.yaw += dy * Math.min(1, dt * 14);
      const speed = Math.hypot(a.pos.x - before.x, a.pos.z - before.z) / Math.max(dt, 1e-3);
      a.walk += speed * dt * 1.6;
      a.root.position.copy(a.pos);
      a.root.rotation.y = a.yaw;
      const swing = Math.min(1, speed / 6) * Math.sin(a.walk) * 0.7;
      a.legL.rotation.x = swing; a.legR.rotation.x = -swing;
      a.body.scale.y = a.crouch ? 0.72 : 1;
      a.chute.visible = !!a.glide;
      if (a.swingT > 0) { a.swingT -= dt; a.gun.rotation.x = -Math.sin((1 - a.swingT / 0.25) * Math.PI) * 1.2; } else a.gun.rotation.x = -a.pitch * 0.8;
    }
  }

  // ------------------------------------------------------------- effects
  addTracer(o, e, cls) {
    const from = new THREE.Vector3(...o), to = new THREE.Vector3(...e);
    const len = from.distanceTo(to);
    if (len < 0.1) return;
    const thick = cls === 'sniper' ? 0.06 : 0.025;
    const geo = new THREE.CylinderGeometry(thick, thick, len, 5, 1, true);
    geo.translate(0, len / 2, 0); geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: cls === 'sniper' ? 0xc77dff : 0xffe066, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(from); m.lookAt(to);
    this.scene.add(m);
    this.effects.push({ obj: m, life: cls === 'sniper' ? 0.6 : 0.12, max: cls === 'sniper' ? 0.6 : 0.12, fade: true });
    this.addPuff(to, cls === 'sniper' ? 0xc77dff : 0xfff3b0);
  }

  addPuff(p, color, size = 0.25) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    m.position.copy(p);
    this.scene.add(m);
    this.effects.push({ obj: m, life: 0.35, max: 0.35, fade: true, grow: 3 });
  }

  addSwing(id) { const a = this.avatars.get(id); if (a) a.swingT = 0.25; }

  updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      const k = Math.max(0, e.life / e.max);
      if (e.fade) e.obj.material.opacity = k * 0.9;
      if (e.grow) e.obj.scale.setScalar(1 + (1 - k) * e.grow);
      if (e.life <= 0) {
        this.scene.remove(e.obj); e.obj.geometry.dispose(); e.obj.material.dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------- viewmodels
  buildViewmodels() {
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.vmScene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2));
    const dl = new THREE.DirectionalLight(0xffffff, 1.5); dl.position.set(1, 2, 1); this.vmScene.add(dl);
    this.vm = {};
    const L = (c, e = 0x000000) => new THREE.MeshLambertMaterial({ color: c, emissive: e });
    const B = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };
    const C = (r, len, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); return m; };
    const glove = L(0xffd166);

    // sniper
    const sn = new THREE.Group();
    const purple = L(0x8e5cff), dark = L(0x2b2d42), teal = L(0x00f5d4, 0x004433);
    sn.add(B(0.07, 0.1, 0.6, purple, 0, 0, -0.1), C(0.018, 0.55, dark, 0, 0.02, -0.65), B(0.06, 0.13, 0.25, dark, 0, -0.03, 0.28),
      C(0.035, 0.26, dark, 0, 0.09, -0.12), C(0.038, 0.02, teal, 0, 0.09, -0.26), B(0.04, 0.1, 0.05, glove, 0, -0.08, 0.05));
    // rifle
    const rf = new THREE.Group();
    const orange = L(0xff8a1f), black = L(0x333344), yellow = L(0xffd60a, 0x332200);
    rf.add(B(0.08, 0.12, 0.45, orange, 0, 0, -0.05), C(0.02, 0.3, black, 0, 0.02, -0.42), B(0.05, 0.16, 0.08, black, 0, -0.12, -0.08),
      B(0.06, 0.1, 0.18, black, 0, -0.02, 0.24), B(0.03, 0.04, 0.12, yellow, 0, 0.08, -0.05), B(0.04, 0.1, 0.05, glove, 0, -0.08, 0.06));
    // knife
    const kn = new THREE.Group();
    const blade = new THREE.MeshLambertMaterial({ color: 0xe0f7ff, emissive: 0xff3c8e, emissiveIntensity: 0.4 });
    kn.add(B(0.035, 0.035, 0.14, L(0x6d597a), 0, 0, 0.06), B(0.07, 0.02, 0.02, L(0xffd60a), 0, 0, -0.02), B(0.012, 0.045, 0.26, blade, 0, 0.005, -0.16),
      B(0.06, 0.06, 0.08, glove, 0, -0.01, 0.08));
    kn.rotation.y = 0.2;
    this.vm = { sniper: sn, rifle: rf, melee: kn };
    for (const k in this.vm) { this.vm[k].visible = false; this.vmScene.add(this.vm[k]); }
    // muzzle flash
    this.flash = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), new THREE.MeshBasicMaterial({ color: 0xfff3b0 }));
    this.flash.visible = false;
    this.vmScene.add(this.flash);
    this.vmState = { kick: 0, swing: 0, bob: 0, flashT: 0, cls: null };
  }

  setViewmodel(cls) {
    for (const k in this.vm) this.vm[k].visible = k === cls;
    this.vmState.cls = cls;
  }

  vmFire(cls) {
    if (cls === 'melee') this.vmState.swing = 1;
    else { this.vmState.kick = 1; this.vmState.flashT = 0.05; }
  }

  updateViewmodel(dt, moving, aimK, reloadK, visible) {
    const st = this.vmState, cls = st.cls;
    const g = this.vm[cls];
    if (!g) return;
    g.visible = visible;
    st.kick = Math.max(0, st.kick - dt * 8);
    st.swing = Math.max(0, st.swing - dt * 4);
    st.bob += dt * (moving ? 9 : 2);
    const bobA = moving ? 0.012 : 0.004;
    const hip = { x: 0.2, y: -0.19, z: -0.42 }, aim = { x: 0, y: cls === 'sniper' ? -0.09 : -0.115, z: -0.36 };
    if (cls === 'melee') { hip.x = 0.24; hip.y = -0.2; hip.z = -0.38; }
    const x = hip.x + (aim.x - hip.x) * aimK, y = hip.y + (aim.y - hip.y) * aimK, z = hip.z + (aim.z - hip.z) * aimK;
    g.position.set(x + Math.cos(st.bob) * bobA, y + Math.abs(Math.sin(st.bob)) * bobA - reloadK * 0.25, z + st.kick * 0.07);
    g.rotation.x = st.kick * 0.12 - reloadK * 0.9;
    if (cls === 'melee') {
      const s = Math.sin(st.swing * Math.PI);
      g.rotation.x = -s * 1.1; g.rotation.z = s * 0.6; g.position.x -= s * 0.15; g.position.z -= s * 0.15;
    }
    st.flashT -= dt;
    this.flash.visible = visible && st.flashT > 0 && cls !== 'melee';
    if (this.flash.visible) this.flash.position.set(g.position.x, g.position.y + 0.02, g.position.z - (cls === 'sniper' ? 0.95 : 0.6));
  }

  // ------------------------------------------------------------- frame
  render(dt, showVm) {
    this.time += dt;
    this.updateAvatars(dt);
    this.updateEffects(dt);
    const cam = this.camera.position;
    for (const m of this.pickupMeshes.values()) {
      if (m.userData.taken) continue;
      m.visible = Math.abs(m.position.x - cam.x) < 90 && Math.abs(m.position.z - cam.z) < 90;
      if (!m.visible) continue;
      m.rotation.y += dt * 1.5;
      m.position.y = m.userData.baseY + Math.sin(this.time * 2 + m.position.x) * 0.1;
    }
    this.zoneMat.opacity = 0.22 + Math.sin(this.time * 3) * 0.06;
    this.clouds.rotation.y += dt * 0.004;
    // shadow camera follows the viewer
    const c = cam;
    this.sun.position.set(c.x + 60, c.y + 120, c.z + 40);
    this.sun.target.position.set(c.x, 0, c.z);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (showVm) {
      this.renderer.clearDepth();
      this.renderer.render(this.vmScene, this.vmCamera);
    }
  }
}

// Builds one BufferGeometry for many axis-aligned boxes, coloured per box.
function boxesGeometry(list) {
  const n = list.length;
  const pos = new Float32Array(n * 24 * 3), nor = new Float32Array(n * 24 * 3), col = new Float32Array(n * 24 * 3);
  const idx = new Uint32Array(n * 36);
  let v = 0, ii = 0;
  const faces = [
    // normal, 4 corners (as [x?,y?,z?] selectors: 0=min 1=max)
    [[1, 0, 0], [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], 0.86],
    [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], 0.86],
    [[0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], 1.0],
    [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], 0.7],
    [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], 0.94],
    [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], 0.94],
  ];
  for (const b of list) {
    tmpColor.setHex(b.c);
    const xs = [b.x0, b.x1], ys = [b.y0, b.y1], zs = [b.z0, b.z1];
    for (const [nrm, corners, shade] of faces) {
      const base = v;
      for (const [cx, cy, cz] of corners) {
        pos[v * 3] = xs[cx]; pos[v * 3 + 1] = ys[cy]; pos[v * 3 + 2] = zs[cz];
        nor[v * 3] = nrm[0]; nor[v * 3 + 1] = nrm[1]; nor[v * 3 + 2] = nrm[2];
        col[v * 3] = tmpColor.r * shade; col[v * 3 + 1] = tmpColor.g * shade; col[v * 3 + 2] = tmpColor.b * shade;
        v++;
      }
      idx[ii++] = base; idx[ii++] = base + 1; idx[ii++] = base + 2;
      idx[ii++] = base; idx[ii++] = base + 2; idx[ii++] = base + 3;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeBoundingSphere();
  return geo;
}

function makeAvatar(info) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const color = new THREE.Color(info.color);
  const mat = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: color.clone().multiplyScalar(0.55) });
  const skin = new THREE.MeshLambertMaterial({ color: 0xffd6a5 });
  const black = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const clsCol = new THREE.MeshLambertMaterial({ color: CLASSES[info.cls].color });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.5, 4, 10), mat);
  torso.position.y = 0.95; torso.castShadow = true;
  body.add(torso);
  const legGeo = new THREE.BoxGeometry(0.18, 0.55, 0.2); legGeo.translate(0, -0.27, 0);
  const legL = new THREE.Mesh(legGeo, dark); legL.position.set(-0.14, 0.6, 0);
  const legR = new THREE.Mesh(legGeo, dark); legR.position.set(0.14, 0.6, 0);
  body.add(legL, legR);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12), skin);
  head.position.y = 1.6; head.castShadow = true;
  body.add(head);
  const eyeGeo = new THREE.BoxGeometry(0.07, 0.09, 0.02);
  const e1 = new THREE.Mesh(eyeGeo, black); e1.position.set(-0.09, 1.64, -0.255);
  const e2 = new THREE.Mesh(eyeGeo, black); e2.position.set(0.09, 1.64, -0.255);
  body.add(e1, e2);
  // class hat
  if (info.cls === 'sniper') {
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 16), clsCol); hat.position.y = 1.78;
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.16, 16), clsCol); top.position.y = 1.86;
    body.add(hat, top);
  } else if (info.cls === 'rifle') {
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), clsCol); helm.position.y = 1.65;
    body.add(helm);
  } else {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.05, 6, 20), clsCol); band.rotation.x = Math.PI / 2; band.position.y = 1.72;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.3), clsCol); tail.position.set(0, 1.7, 0.36); tail.rotation.x = -0.5;
    body.add(band, tail);
  }
  // held weapon
  const gun = new THREE.Group();
  gun.position.set(0.3, 1.15, -0.25);
  const gm = new THREE.MeshLambertMaterial({ color: 0x2b2d42 });
  if (info.cls === 'sniper') gun.add(boxMesh(0.07, 0.09, 1.1, clsCol, 0, 0, -0.4), boxMesh(0.06, 0.06, 0.3, gm, 0, 0.08, -0.3));
  else if (info.cls === 'rifle') gun.add(boxMesh(0.08, 0.12, 0.7, clsCol, 0, 0, -0.25), boxMesh(0.05, 0.15, 0.08, gm, 0, -0.12, -0.2));
  else gun.add(boxMesh(0.03, 0.05, 0.4, new THREE.MeshLambertMaterial({ color: 0xe0f7ff, emissive: 0xff3c8e, emissiveIntensity: 0.5 }), 0, 0, -0.2));
  body.add(gun);
  // parachute
  const chute = new THREE.Group();
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6),
    new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
  canopy.position.y = 4.2; canopy.scale.y = 0.6;
  chute.add(canopy);
  chute.visible = false;
  root.add(chute);
  // name tag
  const tag = makeNameTag(info.name, info.color);
  tag.position.y = 2.25;
  root.add(tag);
  return { root, body, legL, legR, gun, chute, tag, cls: info.cls, swingT: 0, pitch: 0 };
}

function boxMesh(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m;
}

function makeNameTag(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px Trebuchet MS, sans-serif';
  const w = Math.min(250, g.measureText(name).width + 28);
  g.fillStyle = 'rgba(20,15,50,0.65)';
  roundRect(g, (256 - w) / 2, 6, w, 50, 18); g.fill();
  g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(name, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true, transparent: true }));
  s.scale.set(1.6, 0.4, 1);
  return s;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
