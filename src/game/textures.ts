import * as THREE from 'three';

let maxAniso = 4;

export function setMaxAnisotropy(renderer: THREE.WebGLRenderer): void {
  maxAniso = Math.min(16, renderer.capabilities.getMaxAnisotropy() || 4);
}

function makeCanvas(w = 512, h = 512): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function finalizeColorTex(c: HTMLCanvasElement, rx = 1, ry = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = maxAniso;
  t.needsUpdate = true;
  return t;
}

function finalizeDataTex(c: HTMLCanvasElement, rx = 1, ry = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = maxAniso;
  t.needsUpdate = true;
  return t;
}

export interface PBRTexSet {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap?: THREE.CanvasTexture;
  emissiveMap?: THREE.CanvasTexture;
  roughness?: number;
  metalness?: number;
}

// High-res 512x512 wood plank deck with fine knots, wood grain, plank gaps, and brass nails
export function createWoodTextures(baseHex = '#8d5b2d', darkHex = '#653e1b', repeat = 5): PBRTexSet {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  const [bc, bctx] = makeCanvas(S, S);
  const [rc, rctx] = makeCanvas(S, S);
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, S, S);
  bctx.fillStyle = '#c8c8c8';
  bctx.fillRect(0, 0, S, S);
  rctx.fillStyle = '#b4b4b4';
  rctx.fillRect(0, 0, S, S);

  const planks = 6;
  const ph = S / planks;
  for (let i = 0; i < planks; i++) {
    const y = i * ph;
    ctx.fillStyle = i % 2 === 0 ? baseHex : darkHex;
    ctx.fillRect(0, y, S, ph - 5);
    rctx.fillStyle = i % 2 === 0 ? '#a8a8a8' : '#c0c0c0';
    rctx.fillRect(0, y, S, ph - 5);

    // Organic wood grain & subtle highlight streaks
    for (let g = 0; g < 36; g++) {
      ctx.fillStyle = g % 3 === 0 ? 'rgba(255,228,185,0.09)' : 'rgba(22,10,3,0.13)';
      const gy = y + 4 + ((g * 4.3) % (ph - 10));
      ctx.fillRect(0, gy, S, 2);
      bctx.fillStyle = g % 2 === 0 ? '#dcdcdc' : '#9c9c9c';
      bctx.fillRect(0, gy, S, 2);
    }

    // Wood knot detail
    const kx = ((i * 173 + 90) % (S - 80)) + 40;
    const ky = y + ph * 0.5;
    ctx.strokeStyle = 'rgba(20,9,2,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(kx, ky, 18, 7, 0.08, 0, Math.PI * 2);
    ctx.stroke();

    // Deep plank seam + specular dark in crack
    ctx.fillStyle = '#1f1005';
    ctx.fillRect(0, y + ph - 5, S, 5);
    bctx.fillStyle = '#181818';
    bctx.fillRect(0, y + ph - 5, S, 5);
    rctx.fillStyle = '#ffffff';
    rctx.fillRect(0, y + ph - 5, S, 5);

    // Staggered vertical plank joint & brass rivets
    const sx = ((i * 197 + 70) % (S - 100)) + 50;
    ctx.fillRect(sx, y, 5, ph);
    bctx.fillRect(sx, y, 5, ph);
    for (const nx of [sx - 16, sx + 20]) {
      for (const ny of [y + 18, y + ph - 22]) {
        ctx.fillStyle = '#d97706';
        ctx.beginPath();
        ctx.arc(nx, ny, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.arc(nx + 1.5, ny + 1.5, 4.2, 0, Math.PI * 2);
        ctx.stroke();
        bctx.fillStyle = '#ffffff';
        bctx.beginPath();
        bctx.arc(nx, ny, 4.2, 0, Math.PI * 2);
        bctx.fill();
        rctx.fillStyle = '#404040';
        rctx.beginPath();
        rctx.arc(nx, ny, 4.2, 0, Math.PI * 2);
        rctx.fill();
      }
    }
  }
  return {
    map: finalizeColorTex(c, repeat, repeat),
    bumpMap: finalizeDataTex(bc, repeat, repeat),
    roughnessMap: finalizeDataTex(rc, repeat, repeat),
    roughness: 0.65,
    metalness: 0.08,
  };
}

// High-res 512x512 Stone / Marble / Carved Tile checkerboard with weathered cracks & mortar AO
export function createStoneTileTextures(c1: string, c2: string, repeat = 6, accent?: string): PBRTexSet {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  const [bc, bctx] = makeCanvas(S, S);
  const [rc, rctx] = makeCanvas(S, S);
  bctx.fillStyle = '#c4c4c4';
  bctx.fillRect(0, 0, S, S);
  rctx.fillStyle = '#888888';
  rctx.fillRect(0, 0, S, S);

  for (let iy = 0; iy < 2; iy++) {
    for (let ix = 0; ix < 2; ix++) {
      const x = ix * 256;
      const y = iy * 256;
      ctx.fillStyle = (ix + iy) % 2 === 0 ? c1 : c2;
      ctx.fillRect(x, y, 256, 256);

      // Marble / stone mineral veins
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 2;
      for (let v = 0; v < 4; v++) {
        ctx.beginPath();
        ctx.moveTo(x + ((v * 63 + ix * 41) % 220), y + 10);
        ctx.bezierCurveTo(x + 90, y + 90, x + 160, y + 150, x + ((v * 91 + 40) % 230), y + 245);
        ctx.stroke();
      }

      // Inner crisp bevel highlight
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 6;
      ctx.strokeRect(x + 8, y + 8, 240, 240);
      bctx.strokeStyle = '#efefef';
      bctx.lineWidth = 6;
      bctx.strokeRect(x + 8, y + 8, 240, 240);

      // Micro pebble noise
      for (let s = 0; s < 140; s++) {
        ctx.fillStyle = s % 2 ? 'rgba(255,255,255,0.065)' : 'rgba(0,0,0,0.09)';
        const px = x + ((s * 79 + ix * 17) % 232) + 12;
        const py = y + ((s * 113 + iy * 29) % 232) + 12;
        ctx.fillRect(px, py, 5, 5);
        rctx.fillStyle = s % 2 ? '#6e6e6e' : '#b2b2b2';
        rctx.fillRect(px, py, 5, 5);
      }

      if (accent && (ix + iy) % 2 === 0) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 4;
        ctx.strokeRect(x + 26, y + 26, 204, 204);
      }

      // Mortar groove
      ctx.strokeStyle = 'rgba(0,0,0,0.48)';
      ctx.lineWidth = 8;
      ctx.strokeRect(x, y, 256, 256);
      bctx.strokeStyle = '#242424';
      bctx.lineWidth = 10;
      bctx.strokeRect(x, y, 256, 256);
      rctx.strokeStyle = '#ececec';
      rctx.lineWidth = 10;
      rctx.strokeRect(x, y, 256, 256);
    }
  }
  return {
    map: finalizeColorTex(c, repeat, repeat),
    bumpMap: finalizeDataTex(bc, repeat, repeat),
    roughnessMap: finalizeDataTex(rc, repeat, repeat),
    roughness: 0.45,
    metalness: 0.12,
  };
}

// High-res 512x512 Industrial Caution / Brushed Steel Plate texture
export function createCautionStripeTextures(baseCol = '#3f3f46', stripeCol = '#f59e0b', repeat = 4): PBRTexSet {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  const [bc, bctx] = makeCanvas(S, S);
  ctx.fillStyle = baseCol;
  ctx.fillRect(0, 0, S, S);
  bctx.fillStyle = '#a0a0a0';
  bctx.fillRect(0, 0, S, S);

  // Steel diamond-plate bumps
  for (let y = 16; y < S; y += 32) {
    for (let x = 16; x < S; x += 32) {
      bctx.fillStyle = '#dcdcdc';
      bctx.beginPath();
      bctx.ellipse(x, y, 8, 3, (x + y) % 64 === 0 ? 0.78 : -0.78, 0, Math.PI * 2);
      bctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.ellipse(x, y, 8, 3, (x + y) % 64 === 0 ? 0.78 : -0.78, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Caution border band along edges
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, S, 44);
  ctx.rect(0, S - 44, S, 44);
  ctx.clip();
  ctx.fillStyle = '#18181b';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = stripeCol;
  for (let i = -S; i < S * 2; i += 48) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 24, 0);
    ctx.lineTo(i - 20, S);
    ctx.lineTo(i - 44, S);
    ctx.fill();
  }
  ctx.restore();

  return {
    map: finalizeColorTex(c, repeat, repeat),
    bumpMap: finalizeDataTex(bc, repeat, repeat),
    roughness: 0.36,
    metalness: 0.62,
  };
}

// High-res 512x512 Neon circuit grid texture for sci-fi maps
export function createCircuitTextures(bg: string, lineCol: string, glowCol: string, repeat = 5): {
  map: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughness: number;
  metalness: number;
} {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  const [ec, ectx] = makeCanvas(S, S);
  const [bc, bctx] = makeCanvas(S, S);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);
  ectx.fillStyle = '#000000';
  ectx.fillRect(0, 0, S, S);
  bctx.fillStyle = '#909090';
  bctx.fillRect(0, 0, S, S);

  ctx.strokeStyle = lineCol;
  ctx.lineWidth = 5;
  bctx.strokeStyle = '#383838';
  bctx.lineWidth = 6;
  for (let i = 0; i <= S; i += 128) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke();
    bctx.beginPath(); bctx.moveTo(i, 0); bctx.lineTo(i, S); bctx.stroke();
    bctx.beginPath(); bctx.moveTo(0, i); bctx.lineTo(S, i); bctx.stroke();
  }

  for (const target of [ctx, ectx]) {
    target.strokeStyle = glowCol;
    target.lineWidth = 5;
    target.strokeRect(28, 28, S - 56, S - 56);
    target.lineWidth = 3;
    target.beginPath();
    target.moveTo(128, 28); target.lineTo(128, 128); target.lineTo(384, 384); target.lineTo(384, S - 28);
    target.stroke();
    target.fillStyle = glowCol;
    for (const px of [28, 256, S - 28]) {
      for (const py of [28, 256, S - 28]) {
        target.beginPath();
        target.arc(px, py, 9, 0, Math.PI * 2);
        target.fill();
      }
    }
  }
  return {
    map: finalizeColorTex(c, repeat, repeat),
    emissiveMap: finalizeColorTex(ec, repeat, repeat),
    bumpMap: finalizeDataTex(bc, repeat, repeat),
    roughness: 0.25,
    metalness: 0.55,
  };
}

// Crisp 512x512 Tropical grass / sandy island texture
export function createTropicalIslandTexture(c1: string, c2: string, repeat = 4): PBRTexSet {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  const [bc, bctx] = makeCanvas(S, S);
  ctx.fillStyle = c1;
  ctx.fillRect(0, 0, S, S);
  bctx.fillStyle = '#999999';
  bctx.fillRect(0, 0, S, S);

  for (let i = 0; i < 900; i++) {
    const x = (i * 137) % S;
    const y = (i * 251) % S;
    ctx.fillStyle = i % 3 === 0 ? c2 : i % 5 === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)';
    ctx.beginPath();
    ctx.arc(x, y, 4 + (i % 9), 0, Math.PI * 2);
    ctx.fill();
    bctx.fillStyle = i % 2 ? '#c4c4c4' : '#707070';
    bctx.fillRect(x, y, 6, 6);
  }
  return {
    map: finalizeColorTex(c, repeat, repeat),
    bumpMap: finalizeDataTex(bc, repeat, repeat),
    roughness: 0.85,
    metalness: 0.02,
  };
}

// High-res Industrial crate texture with diagonal braces & steel corner brackets
export function createCrateTexture(): PBRTexSet {
  const S = 512;
  const [c, ctx] = makeCanvas(S, S);
  const [bc, bctx] = makeCanvas(S, S);
  ctx.fillStyle = '#d9963b';
  ctx.fillRect(0, 0, S, S);
  bctx.fillStyle = '#909090';
  bctx.fillRect(0, 0, S, S);

  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = i % 2 ? '#c4812b' : '#df9f45';
    ctx.fillRect(46, 46 + i * 60, 420, 54);
  }
  ctx.strokeStyle = '#9c6018';
  ctx.lineWidth = 40;
  ctx.beginPath();
  ctx.moveTo(46, 46);
  ctx.lineTo(466, 466);
  ctx.stroke();

  bctx.strokeStyle = '#e0e0e0';
  bctx.lineWidth = 40;
  bctx.beginPath();
  bctx.moveTo(46, 46);
  bctx.lineTo(466, 466);
  bctx.stroke();

  ctx.strokeStyle = '#8b5012';
  ctx.lineWidth = 54;
  ctx.strokeRect(27, 27, 458, 458);
  bctx.strokeStyle = '#ffffff';
  bctx.lineWidth = 54;
  bctx.strokeRect(27, 27, 458, 458);

  // Dark corner metal brackets
  ctx.fillStyle = '#334155';
  for (const [bx, by] of [[0, 0], [S - 52, 0], [0, S - 52], [S - 52, S - 52]]) {
    ctx.fillRect(bx, by, 52, 52);
  }

  return { map: finalizeColorTex(c, 1, 1), bumpMap: finalizeDataTex(bc, 1, 1), roughness: 0.56, metalness: 0.15 };
}

// Soft radial contact shadow disc under characters & crates
export function createContactShadowTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.72)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.32)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Hazard warning ring texture
export function createWarningRingTexture(col = '#ff3b30'): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(256, 256);
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = col;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(128, 128, 108, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = col;
  ctx.globalAlpha = 0.24;
  ctx.beginPath();
  ctx.arc(128, 128, 100, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.92;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(128, 128, 54, 0, Math.PI * 2);
  ctx.stroke();

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Enhanced Sky Dome with drifting procedural clouds, horizon scattering, sun disk, and stars
export function createSkyDome(): {
  mesh: THREE.Mesh;
  uniforms: {
    uTop: { value: THREE.Color };
    uMid: { value: THREE.Color };
    uBot: { value: THREE.Color };
    uTime: { value: number };
  };
} {
  const uniforms = {
    uTop: { value: new THREE.Color('#0f172a') },
    uMid: { value: new THREE.Color('#3b2478') },
    uBot: { value: new THREE.Color('#f472b6') },
    uTime: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      varying vec3 vWorld;
      uniform vec3 uTop;
      uniform vec3 uMid;
      uniform vec3 uBot;
      uniform float uTime;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
        float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
        float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
        float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0;
        v += 0.55 * vnoise(p);
        v += 0.28 * vnoise(p * 2.1 + 3.1);
        v += 0.14 * vnoise(p * 4.3 + 7.2);
        return v;
      }

      void main() {
        vec3 d = normalize(vWorld);
        float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(uBot, uMid, smoothstep(0.32, 0.56, h));
        col = mix(col, uTop, smoothstep(0.54, 0.92, h));

        // Sun halo, atmospheric corona & crisp disk
        vec3 sunDir = normalize(vec3(0.45, 0.42, 0.28));
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.85, 0.6) * pow(s, 6.0) * 0.25;
        col += vec3(1.0, 0.9, 0.72) * pow(s, 18.0) * 0.48;
        col += vec3(1.0, 0.98, 0.92) * pow(s, 260.0) * 1.25;

        // Soft drifting clouds with sunlit rim near upper horizon
        if (d.y > 0.03) {
          vec2 cuv = d.xz / (d.y + 0.35) * 1.65 + vec2(uTime * 0.015, uTime * 0.008);
          float cl = fbm(cuv);
          float clDetail = fbm(cuv * 2.2 - vec2(uTime * 0.006, 0.0));
          float cloudMask = smoothstep(0.48, 0.82, cl * 0.75 + clDetail * 0.25) * smoothstep(0.03, 0.22, d.y) * smoothstep(0.92, 0.32, d.y);
          vec3 cloudCol = mix(uBot * 1.15, vec3(1.0, 0.97, 0.93), 0.6 + 0.38 * pow(s, 3.0));
          col = mix(col, cloudCol, cloudMask * 0.58);
        }

        // Twinkling stars near zenith on dark skies
        if (d.y > 0.18) {
          vec3 grid = floor(d * 130.0);
          float n = hash(grid);
          if (n > 0.992) {
            float tw = 0.5 + 0.5 * sin(uTime * 2.5 + n * 100.0);
            col += vec3(0.85, 0.92, 1.0) * smoothstep(0.18, 0.65, d.y) * tw * 0.72;
          }
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(195, 42, 28), mat);
  return { mesh, uniforms };
}

// Animated Ocean Plane with high-res vertex swells, Fresnel sky reflection, caustic foam & sun sparkles
export function createAnimatedOcean(baseColor = '#0284c7'): {
  mesh: THREE.Mesh;
  uniforms: { uTime: { value: number }; uColor: { value: THREE.Color } };
} {
  const uniforms = {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(baseColor) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    vertexShader: `
      uniform float uTime;
      varying vec3 vPos;
      varying float vWave;
      varying vec3 vNormalApprox;
      void main() {
        vec3 p = position;
        float w1 = sin(p.x * 0.18 + uTime * 1.9) * cos(p.y * 0.16 + uTime * 1.5) * 0.42;
        float w2 = sin(p.x * 0.42 - uTime * 2.7 + p.y * 0.35) * 0.16;
        float w3 = cos(p.y * 0.68 + uTime * 3.1) * 0.08;
        p.z += w1 + w2 + w3;
        vWave = w1 + w2 + w3;
        float dx = cos(p.x * 0.18 + uTime * 1.9) * 0.13 + cos(p.x * 0.42 - uTime * 2.7 + p.y * 0.35) * 0.09;
        float dz = -sin(p.y * 0.16 + uTime * 1.5) * 0.13 - sin(p.y * 0.68 + uTime * 3.1) * 0.07;
        vNormalApprox = normalize(vec3(-dx, 1.0, -dz));
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec3 vPos;
      varying float vWave;
      varying vec3 vNormalApprox;
      void main() {
        float dist = length(vPos.xz);
        vec3 deep = uColor * 0.26;
        vec3 shallow = mix(uColor, vec3(0.32, 0.98, 0.96), 0.48);
        float nearIsland = 1.0 - smoothstep(7.0, 34.0, dist);
        vec3 col = mix(deep, shallow, nearIsland * 0.78 + (vWave + 0.5) * 0.25);

        // Subsurface turquoise crest glow
        float crest = smoothstep(0.05, 0.48, vWave);
        col += vec3(0.12, 0.65, 0.72) * crest * 0.32;

        // Specular sun sparkles & Fresnel sheen
        vec3 viewDir = normalize(cameraPosition - vPos);
        float fresnel = pow(1.0 - max(dot(viewDir, vNormalApprox), 0.0), 2.8);
        col = mix(col, vec3(0.78, 0.95, 1.0), fresnel * 0.52);

        vec3 halfDir = normalize(normalize(vec3(0.45, 0.58, 0.28)) + viewDir);
        float spec = pow(max(dot(vNormalApprox, halfDir), 0.0), 120.0);
        col += vec3(1.0, 0.97, 0.88) * spec * 1.15;

        // Animated caustic shimmer, island shoreline pulse & foam crests
        float c1 = sin(vPos.x * 0.8 + uTime * 2.4) * cos(vPos.z * 0.8 - uTime * 2.0);
        float shoreRing = smoothstep(0.85, 1.0, sin(dist * 1.4 - uTime * 2.6)) * nearIsland * 0.35;
        float foam = smoothstep(0.34, 0.58, vWave) + smoothstep(0.75, 0.98, c1) * 0.26 + shoreRing;
        col = mix(col, vec3(0.95, 0.99, 1.0), clamp(foam * 0.72, 0.0, 0.9));

        // Distance fade into horizon fog
        float fogF = smoothstep(48.0, 130.0, dist);
        col = mix(col, vec3(0.55, 0.84, 0.97), fogF * 0.76);
        gl_FragColor = vec4(col, 0.94);
      }
    `,
  });
  const geo = new THREE.PlaneGeometry(250, 250, 128, 128);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -1.65;
  return { mesh, uniforms };
}
