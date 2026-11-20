import * as THREE from 'three';
import { CrateObj, SceneKey, SolidBox } from './types';
import { mkSharkMesh, SharkMesh, OLM } from './models';
import { solidAtPoint, stepBody } from './physics';
import { sound } from './audio';

export const SHC = 0.65;
export const SHV = 22;
export const SH_R = 0.8;
export const SH_H = 1.1;
export const HOLE_R = 24;

export interface SharkProj {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  sup: SolidBox | null;
  own: number;
  born: number;
  st: number; // 0=flying, 1=crawling/hunting, 2=diving off map, 3=bitten victim & dragging off!
  bc: number;
  lc: number;
  bites: number;
  tt: number;
  wend: number;
  tg: number;
  victimId?: number;
  ww?: number;
  wx?: number;
  wz?: number;
  sk?: number;
}

export interface BombObj {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  sup: SolidBox | null;
  own: number;
  born: number;
  fuse: number;
}

export interface BananaObj {
  id: number;
  x: number;
  y: number;
  z: number;
  own: number;
  born: number;
}

export interface HoleObj {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  own: number;
  born: number;
  st: number; // 0=flying, 1=charging, 2=pulling
  t1: number;
  t2: number;
  end: number;
  pt: number;
  dt: number;
  pr: number;
}

export interface HookLink {
  tid: number;
  oid: number;
  end: number;
  first: boolean;
}

interface HoleMesh extends THREE.Group {
  core: THREE.Mesh;
  ring: THREE.Mesh;
  ring2: THREE.Mesh;
  aura: THREE.Mesh;
  sw: THREE.Mesh[];
  tx: number;
  ty: number;
  tz: number;
  st: number;
  pr: number;
}

interface BombMesh extends THREE.Mesh {
  tx: number;
  ty: number;
  tz: number;
  vx: number;
  vy: number;
  vz: number;
  f: number;
}

interface ParticleMesh extends THREE.Mesh {
  v: THREE.Vector3;
  l: number;
}

interface FxRing {
  m: THREE.Mesh;
  age: number;
  fx: number;
  fz: number;
}

interface RopeFx {
  a: number;
  b: number;
  x?: number;
  y?: number;
  z?: number;
  end: number;
  m: THREE.Mesh;
}

const UPV = new THREE.Vector3(0, 1, 0);
const BG = new THREE.BoxGeometry(0.14, 0.14, 0.14);

export class WeaponSystem {
  public proj: SharkProj[] = [];
  public bombs: BombObj[] = [];
  public bananas: BananaObj[] = [];
  public holes: HoleObj[] = [];
  public hooks: HookLink[] = [];

  private projId = 1;
  private bombId = 1;

  private scene: THREE.Scene;
  private projM = new Map<number, SharkMesh>();
  private bombM = new Map<number, BombMesh>();
  private bananaM = new Map<number, THREE.Mesh>();
  private holeM = new Map<number, HoleMesh>();
  private fxs: FxRing[] = [];
  private parts: ParticleMesh[] = [];
  private hookFx: RopeFx[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public clearAll(): void {
    this.proj.length = 0;
    this.bombs.length = 0;
    this.bananas.length = 0;
    this.holes.length = 0;
    this.hooks.length = 0;
    this.syncProj([]);
    this.syncBombs([]);
    this.syncBananas([]);
    this.syncHoles([]);
    for (const r of this.hookFx) this.scene.remove(r.m);
    this.hookFx.length = 0;
    for (const f of this.fxs) this.scene.remove(f.m);
    this.fxs.length = 0;
    for (const p of this.parts) this.scene.remove(p);
    this.parts.length = 0;
  }

  public clearRound(): void {
    this.proj.length = 0;
    this.bombs.length = 0;
    this.bananas.length = 0;
    this.holes.length = 0;
    this.hooks.length = 0;
  }

  public burst(x: number, y: number, z: number): void {
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(
        BG,
        new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(Math.random(), 1, 0.6) })
      ) as unknown as ParticleMesh;
      m.position.set(x, y + 1.5, z);
      m.v = new THREE.Vector3((Math.random() - 0.5) * 9, Math.random() * 7, (Math.random() - 0.5) * 9);
      m.l = 0.7;
      this.scene.add(m);
      this.parts.push(m);
    }
  }

  public iceBit(x: number, y: number, z: number, sp: number): void {
    const m = new THREE.Mesh(
      BG,
      new THREE.MeshBasicMaterial({ color: Math.random() < 0.5 ? '#e8fbff' : '#8fe8ff' })
    ) as unknown as ParticleMesh;
    m.position.set(x, y, z);
    m.v = new THREE.Vector3((Math.random() - 0.5) * sp, Math.random() * sp * 0.7, (Math.random() - 0.5) * sp);
    m.l = 0.7;
    this.scene.add(m);
    this.parts.push(m);
  }

  public addVortexFx(x: number, y: number, z: number, ry: number): void {
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.09, 6, 28),
        new THREE.MeshBasicMaterial({ color: '#c8f6ff', transparent: true, opacity: 0.75, depthWrite: false })
      );
      m.rotation.y = ry;
      m.position.set(x + Math.sin(ry) * (1 + i * 0.9), y, z + Math.cos(ry) * (1 + i * 0.9));
      this.scene.add(m);
      this.fxs.push({ m, age: -i * 0.08, fx: Math.sin(ry), fz: Math.cos(ry) });
    }
  }

  public addRingBoom(x: number, y: number, z: number, color = '#ffb03c'): void {
    const sp = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.72, depthWrite: false })
    );
    sp.position.set(x, y, z);
    this.scene.add(sp);
    this.fxs.push({ m: sp, age: 0, fx: 0, fz: 0 });
  }

  public addIceSpray(x: number, y: number, z: number, dx: number, dy: number, dz: number): void {
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(
        BG,
        new THREE.MeshBasicMaterial({ color: Math.random() < 0.5 ? '#e8fbff' : '#8fe8ff' })
      ) as unknown as ParticleMesh;
      b.position.set(x, y, z);
      const sp = 11 + Math.random() * 6;
      b.v = new THREE.Vector3(
        dx * sp + (Math.random() - 0.5) * 3.5,
        dy * sp + (Math.random() - 0.5) * 3.5 + 2,
        dz * sp + (Math.random() - 0.5) * 3.5
      );
      b.l = 0.6;
      this.scene.add(b);
      this.parts.push(b);
    }
  }

  public addHookRope(a: number, b: number, ms: number, x?: number, y?: number, z?: number): void {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), new THREE.MeshBasicMaterial({ color: '#e8d9a8' }));
    this.scene.add(m);
    this.hookFx.push({ a, b, x, y, z, end: performance.now() / 1000 + ms / 1000, m });
  }

  public addSplashParticles(x: number, y: number, z: number): void {
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(
        BG,
        new THREE.MeshBasicMaterial({ color: Math.random() < 0.5 ? '#e0f2fe' : '#38bdf8' })
      ) as unknown as ParticleMesh;
      m.position.set(x, Math.max(-0.5, y), z);
      m.v = new THREE.Vector3((Math.random() - 0.5) * 8, 5 + Math.random() * 6, (Math.random() - 0.5) * 8);
      m.l = 0.65;
      this.scene.add(m);
      this.parts.push(m);
    }
  }

  public spawnShark(x: number, y: number, z: number, vx: number, vy: number, vz: number, own: number, now: number): void {
    if (this.proj.length >= 10) return;
    this.proj.push({
      id: this.projId++,
      x,
      y,
      z,
      vx,
      vy,
      vz,
      sup: null,
      own,
      born: now,
      st: 0,
      bc: 0,
      lc: 0,
      bites: 0,
      tt: 0,
      wend: 0,
      tg: 0,
    });
  }

  public spawnBomb(x: number, y: number, z: number, vx: number, vy: number, vz: number, own: number, now: number): void {
    if (this.bombs.length >= 8) return;
    this.bombs.push({ id: this.bombId++, x, y, z, vx, vy, vz, sup: null, own, born: now, fuse: 1900 });
  }

  public spawnBanana(x: number, y: number, z: number, own: number, now: number): void {
    if (this.bananas.length >= 10) return;
    this.bananas.push({ id: this.bombId++, x, y, z, own, born: now });
  }

  public spawnOrParkHole(
    own: number,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    now: number,
    onPark: (h: HoleObj) => void
  ): boolean {
    const mine = this.holes.find((h) => h.own === own && h.st === 0);
    if (mine) {
      this.stopHole(mine, now, onPark);
      return true;
    }
    if (this.holes.length < 6) {
      this.holes.push({ id: this.bombId++, x, y, z, vx, vy, vz, own, born: now, st: 0, t1: 0, t2: 0, end: 0, pt: 0, dt: 0, pr: 0 });
    }
    return false;
  }

  private stopHole(h: HoleObj, now: number, onPark: (h: HoleObj) => void): void {
    h.st = 1;
    h.vx = h.vy = h.vz = 0;
    h.t1 = now;
    h.t2 = now + 3000;
    h.end = now + 8000;
    onPark(h);
  }

  // Simulate launched sharks — sharks actually bite victims in their jaws and drag them off the edge!
  public simProj(
    dt: number,
    now: number,
    _phase: SceneKey,
    solids: SolidBox[],
    crates: CrateObj[],
    players: { id: number; alive: boolean; ko: number; team: number; tx: number; ty: number; tz: number; heldBy: number }[],
    mode: string,
    ownerTeam: (id: number) => number,
    cb: {
      onHit: (playerId: number, own: number, ang: number, dmg: number, kb: number) => void;
      onSharkBite: (playerId: number, sharkKey: number, x: number, y: number, z: number, ang: number) => void;
      onSharkDrop: (playerId: number, vx: number, vy: number, vz: number) => void;
      onFx: (kind: string, x: number, y: number, z: number) => void;
    }
  ): void {
    for (let i = this.proj.length - 1; i >= 0; i--) {
      const s = this.proj[i];
      let dead = s.y < -25 || now - s.born > 22000;

      if (s.st === 0) {
        stepBody(s, dt, SH_R, SH_H, solids, null, 4);
        if (s.sup) {
          s.st = 1;
          s.wend = now + 6500;
          s.vx *= 0.25;
          s.vz *= 0.25;
          s.vy = 0;
          cb.onFx('chomp', s.x, s.y, s.z);
        } else {
          // Direct mid-air chomp! Latch onto victim briefly and toss back
          for (const q of players) {
            if (!q.alive || q.heldBy || (q.id === s.own && now - s.born < 500)) continue;
            if (Math.hypot(q.tx - s.x, q.tz - s.z) < 1.15 && Math.abs(q.ty + 1.2 - (s.y + SHC)) < 1.55) {
              s.victimId = q.id;
              s.st = 3;
              s.wend = now + 1150;
              const ang = Math.atan2(s.vx || Math.sin(0), s.vz || Math.cos(0));
              s.vx = Math.sin(ang) * 8.5;
              s.vz = Math.cos(ang) * 8.5;
              s.vy = 2;
              s.sup = null;
              cb.onHit(q.id, s.own, ang, 22, 6);
              cb.onFx('chomp', s.x, s.y + SHC, s.z);
              break;
            }
          }
          if (s.st === 0 && Math.hypot(s.vx, s.vz) > 8) {
            for (const c of crates) {
              if (!c.held && Math.abs(c.x - s.x) < 1.5 && Math.abs(c.z - s.z) < 1.5 && s.y + SH_H > c.y && s.y < c.y + 1.2) {
                c.vx += s.vx * 0.4;
                c.vz += s.vz * 0.4;
                c.vy = 2.5;
                c.sup = null;
              }
            }
          }
        }
      } else if (s.st === 1) {
        if (now > s.wend || s.bites >= 5) {
          let ox = s.x;
          let oz = s.z;
          let ol = Math.hypot(ox, oz);
          if (ol < 2) {
            const a = Math.random() * 6.28;
            ox = Math.cos(a);
            oz = Math.sin(a);
            ol = 1;
          }
          s.st = 2;
          s.vx = (ox / ol) * 9;
          s.vz = (oz / ol) * 9;
          s.vy = 11;
          s.sup = null;
          cb.onFx('boing', s.x, s.y, s.z);
        } else {
          s.tt -= dt;
          if (s.tt <= 0) {
            s.tt = 0.25;
            s.tg = 0;
            let bd = 24;
            for (const q of players) {
              if (!q.alive || q.heldBy || q.id === s.own || (mode === 'team' && q.team === ownerTeam(s.own))) continue;
              const d = Math.hypot(q.tx - s.x, q.tz - s.z);
              if (d < bd && Math.abs(q.ty - s.y) < 4) {
                bd = d;
                s.tg = q.id;
              }
            }
          }
          const tg = s.tg ? players.find((p) => p.id === s.tg) : undefined;
          let dx = 0;
          let dz = 0;
          let spd = 0;
          if (tg && tg.alive && !tg.heldBy) {
            const ex = tg.tx - s.x;
            const ez = tg.tz - s.z;
            const d = Math.hypot(ex, ez) || 0.01;
            dx = ex / d;
            dz = ez / d;
            spd = 4.8;
            if (d < 1.2 && now > s.bc && Math.abs(tg.ty - s.y) < 1.55) {
              // BITE & SHORT DRAG! Clamp victim briefly and release
              s.victimId = tg.id;
              s.st = 3;
              s.wend = now + 1150;
              let ox = s.x;
              let oz = s.z;
              let ol = Math.hypot(ox, oz);
              if (ol < 1.5) {
                ox = dx;
                oz = dz;
                ol = 1;
              }
              s.vx = (ox / ol) * 8.5;
              s.vz = (oz / ol) * 8.5;
              s.vy = 2;
              s.sup = null;
              cb.onHit(tg.id, s.own, Math.atan2(ex, ez), 20, 5);
              cb.onFx('chomp', tg.tx, tg.ty + 1, tg.tz);
            } else if (d > 2.2 && d < 5.0 && now > s.lc && s.sup) {
              s.lc = now + 1500;
              s.vy = 6.5;
              s.vx = dx * 9;
              s.vz = dz * 9;
              s.sup = null;
            }
          } else {
            s.ww = (s.ww || 0) - dt;
            if (s.ww <= 0) {
              s.ww = 1 + Math.random() * 1.5;
              const a = Math.random() * 6.28;
              s.wx = Math.cos(a);
              s.wz = Math.sin(a);
            }
            dx = s.wx || 0;
            dz = s.wz || 0;
            spd = 2.8;
          }
          if (s.st === 1) {
            if (s.sup) {
              const k = Math.min(1, dt * 8);
              s.vx += (dx * spd - s.vx) * k;
              s.vz += (dz * spd - s.vz) * k;
              if (spd > 0 && Math.hypot(s.vx, s.vz) < spd * 0.3) {
                s.sk = (s.sk || 0) + dt;
                if (s.sk > 0.35) {
                  s.sk = 0;
                  s.vy = 9;
                  s.sup = null;
                }
              } else {
                s.sk = 0;
              }
            }
            stepBody(s, dt, SH_R, SH_H, solids, null);
          }
        }
      } else if (s.st === 3) {
        // Carrying victim briefly without clipping through walls
        const vic = players.find((p) => p.id === s.victimId);
        if (!vic || !vic.alive) {
          s.st = 2;
          s.victimId = undefined;
          continue;
        }
        const distFromCenter = Math.hypot(s.x, s.z);
        if (distFromCenter > 15.5) {
          s.x += s.vx * dt;
          s.z += s.vz * dt;
          s.vy -= 14 * dt;
          s.y += s.vy * dt;
        } else {
          const prevX = s.x;
          const prevZ = s.z;
          stepBody(s, dt, SH_R, SH_H, solids, null, 20);
          if (Math.hypot(s.x - prevX, s.z - prevZ) < Math.hypot(s.vx, s.vz) * dt * 0.35 && s.sup) {
            s.vy = 9.0;
            s.sup = null;
          }
        }
        const ang = Math.atan2(s.vx, s.vz);
        const jx = s.x + Math.sin(ang) * 1.3;
        const jz = s.z + Math.cos(ang) * 1.3;
        cb.onSharkBite(vic.id, 10000 + s.id, jx, s.y + 0.1, jz, ang);

        if (s.y < -3.0 || now > s.wend) {
          cb.onSharkDrop(vic.id, s.vx * 0.5, 1.0, s.vz * 0.5);
          s.victimId = undefined;
          s.st = 2;
        }
      } else {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.z += s.vz * dt;
        s.vy -= 22 * dt;
      }

      if (dead) {
        if (s.victimId) {
          cb.onSharkDrop(s.victimId, s.vx * 0.5, 0, s.vz * 0.5);
        }
        this.proj.splice(i, 1);
      }
    }
  }

  public simHoles(
    dt: number,
    now: number,
    solids: SolidBox[],
    crates: CrateObj[],
    players: { id: number; alive: boolean; heldBy: number; tx: number; ty: number; tz: number }[],
    cb: {
      onHoleParked: (own: number) => void;
      onResetCrate: (c: CrateObj) => void;
      onBlow: (id: number, vx: number, vy: number, vz: number, st: number, owner: number) => void;
      onPull: (id: number, vx: number, vy: number, vz: number) => void;
      onFx: (kind: string, x: number, y: number, z: number) => void;
    }
  ): void {
    const R = HOLE_R;
    for (let i = this.holes.length - 1; i >= 0; i--) {
      const h = this.holes[i];
      if (h.st === 0) {
        if (h.y < -22) {
          cb.onHoleParked(h.own);
          this.holes.splice(i, 1);
          continue;
        }
        const nx = h.x + h.vx * dt;
        const ny = h.y + h.vy * dt;
        const nz = h.z + h.vz * dt;
        if (solidAtPoint(solids, nx, ny, nz) || now - h.born > 3500) {
          this.stopHole(h, now, (hh) => {
            cb.onFx('pick', hh.x, hh.y, hh.z);
            cb.onHoleParked(hh.own);
          });
        } else {
          h.x = nx;
          h.y = ny;
          h.z = nz;
        }
        h.pr = 0;
        continue;
      }
      if (h.st === 1) {
        h.pr = Math.min(1, (now - h.t1) / 3000);
        if (now >= h.t2) {
          h.st = 2;
          cb.onFx('hstart', h.x, h.y, h.z);
        }
        continue;
      }
      h.pr = Math.max(0, 1 - (now - h.t2) / 5000);
      if (now >= h.end) {
        cb.onFx('hcol', h.x, h.y, h.z);
        for (const q of players) {
          if (!q.alive) continue;
          const dx = q.tx - h.x;
          const dz = q.tz - h.z;
          const dy = q.ty + 1 - h.y;
          const d = Math.hypot(dx, dy, dz);
          if (d > R) continue;
          const f = 1 - d / R;
          const a = Math.atan2(dx, dz);
          cb.onBlow(q.id, Math.sin(a) * (24 + 46 * f), 10 + 8 * f, Math.cos(a) * (24 + 46 * f), 0.5, h.own);
        }
        for (const c of crates) {
          if (c.held) continue;
          const dx = c.x - h.x;
          const dz = c.z - h.z;
          const d = Math.hypot(dx, dz, c.y - h.y);
          if (d > R || d < 0.01) continue;
          const f = 1 - d / R;
          c.vx += (dx / d) * (30 + 40 * f);
          c.vz += (dz / d) * (30 + 40 * f);
          c.vy = Math.max(c.vy, 8);
          c.sup = null;
        }
        this.holes.splice(i, 1);
        continue;
      }

      const sendP = now >= h.pt;
      if (sendP) h.pt = now + 60;
      for (const q of players) {
        if (!q.alive || q.heldBy) continue;
        const dx = h.x - q.tx;
        const dy = h.y - (q.ty + 1);
        const dz = h.z - q.tz;
        const d = Math.hypot(dx, dy, dz);
        if (d > R || d < 0.01) continue;
        const f = 1 - d / R;
        if (sendP) {
          const hz = Math.hypot(dx, dz) || 1;
          const sp = d > 5 ? Math.max(6, Math.min(16 + 44 * f, d * 9)) : Math.max(2.5, d * 2.2);
          cb.onPull(q.id, (dx / hz) * sp, dy > 0.5 ? Math.min(16, dy * 4) : -99, (dz / hz) * sp);
        }
      }
      for (const c of crates) {
        if (c.held) continue;
        const dx = h.x - c.x;
        const dy = h.y - (c.y + 0.6);
        const dz = h.z - c.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > R || d < 0.01) continue;
        if (d < 2.5) {
          cb.onResetCrate(c);
          continue;
        }
        const f = 1 - d / R;
        c.vx += (dx / d) * 340 * f * dt;
        c.vz += (dz / d) * 340 * f * dt;
        if (dy > 0.5) {
          c.vy += Math.min(30, dy * 12) * f * dt;
          c.sup = null;
        }
      }
      for (const b of this.bombs) {
        const dx = h.x - b.x;
        const dy = h.y - b.y;
        const dz = h.z - b.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > R || d < 0.01) continue;
        const f = 1 - d / R;
        b.vx += (dx / d) * 400 * f * dt;
        b.vz += (dz / d) * 400 * f * dt;
        b.vy += (dy / d) * 200 * f * dt;
      }
      for (let j = this.bananas.length - 1; j >= 0; j--) {
        if (Math.hypot(this.bananas[j].x - h.x, this.bananas[j].z - h.z) < 4 && Math.abs(this.bananas[j].y - h.y) < 4) {
          this.bananas.splice(j, 1);
        }
      }
    }
  }

  public simBombsAndBananas(
    dt: number,
    now: number,
    solids: SolidBox[],
    crates: CrateObj[],
    players: { id: number; alive: boolean; ko: number; heldBy: number; tx: number; ty: number; tz: number; mvx: number; mvz: number }[],
    cb: {
      onBoom: (b: BombObj) => void;
      onSlip: (qId: number, own: number, vx: number, vz: number, x: number, y: number, z: number) => void;
    }
  ): void {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      stepBody(b, dt, 0.35, 0.6, solids, null);
      if (b.sup) {
        const f = Math.exp(-dt * 3);
        b.vx *= f;
        b.vz *= f;
      }
      let go = now - b.born > b.fuse || b.y < -22;
      if (!go && now - b.born > 250) {
        for (const q of players) {
          if (q.alive && q.id !== b.own && Math.hypot(q.tx - b.x, q.tz - b.z) < 1 && Math.abs(q.ty + 1 - (b.y + 0.3)) < 1.4) {
            go = true;
            break;
          }
        }
      }
      if (go) {
        if (b.y > -22) cb.onBoom(b);
        this.bombs.splice(i, 1);
      }
    }

    for (let i = this.bananas.length - 1; i >= 0; i--) {
      const b = this.bananas[i];
      let gone = now - b.born > 30000;
      if (!gone) {
        for (const q of players) {
          if (!q.alive || q.ko > now || q.heldBy || (q.id === b.own && now - b.born < 1200)) continue;
          if (Math.hypot(q.tx - b.x, q.tz - b.z) < 0.95 && Math.abs(q.ty - b.y) < 1) {
            const sp = Math.hypot(q.mvx || 0, q.mvz || 0);
            let ux: number;
            let uz: number;
            if (sp > 1) {
              ux = q.mvx / sp;
              uz = q.mvz / sp;
            } else {
              const a = Math.random() * 6.28;
              ux = Math.cos(a);
              uz = Math.sin(a);
            }
            cb.onSlip(q.id, b.own, ux * 14, uz * 14, b.x, b.y, b.z);
            gone = true;
            break;
          }
        }
      }
      if (gone) this.bananas.splice(i, 1);
    }
    void crates;
  }

  public syncProj(list: [number, number, number, number, number, number, number, number][]): void {
    const seen = new Set<number>();
    for (const [id, x, y, z, vx, vy, vz, st] of list) {
      seen.add(id);
      let m = this.projM.get(id);
      if (!m) {
        m = mkSharkMesh(2.1, false);
        m.position.set(x, y, z);
        this.scene.add(m);
        this.projM.set(id, m);
      }
      m.tx = x;
      m.ty = y;
      m.tz = z;
      m.vx = vx;
      m.vy = vy;
      m.vz = vz;
      m.st = st;
    }
    for (const [id, m] of this.projM) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.projM.delete(id);
      }
    }
  }

  public syncBombs(list: [number, number, number, number, number, number, number, number][]): void {
    const seen = new Set<number>();
    for (const [id, x, y, z, vx, vy, vz, f] of list) {
      seen.add(id);
      let m = this.bombM.get(id);
      if (!m) {
        const g = new THREE.Mesh(
          new THREE.SphereGeometry(0.42, 14, 10),
          new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.3, metalness: 0.5 })
        ) as unknown as BombMesh;
        g.castShadow = true;
        g.add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), OLM));
        const sp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), new THREE.MeshBasicMaterial({ color: '#fb923c' }));
        sp.position.y = 0.5;
        g.add(sp);
        g.position.set(x, y, z);
        this.scene.add(g);
        m = g;
        this.bombM.set(id, m);
      }
      m.tx = x;
      m.ty = y;
      m.tz = z;
      m.vx = vx;
      m.vy = vy;
      m.vz = vz;
      m.f = f;
    }
    for (const [id, m] of this.bombM) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.bombM.delete(id);
      }
    }
  }

  public syncBananas(list: [number, number, number, number][]): void {
    const seen = new Set<number>();
    for (const [id, x, y, z] of list) {
      seen.add(id);
      if (!this.bananaM.has(id)) {
        const m = new THREE.Mesh(
          new THREE.TorusGeometry(0.35, 0.11, 8, 14, Math.PI * 1.1),
          new THREE.MeshStandardMaterial({ color: '#facc15', roughness: 0.45 })
        );
        m.rotation.x = -Math.PI / 2;
        m.castShadow = true;
        m.position.set(x, y + 0.2, z);
        this.scene.add(m);
        this.bananaM.set(id, m);
      }
    }
    for (const [id, m] of this.bananaM) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.bananaM.delete(id);
      }
    }
  }

  public syncHoles(list: [number, number, number, number, number, number][]): void {
    const seen = new Set<number>();
    for (const [id, x, y, z, st, pr] of list) {
      seen.add(id);
      let m = this.holeM.get(id);
      if (!m) {
        const g = new THREE.Group() as HoleMesh;
        const B = (c: string, o: number) =>
          new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false });
        g.core = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: '#000000' }));
        g.add(g.core);
        g.ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.13, 8, 36), B('#b46bff', 0.9));
        g.ring.rotation.x = Math.PI / 2.5;
        g.add(g.ring);
        g.ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.06, 8, 36), B('#6b8bff', 0.7));
        g.ring2.rotation.x = Math.PI / 2.2;
        g.add(g.ring2);
        g.aura = new THREE.Mesh(
          new THREE.SphereGeometry(1, 16, 12),
          new THREE.MeshBasicMaterial({ color: '#4a1a8a', transparent: true, opacity: 0.2, depthWrite: false, side: THREE.BackSide })
        );
        g.add(g.aura);
        g.sw = [0, 1, 2].map(() => {
          const r = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 6, 40), B('#c9a0ff', 0.5));
          r.rotation.x = Math.PI / 2;
          this.scene.add(r);
          return r;
        });
        g.position.set(x, y, z);
        this.scene.add(g);
        m = g;
        this.holeM.set(id, m);
      }
      m.tx = x;
      m.ty = y;
      m.tz = z;
      m.st = st;
      m.pr = pr;
    }
    for (const [id, m] of this.holeM) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        m.sw.forEach((r) => this.scene.remove(r));
        this.holeM.delete(id);
      }
    }
  }

  public tickVisuals(
    dt: number,
    t: number,
    getPlayerPos: (id: number) => THREE.Vector3 | null
  ): void {
    // Particles
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const m = this.parts[i];
      m.v.y -= 15 * dt;
      m.position.addScaledVector(m.v, dt);
      m.l -= dt;
      m.scale.setScalar(Math.max(0.01, m.l / 0.7));
      if (m.l <= 0) {
        this.scene.remove(m);
        this.parts.splice(i, 1);
      }
    }

    // Ring / Explosion FX
    for (let i = this.fxs.length - 1; i >= 0; i--) {
      const f = this.fxs[i];
      f.age += dt;
      if (f.age < 0) continue;
      const s = 0.5 + f.age * 8;
      f.m.scale.set(s, s, s);
      f.m.position.x += f.fx * 16 * dt;
      f.m.position.z += f.fz * 16 * dt;
      const mat = f.m.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, 0.75 * (1 - f.age / 0.6));
      if (f.age > 0.6) {
        this.scene.remove(f.m);
        this.fxs.splice(i, 1);
      }
    }

    // Projectile sharks
    for (const [, m] of this.projM) {
      m.tx += m.vx * dt;
      m.ty += m.vy * dt;
      m.tz += m.vz * dt;
      if (m.st !== 3) m.vy -= (m.st ? 25 : 4) * dt;
      const k = Math.min(1, dt * 15);
      m.position.x += (m.tx - m.position.x) * k;
      m.position.y += (m.ty - m.position.y) * k;
      m.position.z += (m.tz - m.position.z) * k;
      const hs = Math.hypot(m.vx, m.vz);
      if (hs > 0.6) m.rotation.y = Math.atan2(m.vx, m.vz);
      m.rotation.x = m.st === 1 || m.st === 3 ? 0 : -Math.atan2(m.vy, Math.max(hs, 0.5)) * 0.9;
      m.rotation.z = m.st === 1 || m.st === 3 ? Math.sin(t * 16) * 0.22 : 0;
      m.tail.rotation.y = Math.sin(t * (m.st >= 1 ? 30 : 22)) * 0.55;
      m.jaw.rotation.x = m.st === 3 ? 0.12 + Math.abs(Math.sin(t * 16)) * 0.35 : 0.25 + Math.sin(t * 8) * 0.15;
    }

    // Bombs
    for (const [, m] of this.bombM) {
      m.tx += m.vx * dt;
      m.tz += m.vz * dt;
      if (m.vy) {
        m.ty += m.vy * dt;
        m.vy -= (m.vy < 0 ? 15 : 25) * dt;
      }
      const k = Math.min(1, dt * 15);
      m.position.x += (m.tx - m.position.x) * k;
      m.position.y += (m.ty - m.position.y) * k;
      m.position.z += (m.tz - m.position.z) * k;
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.color.set(m.f < 0.45 && Math.sin(t * (8 + (1 - m.f) * 40)) > 0 ? '#ef4444' : '#1e293b');
      m.scale.setScalar(1 + (1 - m.f) * 0.15);
    }

    // Black holes
    for (const [, m] of this.holeM) {
      const k = Math.min(1, dt * 18);
      m.position.x += (m.tx - m.position.x) * k;
      m.position.y += (m.ty - m.position.y) * k;
      m.position.z += (m.tz - m.position.z) * k;
      const st = m.st;
      const pr = m.pr || 0;
      let cs = 0.45;
      let rs = 0;
      let as = 0;
      if (st === 1) {
        cs = 0.5 + pr * 0.35 + Math.sin(t * (6 + pr * 24)) * 0.05 * pr;
        rs = 0.5 + pr * 0.4;
      } else if (st === 2) {
        cs = 1.9 + Math.sin(t * 14) * 0.12;
        rs = 1.9;
        as = 6 + Math.sin(t * 5) * 0.5;
      }
      m.core.scale.setScalar(cs);
      m.ring.scale.setScalar(Math.max(0.01, rs));
      m.ring2.scale.setScalar(Math.max(0.01, rs));
      m.ring.rotation.z += dt * (st === 2 ? 6 : 2);
      m.ring2.rotation.z -= dt * (st === 2 ? 4 : 1.5);
      m.ring.visible = m.ring2.visible = st >= 1;
      m.aura.scale.setScalar(Math.max(0.01, as * 1.4));
      m.aura.visible = st === 2;
      (m.ring.material as THREE.MeshBasicMaterial).color.set(st === 1 ? '#7a4aff' : '#c06bff');
      for (let i = 0; i < 3; i++) {
        const r = m.sw[i];
        r.visible = st === 2;
        if (st !== 2) continue;
        const f = (t * 1.1 + i / 3) % 1;
        const s = HOLE_R - f * (HOLE_R - 1.5);
        r.position.copy(m.position);
        r.scale.setScalar(s);
        (r.material as THREE.MeshBasicMaterial).opacity = 0.15 + f * 0.55;
      }
    }

    // Ropes
    const nowS = performance.now() / 1000;
    for (let i = this.hookFx.length - 1; i >= 0; i--) {
      const f = this.hookFx[i];
      const A = getPlayerPos(f.a);
      const B = f.b ? getPlayerPos(f.b) : null;
      if (!A || nowS > f.end || (f.b && !B)) {
        this.scene.remove(f.m);
        this.hookFx.splice(i, 1);
        continue;
      }
      const ax = A.x;
      const ay = A.y + 1.4;
      const az = A.z;
      const bx = B ? B.x : (f.x || 0);
      const by = B ? B.y + 1.2 : (f.y || 0);
      const bz = B ? B.z : (f.z || 0);
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      const L = Math.hypot(dx, dy, dz) || 0.01;
      f.m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
      f.m.scale.set(1, L, 1);
      f.m.quaternion.setFromUnitVectors(UPV, new THREE.Vector3(dx / L, dy / L, dz / L));
    }
  }

  public handleFxEvent(m: Record<string, unknown>, getPlayerPos: (id: number) => THREE.Vector3 | null): void {
    const k = m.k as string;
    const x = (m.x as number) || 0;
    const y = (m.y as number) || 0;
    const z = (m.z as number) || 0;

    if (k === 'shot') {
      sound.weaponShot();
    } else if (k === 'chomp') {
      this.burst(x, y - 1.5, z);
      sound.sharkBite();
    } else if (k === 'splash') {
      this.addSplashParticles(x, y, z);
      sound.splash();
    } else if (k === 'cannon') {
      this.addRingBoom(x, y, z, '#f97316');
      sound.cannonBoom();
    } else if (k === 'laser') {
      this.burst(x, y, z);
      sound.laserZap();
    } else if (k === 'pick') {
      sound.pickupSfx();
    } else if (k === 'boing') {
      sound.boing();
    } else if (k === 'hook') {
      this.addHookRope(m.a as number, m.b as number, m.ms as number, x, y, z);
      sound.hookZip();
    } else if (k === 'smash') {
      this.burst(x, y, z);
      sound.rumbleImpact();
    } else if (k === 'slip') {
      this.burst(x, y - 1, z);
      sound.bananaSlip();
    } else if (k === 'boom') {
      for (let i = 0; i < 3; i++) this.burst(x, y - 1.5 + i * 0.4, z);
      sound.cannonBoom();
      this.addRingBoom(x, y, z, '#ffb03c');
    } else if (k === 'ice') {
      this.addIceSpray(x, y, z, (m.dx as number) || 0, (m.dy as number) || 0, (m.dz as number) || 0);
      if (Math.random() < 0.25) sound.iceSpray();
    } else if (k === 'freeze') {
      for (let i = 0; i < 10; i++) this.iceBit(x, y + 1 + Math.random() * 1.4, z, 6);
      sound.iceFreeze();
    } else if (k === 'thaw') {
      for (let i = 0; i < 18; i++) this.iceBit(x, y + 1 + Math.random() * 1.4, z, 9);
      sound.iceBreak();
    } else if (k === 'hstart') {
      sound.blackHoleStart();
    } else if (k === 'hcol') {
      for (let i = 0; i < 3; i++) this.burst(x, y - 1.5 + i * 0.5, z);
      sound.blackHoleCollapse();
      this.addRingBoom(x, y, z, '#b46bff');
    } else if (k === 'vortex') {
      this.addVortexFx(x, y, z, (m.ry as number) || 0);
      sound.vortexBlast();
    }
    void getPlayerPos;
  }
}
