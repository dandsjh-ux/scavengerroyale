// All three.js rendering: sky, the city, players, pickups, zone wall, grenades, effects and first-person weapons.
import * as THREE from 'three';
import { CLASSES, GRENADE, DROP_FALL_SPEED } from '../shared/config.js';

const tmpColor = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

// Time-of-day looks. One is picked per map seed, so every match feels a little different.
export const THEMES = {
  noon: {
    name: 'Sunny Noon', top: 0x2f86ff, horizon: 0xbfeaff, sun: 0xfff4d6, sunI: 2.2, sunDir: [0.45, 1, 0.3],
    hemiSky: 0xdff6ff, hemiGround: 0x9bd17a, hemiI: 1.35, shallow: 0x3fd4f5, deep: 0x1d6fd8, cloud: 0xffffff,
  },
  golden: {
    name: 'Golden Hour', top: 0x4767d6, horizon: 0xffcf96, sun: 0xffbe78, sunI: 2.5, sunDir: [0.9, 0.42, 0.25],
    hemiSky: 0xffe2c4, hemiGround: 0x9ab070, hemiI: 1.15, shallow: 0x4cc3e0, deep: 0x2a55b8, cloud: 0xffe0c2,
  },
  candy: {
    name: 'Candy Sunset', top: 0x6a4cff, horizon: 0xffa6d6, sun: 0xffb6d8, sunI: 2.1, sunDir: [-0.8, 0.5, 0.35],
    hemiSky: 0xffd6f2, hemiGround: 0x9ad0a0, hemiI: 1.3, shallow: 0x6fd0ff, deep: 0x5a3fd0, cloud: 0xffd6ee,
  },
  mint: {
    name: 'Fresh Morning', top: 0x1f9dff, horizon: 0xd8fff2, sun: 0xffffff, sunI: 2.0, sunDir: [-0.4, 0.8, -0.6],
    hemiSky: 0xe8fff8, hemiGround: 0x8fd18a, hemiI: 1.4, shallow: 0x2fe0d6, deep: 0x1b7fcf, cloud: 0xffffff,
  },
};
export const themeForSeed = (seed) => { const k = Object.keys(THEMES); return k[seed % k.length]; };

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
    this.scene.fog = new THREE.Fog(0xbfeaff, 140, 460);

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.08, 1000);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.hemi = new THREE.HemisphereLight(0xdff6ff, 0x9bd17a, 1.35);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff4d6, 2.1);
    this.sunDir = new THREE.Vector3(0.45, 1, 0.3).normalize();
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
    // one re-usable light for explosion flashes (always present so shaders never recompile mid-game)
    this.boomLight = new THREE.PointLight(0xffaa55, 0, 30, 1.6);
    this.scene.add(this.boomLight);

    this.mapGroup = null;
    this.avatars = new Map();
    this.effects = [];
    this.particles = [];
    this.pickupMeshes = new Map();
    this.nadeMeshes = new Map();
    this.projectiles = [];
    this.time = 0;
    this.shake = 0;

    this.buildSky();
    this.buildWater();
    this.buildZone();
    this.buildArc();
    this.buildViewmodels();
    this.glintTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,240,180,0.6)', 'rgba(255,200,120,0)');
    this.setTheme('noon');
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h; this.vmCamera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------- sky, water, theme
  buildSky() {
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunColor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) } },
      vertexShader: `varying vec3 vDir;
        void main() { vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunColor; uniform vec3 sunDir; varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55));
          col = mix(col, horizon * 0.92, clamp(-h * 4.0, 0.0, 1.0));
          float s = max(dot(d, normalize(sunDir)), 0.0);
          col += sunColor * (smoothstep(0.9975, 0.9985, s) * 1.2 + pow(s, 48.0) * 0.35 + pow(s, 6.0) * 0.08);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), this.skyMat);
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    const clouds = new THREE.Group();
    this.cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xbfd8ff, emissiveIntensity: 0.55, fog: false, flatShading: true });
    const geo = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 40; i++) {
      const c = new THREE.Group();
      const n = 3 + Math.floor(Math.random() * 4);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(geo, this.cloudMat);
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
  }

  buildWater() {
    const geo = new THREE.PlaneGeometry(2400, 2400, 150, 150);
    geo.rotateX(-Math.PI / 2);
    this.waterMat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        time: { value: 0 }, shallow: { value: new THREE.Color() }, deep: { value: new THREE.Color() }, islandHalf: { value: 180 },
      }]),
      vertexShader: `uniform float time; varying vec2 vXZ; varying float vWave;
        #include <fog_pars_vertex>
        void main() {
          vec3 p = position;
          float w = sin(p.x * 0.07 + time * 1.1) * 0.22 + sin(p.z * 0.09 + time * 0.8) * 0.18 + sin((p.x + p.z) * 0.21 + time * 2.0) * 0.06;
          p.y += w; vWave = w; vXZ = p.xz;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform vec3 shallow; uniform vec3 deep; uniform float time; uniform float islandHalf; varying vec2 vXZ; varying float vWave;
        #include <fog_pars_fragment>
        void main() {
          float d = max(abs(vXZ.x), abs(vXZ.y)) - islandHalf;
          vec3 col = mix(shallow, deep, clamp(d / 160.0, 0.0, 1.0));
          float foam = 1.0 - clamp((d - 15.0) / 8.0, 0.0, 1.0);
          foam *= 0.5 + 0.5 * sin(time * 2.2 - d * 0.9);
          float sparkle = pow(max(0.0, sin(vXZ.x * 0.6 + time * 1.9) * sin(vXZ.y * 0.55 - time * 1.6)), 14.0);
          col += vec3(1.0) * (sparkle * 0.45 + foam * 0.35) + vWave * 0.12;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      fog: true,
    });
    const water = new THREE.Mesh(geo, this.waterMat);
    water.position.y = -0.6;
    this.scene.add(water);
  }

  setTheme(name) {
    const t = THEMES[name] || THEMES.noon;
    this.theme = name;
    this.skyMat.uniforms.top.value.setHex(t.top);
    this.skyMat.uniforms.horizon.value.setHex(t.horizon);
    this.skyMat.uniforms.sunColor.value.setHex(t.sun);
    this.sunDir.set(...t.sunDir).normalize();
    this.skyMat.uniforms.sunDir.value.copy(this.sunDir);
    this.scene.fog.color.setHex(t.horizon);
    this.hemi.color.setHex(t.hemiSky); this.hemi.groundColor.setHex(t.hemiGround); this.hemi.intensity = t.hemiI;
    this.sun.color.setHex(t.sun); this.sun.intensity = t.sunI;
    this.waterMat.uniforms.shallow.value.setHex(t.shallow);
    this.waterMat.uniforms.deep.value.setHex(t.deep);
    this.cloudMat.color.setHex(t.cloud);
    this.cloudMat.emissive.setHex(t.cloud);
  }

  buildZone() {
    const geo = new THREE.CylinderGeometry(1, 1, 120, 96, 1, true);
    geo.translate(0, 60, 0);
    this.zoneMat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, radius: { value: 100 }, color: { value: new THREE.Color(0xff3cac) } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float time; uniform float radius; uniform vec3 color; varying vec2 vUv;
        void main() {
          float u = vUv.x * 6.2832 * radius / 5.0;
          float stripe = smoothstep(0.35, 0.5, fract(u + vUv.y * 40.0 - time * 0.8)) * smoothstep(0.85, 0.7, fract(u + vUv.y * 40.0 - time * 0.8));
          float fade = pow(1.0 - vUv.y, 2.2);
          float base = smoothstep(0.04, 0.0, vUv.y);
          float a = (0.16 + 0.12 * stripe) * fade + base * 0.5;
          vec3 c = mix(color, vec3(1.0), base * 0.6 + stripe * 0.15);
          gl_FragColor = vec4(c, a);
          #include <colorspace_fragment>
        }`,
      transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false,
    });
    this.zoneMesh = new THREE.Mesh(geo, this.zoneMat);
    this.zoneMesh.position.y = -1;
    this.zoneMesh.visible = false;
    this.zoneMesh.renderOrder = 5;
    this.scene.add(this.zoneMesh);
    const ringGeo = new THREE.RingGeometry(0.99, 1, 128);
    this.nextRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    this.nextRing.rotation.x = -Math.PI / 2; this.nextRing.position.y = 0.3; this.nextRing.visible = false;
    this.scene.add(this.nextRing);
  }

  setZone(z) {
    if (!z) { this.zoneMesh.visible = false; this.nextRing.visible = false; return; }
    this.zoneMesh.visible = true;
    this.zoneMesh.position.x = z.cx; this.zoneMesh.position.z = z.cz;
    const r = Math.max(0.5, z.r);
    this.zoneMesh.scale.set(r, 1, r);
    this.zoneMat.uniforms.radius.value = r;
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
    this.waterMat.uniforms.islandHalf.value = half;

    // ground + beach
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 + 30, half * 2 + 30), new THREE.MeshLambertMaterial({ color: 0xffe29a }));
    sand.rotation.x = -Math.PI / 2; sand.position.y = -0.05; sand.receiveShadow = true;
    g.add(sand);
    if (!this.grassTex) {
      this.grassTex = grassTexture();
      this.grassTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    }
    this.grassTex.repeat.set(half / 5, half / 5);
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), new THREE.MeshLambertMaterial({ map: this.grassTex }));
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
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ flatShading: true }), map.trees.length * 3);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let n = 0;
    for (const t of map.trees) {
      p.set(t.x, t.h + t.r * 0.4, t.z); s.set(t.r, t.r * 0.9, t.r);
      m4.compose(p, q, s); leaves.setMatrixAt(n, m4); leaves.setColorAt(n, tmpColor.setHex(t.c)); n++;
      p.set(t.x + t.r * 0.3, t.h + t.r * 1.1, t.z - t.r * 0.2); s.set(t.r * 0.65, t.r * 0.6, t.r * 0.65);
      m4.compose(p, q, s); leaves.setMatrixAt(n, m4); leaves.setColorAt(n, tmpColor.setHex(t.c).offsetHSL(0, 0, 0.08)); n++;
      p.set(t.x - t.r * 0.35, t.h + t.r * 0.75, t.z + t.r * 0.3); s.set(t.r * 0.55, t.r * 0.5, t.r * 0.55);
      m4.compose(p, q, s); leaves.setMatrixAt(n, m4); leaves.setColorAt(n, tmpColor.setHex(t.c).offsetHSL(0.02, 0, -0.05)); n++;
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

  setPickups(list) { this.clearPickups(); this.addPickups(list); }

  addPickups(list) {
    for (const [id, type, x, y, z, taken, fall] of list) {
      const grp = makePickup(type);
      grp.position.set(x, y + 0.65, z);
      grp.userData.baseY = y + (type === 'drop' ? 0 : 0.65);
      grp.userData.type = type;
      grp.userData.landAt = fall ? this.time + fall : 0;
      grp.visible = !taken;
      grp.userData.taken = !!taken;
      this.scene.add(grp);
      this.pickupMeshes.set(id, grp);
    }
  }

  takePickup(id) { const m = this.pickupMeshes.get(id); if (m) { m.visible = false; m.userData.taken = true; } }

  updatePickups(dt) {
    const cam = this.camera.position;
    for (const m of this.pickupMeshes.values()) {
      if (m.userData.taken) continue;
      const type = m.userData.type;
      if (type === 'drop') {
        const left = Math.max(0, m.userData.landAt - this.time);
        m.position.y = m.userData.baseY + left * DROP_FALL_SPEED;
        m.userData.chute.visible = left > 0;
        m.rotation.y += dt * 0.3;
        m.userData.beam.material.opacity = 0.35 + Math.sin(this.time * 4) * 0.12;
        continue;
      }
      m.visible = Math.abs(m.position.x - cam.x) < 90 && Math.abs(m.position.z - cam.z) < 90;
      if (!m.visible) continue;
      m.rotation.y += dt * 1.5;
      m.position.y = m.userData.baseY + Math.sin(this.time * 2 + m.position.x) * 0.1;
    }
  }

  // ------------------------------------------------------------- avatars
  ensureAvatar(info) {
    let a = this.avatars.get(info.id);
    if (a && a.cls === info.cls) return a;
    if (a) this.removeAvatar(info.id);
    a = makeAvatar(info, this.glintTex);
    a.pos = new THREE.Vector3(); a.target = new THREE.Vector3(); a.yaw = 0; a.targetYaw = 0; a.walk = 0; a.fresh = true;
    a.color = info.color;
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
    const cam = this.camera.position;
    for (const a of this.avatars.values()) {
      if (a.fresh) { a.pos.copy(a.target); a.yaw = a.targetYaw; a.fresh = false; }
      const bx = a.pos.x, bz = a.pos.z;
      a.pos.lerp(a.target, Math.min(1, dt * 14));
      let dy = a.targetYaw - a.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      a.yaw += dy * Math.min(1, dt * 14);
      const speed = Math.hypot(a.pos.x - bx, a.pos.z - bz) / Math.max(dt, 1e-3);
      a.walk += speed * dt * 1.6;
      a.root.position.copy(a.pos);
      a.root.rotation.y = a.yaw;
      const swing = Math.min(1, speed / 6) * Math.sin(a.walk) * 0.7;
      a.legL.rotation.x = swing; a.legR.rotation.x = -swing;
      a.body.scale.y = a.crouch ? 0.72 : 1;
      a.body.position.y = speed > 0.5 ? Math.abs(Math.sin(a.walk)) * 0.05 : 0;
      a.chute.visible = !!a.glide;
      a.gun.rotation.set(-a.pitch * 0.8, 0, 0);
      a.gun.position.z = -0.25;
      if (a.swingT > 0) {
        a.swingT -= dt;
        const prog = 1 - a.swingT / 0.25, sw = Math.sin(prog * Math.PI);
        switch (a.swingKind) {
          case 'backhand': a.gun.rotation.y = sw * 1.4; break;
          case 'finisher': a.gun.rotation.z = prog * Math.PI * 2; a.gun.rotation.x = -sw * 0.8; break;
          case 'lunge': a.gun.position.z = -0.25 - sw * 0.5; break;
          case 'slam': a.gun.rotation.x = sw * 1.6; break;
          case 'throw': a.gun.rotation.x = -sw * 1.8; break;
          default: a.gun.rotation.x = -sw * 1.2;
        }
      }
      a.crown.visible = !!a.bounty;
      if (a.bounty) a.crown.position.y = 2.75 + Math.sin(this.time * 3) * 0.08;
      // sniper scope glint: stays the same size on screen so it can be spotted from far away
      a.glint.visible = !!a.scope;
      if (a.scope) {
        const d = a.pos.distanceTo(cam);
        const s = Math.max(0.6, d * 0.022) * (0.85 + Math.sin(this.time * 18) * 0.15);
        a.glint.scale.set(s, s, 1);
      }
    }
  }

  // ------------------------------------------------------------- grenades
  addNade(id) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(GRENADE.r, 12, 8), new THREE.MeshLambertMaterial({ color: 0x3ddc97, emissive: 0x0a4020 }));
    const band = new THREE.Mesh(new THREE.TorusGeometry(GRENADE.r * 0.95, 0.03, 6, 14), new THREE.MeshLambertMaterial({ color: 0xffd60a }));
    band.rotation.x = Math.PI / 2;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2d55 }));
    led.position.y = GRENADE.r;
    g.add(body, band, led);
    g.userData.led = led;
    body.castShadow = this.highQuality;
    this.scene.add(g);
    this.nadeMeshes.set(id, g);
    return g;
  }

  removeNade(id) { const g = this.nadeMeshes.get(id); if (g) { this.scene.remove(g); this.nadeMeshes.delete(id); } }
  clearNades() { for (const id of [...this.nadeMeshes.keys()]) this.removeNade(id); }

  setNade(id, x, y, z, fuseLeft) {
    const g = this.nadeMeshes.get(id);
    if (!g) return;
    g.position.set(x, y, z);
    g.rotation.x += 0.2; g.rotation.z += 0.13;
    const blink = Math.sin(this.time * (fuseLeft < 0.8 ? 40 : 12)) > 0;
    g.userData.led.material.color.setHex(blink ? 0xff2d55 : 0x330000);
  }

  buildArc() {
    const N = 80;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.arc = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.11, transparent: true, opacity: 0.9, depthWrite: false }));
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.scene.add(this.arc);
    this.arcLand = new THREE.Group();
    const inner = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 24), new THREE.MeshBasicMaterial({ color: 0xffd60a, side: THREE.DoubleSide, transparent: true, depthWrite: false }));
    const outer = new THREE.Mesh(new THREE.RingGeometry(GRENADE.radius - 0.15, GRENADE.radius, 64), new THREE.MeshBasicMaterial({ color: 0xff4d6d, side: THREE.DoubleSide, transparent: true, opacity: 0.55, depthWrite: false }));
    inner.rotation.x = outer.rotation.x = -Math.PI / 2;
    this.arcLand.add(inner, outer);
    this.arcLand.visible = false;
    this.scene.add(this.arcLand);
  }

  // points: flat array [x,y,z,...]; land: [x,y,z] or null
  setArc(points, land) {
    if (!points) { this.arc.visible = false; this.arcLand.visible = false; return; }
    const attr = this.arc.geometry.attributes.position;
    const n = Math.min(attr.count, points.length / 3);
    attr.array.set(points.slice(0, n * 3));
    this.arc.geometry.setDrawRange(0, n);
    attr.needsUpdate = true;
    this.arc.visible = true;
    this.arcLand.visible = !!land;
    if (land) this.arcLand.position.set(land[0], land[1] + 0.08, land[2]);
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
    this.addPuff(from, 0xffe066, 0.12, 0.08);
  }

  addPuff(p, color, size = 0.25, life = 0.35) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(size, 0), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    m.position.copy(p);
    this.scene.add(m);
    this.effects.push({ obj: m, life, max: life, fade: true, grow: 3 });
  }

  addSwing(id, kind = 'slash') { const a = this.avatars.get(id); if (a) { a.swingT = 0.25; a.swingKind = kind; } }

  // A spinning knife flying from o to e.
  throwKnife(o, e) {
    const from = new THREE.Vector3(...o), to = new THREE.Vector3(...e);
    const g = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.32), new THREE.MeshBasicMaterial({ color: 0xe0f7ff }));
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.36), new THREE.MeshBasicMaterial({ color: 0xff3c8e, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.add(blade, glow);
    g.position.copy(from);
    g.lookAt(to);
    this.scene.add(g);
    this.projectiles.push({ obj: g, from, to, t: 0, dur: Math.max(0.05, from.distanceTo(to) / 45) });
  }

  // Shockwave where a knife ground-slam lands.
  slamFx(pos) {
    const p = new THREE.Vector3(...pos);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 40), new THREE.MeshBasicMaterial({ color: 0xff3c8e, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.copy(p); ring.position.y += 0.1;
    this.scene.add(ring);
    this.effects.push({ obj: ring, life: 0.45, max: 0.45, fade: true, grow: 3.4 });
    this.burst(p.clone().add(new THREE.Vector3(0, 0.3, 0)), [0xff3c8e, 0xffffff, 0xb388ff], 30, 6, 0.8, 0.2);
    const d = p.distanceTo(this.camera.position);
    this.shake = Math.max(this.shake, Math.max(0, 1 - d / 15) * 0.6);
  }

  // Colourful particle burst (confetti, sparks, debris).
  burst(pos, colors, count = 30, speed = 6, life = 1.2, size = 0.22, gravity = 14) {
    const geo = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3), c = new Float32Array(count * 3), v = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      p[i * 3] = pos.x; p[i * 3 + 1] = pos.y; p[i * 3 + 2] = pos.z;
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.1, Math.random() - 0.5).normalize();
      const sp = speed * (0.4 + Math.random() * 0.8);
      v[i * 3] = dir.x * sp; v[i * 3 + 1] = dir.y * sp; v[i * 3 + 2] = dir.z * sp;
      tmpColor.set(colors[i % colors.length]);
      c[i * 3] = tmpColor.r; c[i * 3 + 1] = tmpColor.g; c[i * 3 + 2] = tmpColor.b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size, vertexColors: true, transparent: true, depthWrite: false }));
    pts.frustumCulled = false;
    this.scene.add(pts);
    this.particles.push({ obj: pts, v, life, max: life, gravity });
  }

  explode(pos) {
    const p = new THREE.Vector3(...pos);
    const flash = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.position.copy(p);
    this.scene.add(flash);
    this.effects.push({ obj: flash, life: 0.25, max: 0.25, fade: true, grow: 5 });
    const fireCols = [0xff9e00, 0xff4d6d, 0xffd60a, 0xf15bb5];
    for (let i = 0; i < 5; i++) {
      const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 + Math.random() * 0.6, 0), new THREE.MeshBasicMaterial({ color: fireCols[i % 4], transparent: true, depthWrite: false }));
      f.position.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.2, (Math.random() - 0.5) * 2));
      this.scene.add(f);
      this.effects.push({ obj: f, life: 0.7, max: 0.7, fade: true, grow: 2.2, rise: 2.5 });
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.copy(p); ring.position.y += 0.15;
    this.scene.add(ring);
    this.effects.push({ obj: ring, life: 0.5, max: 0.5, fade: true, grow: GRENADE.radius });
    this.burst(p, [0xffd60a, 0xff4d6d, 0x4cc9f0, 0x3ddc97, 0xb388ff, 0xffffff], 70, 13, 1.4, 0.28);
    this.boomLight.position.copy(p).add(new THREE.Vector3(0, 1.5, 0));
    this.boomLight.intensity = 60;
    const d = p.distanceTo(this.camera.position);
    this.shake = Math.max(this.shake, Math.max(0, 1 - d / 35) * 0.9);
  }

  updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life -= dt;
      const k = Math.max(0, e.life / e.max);
      if (e.fade) e.obj.material.opacity = k * 0.9;
      if (e.grow) e.obj.scale.setScalar(1 + (1 - k) * e.grow);
      if (e.rise) e.obj.position.y += e.rise * dt;
      if (e.life <= 0) {
        this.scene.remove(e.obj); e.obj.geometry.dispose(); e.obj.material.dispose();
        this.effects.splice(i, 1);
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const P = this.particles[i];
      P.life -= dt;
      const pos = P.obj.geometry.attributes.position.array, v = P.v;
      for (let k = 0; k < v.length; k += 3) {
        v[k + 1] -= P.gravity * dt;
        v[k] *= 1 - dt * 0.8; v[k + 2] *= 1 - dt * 0.8;
        pos[k] += v[k] * dt; pos[k + 1] += v[k + 1] * dt; pos[k + 2] += v[k + 2] * dt;
        if (pos[k + 1] < 0.05) { pos[k + 1] = 0.05; v[k + 1] *= -0.3; }
      }
      P.obj.geometry.attributes.position.needsUpdate = true;
      P.obj.material.opacity = Math.min(1, P.life / P.max * 2);
      if (P.life <= 0) {
        this.scene.remove(P.obj); P.obj.geometry.dispose(); P.obj.material.dispose();
        this.particles.splice(i, 1);
      }
    }
    this.boomLight.intensity = Math.max(0, this.boomLight.intensity - dt * 220);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const P = this.projectiles[i];
      P.t += dt;
      const k = Math.min(1, P.t / P.dur);
      P.obj.position.lerpVectors(P.from, P.to, k);
      P.obj.children[0].rotation.x += dt * 30; P.obj.children[1].rotation.x = P.obj.children[0].rotation.x;
      if (k >= 1) {
        this.scene.remove(P.obj);
        P.obj.traverse((o) => { if (o.geometry) { o.geometry.dispose(); o.material.dispose(); } });
        this.addPuff(P.to, 0xff8fd8, 0.15, 0.25);
        this.projectiles.splice(i, 1);
      }
    }
  }

  clearEffects() {
    for (const e of [...this.effects, ...this.particles]) { this.scene.remove(e.obj); e.obj.geometry.dispose(); e.obj.material.dispose(); }
    for (const P of this.projectiles) this.scene.remove(P.obj);
    this.effects = []; this.particles = []; this.projectiles = [];
  }

  // world position -> CSS pixel coordinates (or null if behind the camera)
  project(v) {
    const p = v.clone().project(this.camera);
    if (p.z > 1) return null;
    return [(p.x * 0.5 + 0.5) * window.innerWidth, (-p.y * 0.5 + 0.5) * window.innerHeight];
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
      C(0.035, 0.26, dark, 0, 0.09, -0.12), C(0.038, 0.02, teal, 0, 0.09, -0.26), B(0.04, 0.1, 0.05, glove, 0, -0.08, 0.05),
      B(0.075, 0.02, 0.2, L(0xffd60a), 0, 0.055, -0.1));
    // rifle
    const rf = new THREE.Group();
    const orange = L(0xff8a1f), black = L(0x333344), yellow = L(0xffd60a, 0x332200);
    rf.add(B(0.08, 0.12, 0.45, orange, 0, 0, -0.05), C(0.02, 0.3, black, 0, 0.02, -0.42), B(0.05, 0.16, 0.08, black, 0, -0.12, -0.08),
      B(0.06, 0.1, 0.18, black, 0, -0.02, 0.24), B(0.03, 0.04, 0.12, yellow, 0, 0.08, -0.05), B(0.04, 0.1, 0.05, glove, 0, -0.08, 0.06),
      B(0.082, 0.03, 0.1, L(0x4cc9f0, 0x103040), 0, 0.03, -0.2));
    // knife
    const kn = new THREE.Group();
    const blade = new THREE.MeshLambertMaterial({ color: 0xe0f7ff, emissive: 0xff3c8e, emissiveIntensity: 0.4 });
    kn.add(B(0.035, 0.035, 0.14, L(0x6d597a), 0, 0, 0.06), B(0.07, 0.02, 0.02, L(0xffd60a), 0, 0, -0.02), B(0.012, 0.045, 0.26, blade, 0, 0.005, -0.16),
      B(0.06, 0.06, 0.08, glove, 0, -0.01, 0.08));
    kn.rotation.y = 0.2;
    // grenade in the off hand (shown while aiming a throw)
    const gn = new THREE.Group();
    gn.add(new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 8), L(0x3ddc97, 0x0a4020)), B(0.04, 0.035, 0.04, glove, 0, -0.03, 0.012));
    gn.visible = false;
    this.vmNade = gn;
    this.vmScene.add(gn);
    this.vm = { sniper: sn, rifle: rf, melee: kn };
    for (const k in this.vm) { this.vm[k].visible = false; this.vmScene.add(this.vm[k]); }
    // muzzle flash
    this.flash = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), new THREE.MeshBasicMaterial({ color: 0xfff3b0 }));
    this.flash.visible = false;
    this.vmScene.add(this.flash);
    this.vmState = { kick: 0, swing: 0, bob: 0, flashT: 0, cls: null, kind: 'slash', slamHold: false };
  }

  setViewmodel(cls) {
    for (const k in this.vm) this.vm[k].visible = k === cls;
    this.vmState.cls = cls;
  }

  vmFire(cls, kind = 'slash') {
    if (cls === 'melee') { this.vmState.swing = 1; this.vmState.kind = kind; }
    else { this.vmState.kick = 1; this.vmState.flashT = 0.05; }
  }

  updateViewmodel(dt, moving, aimK, reloadK, visible, nadeAim) {
    const st = this.vmState, cls = st.cls;
    const g = this.vm[cls];
    if (!g) return;
    g.visible = visible;
    st.kick = Math.max(0, st.kick - dt * 8);
    st.swing = Math.max(0, st.swing - dt * (st.kind === 'finisher' ? 3 : 4));
    st.bob += dt * (moving ? 9 : 2);
    const bobA = moving ? 0.012 : 0.004;
    const hip = { x: 0.2, y: -0.19, z: -0.42 }, aim = { x: 0, y: cls === 'sniper' ? -0.09 : -0.115, z: -0.36 };
    if (cls === 'melee') { hip.x = 0.24; hip.y = -0.2; hip.z = -0.38; }
    const x = hip.x + (aim.x - hip.x) * aimK, y = hip.y + (aim.y - hip.y) * aimK, z = hip.z + (aim.z - hip.z) * aimK;
    g.position.set(x + Math.cos(st.bob) * bobA, y + Math.abs(Math.sin(st.bob)) * bobA - reloadK * 0.25 - (nadeAim ? 0.08 : 0), z + st.kick * 0.07);
    g.rotation.x = st.kick * 0.12 - reloadK * 0.9;
    if (cls === 'melee') {
      // each knife move has its own animation
      const prog = 1 - st.swing, s = Math.sin(st.swing * Math.PI);
      g.rotation.y = 0.2; g.rotation.z = 0;
      switch (st.kind) {
        case 'backhand': g.rotation.y = 0.2 - s * 1.5; g.rotation.z = -s * 0.5; g.position.x -= s * 0.28; g.position.y += s * 0.04; break;
        case 'finisher': g.rotation.z = st.swing > 0 ? -prog * Math.PI * 2 : 0; g.rotation.x = -s * 0.6; g.position.x -= s * 0.12; g.position.z -= s * 0.25; break;
        case 'lunge': g.rotation.x = s * 0.15; g.position.z -= s * 0.38; g.position.x -= s * 0.14; break;
        case 'slam': g.rotation.x = s * 1.5; g.position.y += s * 0.12; break;
        case 'throw': g.rotation.x = -s * 1.3; g.position.z -= s * 0.25; g.visible = visible && (st.swing < 0.15 || st.swing > 0.75); break;
        default: g.rotation.x = -s * 1.1; g.rotation.z = s * 0.6; g.position.x -= s * 0.15; g.position.z -= s * 0.15;
      }
      if (st.slamHold) { g.rotation.x = 1.4; g.position.y += 0.1; } // knife raised while diving down
    }
    this.vmNade.visible = visible && nadeAim;
    if (nadeAim) this.vmNade.position.set(-0.24, -0.19 + Math.sin(this.time * 6) * 0.004, -0.55);
    st.flashT -= dt;
    this.flash.visible = visible && st.flashT > 0 && cls !== 'melee';
    if (this.flash.visible) this.flash.position.set(g.position.x, g.position.y + 0.02, g.position.z - (cls === 'sniper' ? 0.95 : 0.6));
  }

  // ------------------------------------------------------------- frame
  render(dt, showVm) {
    this.time += dt;
    this.updateAvatars(dt);
    this.updateEffects(dt);
    this.updatePickups(dt);
    this.zoneMat.uniforms.time.value = this.time;
    this.waterMat.uniforms.time.value = this.time;
    this.clouds.rotation.y += dt * 0.004;
    const cam = this.camera.position;
    this.sky.position.copy(cam);
    // screen shake (explosions, hard landings)
    let sx = 0, sy = 0;
    if (this.shake > 0.001) {
      sx = (Math.random() - 0.5) * this.shake * 0.05; sy = (Math.random() - 0.5) * this.shake * 0.05;
      this.camera.rotation.x += sx; this.camera.rotation.y += sy;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    // shadow camera follows the viewer
    this.sun.position.copy(cam).addScaledVector(this.sunDir, 150);
    this.sun.target.position.set(cam.x, 0, cam.z);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.camera.rotation.x -= sx; this.camera.rotation.y -= sy;
    if (showVm) {
      this.renderer.clearDepth();
      this.renderer.render(this.vmScene, this.vmCamera);
    }
  }
}

// Builds one BufferGeometry for many axis-aligned boxes, coloured per box. Walls get a darker
// base (cheap fake ambient occlusion) so buildings look grounded.
function boxesGeometry(list) {
  const n = list.length;
  const pos = new Float32Array(n * 24 * 3), nor = new Float32Array(n * 24 * 3), col = new Float32Array(n * 24 * 3);
  const idx = new Uint32Array(n * 36);
  let v = 0, ii = 0;
  const faces = [
    // normal, 4 corners (as [x?,y?,z?] selectors: 0=min 1=max), face shade
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
    const tall = b.y1 - b.y0 > 1;
    for (const [nrm, corners, shade] of faces) {
      const base = v;
      const side = nrm[1] === 0;
      for (const [cx, cy, cz] of corners) {
        pos[v * 3] = xs[cx]; pos[v * 3 + 1] = ys[cy]; pos[v * 3 + 2] = zs[cz];
        nor[v * 3] = nrm[0]; nor[v * 3 + 1] = nrm[1]; nor[v * 3 + 2] = nrm[2];
        const ao = side && cy === 0 ? (tall ? 0.68 : 0.8) : side ? 1.04 : 1;
        const k = shade * ao;
        col[v * 3] = tmpColor.r * k; col[v * 3 + 1] = tmpColor.g * k; col[v * 3 + 2] = tmpColor.b * k;
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

function makePickup(type) {
  const grp = new THREE.Group();
  const L = (c, e = 0) => new THREE.MeshLambertMaterial({ color: c, emissive: e });
  const ringCol = { med: 0xff4d6d, shield: 0x4cc9f0, coin: 0xffc300, gem: 0xff5ef0, nade: 0x3ddc97, bag: 0xb388ff, drop: 0xffd60a }[type] || 0xffffff;
  if (type === 'med') {
    const red = new THREE.MeshBasicMaterial({ color: 0xff2d55 });
    grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.45), L(0xffffff, 0x442222)),
      new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.47), red), new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.47), red));
  } else if (type === 'coin') {
    const gold = L(0xffc300, 0x664400);
    for (let k = 0; k < 3; k++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.07, 16), gold);
      c.position.set(k * 0.05 - 0.05, k * 0.09 - 0.1, 0); grp.add(c);
    }
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 16), gold);
    up.rotation.x = Math.PI / 2; up.position.set(0.15, 0.2, 0); grp.add(up);
  } else if (type === 'gem') {
    const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), new THREE.MeshLambertMaterial({ color: 0xff5ef0, emissive: 0x7a1070, flatShading: true }));
    gem.scale.y = 1.4;
    grp.add(gem, beam(0xff5ef0, 0.08, 4));
  } else if (type === 'nade') {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), L(0x3ddc97, 0x0a4020));
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.035, 6, 14), L(0xffd60a));
    band.rotation.x = Math.PI / 2;
    const pin = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 10), L(0xcccccc));
    pin.position.y = 0.24;
    grp.add(s, band, pin);
  } else if (type === 'bag') {
    const sack = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), new THREE.MeshLambertMaterial({ color: 0xb388ff, emissive: 0x30105a, flatShading: true }));
    sack.scale.y = 0.85;
    const tie = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.25, 8), L(0xffd60a));
    tie.position.y = 0.32;
    grp.add(sack, tie, beam(0xb388ff, 0.1, 7));
  } else if (type === 'drop') {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 1.3), L(0xff9e00, 0x331a00));
    crate.position.y = 0.55;
    const strapM = L(0x2b2d42);
    const s1 = new THREE.Mesh(new THREE.BoxGeometry(1.34, 1.14, 0.2), strapM); s1.position.y = 0.55;
    const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.14, 1.34), strapM); s2.position.y = 0.55;
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    star.position.y = 1.35;
    const chute = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.4),
      new THREE.MeshLambertMaterial({ color: 0xff4d6d, side: THREE.DoubleSide }));
    chute.position.y = 5; chute.scale.y = 0.55;
    const b = beam(0xffd60a, 0.45, 120);
    b.material.fog = false;
    grp.add(crate, s1, s2, star, chute, b);
    grp.userData.chute = chute;
    grp.userData.beam = b;
    crate.castShadow = true;
    return grp;
  } else {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), L(0x4cc9f0, 0x2050a0));
    gem.scale.y = 1.3;
    grp.add(gem);
  }
  const glow = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 24), new THREE.MeshBasicMaterial({ color: ringCol, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
  glow.rotation.x = -Math.PI / 2; glow.position.y = -0.55;
  grp.add(glow);
  return grp;
}

function beam(color, r, h) {
  const geo = new THREE.CylinderGeometry(r, r * 1.6, h, 10, 1, true);
  geo.translate(0, h / 2 - 0.6, 0);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  return m;
}

function makeAvatar(info, glintTex) {
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
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.08, 14), clsCol);
  belt.position.y = 0.72;
  body.add(belt);
  const legGeo = new THREE.BoxGeometry(0.18, 0.55, 0.2); legGeo.translate(0, -0.27, 0);
  const legL = new THREE.Mesh(legGeo, dark); legL.position.set(-0.14, 0.6, 0);
  const legR = new THREE.Mesh(legGeo, dark); legR.position.set(0.14, 0.6, 0);
  body.add(legL, legR);
  // arms reaching forward to the weapon
  const armGeo = new THREE.BoxGeometry(0.13, 0.13, 0.5); armGeo.translate(0, 0, -0.22);
  const armL = new THREE.Mesh(armGeo, mat); armL.position.set(-0.3, 1.2, 0); armL.rotation.set(0.35, -0.45, 0);
  const armR = new THREE.Mesh(armGeo, mat); armR.position.set(0.33, 1.2, 0); armR.rotation.set(0.3, 0.05, 0);
  body.add(armL, armR);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12), skin);
  head.position.y = 1.6; head.castShadow = true;
  body.add(head);
  const eyeGeo = new THREE.BoxGeometry(0.07, 0.09, 0.02);
  const e1 = new THREE.Mesh(eyeGeo, black); e1.position.set(-0.09, 1.64, -0.255);
  const e2 = new THREE.Mesh(eyeGeo, black); e2.position.set(0.09, 1.64, -0.255);
  const cheekM = new THREE.MeshBasicMaterial({ color: 0xff8fab });
  const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.02), cheekM); c1.position.set(-0.15, 1.56, -0.235);
  const c2 = c1.clone(); c2.position.x = 0.15;
  body.add(e1, e2, c1, c2);
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
  // bounty crown
  const crown = makeEmojiSprite('👑', 0.75);
  crown.visible = false;
  root.add(crown);
  // sniper scope glint
  const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  glint.position.set(0.15, 1.62, -0.6);
  glint.visible = false;
  body.add(glint);
  return { root, body, legL, legR, gun, chute, tag, crown, glint, cls: info.cls, swingT: 0, pitch: 0 };
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

function makeEmojiSprite(ch, size) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.font = '52px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(ch, 32, 36);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  s.scale.set(size, size, 1);
  s.position.y = 2.75;
  return s;
}

function radialTexture(c0, c1, c2) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, c0); gr.addColorStop(0.25, c1); gr.addColorStop(1, c2);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  // star spikes
  g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, 32); g.lineTo(64, 32); g.moveTo(32, 0); g.lineTo(32, 64); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function grassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#7ed957'; g.fillRect(0, 0, 256, 256);
  // soft patches
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 20 + Math.random() * 40;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const light = Math.random() < 0.5;
    gr.addColorStop(0, light ? 'rgba(170,240,110,0.35)' : 'rgba(70,170,70,0.3)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    for (const dx of [-256, 0, 256]) for (const dy of [-256, 0, 256]) { g.save(); g.translate(dx, dy); g.fillRect(x - r, y - r, r * 2, r * 2); g.restore(); }
  }
  // blades
  for (let i = 0; i < 1800; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    g.fillStyle = Math.random() < 0.5 ? 'rgba(60,150,50,0.5)' : 'rgba(180,250,120,0.45)';
    g.fillRect(x, y, 1.5, 3 + Math.random() * 3);
  }
  // tiny flowers
  const fl = ['#ffffff', '#ffd60a', '#ff8fab', '#b388ff'];
  for (let i = 0; i < 26; i++) {
    g.fillStyle = fl[i % fl.length];
    g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, 1.6, 0, 7); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
