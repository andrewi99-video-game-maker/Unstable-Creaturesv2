import * as THREE from 'three';
import { MAPK, MapKey, SceneKey, SolidBox, CrateObj, PickupObj } from './types';
import {
  createWoodTextures,
  createStoneTileTextures,
  createCautionStripeTextures,
  createCircuitTextures,
  createTropicalIslandTexture,
  createCrateTexture,
  createAnimatedOcean,
  PBRTexSet,
} from './textures';
import { wpModel, OLM } from './models';

export interface AmbientParticleSet {
  points: THREE.Points;
  speeds: Float32Array;
  baseY: Float32Array;
  drift: number;
  rise: number;
  wrapTop: number;
  wrapBot: number;
}

export interface WorldData {
  groups: Record<SceneKey, THREE.Group>;
  solids: Record<SceneKey, SolidBox[]>;
  crates: Record<SceneKey, CrateObj[]>;
  pk: Record<SceneKey, PickupObj[]>;
  SPW: Record<MapKey, [number, number][]>;
  movers: { s: SolidBox; f: (t: number) => [number, number]; scene: SceneKey }[];
  oceans: Partial<Record<SceneKey, { mesh: THREE.Mesh; uniforms: { uTime: { value: number }; uColor: { value: THREE.Color } } }>>;
  lavaMat: THREE.MeshStandardMaterial | null;
  checkerTiles: { s: SolidBox; baseTop: number; baseY: number; idx: number }[];
  particles: Partial<Record<SceneKey, AmbientParticleSet>>;
  groundY: (g: MapKey, x: number, z: number) => number;
}

export function setCratePos(c: CrateObj, x: number, y: number, z: number): void {
  const q = c.s;
  q.dx += x - c.x;
  q.dy += y - c.y;
  q.dz += z - c.z;
  c.x = x;
  c.y = y;
  c.z = z;
  q.x = x;
  q.z = z;
  q.bottom = y;
  q.top = y + 1.2;
  q.m.position.set(x, y + 0.6, z);
}

export function holdCrateFlag(c: CrateObj, h: number, l = false): void {
  c.held = h;
  c.lift = !!h && !!l;
  c.s.held = c.lift;
}

export function buildWorlds(scene: THREE.Scene): WorldData {
  const groups = {} as Record<SceneKey, THREE.Group>;
  const solids = {} as Record<SceneKey, SolidBox[]>;
  const crates = {} as Record<SceneKey, CrateObj[]>;
  const pk = {} as Record<SceneKey, PickupObj[]>;
  const SPW = {} as Record<MapKey, [number, number][]>;
  const movers: WorldData['movers'] = [];
  const oceans: WorldData['oceans'] = {};
  const checkerTiles: WorldData['checkerTiles'] = [];
  const particles: WorldData['particles'] = {};
  let lavaMat: THREE.MeshStandardMaterial | null = null;

  const allKeys: SceneKey[] = ['lobby', ...MAPK];
  for (const k of allKeys) {
    groups[k] = new THREE.Group();
    solids[k] = [];
    crates[k] = [];
    pk[k] = [];
    scene.add(groups[k]);
  }

  const light = (g: SceneKey, x: number, y: number, z: number, c: string, i = 1.2, d = 34) => {
    const l = new THREE.PointLight(c, i, d);
    l.position.set(x, y, z);
    groups[g].add(l);
    return l;
  };

  const prop = (
    g: SceneKey,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
    shadow = true
  ) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = shadow;
    m.receiveShadow = true;
    groups[g].add(m);
    return m;
  };

  const addAmbientParticles = (
    g: SceneKey,
    color: string,
    count: number,
    spread: number,
    yMin: number,
    yMax: number,
    rise: number,
    size = 0.24
  ) => {
    const pos = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    const baseY = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * spread * 2;
      const y = yMin + Math.random() * (yMax - yMin);
      pos[i * 3 + 1] = y;
      baseY[i] = y;
      pos[i * 3 + 2] = (Math.random() - 0.5) * spread * 2;
      speeds[i] = 0.6 + Math.random() * 0.9;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color,
      size,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geo, mat);
    groups[g].add(points);
    particles[g] = { points, speeds, baseY, drift: 0.55, rise, wrapTop: yMax, wrapBot: yMin };
  };

  const M = (c: string, r = 0.55, m = 0.1, e?: string) =>
    new THREE.MeshStandardMaterial({
      color: c,
      roughness: r,
      metalness: m,
      emissive: e || '#000000',
      emissiveIntensity: e ? 1.15 : 0,
    });

  const box = (
    g: SceneKey,
    x: number,
    top: number,
    z: number,
    w: number,
    h: number,
    d: number,
    col: string,
    emi = false,
    texSet?: Partial<PBRTexSet>,
    sideCol?: string
  ): SolidBox => {
    let mat: THREE.Material | THREE.Material[];
    const rough = texSet?.roughness ?? 0.5;
    const metal = texSet?.metalness ?? 0.12;
    if (texSet && h > 3) {
      const sm = new THREE.MeshStandardMaterial({
        color: sideCol || new THREE.Color(col).multiplyScalar(0.55),
        roughness: 0.78,
        bumpMap: texSet.bumpMap || null,
        bumpScale: 0.05,
      });
      const tm = new THREE.MeshStandardMaterial({
        color: col,
        roughness: rough,
        metalness: metal,
        map: texSet.map || null,
        bumpMap: texSet.bumpMap || null,
        bumpScale: 0.06,
        roughnessMap: texSet.roughnessMap || null,
        emissiveMap: texSet.emissiveMap || null,
        emissive: texSet.emissiveMap ? new THREE.Color('#ffffff') : new THREE.Color('#000000'),
        emissiveIntensity: texSet.emissiveMap ? 1.0 : 0,
      });
      mat = [sm, sm, tm, sm, sm, sm];
    } else {
      mat = new THREE.MeshStandardMaterial({
        color: col,
        emissive: emi ? col : texSet?.emissiveMap ? '#ffffff' : '#000000',
        emissiveIntensity: emi ? 1.45 : texSet?.emissiveMap ? 0.9 : 0,
        roughness: rough,
        metalness: metal,
        map: texSet?.map || null,
        bumpMap: texSet?.bumpMap || null,
        bumpScale: 0.05,
        roughnessMap: texSet?.roughnessMap || null,
        emissiveMap: texSet?.emissiveMap || null,
      });
    }
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, top - h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    groups[g].add(m);
    const s: SolidBox = { x, z, hw: w / 2, hd: d / 2, top, bottom: top - h, m, dx: 0, dy: 0, dz: 0, held: false };
    if (!emi) solids[g].push(s);
    return s;
  };

  const slab = (
    g: SceneKey,
    x: number,
    top: number,
    z: number,
    w: number,
    d: number,
    texSet: Partial<PBRTexSet>,
    sideCol: string,
    tint = '#ffffff'
  ) => box(g, x, top, z, w, 12 + top, d, tint, false, texSet, sideCol);

  const addMover = (g: SceneKey, x: number, top: number, z: number, w: number, h: number, d: number, col: string, f: (t: number) => [number, number]) => {
    const s = box(g, x, top, z, w, h, d, col, false, { roughness: 0.25, metalness: 0.5 });
    movers.push({ s, f, scene: g });
    return s;
  };

  const ringPts = (a: number, b: number, n: number): [number, number][] =>
    Array.from({ length: n }, (_, i) => {
      const t = (i / n) * Math.PI * 2;
      const r = i % 2 ? a : b;
      return [Math.cos(t) * r, Math.sin(t) * r];
    });

  // Reusable high-res 512px PBR textures
  const lobbyFloorTex = createStoneTileTextures('#4d4b94', '#393770', 10, '#818cf8');
  const woodDeckTex = createWoodTextures('#9a6836', '#7b4f24', 6);
  const crateTex = createCrateTexture();
  const cautionTex = createCautionStripeTextures('#3f3f46', '#f59e0b', 6);

  // ==================== LOBBY ====================
  box('lobby', 0, 0, 0, 40, 1, 40, '#ffffff', false, lobbyFloorTex);
  box('lobby', 0, 1, -15, 14, 1, 6, '#ec4899');
  box('lobby', 0, 6.5, -19.6, 16, 5, 0.3, '#6366f1', true);
  // Decorative stage truss & disco orb overhead
  prop('lobby', new THREE.CylinderGeometry(0.18, 0.18, 18, 8), M('#94a3b8', 0.3, 0.8), 0, 9.5, -15.5, 0, 0, Math.PI / 2);
  prop('lobby', new THREE.IcosahedronGeometry(1.15, 1), M('#e2e8f0', 0.15, 0.95, '#a855f7'), 0, 7.8, -14.5);
  light('lobby', 0, 7, -12, '#f472b6', 2.0, 38);
  light('lobby', -14, 5, 6, '#38bdf8', 1.5, 34);
  light('lobby', 14, 5, 6, '#fbbf24', 1.5, 34);
  light('lobby', 0, 7, 0, '#ffffff', 0.85, 48);
  [[-12, -10], [12, -10], [-12, 8], [12, 8], [0, 13]].forEach(([x, z], i) => {
    const c = ['#fb7185', '#38bdf8', '#a78bfa', '#34d399', '#fbbf24'][i];
    box('lobby', x, 0.8, z, 4, 0.8, 1.4, c);
    box('lobby', x, 1.7, z + (z > 0 ? 0.6 : -0.6), 4, 0.9, 0.3, c);
  });
  for (let i = 0; i < 4; i++) {
    box('lobby', -18.5, 2.2, -9 + i * 4, 1.2, 2.2, 1.2, '#1e293b');
    box('lobby', -17.85, 1.9, -9 + i * 4, 0.1, 1, 0.9, ['#f472b6', '#22d3ee', '#facc15', '#4ade80'][i], true);
  }
  box('lobby', -8, 1, -2, 4, 1, 2.2, '#16a34a');
  box('lobby', 19.8, 0.35, 0, 0.2, 0.35, 40, '#f472b6', true);
  box('lobby', -19.8, 0.35, 0, 0.2, 0.35, 40, '#f472b6', true);
  box('lobby', 0, 0.35, 19.8, 40, 0.35, 0.2, '#38bdf8', true);
  box('lobby', 0, 0.35, -19.8, 40, 0.35, 0.2, '#38bdf8', true);
  for (let i = 0; i < 8; i++) {
    const x = i % 2 ? -19 : 19;
    const z = -15 + i * 4.5;
    prop('lobby', new THREE.CylinderGeometry(0.5, 0.4, 0.8, 10), M('#9a3412', 0.7), x, 0.9, z);
    prop('lobby', new THREE.IcosahedronGeometry(0.95, 1), M('#22c55e', 0.75), x, 2.1, z);
  }
  {
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 8, 16), M('#f97316', 0.3));
    h.rotation.x = Math.PI / 2;
    h.position.set(14, 3.6, -1);
    groups.lobby.add(h);
    box('lobby', 14.6, 4, -1, 0.2, 4, 0.2, '#cbd5e1');
  }
  addAmbientParticles('lobby', '#c4b5fd', 75, 20, 0.5, 9, 0.45, 0.22);

  const MC: Record<MapKey, [number, number, number?][]> = {} as Record<MapKey, [number, number, number?][]>;
  const PKS: Record<string, [string, number, number, number?][]> = {};

  // ==================== ARENA 0: PIRATE DECK ====================
  {
    const g: MapKey = 'arena0';
    const oc = createAnimatedOcean('#0284c7');
    groups[g].add(oc.mesh);
    oceans[g] = oc;

    slab(g, 0, 0, 0, 26, 26, woodDeckTex, '#45240d');
    // Raised Poop Deck + Side Steps
    box(g, 0, 2, -9.5, 10, 2, 4, '#5c3419', false, woodDeckTex);
    box(g, -6.5, 1, -9.5, 3, 1, 3.5, '#784421', false, woodDeckTex);
    box(g, 6.5, 1, -9.5, 3, 1, 3.5, '#784421', false, woodDeckTex);

    // Pirate Cargo Barrels & Treasure Chests (visual props on stern/corners)
    const barrelMat = M('#78350f', 0.72, 0.08);
    const ironMat = M('#334155', 0.35, 0.85);
    const goldMat = M('#fbbf24', 0.25, 0.82);
    for (const [bx, by, bz] of [[-11, 0.55, -10.5], [-10, 0.55, -11.4], [11, 0.55, -10.5], [10.8, 0.55, 10.8]]) {
      prop(g, new THREE.CylinderGeometry(0.48, 0.44, 1.1, 12), barrelMat, bx, by, bz);
      prop(g, new THREE.TorusGeometry(0.47, 0.04, 6, 14), ironMat, bx, by + 0.35, bz, Math.PI / 2);
      prop(g, new THREE.TorusGeometry(0.47, 0.04, 6, 14), ironMat, bx, by - 0.35, bz, Math.PI / 2);
    }
    // Treasure chest on raised poop deck
    prop(g, new THREE.BoxGeometry(1.5, 0.85, 1.0), M('#78350f', 0.6), 0, 2.42, -9.8);
    prop(g, new THREE.BoxGeometry(1.58, 0.14, 1.06), goldMat, 0, 2.86, -9.8);

    // Ship's Wheel Helm at stern
    prop(g, new THREE.CylinderGeometry(0.14, 0.18, 1.4, 8), M('#451a03', 0.7), 0, 2.7, -7.8);
    prop(g, new THREE.TorusGeometry(0.65, 0.07, 8, 18), M('#92400e', 0.55), 0, 3.3, -7.65);

    // Bowsprit + Figurehead pointing forward (+Z)
    prop(g, new THREE.CylinderGeometry(0.24, 0.42, 7.5, 10), M('#5c3419', 0.75), 0, 1.6, 15.8, Math.PI / 2.6, 0, 0);
    prop(g, new THREE.IcosahedronGeometry(0.55, 1), goldMat, 0, 3.05, 19.1);

    // Main Mast + Cross Yard + Crow's Nest + Billowing Jolly Roger Sail
    const mastMat = M('#45240d', 0.8);
    const sailMat = new THREE.MeshStandardMaterial({ color: '#fef3c7', roughness: 0.65, side: THREE.DoubleSide });
    const skullSail = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.7, side: THREE.DoubleSide });
    prop(g, new THREE.CylinderGeometry(0.45, 0.65, 13, 12), mastMat, 0, 7.5, -12.0);
    prop(g, new THREE.CylinderGeometry(0.42, 0.42, 0.7, 12), mastMat, 0, 11.4, -12.0);
    prop(g, new THREE.CylinderGeometry(0.18, 0.18, 11.5, 10), mastMat, 0, 9.5, -12.0, 0, 0, Math.PI / 2);
    prop(g, new THREE.PlaneGeometry(10.0, 5.6), sailMat, 0, 6.8, -11.5);
    prop(g, new THREE.PlaneGeometry(3.4, 2.0), skullSail, 1.8, 13.0, -12.0);

    // Broadside Deck Cannons + Cannonball pyramids along side gunwales
    for (const side of [-1, 1]) {
      for (const cz of [-6, 0, 6]) {
        prop(g, new THREE.BoxGeometry(1.1, 0.55, 0.85), M('#5c3419', 0.7), side * 11.8, 0.28, cz);
        prop(g, new THREE.CylinderGeometry(0.19, 0.26, 1.6, 10), ironMat, side * 12.2, 0.65, cz, 0, 0, Math.PI / 2);
      }
    }

    // Warm ship lantern posts on deck corners
    for (const [lx, lz] of [[-12.4, -12.4], [12.4, -12.4], [-12.4, 12.4], [12.4, 12.4]]) {
      prop(g, new THREE.CylinderGeometry(0.14, 0.18, 2.3, 8), mastMat, lx, 1.15, lz);
      prop(g, new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: '#fde047' }), lx, 2.45, lz, 0, 0, 0, false);
    }

    [[5, 4.5], [-6, -4.5]].forEach(([x, z]) => box(g, x, 1.4, z, 1.6, 1.4, 1.6, '#b45309', false, crateTex));
    addMover(g, 0, 1, 0, 4.2, 0.45, 4.2, '#38bdf8', (t) => [6 * Math.sin(t * 0.8), 0]);
    light(g, 0, 9, 0, '#ffe4b5', 1.6, 48);
    light(g, -12, 4, -12, '#fb923c', 1.3, 26);
    light(g, 12, 4, 12, '#fb923c', 1.3, 26);

    [[-13, 0], [13, 0], [0, 13], [0, -13]].forEach(([x, z]) => box(g, x, 0.5, z, x ? 0.4 : 26, 1.2, z ? 0.4 : 26, '#f59e0b', true));
    box(g, -10, 4, 8, 6, 4, 1, '#6d4c7d');
    box(g, 10, 4, -8, 1, 4, 6, '#6d4c7d');
    addAmbientParticles(g, '#fef3c7', 70, 22, -0.5, 7, 0.6, 0.22);

    MC[g] = [[-6, 3.5], [6.5, -4], [2, -6], [-2, 7]];
    PKS[g] = [['shark', -9, 3], ['vortex', 8, 3], ['cane', 0, 10]];
    SPW[g] = ringPts(6.5, 10, 12);
  }

  // ==================== ARENA 1: SHARK REEF (WATER MAP!) ====================
  {
    const g: MapKey = 'arena1';
    const oc = createAnimatedOcean('#06b6d4');
    oc.mesh.position.y = -0.82;
    groups[g].add(oc.mesh);
    oceans[g] = oc;

    const grassTex = createTropicalIslandTexture('#22c55e', '#15803d', 4);
    const sandTex = createTropicalIslandTexture('#fde68a', '#f59e0b', 4);

    slab(g, 0, 0, 0, 14, 14, grassTex, '#78350f');
    prop(g, new THREE.BoxGeometry(15.2, 0.45, 15.2), new THREE.MeshStandardMaterial({ map: sandTex.map, roughness: 0.85 }), 0, -0.35, 0);
    box(g, 0, 1.1, 0, 7, 1.1, 7, '#f59e0b', false, sandTex);
    box(g, 0, 2.2, 0, 3.5, 1.1, 3.5, '#fde047', false, sandTex);

    slab(g, 13, 1, 0, 9, 9, grassTex, '#78350f');
    slab(g, -13, 1, 0, 9, 9, grassTex, '#78350f');
    slab(g, 0, 0, 13, 9, 9, sandTex, '#92400e');
    slab(g, 0, 0, -13, 9, 9, sandTex, '#92400e');

    // Rickety boardwalk docks jutting partly out into shark-infested water
    for (const [bx, by, bz, bw, bd] of [
      [8.2, 0.05, 0, 2.6, 2.4],
      [-8.2, 0.05, 0, 2.6, 2.4],
      [0, -0.1, 8.2, 2.4, 2.6],
      [0, -0.1, -8.2, 2.4, 2.6],
    ]) {
      box(g, bx, by, bz, bw, 0.3, bd, '#b45309', false, woodDeckTex);
    }

    // Palm trees, beach umbrellas, surfboards & jagged ocean rocks
    const trunkMat = M('#78350f', 0.85);
    const leafMat = M('#16a34a', 0.58);
    for (const [px, py, pz] of [[15.5, 1, 2.5], [-15.5, 1, -2.5], [2.5, 0, 15.5], [-2.5, 0, -15.5]]) {
      prop(g, new THREE.CylinderGeometry(0.22, 0.36, 4.4, 8), trunkMat, px, py + 2.1, pz);
      for (let f = 0; f < 6; f++) {
        const a = (f / 6) * Math.PI * 2;
        const leaf = prop(g, new THREE.ConeGeometry(0.55, 2.4, 5), leafMat, px + Math.cos(a) * 0.95, py + 4.2, pz + Math.sin(a) * 0.95);
        leaf.rotation.set(Math.sin(a) * 1.15, 0, -Math.cos(a) * 1.15);
      }
    }
    // Colorful beach umbrellas & coral sea rocks
    for (const [ux, uy, uz, col] of [[14.5, 1, -2.8, '#ef4444'], [-14.5, 1, 2.8, '#38bdf8'], [3.0, 0, -14.5, '#facc15']] as const) {
      prop(g, new THREE.CylinderGeometry(0.06, 0.06, 2.5, 6), M('#f8fafc', 0.4), ux, uy + 1.25, uz);
      prop(g, new THREE.ConeGeometry(1.5, 0.7, 8), M(col, 0.5), ux, uy + 2.45, uz);
    }
    const rockMat = M('#64748b', 0.9);
    for (const [rx, rz] of [[11, 11], [-11, 11], [11, -11], [-11, -11], [20, -12], [-20, 12]]) {
      prop(g, new THREE.DodecahedronGeometry(1.5, 0), rockMat, rx, -0.6, rz, 0.2, rx, 0.3);
    }

    box(g, 13, 4.2, -3, 1, 3.2, 3, '#7c3aed');
    box(g, -13, 4.2, 3, 1, 3.2, 3, '#7c3aed');
    light(g, 0, 9, 0, '#fef9c3', 1.6, 50);
    light(g, 13, 5, 0, '#38bdf8', 1.0, 26);
    light(g, -13, 5, 0, '#2dd4bf', 1.0, 26);
    addAmbientParticles(g, '#a5f3fc', 75, 24, -0.4, 5, 0.4, 0.22);

    MC[g] = [[5.5, -5.5], [-5.5, 5.5], [13, 3, 1], [-13, -3, 1]];
    PKS[g] = [['shark', -13, 0, 1], ['vortex', 0, 13], ['cane', 0, -13]];
    SPW[g] = [[5, 0], [-5, 0], [0, 5], [0, -5], [5.5, 5.5], [-5.5, -5.5], [13, 0], [-13, 0], [0, 13], [0, -13], [12, 2], [-12, -2]];
  }

  // ==================== ARENA 2: NEON CROSS ====================
  {
    const g: MapKey = 'arena2';
    const cir = createCircuitTextures('#1e1b4b', '#312e81', '#22d3ee', 5);
    const cir2 = createCircuitTextures('#1e1b4b', '#312e81', '#e879f9', 3);
    slab(g, 0, 0, 0, 30, 8, cir, '#0f172a');
    slab(g, 0, 0, -9.5, 8, 11, cir2, '#0f172a');
    slab(g, 0, 0, 9.5, 8, 11, cir2, '#0f172a');
    box(g, 0, 1.2, 0, 6, 1.2, 6, '#9333ea', false, { roughness: 0.22, metalness: 0.65 });
    box(g, 13.9, 3.2, 0, 1.2, 3.2, 5, '#06b6d4', true);
    box(g, -13.9, 3.2, 0, 1.2, 3.2, 5, '#ec4899', true);
    box(g, 0, 3.2, 13.9, 5, 3.2, 1.2, '#facc15', true);
    box(g, 0, 3.2, -13.9, 5, 3.2, 1.2, '#22c55e', true);

    // Cyberpunk Holographic Gates & Corner Data Monoliths
    const neonArchMat = (c: string) => M(c, 0.2, 0.5, c);
    for (const [ax, az, ry, col] of [[9, 0, Math.PI / 2, '#22d3ee'], [-9, 0, Math.PI / 2, '#ec4899'], [0, 9, 0, '#facc15'], [0, -9, 0, '#4ade80']] as const) {
      prop(g, new THREE.TorusGeometry(4.2, 0.16, 8, 24, Math.PI), neonArchMat(col), ax, 0, az, 0, ry, 0, false);
    }
    // Floating center laser emitter core
    prop(g, new THREE.OctahedronGeometry(0.95, 0), neonArchMat('#e879f9'), 0, 2.75, 0);
    for (const [mx, mz] of [[-12, -12], [12, -12], [-12, 12], [12, 12]]) {
      prop(g, new THREE.BoxGeometry(2.2, 10, 2.2), M('#0f172a', 0.3, 0.8), mx, -1, mz);
      prop(g, new THREE.BoxGeometry(2.3, 0.35, 2.3), neonArchMat('#38bdf8'), mx, 3.2, mz, 0, 0, 0, false);
    }

    light(g, 0, 7, 0, '#e879f9', 2.0, 44);
    light(g, 10, 4, 0, '#22d3ee', 1.3, 28);
    light(g, -10, 4, 0, '#facc15', 1.3, 28);
    addAmbientParticles(g, '#22d3ee', 80, 20, 0.4, 7, 0.55, 0.22);

    MC[g] = [[-8, 0], [8, 0], [0, -8], [0, 8]];
    PKS[g] = [['shark', -11, 2], ['vortex', 11, -2], ['cane', 2, 11]];
    SPW[g] = [[-12, 1.5], [12, -1.5], [1.5, 12], [-1.5, -12], [-7, 2], [7, -2], [2, 7], [-2, -7], [-10, -2.5], [10, 2.5], [3.5, 3.5], [-3.5, -3.5]];
  }

  // ==================== ARENA 3: PIT RING ====================
  {
    const g: MapKey = 'arena3';
    const basalt = createStoneTileTextures('#57221c', '#3d1612', 5, '#ea580c');
    slab(g, 0, 0, -9, 28, 10, basalt, '#1c0a0a');
    slab(g, 0, 0, 9, 28, 10, basalt, '#1c0a0a');
    slab(g, -9, 0, 0, 10, 8, basalt, '#1c0a0a');
    slab(g, 9, 0, 0, 10, 8, basalt, '#1c0a0a');
    addMover(g, 0, 0.15, 0, 4.2, 0.5, 4.2, '#38bdf8', (t) => [8 * Math.sin(t * 0.7), 0]);

    lavaMat = new THREE.MeshStandardMaterial({
      color: '#ff4500',
      emissive: '#ff5500',
      emissiveIntensity: 1.5,
      roughness: 0.35,
    });
    const lava = new THREE.Mesh(new THREE.PlaneGeometry(170, 170), lavaMat);
    lava.rotation.x = -Math.PI / 2;
    lava.position.y = -3.2;
    groups[g].add(lava);

    // Jagged Obsidian Volcanic Spires rising around the lava rim + glowing embers
    const obsMat = M('#1c1917', 0.75, 0.25, '#9a3412');
    for (const [vx, vz, h] of [[-18, -16, 12], [18, -16, 14], [-18, 16, 13], [18, 16, 11], [0, -20, 15], [0, 20, 15]]) {
      prop(g, new THREE.ConeGeometry(2.6, h, 6), obsMat, vx, h / 2 - 4, vz, 0, vx, 0);
    }

    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz], i) => {
      const x = sx * 11.5;
      const z = sz * 11.5;
      const c = ['#fb7185', '#38bdf8', '#a78bfa', '#34d399'][i];
      box(g, x, 1.2, z, 5, 1.2, 5, c);
      box(g, x, 2.4, z, 3, 1.2, 3, c);
    });
    light(g, 0, 7, 0, '#fb923c', 1.8, 46);
    light(g, -10, 4, -10, '#ef4444', 1.2, 26);
    light(g, 10, 4, 10, '#ef4444', 1.2, 26);
    addAmbientParticles(g, '#fb923c', 110, 22, -2.5, 9, 1.6, 0.28);

    MC[g] = [[-10, 3], [10, -3], [3, -10], [-3, 10]];
    PKS[g] = [['shark', 0, -10], ['vortex', 0, 10], ['cane', -12, 0]];
    SPW[g] = [[-12, -7], [-12, 7], [12, -7], [12, 7], [-6, -10], [6, -10], [-6, 10], [6, 10], [-8, 0], [8, 0], [0, -12], [0, 12]];
  }

  // ==================== ARENA 4: TOWER STEPS ====================
  {
    const g: MapKey = 'arena4';
    const t1 = createStoneTileTextures('#2d6a78', '#245561', 8, '#38bdf8');
    const t2 = createStoneTileTextures('#4a9aa8', '#3c8391', 6);
    const t3 = createStoneTileTextures('#6ec4d1', '#58aebc', 4);
    const t4 = createStoneTileTextures('#fbbf24', '#d97706', 3);
    slab(g, 0, 0, 0, 30, 30, t1, '#14333b');
    box(g, 0, 1.2, 0, 22, 1.2, 22, '#ffffff', false, t2);
    box(g, 0, 2.4, 0, 14, 1.2, 14, '#ffffff', false, t3);
    box(g, 0, 3.6, 0, 6, 1.2, 6, '#ffffff', false, t4);
    box(g, 14.4, 3.5, 0, 1.2, 3.5, 5, '#7c3aed');
    box(g, -14.4, 3.5, 0, 1.2, 3.5, 5, '#7c3aed');

    // Ancient Temple Pillars & Glowing Fire Braziers at the 4 corners
    const templeMat = M('#0e7490', 0.65, 0.1);
    const fireMat = M('#f97316', 0.2, 0, '#fb923c');
    for (const [cx, cz] of [[-13.5, -13.5], [13.5, -13.5], [-13.5, 13.5], [13.5, 13.5]]) {
      prop(g, new THREE.BoxGeometry(1.5, 3.5, 1.5), templeMat, cx, 1.75, cz);
      prop(g, new THREE.CylinderGeometry(0.75, 0.45, 0.55, 8), M('#334155', 0.5, 0.6), cx, 3.75, cz);
      prop(g, new THREE.DodecahedronGeometry(0.45, 0), fireMat, cx, 4.2, cz, 0, 0, 0, false);
    }

    light(g, 0, 9, 0, '#fef08a', 1.6, 46);
    light(g, 13, 4, 13, '#38bdf8', 1.0, 26);
    light(g, -13, 4, -13, '#f472b6', 1.0, 26);
    addAmbientParticles(g, '#fde047', 65, 20, 0.5, 8, 0.5, 0.22);

    MC[g] = [[-13, -13], [13, 13], [-13, 13], [13, -13]];
    PKS[g] = [['shark', 0, 0, 3.6], ['vortex', 0, 12.8], ['cane', 0, -12.8]];
    SPW[g] = [[12.3, -8], [12.3, 8], [-12.3, -8], [-12.3, 8], [-8, 12.8], [8, 12.8], [-8, -12.8], [8, -12.8], [12.3, -4.5], [-12.3, 4.5], [4.5, 12.8], [-4.5, -12.8]];
  }

  // ==================== ARENA 5: SHUTTLE PADS ====================
  {
    const g: MapKey = 'arena5';
    const cCenter = createCircuitTextures('#4c1d95', '#6d28d9', '#f472b6', 3);
    const cPad = createCircuitTextures('#0e7490', '#155e75', '#67e8f9', 3);
    slab(g, 0, 0, 0, 12, 12, cCenter, '#2e1065');
    slab(g, 15, 0, 0, 8, 8, cPad, '#164e63');
    slab(g, -15, 0, 0, 8, 8, cPad, '#164e63');
    slab(g, 0, 0, 15, 8, 8, cPad, '#164e63');
    slab(g, 0, 0, -15, 8, 8, cPad, '#164e63');
    addMover(g, 8.5, 0.2, 0, 4, 0.5, 4, '#38bdf8', (t) => [8.5 + 1.4 * Math.sin(t * 0.9), 0]);
    addMover(g, -8.5, 0.2, 0, 4, 0.5, 4, '#fb923c', (t) => [-8.5 - 1.4 * Math.sin(t * 0.9 + 2), 0]);
    addMover(g, 0, 0.2, 8.5, 4, 0.5, 4, '#4ade80', (t) => [0, 8.5 + 1.4 * Math.sin(t * 0.9 + 4)]);
    addMover(g, 0, 0.2, -8.5, 4, 0.5, 4, '#f472b6', (t) => [0, -8.5 - 1.4 * Math.sin(t * 0.9 + 1)]);

    // Orbital Spaceport Radar Dish & Thruster Glow Rings beneath each shuttle pad
    const ringMat = M('#38bdf8', 0.2, 0.4, '#22d3ee');
    for (const [px, pz] of [[15, 0], [-15, 0], [0, 15], [0, -15]]) {
      prop(g, new THREE.TorusGeometry(4.2, 0.14, 8, 28), ringMat, px, -0.25, pz, Math.PI / 2, 0, 0, false);
      prop(g, new THREE.CylinderGeometry(0.15, 0.25, 2.2, 8), M('#334155', 0.3, 0.8), px * 1.18, 1.1, pz * 1.18);
      prop(g, new THREE.SphereGeometry(0.24, 8, 8), M('#f472b6', 0.2, 0, '#ec4899'), px * 1.18, 2.3, pz * 1.18, 0, 0, 0, false);
    }

    light(g, 0, 7, 0, '#d8b4fe', 1.8, 46);
    light(g, 15, 4, 0, '#67e8f9', 1.1, 26);
    light(g, -15, 4, 0, '#67e8f9', 1.1, 26);
    addAmbientParticles(g, '#67e8f9', 80, 22, -1, 7, 0.45, 0.22);

    MC[g] = [[3, 3], [-3, -3], [15, 2], [-15, -2]];
    PKS[g] = [['shark', -15, 1], ['vortex', 15, -1], ['cane', 1, 15]];
    SPW[g] = [[3, 0], [-3, 0], [0, 3], [0, -3], [4, 4], [-4, -4], [15, 0], [-15, 0], [0, 15], [0, -15], [13.5, 2], [-13.5, -2]];
  }

  // ==================== ARENA 6: PILLAR PARK ====================
  {
    const g: MapKey = 'arena6';
    const park = createTropicalIslandTexture('#65a30d', '#4d7c0f', 7);
    const pilTex = createStoneTileTextures('#cbd5e1', '#94a3b8', 2);
    slab(g, 0, 0, 0, 30, 30, park, '#365314');
    [[-8, -8], [8, -8], [-8, 8], [8, 8], [0, -8], [0, 8], [-8, 0], [8, 0]].forEach(([x, z]) => {
      box(g, x, 5, z, 3, 5, 3, '#e2e8f0', false, pilTex);
      // Marble pillar crown capital
      prop(g, new THREE.BoxGeometry(3.45, 0.45, 3.45), M('#f1f5f9', 0.4, 0.1), x, 5.2, z);
    });
    box(g, 0, 1.2, 0, 5, 1.2, 5, '#c084fc');
    // Tiered Garden Fountain Finial on center pedestal
    prop(g, new THREE.CylinderGeometry(1.6, 1.8, 0.35, 16), M('#0ea5e9', 0.15, 0.2, '#38bdf8'), 0, 1.35, 0);
    prop(g, new THREE.CylinderGeometry(0.45, 0.55, 1.6, 12), M('#e2e8f0', 0.4), 0, 2.2, 0);

    // Wrought-iron lampposts & manicured hedge bushes around outer park walk
    const iron = M('#1e293b', 0.35, 0.8);
    const globe = M('#fef08a', 0.1, 0, '#fde047');
    for (const [lx, lz] of [[-13.5, -13.5], [13.5, -13.5], [-13.5, 13.5], [13.5, 13.5]]) {
      prop(g, new THREE.CylinderGeometry(0.1, 0.16, 4.2, 8), iron, lx, 2.1, lz);
      prop(g, new THREE.SphereGeometry(0.38, 10, 8), globe, lx, 4.4, lz, 0, 0, 0, false);
    }
    for (const [bx, bz] of [[-13.5, 0], [13.5, 0], [0, -13.5], [0, 13.5]]) {
      prop(g, new THREE.IcosahedronGeometry(1.1, 1), M('#15803d', 0.78), bx, 0.75, bz);
    }

    light(g, 0, 9, 0, '#fef9c3', 1.6, 46);
    light(g, 12, 4, 12, '#fde047', 1.0, 26);
    light(g, -12, 4, -12, '#38bdf8', 1.0, 26);
    addAmbientParticles(g, '#bef264', 70, 20, 0.4, 7, 0.45, 0.22);

    MC[g] = [[-4, -4], [4, 4], [-4, 4], [4, -4]];
    PKS[g] = [['shark', -12, -12], ['vortex', 12, 12], ['cane', 12, -12]];
    SPW[g] = [[-12, -5], [12, 5], [-5, -12], [5, 12], [-4, 0], [4, 0], [0, -4], [0, 4], [-12, 5], [12, -5], [-5, 12], [5, -12]];
  }

  // ==================== ARENA 7: TWIN TOWERS ====================
  {
    const g: MapKey = 'arena7';
    const redStone = createStoneTileTextures('#b91c1c', '#991b1b', 4);
    const blueStone = createStoneTileTextures('#1d4ed8', '#1e40af', 4);
    const goldBridge = createStoneTileTextures('#f59e0b', '#d97706', 3);
    slab(g, -11, 0, 0, 12, 14, redStone, '#450a0a');
    slab(g, 11, 0, 0, 12, 14, blueStone, '#172554');
    slab(g, 0, 0, 0, 10, 3, goldBridge, '#78350f');
    [-1, 1].forEach((s) => {
      box(g, s * 13.5, 1.2, 0, 5, 1.2, 5, s < 0 ? '#ef4444' : '#3b82f6');
      box(g, s * 13.5, 2.4, 0, 3, 1.2, 3, s < 0 ? '#f87171' : '#60a5fa');
      // Castle Corner Battlements & Tall Heraldic Team Banners
      const bCol = s < 0 ? '#dc2626' : '#2563eb';
      for (const bz of [-6.3, 6.3]) {
        prop(g, new THREE.CylinderGeometry(0.08, 0.08, 6.2, 8), M('#cbd5e1', 0.3, 0.7), s * 16.2, 3.1, bz);
        prop(g, new THREE.BoxGeometry(0.1, 1.8, 1.2), M(bCol, 0.4, 0.1, bCol), s * 16.2, 5.1, bz);
      }
    });
    light(g, 0, 6, 0, '#fef3c7', 1.6, 46);
    light(g, -12, 4, 0, '#f87171', 1.2, 26);
    light(g, 12, 4, 0, '#60a5fa', 1.2, 26);
    addAmbientParticles(g, '#fde68a', 60, 22, 0.5, 7, 0.5, 0.2);

    MC[g] = [[-8, 4], [8, -4], [-8, -4], [8, 4]];
    PKS[g] = [['shark', -9, 0], ['vortex', 9, 0], ['cane', 0, 0]];
    SPW[g] = [[-10, 5], [-10, -5], [-12, 5.5], [-12, -5.5], [-6.5, 0], [-15, 5], [10, 5], [10, -5], [12, 5.5], [12, -5.5], [6.5, 0], [15, -5]];
  }

  // ==================== ARENA 8: CHECKER BLOCKS ====================
  {
    const g: MapKey = 'arena8';
    const xs = [-12, -4, 4, 12];
    const cells: [number, number, number][] = [];
    const goldTile = createStoneTileTextures('#f59e0b', '#d97706', 3);
    const blueTile = createStoneTileTextures('#2563eb', '#1d4ed8', 3);
    let tidx = 0;
    xs.forEach((x, i) =>
      xs.forEach((z, j) => {
        const hi = (i + j) % 2;
        const top = hi ? 1.2 : 0;
        cells.push([x, z, top]);
        const s = slab(g, x, top, z, 7, 7, hi ? goldTile : blueTile, '#1e293b');
        s.tileIdx = tidx;
        s.baseTop = top;
        s.baseY = s.m.position.y;
        checkerTiles.push({ s, baseTop: top, baseY: s.m.position.y, idx: tidx });
        tidx++;
      })
    );
    // Decorative Giant Chess Rook Pillars framing the sky board
    for (const [cx, cz, col] of [[-19, -19, '#f59e0b'], [19, -19, '#3b82f6'], [-19, 19, '#3b82f6'], [19, 19, '#f59e0b']] as const) {
      prop(g, new THREE.CylinderGeometry(1.4, 1.8, 7, 12), M(col, 0.35, 0.3), cx, -1.5, cz);
      prop(g, new THREE.CylinderGeometry(1.7, 1.5, 1.1, 8), M('#f8fafc', 0.3, 0.4), cx, 2.5, cz);
    }
    light(g, 0, 9, 0, '#ffffff', 1.6, 48);
    light(g, 12, 4, -12, '#fb923c', 1.1, 26);
    light(g, -12, 4, 12, '#38bdf8', 1.1, 26);
    addAmbientParticles(g, '#bae6fd', 65, 22, -2, 8, 0.45, 0.22);

    MC[g] = [[4, 4], [-4, -4], [12, 12], [-12, -12]];
    PKS[g] = [['shark', -12, 12, 1.2], ['vortex', 12, -12, 1.2], ['cane', 4, -4, 1.2], ['hook', -4, 4, 1.2]];
    SPW[g] = cells.map(([x, z]) => [x + 1.8, z - 1.8]);
  }

  // ==================== ARENA 9: COLOSSEUM ====================
  {
    const g: MapKey = 'arena9';
    const sandArena = createStoneTileTextures('#92704a', '#785a3a', 8);
    const marble1 = createStoneTileTextures('#d6b98c', '#bfa074', 6);
    const marble2 = createStoneTileTextures('#f3d59b', '#dec080', 4);
    slab(g, 0, 0, 0, 30, 30, sandArena, '#3d2814');
    box(g, 0, 1.2, 0, 14, 1.2, 14, '#ffffff', false, marble1);
    box(g, 0, 2.4, 0, 8, 1.2, 8, '#ffffff', false, marble2);
    box(g, 0, 3.6, 0, 3, 1.2, 3, '#fbbf24');
    [[-11.5, -11.5], [11.5, -11.5], [-11.5, 11.5], [11.5, 11.5]].forEach(([x, z], i) => {
      const c = ['#b91c1c', '#1d4ed8', '#15803d', '#ca8a04'][i];
      box(g, x, 1.2, z, 5, 1.2, 5, c);
      box(g, x, 2.4, z, 2.6, 1.2, 2.6, c);
    });
    [[0, -14.4, 12, 1], [0, 14.4, 12, 1], [-14.4, 0, 1, 12], [14.4, 0, 1, 12]].forEach(([x, z, w, d]) =>
      box(g, x, 2.2, z, w, 2.2, d, '#7c3aed')
    );

    // Fluted Roman Marble Columns & Flaming Arena Braziers around walls
    const colMat = M('#f3e5ab', 0.45, 0.1);
    const fireMat = M('#f97316', 0.2, 0, '#fb923c');
    for (const [cx, cz] of [[-7, -14.4], [7, -14.4], [-7, 14.4], [7, 14.4], [-14.4, -7], [-14.4, 7], [14.4, -7], [14.4, 7]]) {
      prop(g, new THREE.CylinderGeometry(0.5, 0.58, 5.2, 12), colMat, cx, 2.6, cz);
      prop(g, new THREE.CylinderGeometry(0.68, 0.4, 0.5, 8), M('#d97706', 0.4, 0.6), cx, 5.4, cz);
      prop(g, new THREE.OctahedronGeometry(0.4, 0), fireMat, cx, 5.85, cz, 0, 0, 0, false);
    }

    light(g, 0, 9, 0, '#fef3c7', 1.6, 46);
    light(g, 12, 4, 12, '#fb7185', 1.0, 26);
    light(g, -12, 4, -12, '#60a5fa', 1.0, 26);
    addAmbientParticles(g, '#fde047', 65, 20, 0.5, 7, 0.65, 0.22);

    MC[g] = [[-8, 3], [8, -3], [3, 8], [-3, -8]];
    PKS[g] = [['shark', -8, -8], ['vortex', 8, 8], ['cane', 0, 0, 3.6]];
    SPW[g] = [[-8, -8], [8, 8], [-8, 8], [8, -8], [-11, 0], [11, 0], [0, -11], [0, 11], [-11, -8], [11, 8], [-11, 8], [11, -8]];
  }

  // ==================== ARENA 10: RING ROAD ====================
  {
    const g: MapKey = 'arena10';
    const roadTex = createCircuitTextures('#1e293b', '#334155', '#38bdf8', 7);
    const hubTex = createCircuitTextures('#581c87', '#7e22ce', '#f472b6', 3);
    const bridgeTex = createStoneTileTextures('#f59e0b', '#d97706', 2);
    slab(g, 0, 0, 0, 10, 10, hubTex, '#3b0764');
    slab(g, 0, 0, -14, 33, 5, roadTex, '#0f172a');
    slab(g, 0, 0, 14, 33, 5, roadTex, '#0f172a');
    slab(g, -14, 0, 0, 5, 23, roadTex, '#0f172a');
    slab(g, 14, 0, 0, 5, 23, roadTex, '#0f172a');
    slab(g, 0, 0, -8.25, 3, 6.5, bridgeTex, '#78350f');
    slab(g, 0, 0, 8.25, 3, 6.5, bridgeTex, '#78350f');
    slab(g, -8.25, 0, 0, 6.5, 3, bridgeTex, '#78350f');
    slab(g, 8.25, 0, 0, 6.5, 3, bridgeTex, '#78350f');
    box(g, 0, 1.2, 0, 3, 1.2, 3, '#facc15');

    // Highway Neon Streetlamps & Overhead Gantry Arch Signs around outer loop
    const poleMat = M('#334155', 0.3, 0.8);
    const lampGlow = M('#38bdf8', 0.2, 0, '#22d3ee');
    for (const [sx, sz] of [[-16.2, -16.2], [16.2, -16.2], [-16.2, 16.2], [16.2, 16.2], [0, -16.2], [0, 16.2], [-16.2, 0], [16.2, 0]]) {
      prop(g, new THREE.CylinderGeometry(0.12, 0.16, 4.8, 8), poleMat, sx, 2.4, sz);
      prop(g, new THREE.BoxGeometry(0.75, 0.2, 0.4), lampGlow, sx * 0.96, 4.85, sz * 0.96, 0, 0, 0, false);
    }

    light(g, 0, 7, 0, '#f472b6', 1.8, 46);
    light(g, 14, 4, 14, '#38bdf8', 1.1, 26);
    light(g, -14, 4, -14, '#38bdf8', 1.1, 26);
    addAmbientParticles(g, '#38bdf8', 75, 22, 0.4, 7, 0.5, 0.22);

    MC[g] = [[0, -14], [0, 14], [-14, 0], [14, 0], [3, -3]];
    PKS[g] = [['shark', -14, -8], ['vortex', 14, 8], ['cane', 3.5, 0]];
    SPW[g] = [[-14, -8], [14, 8], [-8, 14], [8, -14], [-14, 8], [14, -8], [-3, -3], [3, 3], [-3, 3], [3, -3], [0, -14], [0, 14]];
  }

  // ==================== ARENA 11: DOUBLE DECKER ====================
  {
    const g: MapKey = 'arena11';
    const lowTex = createStoneTileTextures('#115e59', '#0f766e', 8);
    const upTex = createCautionStripeTextures('#0f766e', '#fde047', 4);
    slab(g, 0, 0, 0, 32, 32, lowTex, '#042f2e');
    box(g, 0, 3.6, 0, 14, 0.8, 14, '#ffffff', false, upTex);
    [[-6, -6], [6, -6], [-6, 6], [6, 6]].forEach(([x, z]) => box(g, x, 2.8, z, 1, 2.8, 1, '#cbd5e1'));
    [[1, 0], [-1, 0]].forEach(([sx]) => {
      box(g, sx * 11.5, 1.2, 0, 3, 1.2, 6, '#b45309', false, cautionTex);
      box(g, sx * 8.5, 2.4, 0, 3, 1.2, 6, '#d97706', false, cautionTex);
    });
    [[1], [-1]].forEach(([sz]) => {
      box(g, 0, 1.2, sz * 11.5, 6, 1.2, 3, '#b45309', false, cautionTex);
      box(g, 0, 2.4, sz * 8.5, 6, 1.2, 3, '#d97706', false, cautionTex);
    });

    // Industrial Factory Smokestacks & Yellow Safety Beacons on corners
    for (const [fx, fz] of [[-14.5, -14.5], [14.5, -14.5], [-14.5, 14.5], [14.5, 14.5]]) {
      prop(g, new THREE.CylinderGeometry(0.75, 1.0, 5.5, 12), M('#334155', 0.4, 0.7), fx, 2.75, fz);
      prop(g, new THREE.CylinderGeometry(0.85, 0.85, 0.35, 12), M('#f59e0b', 0.3, 0.5, '#f59e0b'), fx, 5.5, fz);
    }

    light(g, 0, 9, 0, '#99f6e4', 1.6, 46);
    light(g, 12, 4, 12, '#fde047', 1.1, 26);
    light(g, -12, 4, -12, '#38bdf8', 1.1, 26);
    addAmbientParticles(g, '#5eead4', 75, 20, 0.5, 8, 0.8, 0.22);

    MC[g] = [[-10, -10], [10, 10], [-10, 10], [10, -10]];
    PKS[g] = [['shark', -12, 6], ['vortex', 12, -6], ['cane', 0, 0, 3.6]];
    SPW[g] = [[-12, -12], [12, 12], [-12, 12], [12, -12], [-12, 6], [12, -6], [-6, 12], [6, -12], [-14, -5], [14, 5], [-5, 14], [5, -14]];
  }

  // ==================== ARENA 12: CRATE YARD ====================
  {
    const g: MapKey = 'arena12';
    slab(g, 0, 0, 0, 30, 30, cautionTex, '#18181b');
    box(g, 0, 2.4, -7, 10, 2.4, 2, '#dc2626');
    box(g, 0, 2.4, 7, 10, 2.4, 2, '#2563eb');
    box(g, -7, 2.4, 0, 2, 2.4, 10, '#16a34a');
    box(g, 7, 2.4, 0, 2, 2.4, 10, '#d97706');

    // Towering Yellow Overhead Gantry Crane Span + Work Floodlights + Traffic Cones
    const craneYellow = M('#eab308', 0.35, 0.6);
    for (const [cx, cz] of [[-14.2, -14.2], [14.2, -14.2], [-14.2, 14.2], [14.2, 14.2]]) {
      prop(g, new THREE.BoxGeometry(1.1, 13, 1.1), craneYellow, cx, 6.5, cz);
    }
    prop(g, new THREE.BoxGeometry(29.5, 1.2, 1.4), craneYellow, 0, 13.0, -14.2);
    prop(g, new THREE.BoxGeometry(29.5, 1.2, 1.4), craneYellow, 0, 13.0, 14.2);
    prop(g, new THREE.BoxGeometry(1.4, 1.0, 29.5), M('#f59e0b', 0.35, 0.7), 0, 13.0, 0);
    // Orange traffic cones on corners
    for (const [tx, tz] of [[-13, -6], [13, 6], [-6, 13], [6, -13]]) {
      prop(g, new THREE.ConeGeometry(0.32, 0.85, 10), M('#f97316', 0.5), tx, 0.42, tz);
    }

    light(g, 0, 9, 0, '#fef3c7', 1.6, 46);
    light(g, 12, 4, -12, '#fb923c', 1.1, 26);
    light(g, -12, 4, 12, '#38bdf8', 1.1, 26);
    addAmbientParticles(g, '#fbbf24', 70, 20, 0.5, 8, 0.5, 0.22);

    MC[g] = [[-3, -3], [3, 3], [-3, 3], [3, -3], [-11, -4], [11, 4], [-4, 11], [4, -11], [10, -10], [-10, 10]];
    PKS[g] = [['shark', -12, 12], ['vortex', 12, -12], ['cane', 0, 0]];
    SPW[g] = [[-12, -12], [12, 12], [-12, 12], [12, -12], [-12, 0], [12, 0], [0, -12], [0, 12], [-10, -6], [10, 6], [-6, 10], [6, -10]];
  }

  // Ground Y query per arena
  const groundY = (g: MapKey, x: number, z: number): number => {
    let y = 0;
    for (const s of solids[g]) {
      if (movers.some((m) => m.s === s)) continue;
      if (Math.abs(x - s.x) < s.hw && Math.abs(z - s.z) < s.hd && s.top <= 4 && s.top > y) y = s.top;
    }
    return y;
  };

  MAPK.forEach((g) => {
    if (!PKS[g].some((a) => a[0] === 'hook')) {
      const s = SPW[g][4];
      PKS[g].push(['hook', s[0], s[1]]);
    }
    [['hammer', 2], ['bomb', 7], ['banana', 10], ['hole', 5], ['ice', 9]].forEach(([k, i]) => {
      const s = SPW[g][(i as number) % SPW[g].length];
      PKS[g].push([k as string, s[0], s[1], groundY(g, s[0], s[1])]);
    });
  });

  // Movable crates with detailed wood crate texture
  const mkCrate = (g: SceneKey, x: number, z: number, y0 = 0) => {
    const mat = new THREE.MeshStandardMaterial({
      map: crateTex.map,
      bumpMap: crateTex.bumpMap,
      bumpScale: 0.06,
      roughness: 0.56,
      metalness: 0.12,
    });
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    m.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), OLM));
    groups[g].add(m);
    const q: SolidBox = { x, z, hw: 0.6, hd: 0.6, top: 1.2, bottom: 0, m, dx: 0, dy: 0, dz: 0, held: false, crate: true };
    const c: CrateObj = { i: crates[g].length, x, y: 0, z, vx: 0, vy: 0, vz: 0, held: 0, s: q, ox: x, oy: y0, oz: z, hc: 0, lh: 0, lift: false, tx: x, ty: y0, tz: z, sup: null };
    solids[g].push(q);
    crates[g].push(c);
    setCratePos(c, x, y0, z);
  };

  MAPK.forEach((k) => MC[k].forEach(([x, z, y]) => mkCrate(k, x, z, y || 0)));
  [[6, 5], [-5, 4], [3, -5]].forEach(([x, z]) => mkCrate('lobby', x, z));

  // Weapon pickups
  PKS.lobby = [['shark', 10, 2], ['vortex', -10, 4]];
  const ringColors: Record<string, string> = {
    shark: '#38bdf8',
    vortex: '#a5f3fc',
    hook: '#fbbf24',
    hammer: '#fb923c',
    bomb: '#ef4444',
    banana: '#fde047',
    hole: '#c084fc',
    ice: '#7dd3fc',
    cane: '#fb7185',
  };

  for (const ph of allKeys) {
    (PKS[ph] || []).forEach(([k, x, z, y0 = 0]) => {
      const o = new THREE.Group();
      o.position.set(x, y0, z);
      groups[ph].add(o);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.78, 0.055, 8, 28),
        new THREE.MeshBasicMaterial({ color: ringColors[k] || '#fb7185' })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.06;
      o.add(ring);

      const w = new THREE.Group();
      const m = wpModel(k);
      m.rotation.z = Math.PI / 2;
      m.position.x = k === 'cane' ? -0.95 : k === 'shark' ? -0.6 : -0.5;
      m.scale.set(1.4, 1.4, 1.4);
      w.add(m);
      w.position.y = 0.9;
      o.add(w);
      pk[ph].push({ k, x, z, y: y0, on: true, t: 0, m: o, w });
    });
  }

  // Distant 3D Horizon Vistas & Backdrop Silhouettes for rich depth
  MAPK.forEach((g) => {
    const isWater = g === 'arena0' || g === 'arena1';
    const isCyber = g === 'arena2' || g === 'arena5' || g === 'arena10';
    const isLava = g === 'arena3';
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.25;
      const dist = 54 + (i % 3) * 14;
      const hx = Math.cos(a) * dist;
      const hz = Math.sin(a) * dist;
      if (isWater) {
        // Distant tropical silhouettes & calm sea rocks + foam collars
        const h = 4 + (i % 4) * 2.5;
        prop(g, new THREE.ConeGeometry(6 + (i % 3) * 2, h, 7), M('#0e7490', 0.85), hx, -1.6 + h * 0.4, hz, 0, a, 0, false);
        prop(g, new THREE.TorusGeometry(4.2, 0.22, 6, 18), new THREE.MeshBasicMaterial({ color: '#e0f2fe', transparent: true, opacity: 0.45 }), hx, -1.45, hz, Math.PI / 2, 0, 0, false);
      } else if (isCyber) {
        // Distant glowing cyberpunk skyline towers
        const h = 18 + (i % 5) * 8;
        const nCol = ['#22d3ee', '#e879f9', '#facc15', '#38bdf8'][i % 4];
        prop(g, new THREE.BoxGeometry(5, h, 5), M('#090d1f', 0.35, 0.7), hx, h / 2 - 14, hz, 0, a, 0, false);
        prop(g, new THREE.BoxGeometry(5.2, 0.5, 5.2), M(nCol, 0.2, 0.4, nCol), hx, h - 15, hz, 0, a, 0, false);
      } else if (isLava) {
        // Jagged volcanic caldera peaks
        const h = 16 + (i % 4) * 7;
        prop(g, new THREE.ConeGeometry(7, h, 5), M('#29120e', 0.9, 0.1, '#7c2d12'), hx, h / 2 - 6, hz, 0, a, 0, false);
      } else {
        // Floating sky monolith islands with glowing crystals underneath
        const yOff = -4 + (i % 3) * 5;
        prop(g, new THREE.CylinderGeometry(4.5, 1.5, 6, 7), M('#334155', 0.75, 0.15), hx, yOff, hz, 0, a, 0, false);
        prop(g, new THREE.CylinderGeometry(4.8, 4.6, 0.7, 7), M(g === 'arena6' || g === 'arena4' ? '#22c55e' : '#94a3b8', 0.6), hx, yOff + 3.2, hz, 0, a, 0, false);
      }
    }
  });

  return { groups, solids, crates, pk, SPW, movers, oceans, lavaMat, checkerTiles, particles, groundY };
}
