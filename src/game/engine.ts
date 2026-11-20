import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import Peer, { DataConnection } from 'peerjs';

import {
  ATK,
  BACKL,
  BOTC,
  CNAME,
  FACEL,
  FlagSnap,
  GameMode,
  HATL,
  HEADL,
  HEADS,
  KO_MS,
  KW,
  LocalSlot,
  MAPK,
  MAPN,
  MAP_THEME,
  MapKey,
  PaneInfo,
  PCL,
  RoundSummary,
  SHL,
  SceneKey,
  SolidBox,
  UISnapshot,
  WAM,
  WCD,
  WK,
  ZoneSnap,
} from './types';
import { sound } from './audio';
import { createSkyDome, setMaxAnisotropy } from './textures';
import { animateCharacter, CharacterModel, FlagVisual, mkCharacter, mkFlagVisual, mkZoneVisual, setWeaponOnCharacter, ZoneVisual } from './models';
import { buildWorlds, holdCrateFlag, setCratePos, WorldData } from './maps';
import { HazardSystem } from './hazards';
import { findWallAt, hasGroundAt, isGrabbableNear, nearLedgeAt, solidAtPoint, stepBody } from './physics';
import { edge, PadState, pollGamepads, PolledPad } from './gamepad';
import { createPeerInstance, FriendsService } from './friends';
import { BombObj, SHC, SHV, WeaponSystem } from './weapons';

interface MeState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ry: number;
  stun: number;
  ko: number;
  heldBy: number;
  holding: boolean;
  gw: boolean;
  spec: boolean;
  cd: number;
  gt: number;
  atk: string;
  atkT: number;
  em: number;
  emT: number;
  sup: SolidBox | null;
  coy: number;
  cling: { s: SolidBox; nx: number; nz: number } | null;
  hlift: boolean;
  regrip: number;
  sentLift: boolean | null;
  wcd: number;
  frz: boolean;
  jp: boolean;
  air: number;
  inWater: boolean;
  sharkHold: { x: number; y: number; z: number; ry: number; t: number } | null;
}

interface LocalCtx {
  id: number;
  k: number;
  me: MeState;
  keys: Record<string, boolean>;
  cam: { yaw: number; pitch: number };
  joy: { x: number; y: number };
  pj: { x: number; y: number };
  H: [boolean, boolean];
  pend: [ReturnType<typeof setTimeout> | null, ReturnType<typeof setTimeout> | null];
  pad: 'kb' | 'touch' | number | 'auto' | null;
  C: THREE.PerspectiveCamera;
  note: string;
  noteT: number;
  quit: number;
  a: number;
  padOn: boolean;
  fHeld: boolean;
  hint: number;
}

interface PlayerRecord {
  id: number;
  name: string;
  head: string;
  color: string;
  pants?: string;
  hat?: string;
  face?: string;
  back?: string;
  acct?: string;
  pid: string;
  bot?: boolean | number;
  skill?: number;
  ai?: Record<string, unknown>;
  b?: { x: number; y: number; z: number; vx: number; vy: number; vz: number; sup: SolidBox | null; ry: number };
  g: CharacterModel;
  conn?: DataConnection & { pls?: PlayerRecord[] };
  ck?: number;
  L?: LocalCtx;
  tx: number;
  ty: number;
  tz: number;
  try: number;
  a: number;
  pa: number;
  as?: number;
  score: number;
  team: number;
  pt?: number;
  ready: boolean;
  last: number;
  rt: number;
  alive: boolean;
  elimTime?: number;
  respawnAt?: number;
  respawnSec?: number;
  dz: number;
  air: number;
  ko: number;
  hold: { k: 'p' | 'c'; id: number } | null;
  lift?: boolean;
  hlift?: boolean;
  heldBy: number;
  heldT: number;
  wp: string | null;
  am: number;
  wcd?: number;
  ap?: number;
  stun?: number;
  frz?: boolean;
  fr?: number;
  frT?: number;
  frEnd?: number;
  fj?: number;
  fimm?: number;
  sp?: [number, number];
  mvx?: number;
  mvz?: number;
  mvy?: number;
  lx?: number;
  ly?: number;
  lz?: number;
  lt?: number;
  acd?: number;
  aT?: number;
  ak?: string;
  iceM?: THREE.Mesh | null;
  sharkHold?: { x: number; y: number; z: number; ry: number; until: number } | null;
  lastSharkDrop?: number;
}

const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

const newMe = (): MeState => ({
  x: 0,
  y: 3,
  z: 6,
  vx: 0,
  vy: 0,
  vz: 0,
  ry: 0,
  stun: 0,
  ko: 0,
  heldBy: 0,
  holding: false,
  gw: false,
  spec: false,
  cd: 0,
  gt: 0,
  atk: 'l',
  atkT: 0,
  em: 0,
  emT: 0,
  sup: null,
  coy: 0,
  cling: null,
  hlift: false,
  regrip: 0,
  sentLift: null,
  wcd: 0,
  frz: false,
  jp: false,
  air: 100,
  inWater: false,
  sharkHold: null,
});

const randCode = () => [...Array(4)].map(() => CODE_ALPHA[(Math.random() * 24) | 0]).join('');

const netErr = (e: { type?: string } | null) => {
  const t = e && e.type;
  return t === 'peer-unavailable'
    ? 'No such party (check the code)'
    : t === 'unavailable-id'
      ? 'That party code is already taken — try again'
      : t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed'
        ? 'Cannot reach the matchmaking server. Check your internet connection.'
        : t === 'browser-incompatible'
          ? 'This browser does not support online play'
          : 'Network error' + (t ? ': ' + t : '');
};

export class GameEngine {
  private container: HTMLElement;
  private R: THREE.WebGLRenderer;
  private S: THREE.Scene;
  private C: THREE.PerspectiveCamera;
  private PC: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private isSoftwareGl = false;

  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private fxLight: THREE.PointLight;
  private skyUniforms: {
    uTop: { value: THREE.Color };
    uMid: { value: THREE.Color };
    uBot: { value: THREE.Color };
    uTime: { value: number };
  };

  private world: WorldData;
  private hazards: HazardSystem;
  private weapons: WeaponSystem;
  public friends: FriendsService;

  private PD: Record<number, PolledPad> = {};
  private previewRects: ({ left: number; top: number; width: number; height: number } | null)[] = [null, null, null, null];

  private P: Record<number, PlayerRecord> = {};
  private peer: Peer | { destroy: () => void; disconnected?: boolean; destroyed?: boolean; reconnect?: () => void } | null = null;
  private hostConn: DataConnection | null = null;
  private isHost = false;
  private myId = 0;
  private code = '';
  private joined = false;
  private phase: SceneKey = 'lobby';
  private appliedThemePhase: SceneKey | null = null;
  private mode: GameMode = 'ffa';
  private nextId = 2;
  private netOn = false;
  private starting = false;
  private localMode = false;
  private diff = 1;
  private myPT = -1;

  // CTF & KOTH State + Visuals
  private flags: FlagSnap[] = [];
  private ctfBases: [[number, number, number], [number, number, number]] = [[-10, 0, 0], [10, 0, 0]];
  private zone: ZoneSnap | null = null;
  private flagVisuals: FlagVisual[] = [];
  private zoneVisual: ZoneVisual | null = null;
  private roundSummary: RoundSummary | null = null;

  private MAIN: LocalCtx;
  private cur!: LocalCtx;
  private me!: MeState;
  private keys!: Record<string, boolean>;
  private cam!: { yaw: number; pitch: number };
  private joy!: { x: number; y: number };
  private H!: [boolean, boolean];
  private pend!: [ReturnType<typeof setTimeout> | null, ReturnType<typeof setTimeout> | null];
  private locals: LocalCtx[] = [];
  private KBC: LocalCtx | null = null;

  private LM: {
    on: boolean;
    slots: (LocalSlot | null)[];
    mode: GameMode;
    bots: number;
    pv: (CharacterModel | null)[];
    net: 'off' | 'host' | 'join' | 'quick';
    code: string;
    pending: (LocalSlot & { i: number })[] | null;
    autoJoin: boolean;
  } = {
    on: false,
    slots: [null, null, null, null],
    mode: 'ffa',
    bots: -1,
    pv: [null, null, null, null],
    net: new URLSearchParams(window.location.search).get('join') ? 'join' : 'off',
    code: (new URLSearchParams(window.location.search).get('join') || '').toUpperCase(),
    pending: null,
    autoJoin: false,
  };

  private tscore: [number, number] = [0, 0];
  private rn = 0;
  private round = { over: 0, fin: false, n: 0, t0: 0 };
  private moff = 0;
  private moffSet = false;
  private banner = '';
  private bannerTimer: ReturnType<typeof setTimeout> | null = null;
  private err = '';
  private lmHint = '';

  // Xbox Menu & Pause State (4 clean top-level items: 0:Play, 1:Join Code, 2:Controls, 3:Account & Friends)
  private menuFocusIdx = 0;
  private menuSubModal: 'none' | 'controls' | 'code' | 'friends' = 'none';
  private codeChars: [string, string, string, string] = ['A', 'B', 'C', 'D'];
  private codeCursor = 0;
  private pauseOpen = false;
  private pauseIdx = 0;

  // Touch & audio
  private touchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  private lastTouch = 0;
  private jt: number | null = null;
  private ct: number | null = null;
  private j0: [number, number] = [0, 0];
  private c0: [number, number] = [0, 0];

  private listeners = new Set<(snap: UISnapshot) => void>();
  private disposed = false;
  private animId = 0;
  private hostIntervalId: ReturnType<typeof setInterval>;
  private lastFrame = performance.now();
  private sendT = 0;
  private hudT = 0;
  private lastPadPollNotify = 0;

  constructor(container: HTMLElement) {
    this.container = container;

    // 1. Renderer setup with ACES Filmic & RoomEnvironment IBL
    this.R = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.R.setSize(window.innerWidth, window.innerHeight);
    this.R.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.R.shadowMap.enabled = true;
    this.R.shadowMap.type = THREE.PCFSoftShadowMap;
    this.R.toneMapping = THREE.ACESFilmicToneMapping;
    this.R.toneMappingExposure = 1.12;
    this.R.outputColorSpace = THREE.SRGBColorSpace;
    setMaxAnisotropy(this.R);
    container.innerHTML = '';
    container.appendChild(this.R.domElement);

    const gl = this.R.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
    this.isSoftwareGl = /SwiftShader|llvmpipe|Software/i.test(String(rendererStr || ''));

    this.S = new THREE.Scene();
    this.S.background = new THREE.Color('#0f172a');
    this.S.fog = new THREE.FogExp2('#2d1e5a', 0.0058);

    const pmrem = new THREE.PMREMGenerator(this.R);
    this.S.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const { mesh: skyMesh, uniforms: skyUniforms } = createSkyDome();
    this.S.add(skyMesh);
    this.skyUniforms = skyUniforms;

    this.C = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 280);
    this.PC = new THREE.PerspectiveCamera(32, 1, 0.1, 80);

    // Three-point studio + sun lighting + dynamic impact flash light
    this.hemiLight = new THREE.HemisphereLight('#c7d2fe', '#4c1d95', 0.95);
    this.S.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight('#fff1d6', 2.55);
    this.sunLight.position.set(22, 34, 24);
    this.sunLight.castShadow = true;
    const shadowSize = this.isSoftwareGl ? 1024 : 2048;
    this.sunLight.shadow.mapSize.set(shadowSize, shadowSize);
    this.sunLight.shadow.camera.left = -28;
    this.sunLight.shadow.camera.right = 28;
    this.sunLight.shadow.camera.top = 28;
    this.sunLight.shadow.camera.bottom = -28;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.02;
    this.sunLight.shadow.radius = 2.4;
    this.S.add(this.sunLight);

    const rimLight = new THREE.DirectionalLight('#93c5fd', 1.05);
    rimLight.position.set(-20, 14, -22);
    this.S.add(rimLight);

    this.fxLight = new THREE.PointLight('#fb923c', 0, 26);
    this.S.add(this.fxLight);

    if (!this.isSoftwareGl) {
      this.composer = new EffectComposer(this.R);
      this.composer.addPass(new RenderPass(this.S, this.C));
      const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.42, 0.55, 0.8);
      this.composer.addPass(bloom);
      this.composer.addPass(new OutputPass());
    }

    // 2. Build worlds, hazards, weapons
    this.world = buildWorlds(this.S);
    this.hazards = new HazardSystem(this.S, this.world.checkerTiles);
    this.weapons = new WeaponSystem(this.S);
    this.flagVisuals = [mkFlagVisual(0), mkFlagVisual(1)];
    this.flagVisuals.forEach((fv) => {
      fv.visible = false;
      this.S.add(fv);
    });
    this.zoneVisual = mkZoneVisual(4.4);
    this.zoneVisual.visible = false;
    this.S.add(this.zoneVisual);

    this.friends = new FriendsService(
      () => this.notify(),
      () => ({
        netOn: this.netOn,
        code: this.code,
        joined: this.joined,
        phase: this.phase,
        playerCount: Object.keys(this.P).length,
        playerAccts: Object.values(this.P).map((p) => (p.acct || '').toLowerCase()),
      }),
      (inviteCode) => this.acceptInvite(inviteCode)
    );
    this.friends.initAutoSession();

    this.MAIN = this.createCtx(0, 'auto', this.C);
    this.locals = [this.MAIN];
    this.ctx(this.MAIN);

    if (this.LM.code.length >= 2) {
      const padded = (this.LM.code + 'AAAA').slice(0, 4).split('') as [string, string, string, string];
      this.codeChars = padded;
    }

    this.applyMapTheme('lobby');
    this.bindDOMEvents();

    this.hostIntervalId = setInterval(() => this.hostTick50ms(), 50);
    this.lastFrame = performance.now();
    this.animId = requestAnimationFrame((t) => this.loop(t));
    this.notify();
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animId);
    clearInterval(this.hostIntervalId);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    try {
      this.peer?.destroy();
    } catch {
      // ignore
    }
    this.R.dispose();
  }

  public subscribe(fn: (snap: UISnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.getSnapshot());
    return () => this.listeners.delete(fn);
  }

  public setPreviewRect(idx: number, rect: { left: number; top: number; width: number; height: number } | null): void {
    this.previewRects[idx] = rect;
  }

  private notify(): void {
    if (this.disposed) return;
    const snap = this.getSnapshot();
    for (const fn of this.listeners) fn(snap);
  }

  public getSnapshot(): UISnapshot {
    const padKeys = Object.keys(this.PD);
    const v = this.layout(this.locals.length === 3 ? 4 : this.locals.length);
    const panes: PaneInfo[] = this.localMode
      ? this.locals.map((L, i) => {
          const p = this.P[L.id];
          const rect = v[i] || v[0];
          return {
            id: L.id,
            name: p ? p.name : `P${i + 1}`,
            color: p ? p.color : SHL[i % SHL.length],
            team: p ? p.team : -1,
            alive: p ? p.alive : false,
            dz: p ? Math.min(100, p.dz) : 0,
            air: Math.round(p ? p.air : L.me.air),
            wp: p ? p.wp : null,
            am: p ? p.am : 0,
            note: L.noteT > 0 ? L.note : '',
            rect,
          };
        })
      : [];

    const ps = Object.values(this.P);
    const onlineFriends = this.friends.data.friends;

    return {
      screen: !this.joined ? (this.LM.on ? 'local' : 'menu') : 'game',
      phase: this.phase,
      mode: this.mode,
      code: this.code,
      isHost: this.isHost,
      netOn: this.netOn,
      localMode: this.localMode,
      roundNum: this.rn,
      tscore: [this.tscore[0], this.tscore[1]],
      banner: this.banner,
      hazardStatus: this.hazards.statusLabel,
      hazardLevel: this.hazards.level,
      err: this.err,
      lmHint: this.lmHint,
      diff: this.diff,
      slots: this.LM.slots.map((s) => (s ? { ...s } : null)),
      lmMode: this.LM.mode,
      lmBots: this.LM.bots,
      lmBotsEffective: this.botsN(),
      lmNet: this.LM.net,
      lmCode: this.LM.code,
      lmAllReady: this.lmAllReady(),
      kbJoined: this.LM.slots.some((s) => s && s.pad === 'kb'),
      players: ps.map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        team: p.team,
        alive: p.alive,
        respawnSec: p.respawnAt ? Math.max(0, Math.ceil((p.respawnAt - Date.now()) / 1000)) : 0,
        dz: Math.min(100, p.dz),
        air: Math.round(p.air),
        wp: p.wp,
        am: p.am,
        color: p.color,
        bot: !!p.bot,
      })),
      flags: this.flags.map((f) => ({ ...f })),
      zone: this.zone ? { ...this.zone } : null,
      roundSummary: this.roundSummary,
      myId: this.myId,
      myTeamPref: this.myPT,
      muted: sound.muted,
      micOK: sound.micOK,
      panes,
      touchDevice: this.touchDevice && !window.matchMedia('(pointer:fine)').matches,
      padConnected: padKeys.length > 0,
      padCount: padKeys.length,
      menuFocusIdx: this.menuFocusIdx,
      menuSubModal: this.menuSubModal,
      codeChars: [...this.codeChars] as [string, string, string, string],
      codeCursor: this.codeCursor,
      pauseOpen: this.pauseOpen,
      pauseIdx: this.pauseIdx,
      acctUser: this.friends.user,
      acctLoggedIn: !this.friends.isGuest,
      cloudSignedIn: !!this.friends.cloudUid,
      cloudBusy: this.friends.cloudBusy,
      cloudEmail: this.friends.cloudEmail,
      savedUsers: [...this.friends.savedUsers],
      friendsOpen: this.menuSubModal === 'friends',
      friendsStatus: { ...this.friends.st },
      friendsInv: { ...this.friends.inv },
      friendsMsg: this.friends.msg,
      friendsList: [...onlineFriends],
      reqIn: [...this.friends.data.reqIn],
      reqOut: [...this.friends.data.reqOut],
      presOK: this.friends.presOK,
      toasts: [...this.friends.toasts],
    };
  }

  // ---------------- Theme & World Switching ----------------
  private waterLevel(ph: SceneKey = this.phase): number {
    return ph === 'arena0' ? -1.65 : ph === 'arena1' ? -0.82 : -999;
  }

  private applyMapTheme(ph: SceneKey): void {
    if (this.appliedThemePhase === ph) return;
    this.appliedThemePhase = ph;
    const th = MAP_THEME[ph] || MAP_THEME.lobby;
    this.skyUniforms.uTop.value.set(th.skyTop);
    this.skyUniforms.uMid.value.set(th.skyMid);
    this.skyUniforms.uBot.value.set(th.skyBot);
    this.S.background = new THREE.Color(th.skyMid);
    this.S.fog = new THREE.FogExp2(th.fog, th.water ? 0.0044 : 0.0058);
    this.sunLight.color.set(th.sunColor);
    this.hemiLight.color.set(th.hemiSky);
    this.hemiLight.groundColor.set(th.hemiGround);
  }

  private createCtx(id: number, pad: LocalCtx['pad'], C: THREE.PerspectiveCamera): LocalCtx {
    return {
      id,
      k: 0,
      me: newMe(),
      keys: {},
      cam: { yaw: 0, pitch: 0.45 },
      joy: { x: 0, y: 0 },
      pj: { x: 0, y: 0 },
      H: [false, false],
      pend: [null, null],
      pad,
      C,
      note: '',
      noteT: 0,
      quit: 0,
      a: 0,
      padOn: false,
      fHeld: false,
      hint: 0,
    };
  }

  private ctx(L: LocalCtx): void {
    this.cur = L;
    this.me = L.me;
    this.keys = L.keys;
    this.cam = L.cam;
    this.joy = L.joy;
    this.H = L.H;
    this.pend = L.pend;
    this.myId = L.id;
  }

  private withCtx<T>(L: LocalCtx, f: () => T): T {
    const p = this.cur;
    this.ctx(L);
    try {
      return f();
    } finally {
      this.ctx(p);
    }
  }

  public say(t: string, ms = 1800): void {
    this.banner = t;
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => {
      this.banner = '';
      this.notify();
    }, ms);
    this.notify();
  }

  private psay(t: string, ms: number): void {
    if (this.localMode) {
      this.cur.note = t;
      this.cur.noteT = ms / 1000;
    } else {
      this.say(t, ms);
    }
  }

  // ---------------- Public UI Actions ----------------
  public setDifficulty(d: number): void {
    this.diff = Math.max(1, Math.min(3, d));
    sound.beep(520 + this.diff * 90, 0.06, 'triangle');
    this.notify();
  }

  public setMenuFocus(idx: number): void {
    this.menuFocusIdx = idx;
    this.notify();
  }

  public openSubModal(m: 'none' | 'controls' | 'code' | 'friends'): void {
    sound.unlock();
    this.menuSubModal = m;
    sound.beep(m === 'none' ? 320 : 580, 0.06, 'triangle');
    this.notify();
  }

  public updateCodeInput(val: string): void {
    const clean = val.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    this.LM.code = clean;
    for (let i = 0; i < 4; i++) {
      this.codeChars[i] = clean[i] || this.codeChars[i] || 'A';
    }
    this.notify();
  }

  public submitCodeModal(padIdx: number | null = null): void {
    const code = this.LM.code.length >= 2 ? this.LM.code : this.codeChars.join('');
    this.LM.code = code;
    this.menuSubModal = 'none';
    this.begin('join', padIdx);
  }

  public begin(kind: 'party' | 'solo' | 'local' | 'create' | 'quick' | 'join', padIdx: number | null = null): void {
    if (this.starting) return;
    sound.unlock();
    this.err = '';
    this.menuSubModal = 'none';
    this.starting = true;
    sound.ensureMicStreamFallback();

    this.hostLocal();
    const netMap = { party: 'off', solo: 'off', local: 'off', create: 'host', quick: 'quick', join: 'join' } as const;
    this.LM.net = netMap[kind];
    if (kind === 'join' && !this.LM.code) {
      this.LM.code = this.codeChars.join('');
    }
    if (kind !== 'local') {
      const targetPad =
        padIdx !== null ? padIdx : Object.keys(this.PD).length > 0 ? Number(Object.keys(this.PD)[0]) : this.touchDevice ? 'touch' : 'kb';
      this.lmJoin(targetPad);
    }
    this.notify();
  }

  public lmJoin(pad: 'kb' | 'touch' | number): void {
    if (this.LM.slots.some((s) => s && s.pad === pad)) return;
    const i = this.LM.slots.findIndex((s) => !s);
    if (i < 0) return;
    const used = this.LM.slots.filter(Boolean).map((s) => s!.head);
    const head = HEADL.find((h) => !used.includes(h)) || HEADL[0];
    this.LM.slots[i] = {
      pad,
      head,
      hat: 'none',
      face: 'none',
      back: 'none',
      color: SHL[i],
      pants: PCL[0],
      row: 0,
      team: -1,
      ready: false,
    };
    this.buildPv(i);
    sound.beep(660, 0.1, 'triangle');
    this.notify();
  }

  public lmLeave(i: number): void {
    this.LM.slots[i] = null;
    this.buildPv(i);
    sound.beep(300, 0.1, 'triangle');
    this.notify();
  }

  public lmMove(i: number, d: number): void {
    const s = this.LM.slots[i];
    if (s && !s.ready) {
      s.row = (s.row + d + 7) % 7;
      sound.beep(480, 0.03, 'triangle');
      this.notify();
    }
  }

  public lmChange(i: number, d: number, row?: number): void {
    const s = this.LM.slots[i];
    if (!s || s.ready) return;
    if (row !== undefined) s.row = row;
    const cyc = <T,>(a: T[], v: T) => a[(a.indexOf(v) + d + a.length) % a.length];
    if (s.row === 0) {
      const used = this.LM.slots.filter((q, j) => q && j !== i).map((q) => q!.head);
      let hd = s.head;
      let n = 0;
      do {
        hd = cyc(HEADL, hd);
        n++;
      } while (used.includes(hd) && n < HEADL.length);
      s.head = hd;
    } else if (s.row === 1) s.hat = cyc(HATL, s.hat);
    else if (s.row === 2) s.face = cyc(FACEL, s.face);
    else if (s.row === 3) s.back = cyc(BACKL, s.back);
    else if (s.row === 4) s.color = cyc(SHL, s.color);
    else if (s.row === 5) s.pants = cyc(PCL, s.pants);
    else s.team = cyc([-1, 0, 1], s.team);
    this.buildPv(i);
    sound.beep(520, 0.05, 'triangle');
    this.notify();
  }

  public lmReady(i: number, v: boolean): void {
    const s = this.LM.slots[i];
    if (!s) return;
    s.ready = v;
    sound.beep(v ? 880 : 440, 0.08, 'triangle');
    this.notify();
    if (v && this.LM.autoJoin && this.LM.net === 'join' && this.lmAllReady()) {
      this.LM.autoJoin = false;
      this.lmStart();
    }
  }

  public lmMode(): void {
    const modes: GameMode[] = ['ffa', 'team', 'ctf', 'koth'];
    this.LM.mode = modes[(modes.indexOf(this.LM.mode) + 1) % modes.length];
    sound.beep(600, 0.05, 'triangle');
    this.notify();
  }

  public lmBots(): void {
    this.LM.bots = this.LM.bots >= 4 ? -1 : this.LM.bots + 1;
    sound.beep(600, 0.05, 'triangle');
    this.notify();
  }

  public lmNet(): void {
    if (this.starting) return;
    const cycle: ('off' | 'host' | 'join' | 'quick')[] = ['off', 'host', 'join', 'quick'];
    this.LM.net = cycle[(cycle.indexOf(this.LM.net) + 1) % cycle.length];
    sound.beep(600, 0.05, 'triangle');
    this.notify();
  }

  public setLmCode(v: string): void {
    this.LM.code = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    this.notify();
  }

  public backToMainMenu(): void {
    try {
      (this.peer as Peer)?.destroy?.();
    } catch {
      // ignore
    }
    this.peer = null;
    this.hostConn = null;
    this.LM.on = false;
    this.joined = false;
    this.netOn = false;
    this.localMode = false;
    this.starting = false;
    this.pauseOpen = false;
    this.roundSummary = null;
    this.flags = [];
    this.zone = null;
    this.syncObjectiveVisuals(0);
    this.phase = 'lobby';
    this.applyMapTheme('lobby');
    this.hazards.reset(Date.now());
    this.weapons.clearAll();
    for (const id of Object.keys(this.P)) {
      this.S.remove(this.P[+id].g);
      delete this.P[+id];
    }
    this.LM.pv.forEach((g, i) => {
      if (g) {
        this.disposeG(g);
        this.LM.pv[i] = null;
      }
    });
    this.locals = [this.MAIN];
    this.ctx(this.MAIN);
    if (document.pointerLockElement === this.R.domElement) {
      document.exitPointerLock?.();
    }
    this.notify();
  }

  public togglePause(open?: boolean): void {
    if (!this.joined) return;
    this.pauseOpen = open !== undefined ? open : !this.pauseOpen;
    this.pauseIdx = 0;
    if (this.pauseOpen && document.pointerLockElement === this.R.domElement) {
      document.exitPointerLock?.();
    }
    sound.beep(this.pauseOpen ? 360 : 540, 0.06, 'triangle');
    this.notify();
  }

  public toggleMute(): void {
    const m = sound.toggleMute();
    this.say(m ? 'Muted' : 'Mic On', 800);
    this.notify();
  }

  public setTeam(t: number): void {
    this.myPT = t;
    this.up({ t: 'tm', team: t });
    this.notify();
  }

  // ---------------- Character Previews ----------------
  private botsN(): number {
    const h = this.LM.slots.filter(Boolean).length;
    if (this.LM.net === 'host' || this.LM.net === 'quick') {
      return Math.max(0, Math.min(this.LM.bots < 0 ? 0 : this.LM.bots, 8 - h));
    }
    let b = this.LM.bots < 0 ? (h < 2 ? 3 : 0) : this.LM.bots;
    b = Math.max(b, 2 - h);
    return Math.max(0, Math.min(b, 8 - h));
  }

  private lmAllReady(): boolean {
    return this.LM.slots.some(Boolean) && this.LM.slots.every((s) => !s || s.ready);
  }

  private disposeG(g: THREE.Object3D): void {
    this.S.remove(g);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && m.geometry.dispose) m.geometry.dispose();
    });
  }

  private buildPv(i: number): void {
    const s = this.LM.slots[i];
    const old = this.LM.pv[i];
    if (old) this.disposeG(old);
    this.LM.pv[i] = null;
    if (!s) return;
    const g = mkCharacter({
      name: CNAME[s.head],
      head: s.head,
      hat: s.hat,
      face: s.face,
      back: s.back,
      color: s.color,
      pants: s.pants,
    });
    g.position.set(600 + i * 40, 0, 600);
    this.S.add(g);
    this.LM.pv[i] = g;
  }

  private openLocal(): void {
    for (const id of Object.keys(this.P)) {
      this.S.remove(this.P[+id].g);
      delete this.P[+id];
    }
    this.weapons.clearAll();
    this.hazards.reset(Date.now());
    this.locals = [];
    this.KBC = null;
    this.joined = false;
    this.pauseOpen = false;
    this.LM.on = true;
    this.mode = 'ffa';
    this.phase = 'lobby';
    this.applyMapTheme('lobby');
    this.ctx(this.MAIN);
    this.LM.slots.forEach((s) => {
      if (s) s.ready = false;
    });
    this.LM.slots.forEach((_, i) => this.buildPv(i));
    this.banner = '';
    this.notify();
  }

  private hostLocal(): void {
    this.starting = false;
    try {
      (this.peer as Peer)?.destroy?.();
    } catch {
      // ignore
    }
    this.peer = { destroy() {} };
    this.isHost = true;
    this.code = 'LOCAL';
    this.localMode = true;
    this.nextId = 5;
    this.openLocal();
  }

  public lmStart(): void {
    if (!this.LM.on || !this.lmAllReady() || this.starting) return;
    if (this.LM.net === 'host') {
      this.lmHostNet();
      return;
    }
    if (this.LM.net === 'join') {
      this.lmJoinNet();
      return;
    }
    if (this.LM.net === 'quick') {
      this.lmQuick();
      return;
    }
    this.buildLocalGame(false);
  }

  private newLocalCtx(s: LocalSlot, id: number, k: number): LocalCtx {
    if (s.pad === 'touch') {
      Object.assign(this.MAIN, {
        id,
        k,
        pad: s.pad,
        me: newMe(),
        keys: {},
        cam: { yaw: 0, pitch: 0.45 },
        joy: { x: 0, y: 0 },
        pj: { x: 0, y: 0 },
        H: [false, false] as [boolean, boolean],
        pend: [null, null],
        note: '',
        noteT: 0,
        quit: 0,
        a: 0,
        padOn: false,
        fHeld: false,
        hint: 0,
      });
      return this.MAIN;
    }
    const L = this.createCtx(id, s.pad, new THREE.PerspectiveCamera(65, 1, 0.1, 250));
    L.k = k;
    return L;
  }

  private buildLocalGame(online: boolean): void {
    const ss: (LocalSlot & { i: number })[] = [];
    this.LM.slots.forEach((s, i) => {
      if (s) ss.push({ ...s, i });
    });
    const nb = this.botsN();
    for (const id of Object.keys(this.P)) {
      this.S.remove(this.P[+id].g);
      delete this.P[+id];
    }
    this.LM.pv.forEach((g, i) => {
      if (g) {
        this.disposeG(g);
        this.LM.pv[i] = null;
      }
    });
    this.nextId = 5;
    this.locals = [];
    const peerId = (this.peer as Peer)?.id || '';
    ss.forEach((s, k) => {
      const id = k + 1;
      const L = this.newLocalCtx(s, id, k);
      const p = this.addP({
        id,
        name: CNAME[s.head],
        head: s.head,
        hat: s.hat,
        face: s.face,
        back: s.back,
        color: s.color,
        pants: s.pants,
        acct: this.friends.user,
        pid: online ? peerId : 'local' + id,
      });
      p.L = L;
      p.pt = s.team;
      p.ready = true;
      L.me.x = (k - (ss.length - 1) / 2) * 3;
      L.me.z = 6;
      p.g.position.set(L.me.x, 3, 6);
      p.tx = L.me.x;
      p.ty = 3;
      p.tz = 6;
      this.locals.push(L);
    });
    this.KBC = this.locals.find((L) => L.pad === 'kb') || null;
    this.ctx(this.locals[0]);
    this.phase = 'lobby';
    this.applyMapTheme('lobby');
    for (let i = 0; i < nb; i++) this.addBot();
    this.LM.on = false;
    this.joined = true;
    if (online) setTimeout(() => this.friends.flushInvites(), 400);
    if (!online) this.startMatch(this.LM.mode);
    this.notify();
  }

  private makeLocals(ss: (LocalSlot & { i: number })[], ids: number[]): void {
    this.locals = [];
    ss.forEach((s, k) => {
      const L = this.newLocalCtx(s, ids[k], k);
      L.me.x = (k - (ss.length - 1) / 2) * 3;
      L.me.z = 6;
      this.locals.push(L);
    });
    this.KBC = this.locals.find((L) => L.pad === 'kb') || null;
    this.ctx(this.locals[0]);
  }

  // ---------------- Networking (PeerJS) ----------------
  private giveUp(msg: string): void {
    if (this.LM.on) {
      this.lmHint = msg;
      this.isHost = true;
      this.peer = { destroy() {} };
      this.LM.pending = null;
    } else {
      this.err = msg;
    }
    this.starting = false;
    this.notify();
  }

  private setupPeerHandlers(): void {
    const pr = this.peer as Peer;
    if (!pr || !pr.on) return;
    pr.on('disconnected', () => {
      setTimeout(() => {
        if (pr === this.peer && !pr.destroyed && pr.disconnected) {
          try {
            pr.reconnect();
          } catch {
            // ignore
          }
        }
      }, 800);
    });
    pr.on('call', (c) => {
      try {
        if (sound.micStream) {
          c.answer(sound.micStream);
          c.on('stream', (s) => sound.attachRemoteAudio(c.peer, s));
        }
      } catch {
        // ignore
      }
    });
    pr.on('connection', (c) => {
      const conn = c as DataConnection & { pls?: PlayerRecord[] };
      if (!this.isHost) {
        conn.close();
        return;
      }
      conn.on('data', (raw) => {
        const m = raw as Record<string, unknown>;
        if (m.t === 'join') {
          if (conn.pls) return;
          const list = (Array.isArray(m.ps) && m.ps.length ? m.ps : [m]).slice(0, 4) as Record<string, string | number>[];
          Object.values(this.P).forEach((q) => {
            if (q.conn && q.pid === m.pid) this.dropP(q);
          });
          if (this.phase !== 'lobby') {
            conn.send({ t: 'err', msg: 'Match in progress' });
            return;
          }
          if (Object.values(this.P).filter((q) => !q.bot).length + list.length > 8) {
            conn.send({ t: 'err', msg: 'Party full' });
            return;
          }
          const extra = Object.keys(this.P).length + list.length - 8;
          Object.values(this.P)
            .filter((q) => q.bot)
            .slice(0, Math.max(0, extra))
            .forEach((b) => this.dropP(b));

          const humans = new Set(Object.values(this.P).filter((q) => !q.bot).map((q) => q.head));
          const ps = list.map((o, i) => {
            const reqHead = String(o.head || 'dog');
            const hd = HEADS[reqHead] && !humans.has(reqHead) ? reqHead : HEADL.find((x) => !humans.has(x)) || 'dog';
            humans.add(hd);
            Object.values(this.P)
              .filter((q) => q.bot && q.head === hd)
              .forEach((b) => this.dropP(b));
            const p = this.addP({
              id: this.nextId++,
              name: CNAME[hd],
              head: hd,
              color: String(o.color || SHL[i % SHL.length]),
              pants: String(o.pants || PCL[0]),
              hat: String(o.hat || 'none'),
              face: String(o.face || 'none'),
              back: String(o.back || 'none'),
              acct: String(m.ac || '').slice(0, 14),
              pid: String(m.pid || ''),
            });
            p.conn = conn;
            p.ck = i;
            if (o.pt === 0 || o.pt === 1) p.pt = o.pt;
            return p;
          });
          conn.pls = ps;
          conn.send({ t: 'welcome', id: ps[0].id, ids: ps.map((p) => p.id), code: this.code, players: Object.values(this.P).map((p) => this.pub(p)) });
          const others = new Set<DataConnection>();
          Object.values(this.P).forEach((q) => {
            if (q.conn && q.conn !== conn) others.add(q.conn);
          });
          others.forEach((cc) => ps.forEach((p) => cc.send({ t: 'joined', p: this.pub(p) })));
          ps.forEach((p) => {
            if (p.pt === 0 || p.pt === 1) this.bcast({ t: 'tp', id: p.id, team: p.pt });
          });
        } else if (conn.pls) {
          const p = conn.pls[(m.k as number) || 0];
          if (p) this.hostMsg(p, m);
        }
      });
      conn.on('close', () => {
        if (conn.pls) conn.pls.forEach((p) => this.dropP(p));
      });
    });
  }

  private hostNetAs(c: string, fail: (e: { type?: string }) => void): void {
    const pr = (this.peer = createPeerInstance('unstable-' + c));
    let done = false;
    this.setupPeerHandlers();
    const tm = setTimeout(() => {
      if (pr === this.peer && !done) {
        done = true;
        try {
          pr.destroy();
        } catch {
          // ignore
        }
        fail({ type: 'network' });
      }
    }, 12000);
    pr.on('open', () => {
      clearTimeout(tm);
      if (pr !== this.peer || done) return;
      done = true;
      this.isHost = true;
      this.code = c;
      this.netOn = true;
      this.starting = false;
      this.buildLocalGame(true);
    });
    pr.on('error', (e: { type?: string }) => {
      if (pr !== this.peer || done) return;
      done = true;
      clearTimeout(tm);
      try {
        pr.destroy();
      } catch {
        // ignore
      }
      fail(e);
    });
  }

  private joinAs(c: string, fail: ((e: { type?: string }) => void) | null, ps: Record<string, unknown>[]): void {
    this.code = c;
    const pr = (this.peer = createPeerInstance());
    let connected = false;
    let failed = false;
    let tm: ReturnType<typeof setTimeout> | null = null;
    this.setupPeerHandlers();

    const bad = (msg: string, e: { type?: string }) => {
      if (failed) return;
      failed = true;
      if (tm) clearTimeout(tm);
      this.hostConn = null;
      try {
        pr.destroy();
      } catch {
        // ignore
      }
      if (fail) fail(e);
      else this.giveUp(msg);
    };

    tm = setTimeout(() => {
      if (pr === this.peer && !this.joined) {
        bad(
          connected ? 'Could not connect to that party. Check the code and try again.' : netErr({ type: 'network' }),
          { type: 'timeout' }
        );
      }
    }, 20000);

    pr.on('open', () => {
      if (pr !== this.peer || connected) return;
      connected = true;
      const hc = (this.hostConn = pr.connect('unstable-' + c, { reliable: true, serialization: 'json' }));
      hc.on('open', () => {
        if (hc === this.hostConn) {
          hc.send({ t: 'join', pid: pr.id, ac: this.friends.user, ps });
        }
      });
      hc.on('data', (raw) => {
        const m = raw as Record<string, unknown>;
        if (hc !== this.hostConn) return;
        if (m.t === 'err') {
          hc.close();
          bad(String(m.msg || 'Join failed'), { type: 'err' });
        } else {
          if (m.t === 'welcome' && tm) clearTimeout(tm);
          this.netIn(m);
        }
      });
      hc.on('error', (e: { type?: string }) => {
        if (hc === this.hostConn && !this.joined) bad('Connection error: ' + (e?.type || e), e);
      });
      hc.on('close', () => {
        if (hc === this.hostConn && this.joined) {
          this.friends.pushToast('The host left the party', 5000);
          this.backToMainMenu();
        }
      });
    });

    pr.on('error', (e: { type?: string }) => {
      if (pr !== this.peer || this.joined || failed) return;
      bad(e?.type === 'peer-unavailable' ? 'No such party (check the code)' : netErr(e), e);
    });
  }

  private guestPs(ss: LocalSlot[]) {
    return ss.map((s) => ({ head: s.head, hat: s.hat, face: s.face, back: s.back, color: s.color, pants: s.pants, pt: s.team }));
  }

  private async lmHostNet(): Promise<void> {
    this.starting = true;
    this.lmHint = 'Opening your party…';
    this.notify();
    await sound.requestMic();
    const tryOpen = (n: number) => {
      if (n > 5) {
        this.giveUp('Could not open a party (check your connection)');
        return;
      }
      const c = randCode();
      this.hostNetAs(c, (e) => {
        if (e.type === 'unavailable-id') tryOpen(n + 1);
        else this.giveUp('Could not open a party: ' + netErr(e));
      });
    };
    tryOpen(0);
  }

  private async lmQuick(): Promise<void> {
    this.starting = true;
    this.lmHint = 'Looking for a public party…';
    this.notify();
    await sound.requestMic();
    const ss: (LocalSlot & { i: number })[] = [];
    this.LM.slots.forEach((s, i) => {
      if (s) ss.push({ ...s, i });
    });
    const tryN = (n: number) => {
      if (n > 6) {
        this.giveUp('All public parties are busy');
        return;
      }
      this.hostNetAs('Q' + n, (e) => {
        if (e && e.type && e.type !== 'unavailable-id') {
          this.giveUp('Could not start Quick Play: ' + netErr(e));
          return;
        }
        this.LM.pending = ss;
        this.isHost = false;
        this.joinAs('Q' + n, () => tryN(n + 1), this.guestPs(ss));
      });
    };
    tryN(1);
  }

  private async lmJoinNet(): Promise<void> {
    const c = this.LM.code.trim().toUpperCase();
    if (c.length < 2) {
      this.lmHint = 'Type the party code first';
      this.notify();
      return;
    }
    this.starting = true;
    this.lmHint = `Joining party ${c}…`;
    this.notify();
    const ss: (LocalSlot & { i: number })[] = [];
    this.LM.slots.forEach((s, i) => {
      if (s) ss.push({ ...s, i });
    });
    this.LM.pending = ss;
    await sound.requestMic();
    this.isHost = false;
    this.joinAs(c, null, this.guestPs(ss));
  }

  private acceptInvite(c: string): void {
    if (this.joined && !this.LM.on) {
      this.friends.pushToast('Leave your current match first, then join the invite', 3500);
      return;
    }
    if (!this.LM.on) this.begin('join');
    this.LM.net = 'join';
    this.LM.autoJoin = true;
    this.LM.code = c.toUpperCase();
    this.lmHint = 'Pick your creature and press READY — you will join right away';
    this.notify();
  }

  // ---------------- Players & Messaging ----------------
  private pub(p: PlayerRecord) {
    return {
      id: p.id,
      name: p.name,
      head: p.head,
      color: p.color,
      pants: p.pants,
      hat: p.hat,
      face: p.face,
      back: p.back,
      acct: p.acct,
      pid: p.pid,
      bot: p.bot ? 1 : 0,
    };
  }

  private addP(o: Partial<PlayerRecord> & { id: number; name: string; head: string; color: string; pid: string }): PlayerRecord {
    if (this.P[o.id]) return this.P[o.id];
    const g = mkCharacter({
      name: o.name,
      head: o.head,
      color: o.color,
      pants: o.pants,
      hat: o.hat,
      face: o.face,
      back: o.back,
    });
    this.S.add(g);
    const rec: PlayerRecord = {
      ...o,
      g,
      tx: 0,
      ty: 3,
      tz: 6,
      try: 0,
      a: 0,
      pa: 0,
      score: 0,
      team: -1,
      ready: false,
      last: 0,
      rt: 0,
      alive: true,
      dz: 0,
      air: 100,
      ko: 0,
      hold: null,
      heldBy: 0,
      heldT: 0,
      wp: null,
      am: 0,
    };
    this.P[o.id] = rec;
    return rec;
  }

  private dropP(p: PlayerRecord): void {
    if (!this.P[p.id]) return;
    if (this.isHost) {
      this.rel(p);
      const hb = this.P[p.heldBy];
      if (hb) this.rel(hb);
      this.world.crates[this.phase].forEach((c) => {
        if (c.held === p.id) holdCrateFlag(c, 0);
      });
    }
    this.S.remove(p.g);
    if (p.iceM) this.S.remove(p.iceM);
    delete this.P[p.id];
    sound.dropRemoteAudio(p.pid);
    if (this.isHost) this.bcast({ t: 'left', id: p.id });
    this.notify();
  }

  private to(p: PlayerRecord, m: Record<string, unknown>, b = false): void {
    if (p.bot) {
      this.botMsg(p, m);
      return;
    }
    if (p.L) {
      if (m.t === 's' && p.L !== this.locals[0]) return;
      this.withCtx(p.L, () => this.onMsg(m));
    } else if (!p.conn) {
      this.withCtx(this.MAIN, () => this.onMsg(m));
    } else if (p.conn.open) {
      p.conn.send(b ? m : { ...m, k: p.ck || 0 });
    }
  }

  private bcast(m: Record<string, unknown>): void {
    const sent = new Set<DataConnection>();
    Object.values(this.P).forEach((p) => {
      if (p.conn && !p.L && !p.bot) {
        if (sent.has(p.conn)) return;
        sent.add(p.conn);
      }
      this.to(p, m, true);
    });
  }

  private up(m: Record<string, unknown>): void {
    if (this.isHost) {
      const mp = this.P[this.myId];
      if (mp) this.hostMsg(mp, m);
    } else if (this.hostConn && this.hostConn.open) {
      this.hostConn.send(this.cur.k ? { ...m, k: this.cur.k } : m);
    }
  }

  private netIn(m: Record<string, unknown>): void {
    if (m.t === 'welcome' || (this.locals.length < 2 && m.k === undefined)) {
      this.onMsg(m);
      return;
    }
    if (m.k !== undefined) {
      this.withCtx(this.locals[(m.k as number)] || this.locals[0], () => this.onMsg(m));
      return;
    }
    if (m.t === 's' || m.t === 'fx') {
      this.withCtx(this.locals[0], () => this.onMsg(m));
      return;
    }
    this.locals.forEach((L) => this.withCtx(L, () => this.onMsg(m)));
  }

  private onMsg(m: Record<string, unknown>): void {
    const t = m.t as string;
    if (t === 'welcome') {
      Object.values(this.P).forEach((p) => this.S.remove(p.g));
      for (const k of Object.keys(this.P)) delete this.P[+k];
      this.code = String(m.code || '');
      this.starting = false;
      (m.players as (PlayerRecord & { bot?: number })[]).forEach((p) => this.addP(p));
      if (this.LM.pending) {
        const gids = (m.ids as number[]) || [m.id as number];
        this.LM.pending.forEach((s, k) => {
          const p = this.P[gids[k]];
          if (p && p.head !== s.head) this.say(`${CNAME[s.head]} was taken — you are ${p.name}!`, 4000);
        });
        this.makeLocals(this.LM.pending, gids);
        this.LM.pending = null;
        this.netOn = true;
        this.locals.forEach((L) => {
          const p = this.P[L.id];
          if (p) {
            p.ready = true;
            p.g.position.set(L.me.x, 3, 6);
            p.tx = L.me.x;
            p.ty = 3;
            p.tz = 6;
          }
        });
        this.LM.on = false;
        this.joined = true;
      } else {
        this.MAIN.id = this.myId = m.id as number;
        this.joined = true;
        this.LM.on = false;
      }
      const mine = new Set(this.locals.map((L) => L.id));
      const called: Record<string, number> = {};
      Object.values(this.P).forEach((p) => {
        if (!mine.has(p.id) && !p.bot && p.pid && !called[p.pid]) {
          called[p.pid] = 1;
          const pr = this.peer as Peer;
          try {
            if (pr?.call && sound.micStream) {
              const call = pr.call(p.pid, sound.micStream);
              call?.on('stream', (s) => sound.attachRemoteAudio(p.pid, s));
            }
          } catch {
            // ignore
          }
        }
      });
      this.notify();
    } else if (t === 'joined') {
      this.addP(m.p as PlayerRecord);
      this.notify();
    } else if (t === 'left') {
      const p = this.P[m.id as number];
      if (p) {
        this.S.remove(p.g);
        if (p.iceM) this.S.remove(p.iceM);
        delete this.P[m.id as number];
        sound.dropRemoteAudio(p.pid);
        this.notify();
      }
    } else if (t === 's') {
      this.tscore = (m.ts as [number, number]) || this.tscore;
      if (!this.isHost) {
        const tg = (m.mt as number) - performance.now() / 1000;
        if (!this.moffSet) {
          this.moff = tg;
          this.moffSet = true;
        } else {
          this.moff += (tg - this.moff) * 0.1;
        }
      }
      const isLoc = (id: number) => this.locals.some((L) => L.id === id);
      (m.p as number[][]).forEach(([id, x, y, z, ry, a, sc, dz, wp, am, rs, air]) => {
        const p = this.P[id];
        if (!p) return;
        p.score = sc;
        p.respawnSec = rs || 0;
        if (typeof air === 'number') {
          p.air = air;
          const loc = this.locals.find((L) => L.id === id);
          if (loc) loc.me.air = air;
        }
        if (this.isHost) return;
        p.dz = dz;
        p.wp = KW[wp] || null;
        p.am = am;
        if (!isLoc(id)) {
          p.tx = x;
          p.ty = y;
          p.tz = z;
          p.try = ry;
          p.a = a;
          if (!p.ready) {
            p.g.position.set(x, y, z);
            p.ready = true;
          }
        }
      });
      if (!this.isHost && m.c) {
        (m.c as number[][]).forEach((v, i) => {
          const c = this.world.crates[this.phase][i];
          if (c) {
            c.tx = v[0];
            c.ty = v[1];
            c.tz = v[2];
            if (c.held !== v[3] || !!c.lift !== !!v[4]) holdCrateFlag(c, v[3], !!v[4]);
          }
        });
      }
      if (m.k) {
        (m.k as number[]).forEach((f, i) => {
          const u = this.world.pk[this.phase][i];
          if (u) u.m.visible = !!f;
        });
      }
      if (!this.isHost) {
        if (Array.isArray(m.fl)) {
          this.flags = m.fl as FlagSnap[];
        }
        this.zone = (m.zn as ZoneSnap | null) || null;
      }
      if (m.j) this.weapons.syncProj(m.j as [number, number, number, number, number, number, number, number][]);
      if (m.bm) this.weapons.syncBombs(m.bm as [number, number, number, number, number, number, number, number][]);
      if (m.bn) this.weapons.syncBananas(m.bn as [number, number, number, number][]);
      if (m.hl) this.weapons.syncHoles(m.hl as [number, number, number, number, number, number][]);
      if (!this.isHost && m.hz) {
        this.hazards.syncFromSnapshot(m.hz as never, 0.05, Date.now(), performance.now() / 1000);
      }
      if (m.fz && !this.isHost) {
        const fz = m.fz as number[];
        Object.values(this.P).forEach((p) => {
          p.frz = fz.includes(p.id);
        });
      }
    } else if (t === 'hit') {
      if (this.me.spec) return;
      this.me.vx = m.vx as number;
      this.me.vz = m.vz as number;
      this.me.vy = m.vy as number;
      this.me.sup = null;
      this.me.cling = null;
      if (this.me.ko <= 0) this.me.stun = 0.35;
      this.weapons.burst(this.me.x, this.me.y, this.me.z);
      sound.beep(120, 0.25, 'sawtooth');
      this.rumble(220, 0.95, 0.7);
    } else if (t === 'blow' || t === 'pull') {
      if (this.me.spec) return;
      this.me.vx = m.vx as number;
      this.me.vz = m.vz as number;
      this.me.vy = Math.max(this.me.vy, m.vy as number);
      this.me.sup = null;
      this.me.cling = null;
      if (m.st && this.me.ko <= 0) this.me.stun = Math.max(this.me.stun, m.st as number);
      if (t === 'blow' && m.st) {
        sound.beep(180, 0.2, 'sine');
        this.rumble(150, 0.55, 0.45);
      }
    } else if (t === 'sbite') {
      // Shark clamped onto me! Dragged in shark jaws!
      if (this.me.spec) return;
      this.me.sharkHold = {
        x: m.x as number,
        y: m.y as number,
        z: m.z as number,
        ry: m.ry as number,
        t: 0.35,
      };
      this.me.cling = null;
      this.me.holding = false;
      this.me.heldBy = 0;
      this.me.sup = null;
      this.rumble(240, 1.0, 0.85);
    } else if (t === 'sdrop') {
      this.me.sharkHold = null;
      this.me.vx = (m.vx as number) || 0;
      this.me.vy = (m.vy as number) || 1.5;
      this.me.vz = (m.vz as number) || 0;
      this.me.ko = Math.max(this.me.ko, 1.35);
      this.rumbleKO();
    } else if (t === 'fx') {
      this.weapons.handleFxEvent(m, (id) => (this.P[id] ? this.P[id].g.position : null));
      const fk = m.k as string;
      if (fk === 'boom' || fk === 'cannon' || fk === 'hcol' || fk === 'smash') {
        this.fxLight.color.set(fk === 'hcol' ? '#c084fc' : '#fb923c');
        this.fxLight.position.set((m.x as number) || 0, ((m.y as number) || 1) + 1.5, (m.z as number) || 0);
        this.fxLight.intensity = fk === 'boom' || fk === 'hcol' ? 9 : 6;
      }
    } else if (t === 'frz') {
      this.me.frz = !!m.on;
      if (m.on) {
        this.me.vx = this.me.vz = 0;
        this.me.cling = null;
        this.psay('FROZEN! Spam JUMP to break free!', 1800);
        sound.beep(1400, 0.2, 'triangle');
        this.rumble(300, 0.6, 0.6);
      } else {
        sound.beep(500, 0.15, 'square');
      }
    } else if (t === 'frzp') {
      this.psay(`FROZEN! JUMP ${m.n}/10`, 600);
    } else if (t === 'ko') {
      this.me.ko = (m.ms as number) / 1000;
      this.me.stun = 0;
      this.rumbleKO();
    } else if (t === 'grab') {
      this.me.heldBy = m.by as number;
      this.me.hlift = !!m.lift;
      this.me.cling = null;
    } else if (t === 'drop') {
      this.me.heldBy = 0;
      this.me.hlift = false;
      this.me.vx = m.vx as number;
      this.me.vz = m.vz as number;
      this.me.vy = m.vy as number;
      this.me.sup = null;
    } else if (t === 'lift') {
      this.me.hlift = !!m.on;
    } else if (t === 'held') {
      this.me.holding = !!m.on;
      this.me.sentLift = null;
    } else if (t === 'start') {
      this.mode = m.type as GameMode;
      this.tscore = [0, 0];
      this.roundSummary = null;
      const isTeamM = this.mode === 'team' || this.mode === 'ctf';
      (m.players as { id: number; team: number }[]).forEach((q) => {
        const p = this.P[q.id];
        if (!p) return;
        p.team = q.team;
        p.score = 0;
        if (isTeamM) p.g.sh.color.set(q.team ? '#2255ee' : '#ee3333');
        else p.g.sh.color.set(p.g.base);
      });
    } else if (t === 'round') {
      this.tscore = (m.ts as [number, number]) || this.tscore;
      this.rn = m.n as number;
      this.roundSummary = null;
      this.phase = m.map as SceneKey;
      this.applyMapTheme(this.phase);
      this.hazards.reset(Date.now());
      this.world.crates[this.phase].forEach((c) => {
        holdCrateFlag(c, 0);
        setCratePos(c, c.ox, c.oy, c.oz);
        c.tx = c.ox;
        c.ty = c.oy;
        c.tz = c.oz;
        c.sup = null;
      });
      (m.players as { id: number; x: number; y: number; z: number }[]).forEach((q) => {
        const p = this.P[q.id];
        if (!p) return;
        p.alive = true;
        p.respawnSec = 0;
        p.air = 100;
        p.g.visible = true;
        p.sharkHold = null;
        if (q.id === this.myId) {
          Object.assign(this.me, {
            x: q.x,
            y: q.y,
            z: q.z,
            vx: 0,
            vy: 0,
            vz: 0,
            ko: 0,
            stun: 0,
            heldBy: 0,
            holding: false,
            spec: false,
            sup: null,
            cling: null,
            hlift: false,
            regrip: 0,
            frz: false,
            air: 100,
            inWater: false,
            sharkHold: null,
          });
          this.cur.noteT = 0;
          if (this.localMode) {
            const ang = Math.atan2(q.x, q.z);
            this.cam.yaw = ang;
            this.me.ry = ang + Math.PI;
          }
        }
      });
      const mn = MAPN[this.phase as MapKey] || '';
      const modeHint = this.mode === 'ctf' ? 'CAPTURE THE FLAG!' : this.mode === 'koth' ? 'CAPTURE THE ZONE!' : 'FIGHT!';
      this.say(`ROUND ${m.n} · ${mn} — ${modeHint}`, 2200);
      this.notify();
    } else if (t === 'respawn_wait') {
      this.me.spec = true;
      this.me.holding = false;
      this.me.heldBy = 0;
      this.me.sup = null;
      this.me.cling = null;
      this.me.sharkHold = null;
      this.psay('Respawning at base…', (m.ms as number) || 1800);
      this.notify();
    } else if (t === 'respawn') {
      const p = this.P[m.id as number];
      const rx = m.x as number;
      const ry = m.y as number;
      const rz = m.z as number;
      if (p) {
        p.alive = true;
        p.respawnSec = 0;
        p.dz = 0;
        p.air = 100;
        p.g.visible = true;
        p.sharkHold = null;
        p.tx = rx;
        p.ty = ry;
        p.tz = rz;
        p.g.position.set(rx, ry, rz);
      }
      if (m.id === this.myId) {
        Object.assign(this.me, {
          x: rx,
          y: ry,
          z: rz,
          vx: 0,
          vy: 0,
          vz: 0,
          ko: 0,
          stun: 0,
          heldBy: 0,
          holding: false,
          spec: false,
          sup: null,
          cling: null,
          hlift: false,
          regrip: 0,
          frz: false,
          air: 100,
          inWater: false,
          sharkHold: null,
        });
        this.weapons.burst(rx, ry, rz);
        sound.beep(620, 0.12, 'triangle');
      }
      this.notify();
    } else if (t === 'rsummary') {
      this.roundSummary = (m.summary as RoundSummary | null) || null;
      this.notify();
    } else if (t === 'elim') {
      const p = this.P[m.id as number];
      if (p) {
        p.alive = false;
        p.g.visible = false;
      }
      if (m.id === this.myId && this.mode !== 'ctf' && this.mode !== 'koth') {
        this.me.spec = true;
        this.me.holding = false;
        this.me.heldBy = 0;
        this.me.sup = null;
        this.me.cling = null;
        this.me.sharkHold = null;
        this.psay('ELIMINATED — spectating', 2000);
      }
    } else if (t === 'tp') {
      const q = this.P[m.id as number];
      if (q && this.phase === 'lobby') {
        const tm = m.team as number;
        q.g.sh.color.set(tm < 0 ? q.g.base : tm ? '#2255ee' : '#ee3333');
      }
    } else if (t === 'say') {
      this.say(String(m.text || ''), (m.ms as number) || 2000);
    } else if (t === 'end') {
      this.phase = 'lobby';
      this.roundSummary = null;
      this.flags = [];
      this.zone = null;
      this.syncObjectiveVisuals(0);
      this.applyMapTheme('lobby');
      this.hazards.reset(Date.now());
      Object.values(this.P).forEach((p) => {
        p.g.sh.color.set(p.g.base);
        p.team = -1;
        p.alive = true;
        p.respawnSec = 0;
        p.air = 100;
        p.g.visible = true;
        p.sharkHold = null;
      });
      Object.assign(this.me, {
        x: this.localMode ? ((this.cur.k || 0) - (this.locals.length - 1) / 2) * 3 : 0,
        y: 3,
        z: 6,
        vx: 0,
        vy: 0,
        vz: 0,
        ko: 0,
        stun: 0,
        heldBy: 0,
        holding: false,
        spec: false,
        sup: null,
        cling: null,
        hlift: false,
        regrip: 0,
        frz: false,
        air: 100,
        inWater: false,
        sharkHold: null,
      });
      sound.beep(660, 0.4, 'triangle');
      this.notify();
    }
  }

  // ---------------- Host Game Logic ----------------
  public startMatch(type: GameMode): void {
    if (!this.isHost || this.phase !== 'lobby' || this.round.over) return;
    const ps = Object.values(this.P);
    if (ps.length < 2) {
      if (this.P[this.myId]) this.to(this.P[this.myId], { t: 'say', text: 'Need at least 2 players', ms: 1800 });
      return;
    }
    this.mode = type;
    this.tscore = [0, 0];
    this.round.n = 0;
    this.roundSummary = null;
    const isTeamMode = type === 'team' || type === 'ctf';
    const cnt = [0, 0];
    ps.forEach((p) => {
      p.score = 0;
      p.team = -1;
      if (isTeamMode && (p.pt === 0 || p.pt === 1)) {
        p.team = p.pt;
        cnt[p.pt]++;
      }
    });
    if (isTeamMode) {
      ps.forEach((p) => {
        if (p.team < 0) {
          const tm = cnt[0] <= cnt[1] ? 0 : 1;
          p.team = tm;
          cnt[tm]++;
        }
      });
      if (cnt[0] === 0 || cnt[1] === 0) {
        // Rebalance evenly if everyone picked same team
        ps.forEach((p, idx) => (p.team = idx % 2));
      }
    }
    this.pauseOpen = false;
    this.bcast({ t: 'start', type, players: ps.map((q) => ({ id: q.id, team: q.team })) });
    this.newRound();
  }

  private pickMap(): MapKey {
    let k: MapKey;
    do {
      k = MAPK[(Math.random() * MAPK.length) | 0];
    } while (k === this.phase);
    return k;
  }

  private computeCTFBases(mapKey: MapKey): [[number, number, number], [number, number, number]] {
    const pts = this.world.SPW[mapKey];
    let bestA = pts[0] || [-10, 0];
    let bestB = pts[1] || [10, 0];
    let bestD = -1;
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const d = (pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2;
        if (d > bestD) {
          bestD = d;
          bestA = pts[i];
          bestB = pts[j];
        }
      }
    }
    return [
      [bestA[0], this.world.groundY(mapKey, bestA[0], bestA[1]), bestA[1]],
      [bestB[0], this.world.groundY(mapKey, bestB[0], bestB[1]), bestB[1]],
    ];
  }

  private pickZonePos(mapKey: MapKey): [number, number, number] {
    const solids = this.world.solids[mapKey];
    if (hasGroundAt(solids, 0, 0, 12)) {
      return [0, this.world.groundY(mapKey, 0, 0), 0];
    }
    const pts = this.world.SPW[mapKey].slice().sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
    const p = pts[0] || [0, 0];
    return [p[0], this.world.groundY(mapKey, p[0], p[1]), p[1]];
  }

  private newRound(): void {
    this.round.n++;
    this.round.t0 = Date.now();
    this.roundSummary = null;
    this.bcast({ t: 'rsummary', summary: null });
    this.phase = this.pickMap();
    const mapKey = this.phase as MapKey;
    const ps = Object.values(this.P);

    if (this.mode === 'ctf') {
      this.ctfBases = this.computeCTFBases(mapKey);
      this.flags = [0, 1].map((tm) => {
        const [bx, by, bz] = this.ctfBases[tm];
        return { team: tm, x: bx, y: by, z: bz, bx, by, bz, carrierId: 0, atBase: true };
      });
      this.zone = null;
      const tCnt = [0, 0];
      ps.forEach((p) => {
        const tm = p.team === 1 ? 1 : 0;
        const [bx, , bz] = this.ctfBases[tm];
        const idx = tCnt[tm]++;
        const angle = idx * 1.4;
        const rad = idx === 0 ? 1.8 : 2.6;
        p.sp = [bx + Math.cos(angle) * rad, bz + Math.sin(angle) * rad];
      });
    } else if (this.mode === 'koth') {
      this.flags = [];
      const [zx, zy, zz] = this.pickZonePos(mapKey);
      this.zone = { x: zx, y: zy, z: zz, r: 4.4, ownerId: 0, ownerName: '', ownerColor: '', progress: 0, contested: false };
      const sp = this.world.SPW[mapKey].slice().sort(() => Math.random() - 0.5);
      ps.forEach((p, i) => {
        p.sp = sp[i % sp.length];
      });
    } else {
      this.flags = [];
      this.zone = null;
      const sp = this.world.SPW[mapKey].slice().sort(() => Math.random() - 0.5);
      ps.forEach((p, i) => {
        p.sp = sp[i % sp.length];
      });
    }

    ps.forEach((p) => {
      p.alive = true;
      p.elimTime = undefined;
      p.respawnAt = undefined;
      p.respawnSec = 0;
      p.dz = 0;
      p.air = 100;
      p.ko = 0;
      p.hold = null;
      p.heldBy = 0;
      p.last = 0;
      p.wp = null;
      p.am = 0;
      p.stun = 0;
      p.frz = false;
      p.fr = 0;
      p.fj = 0;
      p.fimm = 0;
      p.lift = false;
      p.lt = 0;
      p.mvx = p.mvz = p.mvy = 0;
      p.sharkHold = null;
    });
    this.world.crates[this.phase].forEach((c) => this.resetCrate(c));
    this.weapons.clearRound();
    this.hazards.reset(this.round.t0);
    this.resetPickups(true);
    this.bcast({
      t: 'round',
      n: this.round.n,
      map: this.phase,
      players: ps.map((q) => ({ id: q.id, x: q.sp![0], y: this.world.groundY(mapKey, q.sp![0], q.sp![1]) + 2.2, z: q.sp![1] })),
      ts: this.tscore,
    });
  }

  private resetCrate(c: {
    ox: number;
    oy: number;
    oz: number;
    vx: number;
    vy: number;
    vz: number;
    sup: SolidBox | null;
    tx: number;
    ty: number;
    tz: number;
    x: number;
    y: number;
    z: number;
    held: number;
    lift: boolean;
    s: SolidBox;
  }): void {
    holdCrateFlag(c as never, 0);
    setCratePos(c as never, c.ox, c.oy, c.oz);
    c.vx = c.vy = c.vz = 0;
    c.sup = null;
    c.tx = c.ox;
    c.ty = c.oy;
    c.tz = c.oz;
  }

  public endMatch(): void {
    this.phase = 'lobby';
    this.round.over = 0;
    this.round.fin = false;
    this.pauseOpen = false;
    this.roundSummary = null;
    this.flags = [];
    this.zone = null;
    this.bcast({ t: 'rsummary', summary: null });
    this.bcast({ t: 'end' });
    Object.values(this.P).forEach((p) => {
      if (p.pt === 0 || p.pt === 1) this.bcast({ t: 'tp', id: p.id, team: p.pt });
    });
    this.weapons.clearAll();
    this.hazards.reset(Date.now());
    this.resetPickups(false);
    if (this.localMode && !this.netOn) this.openLocal();
    this.notify();
  }

  private rel(p: PlayerRecord): void {
    const h = p.hold;
    if (!h) return;
    p.hold = null;
    const L = p.lift;
    p.lift = false;
    this.to(p, { t: 'held', on: 0 });
    const f = Math.sin(p.try);
    const g = Math.cos(p.try);
    if (h.k === 'p') {
      const q = this.P[h.id];
      if (q) {
        q.heldBy = 0;
        this.to(q, { t: 'drop', vx: f * (L ? 5 : 1.5), vz: g * (L ? 5 : 1.5), vy: L ? 3 : 1 });
      }
    } else {
      const c = this.world.crates[this.phase][h.id];
      if (c) {
        holdCrateFlag(c, 0);
        c.vx = f * (L ? 9 : 2);
        c.vz = g * (L ? 9 : 2);
        c.vy = L ? 4 : 1;
        c.sup = null;
      }
    }
  }

  private grab(p: PlayerRecord): void {
    let best: { k: 'p' | 'c'; id: number } | null = null;
    let bd = 2.3;
    const fx = Math.sin(p.try);
    const fz = Math.cos(p.try);
    const test = (x: number, y: number, z: number, o: { k: 'p' | 'c'; id: number }) => {
      const dx = x - p.tx;
      const dz = z - p.tz;
      const d = Math.hypot(dx, dz);
      if (d < bd && Math.abs(y - p.ty) < 2 && dx * fx + dz * fz > -0.2) {
        bd = d;
        best = o;
      }
    };
    Object.values(this.P).forEach((q) => {
      if (q !== p && q.alive && !q.heldBy && !q.hold && !q.sharkHold) test(q.tx, q.ty, q.tz, { k: 'p', id: q.id });
    });
    this.world.crates[this.phase].forEach((c) => {
      if (!c.held) test(c.x, c.y, c.z, { k: 'c', id: c.i });
    });
    if (!best) return;
    p.hold = best;
    p.lift = false;
    this.to(p, { t: 'held', on: 1 });
    if ((best as { k: string; id: number }).k === 'p') {
      const q = this.P[(best as { id: number }).id];
      q.heldBy = p.id;
      q.heldT = 0;
      this.to(q, { t: 'grab', by: p.id, lift: 0 });
    } else {
      const c = this.world.crates[this.phase][(best as { id: number }).id];
      holdCrateFlag(c, p.id, false);
      c.lh = p.id;
    }
  }

  private hitP(q: PlayerRecord, id: number, ang: number, dm: number, kb: number, extraVy?: number): void {
    const now = Date.now();
    if (id) q.last = id;
    let k = false;
    if (q.ko <= now) {
      q.dz += dm;
      if (q.dz >= 100) {
        q.dz = 0;
        q.ko = now + KO_MS;
        k = true;
      }
    }
    this.to(q, {
      t: 'hit',
      vx: Math.sin(ang) * kb * 0.46,
      vz: Math.cos(ang) * kb * 0.46,
      vy: extraVy ?? (k ? 5.5 : 3.6),
    });
    if (k) this.to(q, { t: 'ko', ms: KO_MS });
  }

  private hostMsg(p: PlayerRecord, m: Record<string, unknown>): void {
    const now = Date.now();
    if (m.t === 's') {
      p.tx = m.x as number;
      p.ty = m.y as number;
      p.tz = m.z as number;
      p.try = m.ry as number;
      p.a = m.a as number;
      if (!p.ready) {
        p.g.position.set(p.tx, p.ty, p.tz);
        p.ready = true;
      }
    } else if (m.t === 'a') {
      if (!p.alive || p.ko > now || (p.hold && m.k !== 'h' && m.k !== 'k') || p.frz || p.sharkHold) return;
      const ak = m.k as string;
      if (ak === 'c' && p.wp !== 'cane') return;
      if (ak === 'm' && p.wp !== 'hammer') return;
      const [dm, kb] = ATK[ak] || ATK.l;
      const rg = ak === 'k' ? 2.5 : ak === 'c' ? 3.2 : ak === 'm' ? 2.9 : 2.1;
      const fx = Math.sin(p.try);
      const fz = Math.cos(p.try);
      if (ak === 'c' || ak === 'm') {
        for (const c of this.world.crates[this.phase]) {
          if (!c.held) {
            const dx = c.x - p.tx;
            const dz = c.z - p.tz;
            if (Math.hypot(dx, dz) < rg && dx * fx + dz * fz > 0) {
              c.vx += fx * 9;
              c.vz += fz * 9;
              c.vy = 3;
            }
          }
        }
      }
      for (const q of Object.values(this.P)) {
        if (q === p || !q.alive) continue;
        const hd = q.id === p.heldBy || (p.hold && p.hold.k === 'p' && p.hold.id === q.id);
        if (q.heldBy && !hd) continue;
        const dx = q.tx - p.tx;
        const dz = q.tz - p.tz;
        if (hd || (Math.hypot(dx, dz) < rg && Math.abs(q.ty - p.ty) < 2 && dx * fx + dz * fz > 0)) {
          const dd = Math.hypot(dx, dz) || 1;
          const cs = Math.max(0, ((p.mvx || 0) * dx + (p.mvz || 0) * dz) / dd) + Math.max(0, -(p.mvy || 0)) * 0.4;
          const mm = 1 + Math.min(0.6, Math.max(0, cs - 3) * 0.12);
          this.hitP(q, p.id, p.try, dm * mm, kb * mm);
          if (mm > 1.35) this.bcast({ t: 'fx', k: 'smash', x: q.tx, y: q.ty, z: q.tz });
        }
      }
    } else if (m.t === 'g') {
      if (m.on) {
        if (p.alive && p.ko <= now && !p.frz && !p.sharkHold && p.heldBy && !p.hold) {
          const h = this.P[p.heldBy];
          if (h && h.alive && Math.hypot(h.tx - p.tx, h.tz - p.tz) < 3.2) {
            p.hold = { k: 'p', id: h.id };
            p.lift = false;
            this.to(p, { t: 'held', on: 1 });
            h.heldBy = p.id;
            h.heldT = 0;
            this.to(h, { t: 'grab', by: p.id, lift: 0 });
          }
        } else if (p.alive && p.ko <= now && !p.heldBy && !p.hold && !p.frz && !p.sharkHold) {
          this.grab(p);
        }
      } else {
        this.rel(p);
      }
    } else if (m.t === 'tm') {
      p.pt = m.team === 0 || m.team === 1 ? (m.team as number) : -1;
      this.bcast({ t: 'tp', id: p.id, team: p.pt });
    } else if (m.t === 'w') {
      this.fireWeapon(p, m.ay as number, m.ap as number);
    } else if (m.t === 'jmp') {
      if (p.frz) {
        p.fj = (p.fj || 0) + 1;
        if (p.fj >= 10) this.thawP(p);
        else this.to(p, { t: 'frzp', n: p.fj });
      }
    } else if (m.t === 'l') {
      if (!p.hold) return;
      const h = p.hold;
      if (h.k === 'p') {
        const q0 = this.P[h.id];
        if (q0 && q0.hold && q0.hold.id === p.id) {
          p.lift = false;
          return;
        }
      }
      p.lift = !!m.on;
      if (h.k === 'p') {
        const q = this.P[h.id];
        if (q) this.to(q, { t: 'lift', on: p.lift ? 1 : 0 });
      } else {
        const c = this.world.crates[this.phase][h.id];
        if (c) holdCrateFlag(c, p.id, p.lift);
      }
    }
  }

  private freezeP(q: PlayerRecord, now: number): void {
    q.frz = true;
    q.fr = 0;
    q.fj = 0;
    q.frEnd = now + 9000;
    if (q.hold) this.rel(q);
    this.to(q, { t: 'frz', on: 1 });
    this.bcast({ t: 'fx', k: 'freeze', x: q.tx, y: q.ty, z: q.tz });
  }

  private thawP(q: PlayerRecord): void {
    if (!q.frz) return;
    q.frz = false;
    q.fj = 0;
    q.fr = 0;
    q.fimm = Date.now() + 3500;
    this.to(q, { t: 'frz', on: 0 });
    this.bcast({ t: 'fx', k: 'thaw', x: q.tx, y: q.ty, z: q.tz });
  }

  private fireWeapon(p: PlayerRecord, ay?: number, ap?: number): void {
    const now = Date.now();
    if (!p.alive || p.ko > now || p.hold || p.frz || p.sharkHold || !p.wp || p.wp === 'cane' || p.wp === 'hammer' || now < (p.wcd || 0)) {
      return;
    }
    const k = p.wp;
    const yaw = typeof ay === 'number' ? ay : p.try;
    const pitch = typeof ap === 'number' ? Math.max(-1.3, Math.min(1.3, ap)) : p.ap || 0;
    const cp = Math.cos(pitch);
    const fx = Math.sin(yaw) * cp;
    const fy = Math.sin(pitch);
    const fz = Math.cos(yaw) * cp;
    p.wcd = now + WCD[k];

    if (k === 'shark') {
      this.weapons.spawnShark(p.tx + fx * 1.4, p.ty + 1.6 + fy * 1.4 - SHC, p.tz + fz * 1.4, fx * SHV, fy * SHV, fz * SHV, p.id, now);
      this.bcast({ t: 'fx', k: 'shot', x: p.tx + fx, y: p.ty + 1.6, z: p.tz + fz });
    } else if (k === 'hole') {
      const parked = this.weapons.spawnOrParkHole(p.id, p.tx + fx * 1.4, p.ty + 1.5 + fy * 1.4, p.tz + fz * 1.4, fx * 22, fy * 22, fz * 22, now, (h) => {
        this.bcast({ t: 'fx', k: 'pick', x: h.x, y: h.y, z: h.z });
      });
      if (parked) {
        p.wp = null;
        return;
      }
      this.bcast({ t: 'fx', k: 'shot', x: p.tx + fx, y: p.ty + 1.6, z: p.tz + fz });
      return;
    } else if (k === 'ice') {
      const ox = p.tx;
      const oy = p.ty + 1.4;
      const oz = p.tz;
      const solids = this.world.solids[this.phase];
      for (const q of Object.values(this.P)) {
        if (q === p || !q.alive || q.frz || (q.fimm || 0) > now || ((this.mode === 'team' || this.mode === 'ctf') && q.team === p.team)) continue;
        const dx = q.tx - ox;
        const dy = q.ty + 1.1 - oy;
        const dz = q.tz - oz;
        const d = Math.hypot(dx, dy, dz);
        if (d < 0.01 || d > 9 || (dx * fx + dy * fy + dz * fz) / d < 0.86) continue;
        let blk = false;
        for (let t = 0.8; t < d; t += 0.6) {
          if (solidAtPoint(solids, ox + (dx / d) * t, oy + (dy / d) * t, oz + (dz / d) * t)) {
            blk = true;
            break;
          }
        }
        if (blk) continue;
        q.fr = (q.fr || 0) + 1.25;
        q.frT = now;
        q.last = p.id;
        this.to(q, { t: 'blow', vx: (q.mvx || 0) * 0.45, vz: (q.mvz || 0) * 0.45, vy: -99, st: 0 });
        if (q.fr >= 12) this.freezeP(q, now);
      }
      this.bcast({ t: 'fx', k: 'ice', x: ox + fx * 1.2, y: oy + fy * 1.2 - 0.1, z: oz + fz * 1.2, dx: fx, dy: fy, dz: fz });
    } else if (k === 'bomb') {
      this.weapons.spawnBomb(p.tx + fx * 1.2, p.ty + 1.4 + fy * 1.2, p.tz + fz * 1.2, fx * 14, fy * 14 + 4, fz * 14, p.id, now);
      this.bcast({ t: 'fx', k: 'shot', x: p.tx + fx, y: p.ty + 1.6, z: p.tz + fz });
    } else if (k === 'banana') {
      this.weapons.spawnBanana(p.tx + Math.sin(yaw) * 1.4, p.ty, p.tz + Math.cos(yaw) * 1.4, p.id, now);
      this.bcast({ t: 'fx', k: 'pick', x: p.tx, y: p.ty + 0.8, z: p.tz });
    } else if (k === 'hook') {
      const ox = p.tx;
      const oy = p.ty + 1.5;
      const oz = p.tz;
      const RANGE = 45;
      const solids = this.world.solids[this.phase];
      let bt = RANGE;
      for (let t = 0.8; t <= RANGE; t += 0.4) {
        if (solidAtPoint(solids, ox + fx * t, oy + fy * t, oz + fz * t)) {
          bt = t;
          break;
        }
      }
      const look = (x: number, y: number, z: number, tol: number) => {
        const dx = x - ox;
        const dy = y - oy;
        const dz = z - oz;
        const d = Math.hypot(dx, dy, dz);
        if (d < 0.8 || d > RANGE) return null;
        const t = dx * fx + dy * fy + dz * fz;
        if (t < 0.3) return null;
        const perp = Math.hypot(dx - fx * t, dy - fy * t, dz - fz * t);
        if (perp > 2.8 + t * 0.26) return null;
        for (let q = 1; q < d - tol; q += 0.5) {
          if (solidAtPoint(solids, ox + (dx / d) * q, oy + (dy / d) * q, oz + (dz / d) * q)) return null;
        }
        return { d, sc: perp + d * 0.03 };
      };
      let bestQ: PlayerRecord | null = null;
      let bestC: typeof this.world.crates[SceneKey][number] | null = null;
      let bs = 1e9;
      let bd = RANGE;
      for (const q of Object.values(this.P)) {
        if (q === p || !q.alive || q.heldBy) continue;
        const r = look(q.tx, q.ty + 1.1, q.tz, 0.9);
        if (r && r.sc < bs) {
          bs = r.sc;
          bd = r.d;
          bestQ = q;
          bestC = null;
        }
      }
      for (const c of this.world.crates[this.phase]) {
        if (c.held) continue;
        const r = look(c.x, c.y + 0.6, c.z, 1.1);
        if (r) {
          const sc = r.sc * 1.4 + 1;
          if (sc < bs) {
            bs = sc;
            bd = r.d;
            bestC = c;
            bestQ = null;
          }
        }
      }
      if (bestQ) {
        const ms = Math.round(Math.min(2400, 700 + bd * 45));
        this.weapons.hooks.push({ tid: bestQ.id, oid: p.id, end: now + ms, first: true });
        this.bcast({ t: 'fx', k: 'hook', a: p.id, b: bestQ.id, ms });
      } else if (bestC) {
        const dx = ox - bestC.x;
        const dz = oz - bestC.z;
        const d = Math.hypot(dx, dz) || 1;
        bestC.vx = (dx / d) * 22;
        bestC.vz = (dz / d) * 22;
        bestC.vy = Math.max(bestC.vy, 3);
        bestC.sup = null;
        this.bcast({ t: 'fx', k: 'hook', a: p.id, b: 0, x: bestC.x, y: bestC.y + 0.6, z: bestC.z, ms: 450 });
      } else {
        this.bcast({ t: 'fx', k: 'hook', a: p.id, b: 0, x: ox + fx * bt, y: oy + fy * bt, z: oz + fz * bt, ms: 300 });
      }
    } else {
      // Vortex Cannon
      const ox = p.tx;
      const oy = p.ty + 1.5;
      const oz = p.tz;
      const solids = this.world.solids[this.phase];
      let hd = 99;
      for (let t = 0.6; t <= 10; t += 0.25) {
        if (solidAtPoint(solids, ox + fx * t, oy + fy * t, oz + fz * t)) {
          hd = t;
          break;
        }
      }
      const hx = ox + fx * hd;
      const hy = oy + fy * hd;
      const hz = oz + fz * hd;
      for (const q of Object.values(this.P)) {
        if (q === p || !q.alive) continue;
        const dx = q.tx - ox;
        const dy = q.ty + 1.1 - oy;
        const dz = q.tz - oz;
        const d = Math.hypot(dx, dy, dz);
        let hit = false;
        if (d > 0.01 && d < 10 && (dx * fx + dy * fy + dz * fz) / d >= 0.78) {
          const s = 22 - d * 1.3;
          const ux = dx / d;
          const uz = dz / d;
          hit = true;
          this.to(q, {
            t: 'blow',
            vx: (fx * 0.75 + ux * 0.25) * s,
            vz: (fz * 0.75 + uz * 0.25) * s,
            vy: 5 + Math.max(0, fy) * s * 0.5,
            st: 0.45,
          });
        } else if (hd < 10 && Math.hypot(q.tx - hx, q.tz - hz) < 2.6 && Math.abs(q.ty - hy) < 2.4) {
          hit = true;
          this.to(q, { t: 'blow', vx: (q.tx - hx) * 3, vz: (q.tz - hz) * 3, vy: 11, st: 0.4 });
        }
        if (hit) q.last = p.id;
      }
      for (const c of this.world.crates[this.phase]) {
        if (c.held) continue;
        const dx = c.x - ox;
        const dy = c.y + 0.6 - oy;
        const dz = c.z - oz;
        const d = Math.hypot(dx, dy, dz);
        if (d < 0.01 || d > 10 || (dx * fx + dy * fy + dz * fz) / d < 0.7) continue;
        const s = (26 - d * 1.5) * 0.6;
        c.vx += fx * s;
        c.vz += fz * s;
        c.vy = Math.max(c.vy, 2.5 + Math.max(0, fy) * s * 0.4);
        c.sup = null;
      }
      const lv = fy < -0.3 && hd < 7 ? 10 + 10 * -fy * (1 - hd / 9) : 0;
      this.to(p, { t: 'blow', vx: -fx * 4, vz: -fz * 4, vy: lv, st: 0 });
      this.bcast({ t: 'fx', k: 'vortex', x: p.tx + fx * 0.8, y: p.ty + 1.5 + fy * 0.8, z: p.tz + fz * 0.8, ry: yaw });
    }
    if (--p.am <= 0) p.wp = null;
  }

  private handleSharkBiteHost(playerId: number, x: number, y: number, z: number, ang: number): void {
    const q = this.P[playerId];
    if (!q || !q.alive) return;
    if (q.hold) this.rel(q);
    if (q.heldBy) {
      const hb = this.P[q.heldBy];
      if (hb) this.rel(hb);
    }
    q.sharkHold = { x, y, z, ry: ang, until: Date.now() + 350 };
    q.tx = x;
    q.ty = y;
    q.tz = z;
    if (q.bot && q.b) {
      q.b.x = x;
      q.b.y = y;
      q.b.z = z;
      q.b.ry = ang;
      q.b.vx = q.b.vy = q.b.vz = 0;
      q.b.sup = null;
    } else {
      this.to(q, { t: 'sbite', x, y, z, ry: ang });
    }
  }

  private handleSharkDropHost(playerId: number, vx: number, vy: number, vz: number): void {
    const q = this.P[playerId];
    if (!q) return;
    q.sharkHold = null;
    const wy = this.waterLevel();
    if (wy > -100 && q.ty < wy) {
      q.air = Math.max(40, q.air - 22);
    }
    if (q.bot && q.b) {
      q.b.vx = vx;
      q.b.vy = vy;
      q.b.vz = vz;
      q.b.sup = null;
      q.ko = Date.now() + 1350;
    } else {
      this.to(q, { t: 'sdrop', vx, vy, vz });
    }
  }

  private simCrates(dt: number): void {
    const now = Date.now();
    const tt = now / 1000;
    const solids = this.world.solids[this.phase];
    for (const c of this.world.crates[this.phase]) {
      if (c.held) {
        const h = this.P[c.held];
        if (h && h.alive) {
          const fx = Math.sin(h.try);
          const fz = Math.cos(h.try);
          if (c.lift) {
            setCratePos(c, h.tx + fx * 0.3 + Math.sin(tt * 7) * 0.12, h.ty + 2.85, h.tz + fz * 0.3 + Math.cos(tt * 6) * 0.12);
            c.vx = c.vy = c.vz = 0;
            c.sup = null;
            continue;
          }
          const ax = h.tx + fx * 1.7;
          const az = h.tz + fz * 1.7;
          if (Math.hypot(ax - c.x, az - c.z) > 4.5) {
            this.rel(h);
            continue;
          }
          c.vx += (ax - c.x) * 22 * dt;
          c.vz += (az - c.z) * 22 * dt;
          const dm = Math.exp(-dt * 4);
          c.vx *= dm;
          c.vz *= dm;
        } else {
          holdCrateFlag(c, 0);
        }
      }
      const o = { x: c.x, y: c.y, z: c.z, vx: c.vx, vy: c.vy, vz: c.vz, sup: c.sup };
      stepBody(o, dt, 0.6, 1.2, solids, c.s);
      if (o.sup) {
        const f = Math.exp(-dt * 5);
        o.vx *= f;
        o.vz *= f;
      }
      c.vx = o.vx;
      c.vy = o.vy;
      c.vz = o.vz;
      c.sup = o.sup;
      if (Math.hypot(c.vx, c.vz) > 5 && now > c.hc) {
        for (const q of Object.values(this.P)) {
          if (q.alive && q.id !== c.lh && Math.hypot(q.tx - o.x, q.tz - o.z) < 1.3 && Math.abs(q.ty - o.y) < 2) {
            c.hc = now + 700;
            this.hitP(q, c.lh, Math.atan2(c.vx, c.vz), 30, 9);
          }
        }
      }
      setCratePos(c, o.x, o.y, o.z);
      if (o.y < -30) this.resetCrate(c);
    }
  }

  public addBot(): void {
    if (!this.isHost || this.phase !== 'lobby' || Object.keys(this.P).length >= 8) return;
    const rnd = <T,>(a: T[]) => a[(Math.random() * a.length) | 0];
    const used = Object.values(this.P).map((q) => q.head);
    const free = HEADL.filter((x) => !used.includes(x));
    if (!free.length) return;
    const id = this.nextId++;
    const head = rnd(free);
    const p = this.addP({
      id,
      name: CNAME[head],
      head,
      hat: rnd(HATL),
      face: rnd(['none', 'none', ...FACEL]),
      back: rnd(['none', 'none', ...BACKL]),
      color: rnd(BOTC),
      pants: rnd(PCL),
      pid: 'bot' + id,
      bot: true,
    });
    p.bot = true;
    p.skill = this.diff * (0.9 + Math.random() * 0.2);
    p.ai = {};
    p.ready = true;
    p.b = { x: (Math.random() - 0.5) * 10, y: 2, z: 5 + Math.random() * 4, vx: 0, vy: 0, vz: 0, sup: null, ry: Math.random() * 6.28 };
    p.tx = p.b.x;
    p.ty = p.b.y;
    p.tz = p.b.z;
    p.try = p.b.ry;
    p.g.position.set(p.tx, p.ty, p.tz);
    this.bcast({ t: 'joined', p: this.pub(p) });
    this.notify();
  }

  public clearBots(): void {
    if (!this.isHost || this.phase !== 'lobby') return;
    Object.values(this.P)
      .filter((p) => p.bot)
      .forEach((p) => this.dropP(p));
    this.notify();
  }

  private botMsg(p: PlayerRecord, m: Record<string, unknown>): void {
    const b = p.b;
    if (!b) return;
    const now = Date.now();
    if (m.t === 'hit') {
      b.vx = m.vx as number;
      b.vz = m.vz as number;
      b.vy = m.vy as number;
      b.sup = null;
      if (p.ko <= now) p.stun = now + 350;
    } else if (m.t === 'blow' || m.t === 'pull') {
      b.vx = m.vx as number;
      b.vz = m.vz as number;
      b.vy = Math.max(b.vy, m.vy as number);
      b.sup = null;
      if (m.st && p.ko <= now) p.stun = now + (m.st as number) * 1000;
    } else if (m.t === 'drop') {
      b.vx = m.vx as number;
      b.vz = m.vz as number;
      b.vy = m.vy as number;
      b.sup = null;
      p.hlift = false;
    } else if (m.t === 'grab') p.hlift = false;
    else if (m.t === 'lift') p.hlift = !!m.on;
    else if (m.t === 'round') {
      const q = (m.players as { id: number; x: number; y: number; z: number }[]).find((x) => x.id === p.id);
      if (q) {
        Object.assign(b, { x: q.x, y: q.y, z: q.z, vx: 0, vy: 0, vz: 0, sup: null });
        p.stun = 0;
        p.hlift = false;
        p.sharkHold = null;
        p.ai = {};
      }
    } else if (m.t === 'end') {
      Object.assign(b, { x: (Math.random() - 0.5) * 8, y: 3, z: 6, vx: 0, vy: 0, vz: 0, sup: null });
      p.stun = 0;
      p.hlift = false;
      p.sharkHold = null;
      p.ai = {};
    }
  }

  private simBots(dt: number): void {
    if (!this.isHost || !this.joined) return;
    const now = Date.now();
    const all = Object.values(this.P);
    const arena = this.phase !== 'lobby';
    const solids = this.world.solids[this.phase];
    const isReady = (q: PlayerRecord) => q.ready || q.id === this.myId;

    for (const p of all) {
      if (!p.bot || !p.alive) continue;
      const b = p.b!;
      const ai = (p.ai || (p.ai = {})) as Record<string, any>;
      const sk = p.skill || 1;
      const moveMul = Math.max(0.65, Math.min(0.92, 0.68 + (sk - 1) * 0.11));
      const ko = p.ko > now;
      const stun = (p.stun || 0) > now || !!p.frz;
      const wy = this.waterLevel();
      const inWater = wy > -100 && b.y < wy + 0.15 && !b.sup;
      p.tx = b.x;
      p.ty = b.y;
      p.tz = b.z;
      p.try = b.ry;

      if (p.sharkHold && p.sharkHold.until > now) {
        b.x = p.sharkHold.x;
        b.y = p.sharkHold.y;
        b.z = p.sharkHold.z;
        b.ry = p.sharkHold.ry;
        b.vx = b.vy = b.vz = 0;
        b.sup = null;
        p.tx = b.x;
        p.ty = b.y;
        p.tz = b.z;
        p.try = b.ry;
        p.a = 5;
        continue;
      } else {
        p.sharkHold = null;
      }

      let moving = false;
      const botHit = (k: string) => {
        p.acd = now + ({ l: 440, r: 440, h: 760, k: 660, c: 600, m: 960 }[k] || 480) + (Math.random() * 420) / sk;
        p.aT = now + (k === 'h' || k === 'k' ? 450 : 350);
        p.ak = k;
        this.hostMsg(p, { t: 'a', k });
      };

      const holder = p.heldBy ? this.P[p.heldBy] : undefined;
      if (holder) {
        const fx = Math.sin(holder.try);
        const fz = Math.cos(holder.try);
        if (!ko && !stun && now > (p.acd || 0) && Math.random() < dt * 2.5) botHit(Math.random() < 0.5 ? 'l' : 'h');
        if (p.hlift) {
          b.x = holder.tx + fx * 0.15;
          b.z = holder.tz + fz * 0.15;
          b.y = holder.ty + 2.8;
          b.vx = b.vz = b.vy = 0;
          b.sup = null;
          b.ry = holder.try;
        } else {
          b.vx += (holder.tx + fx * 1.4 - b.x) * 16 * dt;
          b.vz += (holder.tz + fz * 1.4 - b.z) * 16 * dt;
          const dm = Math.exp(-dt * 3.5);
          b.vx *= dm;
          b.vz *= dm;
          stepBody(b, dt, 0.4, 2.1, solids, null);
          const ddx = b.x - holder.tx;
          const ddz = b.z - holder.tz;
          const d = Math.hypot(ddx, ddz);
          if (d > 2.8) {
            b.x = holder.tx + (ddx / d) * 2.8;
            b.z = holder.tz + (ddz / d) * 2.8;
          }
          b.ry = Math.atan2(holder.tx - b.x, holder.tz - b.z);
        }
      } else {
        let dx = 0;
        let dz = 0;
        let spd = 0;
        let jump = false;
        let face: number | null = null;
        const carry = !!p.hold;
        const botAttack = (k: string) => {
          p.acd = now + ({ l: 440, r: 440, h: 760, k: 660, c: 600, m: 960 }[k] || 480) + (Math.random() * 420) / sk;
          p.aT = now + (k === 'h' || k === 'k' ? 450 : 350);
          p.ak = k;
          b.vx += Math.sin(b.ry) * 1.8;
          b.vz += Math.cos(b.ry) * 1.8;
          this.hostMsg(p, { t: 'a', k });
        };
        const shoot = (tg: PlayerRecord, d: number) => {
          p.ap = Math.max(
            -1,
            Math.min(
              1,
              Math.atan2(tg.ty + 1.1 - (b.y + 1.5), Math.max(1, d)) +
                (p.wp === 'shark' ? Math.min(0.12, d * 0.006) : p.wp === 'bomb' ? Math.min(0.55, 0.1 + d * 0.035) : 0)
            )
          );
          const b4 = p.wcd;
          this.fireWeapon(p);
          if (p.wcd !== b4) {
            p.aT = now + 300;
            p.ak = 'w';
          }
        };

        if (!ko && !stun) {
          const isTeamM = this.mode === 'team' || this.mode === 'ctf';
          const botGrace = arena && now - this.round.t0 < 3200;
          ai.t = (ai.t || 0) - dt;
          if (ai.t <= 0) {
            ai.t = 0.45 + Math.random() * 0.4;
            ai.tg = null;
            ai.pk = null;
            let bd = 1e9;
            if (!botGrace) {
              for (const q of all) {
                if (q === p || !q.alive || !isReady(q) || !arena || (isTeamM && q.team === p.team)) continue;
                const d = Math.hypot(q.tx - b.x, q.tz - b.z) - (q.ko > now ? 3 : 0);
                if (d < bd) {
                  bd = d;
                  ai.tg = q.id;
                }
              }
            }
            if (!p.wp && Math.random() < 0.8) {
              let pd = 15;
              for (const u of this.world.pk[this.phase]) {
                if (u.on && Math.abs(u.y - b.y) < 3) {
                  const d = Math.hypot(u.x - b.x, u.z - b.z);
                  if (d < pd) {
                    pd = d;
                    ai.pk = u;
                  }
                }
              }
            }
          }
          const tg = !botGrace && ai.tg && this.P[ai.tg] && this.P[ai.tg].alive ? this.P[ai.tg] : null;
          // Objective override for CTF & Capture Zone (after brief round-start grace)
          let objPt: [number, number] | null = null;
          if (!botGrace && arena && this.mode === 'ctf' && this.flags.length === 2) {
            const myTm = p.team === 1 ? 1 : 0;
            const enTm = 1 - myTm;
            const myFlag = this.flags[myTm];
            const enFlag = this.flags[enTm];
            if (enFlag.carrierId === p.id) {
              objPt = myFlag.atBase || Math.random() < 0.7 ? [myFlag.bx, myFlag.bz] : [enFlag.bx, enFlag.bz];
            } else if (!myFlag.atBase && myFlag.carrierId === 0 && Math.hypot(myFlag.x - b.x, myFlag.z - b.z) < 15) {
              objPt = [myFlag.x, myFlag.z];
            } else if (!myFlag.atBase && myFlag.carrierId > 0 && this.P[myFlag.carrierId]?.alive) {
              const cf = this.P[myFlag.carrierId]!;
              if (Math.hypot(cf.tx - b.x, cf.tz - b.z) < 14) objPt = null;
              else objPt = [enFlag.x, enFlag.z];
            } else if (enFlag.carrierId === 0) {
              objPt = [enFlag.x, enFlag.z];
            }
          } else if (!botGrace && arena && this.mode === 'koth' && this.zone) {
            const dZone = Math.hypot(this.zone.x - b.x, this.zone.z - b.z);
            if (dZone > this.zone.r * 0.75 || (this.zone.ownerId !== p.id && dZone > 2.2)) {
              objPt = [this.zone.x, this.zone.z];
            }
          }

          if (inWater) {
            // Swim back to nearest solid ground / arena center and leap up onto ledges!
            let gx = 0;
            let gz = 0;
            let bestD = 999;
            for (const s of solids) {
              if (s.held || s.top < wy + 0.3) continue;
              const d = Math.hypot(s.x - b.x, s.z - b.z);
              if (d < bestD) { bestD = d; gx = s.x; gz = s.z; }
            }
            const ddx = gx - b.x;
            const ddz = gz - b.z;
            const d = Math.hypot(ddx, ddz) || 1;
            dx = ddx / d;
            dz = ddz / d;
            spd = 4.6 * moveMul;
            face = Math.atan2(dx, dz);
            if (b.y < wy + 0.45 && Math.random() < dt * 3.5) {
              b.vy = 11.2;
              b.sup = null;
            }
          } else if (carry) {
            let ox = b.x;
            let oz = b.z;
            let ol = Math.hypot(ox, oz);
            if (ol < 0.5) {
              ox = 1;
              oz = 0;
              ol = 1;
            }
            dx = ox / ol;
            dz = oz / ol;
            spd = 3.6 * moveMul;
            face = Math.atan2(dx, dz);
            if (!arena || !hasGroundAt(solids, b.x + dx * 1.8, b.z + dz * 1.8, b.y)) this.hostMsg(p, { t: 'g', on: 0 });
          } else if (objPt && (!tg || Math.hypot(tg.tx - b.x, tg.tz - b.z) > 4.2)) {
            const ddx = objPt[0] - b.x;
            const ddz = objPt[1] - b.z;
            const d = Math.hypot(ddx, ddz) || 1;
            dx = ddx / d;
            dz = ddz / d;
            spd = 6.0 * moveMul;
            face = Math.atan2(dx, dz);
          } else if (ai.pk && ai.pk.on) {
            const u = ai.pk;
            const ddx = u.x - b.x;
            const ddz = u.z - b.z;
            const d = Math.hypot(ddx, ddz) || 1;
            dx = ddx / d;
            dz = ddz / d;
            spd = 5.6 * moveMul;
            face = Math.atan2(dx, dz);
          } else if (tg) {
            const ddx = tg.tx - b.x;
            const ddz = tg.tz - b.z;
            const d = Math.hypot(ddx, ddz) || 0.01;
            const ux = ddx / d;
            const uz = ddz / d;
            const fa = Math.atan2(ddx, ddz);
            const w = p.wp;
            let diff = fa - b.ry;
            diff = Math.atan2(Math.sin(diff), Math.cos(diff));
            face = fa;
            const ready = now >= (p.acd || 0) && Math.abs(diff) < 0.35;
            if (tg.ko > now) {
              if (d > 1.5) {
                dx = ux;
                dz = uz;
                spd = 5.6 * moveMul;
              } else if (Math.abs(diff) < 0.5) {
                this.hostMsg(p, { t: 'g', on: 1 });
                if (p.hold) this.hostMsg(p, { t: 'l', on: 1 });
              }
            } else if (w === 'shark') {
              if (d < 5) {
                dx = -ux;
                dz = -uz;
                spd = 4.8 * moveMul;
              } else if (d > 10) {
                dx = ux;
                dz = uz;
                spd = 5.2 * moveMul;
              } else {
                dx = -uz;
                dz = ux;
                spd = 2.8 * moveMul;
              }
              if (d > 3 && d < 18 && Math.abs(diff) < 0.2) shoot(tg, d);
            } else if (w === 'vortex') {
              if (d > 6) {
                dx = ux;
                dz = uz;
                spd = 5.2 * moveMul;
              }
              if (d < 9 && Math.abs(diff) < 0.2) shoot(tg, d);
            } else if (w === 'hole') {
              const mh = this.weapons.holes.find((h) => h.own === p.id && h.st === 0);
              if (mh) {
                const dd = Math.hypot(mh.x - tg.tx, mh.z - tg.tz);
                const da = Math.hypot(mh.x - b.x, mh.z - b.z);
                if (dd < 3.5 || now - mh.born > 1700 || da > d + 1) shoot(tg, d);
              } else if (d > 5 && d < 16 && Math.abs(diff) < 0.2) {
                shoot(tg, d);
              }
              if (d < 6) {
                dx = -ux;
                dz = -uz;
                spd = 4.8 * moveMul;
              } else if (d > 14) {
                dx = ux;
                dz = uz;
                spd = 5.2 * moveMul;
              }
            } else if (w === 'ice') {
              if (d < 8.5 && Math.abs(diff) < 0.3) shoot(tg, d);
              if (d > 5) {
                dx = ux;
                dz = uz;
                spd = 5.2 * moveMul;
              }
            } else {
              const reach = w === 'cane' ? 2.5 : w === 'hammer' ? 2.4 : 1.6;
              if (w === 'bomb' && d > 4 && d < 13 && Math.abs(diff) < 0.3) shoot(tg, d);
              if (w === 'banana' && d < 5 && Math.abs(diff) < 0.5) shoot(tg, d);
              if (w === 'hook' && d > 4 && d < 18 && Math.abs(diff) < 0.3) shoot(tg, d);
              if (d > reach) {
                dx = ux;
                dz = uz;
                spd = 5.8 * moveMul;
              }
              if (d < reach + 0.5 && ready) {
                const r = Math.random();
                botAttack(w === 'cane' ? 'c' : w === 'hammer' ? 'm' : r < 0.5 ? (Math.random() < 0.5 ? 'l' : 'r') : r < 0.75 ? 'k' : 'h');
              }
            }
          } else {
            ai.wt = (ai.wt || 0) - dt;
            if (!ai.w || ai.wt <= 0 || Math.hypot(ai.w.x - b.x, ai.w.z - b.z) < 1) {
              const R = 16;
              const spList = arena ? this.world.SPW[this.phase as MapKey] : null;
              const pt = spList ? spList[(Math.random() * spList.length) | 0] : null;
              ai.w = pt ? { x: pt[0], z: pt[1] } : { x: (Math.random() * 2 - 1) * R, z: (Math.random() * 2 - 1) * R };
              ai.wt = 2 + Math.random() * 3;
            }
            const ddx = ai.w.x - b.x;
            const ddz = ai.w.z - b.z;
            const d = Math.hypot(ddx, ddz) || 1;
            dx = ddx / d;
            dz = ddz / d;
            spd = 3.4 * moveMul;
          }

          if (!inWater && ai.side && ai.side.t > 0) {
            ai.side.t -= dt;
            if (spd > 0) {
              const px = -dz * ai.side.s;
              const pz = dx * ai.side.s;
              dx = px;
              dz = pz;
              spd = Math.max(spd, 4.8 * moveMul);
            }
          }
          if (!inWater && arena && !carry && spd > 0 && b.sup && !hasGroundAt(solids, b.x + dx * 1.3, b.z + dz * 1.3, b.y)) {
            if (hasGroundAt(solids, b.x + dx * 3.6, b.z + dz * 3.6, b.y)) jump = true;
            else {
              dx = dz = 0;
              spd = 0;
            }
          }
          const hs = Math.hypot(b.vx, b.vz);
          if (!inWater && spd > 0 && hs < spd * 0.25) {
            ai.st = (ai.st || 0) + dt;
            if (ai.st > 0.4) {
              ai.st = 0;
              ai.sn = (ai.sn || 0) + 1;
              if (ai.sn % 2 === 1) jump = true;
              else ai.side = { t: 1.3, s: Math.random() < 0.5 ? 1 : -1 };
            }
          } else ai.st = 0;
          if (!inWater && spd > 0 && b.sup && Math.random() < dt * 0.15) jump = true;
          moving = spd > 0;
          const want = face !== null ? face : spd > 0 ? Math.atan2(dx, dz) : b.ry;
          let d2 = want - b.ry;
          d2 = Math.atan2(Math.sin(d2), Math.cos(d2));
          b.ry += d2 * Math.min(1, dt * 10);
          const k = Math.min(1, dt * 10);
          b.vx += (dx * spd - b.vx) * k;
          b.vz += (dz * spd - b.vz) * k;
        } else {
          const f = Math.max(0, 1 - dt * (b.sup ? 3.5 : 0.3));
          b.vx *= f;
          b.vz *= f;
        }

        if (jump && b.sup) {
          b.vy = 9;
          b.sup = null;
        }
        for (const q of all) {
          if (q === p || !q.alive || !isReady(q)) continue;
          const ox = b.x - q.tx;
          const oz = b.z - q.tz;
          const d = Math.hypot(ox, oz);
          if (d < 0.8 && d > 0.001 && Math.abs(b.y - q.ty) < 1.8) {
            b.x += (ox / d) * (0.8 - d) * 0.5;
            b.z += (oz / d) * (0.8 - d) * 0.5;
          }
        }
        stepBody(b, dt, 0.4, 2.1, solids, null);
        if (wy > -100 && b.y < wy + 0.15 && !b.sup) {
          const targetFloatY = wy - (ko || stun ? 1.1 : 0.45);
          if (b.y < targetFloatY) {
            b.vy += Math.min(48, (targetFloatY - b.y) * 32) * dt;
            b.vy *= Math.exp(-dt * 4.5);
          } else {
            b.vy *= Math.exp(-dt * 2.2);
          }
          b.vx *= Math.exp(-dt * 2.4);
          b.vz *= Math.exp(-dt * 2.4);
        }
        if (this.phase === 'lobby') {
          b.x = Math.max(-19.3, Math.min(19.3, b.x));
          b.z = Math.max(-19.3, Math.min(19.3, b.z));
          if (b.y < -5) {
            b.x = 0;
            b.y = 3;
            b.z = 6;
            b.vy = 0;
            b.sup = null;
          }
        }
      }
      p.tx = b.x;
      p.ty = b.y;
      p.tz = b.z;
      p.try = b.ry;
      const atkCode = p.ak ? { l: 2, r: 7, h: 8, k: 9, c: 16, w: 17, m: 18 }[p.ak] || 2 : 2;
      p.a = holder
        ? !ko && (p.aT || 0) > now
          ? atkCode
          : p.hlift
            ? 11
            : ko
              ? 6
              : 13
        : ko
          ? 6
          : p.hold
            ? p.lift
              ? 10
              : 14
            : (p.aT || 0) > now
              ? atkCode
              : stun
                ? 5
                : moving && b.sup
                  ? 1
                  : 0;
    }
  }

  private dropFlagIfCarried(p: PlayerRecord, returnHome = false): void {
    for (const fl of this.flags) {
      if (fl.carrierId !== p.id) continue;
      fl.carrierId = 0;
      if (returnHome || p.ty < -1.5) {
        fl.x = fl.bx;
        fl.y = fl.by;
        fl.z = fl.bz;
        fl.atBase = true;
        this.bcast({ t: 'say', text: `${fl.team ? 'BLUE' : 'RED'} Flag returned to base!`, ms: 1400 });
      } else {
        fl.x = p.tx;
        fl.y = Math.max(0.2, p.ty);
        fl.z = p.tz;
        fl.atBase = false;
        this.bcast({ t: 'say', text: `${fl.team ? 'BLUE' : 'RED'} Flag dropped!`, ms: 1300 });
      }
    }
  }

  private elim(p: PlayerRecord): void {
    p.alive = false;
    p.elimTime = Date.now();
    p.wp = null;
    p.frz = false;
    p.fr = 0;
    p.sharkHold = null;
    this.rel(p);
    const h = this.P[p.heldBy];
    if (h) this.rel(h);
    if (this.phase === 'arena0' || this.phase === 'arena1') {
      this.bcast({ t: 'fx', k: 'splash', x: p.tx, y: -0.5, z: p.tz });
    }
    this.bcast({ t: 'elim', id: p.id });
  }

  private dropForRespawn(p: PlayerRecord, now: number): void {
    if (this.mode === 'ctf') this.dropFlagIfCarried(p, true);
    p.alive = false;
    p.respawnAt = now + 1800;
    p.respawnSec = 2;
    p.wp = null;
    p.frz = false;
    p.fr = 0;
    p.sharkHold = null;
    this.rel(p);
    const h = this.P[p.heldBy];
    if (h) this.rel(h);
    if (this.phase === 'arena0' || this.phase === 'arena1') {
      this.bcast({ t: 'fx', k: 'splash', x: p.tx, y: -0.5, z: p.tz });
    }
    this.to(p, { t: 'respawn_wait', ms: 1800 });
    this.bcast({ t: 'elim', id: p.id });
  }

  private respawnPlayer(p: PlayerRecord): void {
    const mapKey = this.phase as MapKey;
    let sx = 0;
    let sz = 0;
    if (this.mode === 'ctf' && this.ctfBases.length === 2) {
      const tm = p.team === 1 ? 1 : 0;
      const [bx, , bz] = this.ctfBases[tm];
      const ang = Math.random() * Math.PI * 2;
      sx = bx + Math.cos(ang) * 1.4;
      sz = bz + Math.sin(ang) * 1.4;
    } else {
      const sp = this.world.SPW[mapKey];
      const pick = sp[(Math.random() * sp.length) | 0] || [0, 0];
      sx = pick[0];
      sz = pick[1];
    }
    const sy = this.world.groundY(mapKey, sx, sz) + 2.2;
    p.alive = true;
    p.respawnAt = undefined;
    p.respawnSec = 0;
    p.dz = 0;
    p.ko = 0;
    p.frz = false;
    p.fr = 0;
    p.sharkHold = null;
    p.tx = sx;
    p.ty = sy;
    p.tz = sz;
    if (p.bot && p.b) {
      Object.assign(p.b, { x: sx, y: sy, z: sz, vx: 0, vy: 0, vz: 0, sup: null });
    }
    this.bcast({ t: 'respawn', id: p.id, x: sx, y: sy, z: sz });
  }

  private finishPoint(
    now: number,
    prevTscore: [number, number],
    winnerTeam: number,
    winnerId: number | null,
    winnerName: string,
    winnerColor: string,
    reason: string,
    prevScores: Map<number, number>
  ): void {
    const ps = Object.values(this.P);
    const isTeamM = this.mode === 'team' || this.mode === 'ctf';
    const fin = isTeamM
      ? this.tscore[0] >= 5 || this.tscore[1] >= 5
      : ps.some((q) => q.score >= 5);

    const summary: RoundSummary = {
      roundNum: this.rn || this.round.n,
      mapName: MAPN[this.phase as MapKey] || '',
      winnerName,
      winnerColor,
      winnerTeam,
      reason,
      isMatchEnd: fin,
      mode: this.mode,
      prevTscore,
      tscore: [this.tscore[0], this.tscore[1]],
      rows: ps.map((q) => ({
        id: q.id,
        name: q.name,
        color: q.color,
        team: q.team,
        prevScore: prevScores.get(q.id) ?? q.score,
        newScore: q.score,
        earned: isTeamM ? q.team === winnerTeam && winnerTeam >= 0 : q.id === winnerId,
      })),
    };
    this.roundSummary = summary;
    this.round.over = now + (fin ? 4600 : winnerName !== 'DOUBLE KO' ? 3000 : 1900);
    this.round.fin = fin;
    this.bcast({ t: 'rsummary', summary });
    this.bcast({ t: 'say', text: fin ? `${winnerName.toUpperCase()} WINS THE MATCH!` : reason, ms: 2600 });
  }

  private ctfTick(now: number, ps: PlayerRecord[]): void {
    if (this.round.over || this.flags.length < 2) return;
    for (const fl of this.flags) {
      if (fl.carrierId > 0) {
        const c = this.P[fl.carrierId];
        if (!c || !c.alive || c.ko > now || c.frz || c.sharkHold) {
          fl.carrierId = 0;
          if (c && c.ty >= -1.5) {
            fl.x = c.tx;
            fl.y = Math.max(0.2, c.ty);
            fl.z = c.tz;
            fl.atBase = false;
            this.bcast({ t: 'say', text: `${fl.team ? 'BLUE' : 'RED'} Flag dropped!`, ms: 1300 });
          } else {
            fl.x = fl.bx;
            fl.y = fl.by;
            fl.z = fl.bz;
            fl.atBase = true;
            this.bcast({ t: 'say', text: `${fl.team ? 'BLUE' : 'RED'} Flag returned!`, ms: 1300 });
          }
          continue;
        }
        fl.x = c.tx;
        fl.y = c.ty;
        fl.z = c.tz;
        fl.atBase = false;
        const ownTm = c.team === 1 ? 1 : 0;
        const [ox, oy, oz] = this.ctfBases[ownTm];
        const ownFlag = this.flags[ownTm];
        if (ownFlag && ownFlag.atBase && Math.hypot(c.tx - ox, c.tz - oz) < 2.6 && Math.abs(c.ty - oy) < 2.8) {
          const prevTs: [number, number] = [this.tscore[0], this.tscore[1]];
          const prevSc = new Map(ps.map((q) => [q.id, q.score]));
          this.tscore[ownTm]++;
          this.bcast({ t: 'fx', k: 'pick', x: ox, y: oy + 1.5, z: oz });
          this.finishPoint(
            now,
            prevTs,
            ownTm,
            c.id,
            ownTm ? 'BLUE TEAM' : 'RED TEAM',
            ownTm ? '#3b82f6' : '#ef4444',
            `${c.name} captured the ${fl.team ? 'BLUE' : 'RED'} Flag!`,
            prevSc
          );
          return;
        }
      } else {
        for (const p of ps) {
          if (!p.alive || p.ko > now || p.frz || p.heldBy || p.sharkHold) continue;
          if (Math.hypot(p.tx - fl.x, p.tz - fl.z) < 2.1 && Math.abs(p.ty - fl.y) < 2.6) {
            if (p.team === fl.team && !fl.atBase) {
              fl.x = fl.bx;
              fl.y = fl.by;
              fl.z = fl.bz;
              fl.atBase = true;
              this.bcast({ t: 'fx', k: 'pick', x: fl.bx, y: fl.by + 1.2, z: fl.bz });
              this.bcast({ t: 'say', text: `${p.name} returned their flag!`, ms: 1400 });
              break;
            } else if (p.team !== fl.team) {
              fl.carrierId = p.id;
              fl.atBase = false;
              this.bcast({ t: 'fx', k: 'pick', x: fl.x, y: fl.y + 1.2, z: fl.z });
              this.bcast({ t: 'say', text: `${p.name} stole the ${fl.team ? 'BLUE' : 'RED'} Flag!`, ms: 1500 });
              break;
            }
          }
        }
      }
    }
  }

  private kothTick(dt: number, now: number, ps: PlayerRecord[]): void {
    if (this.round.over || !this.zone) return;
    const z = this.zone;
    const inside = ps.filter(
      (p) =>
        p.alive &&
        p.ko <= now &&
        !p.frz &&
        !p.heldBy &&
        !p.sharkHold &&
        Math.hypot(p.tx - z.x, p.tz - z.z) <= z.r &&
        Math.abs(p.ty - z.y) < 3.0
    );
    if (inside.length === 1) {
      const cap = inside[0];
      z.contested = false;
      if (z.ownerId === cap.id || z.ownerId === 0 || z.progress <= 0) {
        z.ownerId = cap.id;
        z.ownerName = cap.name;
        z.ownerColor = cap.color;
        z.progress = Math.min(100, z.progress + dt * 20);
      } else {
        z.progress -= dt * 28;
        if (z.progress <= 0) {
          z.progress = 0;
          z.ownerId = cap.id;
          z.ownerName = cap.name;
          z.ownerColor = cap.color;
        }
      }
      if (z.progress >= 100) {
        const prevTs: [number, number] = [this.tscore[0], this.tscore[1]];
        const prevSc = new Map(ps.map((q) => [q.id, q.score]));
        cap.score++;
        this.bcast({ t: 'fx', k: 'pick', x: z.x, y: z.y + 1.5, z: z.z });
        this.finishPoint(now, prevTs, -1, cap.id, cap.name, cap.color, `${cap.name} captured the Zone!`, prevSc);
      }
    } else if (inside.length >= 2) {
      z.contested = true;
    } else {
      z.contested = false;
      z.progress = Math.max(0, z.progress - dt * 5);
      if (z.progress <= 0) {
        z.ownerId = 0;
        z.ownerName = '';
        z.ownerColor = '';
      }
    }
  }

  private checkRound(now: number): void {
    if (this.round.over) {
      if (now > this.round.over) {
        this.round.over = 0;
        if (this.round.fin) {
          this.round.fin = false;
          this.endMatch();
        } else {
          this.newRound();
        }
      }
      return;
    }
    const ps = Object.values(this.P);
    if (ps.length < 2) {
      this.endMatch();
      return;
    }
    // Respawn modes (CTF & Capture Zone) finish points via ctfTick / kothTick
    if (this.mode === 'ctf' || this.mode === 'koth') return;

    const al = ps.filter((p) => p.alive);
    const done = this.mode === 'team' ? new Set(al.map((p) => p.team)).size <= 1 : al.length <= 1;
    if (!done) return;

    let winner: PlayerRecord | null = al[0] || null;
    if (!winner && ps.length > 0) {
      const sorted = ps.slice().sort((a, b) => (b.elimTime || 0) - (a.elimTime || 0));
      if (sorted.length >= 2 && (sorted[0].elimTime || 0) > (sorted[1].elimTime || 0)) {
        winner = sorted[0];
      }
    }

    const prevTs: [number, number] = [this.tscore[0], this.tscore[1]];
    const prevSc = new Map(ps.map((q) => [q.id, q.score]));
    let winnerName = 'DOUBLE KO';
    let winnerColor = '#fbbf24';
    let winnerTeam = -1;
    let winnerId: number | null = null;
    let reason = 'DOUBLE KO! SUDDEN REMATCH!';

    if (this.mode === 'team') {
      if (winner) {
        const t = winner.team === 1 ? 1 : 0;
        winnerTeam = t;
        winnerName = t ? 'BLUE TEAM' : 'RED TEAM';
        winnerColor = t ? '#3b82f6' : '#ef4444';
        this.tscore[t]++;
        reason = `${winnerName} wins Round ${this.rn}!`;
      }
    } else if (winner) {
      winner.score++;
      winnerId = winner.id;
      winnerName = winner.name;
      winnerColor = winner.color;
      reason = `${winner.name} wins Round ${this.rn}!`;
    }

    this.finishPoint(now, prevTs, winnerTeam, winnerId, winnerName, winnerColor, reason, prevSc);
  }

  private resetPickups(r: boolean): void {
    const now = Date.now();
    for (const ph of Object.keys(this.world.pk) as SceneKey[]) {
      const list = this.world.pk[ph];
      const act = new Set<number>();
      if (r && ph === this.phase) {
        list
          .map((_, i) => i)
          .sort(() => Math.random() - 0.5)
          .slice(0, Math.max(6, Math.ceil(list.length * 0.75)))
          .forEach((i) => act.add(i));
      }
      list.forEach((u, i) => {
        if (r && ph === this.phase) {
          u.off = !act.has(i);
          u.on = false;
          u.t = now + (Math.random() < 0.7 ? 5000 + Math.random() * 20000 : 50000 + Math.random() * 40000);
        } else {
          u.off = false;
          u.on = true;
          u.t = 0;
        }
      });
    }
  }

  private pickupTick(now: number, ps: PlayerRecord[]): void {
    const isReady = (q: PlayerRecord) => q.ready || q.id === this.myId;
    for (const u of this.world.pk[this.phase]) {
      if (!u.on) {
        if (now > u.t && !u.off) u.on = true;
        continue;
      }
      for (const p of ps) {
        if (!p.alive || !isReady(p) || p.ko > now || p.heldBy || p.sharkHold) continue;
        if (Math.hypot(p.tx - u.x, p.tz - u.z) < 1.2 && Math.abs(p.ty - u.y) < 1.5) {
          p.wp = u.k;
          p.am = WAM[u.k];
          p.wcd = 0;
          u.on = false;
          u.t = now + 22000;
          this.bcast({ t: 'fx', k: 'pick', x: u.x, y: 0.8, z: u.z });
          break;
        }
      }
    }
  }

  private hostTick50ms(): void {
    if (this.disposed || !this.isHost || !this.joined) return;
    const now = Date.now();
    const ps = Object.values(this.P);
    const wy = this.waterLevel();
    const isWaterMap = wy > -100;
    const elimFloorY = isWaterMap ? -35 : -22;
    const respawnMode = this.mode === 'ctf' || this.mode === 'koth';

    for (const p of ps) {
      const dtp = (now - (p.lt || 0)) / 1000;
      if (p.lt && dtp > 0.01 && dtp < 0.5) {
        const a = 0.5;
        const cl = (v: number) => Math.max(-16, Math.min(16, v));
        p.mvx = (p.mvx || 0) * (1 - a) + cl((p.tx - (p.lx || 0)) / dtp) * a;
        p.mvz = (p.mvz || 0) * (1 - a) + cl((p.tz - (p.lz || 0)) / dtp) * a;
        p.mvy = (p.mvy || 0) * (1 - a) + cl((p.ty - (p.ly || 0)) / dtp) * a;
      } else if (p.lt && dtp >= 0.5) {
        p.mvx = p.mvz = p.mvy = 0;
      }
      p.lx = p.tx;
      p.lz = p.tz;
      p.ly = p.ty;
      p.lt = now;

      p.dz = Math.max(0, p.dz - 0.32);
      if (p.hold && (!p.alive || p.ko > now)) this.rel(p);
      if ((p.fr || 0) > 0 && now - (p.frT || 0) > 250) p.fr = Math.max(0, (p.fr || 0) - 0.2);
      if (p.frz) {
        if (p.bot) p.fj = (p.fj || 0) + (2.2 + (p.skill || 1) * 1.8) * 0.05;
        if (!p.alive || p.ko > now || (p.fj || 0) >= 10 || now > (p.frEnd || 0)) this.thawP(p);
      }
      const h = this.P[p.heldBy];
      if (p.heldBy && h && p.ko <= now && (p.heldT += 0.05) > 2.5) this.rel(h);

      // Water maps: only eliminate if you run out of oxygen (drown) or clip past deep abyss!
      if (this.phase !== 'lobby' && p.alive && isWaterMap) {
        const inWater = p.ty < wy + 0.12;
        if (inWater) {
          const deepOrKo = p.ty < wy - 1.2 || p.ko > now || !!p.sharkHold;
          p.air = Math.max(0, p.air - (deepOrKo ? 21 : 11.5) * 0.05);
          if (p.air <= 0) {
            this.bcast({ t: 'say', text: `${p.name} drowned!`, ms: 1600 });
            if (respawnMode) this.dropForRespawn(p, now);
            else this.elim(p);
          }
        } else {
          p.air = Math.min(100, p.air + 45 * 0.05);
        }
      } else if (p.alive) {
        p.air = 100;
      }

      if (this.phase !== 'lobby' && p.alive && p.ty < elimFloorY && !p.sharkHold) {
        if (respawnMode) this.dropForRespawn(p, now);
        else this.elim(p);
      }
      if (this.phase !== 'lobby' && respawnMode && !p.alive && p.respawnAt && !this.round.over) {
        p.respawnSec = Math.max(1, Math.ceil((p.respawnAt - now) / 1000));
        if (now >= p.respawnAt) this.respawnPlayer(p);
      }
    }

    for (let i = this.weapons.hooks.length - 1; i >= 0; i--) {
      const h = this.weapons.hooks[i];
      const q = this.P[h.tid];
      const o = this.P[h.oid];
      if (!q || !o || !q.alive || !o.alive || now > h.end) {
        this.weapons.hooks.splice(i, 1);
        continue;
      }
      const dx = o.tx - q.tx;
      const dz = o.tz - q.tz;
      const d = Math.hypot(dx, dz);
      if (d < 1.7) {
        this.weapons.hooks.splice(i, 1);
        continue;
      }
      if (q.heldBy) continue;
      this.to(q, { t: 'blow', vx: (dx / d) * 26, vz: (dz / d) * 26, vy: h.first ? 5.5 : 0, st: 0 });
      h.first = false;
      q.last = o.id;
    }

    if (this.phase !== 'lobby') {
      if (this.mode === 'ctf') this.ctfTick(now, ps);
      else if (this.mode === 'koth') this.kothTick(0.05, now, ps);
      this.checkRound(now);
    }
    this.pickupTick(now, ps);

    const hzSnap = this.phase !== 'lobby' ? this.hazards.getSnapshot() : undefined;
    this.bcast({
      t: 's',
      ts: this.tscore,
      mt: performance.now() / 1000,
      p: ps.map((q) => [q.id, q.tx, q.ty, q.tz, q.try, q.a, q.score, q.dz | 0, q.wp ? WK[q.wp] : 0, q.am | 0, q.respawnSec || 0, Math.round(q.air)]),
      c: this.world.crates[this.phase].map((c) => [c.x, c.y, c.z, c.held, c.lift ? 1 : 0]),
      k: this.world.pk[this.phase].map((u) => (u.on ? 1 : 0)),
      fl: this.mode === 'ctf' ? this.flags : undefined,
      zn: this.mode === 'koth' ? this.zone : null,
      j: this.weapons.proj.map((s) => [s.id, s.x, s.y + SHC, s.z, s.vx, s.vy, s.vz, s.st]),
      bm: this.weapons.bombs.map((b) => [b.id, b.x, b.y + 0.3, b.z, b.vx, b.vy, b.vz, Math.max(0, 1 - (now - b.born) / b.fuse)]),
      bn: this.weapons.bananas.map((b) => [b.id, b.x, b.y, b.z]),
      hl: this.weapons.holes.map((h) => [h.id, h.x, h.y, h.z, h.st, h.pr]),
      fz: ps.filter((q) => q.frz).map((q) => q.id),
      hz: hzSnap,
    });
  }

  // ---------------- Player Actions & Input ----------------
  private lobbyClamp(): void {
    if (this.phase === 'lobby') {
      this.me.x = Math.max(-19.3, Math.min(19.3, this.me.x));
      this.me.z = Math.max(-19.3, Math.min(19.3, this.me.z));
      if (this.me.y < -5) {
        this.me.x = 0;
        this.me.y = 3;
        this.me.z = 6;
        this.me.vy = 0;
        this.me.sup = null;
      }
    }
  }

  private act(k: string): void {
    if (!this.joined || this.me.spec || this.me.frz || this.me.ko > 0 || this.me.stun > 0 || (this.me.holding && k !== 'h' && k !== 'k') || this.me.cling || this.me.sharkHold || this.me.cd > 0) {
      return;
    }
    this.me.cd = ({ l: 0.4, r: 0.4, h: 0.7, k: 0.6, c: 0.55, m: 0.95 }[k] || 0.45);
    this.me.atk = k;
    this.me.atkT = k === 'm' ? 0.55 : k === 'h' || k === 'k' ? 0.45 : 0.35;
    this.me.vx += Math.sin(this.me.ry) * 3;
    this.me.vz += Math.cos(this.me.ry) * 3;
    sound.beep(k === 'k' ? 160 : 220, 0.1);
    this.up({ t: 'a', k });
  }

  private hand(i: number, v: boolean): void {
    if (this.H[i] === v) return;
    this.H[i] = v;
    const L = this.cur;
    if (v) {
      if (this.H[1 - i]) {
        if (this.pend[0]) clearTimeout(this.pend[0]);
        if (this.pend[1]) clearTimeout(this.pend[1]);
        this.pend[0] = this.pend[1] = null;
      } else {
        this.pend[i] = setTimeout(() => {
          this.withCtx(L, () => {
            this.pend[i] = null;
            this.act(i ? 'r' : 'l');
          });
        }, 70);
      }
    } else if (this.pend[i]) {
      clearTimeout(this.pend[i]!);
      this.pend[i] = null;
      this.act(i ? 'r' : 'l');
    }
    const w = this.H[0] && this.H[1];
    if (w && !this.me.gw && !this.me.spec) {
      this.me.gw = true;
      this.me.gt = 0;
    } else if (!w && this.me.gw) {
      this.me.gw = false;
      this.me.holding = false;
      this.me.cling = null;
      this.up({ t: 'g', on: 0 });
    }
  }

  private useWeapon(): void {
    const mp = this.P[this.myId];
    const wk = mp?.wp;
    if (!wk || !this.joined || this.me.spec || this.me.frz || this.me.ko > 0 || this.me.stun > 0 || this.me.holding || this.me.cling || this.me.sharkHold) {
      return;
    }
    if (wk === 'cane') {
      this.act('c');
      return;
    }
    if (wk === 'hammer') {
      this.act('m');
      return;
    }
    if (this.me.wcd > 0 || (wk === 'hole' && this.cur.fHeld)) return;
    this.me.wcd =
      wk === 'ice' ? 0.08 : wk === 'hole' ? 0.25 : wk === 'shark' ? 0.7 : wk === 'hook' ? 1.4 : wk === 'bomb' ? 1.2 : wk === 'banana' ? 0.9 : 1.1;
    this.me.atk = 'w';
    this.me.atkT = 0.3;
    const ap = Math.max(-1.3, Math.min(1.3, (0.45 - this.cam.pitch) * 1.1));
    this.up({ t: 'w', ap, ay: this.me.ry });
  }

  // ---------------- Xbox Controller Support ----------------
  private padFor(L: LocalCtx): PolledPad | null {
    if (L.pad === 'kb' || L.pad === 'touch' || L.pad === null) return null;
    if (typeof L.pad === 'number') return this.PD[L.pad] || null;
    const k = Object.keys(this.PD)[0];
    return k === undefined ? null : this.PD[+k];
  }

  private rumble(ms: number, sm: number, wm: number): void {
    try {
      const st = this.padFor(this.cur) || (Object.values(this.PD)[0] ?? null);
      const g = st?.g as Gamepad & {
        vibrationActuator?: { playEffect?: (type: string, params: Record<string, number>) => void };
      };
      g?.vibrationActuator?.playEffect?.('dual-rumble', { startDelay: 0, duration: ms, strongMagnitude: sm, weakMagnitude: wm });
    } catch {
      // ignore
    }
  }

  private rumbleKO(): void {
    this.rumble(1000, 1.0, 1.0);
    setTimeout(() => { if (!this.disposed) this.rumble(700, 0.95, 0.9); }, 450);
    setTimeout(() => { if (!this.disposed) this.rumble(600, 0.85, 0.8); }, 1050);
    setTimeout(() => { if (!this.disposed) this.rumble(500, 0.65, 0.6); }, 1650);
  }

  private menuPad(): void {
    if (this.joined || this.LM.on) return;
    const MENU_COUNT = 4; // 0:play party, 1:join code, 2:controls, 3:friends/account

    for (const idxStr of Object.keys(this.PD)) {
      const idx = +idxStr;
      const st = this.PD[idx];

      if (this.menuSubModal === 'code') {
        if (edge(st, 'ml')) {
          this.codeCursor = (this.codeCursor + 3) % 4;
          sound.beep(480, 0.04, 'triangle');
          this.notify();
        }
        if (edge(st, 'mr')) {
          this.codeCursor = (this.codeCursor + 1) % 4;
          sound.beep(480, 0.04, 'triangle');
          this.notify();
        }
        if (edge(st, 'mu')) {
          const i = CODE_ALPHA.indexOf(this.codeChars[this.codeCursor]);
          this.codeChars[this.codeCursor] = CODE_ALPHA[(i + 1) % CODE_ALPHA.length];
          this.LM.code = this.codeChars.join('');
          sound.beep(560, 0.04, 'triangle');
          this.notify();
        }
        if (edge(st, 'md')) {
          const i = CODE_ALPHA.indexOf(this.codeChars[this.codeCursor]);
          this.codeChars[this.codeCursor] = CODE_ALPHA[(i - 1 + CODE_ALPHA.length) % CODE_ALPHA.length];
          this.LM.code = this.codeChars.join('');
          sound.beep(520, 0.04, 'triangle');
          this.notify();
        }
        if (edge(st, 'a') || edge(st, 'start')) {
          this.submitCodeModal(idx);
          return;
        }
        if (edge(st, 'b')) {
          this.openSubModal('none');
          return;
        }
        continue;
      }

      if (this.menuSubModal === 'controls' || this.menuSubModal === 'friends') {
        if (edge(st, 'b') || edge(st, 'x') || edge(st, 'y')) {
          this.openSubModal('none');
          return;
        }
        continue;
      }

      if (edge(st, 'md') || edge(st, 'mr')) {
        this.menuFocusIdx = (this.menuFocusIdx + 1) % MENU_COUNT;
        sound.beep(460, 0.04, 'triangle');
        this.notify();
      }
      if (edge(st, 'mu') || edge(st, 'ml')) {
        this.menuFocusIdx = (this.menuFocusIdx - 1 + MENU_COUNT) % MENU_COUNT;
        sound.beep(460, 0.04, 'triangle');
        this.notify();
      }
      if (edge(st, 'lb')) {
        this.setDifficulty(this.diff === 1 ? 3 : this.diff - 1);
      }
      if (edge(st, 'rb')) {
        this.setDifficulty(this.diff === 3 ? 1 : this.diff + 1);
      }
      if (edge(st, 'x')) {
        this.openSubModal('controls');
        return;
      }
      if (edge(st, 'y')) {
        this.openSubModal('friends');
        return;
      }
      if (edge(st, 'a') || edge(st, 'start')) {
        if (this.menuFocusIdx === 0) this.begin('party', idx);
        else if (this.menuFocusIdx === 1) this.openSubModal('code');
        else if (this.menuFocusIdx === 2) this.openSubModal('controls');
        else if (this.menuFocusIdx === 3) this.openSubModal('friends');
        return;
      }
    }
  }

  private lmPad(): void {
    for (const idxStr of Object.keys(this.PD)) {
      if (!this.LM.on) return;
      const n = +idxStr;
      const st = this.PD[n];
      const i = this.LM.slots.findIndex((x) => x && x.pad === n);
      if (i < 0) {
        if (edge(st, 'a')) this.lmJoin(n);
        else if (edge(st, 'start') && this.lmAllReady()) this.lmStart();
        else if (edge(st, 'b')) {
          this.backToMainMenu();
          return;
        }
        continue;
      }
      const sl = this.LM.slots[i]!;
      if (edge(st, 'mu')) this.lmMove(i, -1);
      if (edge(st, 'md')) this.lmMove(i, 1);
      if (edge(st, 'ml')) this.lmChange(i, -1);
      if (edge(st, 'mr')) this.lmChange(i, 1);
      if (edge(st, 'a') && !sl.ready) this.lmReady(i, true);
      if (edge(st, 'b')) {
        if (sl.ready) this.lmReady(i, false);
        else this.lmLeave(i);
      }
      if (edge(st, 'y')) this.lmMode();
      if (edge(st, 'x')) this.lmBots();
      if (edge(st, 'rb')) this.lmNet();
      if (edge(st, 'start') && this.lmAllReady()) this.lmStart();
    }
  }

  private pausePad(): void {
    const opts = this.getPauseOptionCount();
    for (const idxStr of Object.keys(this.PD)) {
      const st = this.PD[+idxStr];
      if (edge(st, 'start') || edge(st, 'b')) {
        this.togglePause(false);
        return;
      }
      if (edge(st, 'md')) {
        this.pauseIdx = (this.pauseIdx + 1) % opts;
        sound.beep(460, 0.04, 'triangle');
        this.notify();
      }
      if (edge(st, 'mu')) {
        this.pauseIdx = (this.pauseIdx - 1 + opts) % opts;
        sound.beep(460, 0.04, 'triangle');
        this.notify();
      }
      if (edge(st, 'a')) {
        this.activatePauseOption(this.pauseIdx);
        return;
      }
    }
  }

  public getPauseOptionCount(): number {
    if (this.isHost && this.phase === 'lobby') return 8; // Resume, FFA, Team, CTF, KOTH, +Bot, Clear Bots, Main Menu
    return 3; // Resume, Toggle Mute, Leave
  }

  public activatePauseOption(idx: number): void {
    if (this.isHost && this.phase === 'lobby') {
      if (idx === 0) this.togglePause(false);
      else if (idx === 1) this.startMatch('ffa');
      else if (idx === 2) this.startMatch('team');
      else if (idx === 3) this.startMatch('ctf');
      else if (idx === 4) this.startMatch('koth');
      else if (idx === 5) this.addBot();
      else if (idx === 6) this.clearBots();
      else this.backToMainMenu();
    } else {
      if (idx === 0) this.togglePause(false);
      else if (idx === 1) this.toggleMute();
      else this.backToMainMenu();
    }
  }

  private padInput(dt: number): void {
    const st = this.padFor(this.cur);
    if (!st) {
      if (this.cur.padOn) {
        this.cur.padOn = false;
        this.cur.pj.x = this.cur.pj.y = 0;
        this.keys[' '] = this.keys.shift = this.keys.f = false;
        this.hand(0, false);
        this.hand(1, false);
      }
      return;
    }
    this.cur.padOn = true;
    const s = st.s;
    const p = st.p;
    const ch = (k: keyof PadState) => s[k] !== !!p[k];
    this.cur.pj.x = s.lx;
    this.cur.pj.y = s.ly;
    this.cam.yaw -= s.rx * dt * 3;
    this.cam.pitch = Math.max(-0.85, Math.min(1.45, this.cam.pitch + s.ry * dt * 2));
    if (ch('a')) this.keys[' '] = s.a;
    if (ch('lt')) this.keys.shift = s.lt;
    if (ch('rt')) this.keys.f = s.rt;
    if (ch('lb')) this.hand(0, s.lb);
    if (ch('rb')) this.hand(1, s.rb);
    if (edge(st, 'x')) this.act('h');
    if (edge(st, 'b')) this.act('k');
    if (edge(st, 'y')) {
      this.me.em = 3;
      this.me.emT = 3;
    }
    if (edge(st, 'dl')) {
      this.me.em = 4;
      this.me.emT = 2;
    }
    if (edge(st, 'ls') && this.joined) this.toggleMute();
    if (edge(st, 'start')) {
      if (this.isHost && this.phase === 'lobby' && Object.keys(this.P).length >= 2 && !this.pauseOpen) {
        this.startMatch(this.LM.mode);
      } else {
        this.togglePause();
      }
    }
    if (this.localMode) {
      if (s.back) {
        this.cur.quit += dt;
        if (this.cur.quit > 1.2) {
          this.cur.quit = 0;
          this.quitLocal();
        }
      } else {
        this.cur.quit = 0;
      }
    } else if (this.isHost && this.phase === 'lobby' && edge(st, 'back')) {
      this.startMatch('team');
    }
  }

  public quitLocal(): void {
    if (!this.netOn || (this.isHost && this.phase !== 'lobby')) this.endMatch();
    else this.backToMainMenu();
  }

  // ---------------- Character Tick & Physics ----------------
  private tickMe(dt: number, t: number): void {
    const mp = this.P[this.myId];
    if (!mp) return;
    const solids = this.world.solids[this.phase];
    const crates = this.world.crates[this.phase];

    this.me.stun -= dt;
    this.me.ko -= dt;
    this.me.atkT -= dt;
    this.me.cd -= dt;
    this.me.emT -= dt;
    this.me.gt -= dt;
    this.me.regrip -= dt;
    this.me.wcd -= dt;
    this.cur.noteT -= dt;

    if (!this.pauseOpen) {
      this.padInput(dt);
      this.cam.yaw += ((this.keys.arrowleft ? 1 : 0) - (this.keys.arrowright ? 1 : 0)) * 2.2 * dt;
      this.cam.pitch = Math.max(-0.85, Math.min(1.45, this.cam.pitch + ((this.keys.arrowdown ? 1 : 0) - (this.keys.arrowup ? 1 : 0)) * 1.6 * dt));
      if (this.keys.f) this.useWeapon();
      this.cur.fHeld = !!this.keys.f;
      if (this.me.frz && this.keys[' '] && !this.me.jp) this.up({ t: 'jmp' });
      this.me.jp = !!this.keys[' '];
    }

    // Check shark clamp first!
    if (this.me.sharkHold) {
      this.me.sharkHold.t -= dt;
      this.me.x = this.me.sharkHold.x;
      this.me.y = this.me.sharkHold.y;
      this.me.z = this.me.sharkHold.z;
      this.me.ry = this.me.sharkHold.ry;
      this.me.vx = this.me.vy = this.me.vz = 0;
      this.me.sup = null;
      if (this.me.sharkHold.t <= 0) this.me.sharkHold = null;
    }

    const lifting = !!this.keys.shift && !this.pauseOpen;
    const hb = !!this.me.heldBy && !this.me.holding;
    const checkNearGrabbable = () =>
      isGrabbableNear(
        this.myId,
        this.me.x,
        this.me.y,
        this.me.z,
        this.me.ry,
        Object.values(this.P).map((q) => ({ id: q.id, alive: q.alive, ready: q.ready, gx: q.g.position.x, gy: q.g.position.y, gz: q.g.position.z })),
        crates
      );

    if (!this.me.sharkHold) {
      if (this.me.gw && !this.me.holding && !this.me.cling && this.me.ko <= 0 && !this.me.spec && !this.me.heldBy && !this.me.frz && this.me.regrip <= 0) {
        if (checkNearGrabbable()) {
          if (this.me.gt <= 0) {
            this.me.gt = 0.3;
            this.up({ t: 'g', on: 1 });
          }
        } else {
          const w = findWallAt(solids, this.me.x, this.me.y, this.me.z, this.me.ry);
          if (w) this.me.cling = w;
        }
      }
      if (this.me.gw && this.me.heldBy && !this.me.holding && this.me.ko <= 0 && this.me.stun <= 0 && !this.me.frz && this.me.gt <= 0) {
        this.me.gt = 0.6;
        this.up({ t: 'g', on: 1 });
      }
      if (this.me.holding && this.me.sentLift !== lifting) {
        this.me.sentLift = lifting;
        this.up({ t: 'l', on: lifting ? 1 : 0 });
      }
    }

    let ix = this.pauseOpen ? 0 : (this.keys.d ? 1 : 0) - (this.keys.a ? 1 : 0) + this.joy.x + this.cur.pj.x;
    let iz = this.pauseOpen ? 0 : (this.keys.s ? 1 : 0) - (this.keys.w ? 1 : 0) + this.joy.y + this.cur.pj.y;
    const len = Math.hypot(ix, iz);
    if (len > 1) {
      ix /= len;
      iz /= len;
    }
    const moving = len > 0.1;
    if (moving && this.me.em && this.me.emT > 0) this.me.emT = 0;
    const sy = Math.sin(this.cam.yaw);
    const cy = Math.cos(this.cam.yaw);
    const wx = ix * cy + iz * sy;
    const wz = -ix * sy + iz * cy;
    const free = !this.me.spec && this.me.ko <= 0 && this.me.stun <= 0 && !hb && !this.me.cling && !this.me.frz && !this.me.sharkHold;
    let on = false;

    if (this.me.sharkHold) {
      on = false;
    } else if (this.me.spec) {
      this.me.x += wx * 12 * dt;
      this.me.z += wz * 12 * dt;
      this.me.y = 16;
      this.me.vx = this.me.vz = this.me.vy = 0;
      this.me.sup = null;
    } else if (hb) {
      const hp = this.P[this.me.heldBy];
      if (!hp) {
        this.me.heldBy = 0;
        this.me.hlift = false;
        this.me.sup = null;
      } else {
        const hx = hp.g.position.x;
        const hz = hp.g.position.z;
        const hy = hp.g.position.y;
        const ha = hp.g.rotation.y;
        const fx = Math.sin(ha);
        const fz = Math.cos(ha);
        const can = this.me.ko <= 0 && this.me.stun <= 0;
        if (this.me.hlift) {
          this.me.x = hx + fx * 0.15;
          this.me.z = hz + fz * 0.15;
          this.me.y = hy + 2.8;
          this.me.vx = this.me.vz = this.me.vy = 0;
          this.me.sup = null;
          this.me.ry = ha;
        } else {
          this.me.vx += (hx + fx * 1.4 - this.me.x) * 16 * dt + (can ? wx * 20 * dt : 0);
          this.me.vz += (hz + fz * 1.4 - this.me.z) * 16 * dt + (can ? wz * 20 * dt : 0);
          const dm = Math.exp(-dt * 3.5);
          this.me.vx *= dm;
          this.me.vz *= dm;
          if (!this.pauseOpen && this.keys[' '] && can && this.me.sup) {
            this.me.vy = 7;
            this.me.sup = null;
          }
          stepBody(this.me, dt, 0.4, 2.1, solids, null);
          on = !!this.me.sup;
          const dx = this.me.x - hx;
          const dz = this.me.z - hz;
          const d = Math.hypot(dx, dz);
          if (d > 2.8) {
            this.me.x = hx + (dx / d) * 2.8;
            this.me.z = hz + (dz / d) * 2.8;
          }
          this.me.ry = Math.atan2(hx - this.me.x, hz - this.me.z);
          this.lobbyClamp();
        }
      }
      this.me.coy = 0;
    } else if (this.me.cling) {
      const w = this.me.cling;
      const s = w.s;
      if (this.me.stun > 0 || this.me.ko > 0 || s.held) {
        this.me.cling = null;
      } else {
        const tx = -w.nz;
        const tz = w.nx;
        const sp = (wx * tx + wz * tz) * 2.4 * dt;
        let ax = this.me.x + tx * sp;
        let az = this.me.z + tz * sp;
        if (w.nx) {
          ax = s.x + w.nx * (s.hw + 0.45);
          az = Math.max(s.z - s.hd, Math.min(s.z + s.hd, az));
        } else {
          az = s.z + w.nz * (s.hd + 0.45);
          ax = Math.max(s.x - s.hw, Math.min(s.x + s.hw, ax));
        }
        this.me.x = ax;
        this.me.z = az;
        this.me.vx = this.me.vz = this.me.vy = 0;
        this.me.sup = null;
        this.me.coy = 0;
        this.me.ry = Math.atan2(-w.nx, -w.nz);
        if (lifting) this.me.y += 3.2 * dt;
        if (!this.pauseOpen && this.keys[' ']) {
          this.me.vy = 9;
          this.me.vx = w.nx * 6;
          this.me.vz = w.nz * 6;
          this.me.cling = null;
          this.me.regrip = 0.35;
        } else if (lifting && this.me.y + 1.4 >= s.top) {
          this.me.x -= w.nx * 0.95;
          this.me.z -= w.nz * 0.95;
          this.me.y = s.top;
          this.me.vy = 0;
          this.me.cling = null;
          this.me.regrip = 0.4;
        }
      }
    } else {
      const wasOn = !!this.me.sup;
      const wy = this.waterLevel();
      const inWater = wy > -100 && !this.me.sup && this.me.y < wy + 0.15;
      if (inWater && !this.me.inWater) {
        sound.splash();
      }
      this.me.inWater = inWater;
      this.me.coy = wasOn ? 0.12 : this.me.coy - dt;
      if (free) {
        const k = Math.min(1, dt * 10);
        const sp = inWater ? 4.8 : this.me.holding ? (lifting ? 3.8 : 4.8) : 7;
        this.me.vx += (wx * sp - this.me.vx) * k;
        this.me.vz += (wz * sp - this.me.vz) * k;
        const gunW =
          mp.wp === 'shark' || mp.wp === 'vortex' || mp.wp === 'hook' || mp.wp === 'bomb' || mp.wp === 'ice' || mp.wp === 'hole';
        if (gunW) {
          let d = this.cam.yaw + Math.PI - this.me.ry;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          this.me.ry += d * Math.min(1, dt * 18);
        } else if (moving) {
          let d = Math.atan2(wx, wz) - this.me.ry;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          this.me.ry += d * Math.min(1, dt * 12);
        }
      } else {
        const f = Math.max(0, 1 - dt * (wasOn ? 3.5 : 0.3));
        this.me.vx *= f;
        this.me.vz *= f;
      }
      if (!this.pauseOpen && this.keys[' '] && free && (this.me.coy > 0 || (inWater && this.me.y < wy + 0.45))) {
        this.me.vy = inWater ? 11.4 : 9;
        if (inWater) sound.splash();
        this.me.sup = null;
        this.me.coy = 0;
      }
      if (!this.me.holding) {
        for (const idStr of Object.keys(this.P)) {
          const id = +idStr;
          const p = this.P[id];
          if (id === this.myId || !p.alive || !p.ready) continue;
          const dx = this.me.x - p.g.position.x;
          const dz = this.me.z - p.g.position.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.8 && d > 0.001 && Math.abs(this.me.y - p.g.position.y) < 1.8) {
            this.me.x += (dx / d) * (0.8 - d) * 0.5;
            this.me.z += (dz / d) * (0.8 - d) * 0.5;
          }
        }
      }
      if (this.me.heldBy && this.me.holding) {
        const hp = this.P[this.me.heldBy];
        if (hp && hp.alive) {
          const dx = hp.g.position.x - this.me.x;
          const dz = hp.g.position.z - this.me.z;
          const d = Math.hypot(dx, dz) || 0.01;
          if (d > 1.9) {
            const k = (d - 1.9) * 14 * dt;
            this.me.vx += (dx / d) * k;
            this.me.vz += (dz / d) * k;
          }
          if (d > 2.8) {
            this.me.x += (dx / d) * (d - 2.8);
            this.me.z += (dz / d) * (d - 2.8);
          }
          let da = Math.atan2(dx, dz) - this.me.ry;
          da = Math.atan2(Math.sin(da), Math.cos(da));
          this.me.ry += da * Math.min(1, dt * 10);
        }
      }
      stepBody(this.me, dt, 0.4, 2.1, solids, null);
      if (wy > -100 && !this.me.sup && this.me.y < wy + 0.15) {
        const floatY = wy - (this.me.ko > 0 || this.me.stun > 0 ? 1.15 : 0.52);
        if (this.me.y < floatY) {
          this.me.vy += Math.min(50, (floatY - this.me.y) * 32) * dt;
          this.me.vy *= Math.exp(-dt * 4.5);
        } else {
          this.me.vy *= Math.exp(-dt * 2.2);
        }
        this.me.vx *= Math.exp(-dt * 2.4);
        this.me.vz *= Math.exp(-dt * 2.4);
      }
      if (wy > -100 && !this.me.spec) {
        if (this.me.y < wy + 0.12) {
          this.me.air = Math.max(0, this.me.air - (this.me.y < wy - 1.2 || this.me.ko > 0 ? 21 : 11.5) * dt);
          if (this.me.air < 35 && this.cur.hint <= 0) {
            this.cur.hint = 1.6;
            this.psay('SWIM TO LAND! O₂ LOW!', 1100);
          }
        } else {
          this.me.air = Math.min(100, this.me.air + 45 * dt);
        }
        if (this.S.fog instanceof THREE.FogExp2) {
          this.S.fog.density = this.me.y < wy - 0.8 ? 0.022 : 0.0044;
        }
      }
      on = !!this.me.sup;
      this.lobbyClamp();
    }

    const atkMap: Record<string, number> = { l: 2, r: 7, h: 8, k: 9, c: 16, w: 17, m: 18 };
    const a = this.me.sharkHold
      ? 5
      : this.me.spec
        ? 0
        : hb
          ? this.me.atkT > 0 && this.me.ko <= 0
            ? atkMap[this.me.atk] || 2
            : this.me.hlift
              ? 11
              : this.me.ko > 0
                ? 6
                : 13
          : this.me.ko > 0
            ? 6
            : this.me.cling
              ? 12
              : this.me.holding
                ? this.me.atkT > 0 && (this.me.atk === 'h' || this.me.atk === 'k')
                  ? atkMap[this.me.atk]
                  : lifting
                    ? 10
                    : 14
                : this.me.gw
                  ? 15
                  : this.me.atkT > 0
                    ? atkMap[this.me.atk] || 2
                    : mp.wp && mp.wp !== 'cane' && this.keys.f
                      ? 17
                      : this.me.stun > 0 || this.me.frz
                        ? 5
                        : this.me.emT > 0
                          ? this.me.em
                          : moving && on
                            ? 1
                            : 0;

    mp.g.visible = !this.me.spec;
    mp.g.position.set(this.me.x, this.me.y, this.me.z);
    setWeaponOnCharacter(mp.g, mp.wp);
    mp.g.position.y += animateCharacter(mp.g, a, t, this.me.atkT > 0 ? 1 - this.me.atkT / (this.me.atk === 'c' ? 0.35 : this.me.atk === 'm' ? 0.55 : 0.3) : 0.5);
    mp.g.rotation.y = this.me.ry;
    mp.g.contactShadow.visible = !!this.me.sup || a === 6;
    mp.a = this.cur.a = a;

    this.cur.hint -= dt;
    if (this.cur.hint <= 0 && this.phase !== 'lobby' && !this.me.spec && !this.me.cling && !this.me.gw && this.me.ko <= 0 && !this.me.sup && this.me.y < -0.8 && this.me.y > -14 && nearLedgeAt(solids, this.me.x, this.me.y, this.me.z)) {
      this.cur.hint = 3;
      this.psay('Hold BOTH hands to grab the ledge!', 1400);
    }

    const d = 9;
    const Cm = this.cur.C;
    const pp = Math.max(this.cam.pitch, 0.05);
    const lk = Math.max(0, 0.05 - this.cam.pitch) * d * 1.25;
    Cm.position.set(this.me.x + Math.sin(this.cam.yaw) * Math.cos(pp) * d, this.me.y + 2.4 + Math.sin(pp) * d, this.me.z + Math.cos(this.cam.yaw) * Math.cos(pp) * d);
    Cm.lookAt(this.me.x, this.me.y + 1.9 + lk, this.me.z);
  }

  // ---------------- Main Animation & Simulation Loop ----------------
  private layout(n: number) {
    const W = window.innerWidth;
    const Hh = window.innerHeight;
    const g = 3;
    if (n <= 1) return [{ x: 0, y: 0, w: W, h: Hh }];
    if (n === 2) {
      const w = (W - g) / 2;
      return [
        { x: 0, y: 0, w, h: Hh },
        { x: w + g, y: 0, w, h: Hh },
      ];
    }
    const w = (W - g) / 2;
    const h = (Hh - g) / 2;
    return [
      { x: 0, y: 0, w, h },
      { x: w + g, y: 0, w, h },
      { x: 0, y: h + g, w, h },
      { x: w + g, y: h + g, w, h },
    ];
  }

  private viewTo(cam: THREE.PerspectiveCamera, r: { x: number; y: number; w: number; h: number }, wide = false): void {
    const y = window.innerHeight - r.y - r.h;
    this.R.setViewport(r.x, y, r.w, r.h);
    this.R.setScissor(r.x, y, r.w, r.h);
    const a = r.w / Math.max(1, r.h);
    if (cam.aspect !== a) {
      cam.aspect = a;
      if (wide) cam.fov = a < 1 ? 78 : a < 1.3 ? 70 : 65;
      cam.updateProjectionMatrix();
    }
  }

  private orbitCam(t: number): void {
    this.C.position.set(Math.sin(t * 0.2) * 28, 12, Math.cos(t * 0.2) * 28);
    this.C.lookAt(0, 2, 0);
  }

  private renderMenuScene(t: number): void {
    this.R.setScissorTest(false);
    this.R.shadowMap.autoUpdate = true;
    this.R.setViewport(0, 0, window.innerWidth, window.innerHeight);
    this.orbitCam(t);
    if (this.C.aspect !== window.innerWidth / window.innerHeight) {
      this.C.aspect = window.innerWidth / window.innerHeight;
      this.C.updateProjectionMatrix();
    }
    if (this.composer && !this.LM.on) {
      this.composer.render();
    } else {
      this.R.render(this.S, this.C);
    }
    if (!this.LM.on) return;

    this.R.setScissorTest(true);
    this.R.shadowMap.autoUpdate = false;
    this.LM.slots.forEach((s, i) => {
      const g = this.LM.pv[i];
      const r = this.previewRects[i];
      if (!s || !g || !r || r.width < 10 || r.height < 10) return;
      g.rotation.y = Math.sin(t * 0.8 + i) * 0.55;
      g.position.y = animateCharacter(g, s.ready ? 3 : 0, t);
      this.PC.position.set(600 + i * 40, 2.3, 606.6);
      this.PC.lookAt(600 + i * 40, 1.95, 600);
      this.viewTo(this.PC, { x: r.left, y: r.top, w: r.width, h: r.height });
      this.R.render(this.S, this.PC);
    });
    this.R.setScissorTest(false);
    this.R.shadowMap.autoUpdate = true;
    this.R.setViewport(0, 0, window.innerWidth, window.innerHeight);
  }

  private renderGame(t: number): void {
    if (!this.localMode) {
      if (this.composer) this.composer.render();
      else this.R.render(this.S, this.C);
      return;
    }
    const n = this.locals.length;
    const v = this.layout(n === 3 ? 4 : n);
    this.R.setScissorTest(false);
    this.R.setViewport(0, 0, window.innerWidth, window.innerHeight);
    this.R.clear();
    this.R.setScissorTest(true);
    this.R.shadowMap.autoUpdate = false;
    this.locals.forEach((L, i) => {
      this.viewTo(L.C, v[i], true);
      this.R.shadowMap.needsUpdate = i === 0;
      this.R.render(this.S, L.C);
    });
    if (n === 3) {
      this.orbitCam(t);
      this.viewTo(this.C, v[3]);
      this.R.render(this.S, this.C);
    }
    this.R.setScissorTest(false);
    this.R.shadowMap.autoUpdate = true;
    this.R.setViewport(0, 0, window.innerWidth, window.innerHeight);
  }

  private loop(nowMs: number): void {
    if (this.disposed) return;
    this.animId = requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min((nowMs - this.lastFrame) / 1000, 0.05);
    this.lastFrame = nowMs;
    const t = nowMs / 1000;
    const nowWall = Date.now();

    const prevPadCount = Object.keys(this.PD).length;
    const { pads, anyPressed } = pollGamepads();
    this.PD = pads;
    const curPadCount = Object.keys(this.PD).length;
    if (anyPressed) sound.unlock();
    if (curPadCount !== prevPadCount) this.notify();

    for (const k of Object.keys(this.world.groups) as SceneKey[]) {
      this.world.groups[k].visible = k === this.phase;
    }
    this.skyUniforms.uTime.value = t;

    // Oceans & lava & ambient particles tick
    const oc = this.world.oceans[this.phase];
    if (oc) oc.uniforms.uTime.value = t;
    if (this.world.lavaMat && this.phase === 'arena3') {
      this.world.lavaMat.emissiveIntensity = 1.3 + Math.sin(t * 2.5) * 0.25;
    }
    const pSet = this.world.particles[this.phase];
    if (pSet) {
      const posAttr = pSet.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      const count = arr.length / 3;
      for (let i = 0; i < count; i++) {
        const i3 = i * 3;
        arr[i3] += Math.sin(t * 0.9 + i) * pSet.drift * dt;
        arr[i3 + 1] += pSet.speeds[i] * pSet.rise * dt;
        arr[i3 + 2] += Math.cos(t * 0.8 + i * 1.3) * pSet.drift * dt;
        if (arr[i3 + 1] > pSet.wrapTop) arr[i3 + 1] = pSet.wrapBot;
        if (arr[i3 + 1] < pSet.wrapBot) arr[i3 + 1] = pSet.wrapTop;
      }
      posAttr.needsUpdate = true;
    }
    if (this.fxLight.intensity > 0.01) {
      this.fxLight.intensity = Math.max(0, this.fxLight.intensity - dt * 26);
    }

    // Moving platforms synced to host clock
    for (const mv of this.world.movers) {
      if (mv.scene !== this.phase) continue;
      const [nx, nz] = mv.f(t + this.moff);
      const s = mv.s;
      s.dx = nx - s.x;
      s.dz = nz - s.z;
      s.dy = 0;
      s.x = nx;
      s.z = nz;
      s.m.position.x = nx;
      s.m.position.z = nz;
    }

    if (!this.joined) {
      this.syncObjectiveVisuals(t);
      if (this.LM.on) this.lmPad();
      else this.menuPad();
      this.renderMenuScene(t);
      return;
    }

    if (this.pauseOpen) {
      this.pausePad();
    }

    const psList = Object.values(this.P);
    if (this.isHost) {
      for (const L of this.locals) {
        const p = this.P[L.id];
        if (p) {
          p.tx = L.me.x;
          p.ty = L.me.y;
          p.tz = L.me.z;
          p.try = L.me.ry;
        }
      }
      this.simCrates(dt);
      this.simBots(dt);
      this.weapons.simProj(
        dt,
        nowWall,
        this.phase,
        this.world.solids[this.phase],
        this.world.crates[this.phase],
        psList,
        this.mode === 'ctf' ? 'team' : this.mode,
        (id) => (this.P[id] ? this.P[id].team : -1),
        {
          onHit: (pid, own, ang, dmg, kb) => {
            const q = this.P[pid];
            if (q) this.hitP(q, own, ang, dmg, kb);
          },
          onSharkBite: (pid, _sk, x, y, z, ang) => this.handleSharkBiteHost(pid, x, y, z, ang),
          onSharkDrop: (pid, vx, vy, vz) => this.handleSharkDropHost(pid, vx, vy, vz),
          onFx: (k, x, y, z) => this.bcast({ t: 'fx', k, x, y, z }),
        }
      );
      this.weapons.simBombsAndBananas(
        dt,
        nowWall,
        this.world.solids[this.phase],
        this.world.crates[this.phase],
        psList.map((p) => ({
          id: p.id,
          alive: p.alive,
          ko: p.ko,
          heldBy: p.heldBy,
          tx: p.tx,
          ty: p.ty,
          tz: p.tz,
          mvx: p.mvx || 0,
          mvz: p.mvz || 0,
        })),
        {
          onBoom: (b: BombObj) => {
            const R = 6.5;
            this.bcast({ t: 'fx', k: 'boom', x: b.x, y: b.y + 0.3, z: b.z });
            for (const q of psList) {
              if (!q.alive) continue;
              const dx = q.tx - b.x;
              const dz = q.tz - b.z;
              const dy = q.ty + 1 - (b.y + 0.3);
              const d = Math.hypot(dx, dy, dz);
              if (d > R) continue;
              const f = 1 - d / R;
              const ang = Math.atan2(dx, dz);
              if (q.id === b.own) {
                this.to(q, { t: 'blow', vx: Math.sin(ang) * 14 * f, vz: Math.cos(ang) * 14 * f, vy: 6 + 9 * f, st: 0.2 });
              } else {
                this.hitP(q, b.own, ang, 12 + 55 * f, 10 + 16 * f);
                this.to(q, { t: 'blow', vx: Math.sin(ang) * (8 + 14 * f), vz: Math.cos(ang) * (8 + 14 * f), vy: 7 + 7 * f, st: 0.3 });
              }
            }
            for (const c of this.world.crates[this.phase]) {
              if (c.held) continue;
              const dx = c.x - b.x;
              const dz = c.z - b.z;
              const d = Math.hypot(dx, dz, c.y - b.y);
              if (d > R || d < 0.01) continue;
              const f = 1 - d / R;
              c.vx += (dx / d) * 18 * f;
              c.vz += (dz / d) * 18 * f;
              c.vy = Math.max(c.vy, 6 * f + 2);
              c.sup = null;
            }
          },
          onSlip: (qId, own, vx, vz, bx, by, bz) => {
            const q = this.P[qId];
            if (!q) return;
            this.to(q, { t: 'blow', vx, vz, vy: 6, st: 1.1 });
            q.dz += 10;
            q.last = own;
            this.bcast({ t: 'fx', k: 'slip', x: bx, y: by, z: bz });
          },
        }
      );
      this.weapons.simHoles(dt, nowWall, this.world.solids[this.phase], this.world.crates[this.phase], psList, {
        onHoleParked: (own) => {
          const o = this.P[own];
          if (o && o.wp === 'hole') o.wp = null;
        },
        onResetCrate: (c) => this.resetCrate(c),
        onBlow: (id, vx, vy, vz, st, own) => {
          const q = this.P[id];
          if (q) {
            q.last = own;
            this.to(q, { t: 'blow', vx, vz, vy, st });
          }
        },
        onPull: (id, vx, vy, vz) => {
          const q = this.P[id];
          if (q) this.to(q, { t: 'pull', vx, vz, vy, st: 0 });
        },
        onFx: (k, x, y, z) => this.bcast({ t: 'fx', k, x, y, z }),
      });

      // Map-specific escalating hazards (NO storm!)
      if (this.phase !== 'lobby') {
        this.hazards.updateHost(dt, nowWall, this.phase, this.world.solids[this.phase], psList, {
          onHit: (pid, ang, dmg, kb, vy) => {
            const q = this.P[pid];
            if (q) this.hitP(q, 0, ang, dmg, kb, vy);
          },
          onBlow: (pid, vx, vy, vz, stun) => {
            const q = this.P[pid];
            if (q) this.to(q, { t: 'blow', vx, vz, vy, st: stun });
          },
          onSharkBite: (pid, _sid, x, y, z, ang) => this.handleSharkBiteHost(pid, x, y, z, ang),
          onSharkDrop: (pid, vx, vy, vz) => this.handleSharkDropHost(pid, vx, vy, vz),
          onFx: (k, x, y, z) => this.bcast({ t: 'fx', k, x, y, z }),
        });
        this.hazards.syncFromSnapshot(this.hazards.getSnapshot(), dt, nowWall, t);
      }
    } else {
      for (const c of this.world.crates[this.phase]) {
        const k = Math.min(1, dt * 14);
        if (Math.hypot(c.tx - c.x, c.tz - c.z) > 6 || Math.abs(c.ty - c.y) > 6) setCratePos(c, c.tx, c.ty, c.tz);
        else setCratePos(c, c.x + (c.tx - c.x) * k, c.y + (c.ty - c.y) * k, c.z + (c.tz - c.z) * k);
      }
    }

    for (const u of this.world.pk[this.phase]) {
      u.w.position.y = 0.9 + Math.sin(t * 2 + u.x) * 0.12;
      u.w.rotation.y = t * 1.5;
    }

    for (const c of this.world.crates[this.phase]) {
      const m = c.s.m;
      const w = c.held ? (c.lift ? 0.2 : 0.09) : 0;
      const k = Math.min(1, dt * 10);
      m.rotation.z += (Math.sin(t * 7 + c.i) * w - m.rotation.z) * k;
      m.rotation.x += (Math.cos(t * 6 + c.i) * w * 0.7 - m.rotation.x) * k;
    }

    for (const L of this.locals) this.withCtx(L, () => this.tickMe(dt, t));
    if (!this.joined) {
      this.renderMenuScene(t);
      return;
    }

    for (const ph of Object.keys(this.world.crates) as SceneKey[]) {
      this.world.crates[ph].forEach((c) => {
        c.s.dx = c.s.dy = c.s.dz = 0;
      });
    }

    const isL = new Set(this.locals.map((L) => L.id));
    for (const p of psList) {
      if (isL.has(p.id)) continue;
      p.g.visible = p.alive && p.ready;
      if (!p.ready || !p.alive) continue;
      const k = Math.min(1, dt * 12);
      p.g.position.x += (p.tx - p.g.position.x) * k;
      p.g.position.z += (p.tz - p.g.position.z) * k;
      if (p.a === 6 && p.pa !== 6) {
        this.weapons.burst(p.tx, p.ty, p.tz);
        sound.beep(120, 0.2, 'sawtooth');
      }
      if ((p.a === 2 || p.a === 7 || p.a === 8 || p.a === 9) && p.pa !== p.a) sound.beep(220, 0.08);
      if (p.a !== p.pa) p.as = t;
      p.pa = p.a;
      let df = p.try - p.g.rotation.y;
      df = Math.atan2(Math.sin(df), Math.cos(df));
      p.g.rotation.y += df * k;
      setWeaponOnCharacter(p.g, p.wp);
      const ay = animateCharacter(p.g, p.a, t, Math.min(1, (t - (p.as || 0)) / 0.35));
      p.g.position.y += (p.ty + ay - p.g.position.y) * k;
    }

    // Frozen ice block visual sync
    for (const p of psList) {
      if (p.frz && p.alive) {
        if (!p.iceM) {
          p.iceM = new THREE.Mesh(
            new THREE.BoxGeometry(1.7, 2.7, 1.7),
            new THREE.MeshStandardMaterial({
              color: '#9fe8ff',
              transparent: true,
              opacity: 0.5,
              roughness: 0.1,
              metalness: 0.1,
              emissive: '#3a9ac8',
              emissiveIntensity: 0.35,
            })
          );
          this.S.add(p.iceM);
        }
        p.iceM.position.set(p.g.position.x, p.g.position.y + 1.15, p.g.position.z);
      } else if (p.iceM) {
        this.S.remove(p.iceM);
        p.iceM = null;
      }
    }

    this.syncObjectiveVisuals(t);
    this.weapons.tickVisuals(dt, t, (id) => (this.P[id] ? this.P[id].g.position : null));

    this.sendT += dt;
    if (this.sendT > 0.05 && !this.isHost && this.hostConn && this.hostConn.open) {
      this.sendT = 0;
      for (const L of this.locals) {
        this.hostConn.send({ t: 's', k: L.k || 0, x: L.me.x, y: L.me.y, z: L.me.z, ry: L.me.ry, a: L.a });
      }
    }

    this.hudT += dt;
    if (this.hudT > 0.14) {
      this.hudT = 0;
      for (const p of psList) {
        const mine = isL.has(p.id);
        p.g.dot.visible = sound.isSpeaking(mine ? 'local' : p.pid);
        if (!mine) {
          const minD = Math.min(...this.locals.map((L) => Math.hypot(p.g.position.x - L.me.x, p.g.position.z - L.me.z)));
          sound.updateSpatialVolume(p.pid, minD);
        }
      }
      this.notify();
    } else if (nowMs - this.lastPadPollNotify > 1500) {
      this.lastPadPollNotify = nowMs;
    }

    this.renderGame(t);
  }

  private syncObjectiveVisuals(t: number): void {
    for (const p of Object.values(this.P)) {
      if (p.g?.carryFlag) p.g.carryFlag.visible = false;
    }

    const showFlags = this.joined && this.phase !== 'lobby' && this.mode === 'ctf' && this.flags.length === 2;
    this.flagVisuals.forEach((fv, idx) => {
      if (!showFlags) {
        fv.visible = false;
        return;
      }
      const fl = this.flags[idx];
      fv.visible = true;
      fv.position.set(fl.bx, fl.by, fl.bz);
      if (fl.carrierId > 0) {
        fv.pole.visible = false;
        const carrier = this.P[fl.carrierId];
        if (carrier && carrier.alive && carrier.g?.carryFlag) {
          carrier.g.carryFlag.visible = true;
          const banner = carrier.g.carryFlag.children[1] as THREE.Mesh | undefined;
          if (banner && banner.material) {
            const mat = banner.material as THREE.MeshStandardMaterial;
            mat.color.set(fl.team === 0 ? '#ef4444' : '#3b82f6');
            mat.emissive.set(fl.team === 0 ? '#dc2626' : '#2563eb');
          }
          carrier.g.carryFlag.rotation.y = Math.sin(t * 9 + idx) * 0.18;
        }
      } else {
        fv.pole.visible = true;
        fv.pole.position.set(fl.x - fl.bx, fl.y - fl.by + (fl.atBase ? 0 : Math.sin(t * 4) * 0.14), fl.z - fl.bz);
        fv.cloth.rotation.y = Math.sin(t * 7 + idx) * 0.22;
      }
    });

    if (this.zoneVisual) {
      if (this.joined && this.phase !== 'lobby' && this.mode === 'koth' && this.zone) {
        const z = this.zone;
        this.zoneVisual.visible = true;
        this.zoneVisual.position.set(z.x, z.y, z.z);
        this.zoneVisual.scale.set(z.r / 4.4, 1, z.r / 4.4);
        const col = z.contested ? '#f59e0b' : z.ownerColor || '#38bdf8';
        this.zoneVisual.ringMat.color.set(col);
        this.zoneVisual.ringMat.emissive.set(col);
        this.zoneVisual.padMat.color.set(col);
        this.zoneVisual.beamMat.color.set(col);
        this.zoneVisual.beamMat.opacity = 0.14 + (z.progress / 100) * 0.28 + Math.sin(t * 6) * 0.04;
        this.zoneVisual.ring.rotation.z = t * 1.4;
      } else {
        this.zoneVisual.visible = false;
      }
    }
  }

  // ---------------- DOM Input & Touch Bindings ----------------
  private bindDOMEvents(): void {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);

    this.R.domElement.addEventListener('mousedown', (e) => {
      if (!this.joined || this.pauseOpen || Date.now() - this.lastTouch < 1000) return;
      sound.unlock();
      if (this.KBC) {
        this.withCtx(this.KBC, () => {
          if (this.R.domElement.requestPointerLock && document.pointerLockElement !== this.R.domElement) {
            try {
              const r = this.R.domElement.requestPointerLock() as unknown as Promise<void>;
              if (r && r.catch) r.catch(() => {});
            } catch {
              // ignore
            }
            return;
          }
          if (e.button === 0) this.hand(0, true);
          if (e.button === 2) this.hand(1, true);
        });
      }
    });
  }

  public touchJoystickStart(id: number, x: number, y: number): void {
    this.lastTouch = Date.now();
    sound.unlock();
    if (!this.joined || this.LM.on) return;
    if (x < window.innerWidth / 2 && this.jt === null) {
      this.jt = id;
      this.j0 = [x, y];
    } else if (this.ct === null) {
      this.ct = id;
      this.c0 = [x, y];
    }
  }

  public touchJoystickMove(id: number, x: number, y: number): { dx: number; dy: number } | null {
    if (!this.joined || this.LM.on) return null;
    if (id === this.jt) {
      let dx = x - this.j0[0];
      let dy = y - this.j0[1];
      const L = Math.hypot(dx, dy);
      const M = 55;
      if (L > M) {
        dx *= M / L;
        dy *= M / L;
      }
      let jx = dx / M;
      let jy = dy / M;
      if (Math.hypot(jx, jy) < 0.12) jx = jy = 0;
      this.MAIN.joy.x = jx;
      this.MAIN.joy.y = jy;
      return { dx, dy };
    }
    if (id === this.ct) {
      this.MAIN.cam.yaw -= (x - this.c0[0]) * 0.006;
      this.MAIN.cam.pitch = Math.max(-0.85, Math.min(1.45, this.MAIN.cam.pitch + (y - this.c0[1]) * 0.006));
      this.c0 = [x, y];
    }
    return null;
  }

  public touchJoystickEnd(id: number): boolean {
    this.lastTouch = Date.now();
    let endedJoy = false;
    if (id === this.jt) {
      this.jt = null;
      this.MAIN.joy.x = this.MAIN.joy.y = 0;
      endedJoy = true;
    }
    if (id === this.ct) this.ct = null;
    return endedJoy;
  }

  public touchAction(action: 'L' | 'R' | 'H' | 'K' | 'J' | 'D' | 'M' | 'S' | 'F', pressed: boolean): void {
    sound.unlock();
    this.withCtx(this.MAIN, () => {
      if (action === 'L') this.hand(0, pressed);
      else if (action === 'R') this.hand(1, pressed);
      else if (action === 'H' && pressed) this.act('h');
      else if (action === 'K' && pressed) this.act('k');
      else if (action === 'J') this.keys[' '] = pressed;
      else if (action === 'D' && pressed) {
        this.me.em = 3;
        this.me.emT = 3;
      } else if (action === 'M' && pressed) this.toggleMute();
      else if (action === 'S') this.keys.shift = pressed;
      else if (action === 'F') this.keys.f = pressed;
    });
  }

  private onResize = () => {
    this.R.setSize(window.innerWidth, window.innerHeight);
    this.composer?.setSize(window.innerWidth, window.innerHeight);
    this.C.aspect = window.innerWidth / window.innerHeight;
    this.C.updateProjectionMatrix();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    sound.unlock();
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;

    if (!this.joined && !this.LM.on) {
      if (this.menuSubModal !== 'none') {
        if (k === 'escape') {
          this.openSubModal('none');
        }
        return;
      }
      if (k === 'arrowdown') {
        e.preventDefault();
        this.menuFocusIdx = (this.menuFocusIdx + 1) % 4;
        this.notify();
      } else if (k === 'arrowup') {
        e.preventDefault();
        this.menuFocusIdx = (this.menuFocusIdx + 3) % 4;
        this.notify();
      } else if (k === 'enter') {
        if (this.menuFocusIdx === 0) this.begin('party');
        else if (this.menuFocusIdx === 1) this.openSubModal('code');
        else if (this.menuFocusIdx === 2) this.openSubModal('controls');
        else if (this.menuFocusIdx === 3) this.openSubModal('friends');
      }
      return;
    }

    if (this.LM.on) {
      const i = this.LM.slots.findIndex((s) => s && s.pad === 'kb');
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'enter', ' ', 'escape', 'backspace'].includes(k)) e.preventDefault();
      if (k === 'enter') {
        if (i < 0) this.lmJoin('kb');
        else if (!this.LM.slots[i]!.ready) this.lmReady(i, true);
        return;
      }
      if (k === ' ') {
        if (this.lmAllReady()) this.lmStart();
        return;
      }
      if (k === 'y') {
        this.lmMode();
        return;
      }
      if (k === 'x') {
        this.lmBots();
        return;
      }
      if (k === 'o') {
        this.lmNet();
        return;
      }
      if (i < 0) {
        if (k === 'escape') this.backToMainMenu();
        return;
      }
      if (k === 'arrowup') this.lmMove(i, -1);
      else if (k === 'arrowdown') this.lmMove(i, 1);
      else if (k === 'arrowleft') this.lmChange(i, -1);
      else if (k === 'arrowright') this.lmChange(i, 1);
      else if (k === 'escape' || k === 'backspace') {
        if (this.LM.slots[i]!.ready) this.lmReady(i, false);
        else this.lmLeave(i);
      }
      return;
    }

    if (k === 'escape' && this.joined) {
      this.togglePause();
      return;
    }

    if (k === ' ') e.preventDefault();
    if (this.KBC) {
      this.withCtx(this.KBC, () => {
        this.keys[k] = true;
        if (e.repeat) return;
        if (k === 'z') this.hand(0, true);
        if (k === 'x') this.hand(1, true);
        if (k === 'q') this.act('h');
        if (k === 'e') this.act('k');
        if (k === 'm' && this.joined && (!this.localMode || this.netOn)) this.toggleMute();
        if (!this.localMode || this.netOn) {
          if (k === 'g') this.startMatch('ffa');
          if (k === 't') this.startMatch('team');
        }
        if (!this.localMode && this.phase === 'lobby' && this.joined) {
          if (k === 'r') this.setTeam(0);
          if (k === 'b') this.setTeam(1);
          if (k === 'n') this.setTeam(-1);
        }
        if (k === '1') {
          this.me.em = 3;
          this.me.emT = 3;
        }
        if (k === '2') {
          this.me.em = 4;
          this.me.emT = 2;
        }
      });
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (this.KBC) {
      this.withCtx(this.KBC, () => {
        this.keys[k] = false;
        if (k === 'z') this.hand(0, false);
        if (k === 'x') this.hand(1, false);
      });
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    if (this.KBC) {
      this.withCtx(this.KBC, () => {
        if (e.button === 0) this.hand(0, false);
        if (e.button === 2) this.hand(1, false);
      });
    }
  };

  private onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement === this.R.domElement && this.KBC) {
      this.withCtx(this.KBC, () => {
        this.cam.yaw -= e.movementX * 0.003;
        this.cam.pitch = Math.max(-0.85, Math.min(1.45, this.cam.pitch + e.movementY * 0.003));
      });
    }
  };

  private onContextMenu = (e: MouseEvent) => e.preventDefault();

  private onPointerLockChange = () => {
    if (document.pointerLockElement !== this.R.domElement && this.KBC) {
      this.withCtx(this.KBC, () => {
        this.hand(0, false);
        this.hand(1, false);
      });
    }
  };

  private onWindowBlur = () => {
    if (this.KBC) {
      this.withCtx(this.KBC, () => {
        for (const k of Object.keys(this.keys)) this.keys[k] = false;
        this.hand(0, false);
        this.hand(1, false);
      });
    }
    this.jt = null;
    this.ct = null;
    this.MAIN.joy.x = this.MAIN.joy.y = 0;
  };
}
