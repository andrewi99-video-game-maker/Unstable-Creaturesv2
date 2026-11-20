import Peer, { DataConnection } from 'peerjs';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../firebase';
import { AccountData, FriendState, ToastItem } from './types';

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

const PID = (n: string) => 'uc-u-' + String(n).toLowerCase();

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  {
    urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'],
    username: 'peerjs',
    credential: 'peerjsp',
  },
  {
    urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export function createPeerInstance(id?: string): Peer {
  const opts = {
    debug: 0 as const,
    config: {
      iceServers: ICE_SERVERS,
      sdpSemantics: 'unified-plan' as const,
      iceCandidatePoolSize: 2,
    },
  };
  return id ? new Peer(id, opts) : new Peer(opts);
}

const store = {
  get<T>(k: string): T | null {
    try {
      return JSON.parse(localStorage.getItem(k) || 'null') as T | null;
    } catch {
      return null;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      // ignore storage quota errors
    }
  },
  del(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      // ignore
    }
  },
};

function sanitizeUsernameList(list: string[], maxItems: number, minLen: number): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const clean = String(raw || '').trim().slice(0, 14);
    if (clean.length < minLen) continue;
    if (minLen >= 3 && !/^[A-Za-z0-9_-]{3,14}$/.test(clean)) continue;
    if (!out.some((x) => x.toLowerCase() === clean.toLowerCase())) {
      out.push(clean);
    }
    if (out.length >= maxItems) break;
  }
  return out;
}

function deriveBaseUsername(user: User, preferred?: string): string {
  const candidates = [preferred || '', user.displayName || '', (user.email || '').split('@')[0] || ''];
  for (const c of candidates) {
    const stripped = c.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 14);
    if (stripped.length >= 3 && !/^Player\d{4}$/i.test(stripped)) {
      return stripped;
    }
  }
  return ('Player' + user.uid.replace(/[^A-Za-z0-9]/g, '').slice(0, 5)).slice(0, 14);
}

async function hashPw(pw: string, salt: string): Promise<string> {
  try {
    if (window.crypto && crypto.subtle) {
      const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
      const b = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 50000, hash: 'SHA-256' },
        k,
        256
      );
      return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // fallback below
  }
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (const ch of salt + pw) {
    const c = ch.charCodeAt(0);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  return 'f' + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
}

export class FriendsService {
  public user = '';
  public isGuest = true;
  public cloudUid: string | null = null;
  public cloudEmail: string | null = null;
  public cloudBusy = false;
  public data: AccountData = { name: '', salt: '', hash: '', friends: [], reqIn: [], reqOut: [] };
  public st: Record<string, FriendState> = {};
  public inv: Record<string, string> = {};
  public msg = '';
  public presOK = false;
  public toasts: ToastItem[] = [];
  public savedUsers: string[] = [];

  private pres: Peer | null = null;
  private presUser = '';
  private invQ = new Set<string>();
  private pollBusy = false;
  private toastSeq = 1;
  private cloudSyncTimer: ReturnType<typeof setTimeout> | null = null;
  private onChanged: () => void;
  private getPartyContext: () => {
    netOn: boolean;
    code: string;
    joined: boolean;
    phase: string;
    playerCount: number;
    playerAccts: string[];
  };
  private onAcceptInvite: (code: string) => void;

  constructor(
    onChanged: () => void,
    getPartyContext: () => {
      netOn: boolean;
      code: string;
      joined: boolean;
      phase: string;
      playerCount: number;
      playerAccts: string[];
    },
    onAcceptInvite: (code: string) => void
  ) {
    this.onChanged = onChanged;
    this.getPartyContext = getPartyContext;
    this.onAcceptInvite = onAcceptInvite;

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.pres && this.pres.disconnected && !this.pres.destroyed) {
        try {
          this.pres.reconnect();
        } catch {
          // ignore
        }
      }
    });
    const releasePeer = () => {
      try {
        this.pres?.destroy();
      } catch {
        // ignore
      }
      this.pres = null;
      this.presUser = '';
      this.presOK = false;
    };
    window.addEventListener('pagehide', releasePeer);
    window.addEventListener('beforeunload', releasePeer);

    setInterval(() => {
      if (this.user && !this.isGuest) this.pollFriends();
    }, 12000);

    onAuthStateChanged(auth, (fbUser) => {
      if (fbUser && fbUser.emailVerified) {
        void this.hydrateCloudUser(fbUser);
      } else if (this.cloudUid) {
        this.cloudUid = null;
        this.cloudEmail = null;
        this.onChanged();
      }
    });
  }

  public rememberUsername(name: string): void {
    const clean = name.trim().slice(0, 14);
    if (!clean) return;
    const prev = store.get<string[]>('uc_saved_users') || [];
    const next = sanitizeUsernameList([clean, ...prev], 8, 2);
    store.set('uc_saved_users', next);
    this.savedUsers = next;
    this.scheduleCloudSync();
  }

  public removeSavedUsername(name: string): void {
    const prev = store.get<string[]>('uc_saved_users') || [];
    const next = prev.filter((u) => u.toLowerCase() !== name.toLowerCase());
    store.set('uc_saved_users', next);
    this.savedUsers = next;
    this.scheduleCloudSync();
    this.onChanged();
  }

  public setGuestUsername(raw: string): string | null {
    const u = raw.trim().slice(0, 14);
    if (u.length < 2) return 'Username must be at least 2 characters';
    store.set('uc_guest_name', u);
    this.rememberUsername(u);
    if (this.isGuest) {
      this.user = u;
      this.data.name = u;
    }
    this.onChanged();
    return null;
  }

  public hasStoredAccount(username: string): boolean {
    const all = store.get<Record<string, AccountData>>('uc_accts') || {};
    return !!all[username.trim().toLowerCase()];
  }

  public initAutoSession(): void {
    const all = store.get<Record<string, AccountData>>('uc_accts') || {};
    const storedUsers = store.get<string[]>('uc_saved_users') || [];
    const merged = [...storedUsers];
    for (const k of Object.keys(all)) {
      const n = all[k]?.name;
      if (n && !merged.some((u) => u.toLowerCase() === n.toLowerCase())) merged.push(n);
    }
    this.savedUsers = sanitizeUsernameList(merged, 8, 2);
    store.set('uc_saved_users', this.savedUsers);

    const sess = store.get<string>('uc_session');
    if (sess && all[String(sess).toLowerCase()]) {
      this.loginWithData(all[String(sess).toLowerCase()], false);
      return;
    }
    let guestName = store.get<string>('uc_guest_name');
    if (!guestName) {
      guestName = this.savedUsers[0] || 'Player' + String(1000 + Math.floor(Math.random() * 9000));
      store.set('uc_guest_name', guestName);
    }
    this.rememberUsername(guestName);
    this.user = guestName;
    this.isGuest = true;
    this.data = { name: guestName, salt: '', hash: '', friends: [], reqIn: [], reqOut: [] };
    this.onChanged();
  }

  // ---------------- Firebase Cloud Accounts (Cross-Device Sync) ----------------

  public async signInWithGoogle(): Promise<string | null> {
    if (this.cloudBusy) return null;
    this.cloudBusy = true;
    this.msg = 'Opening Google sign-in…';
    this.onChanged();
    try {
      const res = await signInWithPopup(auth, googleProvider);
      if (!res.user.emailVerified) {
        this.cloudBusy = false;
        this.msg = 'Google account email must be verified for cloud sync.';
        this.onChanged();
        return this.msg;
      }
      await this.hydrateCloudUser(res.user);
      this.cloudBusy = false;
      this.onChanged();
      return null;
    } catch (err) {
      this.cloudBusy = false;
      const m = err instanceof Error ? err.message : String(err);
      if (m.includes('popup-closed-by-user')) {
        this.msg = 'Sign-in cancelled.';
      } else {
        this.msg = 'Cloud sign-in could not complete. Try again.';
      }
      this.onChanged();
      return this.msg;
    }
  }

  public async signOutCloud(): Promise<void> {
    this.cloudUid = null;
    this.cloudEmail = null;
    try {
      await signOut(auth);
    } catch {
      // ignore sign-out error
    }
    this.logoutToGuest();
  }

  private async hydrateCloudUser(fbUser: User): Promise<void> {
    this.cloudUid = fbUser.uid;
    this.cloudEmail = fbUser.email || null;
    this.cloudBusy = true;
    this.onChanged();

    const userPath = `users/${fbUser.uid}`;
    try {
      const userSnap = await getDoc(doc(db, 'users', fbUser.uid));
      const localSaved = store.get<string[]>('uc_saved_users') || [];

      if (userSnap.exists()) {
        const d = userSnap.data() as {
          username?: string;
          savedUsers?: string[];
          friends?: string[];
          reqIn?: string[];
          reqOut?: string[];
        };
        const username = String(d.username || deriveBaseUsername(fbUser)).slice(0, 14);
        const mergedSaved = sanitizeUsernameList([username, ...(d.savedUsers || []), ...localSaved], 8, 2);
        this.savedUsers = mergedSaved;
        store.set('uc_saved_users', mergedSaved);

        const acctData: AccountData = {
          name: username,
          salt: '',
          hash: '',
          friends: sanitizeUsernameList((d.friends || []).map((x) => x.toLowerCase()), 50, 3),
          reqIn: sanitizeUsernameList((d.reqIn || []).map((x) => x.toLowerCase()), 50, 3),
          reqOut: sanitizeUsernameList((d.reqOut || []).map((x) => x.toLowerCase()), 50, 3),
        };
        await this.loginAsync(acctData);

        if (JSON.stringify(mergedSaved) !== JSON.stringify(d.savedUsers || [])) {
          await this.syncCloudAccount();
        }
      } else {
        // First-time cloud setup: pick unique username across devices
        const base = deriveBaseUsername(fbUser, this.isGuest ? undefined : this.user);
        let chosen = base;
        for (let attempt = 0; attempt < 6; attempt++) {
          const candidate =
            attempt === 0
              ? chosen
              : `${base.slice(0, 10)}${Math.floor(100 + Math.random() * 899)}`.slice(0, 14);
          const lower = candidate.toLowerCase();
          const pubSnap = await this.safeGetPublicProfile(lower);
          if (!pubSnap || pubSnap.uid === fbUser.uid) {
            chosen = candidate;
            break;
          }
        }

        const mergedSaved = sanitizeUsernameList([chosen, ...localSaved], 8, 2);
        const friends = sanitizeUsernameList((this.data.friends || []).map((x) => x.toLowerCase()), 50, 3);
        const reqIn = sanitizeUsernameList((this.data.reqIn || []).map((x) => x.toLowerCase()), 50, 3);
        const reqOut = sanitizeUsernameList((this.data.reqOut || []).map((x) => x.toLowerCase()), 50, 3);

        const pubPath = `publicProfiles/${chosen.toLowerCase()}`;
        try {
          await setDoc(doc(db, 'publicProfiles', chosen.toLowerCase()), {
            uid: fbUser.uid,
            username: chosen,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, pubPath);
        }

        try {
          await setDoc(doc(db, 'users', fbUser.uid), {
            uid: fbUser.uid,
            username: chosen,
            savedUsers: mergedSaved,
            friends,
            reqIn,
            reqOut,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, userPath);
        }

        this.savedUsers = mergedSaved;
        store.set('uc_saved_users', mergedSaved);
        await this.loginAsync({ name: chosen, salt: '', hash: '', friends, reqIn, reqOut });
      }
      this.msg = `Cloud synced as ${this.user}`;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('{')) {
        throw err;
      }
      handleFirestoreError(err, OperationType.GET, userPath);
    } finally {
      this.cloudBusy = false;
      this.onChanged();
    }
  }

  private async safeGetPublicProfile(lower: string): Promise<{ uid: string; username: string } | null> {
    const p = `publicProfiles/${lower}`;
    try {
      const s = await getDoc(doc(db, 'publicProfiles', lower));
      if (!s.exists()) return null;
      return s.data() as { uid: string; username: string };
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, p);
    }
  }

  public async setCloudUsername(raw: string): Promise<string | null> {
    const clean = raw.trim();
    if (!/^[A-Za-z0-9_-]{3,14}$/.test(clean)) {
      return 'Username: 3-14 letters, numbers, _ or -';
    }
    if (!this.cloudUid) {
      return this.setGuestUsername(clean);
    }
    const nextLower = clean.toLowerCase();
    const prevLower = this.user.toLowerCase();
    this.cloudBusy = true;
    this.onChanged();

    try {
      const existingClaim = await this.safeGetPublicProfile(nextLower);
      if (existingClaim && existingClaim.uid !== this.cloudUid) {
        this.cloudBusy = false;
        this.onChanged();
        return 'That username is already claimed by another player.';
      }

      const pubPath = `publicProfiles/${nextLower}`;
      try {
        await setDoc(doc(db, 'publicProfiles', nextLower), {
          uid: this.cloudUid,
          username: clean,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, pubPath);
      }

      if (prevLower && prevLower !== nextLower && /^[a-z0-9_-]{3,14}$/.test(prevLower)) {
        const oldPath = `publicProfiles/${prevLower}`;
        try {
          const oldSnap = await this.safeGetPublicProfile(prevLower);
          if (oldSnap && oldSnap.uid === this.cloudUid) {
            await deleteDoc(doc(db, 'publicProfiles', prevLower));
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, oldPath);
        }
      }

      this.data.name = clean;
      this.user = clean;
      this.rememberUsername(clean);
      await this.syncCloudAccount();
      await this.loginAsync(this.data);
      this.msg = `Username updated to ${clean} across devices!`;
      this.cloudBusy = false;
      this.onChanged();
      return null;
    } catch (err) {
      this.cloudBusy = false;
      this.onChanged();
      throw err;
    }
  }

  private scheduleCloudSync(): void {
    if (!this.cloudUid || this.isGuest) return;
    if (this.cloudSyncTimer) clearTimeout(this.cloudSyncTimer);
    this.cloudSyncTimer = setTimeout(() => {
      void this.syncCloudAccount();
    }, 350);
  }

  private async syncCloudAccount(): Promise<void> {
    if (!this.cloudUid || this.isGuest) return;
    if (!/^[A-Za-z0-9_-]{3,14}$/.test(this.user)) return;
    const path = `users/${this.cloudUid}`;
    try {
      await updateDoc(doc(db, 'users', this.cloudUid), {
        username: this.user,
        savedUsers: sanitizeUsernameList(this.savedUsers, 8, 2),
        friends: sanitizeUsernameList(this.data.friends.map((x) => x.toLowerCase()), 50, 3),
        reqIn: sanitizeUsernameList(this.data.reqIn.map((x) => x.toLowerCase()), 50, 3),
        reqOut: sanitizeUsernameList(this.data.reqOut.map((x) => x.toLowerCase()), 50, 3),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  public pushToast(text: string, ms = 4500, inviteCode?: string, from?: string): void {
    const id = this.toastSeq++;
    this.toasts = [...this.toasts, { id, text, inviteCode, from }];
    this.onChanged();
    if (ms > 0) {
      setTimeout(() => this.dismissToast(id), ms);
    }
  }

  public dismissToast(id: number): void {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.onChanged();
  }

  public async register(username: string, password: string, confirm: string): Promise<string | null> {
    const u = username.trim();
    if (!/^[A-Za-z0-9_-]{3,14}$/.test(u)) return 'Username: 3-14 letters, numbers, _ or -';
    if (password.length < 4) return 'Password: at least 4 characters';
    if (password !== confirm) return 'Passwords do not match';
    const all = store.get<Record<string, AccountData>>('uc_accts') || {};
    const key = u.toLowerCase();
    if (all[key]) return 'Username already exists — log in instead';
    const salt = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const data: AccountData = { name: u, salt, hash: await hashPw(password, salt), friends: [], reqIn: [], reqOut: [] };
    all[key] = data;
    store.set('uc_accts', all);
    return await this.loginAsync(data);
  }

  public async login(username: string, password: string): Promise<string | null> {
    const u = username.trim();
    if (!/^[A-Za-z0-9_-]{3,14}$/.test(u)) return 'Enter a valid username (3-14 chars)';
    const all = store.get<Record<string, AccountData>>('uc_accts') || {};
    const d = all[u.toLowerCase()];
    if (!d) return 'Not found in browser cache — Sign in with Google above to sync across devices';
    if ((await hashPw(password, d.salt)) !== d.hash) return 'Wrong password';
    return await this.loginAsync(d);
  }

  public logoutToGuest(): void {
    store.del('uc_session');
    try {
      this.pres?.destroy();
    } catch {
      // ignore
    }
    this.pres = null;
    this.presUser = '';
    this.presOK = false;
    this.st = {};
    this.inv = {};
    this.msg = '';
    this.initAutoSession();
  }

  private loginWithData(data: AccountData, _interactive: boolean): void {
    void this.loginAsync(data);
  }

  private loginAsync(data: AccountData): Promise<string | null> {
    data.friends = data.friends || [];
    data.reqIn = data.reqIn || [];
    data.reqOut = data.reqOut || [];
    this.user = data.name;
    this.isGuest = false;
    this.data = data;
    this.msg = 'Connecting friends service…';
    this.onChanged();

    return new Promise((resolve) => {
      this.claimPresence(0, (res) => {
        this.presOK = res === 'ok';
        this.msg =
          res === 'ok'
            ? ''
            : res === 'taken'
              ? 'Signed in (friends presence active in another tab/device)'
              : 'Friends service offline (local gameplay unaffected)';
        if (!this.cloudUid) store.set('uc_session', data.name);
        store.set('uc_guest_name', data.name);
        this.rememberUsername(data.name);
        this.onChanged();
        if (this.presOK) void this.pollFriends();
        resolve(null);
      });
    });
  }

  private saveAcct(): void {
    if (this.isGuest) return;
    if (!this.cloudUid) {
      const all = store.get<Record<string, AccountData>>('uc_accts') || {};
      all[this.user.toLowerCase()] = this.data;
      store.set('uc_accts', all);
    }
    this.scheduleCloudSync();
  }

  private claimPresence(tries: number, done: (res: 'ok' | 'taken' | 'offline') => void): void {
    const targetLower = this.user.toLowerCase();
    if (this.pres && !this.pres.destroyed && !this.pres.disconnected && this.presOK && this.presUser === targetLower) {
      done('ok');
      return;
    }
    try {
      this.pres?.destroy();
    } catch {
      // ignore
    }
    this.presUser = '';
    let fin = false;
    const pr = (this.pres = createPeerInstance(PID(this.user)));
    const tm = setTimeout(() => {
      if (!fin) {
        fin = true;
        done('offline');
      }
    }, 9000);

    pr.on('open', () => {
      if (fin || pr !== this.pres) return;
      fin = true;
      clearTimeout(tm);
      this.presUser = targetLower;
      pr.on('connection', (c) => c.on('data', (m) => this.presMsg(c, m as Record<string, unknown>)));
      pr.on('disconnected', () =>
        setTimeout(() => {
          try {
            if (!pr.destroyed) pr.reconnect();
          } catch {
            // ignore
          }
        }, 1000)
      );
      done('ok');
    });

    pr.on('error', (e: { type?: string }) => {
      if (fin || pr !== this.pres) return;
      fin = true;
      clearTimeout(tm);
      try {
        pr.destroy();
      } catch {
        // ignore
      }
      if (e?.type === 'unavailable-id') {
        if (tries < 3) setTimeout(() => this.claimPresence(tries + 1, done), 2500);
        else done('taken');
      } else {
        done('offline');
      }
    });
  }

  private probe(name: string, msg: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    return new Promise((res) => {
      if (!this.pres || this.pres.destroyed || !this.presOK) {
        res(null);
        return;
      }
      let done = false;
      let c: DataConnection | null = null;
      const fin = (v: Record<string, unknown> | null) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        try {
          c?.close();
        } catch {
          // ignore
        }
        res(v);
      };
      const t = setTimeout(() => fin(null), 6000);
      try {
        c = this.pres.connect(PID(name), { reliable: true, serialization: 'json' });
        c.on('open', () => {
          try {
            c?.send(msg);
          } catch {
            fin(null);
          }
        });
        c.on('data', (m) => fin(m as Record<string, unknown>));
        c.on('error', () => fin(null));
        c.on('close', () => fin(null));
      } catch {
        fin(null);
      }
    });
  }

  private myParty(): string | null {
    const ctx = this.getPartyContext();
    return ctx.netOn && ctx.code && ctx.code !== 'LOCAL' && ctx.joined && ctx.phase === 'lobby' && ctx.playerCount < 8
      ? ctx.code
      : null;
  }

  private addFriendLocal(n: string): void {
    const d = this.data;
    if (!d.friends.includes(n)) d.friends.push(n);
    d.reqIn = d.reqIn.filter((x) => x !== n);
    d.reqOut = d.reqOut.filter((x) => x !== n);
    this.saveAcct();
    this.msg = `${n} is now your friend!`;
    this.onChanged();
    void this.pollFriends();
  }

  private presMsg(c: DataConnection, m: Record<string, unknown>): void {
    if (this.isGuest || !this.user || !m) return;
    const pn = (c.peer || '').startsWith('uc-u-') ? c.peer.slice(5) : '';
    if (!pn || pn === this.user.toLowerCase()) return;
    const f = this.data.friends.includes(pn);

    if (m.t === 'ping') {
      c.send({ t: 'pong', party: f ? this.myParty() : null });
    } else if (m.t === 'freq') {
      if (f || this.data.reqOut.includes(pn)) {
        this.addFriendLocal(pn);
        c.send({ t: 'facc' });
      } else {
        if (!this.data.reqIn.includes(pn)) {
          this.data.reqIn.push(pn);
          this.saveAcct();
          this.pushToast(`${pn} wants to be your friend!`, 6000);
        }
        this.onChanged();
        c.send({ t: 'ack' });
      }
    } else if (m.t === 'facc') {
      if (this.data.reqOut.includes(pn)) this.addFriendLocal(pn);
    } else if (m.t === 'invite') {
      if (f && typeof m.code === 'string' && /^[A-Za-z0-9]{2,4}$/.test(m.code)) {
        const cUpper = m.code.toUpperCase();
        this.pushToast(`${pn} invited you to play!`, 30000, cUpper, pn);
        c.send({ t: 'ack' });
      }
    }
  }

  public async pollFriends(): Promise<void> {
    if (this.pollBusy || this.isGuest || !this.user || !this.presOK) return;
    this.pollBusy = true;
    const d = this.data;
    try {
      await Promise.all([
        ...d.friends.map(async (n) => {
          const r = await this.probe(n, { t: 'ping' });
          this.st[n] =
            r && r.t === 'pong' ? { on: true, party: (r.party as string) || null } : { on: false, party: null };
        }),
        ...d.reqOut.map(async (n) => {
          const r = await this.probe(n, { t: 'freq' });
          if (r && r.t === 'facc') this.addFriendLocal(n);
        }),
      ]);
    } catch {
      // ignore
    }
    this.pollBusy = false;
    this.onChanged();
  }

  public addFriend(raw: string): void {
    if (this.isGuest) {
      this.msg = 'Sign in with Google or create an account first to add friends.';
      this.onChanged();
      return;
    }
    const n = String(raw || '').trim().toLowerCase();
    if (!/^[a-z0-9_-]{3,14}$/.test(n)) {
      this.msg = 'Type their username (3-14 letters, numbers, _ or -)';
      this.onChanged();
      return;
    }
    if (n === this.user.toLowerCase()) {
      this.msg = 'That is your own username!';
      this.onChanged();
      return;
    }
    if (this.data.friends.includes(n)) {
      this.msg = `${n} is already your friend`;
      this.onChanged();
      return;
    }
    if (this.data.reqIn.includes(n)) {
      this.acceptReq(n);
      return;
    }
    if (!this.data.reqOut.includes(n)) {
      this.data.reqOut.push(n);
      this.saveAcct();
    }
    this.msg = `Sending request to ${n}…`;
    this.onChanged();
    void this.probe(n, { t: 'freq' }).then((r) => {
      if (r && r.t === 'facc') {
        this.addFriendLocal(n);
        return;
      }
      this.msg = r
        ? `${n} is online and received your request`
        : `${n} is offline — request sends when both online`;
      this.onChanged();
    });
  }

  public acceptReq(n: string): void {
    this.addFriendLocal(n);
    void this.probe(n, { t: 'freq' });
  }

  public declineReq(n: string): void {
    this.data.reqIn = this.data.reqIn.filter((x) => x !== n);
    this.saveAcct();
    this.onChanged();
  }

  public cancelReq(n: string): void {
    this.data.reqOut = this.data.reqOut.filter((x) => x !== n);
    this.saveAcct();
    this.onChanged();
  }

  public removeFriend(n: string): void {
    this.data.friends = this.data.friends.filter((x) => x !== n);
    delete this.st[n];
    this.saveAcct();
    this.onChanged();
  }

  public inviteFriend(n: string): void {
    const ctx = this.getPartyContext();
    if (this.myParty() || (ctx.netOn && ctx.code && ctx.code !== 'LOCAL' && ctx.phase === 'lobby')) {
      this.sendInvite(n);
      return;
    }
    this.invQ.add(n);
    this.inv[n] = 'queued';
    this.msg = `Invite queued — open an Online Party and ${n} gets invited automatically`;
    this.onChanged();
  }

  private sendInvite(n: string): void {
    const ctx = this.getPartyContext();
    if (!ctx.code) return;
    this.inv[n] = 'sending';
    this.onChanged();
    void this.probe(n, { t: 'invite', code: ctx.code }).then((r) => {
      this.inv[n] = r ? 'sent' : 'offline';
      this.onChanged();
    });
  }

  public flushInvites(): void {
    const ctx = this.getPartyContext();
    if (!(ctx.netOn && ctx.code && ctx.code !== 'LOCAL')) return;
    [...this.invQ].forEach((n) => this.sendInvite(n));
    this.invQ.clear();
  }

  public joinFromInvite(code: string, toastId?: number): void {
    if (toastId) this.dismissToast(toastId);
    this.onAcceptInvite(code);
  }
}
