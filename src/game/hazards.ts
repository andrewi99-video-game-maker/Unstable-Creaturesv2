import * as THREE from 'three';
import { MapKey, SceneKey, SolidBox } from './types';
import { mkPirateShip, mkSharkMesh, SharkMesh, OLM } from './models';
import { createWarningRingTexture } from './textures';
import { sound } from './audio';
import { hasGroundAt, stepBody } from './physics';

export interface HazardEntity {
  id: number;
  kind: 'ship' | 'shark' | 'ball' | 'target' | 'beam' | 'boulder' | 'drone' | 'bolt' | 'roller' | 'train' | 'crusher' | 'tnt';
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  ang: number;
  phase: number;
  born: number;
  dur: number;
  tx: number;
  ty: number;
  tz: number;
  sup?: SolidBox | null;
  victimId?: number;
  dive?: boolean;
  hitCd?: Record<number, number>;
}

export interface HazardSnapshot {
  lvl: number;
  label: string;
  items: [number, string, number, number, number, number, number, number][]; // [id, kind, x, y, z, ang, r, phase]
  fallenTiles: number[];
  warnTiles: number[];
}

export class HazardSystem {
  private entities: HazardEntity[] = [];
  private nextId = 1;
  private startTime = 0;
  private lastSpawn = 0;
  private lastWave = 0;
  private fallenTiles = new Map<number, number>(); // tileIdx -> recoverTime (0 = permanent or long)
  private warnTiles = new Map<number, number>();   // tileIdx -> dropTime
  public level = 1;
  public statusLabel = '';

  // Client visual pools
  private visualRoot = new THREE.Group();
  private meshPool = new Map<number, { mesh: THREE.Object3D; kind: string; tx: number; ty: number; tz: number; tang: number; tr: number; tphase: number }>();
  private warnTex: THREE.CanvasTexture;
  private checkerTiles: { s: SolidBox; baseTop: number; baseY: number; idx: number }[] = [];

  constructor(scene: THREE.Scene, checkerTiles: { s: SolidBox; baseTop: number; baseY: number; idx: number }[]) {
    scene.add(this.visualRoot);
    this.warnTex = createWarningRingTexture('#ef4444');
    this.checkerTiles = checkerTiles;
  }

  public reset(now: number): void {
    this.entities = [];
    this.nextId = 1;
    this.startTime = now;
    this.lastSpawn = now;
    this.lastWave = 0;
    this.level = 1;
    this.statusLabel = '';
    this.fallenTiles.clear();
    this.warnTiles.clear();
    this.restoreAllTiles();
    this.clearVisuals();
  }

  public clearVisuals(): void {
    for (const [, v] of this.meshPool) {
      this.visualRoot.remove(v.mesh);
    }
    this.meshPool.clear();
  }

  private restoreAllTiles(): void {
    for (const t of this.checkerTiles) {
      t.s.held = false;
      t.s.top = t.baseTop;
      t.s.bottom = t.baseTop - (12 + t.baseTop);
      t.s.dy = 0;
      t.s.m.position.y = t.baseY;
      t.s.m.position.x = t.s.x;
      t.s.m.position.z = t.s.z;
      t.s.m.visible = true;
      const mats = Array.isArray(t.s.m.material) ? t.s.m.material : [t.s.m.material];
      mats.forEach((m) => {
        if (m instanceof THREE.MeshStandardMaterial) m.emissiveIntensity = 0;
      });
    }
  }

  public getSnapshot(): HazardSnapshot {
    return {
      lvl: this.level,
      label: this.statusLabel,
      items: this.entities.map((e) => [
        e.id,
        e.kind,
        Math.round(e.x * 100) / 100,
        Math.round(e.y * 100) / 100,
        Math.round(e.z * 100) / 100,
        Math.round(e.ang * 100) / 100,
        Math.round(e.r * 100) / 100,
        Math.round(e.phase * 100) / 100,
      ]),
      fallenTiles: [...this.fallenTiles.keys()],
      warnTiles: [...this.warnTiles.keys()],
    };
  }

  // Host simulation tick
  public updateHost(
    dt: number,
    now: number,
    phase: SceneKey,
    solids: SolidBox[],
    players: { id: number; alive: boolean; tx: number; ty: number; tz: number; ko: number; heldBy: number }[],
    callbacks: {
      onHit: (playerId: number, ang: number, dmg: number, kb: number, vy?: number) => void;
      onBlow: (playerId: number, vx: number, vy: number, vz: number, stun: number) => void;
      onSharkBite: (playerId: number, sharkId: number, x: number, y: number, z: number, ang: number) => void;
      onSharkDrop: (playerId: number, vx: number, vy: number, vz: number) => void;
      onFx: (kind: string, x: number, y: number, z: number) => void;
    }
  ): void {
    if (phase !== 'arena1') {
      if (this.entities.length > 0) this.entities = [];
      if (this.fallenTiles.size > 0 || this.warnTiles.size > 0) {
        this.fallenTiles.clear();
        this.warnTiles.clear();
        this.restoreAllTiles();
      }
      this.level = 1;
      this.statusLabel = '';
      return;
    }

    const elapsed = (now - this.startTime) / 1000;
    // Escalation stage every 18 seconds on Shark Reef
    const lvl = 1 + Math.floor(elapsed / 18);
    this.level = lvl;

    const alivePs = players.filter((p) => p.alive);
    this.simReefSharks(dt, now, lvl, solids, alivePs, callbacks);
  }

  // ---- ARENA 0: PIRATE SHIPS WITH CANNONS ----
  private simPirateShips(
    dt: number,
    now: number,
    lvl: number,
    alivePs: { id: number; alive: boolean; tx: number; ty: number; tz: number }[],
    cb: { onHit: Function; onBlow: Function; onFx: Function }
  ): void {
    const desiredShips = Math.min(5, 1 + Math.floor((lvl - 1) * 0.8));
    const ships = this.entities.filter((e) => e.kind === 'ship');
    if (ships.length < desiredShips && (now - this.startTime > 4000)) {
      const idx = ships.length;
      const ang = (idx / Math.max(1, desiredShips)) * Math.PI * 2;
      const dist = 23.5;
      this.entities.push({
        id: this.nextId++,
        kind: 'ship',
        x: Math.cos(ang) * dist,
        y: -1.65,
        z: Math.sin(ang) * dist,
        vx: 0,
        vy: 0,
        vz: 0,
        r: 1,
        ang: ang + Math.PI / 2,
        phase: ang,
        born: now,
        dur: 0,
        tx: 0,
        ty: 0,
        tz: 0,
      });
    }
    this.statusLabel = ships.length > 0
      ? `PIRATE ARMADA · ${ships.length} SHIP${ships.length > 1 ? 'S' : ''} ATTACKING`
      : 'PIRATE SHIPS INBOUND…';

    const fireInterval = Math.max(1350, 3400 - lvl * 380);
    for (const s of this.entities) {
      if (s.kind !== 'ship') continue;
      s.phase += dt * (0.28 + lvl * 0.04);
      const dist = Math.max(18.5, 24.5 - lvl * 0.7);
      s.x = Math.cos(s.phase) * dist;
      s.z = Math.sin(s.phase) * dist;
      s.y = -1.65 + Math.sin(now * 0.002 + s.id) * 0.22;
      s.ang = Math.atan2(-s.z, s.x) + Math.PI; // broadside faces inward

      if (now - s.born > fireInterval && alivePs.length > 0) {
        s.born = now;
        const shots = lvl >= 4 ? 2 : 1;
        for (let k = 0; k < shots; k++) {
          const tg = alivePs[Math.floor(Math.random() * alivePs.length)];
          const tx = Math.max(-11.5, Math.min(11.5, tg.tx + (Math.random() - 0.5) * 4.5));
          const tz = Math.max(-11.5, Math.min(11.5, tg.tz + (Math.random() - 0.5) * 4.5));
          const ty = 0.05;
          const flight = Math.max(0.85, 1.35 - lvl * 0.06);
          const tid = this.nextId++;
          this.entities.push({
            id: tid,
            kind: 'target',
            x: tx,
            y: ty,
            z: tz,
            vx: 0,
            vy: 0,
            vz: 0,
            r: 3.1,
            ang: 0,
            phase: 0,
            born: now,
            dur: flight * 1000,
            tx,
            ty,
            tz,
          });
          this.entities.push({
            id: this.nextId++,
            kind: 'ball',
            x: s.x,
            y: s.y + 2.4,
            z: s.z,
            vx: (tx - s.x) / flight,
            vy: (ty - (s.y + 2.4) + 0.5 * 22 * flight * flight) / flight,
            vz: (tz - s.z) / flight,
            r: 0.65,
            ang: 0,
            phase: 0,
            born: now,
            dur: flight * 1000,
            tx,
            ty,
            tz,
          });
          cb.onFx('cannon', s.x, s.y + 2.4, s.z);
        }
      }
    }

    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (e.kind === 'target') {
        e.phase = Math.min(1, (now - e.born) / e.dur);
        if (now - e.born >= e.dur) this.entities.splice(i, 1);
      } else if (e.kind === 'ball') {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.z += e.vz * dt;
        e.vy -= 22 * dt;
        if (now - e.born >= e.dur || e.y <= e.ty) {
          cb.onFx('boom', e.tx, e.ty + 0.4, e.tz);
          const R = 4.6;
          for (const q of alivePs) {
            const dx = q.tx - e.tx;
            const dz = q.tz - e.tz;
            const d = Math.hypot(dx, dz);
            if (d < R && q.ty < 5) {
              const f = 1 - d / R;
              const ang = Math.atan2(dx || 0.1, dz || 0.1);
              cb.onHit(q.id, ang, 24 + 34 * f, 14 + 14 * f);
              cb.onBlow(q.id, Math.sin(ang) * (10 + 16 * f), 7 + 6 * f, Math.cos(ang) * (10 + 16 * f), 0.35);
            }
          }
          this.entities.splice(i, 1);
        }
      }
    }
  }

  // ---- ARENA 1: SHARK REEF (WATER MAP — SHARKS PATROL IN WATER, JUMP ONTO LAND, BITE & TOSS!) ----
  private simReefSharks(
    dt: number,
    now: number,
    lvl: number,
    solids: SolidBox[],
    alivePs: { id: number; alive: boolean; tx: number; ty: number; tz: number; ko: number; heldBy: number }[],
    cb: { onHit: Function; onSharkBite: Function; onSharkDrop: Function; onFx: Function }
  ): void {
    const WATER_Y = -0.82;
    const desiredSharks = Math.min(3, 1 + Math.floor((lvl - 1) * 0.45));
    const sharks = this.entities.filter((e) => e.kind === 'shark');
    if (sharks.length < desiredSharks && now - this.lastSpawn > 4800 && now - this.startTime > 4800) {
      this.lastSpawn = now;
      const ang = Math.random() * Math.PI * 2;
      const dist = 20.5 + Math.random() * 2.5;
      this.entities.push({
        id: this.nextId++,
        kind: 'shark',
        x: Math.cos(ang) * dist,
        y: -1.1,
        z: Math.sin(ang) * dist,
        vx: 0,
        vy: 0,
        vz: 0,
        r: 0.72,
        ang: ang + Math.PI,
        phase: 0, // 0=patrol water, 1=jump onto island & hunt, 2=dragging victim toward water, 3=diving back in
        born: now,
        dur: 4200 + Math.random() * 2400,
        tx: 0,
        ty: 0,
        tz: 0,
        sup: null,
        victimId: 0,
        hitCd: {},
      });
    }

    this.statusLabel = `SHARK REEF · ${sharks.length} SHARK${sharks.length > 1 ? 'S' : ''} PATROLLING`;

    for (const s of this.entities) {
      if (s.kind !== 'shark') continue;
      if (!s.hitCd) s.hitCd = {};
      if (s.phase === 0) {
        // Patrol circle in deep open water OUTSIDE all reef islands
        const spd = 0.55 + lvl * 0.08;
        const a = Math.atan2(s.z, s.x) + spd * dt;
        const rad = 20.5 + Math.sin(now * 0.002 + s.id) * 1.4;
        const nx = Math.cos(a) * rad;
        const nz = Math.sin(a) * rad;
        s.ang = Math.atan2(nx - s.x, nz - s.z);
        s.x = nx;
        s.z = nz;
        s.y = WATER_Y - 0.14 + Math.sin(now * 0.004 + s.id) * 0.16;
        s.vx = s.vy = s.vz = 0;
        s.sup = null;

        // Time to leap out of the water onto the island and hunt a player
        if (now - s.born > Math.max(2600, s.dur - lvl * 220) && alivePs.length > 0) {
          const tg = alivePs[Math.floor(Math.random() * alivePs.length)];
          s.tx = tg.tx;
          s.ty = Math.max(0.2, tg.ty);
          s.tz = tg.tz;
          const dx = s.tx - s.x;
          const dz = s.tz - s.z;
          const d = Math.hypot(dx, dz) || 1;
          s.phase = 1;
          s.born = now;
          s.dur = 2500 + lvl * 160;
          s.y = WATER_Y + 0.3;
          s.vx = (dx / d) * 7.8;
          s.vz = (dz / d) * 7.8;
          s.vy = 11.4;
          s.sup = null;
          s.ang = Math.atan2(dx, dz);
          cb.onFx('splash', s.x, WATER_Y + 0.2, s.z);
        }
      } else if (s.phase === 1) {
        // Jump & bound across the islands with real solid collision (never swimming through terrain)
        let best = alivePs.find((p) => !p.heldBy && (!s.hitCd![p.id] || now > s.hitCd![p.id])) || null;
        let bd = 999;
        for (const p of alivePs) {
          if (p.heldBy || (s.hitCd![p.id] && now <= s.hitCd![p.id])) continue;
          const d = Math.hypot(p.tx - s.x, p.tz - s.z);
          if (d < bd) { bd = d; best = p; }
        }
        if (best) {
          s.tx = best.tx;
          s.ty = Math.max(0.1, best.ty);
          s.tz = best.tz;
        }
        const dx = s.tx - s.x;
        const dz = s.tz - s.z;
        const d = Math.hypot(dx, dz) || 1;
        const ux = dx / d;
        const uz = dz / d;
        const chaseSpd = 4.9 + lvl * 0.42;
        const steer = Math.min(1, dt * (s.sup ? 6.5 : 2.8));
        s.vx += (ux * chaseSpd - s.vx) * steer;
        s.vz += (uz * chaseSpd - s.vz) * steer;

        const prevX = s.x;
        const prevZ = s.z;
        stepBody(s as never, dt, 0.7, 1.35, solids, null, 24);
        const moved = Math.hypot(s.x - prevX, s.z - prevZ);
        const blocked = moved < chaseSpd * dt * 0.35;

        // Float at ocean surface if between islands, and leap up onto island cliffs/steps
        if (!s.sup && s.y <= WATER_Y) {
          s.y = WATER_Y;
          if (s.vy < 0) s.vy = 0;
          if (blocked || hasGroundAt(solids, s.x + ux * 2.4, s.z + uz * 2.4, s.y + 3)) {
            s.vy = 11.2;
            cb.onFx('splash', s.x, WATER_Y + 0.2, s.z);
          }
        } else if (s.sup) {
          if (blocked || (best && best.ty > s.y + 0.6 && d < 5)) {
            s.vy = 9.8;
            s.sup = null;
          } else if (Math.random() < dt * 1.4) {
            s.vy = 5.5;
            s.sup = null;
          }
        }
        s.ang = Math.atan2(dx, dz);

        // BITE! Grab the player briefly and toss into shallower water (escapable!)
        if (best && !best.heldBy && Math.hypot(best.tx - s.x, best.tz - s.z) < 1.08 && Math.abs(best.ty - s.y) < 1.55) {
          s.victimId = best.id;
          s.hitCd![best.id] = now + 3500;
          s.phase = 2;
          s.born = now;
          const outLen = Math.hypot(s.x, s.z) || 1;
          s.tx = (s.x / outLen) * 21;
          s.tz = (s.z / outLen) * 21;
          s.vx = (s.x / outLen) * 8.2;
          s.vz = (s.z / outLen) * 8.2;
          s.vy = 7.6;
          s.sup = null;
          cb.onFx('chomp', s.x, s.y, s.z);
        } else if (now - s.born > s.dur) {
          // Leap back toward deep water
          s.phase = 3;
          s.born = now;
          const outLen = Math.hypot(s.x, s.z) || 1;
          s.tx = (s.x / outLen) * 21.5;
          s.tz = (s.z / outLen) * 21.5;
          if (s.sup) {
            s.vy = 8.6;
            s.sup = null;
          }
        }
      } else if (s.phase === 2) {
        // Victim clamped briefly in shark's jaws, tossed toward water with time to swim back!
        const vic = alivePs.find((p) => p.id === s.victimId);
        if (!vic) {
          s.victimId = 0;
          s.phase = 3;
          s.born = now;
          continue;
        }
        const dx = s.tx - s.x;
        const dz = s.tz - s.z;
        const d = Math.hypot(dx, dz) || 1;
        const dragSpd = 7.6 + lvl * 0.35;
        const elapsedDrag = (now - s.born) / 1000;
        const overWater = Math.hypot(s.x, s.z) > 17.8 || (Math.abs(s.x) > 8.2 && Math.abs(s.z) > 8.2 && !hasGroundAt(solids, s.x, s.z, 3));

        if (overWater && s.y <= WATER_Y + 0.4) {
          s.x += (dx / d) * dragSpd * dt;
          s.z += (dz / d) * dragSpd * dt;
          s.vy -= 14 * dt;
          s.y += s.vy * dt;
        } else {
          s.vx = (dx / d) * dragSpd;
          s.vz = (dz / d) * dragSpd;
          const prevX = s.x;
          const prevZ = s.z;
          stepBody(s as never, dt, 0.7, 1.35, solids, null, 22);
          if ((s.sup || Math.hypot(s.x - prevX, s.z - prevZ) < dragSpd * dt * 0.35) && !overWater) {
            s.vy = 8.5;
            s.sup = null;
          }
        }
        s.ang = Math.atan2(dx, dz);

        const jawX = s.x + Math.sin(s.ang) * 1.45;
        const jawZ = s.z + Math.cos(s.ang) * 1.45;
        cb.onSharkBite(vic.id, s.id, jawX, s.y - 0.35, jawZ, s.ang);

        if (s.y < WATER_Y - 2.2 || elapsedDrag > 1.55) {
          cb.onFx('splash', s.x, WATER_Y + 0.2, s.z);
          cb.onSharkDrop(vic.id, Math.sin(s.ang) * 4.5, 1.5, Math.cos(s.ang) * 4.5);
          s.victimId = 0;
          s.phase = 0;
          const outLen = Math.hypot(s.x, s.z) || 1;
          s.x = (s.x / outLen) * 20.5;
          s.z = (s.z / outLen) * 20.5;
          s.y = -1.1;
          s.vx = s.vy = s.vz = 0;
          s.sup = null;
          s.born = now;
          s.dur = 3600 + Math.random() * 2400;
        }
      } else if (s.phase === 3) {
        // Returning back to deep water with solid collision (hops over any wall/ledge)
        const dx = s.tx - s.x;
        const dz = s.tz - s.z;
        const d = Math.hypot(dx, dz) || 1;
        s.vx = (dx / d) * 10.5;
        s.vz = (dz / d) * 10.5;
        const prevX = s.x;
        const prevZ = s.z;
        stepBody(s as never, dt, 0.7, 1.35, solids, null, 22);
        if (!s.sup && s.y < WATER_Y) {
          s.y = WATER_Y - 0.1;
          s.vy = 0;
        } else if (s.sup || Math.hypot(s.x - prevX, s.z - prevZ) < 10.5 * dt * 0.35) {
          s.vy = 9.0;
          s.sup = null;
        }
        s.ang = Math.atan2(dx, dz);
        if ((d < 2.5 && !s.sup) || now - s.born > 2400) {
          s.phase = 0;
          const outLen = Math.hypot(s.x, s.z) || 1;
          s.x = (s.x / outLen) * 20.5;
          s.z = (s.z / outLen) * 20.5;
          s.y = WATER_Y - 0.15;
          s.vx = s.vy = s.vz = 0;
          s.sup = null;
          s.born = now;
          s.dur = 2800 + Math.random() * 2200;
          cb.onFx('splash', s.x, WATER_Y + 0.2, s.z);
        }
      }
    }
  }

  // ---- ARENA 2: ROTATING LASER GRID ----
  private simLaserGrid(
    dt: number,
    now: number,
    lvl: number,
    alivePs: { id: number; alive: boolean; tx: number; ty: number; tz: number }[],
    cb: { onHit: Function; onBlow: Function; onFx: Function }
  ): void {
    const desired = Math.min(4, 1 + Math.floor((lvl - 1) * 0.75));
    const beams = this.entities.filter((e) => e.kind === 'beam');
    if (beams.length < desired && now - this.startTime > 3000) {
      const idx = beams.length;
      this.entities.push({
        id: this.nextId++,
        kind: 'beam',
        x: 0,
        y: 1.45,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        r: 15,
        ang: (idx / Math.max(1, desired)) * Math.PI * 2,
        phase: idx % 2 === 0 ? 1 : -1,
        born: now,
        dur: 0,
        tx: 0,
        ty: 0,
        tz: 0,
        hitCd: {},
      });
    }
    this.statusLabel = `LASER GRID · ${beams.length} BEAM${beams.length > 1 ? 'S' : ''} ACTIVE`;
    for (const b of this.entities) {
      if (b.kind !== 'beam') continue;
      b.ang += b.phase * dt * (0.75 + lvl * 0.22);
      const fx = Math.sin(b.ang);
      const fz = Math.cos(b.ang);
      for (const q of alivePs) {
        if (q.ty > 2.2) continue;
        const projLen = q.tx * fx + q.tz * fz;
        if (projLen < 1.5 || projLen > 15.5) continue;
        const perp = Math.abs(q.tx * fz - q.tz * fx);
        if (perp < 0.9 && (!b.hitCd![q.id] || now > b.hitCd![q.id])) {
          b.hitCd![q.id] = now + 700;
          const kbAng = Math.atan2(fz * b.phase, -fx * b.phase);
          cb.onHit(q.id, kbAng, 28, 16);
          cb.onBlow(q.id, Math.sin(kbAng) * 16, 6.5, Math.cos(kbAng) * 16, 0.35);
          cb.onFx('laser', q.tx, q.ty + 1, q.tz);
        }
      }
    }
  }

  // ---- ARENA 3: VOLCANIC MAGMA METEORS ----
  private simMagmaMeteors(
    dt: number,
    now: number,
    lvl: number,
    alivePs: { id: number; alive: boolean; tx: number; ty: number; tz: number }[],
    cb: { onHit: Function; onBlow: Function; onFx: Function }
  ): void {
    this.statusLabel = `MAGMA METEORS · WAVE ${lvl}`;
    const interval = Math.max(700, 2200 - lvl * 300);
    if (now - this.lastSpawn > interval && alivePs.length > 0 && now - this.startTime > 3000) {
      this.lastSpawn = now;
      const count = lvl >= 4 ? 2 : 1;
      for (let c = 0; c < count; c++) {
        const tg = alivePs[Math.floor(Math.random() * alivePs.length)];
        const tx = Math.max(-13, Math.min(13, tg.tx + (Math.random() - 0.5) * 4));
        const tz = Math.max(-13, Math.min(13, tg.tz + (Math.random() - 0.5) * 4));
        const dur = 1150;
        this.entities.push({
          id: this.nextId++,
          kind: 'target',
          x: tx, y: 0.05, z: tz, vx: 0, vy: 0, vz: 0, r: 3.2, ang: 0, phase: 0, born: now, dur, tx, ty: 0.05, tz,
        });
        this.entities.push({
          id: this.nextId++,
          kind: 'boulder',
          x: tx, y: 22, z: tz, vx: 0, vy: -22 / (dur / 1000), vz: 0, r: 0.9, ang: Math.random() * 6, phase: 1, born: now, dur, tx, ty: 0.1, tz,
        });
      }
    }
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (e.kind === 'target') {
        e.phase = Math.min(1, (now - e.born) / e.dur);
        if (now - e.born >= e.dur) this.entities.splice(i, 1);
      } else if (e.kind === 'boulder') {
        e.y += e.vy * dt;
        e.ang += dt * 4;
        if (now - e.born >= e.dur || e.y <= 0.2) {
          cb.onFx('boom', e.tx, 0.5, e.tz);
          for (const q of alivePs) {
            const dx = q.tx - e.tx;
            const dz = q.tz - e.tz;
            const d = Math.hypot(dx, dz);
            if (d < 4.2) {
              const f = 1 - d / 4.2;
              const ang = Math.atan2(dx || 0.1, dz || 0.1);
              cb.onHit(q.id, ang, 25 + 30 * f, 15 + 14 * f);
              cb.onBlow(q.id, Math.sin(ang) * (12 + 14 * f), 7.5, Math.cos(ang) * (12 + 14 * f), 0.35);
            }
          }
          this.entities.splice(i, 1);
        }
      }
    }
  }

  // ---- ARENA 4: ROLLING TEMPLE BOULDERS ----
  private simRollingBoulders(
    dt: number,
    now: number,
    lvl: number,
    alivePs: { id: number; alive: boolean; tx: number; ty: number; tz: number }[],
    cb: { onHit: Function; onBlow: Function; onFx: Function }
  ): void {
    this.statusLabel = `TEMPLE BOULDERS · WAVE ${lvl}`;
    const interval = Math.max(950, 2600 - lvl * 320);
    if (now - this.lastSpawn > interval && now - this.startTime > 3000) {
      this.lastSpawn = now;
      const a = Math.random() * Math.PI * 2;
      const spd = 8.5 + lvl * 1.4;
      this.entities.push({
        id: this.nextId++,
        kind: 'boulder',
        x: 0, y: 4.9, z: 0, vx: Math.sin(a) * spd, vy: 0, vz: Math.cos(a) * spd, r: 1.2, ang: 0, phase: 0, born: now, dur: 4500, tx: 0, ty: 0, tz: 0, hitCd: {},
      });
    }
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (e.kind !== 'boulder') continue;
      e.x += e.vx * dt;
      e.z += e.vz * dt;
      e.ang += dt * 6;
      const dist = Math.max(Math.abs(e.x), Math.abs(e.z));
      const floorY = dist < 3 ? 3.6 : dist < 7 ? 2.4 : dist < 11 ? 1.2 : 0;
      const targetY = floorY + e.r;
      if (e.y > targetY) {
        e.vy -= 26 * dt;
        e.y = Math.max(targetY, e.y + e.vy * dt);
      } else {
        e.y = targetY;
        e.vy = 0;
      }
      for (const q of alivePs) {
        if (Math.hypot(q.tx - e.x, q.tz - e.z) < 1.65 && Math.abs(q.ty + 0.9 - e.y) < 1.8 && (!e.hitCd![q.id] || now > e.hitCd![q.id])) {
          e.hitCd![q.id] = now + 650;
          const ang = Math.atan2(e.vx, e.vz);
          cb.onHit(q.id, ang, 32, 18);
          cb.onBlow(q.id, Math.sin(ang) * 16, 6.5, Math.cos(ang) * 16, 0.4);
          cb.onFx('smash', q.tx, q.ty + 1, q.tz);
        }
      }
      if (dist > 17 || now - e.born > e.dur) this.entities.splice(i, 1);
    }
  }

  // ---- ARENA 5: ROGUE BUMPER SHUTTLES ----
  private simRogueShuttles(
    dt: number,
    now: number,
    lvl: number,
    alivePs: { id: number; alive: boolean; tx: number; ty: number; tz: number }[],
    cb: { onHit: Function; onBlow: Function; onFx: Function }
  ): void {
    const desired = Math.min(5, 1 + Math.floor((lvl - 1) * 0.8));
    const drones = this.entities.filter((e) => e.kind === 'drone');
    if (drones.length < desired && now - this.startTime > 3000) {
      const idx = drones.length;
      const a = (idx / Math.max(1, desired)) * Math.PI * 2;
      this.entities.push({
        id: this.nextId++, kind: 'drone', x: Math.cos(a) * 12, y: 1.1, z: Math.sin(a) * 12, vx: 0, vy: 0, vz: 0, r: 1.05, ang: a, phase: a, born: now, dur: 0, tx: 0, ty: 0, tz: 0, hitCd: {},
      });
    }
    this.statusLabel = `ROGUE SHUTTLES · ${drones.length} ACTIVE`;
    for (const d of this.entities) {
      if (d.kind !== 'drone') continue;
      d.phase += dt * (1.1 + lvl * 0.25);
      const rad = 6 + 9 * Math.abs(Math.sin(d.phase * 0.55 + d.id));
      const nx = Math.cos(d.phase) * rad;
      const nz = Math.sin(d.phase) * rad;
      d.ang = Math.atan2(nx - d.x, nz - d.z);
      d.vx = (nx - d.x) / Math.max(0.01, dt);
      d.vz = (nz - d.z) / Math.max(0.01, dt);
      d.x = nx;
      d.z = nz;
      for (const q of alivePs) {
        if (Math.hypot(q.tx - d.x, q.tz - d.z) < 1.55 && Math.abs(q.ty - d.y + 0.5) < 1.8 && (!d.hitCd![q.id] || now > d.hitCd![q.id])) {
          d.hitCd![q.id] = now + 600;
          const ang = Math.atan2(q.tx - d.x, q.tz - d.z);
          cb.onHit(q.id, ang, 28, 18);
          cb.onBlow(q.id, Math.sin(ang) * 18, 7.5, Math.cos(ang) * 18, 0.35);
          cb.onFx('smash', q.tx, q.ty + 1, q.tz);
        }
      }
    }
  }

  // ---- ARENA 6: ARCANE SKY-BOLT BEACONS ----
  private simSkyBolts(
    _dt: number,
    now: number,
    lvl: number,
    alivePs: { id: number; alive: boolean; tx: number; ty: number; tz: number }[],
    cb: { onHit: Function; onBlow: Function; onFx: Function }
  ): void {
    this.statusLabel = `ARCANE SKY-BOLTS · WAVE ${lvl}`;
    const interval = Math.max(750, 2200 - lvl * 280);
    if (now - this.lastSpawn > interval && alivePs.length > 0 && now - this.startTime > 3000) {
      this.lastSpawn = now;
      const n = Math.min(3, 1 + Math.floor(lvl / 2));
      for (let i = 0; i < n; i++) {
        const tg = alivePs[Math.floor(Math.random() * alivePs.length)];
        const tx = Math.max(-13.5, Math.min(13.5, tg.tx + (Math.random() - 0.5) * 3));
        const tz = Math.max(-13.5, Math.min(13.5, tg.tz + (Math.random() - 0.5) * 3));
        this.entities.push({
          id: this.nextId++, kind: 'bolt', x: tx, y: 0.08, z: tz, vx: 0, vy: 0, vz: 0, r: 3.3, ang: 0, phase: 0, born: now, dur: 1100, tx, ty: 0.08, tz,
        });
      }
    }
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (e.kind !== 'bolt') continue;
      e.phase = Math.min(1, (now - e.born) / e.dur);
      if (now - e.born >= e.dur) {
        cb.onFx('laser', e.tx, 1.5, e.tz);
        for (const q of alivePs) {
          const dx = q.tx - e.tx;
          const dz = q.tz - e.tz;
          const d = Math.hypot(dx, dz);
          if (d < 3.6) {
            const f = 1 - d / 3.6;
            const ang = Math.atan2(dx || 0.1, dz || 0.1);
            cb.onHit(q.id, ang, 28 + 30 * f, 15 + 14 * f);
            cb.onBlow(q.id, Math.sin(ang) * (14 + 14 * f), 9, Math.cos(ang) * (14 + 14 * f), 0.35);
          }
        }
        this.entities.splice(i, 1);
      }
    }
  }

  // ---- ARENA 7: SIEGE MORTAR BARRAGE ----
  private simSiegeMortars(
    dt: number,
    now: number,
    lvl: number,
    alivePs: { id: number; alive: boolean; tx: number; ty: number; tz: number }[],
    cb: { onHit: Function; onBlow: Function; onFx: Function }
  ): void {
    this.statusLabel = `SIEGE MORTAR BARRAGE · WAVE ${lvl}`;
    const interval = Math.max(850, 2400 - lvl * 320);
    if (now - this.lastSpawn > interval && alivePs.length > 0 && now - this.startTime > 3000) {
      this.lastSpawn = now;
      const n = lvl >= 3 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const tg = alivePs[Math.floor(Math.random() * alivePs.length)];
        const tx = Math.max(-15, Math.min(15, tg.tx + (Math.random() - 0.5) * 3.5));
        const tz = Math.max(-6.5, Math.min(6.5, tg.tz + (Math.random() - 0.5) * 3.5));
        const dur = 1250;
        const sx = tx < 0 ? 22 : -22;
        this.entities.push({ id: this.nextId++, kind: 'target', x: tx, y: 0.08, z: tz, vx: 0, vy: 0, vz: 0, r: 3.1, ang: 0, phase: 0, born: now, dur, tx, ty: 0.08, tz });
        this.entities.push({
          id: this.nextId++, kind: 'ball', x: sx, y: 12, z: tz,
          vx: (tx - sx) / (dur / 1000),
          vy: (0.1 - 12 + 0.5 * 22 * (dur / 1000) * (dur / 1000)) / (dur / 1000),
          vz: 0, r: 0.65, ang: 0, phase: 0, born: now, dur, tx, ty: 0.1, tz,
        });
      }
    }
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (e.kind === 'target') {
        e.phase = Math.min(1, (now - e.born) / e.dur);
        if (now - e.born >= e.dur) this.entities.splice(i, 1);
      } else if (e.kind === 'ball') {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.z += e.vz * dt;
        e.vy -= 22 * dt;
        if (now - e.born >= e.dur || e.y <= 0.15) {
          cb.onFx('boom', e.tx, 0.5, e.tz);
          for (const q of alivePs) {
            const dx = q.tx - e.tx;
            const dz = q.tz - e.tz;
            const d = Math.hypot(dx, dz);
            if (d < 4.2) {
              const f = 1 - d / 4.2;
              const ang = Math.atan2(dx || 0.1, dz || 0.1);
              cb.onHit(q.id, ang, 25 + 34 * f, 15 + 14 * f);
              cb.onBlow(q.id, Math.sin(ang) * (12 + 15 * f), 8, Math.cos(ang) * (12 + 15 * f), 0.35);
            }
          }
          this.entities.splice(i, 1);
        }
      }
    }
  }

  // ---- ARENA 8: COLLAPSING CHECKER TILES ----
  private simCheckerCollapse(dt: number, now: number, lvl: number): void {
    const activeCount = this.checkerTiles.length - this.fallenTiles.size;
    this.statusLabel = `COLLAPSING TILES · ${activeCount}/${this.checkerTiles.length} LEFT`;
    const interval = Math.max(900, 2800 - lvl * 360);
    if (now - this.lastSpawn > interval && now - this.startTime > 3000) {
      this.lastSpawn = now;
      const avail = this.checkerTiles.filter((t) => !this.fallenTiles.has(t.idx) && !this.warnTiles.has(t.idx));
      if (avail.length > 2) {
        const pick = avail[Math.floor(Math.random() * avail.length)];
        this.warnTiles.set(pick.idx, now + 1800);
      }
    }

    for (const [idx, dropAt] of this.warnTiles) {
      if (now >= dropAt) {
        this.warnTiles.delete(idx);
        this.fallenTiles.set(idx, now + Math.max(5500, 9000 - lvl * 500));
      }
    }
    // In higher levels, tiles stay gone longer; up to 4 safe tiles remain at minimum
    for (const [idx, recAt] of this.fallenTiles) {
      if (now >= recAt && this.fallenTiles.size > 6) {
        this.fallenTiles.delete(idx);
      }
    }
    this.applyTileStates(dt, now);
  }

  public applyTileStates(dt: number, now: number): void {
    for (const t of this.checkerTiles) {
      const isFallen = this.fallenTiles.has(t.idx);
      const isWarn = this.warnTiles.has(t.idx);
      if (isFallen) {
        t.s.held = true;
        t.s.m.position.y = THREE.MathUtils.damp(t.s.m.position.y, t.baseY - 24, 6, dt);
        if (t.s.m.position.y < t.baseY - 20) t.s.m.visible = false;
      } else {
        t.s.held = false;
        t.s.m.visible = true;
        t.s.m.position.y = THREE.MathUtils.damp(t.s.m.position.y, t.baseY, 8, dt);
        t.s.top = t.baseTop;
        t.s.bottom = t.baseTop - (16 + t.baseTop);
        if (isWarn) {
          t.s.m.position.x = t.s.x + Math.sin(now * 0.05) * 0.16;
          t.s.m.position.z = t.s.z + Math.cos(now * 0.045) * 0.16;
        } else {
          t.s.m.position.x = t.s.x;
          t.s.m.position.z = t.s.z;
        }
      }
    }
  }

  // ---- ARENA 9: CHARGING ARENA ROLLERS ----
  private simArenaRollers(
    dt: number,
    now: number,
    lvl: number,
    alivePs: { id: number; alive: boolean; tx: number; ty: number; tz: number }[],
    cb: { onHit: Function; onBlow: Function; onFx: Function }
  ): void {
    this.statusLabel = `CHARGING ROLLERS · WAVE ${lvl}`;
    const interval = Math.max(1000, 2700 - lvl * 350);
    if (now - this.lastSpawn > interval && now - this.startTime > 3000) {
      this.lastSpawn = now;
      const side = Math.floor(Math.random() * 4);
      const spd = 11 + lvl * 1.8;
      const lane = (Math.random() - 0.5) * 16;
      let x = 0, z = 0, vx = 0, vz = 0;
      if (side === 0) { x = -16; z = lane; vx = spd; }
      else if (side === 1) { x = 16; z = lane; vx = -spd; }
      else if (side === 2) { x = lane; z = -16; vz = spd; }
      else { x = lane; z = 16; vz = -spd; }
      this.entities.push({
        id: this.nextId++, kind: 'roller', x, y: 1.0, z, vx, vy: 0, vz, r: 1.0, ang: Math.atan2(vx, vz), phase: 0, born: now, dur: 4000, tx: 0, ty: 0, tz: 0, hitCd: {},
      });
    }
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (e.kind !== 'roller') continue;
      e.x += e.vx * dt;
      e.z += e.vz * dt;
      e.phase += dt * 10;
      for (const q of alivePs) {
        if (q.ty < 1.8 && Math.hypot(q.tx - e.x, q.tz - e.z) < 1.55 && (!e.hitCd![q.id] || now > e.hitCd![q.id])) {
          e.hitCd![q.id] = now + 600;
          const ang = Math.atan2(e.vx, e.vz);
          cb.onHit(q.id, ang, 32, 18);
          cb.onBlow(q.id, Math.sin(ang) * 18, 8, Math.cos(ang) * 18, 0.4);
          cb.onFx('smash', q.tx, q.ty + 1, q.tz);
        }
      }
      if (Math.abs(e.x) > 18 || Math.abs(e.z) > 18 || now - e.born > e.dur) this.entities.splice(i, 1);
    }
  }

  // ---- ARENA 10: RUNAWAY HOVER TRAINS ----
  private simHoverTrains(
    dt: number,
    now: number,
    lvl: number,
    alivePs: { id: number; alive: boolean; tx: number; ty: number; tz: number }[],
    cb: { onHit: Function; onBlow: Function; onFx: Function }
  ): void {
    const desired = Math.min(5, 1 + Math.floor((lvl - 1) * 0.8));
    const trains = this.entities.filter((e) => e.kind === 'train');
    if (trains.length < desired && now - this.startTime > 3000) {
      this.entities.push({
        id: this.nextId++, kind: 'train', x: 14, y: 0.75, z: 0, vx: 0, vy: 0, vz: 0, r: 1.25, ang: 0, phase: (trains.length / Math.max(1, desired)) * 4, born: now, dur: 0, tx: 0, ty: 0, tz: 0, hitCd: {},
      });
    }
    this.statusLabel = `HOVER TRAINS · ${trains.length} RACING`;
    for (const tr of this.entities) {
      if (tr.kind !== 'train') continue;
      tr.phase = (tr.phase + dt * (0.45 + lvl * 0.11)) % 4;
      const seg = Math.floor(tr.phase);
      const u = tr.phase - seg;
      const R = 14;
      let nx = 0, nz = 0, ang = 0;
      if (seg === 0) { nx = R; nz = -R + u * 2 * R; ang = 0; }
      else if (seg === 1) { nx = R - u * 2 * R; nz = R; ang = -Math.PI / 2; }
      else if (seg === 2) { nx = -R; nz = R - u * 2 * R; ang = Math.PI; }
      else { nx = -R + u * 2 * R; nz = -R; ang = Math.PI / 2; }
      tr.x = nx;
      tr.z = nz;
      tr.ang = ang;
      for (const q of alivePs) {
        if (q.ty < 2 && Math.hypot(q.tx - tr.x, q.tz - tr.z) < 1.7 && (!tr.hitCd![q.id] || now > tr.hitCd![q.id])) {
          tr.hitCd![q.id] = now + 650;
          cb.onHit(q.id, ang, 34, 19);
          cb.onBlow(q.id, Math.sin(ang) * 18, 7.5, Math.cos(ang) * 18, 0.4);
          cb.onFx('smash', q.tx, q.ty + 1, q.tz);
        }
      }
    }
  }

  // ---- ARENA 11: SWINGING CRUSHER ARMS ----
  private simCrushers(
    dt: number,
    now: number,
    lvl: number,
    alivePs: { id: number; alive: boolean; tx: number; ty: number; tz: number }[],
    cb: { onHit: Function; onBlow: Function; onFx: Function }
  ): void {
    const desired = Math.min(4, 1 + Math.floor((lvl - 1) * 0.75));
    const crushers = this.entities.filter((e) => e.kind === 'crusher');
    if (crushers.length < desired && now - this.startTime > 3000) {
      const idx = crushers.length;
      const upper = idx % 2 === 1;
      this.entities.push({
        id: this.nextId++, kind: 'crusher', x: 0, y: upper ? 4.9 : 1.4, z: 0, vx: 0, vy: 0, vz: 0, r: 1.35, ang: idx * 1.6, phase: idx % 2 ? -1 : 1, born: now, dur: upper ? 1 : 0, tx: 0, ty: 0, tz: 0, hitCd: {},
      });
    }
    this.statusLabel = `CRUSHER ARMS · ${crushers.length} SWINGING`;
    for (const cr of this.entities) {
      if (cr.kind !== 'crusher') continue;
      cr.ang += cr.phase * dt * (1.2 + lvl * 0.25);
      const rad = cr.dur ? 5.2 : 10.5;
      const nx = Math.cos(cr.ang) * rad;
      const nz = Math.sin(cr.ang) * rad;
      const tang = cr.ang + (cr.phase > 0 ? Math.PI / 2 : -Math.PI / 2);
      cr.x = nx;
      cr.z = nz;
      for (const q of alivePs) {
        if (Math.hypot(q.tx - cr.x, q.tz - cr.z) < 1.8 && Math.abs(q.ty + 1 - cr.y) < 1.8 && (!cr.hitCd![q.id] || now > cr.hitCd![q.id])) {
          cr.hitCd![q.id] = now + 600;
          cb.onHit(q.id, tang, 30, 18);
          cb.onBlow(q.id, Math.sin(tang) * 18, 7, Math.cos(tang) * 18, 0.35);
          cb.onFx('smash', q.tx, q.ty + 1, q.tz);
        }
      }
    }
  }

  // ---- ARENA 12: SKY CRANE TNT DROPS ----
  private simCraneTNT(
    dt: number,
    now: number,
    lvl: number,
    alivePs: { id: number; alive: boolean; tx: number; ty: number; tz: number }[],
    cb: { onHit: Function; onBlow: Function; onFx: Function }
  ): void {
    this.statusLabel = `SKY CRANE TNT · WAVE ${lvl}`;
    const interval = Math.max(850, 2400 - lvl * 310);
    if (now - this.lastSpawn > interval && alivePs.length > 0 && now - this.startTime > 3000) {
      this.lastSpawn = now;
      const n = lvl >= 3 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const tg = alivePs[Math.floor(Math.random() * alivePs.length)];
        const tx = Math.max(-13, Math.min(13, tg.tx + (Math.random() - 0.5) * 4));
        const tz = Math.max(-13, Math.min(13, tg.tz + (Math.random() - 0.5) * 4));
        const dur = 1400;
        this.entities.push({ id: this.nextId++, kind: 'target', x: tx, y: 0.08, z: tz, vx: 0, vy: 0, vz: 0, r: 3.4, ang: 0, phase: 0, born: now, dur, tx, ty: 0.08, tz });
        this.entities.push({ id: this.nextId++, kind: 'tnt', x: tx, y: 18, z: tz, vx: 0, vy: -18 / (dur / 1000), vz: 0, r: 0.75, ang: 0, phase: 0, born: now, dur, tx, ty: 0.8, tz });
      }
    }
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (e.kind === 'target') {
        e.phase = Math.min(1, (now - e.born) / e.dur);
        if (now - e.born >= e.dur) this.entities.splice(i, 1);
      } else if (e.kind === 'tnt') {
        e.y = Math.max(0.8, e.y + e.vy * dt);
        e.ang += dt * 3;
        if (now - e.born >= e.dur) {
          cb.onFx('boom', e.tx, 0.8, e.tz);
          for (const q of alivePs) {
            const dx = q.tx - e.tx;
            const dz = q.tz - e.tz;
            const d = Math.hypot(dx, dz);
            if (d < 4.8) {
              const f = 1 - d / 4.8;
              const ang = Math.atan2(dx || 0.1, dz || 0.1);
              cb.onHit(q.id, ang, 28 + 38 * f, 15 + 15 * f);
              cb.onBlow(q.id, Math.sin(ang) * (14 + 16 * f), 8.5, Math.cos(ang) * (14 + 16 * f), 0.4);
            }
          }
          this.entities.splice(i, 1);
        }
      }
    }
  }

  // Client-side sync & smooth rendering
  public syncFromSnapshot(snap: HazardSnapshot | undefined, dt: number, now: number, t: number): void {
    if (!snap) {
      this.clearVisuals();
      return;
    }
    this.level = snap.lvl;
    this.statusLabel = snap.label;
    this.fallenTiles.clear();
    for (const idx of snap.fallenTiles) this.fallenTiles.set(idx, 1);
    this.warnTiles.clear();
    for (const idx of snap.warnTiles) this.warnTiles.set(idx, 1);
    this.applyTileStates(dt, now);

    const seen = new Set<number>();
    for (const [id, kind, x, y, z, ang, r, phase] of snap.items) {
      seen.add(id);
      let item = this.meshPool.get(id);
      if (!item) {
        const mesh = this.createMesh(kind, r);
        mesh.position.set(x, y, z);
        this.visualRoot.add(mesh);
        item = { mesh, kind, tx: x, ty: y, tz: z, tang: ang, tr: r, tphase: phase };
        this.meshPool.set(id, item);
      }
      item.tx = x;
      item.ty = y;
      item.tz = z;
      item.tang = ang;
      item.tr = r;
      item.tphase = phase;
    }

    for (const [id, item] of this.meshPool) {
      if (!seen.has(id)) {
        this.visualRoot.remove(item.mesh);
        this.meshPool.delete(id);
      }
    }

    // Smooth visual update
    const k = Math.min(1, dt * 15);
    for (const [, item] of this.meshPool) {
      const m = item.mesh;
      m.position.x += (item.tx - m.position.x) * k;
      m.position.y += (item.ty - m.position.y) * k;
      m.position.z += (item.tz - m.position.z) * k;

      if (item.kind === 'shark') {
        const sm = m as SharkMesh;
        let df = item.tang - sm.rotation.y;
        df = Math.atan2(Math.sin(df), Math.cos(df));
        sm.rotation.y += df * k;
        sm.tail.rotation.y = Math.sin(t * (item.tphase === 2 ? 26 : 16)) * 0.55;
        sm.jaw.rotation.x = item.tphase === 2 ? 0.1 + Math.abs(Math.sin(t * 14)) * 0.35 : 0.25 + Math.sin(t * 6) * 0.15;
      } else if (item.kind === 'ship') {
        let df = item.tang - m.rotation.y;
        df = Math.atan2(Math.sin(df), Math.cos(df));
        m.rotation.y += df * k;
        m.rotation.z = Math.sin(t * 2 + item.tx) * 0.06;
      } else if (item.kind === 'target') {
        const s = 0.65 + item.tphase * 0.45;
        m.scale.set(s * item.tr, 1, s * item.tr);
        m.rotation.y = t * 2.5;
      } else if (item.kind === 'bolt') {
        const sc = 0.6 + item.tphase * 0.4;
        m.scale.set(sc, 1, sc);
        m.rotation.y = t * 5;
      } else if (item.kind === 'beam') {
        m.rotation.y = item.tang;
      } else if (item.kind === 'roller' || item.kind === 'boulder' || item.kind === 'tnt') {
        m.rotation.x += dt * 5;
        m.rotation.z += dt * 3;
      } else if (item.kind === 'train' || item.kind === 'drone') {
        let df = item.tang - m.rotation.y;
        df = Math.atan2(Math.sin(df), Math.cos(df));
        m.rotation.y += df * k;
      }
    }
  }

  private createMesh(kind: string, r: number): THREE.Object3D {
    if (kind === 'ship') return mkPirateShip();
    if (kind === 'shark') return mkSharkMesh(2.5, true);
    if (kind === 'ball') {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.6, 14, 10),
        new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.3, metalness: 0.7, emissive: '#ef4444', emissiveIntensity: 0.35 })
      );
      m.castShadow = true;
      return m;
    }
    if (kind === 'target' || kind === 'bolt') {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 2),
        new THREE.MeshBasicMaterial({ map: this.warnTex, transparent: true, depthWrite: false, opacity: 0.88 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.05;
      g.add(ring);
      if (kind === 'bolt') {
        const col = new THREE.Mesh(
          new THREE.CylinderGeometry(0.3, 0.9, 14, 12, 1, true),
          new THREE.MeshBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false })
        );
        col.position.y = 7;
        g.add(col);
      }
      return g;
    }
    if (kind === 'beam') {
      const g = new THREE.Group();
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.24, r, 10),
        new THREE.MeshBasicMaterial({ color: '#f43f5e' })
      );
      beam.rotation.x = Math.PI / 2;
      beam.position.z = r / 2;
      g.add(beam);
      const glow = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, r, 10),
        new THREE.MeshBasicMaterial({ color: '#fb7185', transparent: true, opacity: 0.35, depthWrite: false })
      );
      glow.rotation.x = Math.PI / 2;
      glow.position.z = r / 2;
      g.add(glow);
      return g;
    }
    if (kind === 'boulder') {
      const m = new THREE.Mesh(
        new THREE.DodecahedronGeometry(r, 1),
        new THREE.MeshStandardMaterial({ color: '#57534e', roughness: 0.85, emissive: '#ea580c', emissiveIntensity: 0.25 })
      );
      m.castShadow = true;
      m.add(new THREE.Mesh(new THREE.DodecahedronGeometry(r, 1), OLM));
      return m;
    }
    if (kind === 'drone') {
      const g = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.CylinderGeometry(0.95, 1.05, 0.6, 16),
        new THREE.MeshStandardMaterial({ color: '#0ea5e9', roughness: 0.25, metalness: 0.7, emissive: '#0284c7', emissiveIntensity: 0.6 })
      );
      core.castShadow = true;
      g.add(core);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.14, 8, 24), new THREE.MeshBasicMaterial({ color: '#facc15' }));
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      return g;
    }
    if (kind === 'roller') {
      const g = new THREE.Group();
      const cyl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.9, 2.2, 12),
        new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.3, metalness: 0.8 })
      );
      cyl.rotation.z = Math.PI / 2;
      cyl.castShadow = true;
      g.add(cyl);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.6, 5), new THREE.MeshStandardMaterial({ color: '#ef4444', roughness: 0.4 }));
        sp.position.set(0, Math.cos(a) * 1.0, Math.sin(a) * 1.0);
        sp.rotation.x = a;
        g.add(sp);
      }
      return g;
    }
    if (kind === 'train') {
      const g = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 1.1, 3.6),
        new THREE.MeshStandardMaterial({ color: '#f97316', roughness: 0.25, metalness: 0.5, emissive: '#ea580c', emissiveIntensity: 0.35 })
      );
      body.castShadow = true;
      g.add(body);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 1.4), new THREE.MeshStandardMaterial({ color: '#38bdf8', roughness: 0.1, metalness: 0.2 }));
      cab.position.set(0, 0.7, 0.4);
      g.add(cab);
      return g;
    }
    if (kind === 'crusher') {
      const g = new THREE.Group();
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(1.3, 16, 12),
        new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.25, metalness: 0.85 })
      );
      ball.castShadow = true;
      g.add(ball);
      const band = new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.12, 8, 24), new THREE.MeshBasicMaterial({ color: '#facc15' }));
      g.add(band);
      return g;
    }
    // tnt barrel
    const g = new THREE.Group();
    const bar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.65, 0.65, 1.4, 14),
      new THREE.MeshStandardMaterial({ color: '#dc2626', roughness: 0.4, emissive: '#991b1b', emissiveIntensity: 0.4 })
    );
    bar.castShadow = true;
    g.add(bar);
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.67, 0.67, 0.35, 14), new THREE.MeshBasicMaterial({ color: '#fde047' }));
    g.add(stripe);
    return g;
  }

  public playLocalFx(k: string, x: number, y: number, z: number): void {
    if (k === 'cannon') sound.cannonBoom();
    else if (k === 'splash') sound.splash();
    else if (k === 'laser') sound.laserZap();
    else if (k === 'smash') sound.rumbleImpact();
  }
}
