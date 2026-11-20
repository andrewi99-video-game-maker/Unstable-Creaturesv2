import * as THREE from 'three';
import { HEADS } from './types';
import { createContactShadowTexture } from './textures';

export interface CharacterModel extends THREE.Group {
  body: THREE.Group;
  sh: THREE.MeshStandardMaterial;
  base: string;
  L: THREE.Group[];
  A: THREE.Group[];
  tail: THREE.Group;
  head: THREE.Group;
  ears: [THREE.Object3D, number][];
  dot: THREE.Mesh;
  wm: Record<string, THREE.Group>;
  wk: string | null;
  prop?: THREE.Group;
  cape?: THREE.Mesh;
  wings?: [THREE.Mesh, number][];
  koStars: THREE.Group;
  contactShadow: THREE.Mesh;
  carryFlag: THREE.Group;
}

export interface SharkMesh extends THREE.Group {
  tail: THREE.Group;
  jaw: THREE.Group;
  tx: number;
  ty: number;
  tz: number;
  vx: number;
  vy: number;
  vz: number;
  st: number;
}

// Cartoon-PBR outline shader
export const OLM = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  vertexShader: `
    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * 0.024, 1.0);
    }
  `,
  fragmentShader: `
    void main() {
      gl_FragColor = vec4(0.04, 0.03, 0.08, 1.0);
    }
  `,
});

let contactTex: THREE.CanvasTexture | null = null;
function getContactTex(): THREE.CanvasTexture {
  if (!contactTex) contactTex = createContactShadowTexture();
  return contactTex;
}

export function wpModel(k: string): THREE.Group {
  const g = new THREE.Group();
  const M = (c: string, r = 0.36, m = 0.24, e?: string) =>
    new THREE.MeshStandardMaterial({
      color: c,
      roughness: r,
      metalness: m,
      envMapIntensity: 1.25,
      emissive: e || '#000000',
      emissiveIntensity: e ? 1.35 : 0,
    });
  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    ol = true
  ) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    if (ol) mesh.add(new THREE.Mesh(geo, OLM));
    return mesh;
  };

  if (k === 'shark') {
    add(new THREE.CylinderGeometry(0.1, 0.11, 0.52, 12), M('#5f83a6', 0.35, 0.35), 0, -0.25, 0);
    add(new THREE.SphereGeometry(0.17, 14, 12), M('#4f7191', 0.35, 0.35), 0, -0.05, 0);
    add(new THREE.ConeGeometry(0.15, 0.32, 10), M('#8cb2cf', 0.4, 0.2), 0, -0.62, 0).rotation.x = Math.PI;
    add(new THREE.ConeGeometry(0.08, 0.2, 4), M('#5d7f9f', 0.4, 0.2), 0, -0.12, -0.17).rotation.x = -0.5;
    add(new THREE.SphereGeometry(0.035, 8, 6), M('#111111', 0.1, 0.5), 0.1, -0.5, 0.09, false);
    for (let i = -1; i <= 1; i++) {
      add(new THREE.ConeGeometry(0.025, 0.07, 4), M('#ffffff', 0.2, 0.1), i * 0.06, -0.76, 0.04, false).rotation.x = Math.PI;
    }
  } else if (k === 'vortex') {
    add(new THREE.CylinderGeometry(0.19, 0.16, 0.5, 16), M('#e8f6ff', 0.25, 0.3), 0, -0.25, 0);
    add(new THREE.SphereGeometry(0.22, 14, 12), M('#38bdf8', 0.2, 0.4, '#0ea5e9'), 0, -0.02, 0);
    add(new THREE.TorusGeometry(0.23, 0.05, 8, 18), M('#7fe6ff', 0.2, 0.2, '#3ac8ff'), 0, -0.52, 0, false).rotation.x = Math.PI / 2;
    add(new THREE.TorusGeometry(0.14, 0.035, 8, 16), M('#ffffff', 0.2, 0.1, '#9fefff'), 0, -0.4, 0, false).rotation.x = Math.PI / 2;
  } else if (k === 'hook') {
    add(new THREE.CylinderGeometry(0.09, 0.1, 0.45, 12), M('#8a5a2b', 0.65, 0.05), 0, -0.22, 0);
    add(new THREE.TorusGeometry(0.14, 0.035, 8, 16), M('#e2e8f0', 0.2, 0.85), 0, -0.52, 0, false).rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const c = add(new THREE.ConeGeometry(0.05, 0.3, 6), M('#e2e8f0', 0.2, 0.85), Math.cos(a) * 0.14, -0.72, Math.sin(a) * 0.14, false);
      c.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
    }
  } else if (k === 'hammer') {
    add(new THREE.CylinderGeometry(0.06, 0.06, 1.15, 10), M('#78350f', 0.7, 0.05), 0, -0.55, 0);
    add(new THREE.BoxGeometry(0.74, 0.4, 0.4), M('#94a3b8', 0.25, 0.85), 0, -1.2, 0);
    add(new THREE.BoxGeometry(0.78, 0.12, 0.42), M('#f59e0b', 0.25, 0.7), 0, -1.2, 0, false);
  } else if (k === 'bomb') {
    add(new THREE.SphereGeometry(0.3, 16, 12), M('#1e293b', 0.25, 0.6), 0, -0.32, 0);
    add(new THREE.CylinderGeometry(0.04, 0.04, 0.18, 6), M('#d97706', 0.6, 0.1), 0, -0.05, 0, false);
    add(new THREE.SphereGeometry(0.065, 8, 6), M('#fb923c', 0.2, 0, '#ff6a1c'), 0, 0.06, 0, false);
  } else if (k === 'hole') {
    add(new THREE.CylinderGeometry(0.13, 0.17, 0.55, 14), M('#1e1b4b', 0.3, 0.6), 0, -0.28, 0);
    add(new THREE.SphereGeometry(0.2, 14, 12), M('#020617', 0.1, 0.4), 0, -0.02, 0);
    add(new THREE.TorusGeometry(0.24, 0.05, 8, 20), M('#c084fc', 0.2, 0.3, '#a855f7'), 0, -0.58, 0, false).rotation.x = Math.PI / 2;
    add(new THREE.SphereGeometry(0.13, 10, 8), M('#000000', 0.1, 0), 0, -0.62, 0, false);
  } else if (k === 'ice') {
    add(new THREE.CylinderGeometry(0.16, 0.16, 0.5, 14), M('#bae6fd', 0.15, 0.2), 0, -0.22, 0);
    add(new THREE.SphereGeometry(0.19, 14, 12), M('#38bdf8', 0.15, 0.2, '#0284c7'), 0, 0, 0);
    add(new THREE.ConeGeometry(0.22, 0.32, 12), M('#f0f9ff', 0.2, 0.1), 0, -0.62, 0).rotation.x = Math.PI;
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.3, 8), M('#0369a1', 0.3, 0.4), 0, -0.05, -0.2, false);
  } else if (k === 'banana') {
    add(new THREE.TorusGeometry(0.3, 0.09, 10, 16, Math.PI * 1.1), M('#facc15', 0.45, 0.05), 0, -0.45, 0).rotation.set(0, Math.PI / 2, 0);
  } else {
    // Candy Cane
    add(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 12), M('#ffffff', 0.25, 0.05), 0, -0.7, 0);
    for (let i = 0; i < 6; i++) {
      add(new THREE.CylinderGeometry(0.058, 0.058, 0.1, 12), M('#ef4444', 0.25, 0.05), 0, -0.2 - i * 0.2, 0, false);
    }
    add(new THREE.TorusGeometry(0.2, 0.05, 10, 16, Math.PI), M('#ffffff', 0.25, 0.05), 0, -1.35, 0.2).rotation.set(0, Math.PI / 2, Math.PI);
    add(new THREE.SphereGeometry(0.058, 8, 6), M('#ef4444', 0.25, 0.05), 0, -1.35, 0.4, false);
  }
  return g;
}

export function mkCharacter(o: {
  name: string;
  head: string;
  color: string;
  pants?: string;
  hat?: string;
  face?: string;
  back?: string;
}): CharacterModel {
  const g = new THREE.Group() as CharacterModel;
  g.rotation.order = 'YXZ';
  g.ears = [];

  const M = (c: string | THREE.Color, r = 0.55, m = 0.04) =>
    new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const shiny = (c: string) =>
    new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.12, metalness: 0.05, clearcoat: 0.9, clearcoatRoughness: 0.1 });

  const body = new THREE.Group();
  body.rotation.order = 'YXZ';
  g.add(body);
  g.body = body;

  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    p: THREE.Object3D = body,
    ol = true
  ) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    p.add(m);
    if (ol) m.add(new THREE.Mesh(geo, OLM));
    return m;
  };

  const ball = (
    r: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    p: THREE.Object3D,
    sx = 1,
    sy = 1,
    sz = 1,
    ol = true
  ) => {
    const m = add(new THREE.SphereGeometry(r, 18, 14), mat, x, y, z, p, ol);
    m.scale.set(sx, sy, sz);
    return m;
  };

  const inner = (e: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    e.add(m);
    return m;
  };

  const ear = (m: THREE.Object3D, b: number) => {
    m.rotation.z = b;
    g.ears.push([m, b]);
    return m;
  };

  const col = HEADS[o.head] || HEADS.dog;
  const fur = M(col, 0.7, 0.02);
  const furD = M(new THREE.Color(col).multiplyScalar(0.55), 0.72, 0.02);
  const cream = M('#f3e2c4', 0.65);
  const blk = shiny('#15101a');
  const pink = M('#ff9db5', 0.45);
  const white = M('#ffffff', 0.35);
  const sh = M(o.color, 0.52, 0.05);
  const pants = M(o.pants || '#334466', 0.62, 0.04);
  const shoe = shiny('#2b2233');
  const limb = o.head === 'panda' ? M('#241c2a', 0.65) : fur;
  g.sh = sh;
  g.base = o.color;

  // Torso, belt & collar
  add(new THREE.CylinderGeometry(0.4, 0.34, 0.95, 20), sh, 0, 1.3, 0);
  add(new THREE.CylinderGeometry(0.365, 0.365, 0.1, 20), M('#2a2230', 0.3, 0.4), 0, 0.9, 0, body, false);
  add(new THREE.BoxGeometry(0.16, 0.12, 0.06), M('#fbbf24', 0.25, 0.8), 0, 0.9, 0.35, body, false);
  add(new THREE.TorusGeometry(0.27, 0.06, 10, 18), M('#f1f5f9', 0.5), 0, 1.77, 0, body, false).rotation.x = Math.PI / 2;

  // Legs & arms
  g.L = [-1, 1].map((s) => {
    const p = new THREE.Group();
    p.position.set(s * 0.2, 0.85, 0);
    add(new THREE.CylinderGeometry(0.15, 0.13, 0.62, 14), pants, 0, -0.31, 0, p);
    add(new THREE.CylinderGeometry(0.11, 0.1, 0.2, 12), limb, 0, -0.68, 0, p, false);
    ball(0.17, shoe, 0, -0.76, 0.07, p, 1, 0.62, 1.45);
    body.add(p);
    return p;
  });

  g.A = [-1, 1].map((s) => {
    const p = new THREE.Group();
    p.position.set(s * 0.52, 1.65, 0);
    p.rotation.order = 'YXZ';
    add(new THREE.CylinderGeometry(0.14, 0.125, 0.36, 14), sh, 0, -0.18, 0, p);
    add(new THREE.CylinderGeometry(0.1, 0.09, 0.36, 12), limb, 0, -0.5, 0, p, false);
    ball(0.15, white, 0, -0.72, 0, p);
    body.add(p);
    return p;
  });

  const T = new THREE.Group();
  T.position.set(0, 1.0, -0.34);
  body.add(T);
  g.tail = T;

  // Head & glossy eyes
  const h = new THREE.Group();
  h.position.y = 2.3;
  body.add(h);
  g.head = h;
  add(new THREE.SphereGeometry(0.5, 28, 22), fur, 0, 0, 0, h);
  [-1, 1].forEach((s) => {
    ball(0.15, shiny('#ffffff'), s * 0.2, 0.1, 0.38, h, 1, 1, 1, false);
    ball(0.075, blk, s * 0.2, 0.09, 0.5, h, 1, 1, 1, false);
    ball(0.028, M('#ffffff', 0.1), s * 0.2 + 0.025, 0.13, 0.56, h, 1, 1, 1, false);
    add(new THREE.BoxGeometry(0.2, 0.045, 0.045), blk, s * 0.2, 0.31, 0.43, h, false).rotation.z = s * 0.28;
  });

  if (o.head === 'dog') {
    [-1, 1].forEach((s) => ear(ball(0.2, furD, s * 0.44, 0.18, -0.02, h, 0.5, 1.35, 0.8), s * 0.35));
    ball(0.23, cream, 0, -0.12, 0.38, h, 1.05, 0.85, 1.1);
    ball(0.085, blk, 0, -0.02, 0.62, h, 1, 0.8, 1, false);
    add(new THREE.TorusGeometry(0.07, 0.014, 6, 12, Math.PI), blk, 0, -0.17, 0.62, h, false).rotation.z = Math.PI;
    ball(0.06, pink, 0, -0.27, 0.56, h, 1, 0.6, 1.3, false);
    ball(0.2, furD, 0.22, 0.16, 0.36, h, 1, 1, 0.5, false);
    add(new THREE.CylinderGeometry(0.07, 0.05, 0.5, 8), fur, 0, 0.207, -0.14, T).rotation.x = -0.6;
  } else if (o.head === 'cat') {
    [-1, 1].forEach((s) => {
      const e = add(new THREE.ConeGeometry(0.17, 0.38, 4), fur, s * 0.3, 0.5, 0, h);
      e.rotation.y = Math.PI / 4;
      ear(e, -s * 0.3);
      inner(e, new THREE.ConeGeometry(0.1, 0.25, 4), pink, 0, -0.02, 0.04);
    });
    ball(0.17, cream, 0, -0.12, 0.36, h, 1.1, 0.8, 1);
    ball(0.05, pink, 0, -0.06, 0.52, h, 1.3, 0.9, 1, false);
    add(new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI), blk, 0, -0.15, 0.52, h, false).rotation.z = Math.PI;
    for (const s of [-1, 1]) {
      for (let k = -1; k <= 1; k++) {
        add(new THREE.CylinderGeometry(0.007, 0.007, 0.42, 4), white, s * 0.38, -0.1 + k * 0.045, 0.42, h, false).rotation.z =
          Math.PI / 2 + s * k * 0.12;
      }
    }
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 8), fur, 0, 0.22, -0.27, T).rotation.x = -0.9;
    ball(0.07, furD, 0, 0.45, -0.55, T, 1, 1, 1, false);
  } else if (o.head === 'bear') {
    [-1, 1].forEach((s) => {
      const e = ball(0.17, fur, s * 0.37, 0.38, -0.02, h, 1, 1, 0.8);
      ear(e, 0);
      inner(e, new THREE.SphereGeometry(0.1, 10, 8), cream, 0, 0, 0.08);
    });
    ball(0.2, cream, 0, -0.1, 0.4, h, 1.1, 0.85, 1);
    ball(0.08, blk, 0, -0.03, 0.59, h, 1.3, 0.9, 1, false);
    add(new THREE.TorusGeometry(0.06, 0.013, 6, 12, Math.PI), blk, 0, -0.17, 0.585, h, false).rotation.z = Math.PI;
    ball(0.14, fur, 0, 0.02, -0.1, T);
  } else if (o.head === 'rabbit') {
    [-1, 1].forEach((s) => {
      const e = ball(0.14, fur, s * 0.18, 0.86, -0.03, h, 0.7, 3.2, 0.35);
      ear(e, s * 0.12);
      inner(e, new THREE.SphereGeometry(0.09, 8, 8), pink, 0, 0, 0.06);
    });
    [-1, 1].forEach((s) => ball(0.14, cream, s * 0.13, -0.14, 0.36, h, 1, 0.85, 1));
    ball(0.045, pink, 0, -0.02, 0.5, h, 1.2, 0.9, 1, false);
    [-1, 1].forEach((s) => add(new THREE.BoxGeometry(0.06, 0.09, 0.025), white, s * 0.032, -0.25, 0.47, h, false));
    ball(0.2, white, 0, 0.05, -0.14, T);
  } else if (o.head === 'fox') {
    [-1, 1].forEach((s) => {
      const e = add(new THREE.ConeGeometry(0.17, 0.5, 4), fur, s * 0.3, 0.55, 0, h);
      e.rotation.y = Math.PI / 4;
      ear(e, -s * 0.28);
      inner(e, new THREE.ConeGeometry(0.1, 0.2, 4), blk, 0, 0.17, 0);
    });
    add(new THREE.ConeGeometry(0.2, 0.55, 12), cream, 0, -0.1, 0.5, h).rotation.x = Math.PI / 2;
    ball(0.06, blk, 0, -0.1, 0.78, h, 1, 1, 1, false);
    [-1, 1].forEach((s) => {
      add(new THREE.ConeGeometry(0.12, 0.3, 8), cream, s * 0.42, -0.12, 0.15, h, false).rotation.z = (-s * Math.PI) / 2;
    });
    ball(0.2, fur, 0, 0.1, -0.3, T, 0.75, 0.75, 1.7);
    ball(0.13, white, 0, 0.12, -0.58, T, 0.8, 0.8, 1, false);
  } else if (o.head === 'shark') {
    add(new THREE.ConeGeometry(0.2, 0.6, 4), fur, 0, 0.64, -0.08, h).rotation.x = -0.35;
    add(new THREE.TorusGeometry(0.21, 0.02, 6, 16, Math.PI), blk, 0, -0.13, 0.4, h, false).rotation.z = Math.PI;
    for (let k = -2; k <= 2; k++) {
      const x = k * 0.07;
      add(new THREE.ConeGeometry(0.025, 0.07, 4), white, x, -0.13 - Math.sqrt(0.0441 - x * x) + 0.045, 0.41, h, false);
    }
    add(new THREE.ConeGeometry(0.14, 0.55, 4), fur, 0, 0.15, -0.2, T).rotation.x = -0.5;
  } else if (o.head === 'chicken') {
    const red = M('#e02a2a', 0.45);
    const org = M('#ff9a1f', 0.45);
    add(new THREE.ConeGeometry(0.12, 0.3, 8), org, 0, -0.04, 0.58, h, false).rotation.x = Math.PI / 2;
    ball(0.09, red, 0, 0.53, 0.04, h);
    ball(0.08, red, 0, 0.5, 0.17, h);
    ball(0.08, red, 0, 0.5, -0.09, h);
    ball(0.06, red, 0, -0.19, 0.52, h, 0.8, 1.5, 0.8, false);
    [-1, 1].forEach((s) => ball(0.07, M('#ffb0a0', 0.6), s * 0.33, -0.06, 0.33, h, 1, 1, 0.5, false));
    [-1, 0, 1].forEach((k) => {
      const f = add(new THREE.ConeGeometry(0.1, 0.5, 6), fur, k * 0.12, 0.28, -0.12, T);
      f.rotation.set(-0.55, 0, -k * 0.35);
    });
  } else if (o.head === 'frog') {
    [-1, 1].forEach((s) => ball(0.17, fur, s * 0.22, 0.36, 0.24, h));
    add(new THREE.TorusGeometry(0.26, 0.02, 6, 16, Math.PI), blk, 0, -0.06, 0.44, h, false).rotation.z = Math.PI;
    [-1, 1].forEach((s) => ball(0.04, M('#3a8a30', 0.6), s * 0.1, 0.02, 0.5, h, 1, 1, 1, false));
    ball(0.1, fur, 0, 0.02, -0.06, T);
  } else if (o.head === 'pig') {
    const pk = M('#ff8fae', 0.55);
    add(new THREE.CylinderGeometry(0.2, 0.2, 0.2, 14), pk, 0, -0.08, 0.5, h).rotation.x = Math.PI / 2;
    [-1, 1].forEach((s) => ball(0.035, blk, s * 0.07, -0.08, 0.61, h, 1, 1.3, 1, false));
    [-1, 1].forEach((s) => {
      const e = add(new THREE.ConeGeometry(0.17, 0.32, 4), fur, s * 0.32, 0.42, 0.04, h);
      e.rotation.x = 0.5;
      ear(e, -s * 0.6);
    });
    add(new THREE.TorusGeometry(0.08, 0.025, 6, 10, Math.PI * 1.6), pk, 0, 0.05, -0.05, T, false);
  } else if (o.head === 'panda') {
    [-1, 1].forEach((s) => ear(ball(0.17, blk, s * 0.37, 0.38, -0.02, h, 1, 1, 0.8), 0));
    [-1, 1].forEach((s) => ball(0.17, blk, s * 0.2, 0.06, 0.4, h, 1, 1.25, 0.55, false));
    ball(0.07, blk, 0, -0.04, 0.52, h, 1.3, 0.9, 1, false);
    add(new THREE.TorusGeometry(0.06, 0.013, 6, 12, Math.PI), blk, 0, -0.13, 0.5, h, false).rotation.z = Math.PI;
    ball(0.14, white, 0, 0.02, -0.1, T);
  } else if (o.head === 'lizard') {
    const dk = M('#6f8f1f', 0.55);
    ball(0.22, fur, 0, -0.08, 0.4, h, 1, 0.8, 1.1);
    [-1, 1].forEach((s) => ball(0.03, blk, s * 0.07, -0.04, 0.63, h, 1, 1, 1, false));
    add(new THREE.TorusGeometry(0.15, 0.014, 6, 12, Math.PI), blk, 0, -0.15, 0.59, h, false).rotation.z = Math.PI;
    add(new THREE.BoxGeometry(0.05, 0.015, 0.2), M('#ff4d6d', 0.4), 0, -0.16, 0.7, h, false);
    [[-0.25, 0.43], [-0.08, 0.49], [0.1, 0.48], [0.26, 0.42]].forEach(([z, y]) => {
      add(new THREE.ConeGeometry(0.08, 0.22, 5), dk, 0, y + 0.06, z, h, false).rotation.x = -0.3;
    });
    [-1, 1].forEach((s) => ball(0.07, dk, s * 0.33, 0.2, 0.12, h, 1, 1, 0.6, false));
    add(new THREE.ConeGeometry(0.17, 1.0, 8), fur, 0, 0.1, -0.55, T).rotation.x = -1.35;
    [0, 1, 2].forEach((k) => {
      add(new THREE.ConeGeometry(0.05, 0.14, 5), dk, 0, 0.2 - k * 0.05, -0.3 - k * 0.28, T, false).rotation.x = -0.4;
    });
  }

  // Hats
  const gold = M('#ffd23c', 0.22, 0.75);
  const dome = (c: string) => add(new THREE.SphereGeometry(0.53, 14, 8, 0, 6.29, 0, 1.5), M(c, 0.5), 0, 0.1, 0, h, false);
  if (o.hat === 'cap') {
    dome('#e33');
    add(new THREE.BoxGeometry(0.5, 0.04, 0.35), M('#b11', 0.5), 0, 0.12, 0.55, h, false);
  }
  if (o.hat === 'crown') add(new THREE.CylinderGeometry(0.34, 0.4, 0.25, 8), gold, 0, 0.62, 0, h, false);
  if (o.hat === 'party') add(new THREE.ConeGeometry(0.25, 0.7, 12), M('#ff4fa3', 0.4), 0, 0.78, 0, h, false);
  if (o.hat === 'wizard') {
    add(new THREE.ConeGeometry(0.38, 0.95, 16), M('#5b3cc4', 0.5), 0, 0.85, 0, h, false);
    add(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 20), M('#4a2fa8', 0.5), 0, 0.42, 0, h, false);
  }
  if (o.hat === 'tophat') {
    add(new THREE.CylinderGeometry(0.3, 0.3, 0.55, 16), shiny('#1c1c24'), 0, 0.72, 0, h, false);
    add(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 20), shiny('#1c1c24'), 0, 0.44, 0, h, false);
    add(new THREE.CylinderGeometry(0.31, 0.31, 0.1, 16), M('#c22', 0.4), 0, 0.55, 0, h, false);
  }
  if (o.hat === 'cowboy') {
    add(new THREE.CylinderGeometry(0.8, 0.8, 0.04, 20), M('#a0693a', 0.7), 0, 0.43, 0, h, false);
    add(new THREE.CylinderGeometry(0.34, 0.4, 0.32, 16), M('#8a5428', 0.7), 0, 0.6, 0, h, false);
  }
  if (o.hat === 'chef') {
    add(new THREE.CylinderGeometry(0.3, 0.28, 0.3, 14), white, 0, 0.6, 0, h, false);
    ball(0.36, white, 0, 0.86, 0, h, 1, 0.8, 1, false);
  }
  if (o.hat === 'viking') {
    dome('#94a3b8');
    [-1, 1].forEach((s) => {
      const hn = add(new THREE.ConeGeometry(0.1, 0.45, 8), M('#f3e2c4', 0.4), s * 0.5, 0.36, 0, h, false);
      hn.rotation.z = -s * 0.9;
    });
  }
  if (o.hat === 'halo') {
    add(
      new THREE.TorusGeometry(0.32, 0.045, 8, 24),
      new THREE.MeshStandardMaterial({ color: '#ffe066', emissive: '#ffcc33', emissiveIntensity: 1.2, roughness: 0.2 }),
      0,
      0.92,
      0,
      h,
      false
    ).rotation.x = Math.PI / 2;
  }
  if (o.hat === 'propeller') {
    dome('#3cc8ff');
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 6), blk, 0, 0.66, 0, h, false);
    const pr = new THREE.Group();
    pr.position.set(0, 0.76, 0);
    h.add(pr);
    add(new THREE.BoxGeometry(0.8, 0.03, 0.12), M('#ff4fa3', 0.3), 0, 0, 0, pr, false);
    add(new THREE.BoxGeometry(0.12, 0.03, 0.8), gold, 0, 0, 0, pr, false);
    g.prop = pr;
  }

  // Face accessories
  if (o.face === 'shades') {
    [-1, 1].forEach((s) => {
      add(new THREE.BoxGeometry(0.3, 0.19, 0.05), blk, s * 0.2, 0.1, 0.565, h, false);
      add(new THREE.BoxGeometry(0.03, 0.03, 0.4), blk, s * 0.42, 0.14, 0.38, h, false);
    });
    add(new THREE.BoxGeometry(0.14, 0.035, 0.04), blk, 0, 0.15, 0.56, h, false);
  }
  if (o.face === 'glasses') {
    [-1, 1].forEach((s) => add(new THREE.TorusGeometry(0.17, 0.022, 8, 18), M('#222', 0.3, 0.7), s * 0.2, 0.1, 0.56, h, false));
    add(new THREE.BoxGeometry(0.1, 0.03, 0.03), M('#222', 0.3, 0.7), 0, 0.14, 0.57, h, false);
  }
  if (o.face === 'goggles') {
    [-1, 1].forEach((s) => {
      add(new THREE.CylinderGeometry(0.19, 0.19, 0.08, 16), M('#3ac8ff', 0.15, 0.1), s * 0.2, 0.1, 0.55, h, false).rotation.x = Math.PI / 2;
      add(new THREE.TorusGeometry(0.19, 0.03, 6, 16), M('#222'), s * 0.2, 0.1, 0.57, h, false);
    });
    add(new THREE.TorusGeometry(0.51, 0.035, 6, 24), M('#222'), 0, 0.1, 0, h, false).rotation.x = Math.PI / 2;
  }
  if (o.face === 'eyepatch') {
    ball(0.17, blk, 0.2, 0.1, 0.5, h, 1, 1, 0.45, false);
    add(new THREE.BoxGeometry(0.9, 0.03, 0.02), blk, 0, 0.22, 0.3, h, false).rotation.z = -0.25;
  }
  if (o.face === 'pink') {
    [-1, 1].forEach((s) => ball(0.18, shiny('#ff3c8a'), s * 0.2, 0.1, 0.54, h, 1, 1, 0.4, false));
    add(new THREE.BoxGeometry(0.14, 0.035, 0.04), shiny('#ff3c8a'), 0, 0.15, 0.56, h, false);
  }

  // Back items
  if (o.back === 'cape') {
    const cp = add(new THREE.BoxGeometry(0.78, 1.15, 0.05), M('#dc2626', 0.7), 0, 1.2, -0.46, body);
    cp.rotation.x = 0.14;
    g.cape = cp;
  }
  if (o.back === 'backpack') {
    add(new THREE.BoxGeometry(0.55, 0.7, 0.3), M('#8a5a2b', 0.75), 0, 1.3, -0.56, body);
    add(new THREE.BoxGeometry(0.4, 0.25, 0.08), M('#6b4220', 0.75), 0, 1.1, -0.76, body, false);
    [-1, 1].forEach((s) => add(new THREE.BoxGeometry(0.07, 0.7, 0.03), M('#5a3a1a'), s * 0.17, 1.38, 0.39, body, false));
  }
  if (o.back === 'jetpack') {
    [-1, 1].forEach((s) => {
      add(new THREE.CylinderGeometry(0.13, 0.13, 0.75, 12), M('#94a3b8', 0.3, 0.7), s * 0.17, 1.35, -0.56, body);
      add(new THREE.ConeGeometry(0.1, 0.2, 8), M('#334155', 0.4, 0.5), s * 0.17, 0.9, -0.56, body, false).rotation.x = Math.PI;
      add(
        new THREE.ConeGeometry(0.08, 0.3, 8),
        new THREE.MeshBasicMaterial({ color: '#ff8a2a' }),
        s * 0.17,
        0.7,
        -0.56,
        body,
        false
      ).rotation.x = Math.PI;
    });
  }
  if (o.back === 'wings') {
    g.wings = [-1, 1].map((s) => {
      const w = ball(0.2, white, s * 0.42, 1.5, -0.5, body, 1, 2.4, 0.4);
      w.rotation.z = s * 0.5;
      w.rotation.y = s * 0.45;
      return [w, s];
    });
  }

  // Orbiting dizzy stars when knocked out
  const koStars = new THREE.Group();
  koStars.position.set(0, 3.05, 0);
  koStars.visible = false;
  const starGeo = new THREE.OctahedronGeometry(0.14, 0);
  const starMat = new THREE.MeshStandardMaterial({ color: '#fde047', emissive: '#facc15', emissiveIntensity: 1.4, roughness: 0.2 });
  for (let i = 0; i < 3; i++) {
    const sm = new THREE.Mesh(starGeo, starMat);
    const a = (i / 3) * Math.PI * 2;
    sm.position.set(Math.cos(a) * 0.65, 0, Math.sin(a) * 0.65);
    koStars.add(sm);
  }
  g.add(koStars);
  g.koStars = koStars;

  // Ground contact shadow disc
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 1.5),
    new THREE.MeshBasicMaterial({ map: getContactTex(), transparent: true, depthWrite: false, opacity: 0.52 })
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.03;
  g.add(shadowPlane);
  g.contactShadow = shadowPlane;

  // Carried CTF Flag on back (visible when holding enemy flag)
  const carryFlag = new THREE.Group();
  carryFlag.position.set(0, 1.5, -0.58);
  carryFlag.rotation.x = -0.18;
  carryFlag.visible = false;
  const cPole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 2.5, 8), M('#fde047', 0.25, 0.7));
  cPole.position.y = 1.1;
  carryFlag.add(cPole);
  const cBanner = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.75, 1.2),
    new THREE.MeshStandardMaterial({ color: '#ef4444', emissive: '#ef4444', emissiveIntensity: 0.45, roughness: 0.4 })
  );
  cBanner.position.set(0, 1.95, -0.62);
  cBanner.name = 'banner';
  carryFlag.add(cBanner);
  g.add(carryFlag);
  g.carryFlag = carryFlag;

  // Name tag sprite
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const x = c.getContext('2d')!;
  let fs = 32;
  x.font = 'bold ' + fs + 'px Outfit, sans-serif';
  while (x.measureText(o.name).width > 230 && fs > 14) {
    fs--;
    x.font = 'bold ' + fs + 'px Outfit, sans-serif';
  }
  x.textAlign = 'center';
  x.fillStyle = 'rgba(15, 23, 42, 0.72)';
  x.beginPath();
  x.roundRect(10, 10, 236, 44, 12);
  x.fill();
  x.strokeStyle = 'rgba(255,255,255,0.22)';
  x.lineWidth = 2;
  x.stroke();
  x.fillStyle = '#ffffff';
  x.fillText(o.name, 128, 36 + fs * 0.28);
  const nt = new THREE.CanvasTexture(c);
  nt.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: nt, depthTest: false }));
  sp.scale.set(2.1, 0.52, 1);
  sp.position.y = 3.65;
  g.add(sp);

  g.dot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshBasicMaterial({ color: '#4ade80', depthTest: false }));
  g.dot.position.set(1.25, 3.65, 0);
  g.dot.visible = false;
  g.add(g.dot);

  g.wm = {};
  g.wk = null;
  for (const k of ['shark', 'vortex', 'cane', 'hook', 'hammer', 'bomb', 'banana', 'hole', 'ice']) {
    const m = wpModel(k);
    m.position.y = -0.72;
    m.visible = false;
    g.A[1].add(m);
    g.wm[k] = m;
  }
  return g;
}

export function setWeaponOnCharacter(g: CharacterModel, k: string | null): void {
  const nk = k || null;
  if (g.wk === nk) return;
  g.wk = nk;
  for (const n in g.wm) g.wm[n].visible = n === nk;
}

export function animateCharacter(g: CharacterModel, a: number, t: number, pr = 0.5): number {
  const w = Math.sin(t * 12);
  let y = 0;
  if (g.prop) g.prop.rotation.y = t * 16;
  if (g.cape) g.cape.rotation.x = 0.14 + (a === 1 ? 0.3 + Math.sin(t * 10) * 0.08 : 0);
  if (g.wings) g.wings.forEach(([wg, s]) => { wg.rotation.y = s * (0.45 + Math.sin(t * (a === 1 ? 14 : 3)) * 0.15); });

  g.L[0].rotation.set(0, 0, 0);
  g.L[1].rotation.set(0, 0, 0);
  g.A[0].rotation.set(0, 0, 0);
  g.A[1].rotation.set(0, 0, 0);
  g.A[0].scale.set(1, 1, 1);
  g.A[1].scale.set(1, 1, 1);
  g.head.rotation.set(0, 0, 0);
  g.head.position.y = 2.3;
  g.rotation.x = g.rotation.z = 0;
  g.body.rotation.set(0, 0, 0);
  g.body.position.set(0, 0, 0);
  g.tail.rotation.set(0, 0, 0);
  g.tail.rotation.y = Math.sin(t * (a === 1 ? 14 : 4.5)) * (a === 1 ? 0.55 : 0.22);

  g.koStars.visible = a === 6;
  if (a === 6) {
    g.koStars.rotation.y = t * 4.5;
    g.koStars.position.y = 1.45 + Math.sin(t * 6) * 0.05;
  }

  const fl = a === 1 ? Math.sin(t * 12) * 0.22 : a === 5 ? Math.sin(t * 14) * 0.45 : Math.sin(t * 2.5) * 0.04;
  g.ears.forEach(([e, b], i) => { e.rotation.z = b + (i ? -fl : fl); });

  if (a === 0) {
    const s = Math.sin(t * 2.2);
    g.head.position.y = 2.3 + s * 0.02;
    g.A[0].rotation.z = 0.06 + s * 0.03;
    g.A[1].rotation.z = -0.06 - s * 0.03;
  } else if (a === 1) {
    g.L[0].rotation.x = w * 0.8;
    g.L[1].rotation.x = -w * 0.8;
    g.A[0].rotation.x = -w * 0.7;
    g.A[1].rotation.x = w * 0.7;
    g.head.rotation.z = Math.sin(t * 6) * 0.06;
    y = Math.abs(w) * 0.05;
  } else if (a === 2) g.A[0].rotation.x = -1.6;
  else if (a === 7) g.A[1].rotation.x = -1.6;
  else if (a === 3) {
    const s = Math.sin(t * 10);
    g.A[0].rotation.x = s * 0.5 - 2.5;
    g.A[1].rotation.x = -s * 0.5 - 2.5;
    y = Math.abs(Math.sin(t * 8)) * 0.25;
    g.head.rotation.z = s * 0.3;
  } else if (a === 4) g.A[1].rotation.z = -2.5 + Math.sin(t * 14) * 0.4;
  else if (a === 5) {
    g.A[0].rotation.set(Math.sin(t * 25), 0, 0.8);
    g.A[1].rotation.set(-Math.sin(t * 25), 0, -0.8);
    g.body.rotation.z = 0.4 * Math.sin(t * 18);
  } else if (a === 6) {
    // Lay cleanly flat on back centered over physics radius without clipping into floor or walls
    g.body.rotation.set(-Math.PI / 2, 0, 0);
    g.body.position.set(0, 0.48, 1.2);
    g.L[0].rotation.set(0.06, 0, -0.14);
    g.L[1].rotation.set(-0.04, 0, 0.14);
    g.A[0].rotation.set(0.08, 0, 0.55);
    g.A[1].rotation.set(-0.06, 0, -0.55);
    g.head.rotation.set(0.05, Math.sin(t * 1.8) * 0.1, 0);
    y = 0;
  } else if (a === 8) {
    g.body.rotation.x = 0.5;
    g.head.rotation.x = 0.5;
  } else if (a === 9) {
    g.L[1].rotation.x = -1.5;
    g.body.rotation.x = -0.2;
  } else if (a === 10) {
    g.A[0].rotation.set(-2.9, 0, 0.28);
    g.A[1].rotation.set(-2.9, 0, -0.28);
    g.A[0].scale.y = g.A[1].scale.y = 1.3;
    g.body.rotation.x = -0.12;
    g.body.rotation.z = Math.sin(t * 18) * 0.03;
    g.L[0].rotation.x = Math.sin(t * 9) * 0.12;
    g.L[1].rotation.x = -g.L[0].rotation.x;
    g.head.rotation.x = -0.3;
  } else if (a === 11) {
    g.A[0].rotation.z = 0.06;
    g.A[1].rotation.z = -0.06;
  } else if (a === 12) {
    g.A[0].rotation.set(-2.5, 0, 0.32);
    g.A[1].rotation.set(-2.5, 0, -0.32);
    g.body.rotation.x = 0.12;
    const k = Math.sin(t * 8);
    g.L[0].rotation.x = k * 0.5;
    g.L[1].rotation.x = -k * 0.5;
    g.head.rotation.x = -0.25;
  } else if (a === 13) {
    g.A[0].rotation.z = 0.06;
    g.A[1].rotation.z = -0.06;
  } else if (a === 18) {
    const e = Math.min(1, Math.max(0, pr) * 1.5);
    g.A[1].rotation.set(-2.9 + e * 2.7, 0, -0.1);
    g.A[0].rotation.set(0.5, 0, 0.3);
    g.body.rotation.x = 0.05 + e * 0.3;
    g.head.rotation.x = e * 0.2;
  } else if (a === 16) {
    const sw = 1.45 * Math.cos(Math.min(1, pr * 1.1) * Math.PI);
    g.A[1].rotation.set(-1.4, sw, -0.05);
    g.A[0].rotation.set(0.4, 0, 0.3);
    g.body.rotation.z = -sw * 0.1;
    g.body.rotation.x = 0.04;
    g.head.rotation.y = -sw * 0.35;
  } else if (a === 17) {
    const rc = Math.max(0, 1 - pr * 2.2);
    g.A[1].rotation.set(-1.45 + rc * 0.6, 0, -0.12);
    g.A[0].rotation.set(-1.25, 0, 0.45);
    g.body.rotation.x = 0.05 - rc * 0.12;
    g.head.rotation.x = -0.05;
  } else if (a === 14) {
    g.A[0].rotation.set(-1.45, 0, 0.5);
    g.A[1].rotation.set(-1.45, 0, -0.5);
    g.body.rotation.x = 0.18;
    g.body.rotation.z = Math.sin(t * 14) * 0.02;
  } else if (a === 15) {
    const o = Math.sin(t * 10) * 0.12;
    g.A[0].rotation.set(-1.5 + o, 0, 0.28);
    g.A[1].rotation.set(-1.5 - o, 0, -0.28);
    g.body.rotation.x = 0.1;
  }

  if (g.wk && a !== 6 && (a === 0 || a === 1)) {
    g.A[1].rotation.set(g.wk === 'cane' ? -1.1 : -1.0, 0, -0.12);
  }
  return y;
}

// Articulated 3D Shark (used for both Shark Gun & Reef Sharks — with snapping lower jaw!)
export function mkSharkMesh(scale = 2.1, fierce = false): SharkMesh {
  const g = new THREE.Group() as SharkMesh;
  const skinCol = fierce ? '#3b5b78' : '#6d8fb0';
  const bellyCol = '#eef4f8';
  const M = (c: string, r = 0.35) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.12 });
  const add = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
    p: THREE.Object3D = g,
    ol = true
  ) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = true;
    p.add(m);
    if (ol) m.add(new THREE.Mesh(geo, OLM));
    return m;
  };

  // Main upper body + snout
  add(new THREE.SphereGeometry(0.4, 16, 12), M(skinCol), 0, 0.04, 0, 0.92, 0.78, 1.95);
  add(new THREE.SphereGeometry(0.35, 14, 10), M(bellyCol, 0.45), 0, -0.1, 0.08, 0.8, 0.5, 1.55);
  // Dorsal fin
  add(new THREE.ConeGeometry(0.22, 0.62, 5), M(fierce ? '#2a4259' : '#557696'), 0, 0.46, -0.08).rotation.x = -0.32;
  // Pectoral side fins
  [-1, 1].forEach((s) => {
    const pf = add(new THREE.ConeGeometry(0.14, 0.48, 5), M(skinCol), s * 0.44, -0.08, 0.12);
    pf.rotation.set(0.2, 0, -s * 1.25);
  });

  // Eyes (glow slightly amber if fierce reef shark)
  for (const s of [-1, 1]) {
    add(new THREE.SphereGeometry(0.085, 8, 6), M(fierce ? '#fef08a' : '#ffffff', 0.1), s * 0.22, 0.14, 0.52, 1, 1, 1, g, false);
    add(new THREE.SphereGeometry(0.045, 8, 6), M('#09090b', 0.1), s * 0.23, 0.14, 0.59, 1, 1, 1, g, false);
  }

  // Upper teeth
  const toothMat = M('#ffffff', 0.2);
  for (let i = -2; i <= 2; i++) {
    const t = add(new THREE.ConeGeometry(0.03, 0.09, 4), toothMat, i * 0.075, -0.08, 0.74 - Math.abs(i) * 0.04, 1, 1, 1, g, false);
    t.rotation.x = Math.PI;
  }

  // Articulated Lower Jaw for chomping
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.12, 0.35);
  g.add(jaw);
  g.jaw = jaw;
  add(new THREE.SphereGeometry(0.24, 12, 8), M(bellyCol, 0.45), 0, -0.05, 0.22, 0.95, 0.42, 1.35, jaw);
  for (let i = -2; i <= 2; i++) {
    add(new THREE.ConeGeometry(0.026, 0.08, 4), toothMat, i * 0.068, 0.02, 0.4 - Math.abs(i) * 0.03, 1, 1, 1, jaw, false);
  }

  // Tail fin
  const tail = new THREE.Group();
  tail.position.set(0, 0, -0.72);
  g.add(tail);
  g.tail = tail;
  add(new THREE.ConeGeometry(0.3, 0.65, 5), M(skinCol), 0, 0, -0.32, 0.55, 1.2, 1, tail).rotation.x = -Math.PI / 2;

  g.scale.set(scale, scale, scale);
  g.rotation.order = 'YXZ';
  return g;
}

// Multi-part Pirate Galleon Ship for Pirate Deck hazard
export function mkPirateShip(): THREE.Group {
  const ship = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: '#5c3419', roughness: 0.78 });
  const trimMat = new THREE.MeshStandardMaterial({ color: '#d97706', roughness: 0.4, metalness: 0.5 });
  const deckMat = new THREE.MeshStandardMaterial({ color: '#8a562c', roughness: 0.7 });
  const sailMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.65, side: THREE.DoubleSide });
  const darkSailMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.7, side: THREE.DoubleSide });
  const cannonMat = new THREE.MeshStandardMaterial({ color: '#1f2937', roughness: 0.35, metalness: 0.8 });

  // Tapered Hull
  const hull = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.1, 7.6), hullMat);
  hull.position.set(0, 0.6, 0);
  hull.castShadow = true;
  ship.add(hull);

  // Bow prow
  const prow = new THREE.Mesh(new THREE.ConeGeometry(1.75, 3.2, 4), hullMat);
  prow.rotation.x = Math.PI / 2;
  prow.rotation.y = Math.PI / 4;
  prow.position.set(0, 0.75, 5.1);
  ship.add(prow);

  // Bowsprit
  const bowsprit = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 3.4, 8), hullMat);
  bowsprit.rotation.x = Math.PI / 2.4;
  bowsprit.position.set(0, 1.9, 6.2);
  ship.add(bowsprit);

  // Deck & Quarterdeck Cabin
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.25, 7.2), deckMat);
  deck.position.set(0, 1.7, 0);
  ship.add(deck);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.6, 2.3), hullMat);
  cabin.position.set(0, 2.4, -2.5);
  ship.add(cabin);

  // Gold stern trim & glowing lantern
  const trim = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.24, 7.8), trimMat);
  trim.position.set(0, 1.55, 0);
  ship.add(trim);

  const lantern = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 10, 8),
    new THREE.MeshBasicMaterial({ color: '#fde047' })
  );
  lantern.position.set(0, 3.35, -3.7);
  ship.add(lantern);

  // Main Mast + Sails + Jolly Roger Flag
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 8.2, 10), hullMat);
  mast.position.set(0, 5.6, 0.6);
  ship.add(mast);

  const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.6, 8), hullMat);
  yard.rotation.z = Math.PI / 2;
  yard.position.set(0, 7.0, 0.6);
  ship.add(yard);

  const mainSail = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 3.6), sailMat);
  mainSail.position.set(0, 5.3, 0.85);
  ship.add(mainSail);

  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.9), darkSailMat);
  flag.position.set(0.75, 9.2, 0.6);
  ship.add(flag);

  // Broadside Cannons facing inward toward the arena
  for (const cz of [-0.6, 0.9, 2.4]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 1.25, 10), cannonMat);
    c.rotation.z = Math.PI / 2;
    c.position.set(-1.8, 2.05, cz);
    ship.add(c);
  }

  return ship;
}

export interface FlagVisual extends THREE.Group {
  stand: THREE.Group;
  pole: THREE.Group;
  cloth: THREE.Mesh;
}

export function mkFlagVisual(team: number): FlagVisual {
  const g = new THREE.Group() as FlagVisual;
  const teamHex = team === 0 ? '#ef4444' : '#3b82f6';
  const emissiveHex = team === 0 ? '#dc2626' : '#2563eb';

  const stand = new THREE.Group();
  const baseRing = new THREE.Mesh(
    new THREE.CylinderGeometry(1.4, 1.65, 0.22, 24),
    new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.4, metalness: 0.5 })
  );
  baseRing.position.y = 0.11;
  baseRing.receiveShadow = true;
  stand.add(baseRing);

  const glowRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.45, 0.09, 8, 28),
    new THREE.MeshStandardMaterial({ color: teamHex, emissive: emissiveHex, emissiveIntensity: 1.35, roughness: 0.2 })
  );
  glowRing.rotation.x = Math.PI / 2;
  glowRing.position.y = 0.22;
  stand.add(glowRing);
  g.add(stand);
  g.stand = stand;

  const pole = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.09, 3.8, 10),
    new THREE.MeshStandardMaterial({ color: '#e2e8f0', roughness: 0.25, metalness: 0.8 })
  );
  shaft.position.y = 1.9;
  shaft.castShadow = true;
  pole.add(shaft);

  const finial = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 10, 8),
    new THREE.MeshStandardMaterial({ color: '#facc15', emissive: '#eab308', emissiveIntensity: 0.6, roughness: 0.2, metalness: 0.85 })
  );
  finial.position.y = 3.88;
  pole.add(finial);

  const cloth = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 1.15, 1.85),
    new THREE.MeshStandardMaterial({ color: teamHex, emissive: emissiveHex, emissiveIntensity: 0.55, roughness: 0.45 })
  );
  cloth.position.set(0, 3.05, 0.95);
  cloth.castShadow = true;
  pole.add(cloth);

  g.add(pole);
  g.pole = pole;
  g.cloth = cloth;
  return g;
}

export interface ZoneVisual extends THREE.Group {
  ring: THREE.Mesh;
  ringMat: THREE.MeshStandardMaterial;
  beam: THREE.Mesh;
  beamMat: THREE.MeshBasicMaterial;
  pad: THREE.Mesh;
  padMat: THREE.MeshBasicMaterial;
}

export function mkZoneVisual(radius = 4.2): ZoneVisual {
  const g = new THREE.Group() as ZoneVisual;

  const ringMat = new THREE.MeshStandardMaterial({
    color: '#38bdf8',
    emissive: '#38bdf8',
    emissiveIntensity: 1.4,
    roughness: 0.2,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.18, 10, 48), ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.16;
  g.add(ring);
  g.ring = ring;
  g.ringMat = ringMat;

  const padMat = new THREE.MeshBasicMaterial({
    color: '#38bdf8',
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
  });
  const pad = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), padMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.08;
  g.add(pad);
  g.pad = pad;
  g.padMat = padMat;

  const beamMat = new THREE.MeshBasicMaterial({
    color: '#38bdf8',
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.92, radius, 11, 32, 1, true), beamMat);
  beam.position.y = 5.5;
  g.add(beam);
  g.beam = beam;
  g.beamMat = beamMat;

  return g;
}

