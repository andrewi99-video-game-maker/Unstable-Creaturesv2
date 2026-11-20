import { SolidBox, SceneKey, CrateObj } from './types';

export const STEP_HEIGHT = 0.18;

export interface PhysBody {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  sup: SolidBox | null;
}

export function pushBody(
  o: PhysBody,
  r: number,
  hh: number,
  solids: SolidBox[],
  self: SolidBox | null
): void {
  for (const s of solids) {
    if (s === self || s.held) continue;
    if (o.y + hh <= s.bottom + 0.02 || o.y >= s.top - STEP_HEIGHT) continue;
    const ax = s.hw + r - Math.abs(o.x - s.x);
    const az = s.hd + r - Math.abs(o.z - s.z);
    if (ax <= 0 || az <= 0) continue;
    if (ax < az) {
      o.x += o.x < s.x ? -ax : ax;
      o.vx *= 0.2;
    } else {
      o.z += o.z < s.z ? -az : az;
      o.vz *= 0.2;
    }
  }
}

export function stepBody(
  o: PhysBody,
  dt: number,
  r: number,
  hh: number,
  solids: SolidBox[],
  self: SolidBox | null,
  g = 25
): boolean {
  const s0 = o.sup;
  if (s0 && s0 !== self && !s0.held) {
    o.x += s0.dx;
    o.z += s0.dz;
    o.y += s0.dy;
  }
  const moveX = o.vx * dt;
  const moveZ = o.vz * dt;
  const moveDist = Math.hypot(moveX, moveZ);
  const steps = moveDist > r * 0.75 ? Math.min(4, Math.ceil(moveDist / (r * 0.75))) : 1;
  for (let i = 0; i < steps; i++) {
    o.x += moveX / steps;
    o.z += moveZ / steps;
    pushBody(o, r, hh, solids, self);
  }

  const py = o.y;
  o.vy -= (g === 25 && o.vy < 0 ? 15 : g) * dt;
  o.y += o.vy * dt;
  o.sup = null;
  let best: SolidBox | null = null;

  for (const s of solids) {
    if (s === self || s.held) continue;
    if (Math.abs(o.x - s.x) >= s.hw + r * 0.6 || Math.abs(o.z - s.z) >= s.hd + r * 0.6) continue;
    if (o.vy <= 0) {
      if (py >= s.top - 0.2 && o.y <= s.top + 0.001 && (!best || s.top > best.top)) {
        best = s;
      }
    } else if (py + hh <= s.bottom + 0.05 && o.y + hh > s.bottom) {
      o.y = s.bottom - hh;
      o.vy = 0;
    }
  }
  if (best) {
    o.y = best.top;
    o.vy = 0;
    o.sup = best;
  } else {
    pushBody(o, r, hh, solids, self);
  }
  return !!best;
}

export function solidAtPoint(solids: SolidBox[], x: number, y: number, z: number): SolidBox | null {
  for (const s of solids) {
    if (s.held) continue;
    if (Math.abs(x - s.x) <= s.hw && Math.abs(z - s.z) <= s.hd && y > s.bottom && y < s.top) {
      return s;
    }
  }
  return null;
}

export function hasGroundAt(solids: SolidBox[], x: number, z: number, y: number): boolean {
  for (const s of solids) {
    if (s.held || s.crate) continue;
    if (Math.abs(x - s.x) < s.hw && Math.abs(z - s.z) < s.hd && s.top <= y + 1.8 && s.top >= y - 5) {
      return true;
    }
  }
  return false;
}

export function nearLedgeAt(solids: SolidBox[], x: number, y: number, z: number): boolean {
  for (const s of solids) {
    if (s.crate || s.held) continue;
    if (s.top < y + 0.8 || s.bottom > y + 1.5) continue;
    const cx = Math.max(s.x - s.hw, Math.min(s.x + s.hw, x));
    const cz = Math.max(s.z - s.hd, Math.min(s.z + s.hd, z));
    if (Math.hypot(cx - x, cz - z) < 2.4) return true;
  }
  return false;
}

export function findWallAt(
  solids: SolidBox[],
  x: number,
  y: number,
  z: number,
  ry: number
): { s: SolidBox; nx: number; nz: number } | null {
  const fx = Math.sin(ry);
  const fz = Math.cos(ry);
  let best: SolidBox | null = null;
  let bd = 9;
  for (const s of solids) {
    if (s.crate || s.held) continue;
    if (s.top - y < 0.6 || y + 1.2 < s.bottom + 0.1) continue;
    const cx = Math.max(s.x - s.hw, Math.min(s.x + s.hw, x));
    const cz = Math.max(s.z - s.hd, Math.min(s.z + s.hd, z));
    const dx = cx - x;
    const dz = cz - z;
    const d = Math.hypot(dx, dz);
    if (d > 1.5 || d < 0.001) continue;
    if ((dx * fx + dz * fz) / d < 0.1) continue;
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  if (!best) return null;
  const rx = (x - best.x) / best.hw;
  const rz = (z - best.z) / best.hd;
  return Math.abs(rx) > Math.abs(rz)
    ? { s: best, nx: Math.sign(rx), nz: 0 }
    : { s: best, nx: 0, nz: Math.sign(rz) };
}

export function isGrabbableNear(
  myId: number,
  mx: number,
  my: number,
  mz: number,
  ry: number,
  players: { id: number; alive: boolean; ready: boolean; gx: number; gy: number; gz: number }[],
  crates: CrateObj[]
): boolean {
  const fx = Math.sin(ry);
  const fz = Math.cos(ry);
  const near = (x: number, y: number, z: number) => {
    const dx = x - mx;
    const dz = z - mz;
    return Math.hypot(dx, dz) < 2.3 && Math.abs(y - my) < 2 && dx * fx + dz * fz > -0.2;
  };
  for (const p of players) {
    if (p.id === myId || !p.alive || !p.ready) continue;
    if (near(p.gx, p.gy, p.gz)) return true;
  }
  for (const c of crates) {
    if (!c.held && near(c.x, c.y, c.z)) return true;
  }
  return false;
}

// Segment vs AABB line-of-sight check so melee strikes cannot pass through solid walls or pillars
export function hasClearHitPath(
  solids: SolidBox[],
  x1: number,
  y1: number,
  z1: number,
  x2: number,
  y2: number,
  z2: number
): boolean {
  const sy1 = y1 + 1.0;
  const sy2 = y2 + 1.0;
  const dx = x2 - x1;
  const dy = sy2 - sy1;
  const dz = z2 - z1;

  for (const s of solids) {
    if (s.held || s.crate) continue;
    if (s.top <= Math.min(y1, y2) + 0.55 || s.bottom >= Math.max(y1, y2) + 1.6) continue;
    const minX = s.x - Math.max(0.05, s.hw - 0.04);
    const maxX = s.x + Math.max(0.05, s.hw - 0.04);
    const minZ = s.z - Math.max(0.05, s.hd - 0.04);
    const maxZ = s.z + Math.max(0.05, s.hd - 0.04);
    const minY = s.bottom;
    const maxY = s.top;

    let tmin = 0;
    let tmax = 1;

    const clipAxis = (p0: number, d: number, bmin: number, bmax: number): boolean => {
      if (Math.abs(d) < 1e-6) {
        return p0 >= bmin && p0 <= bmax;
      }
      let t1 = (bmin - p0) / d;
      let t2 = (bmax - p0) / d;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      return tmin <= tmax;
    };

    if (!clipAxis(x1, dx, minX, maxX)) continue;
    if (!clipAxis(sy1, dy, minY, maxY)) continue;
    if (!clipAxis(z1, dz, minZ, maxZ)) continue;

    if (tmin < 0.98 && tmax > 0.02 && tmin <= tmax) {
      return false;
    }
  }
  return true;
}
