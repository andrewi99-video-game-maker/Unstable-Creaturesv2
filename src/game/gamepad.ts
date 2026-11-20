// Gamepad polling & edge detection — works from frame 1 across all menus, character select, and gameplay

export interface PadState {
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  a: boolean;
  b: boolean;
  x: boolean;
  y: boolean;
  lb: boolean;
  rb: boolean;
  lt: boolean;
  rt: boolean;
  back: boolean;
  start: boolean;
  ls: boolean;
  du: boolean;
  dd: boolean;
  dl: boolean;
  dr: boolean;
  mu: boolean;
  md: boolean;
  ml: boolean;
  mr: boolean;
}

export interface PolledPad {
  s: PadState;
  p: Partial<PadState>;
  g: Gamepad;
}

const padPrev: Record<number, PadState> = {};

function padOK(g: Gamepad | null): g is Gamepad {
  return !!g && g.connected && g.axes.length >= 2 && g.buttons.length >= 8;
}

function readPad(g: Gamepad): PadState {
  const B = (i: number) => !!(g.buttons[i] && g.buttons[i].pressed);
  const V = (i: number) => (g.buttons[i] ? g.buttons[i].value : 0);
  const stick = (x: number, y: number): [number, number] => {
    const m = Math.hypot(x, y);
    if (m < 0.2) return [0, 0];
    const k = Math.min(1, (m - 0.2) / 0.75) / m;
    return [x * k, y * k];
  };
  const [lx, ly] = stick(g.axes[0] || 0, g.axes[1] || 0);
  const [rx, ry] = stick(g.axes[2] || 0, g.axes[3] || 0);

  return {
    lx,
    ly,
    rx,
    ry,
    a: B(0),
    b: B(1),
    x: B(2),
    y: B(3),
    lb: B(4),
    rb: B(5),
    lt: B(6) || V(6) > 0.35,
    rt: B(7) || V(7) > 0.35,
    back: B(8),
    start: B(9),
    ls: B(10),
    du: B(12),
    dd: B(13),
    dl: B(14),
    dr: B(15),
    mu: B(12) || ly < -0.6,
    md: B(13) || ly > 0.6,
    ml: B(14) || lx < -0.6,
    mr: B(15) || lx > 0.6,
  };
}

export function pollGamepads(): { pads: Record<number, PolledPad>; anyPressed: boolean } {
  const out: Record<number, PolledPad> = {};
  let anyPressed = false;
  let raw: (Gamepad | null)[] = [];
  try {
    raw = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
  } catch {
    raw = [];
  }
  for (const g of raw) {
    if (!padOK(g)) continue;
    const s = readPad(g);
    const p = padPrev[g.index] || {};
    if (s.a || s.b || s.x || s.y || s.start || s.back || s.lb || s.rb || s.du || s.dd || s.dl || s.dr) {
      anyPressed = true;
    }
    out[g.index] = { s, p, g };
    padPrev[g.index] = s;
  }
  for (const k in padPrev) {
    if (!out[k as unknown as number]) delete padPrev[k as unknown as number];
  }
  return { pads: out, anyPressed };
}

export function edge(st: PolledPad, k: keyof PadState): boolean {
  return !!st.s[k] && !st.p[k];
}
