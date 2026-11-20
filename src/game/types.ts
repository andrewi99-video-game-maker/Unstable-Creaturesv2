import type * as THREE from 'three';

export const HEADS: Record<string, string> = {
  dog: '#c89a6a',
  cat: '#e0a050',
  bear: '#6b4a35',
  rabbit: '#f0f0f0',
  fox: '#e8702a',
  shark: '#6d8fb0',
  chicken: '#fff3dc',
  frog: '#3fb36b',
  pig: '#ffa6bd',
  panda: '#f4f4f4',
  lizard: '#b6d43c',
};

export const CNAME: Record<string, string> = {
  dog: 'Dizzy Doggo',
  cat: 'Sneaky Kitty',
  bear: 'Grumpy Bear Boss',
  rabbit: 'Bad Bunny',
  fox: 'Foxy Flash',
  shark: 'Smooth Sharky',
  chicken: 'Silly Chicken Pro',
  frog: 'Hoppy Froggo',
  pig: 'Mighty Piggy',
  panda: 'Chill Panda King',
  lizard: 'Lazy Lizard Lord',
};

export const HEADL = Object.keys(HEADS);
export const SHL = ['#3aa6ff', '#ff4f4f', '#4fdc6a', '#ffd23c', '#b06bff', '#ff8a3c', '#3cf0d0', '#ff6bd5'];
export const PCL = ['#334466', '#222222', '#7a3b2e', '#2e6b3a', '#6b2e6b', '#c2a14a', '#e8e8e8', '#ff8a3c'];
export const HATL = ['none', 'cap', 'crown', 'party', 'wizard', 'tophat', 'cowboy', 'chef', 'viking', 'halo', 'propeller'];
export const FACEL = ['none', 'shades', 'glasses', 'goggles', 'eyepatch', 'pink'];
export const BACKL = ['none', 'cape', 'backpack', 'wings', 'jetpack'];

export const HATN: Record<string, string> = {
  none: 'None',
  cap: 'Red Cap',
  crown: 'Crown',
  party: 'Party Hat',
  wizard: 'Wizard Hat',
  tophat: 'Top Hat',
  cowboy: 'Cowboy Hat',
  chef: 'Chef Hat',
  viking: 'Viking Helmet',
  halo: 'Halo',
  propeller: 'Propeller Cap',
};

export const FACEN: Record<string, string> = {
  none: 'None',
  shades: 'Sunglasses',
  glasses: 'Round Glasses',
  goggles: 'Swim Goggles',
  eyepatch: 'Eye Patch',
  pink: 'Pink Shades',
};

export const BACKN: Record<string, string> = {
  none: 'None',
  cape: 'Hero Cape',
  backpack: 'Backpack',
  wings: 'Angel Wings',
  jetpack: 'Jetpack',
};

export const BOTC = ['#ff5a5a', '#ffb23c', '#7be04a', '#3cd7ff', '#b06bff', '#ff6bd5', '#ffe14a', '#4affb0'];

export const WK: Record<string, number> = {
  shark: 1, vortex: 2, cane: 3, hook: 4, hammer: 5, bomb: 6, banana: 7, hole: 8, ice: 9,
};
export const KW: Record<number, string> = {
  1: 'shark', 2: 'vortex', 3: 'cane', 4: 'hook', 5: 'hammer', 6: 'bomb', 7: 'banana', 8: 'hole', 9: 'ice',
};
export const WN: Record<string, string> = {
  shark: 'Shark Gun',
  vortex: 'Vortex Cannon',
  cane: 'Candy Cane',
  hook: 'Grappling Hook',
  hammer: 'Big Hammer',
  bomb: 'Bomb',
  banana: 'Banana Peel',
  hole: 'Black Hole Blaster',
  ice: 'Ice Machine',
};
export const WI: Record<string, string> = {
  hole: '⚫', ice: '🧊', hammer: '🔨', bomb: '💣', banana: '🍌', hook: '🪝', shark: '🦈', vortex: '🌀', cane: '🍬',
};
export const WCD: Record<string, number> = {
  shark: 700, vortex: 1100, hook: 1500, bomb: 1200, banana: 900, hole: 250, ice: 80,
};
export const WAM: Record<string, number> = {
  shark: 5, vortex: 6, cane: 0, hook: 3, hammer: 0, bomb: 3, banana: 3, hole: 1, ice: 70,
};

export const ATK: Record<string, [number, number]> = {
  l: [16, 8.5],
  r: [16, 8.5],
  h: [38, 13],
  k: [26, 13.5],
  c: [54, 17],
  m: [62, 20],
};

// Longer KO duration so grabbing & tossing knocked-out rivals feels crisp and tactical
export const KO_MS = 3200;

export const MAPK = [
  'arena0', 'arena1', 'arena2', 'arena3', 'arena4', 'arena5',
  'arena6', 'arena7', 'arena8', 'arena9', 'arena10', 'arena11', 'arena12',
] as const;

export type MapKey = (typeof MAPK)[number];
export type SceneKey = 'lobby' | MapKey;

export const MAPN: Record<MapKey, string> = {
  arena0: 'Pirate Deck',
  arena1: 'Shark Reef',
  arena2: 'Neon Cross',
  arena3: 'Pit Ring',
  arena4: 'Tower Steps',
  arena5: 'Shuttle Pads',
  arena6: 'Pillar Park',
  arena7: 'Twin Towers',
  arena8: 'Checker Blocks',
  arena9: 'Colosseum',
  arena10: 'Ring Road',
  arena11: 'Double Decker',
  arena12: 'Crate Yard',
};

export const MAP_HAZARD_NAME: Record<MapKey, string> = {
  arena0: 'Pirate Armada Cannons',
  arena1: 'Hungry Reef Sharks',
  arena2: 'Rotating Laser Grid',
  arena3: 'Volcanic Magma Meteors',
  arena4: 'Rolling Temple Boulders',
  arena5: 'Rogue Bumper Shuttles',
  arena6: 'Arcane Sky-Bolt Beacons',
  arena7: 'Siege Mortar Barrage',
  arena8: 'Collapsing Floor Tiles',
  arena9: 'Charging Arena Rollers',
  arena10: 'Runaway Hover Trains',
  arena11: 'Swinging Crusher Arms',
  arena12: 'Sky Crane TNT Drops',
};

export const MAP_THEME: Record<SceneKey, {
  skyTop: string;
  skyMid: string;
  skyBot: string;
  fog: string;
  sunColor: string;
  hemiSky: string;
  hemiGround: string;
  water?: boolean;
  waterColor?: string;
  lava?: boolean;
}> = {
  lobby:   { skyTop: '#0f172a', skyMid: '#3b2478', skyBot: '#f472b6', fog: '#2d1e5a', sunColor: '#fff1d6', hemiSky: '#c7d2fe', hemiGround: '#4c1d95' },
  arena0:  { skyTop: '#0c4a6e', skyMid: '#38bdf8', skyBot: '#fde68a', fog: '#7dd3fc', sunColor: '#fff4cc', hemiSky: '#bae6fd', hemiGround: '#0369a1', water: true, waterColor: '#0284c7' },
  arena1:  { skyTop: '#0369a1', skyMid: '#22d3ee', skyBot: '#fef3c7', fog: '#67e8f9', sunColor: '#fffbeb', hemiSky: '#cffafe', hemiGround: '#0e7490', water: true, waterColor: '#06b6d4' },
  arena2:  { skyTop: '#050816', skyMid: '#1e1b4b', skyBot: '#c026d3', fog: '#1e1b4b', sunColor: '#e0e7ff', hemiSky: '#818cf8', hemiGround: '#312e81' },
  arena3:  { skyTop: '#1c0a0a', skyMid: '#7c2d12', skyBot: '#f97316', fog: '#431407', sunColor: '#fed7aa', hemiSky: '#fdba74', hemiGround: '#7c2d12', lava: true },
  arena4:  { skyTop: '#0f172a', skyMid: '#0e7490', skyBot: '#a5f3fc', fog: '#155e75', sunColor: '#fef08a', hemiSky: '#bae6fd', hemiGround: '#164e63' },
  arena5:  { skyTop: '#090d1f', skyMid: '#312e81', skyBot: '#38bdf8', fog: '#1e1b4b', sunColor: '#e0f2fe', hemiSky: '#93c5fd', hemiGround: '#1e1b4b' },
  arena6:  { skyTop: '#1e3a5f', skyMid: '#60a5fa', skyBot: '#fef08a', fog: '#93c5fd', sunColor: '#fffbeb', hemiSky: '#dbeafe', hemiGround: '#365314' },
  arena7:  { skyTop: '#1f1635', skyMid: '#6d28d9', skyBot: '#fb923c', fog: '#4c1d95', sunColor: '#fed7aa', hemiSky: '#ddd6fe', hemiGround: '#3b0764' },
  arena8:  { skyTop: '#0c1e35', skyMid: '#1d4ed8', skyBot: '#bae6fd', fog: '#1e40af', sunColor: '#ffffff', hemiSky: '#bfdbfe', hemiGround: '#1e293b' },
  arena9:  { skyTop: '#29150b', skyMid: '#b45309', skyBot: '#fde68a', fog: '#78350f', sunColor: '#fef3c7', hemiSky: '#fde68a', hemiGround: '#451a03' },
  arena10: { skyTop: '#04121f', skyMid: '#0f4c5c', skyBot: '#2ec4b6', fog: '#0b3b49', sunColor: '#e0fbfc', hemiSky: '#a5f3fc', hemiGround: '#134e4a' },
  arena11: { skyTop: '#06201a', skyMid: '#0f766e', skyBot: '#99f6e4', fog: '#115e59', sunColor: '#ecfdf5', hemiSky: '#ccfbf1', hemiGround: '#134e4a' },
  arena12: { skyTop: '#18181b', skyMid: '#52525b', skyBot: '#f59e0b', fog: '#3f3f46', sunColor: '#fef3c7', hemiSky: '#e4e4e7', hemiGround: '#27272a' },
};

export interface SolidBox {
  x: number;
  z: number;
  hw: number;
  hd: number;
  top: number;
  bottom: number;
  m: THREE.Mesh;
  dx: number;
  dy: number;
  dz: number;
  held: boolean;
  crate?: boolean;
  tileIdx?: number;
  baseTop?: number;
  baseY?: number;
}

export interface CrateObj {
  i: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  held: number;
  s: SolidBox;
  ox: number;
  oy: number;
  oz: number;
  hc: number;
  lh: number;
  lift: boolean;
  tx: number;
  ty: number;
  tz: number;
  sup: SolidBox | null;
}

export interface PickupObj {
  k: string;
  x: number;
  z: number;
  y: number;
  on: boolean;
  off?: boolean;
  t: number;
  m: THREE.Group;
  w: THREE.Group;
}

export interface LocalSlot {
  pad: 'kb' | 'touch' | number;
  head: string;
  hat: string;
  face: string;
  back: string;
  color: string;
  pants: string;
  row: number;
  team: number;
  ready: boolean;
}

export interface FriendState {
  on: boolean;
  party: string | null;
}

export interface AccountData {
  name: string;
  salt: string;
  hash: string;
  friends: string[];
  reqIn: string[];
  reqOut: string[];
}

export interface ToastItem {
  id: number;
  text: string;
  inviteCode?: string;
  from?: string;
}

export interface PaneInfo {
  id: number;
  name: string;
  color: string;
  team: number;
  alive: boolean;
  dz: number;
  air: number;
  wp: string | null;
  am: number;
  note: string;
  rect: { x: number; y: number; w: number; h: number };
}

export type GameMode = 'ffa' | 'team' | 'ctf' | 'koth';

export const MODE_LABELS: Record<GameMode, string> = {
  ffa: 'Free-for-All',
  team: 'Team Battle',
  ctf: 'Capture the Flag',
  koth: 'Capture Zone',
};

export interface FlagSnap {
  team: number; // 0 = Red, 1 = Blue
  x: number;
  y: number;
  z: number;
  bx: number;
  by: number;
  bz: number;
  carrierId: number; // 0 if on ground/stand
  atBase: boolean;
}

export interface ZoneSnap {
  x: number;
  y: number;
  z: number;
  r: number;
  ownerId: number; // player id capturing (or 0)
  ownerName: string;
  ownerColor: string;
  progress: number; // 0..100
  contested: boolean;
}

export interface RoundSummaryRow {
  id: number;
  name: string;
  color: string;
  team: number;
  prevScore: number;
  newScore: number;
  earned: boolean;
}

export interface RoundSummary {
  roundNum: number;
  mapName: string;
  winnerName: string;
  winnerColor: string;
  winnerTeam: number; // -1 for FFA/KOTH solo, 0 Red, 1 Blue
  reason: string;
  isMatchEnd: boolean;
  mode: GameMode;
  prevTscore: [number, number];
  tscore: [number, number];
  rows: RoundSummaryRow[];
}

export interface UISnapshot {
  screen: 'menu' | 'local' | 'game';
  phase: SceneKey;
  mode: GameMode;
  code: string;
  isHost: boolean;
  netOn: boolean;
  localMode: boolean;
  roundNum: number;
  tscore: [number, number];
  banner: string;
  hazardStatus: string;
  hazardLevel: number;
  err: string;
  lmHint: string;
  diff: number;
  slots: (LocalSlot | null)[];
  lmMode: GameMode;
  lmMap: 'random' | MapKey;
  lmBots: number;
  lmBotsEffective: number;
  lmNet: 'off' | 'host' | 'join' | 'quick';
  lmCode: string;
  lmAllReady: boolean;
  kbJoined: boolean;
  players: {
    id: number;
    name: string;
    score: number;
    team: number;
    alive: boolean;
    respawnSec: number;
    dz: number;
    air: number;
    wp: string | null;
    am: number;
    color: string;
    bot: boolean;
  }[];
  flags: FlagSnap[];
  zone: ZoneSnap | null;
  roundSummary: RoundSummary | null;
  loadingLabel: string | null;
  loadingSub: string | null;
  myId: number;
  myTeamPref: number;
  muted: boolean;
  micOK: boolean;
  panes: PaneInfo[];
  touchDevice: boolean;
  padConnected: boolean;
  padCount: number;
  menuFocusIdx: number;
  menuSubModal: 'none' | 'controls' | 'code' | 'friends';
  codeChars: [string, string, string, string];
  codeCursor: number;
  pauseOpen: boolean;
  pauseIdx: number;
  bindings: ControlBindings;
  acctUser: string;
  acctLoggedIn: boolean;
  cloudSignedIn: boolean;
  cloudBusy: boolean;
  cloudEmail: string | null;
  savedUsers: string[];
  friendsOpen: boolean;
  friendsStatus: Record<string, FriendState>;
  friendsInv: Record<string, string>;
  friendsMsg: string;
  friendsList: string[];
  reqIn: string[];
  reqOut: string[];
  presOK: boolean;
  toasts: ToastItem[];
}

export type BindAction = 'jump' | 'headbutt' | 'kick' | 'leftHand' | 'rightHand' | 'lift' | 'fire' | 'dance';
export type PadBindKey = 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'lt' | 'rt' | 'ls';

export interface ControlBindings {
  kb: Record<BindAction, string>;
  pad: Record<BindAction, PadBindKey>;
}

export const PAD_BIND_LABELS: Record<PadBindKey, string> = {
  a: 'A',
  b: 'B',
  x: 'X',
  y: 'Y',
  lb: 'LB',
  rb: 'RB',
  lt: 'LT',
  rt: 'RT',
  ls: 'L-Stick',
};

export const DEFAULT_BINDINGS: ControlBindings = {
  kb: {
    jump: ' ',
    headbutt: 'q',
    kick: 'e',
    leftHand: 'z',
    rightHand: 'x',
    lift: 'shift',
    fire: 'f',
    dance: 'c',
  },
  pad: {
    jump: 'a',
    headbutt: 'x',
    kick: 'b',
    leftHand: 'lb',
    rightHand: 'rb',
    lift: 'lt',
    fire: 'rt',
    dance: 'y',
  },
};

