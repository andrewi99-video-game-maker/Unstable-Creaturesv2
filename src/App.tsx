import React, { useEffect, useRef, useState } from 'react';
import {
  BACKN,
  CNAME,
  FACEN,
  HATN,
  MAPN,
  MAP_HAZARD_NAME,
  MapKey,
  MODE_LABELS,
  UISnapshot,
  WI,
  WN,
} from './game/types';
import { GameEngine } from './game/engine';

const DIFF_LABELS: Record<number, string> = { 1: 'Normal', 2: 'Hard', 3: 'Brutal' };
const cap1 = (s: string) => s[0].toUpperCase() + s.slice(1);

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const pvRefs = useRef<(HTMLDivElement | null)[]>([null, null, null, null]);

  const [snap, setSnap] = useState<UISnapshot | null>(null);
  const [friendInput, setFriendInput] = useState('');
  const [guestNameInput, setGuestNameInput] = useState('');
  const [cloudNameInput, setCloudNameInput] = useState('');
  const [authTab, setAuthTab] = useState<'login' | 'register'>('register');
  const [authUser, setAuthUser] = useState('');
  const [authPass, setAuthPass] = useState('');
  const [authPass2, setAuthPass2] = useState('');
  const [authErr, setAuthErr] = useState('');

  // Touch joystick visuals
  const [joyVis, setJoyVis] = useState<{ on: boolean; x: number; y: number; dx: number; dy: number }>({
    on: false,
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
  });

  useEffect(() => {
    if (!mountRef.current) return;
    const engine = new GameEngine(mountRef.current);
    engineRef.current = engine;
    const unsub = engine.subscribe((s) => setSnap(s));
    return () => {
      unsub();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Keep character preview card rects synced with Three.js scissor camera
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || snap?.screen !== 'local') return;
    const syncRects = () => {
      for (let i = 0; i < 4; i++) {
        const el = pvRefs.current[i];
        if (!el) {
          eng.setPreviewRect(i, null);
          continue;
        }
        const r = el.getBoundingClientRect();
        eng.setPreviewRect(i, { left: r.left, top: r.top, width: r.width, height: r.height });
      }
    };
    syncRects();
    const ro = new ResizeObserver(syncRects);
    pvRefs.current.forEach((el) => el && ro.observe(el));
    window.addEventListener('resize', syncRects);
    const id = setInterval(syncRects, 250);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', syncRects);
      clearInterval(id);
    };
  }, [snap?.screen, snap?.slots]);

  const eng = engineRef.current;

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eng) return;
    setAuthErr('');
    const err =
      authTab === 'register'
        ? await eng.friends.register(authUser, authPass, authPass2)
        : await eng.friends.login(authUser, authPass);
    if (err) setAuthErr(err);
    else {
      setAuthPass('');
      setAuthPass2('');
    }
  };

  const renderXboxBadge = (btn: string, cls = 'bg-slate-800 text-amber-300 border-amber-400/50') => (
    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold border ${cls} mr-1.5`}>
      {btn}
    </span>
  );

  const arenaName = snap && snap.phase !== 'lobby' ? MAPN[snap.phase as MapKey] || '' : '';
  const hazardName = snap && snap.phase === 'arena1' ? MAP_HAZARD_NAME[snap.phase as MapKey] || '' : '';

  return (
    <div className="relative w-screen h-screen overflow-hidden select-none text-white">
      {/* Isolated WebGL Canvas Mount */}
      <div ref={mountRef} className="fixed inset-0 z-0" />

      {/* Touch Surface Listener when playing on mobile */}
      {snap?.screen === 'game' && snap.touchDevice && (
        <div
          className="fixed inset-0 z-10"
          onTouchStart={(e) => {
            if (!eng) return;
            for (const t of Array.from(e.changedTouches)) {
              const target = t.target as HTMLElement;
              if (target.closest('button,input')) continue;
              eng.touchJoystickStart(t.identifier, t.clientX, t.clientY);
              if (t.clientX < window.innerWidth / 2) {
                setJoyVis({ on: true, x: t.clientX, y: t.clientY, dx: 0, dy: 0 });
              }
            }
          }}
          onTouchMove={(e) => {
            if (!eng) return;
            for (const t of Array.from(e.changedTouches)) {
              const res = eng.touchJoystickMove(t.identifier, t.clientX, t.clientY);
              if (res) setJoyVis((v) => ({ ...v, dx: res.dx, dy: res.dy }));
            }
          }}
          onTouchEnd={(e) => {
            if (!eng) return;
            for (const t of Array.from(e.changedTouches)) {
              if (eng.touchJoystickEnd(t.identifier)) setJoyVis((v) => ({ ...v, on: false }));
            }
          }}
          onTouchCancel={(e) => {
            if (!eng) return;
            for (const t of Array.from(e.changedTouches)) {
              if (eng.touchJoystickEnd(t.identifier)) setJoyVis((v) => ({ ...v, on: false }));
            }
          }}
        />
      )}

      {/* Virtual Joystick Visual */}
      {joyVis.on && (
        <>
          <div
            className="fixed w-28 h-28 rounded-full border-2 border-white/40 bg-white/10 pointer-events-none z-20"
            style={{ left: joyVis.x - 56, top: joyVis.y - 56 }}
          />
          <div
            className="fixed w-12 h-12 rounded-full border-2 border-white/80 bg-white/40 pointer-events-none z-20"
            style={{ left: joyVis.x + joyVis.dx - 24, top: joyVis.y + joyVis.dy - 24 }}
          />
        </>
      )}

      {/* ==================== 1. MAIN MENU ==================== */}
      {snap?.screen === 'menu' && (
        <div className="fixed inset-0 z-20 flex flex-col items-center justify-center p-4 bg-slate-950/65">
          <div className="w-full max-w-xl rounded-2xl bg-slate-900/95 border border-white/15 shadow-2xl p-6 sm:p-8 flex flex-col items-center">
            <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tight text-amber-300 drop-shadow-md text-center">
              UNSTABLE CREATURES
            </h1>
            <p className="text-slate-300 text-sm sm:text-base mt-1 text-center">
              3D Physics Party Brawler — Fight, Grab & Survive 13 Escalating Arenas
            </p>

            {/* Primary Play Buttons (Indices 0..3 for Xbox D-pad) */}
            <div className="w-full mt-6 space-y-3">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <button
                  onMouseEnter={() => eng?.setMenuFocus(0)}
                  onClick={() => eng?.begin('party')}
                  className={`flex-1 py-4 px-5 rounded-xl font-display font-black text-xl text-slate-950 bg-amber-300 hover:bg-amber-200 transition cursor-pointer flex items-center justify-between shadow-lg ${
                    snap.menuFocusIdx === 0 ? 'pad-focus' : ''
                  }`}
                >
                  <div className="text-left">
                    <div>PLAY</div>
                    <div className="text-xs font-sans font-semibold text-slate-900/80">
                      Solo vs Bots · Local Split-Screen · Online Party · Quick Play
                    </div>
                  </div>
                  <span className="text-xl ml-3">▶</span>
                </button>
                <div className="flex sm:flex-col items-center justify-center gap-1 bg-slate-800 rounded-xl p-1.5 border border-white/10">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold px-1">AI Difficulty</div>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3].map((d) => (
                      <button
                        key={d}
                        onClick={() => eng?.setDifficulty(d)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${
                          snap.diff === d ? 'bg-amber-300 text-slate-950' : 'text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {DIFF_LABELS[d]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                onMouseEnter={() => eng?.setMenuFocus(1)}
                onClick={() => eng?.openSubModal('code')}
                className={`w-full py-3 px-4 rounded-xl font-display font-bold text-base bg-slate-800 hover:bg-slate-700 border border-white/15 transition cursor-pointer flex items-center justify-between ${
                  snap.menuFocusIdx === 1 ? 'pad-focus' : ''
                }`}
              >
                <span>Join with Party Code</span>
                <span className="font-mono-num text-amber-300 text-sm tracking-widest">
                  {snap.lmCode || snap.codeChars.join('')}
                </span>
              </button>

              <div className="grid grid-cols-2 gap-2.5">
                <button
                  onMouseEnter={() => eng?.setMenuFocus(2)}
                  onClick={() => eng?.openSubModal('controls')}
                  className={`py-2.5 px-3 rounded-xl font-semibold text-sm bg-slate-800 hover:bg-slate-700 border border-white/10 transition cursor-pointer flex items-center justify-center ${
                    snap.menuFocusIdx === 2 ? 'pad-focus' : ''
                  }`}
                >
                  {renderXboxBadge('X')} Controls & Weapons
                </button>
                <button
                  onMouseEnter={() => eng?.setMenuFocus(3)}
                  onClick={() => eng?.openSubModal('friends')}
                  className={`py-2.5 px-3 rounded-xl font-semibold text-sm bg-slate-800 hover:bg-slate-700 border border-white/10 transition cursor-pointer flex items-center justify-center ${
                    snap.menuFocusIdx === 3 ? 'pad-focus' : ''
                  }`}
                >
                  {renderXboxBadge('Y')} {snap.acctLoggedIn ? snap.acctUser : `User: ${snap.acctUser}`}
                </button>
              </div>
            </div>

            {snap.err && <p className="mt-3 text-rose-400 text-sm font-medium text-center">{snap.err}</p>}

            {/* Controller / Keyboard Navigation Legend */}
            <div className="w-full mt-5 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex items-center">{renderXboxBadge('A', 'bg-emerald-700 text-white border-emerald-400')} Select</span>
                <span>D-Pad / Stick: Navigate</span>
                <span>LB / RB: AI Difficulty</span>
              </div>
              <span className={snap.padConnected ? 'text-emerald-300 font-semibold' : 'text-slate-400'}>
                {snap.padConnected
                  ? `Controller Ready (${snap.padCount} connected)`
                  : 'Plug in Xbox Controller or use Keyboard'}
              </span>
            </div>
          </div>

          {/* Code Modal */}
          {snap.menuSubModal === 'code' && (
            <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/80 p-4">
              <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-white/20 p-6 shadow-2xl">
                <h2 className="font-display text-2xl font-bold text-amber-300">Join Party by Code</h2>
                <p className="text-slate-300 text-xs mt-1">
                  Use D-Pad Left/Right & Up/Down on controller, or type the 4-letter code below.
                </p>

                <div className="flex justify-center gap-3 my-5">
                  {snap.codeChars.map((ch, idx) => (
                    <div
                      key={idx}
                      className={`w-14 h-16 rounded-xl flex items-center justify-center font-mono-num text-3xl font-bold border-2 ${
                        snap.codeCursor === idx
                          ? 'bg-amber-300/20 border-amber-300 text-amber-200'
                          : 'bg-slate-800 border-white/15 text-white'
                      }`}
                    >
                      {ch}
                    </div>
                  ))}
                </div>

                <input
                  type="text"
                  maxLength={4}
                  value={snap.lmCode}
                  placeholder="OR TYPE CODE"
                  onChange={(e) => eng?.updateCodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') eng?.submitCodeModal();
                  }}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-800 border border-white/15 text-center font-mono-num text-lg uppercase tracking-widest mb-4 focus:outline-none focus:border-amber-300"
                />

                <div className="flex gap-2">
                  <button
                    onClick={() => eng?.openSubModal('none')}
                    className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 font-bold cursor-pointer"
                  >
                    B · Cancel
                  </button>
                  <button
                    onClick={() => eng?.submitCodeModal()}
                    className="flex-1 py-2.5 rounded-xl bg-amber-300 text-slate-950 hover:bg-amber-200 font-bold cursor-pointer"
                  >
                    A · Continue
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Controls & Weapons Modal */}
          {snap.menuSubModal === 'controls' && (
            <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/80 p-4">
              <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-white/20 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-display text-2xl font-bold text-amber-300">Controls & Weapons</h2>
                  <button
                    onClick={() => eng?.openSubModal('none')}
                    className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm font-bold cursor-pointer"
                  >
                    B · Close
                  </button>
                </div>
                <div className="space-y-3 text-sm text-slate-200">
                  <div className="p-3 rounded-xl bg-slate-800/80 border border-white/10">
                    <div className="font-bold text-amber-300 mb-1">Xbox Controller</div>
                    <p>Left Stick: Move · Right Stick: Camera · A: Jump / Break Ice</p>
                    <p>LB / RB: Punch (Hold BOTH to Grab or Cling to Walls) · LT: Lift Held Target</p>
                    <p>RT: Fire / Swing Weapon · X: Head-Butt · B: Dropkick · Y: Dance · Start: Match / Pause</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-800/80 border border-white/10">
                    <div className="font-bold text-cyan-300 mb-1">Keyboard & Mouse</div>
                    <p>WASD: Move · Mouse / Arrows: Camera · Space: Jump · F: Use Weapon</p>
                    <p>Left/Right Click or Z/X: Punch (Hold BOTH to Grab / Wall Cling) · Shift: Lift / Climb</p>
                    <p>Q: Head-Butt · E: Kick · Esc: Pause / Free Cursor · G/T: Start FFA/Team</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-800/80 border border-white/10">
                    <div className="font-bold text-rose-300 mb-1">Water Maps, Sharks & Wall Grabbing</div>
                    <p>You can swim in water on Pirate Deck &amp; Shark Reef — watch your O₂ meter and jump out before drowning! Reef Sharks leap onto islands and try to drag players under.</p>
                    <p>Hold BOTH hands near any wall or ledge to grab on, and Shift / LT to climb up! Knockout stun lasts 3.2s so throws count.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Friends & Optional Account Modal */}
          {snap.menuSubModal === 'friends' && (
            <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/80 p-4">
              <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-white/20 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-display text-2xl font-bold text-amber-300">Friends & Account</h2>
                  <button
                    onClick={() => eng?.openSubModal('none')}
                    className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm font-bold cursor-pointer"
                  >
                    B · Close
                  </button>
                </div>

                {!snap.cloudSignedIn && (
                  <div className="mb-3 p-3 rounded-xl bg-indigo-950/60 border border-indigo-400/35">
                    <div className="text-xs font-bold text-indigo-200 mb-1">
                      Cloud Sync Across Devices &amp; Locations
                    </div>
                    <p className="text-[11px] text-slate-300 mb-2.5">
                      Sign in with Google to save your username, remembered names, and friends in the cloud so you can play from anywhere.
                    </p>
                    <button
                      type="button"
                      disabled={snap.cloudBusy}
                      onClick={async () => {
                        setAuthErr('');
                        const err = await eng?.friends.signInWithGoogle();
                        if (err) setAuthErr(err);
                      }}
                      className="w-full py-2.5 px-3 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-950 font-bold text-sm cursor-pointer flex items-center justify-center gap-2 shadow"
                    >
                      <span>{snap.cloudBusy ? 'Connecting…' : 'Sign in with Google (Cloud Sync)'}</span>
                    </button>
                  </div>
                )}

                {!snap.acctLoggedIn ? (
                  <div>
                    <p className="text-xs text-slate-300 mb-2">
                      Playing as <span className="font-bold text-amber-300">{snap.acctUser}</span>. Your usernames are remembered automatically across sessions.
                    </p>

                    {/* Remembered Usernames Picker */}
                    {snap.savedUsers.length > 0 && (
                      <div className="mb-3 p-2.5 rounded-xl bg-slate-800/70 border border-white/10">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                          Remembered Usernames
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {snap.savedUsers.map((uname) => (
                            <div
                              key={uname}
                              className={`inline-flex items-center rounded-lg border text-xs font-semibold overflow-hidden ${
                                snap.acctUser === uname
                                  ? 'bg-amber-300/20 border-amber-300 text-amber-200'
                                  : 'bg-slate-800 border-white/15 text-slate-200'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  eng?.friends.setGuestUsername(uname);
                                  setAuthUser(uname);
                                  setGuestNameInput(uname);
                                }}
                                className="px-2.5 py-1 hover:bg-white/10 cursor-pointer"
                              >
                                {uname}
                              </button>
                              <button
                                type="button"
                                onClick={() => eng?.friends.removeSavedUsername(uname)}
                                className="px-1.5 py-1 text-slate-400 hover:text-rose-300 cursor-pointer"
                                title="Remove saved username"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Quick Guest Username Save */}
                    <div className="flex gap-2 mb-3">
                      <input
                        value={guestNameInput}
                        onChange={(e) => setGuestNameInput(e.target.value)}
                        placeholder={`Set display name (${snap.acctUser})`}
                        maxLength={14}
                        className="flex-1 px-3 py-1.5 rounded-lg bg-slate-800 border border-white/15 text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (guestNameInput.trim().length >= 2) {
                            eng?.friends.setGuestUsername(guestNameInput);
                            setGuestNameInput('');
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg bg-cyan-400 text-slate-950 font-bold text-xs cursor-pointer"
                      >
                        Save Name
                      </button>
                    </div>

                    <div className="flex gap-2 mb-3">
                      <button
                        onClick={() => setAuthTab('register')}
                        className={`flex-1 py-1.5 rounded-lg text-sm font-bold cursor-pointer ${
                          authTab === 'register' ? 'bg-amber-300 text-slate-950' : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        Local Account
                      </button>
                      <button
                        onClick={() => setAuthTab('login')}
                        className={`flex-1 py-1.5 rounded-lg text-sm font-bold cursor-pointer ${
                          authTab === 'login' ? 'bg-amber-300 text-slate-950' : 'bg-slate-800 text-slate-300'
                        }`}
                      >
                        Local Log In
                      </button>
                    </div>
                    <form onSubmit={handleAuthSubmit} className="space-y-2">
                      <input
                        value={authUser}
                        onChange={(e) => setAuthUser(e.target.value)}
                        placeholder="Username (3-14 chars)"
                        maxLength={14}
                        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/15 text-sm"
                      />
                      <input
                        type="password"
                        value={authPass}
                        onChange={(e) => setAuthPass(e.target.value)}
                        placeholder="Password (min 4 chars)"
                        className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/15 text-sm"
                      />
                      {authTab === 'register' && (
                        <input
                          type="password"
                          value={authPass2}
                          onChange={(e) => setAuthPass2(e.target.value)}
                          placeholder="Confirm Password"
                          className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-white/15 text-sm"
                        />
                      )}
                      {authErr && <p className="text-rose-400 text-xs">{authErr}</p>}
                      <button
                        type="submit"
                        className="w-full py-2.5 rounded-xl bg-emerald-400 text-slate-950 font-bold text-sm cursor-pointer"
                      >
                        {authTab === 'register' ? 'Create & Connect' : 'Log In'}
                      </button>
                    </form>
                  </div>
                ) : (
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between bg-slate-800/80 px-3 py-2 rounded-xl border border-white/10">
                      <div>
                        <span>
                          Signed in as <b className="text-amber-300">{snap.acctUser}</b>
                        </span>
                        {snap.cloudSignedIn && (
                          <div className="text-[11px] text-emerald-300 font-semibold">
                            Cloud-saved across devices{snap.cloudEmail ? ` · ${snap.cloudEmail}` : ''}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => (snap.cloudSignedIn ? eng?.friends.signOutCloud() : eng?.friends.logoutToGuest())}
                        className="text-xs text-rose-300 hover:underline cursor-pointer"
                      >
                        Log out
                      </button>
                    </div>

                    {snap.cloudSignedIn && (
                      <div className="space-y-1.5">
                        <div className="flex gap-2">
                          <input
                            value={cloudNameInput}
                            onChange={(e) => setCloudNameInput(e.target.value)}
                            placeholder={`Rename cloud username (${snap.acctUser})`}
                            maxLength={14}
                            className="flex-1 px-3 py-1.5 rounded-lg bg-slate-800 border border-white/15 text-xs"
                          />
                          <button
                            type="button"
                            disabled={snap.cloudBusy}
                            onClick={async () => {
                              setAuthErr('');
                              const err = await eng?.friends.setCloudUsername(cloudNameInput);
                              if (err) setAuthErr(err);
                              else setCloudNameInput('');
                            }}
                            className="px-3 py-1.5 rounded-lg bg-cyan-400 text-slate-950 font-bold text-xs cursor-pointer disabled:opacity-50"
                          >
                            Save Username
                          </button>
                        </div>
                        {authErr && <p className="text-rose-400 text-xs">{authErr}</p>}
                      </div>
                    )}

                    {snap.savedUsers.length > 0 && (
                      <div className="p-2.5 rounded-xl bg-slate-800/60 border border-white/10">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                          Remembered Usernames
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {snap.savedUsers.map((uname) => (
                            <div
                              key={uname}
                              className={`inline-flex items-center rounded-lg border text-xs font-semibold overflow-hidden ${
                                snap.acctUser === uname
                                  ? 'bg-amber-300/20 border-amber-300 text-amber-200'
                                  : 'bg-slate-800 border-white/15 text-slate-200'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={async () => {
                                  if (snap.cloudSignedIn) {
                                    setAuthErr('');
                                    const err = await eng?.friends.setCloudUsername(uname);
                                    if (err) setAuthErr(err);
                                  } else {
                                    setCloudNameInput(uname);
                                  }
                                }}
                                className="px-2.5 py-1 hover:bg-white/10 cursor-pointer"
                              >
                                {uname}
                              </button>
                              <button
                                type="button"
                                onClick={() => eng?.friends.removeSavedUsername(uname)}
                                className="px-1.5 py-1 text-slate-400 hover:text-rose-300 cursor-pointer"
                                title="Remove saved username"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <input
                        value={friendInput}
                        onChange={(e) => setFriendInput(e.target.value)}
                        placeholder="Add friend username"
                        maxLength={14}
                        className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-white/15 text-sm"
                      />
                      <button
                        onClick={() => {
                          eng?.friends.addFriend(friendInput);
                          setFriendInput('');
                        }}
                        className="px-4 py-2 rounded-lg bg-amber-300 text-slate-950 font-bold cursor-pointer"
                      >
                        Add
                      </button>
                    </div>
                    {snap.friendsMsg && <p className="text-xs text-amber-200">{snap.friendsMsg}</p>}
                    {snap.reqIn.map((n) => (
                      <div key={n} className="flex items-center justify-between bg-slate-800 px-3 py-2 rounded-lg">
                        <span>Request from {n}</span>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => eng?.friends.acceptReq(n)}
                            className="px-2.5 py-1 bg-emerald-400 text-slate-950 rounded text-xs font-bold cursor-pointer"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => eng?.friends.declineReq(n)}
                            className="px-2 py-1 bg-rose-500 rounded text-xs font-bold cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                    {snap.friendsList.map((n) => {
                      const st = snap.friendsStatus[n];
                      return (
                        <div key={n} className="flex items-center justify-between bg-slate-800 px-3 py-2 rounded-lg">
                          <span className={st?.on ? 'text-emerald-300 font-semibold' : 'text-slate-400'}>
                            {n} {st?.on ? '(Online)' : '(Offline)'}
                          </span>
                          <div className="flex gap-1.5">
                            {st?.on && (
                              <button
                                onClick={() => eng?.friends.inviteFriend(n)}
                                className="px-2.5 py-1 bg-cyan-400 text-slate-950 rounded text-xs font-bold cursor-pointer"
                              >
                                Invite
                              </button>
                            )}
                            {st?.party && (
                              <button
                                onClick={() => eng?.friends.joinFromInvite(st.party!)}
                                className="px-2.5 py-1 bg-amber-300 text-slate-950 rounded text-xs font-bold cursor-pointer"
                              >
                                Join
                              </button>
                            )}
                            <button
                              onClick={() => eng?.friends.removeFriend(n)}
                              className="px-2 py-1 bg-slate-700 rounded text-xs cursor-pointer"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== 2. GET READY / CHARACTER SELECT ==================== */}
      {snap?.screen === 'local' && (
        <div className="fixed inset-0 z-20 flex flex-col items-center justify-between p-4 bg-slate-950/55">
          <div className="text-center">
            <h2 className="font-display text-2xl sm:text-3xl font-black text-amber-300">GET READY</h2>
            <p className="text-xs sm:text-sm text-slate-200 mt-0.5">{snap.lmHint || 'Press A on Xbox controllers (or click a card) to join & customize'}</p>
          </div>

          {/* 4-Slot Character Cards */}
          <div className="w-full max-w-6xl grid grid-cols-2 lg:grid-cols-4 gap-3 my-2">
            {snap.slots.map((s, i) => {
              const rows = s
                ? [
                    ['Creature', cap1(s.head)],
                    ['Hat', HATN[s.hat]],
                    ['Face', FACEN[s.face]],
                    ['Back', BACKN[s.back]],
                    ['Shirt', s.color],
                    ['Pants', s.pants],
                    ['Team', s.team < 0 ? 'Auto' : s.team ? 'Blue' : 'Red'],
                  ]
                : [];

              return (
                <div
                  key={i}
                  onClick={() => {
                    if (!s && eng) eng.lmJoin(snap.touchDevice ? 'touch' : 'kb');
                  }}
                  className={`rounded-2xl border-2 p-3 flex flex-col bg-slate-900/80 transition ${
                    s?.ready ? 'border-emerald-400' : s ? 'border-white/30' : 'border-white/10 hover:border-amber-300/60 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-display font-bold text-sm text-amber-200 truncate">
                      {s ? CNAME[s.head].toUpperCase() : `PLAYER ${i + 1}`}
                    </span>
                    <span className="text-[11px] text-slate-300">
                      {s ? (s.pad === 'kb' ? 'Keyboard' : s.pad === 'touch' ? 'Touch/Mouse' : `Pad ${Number(s.pad) + 1}`) : 'Empty'}
                    </span>
                  </div>

                  {/* Transparent 3D Scissor Viewport Window */}
                  <div
                    ref={(el) => {
                      pvRefs.current[i] = el;
                    }}
                    className="w-full h-32 sm:h-40 rounded-xl border border-white/10 bg-transparent mb-2"
                  />

                  {s ? (
                    <>
                      <div className="space-y-1 text-xs mb-2">
                        {rows.map(([label, val], rIdx) => (
                          <div
                            key={label}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (s.ready) return;
                              const rect = e.currentTarget.getBoundingClientRect();
                              eng?.lmChange(i, e.clientX > rect.left + rect.width / 2 ? 1 : -1, rIdx);
                            }}
                            className={`flex items-center justify-between px-2 py-1 rounded cursor-pointer ${
                              !s.ready && s.row === rIdx ? 'bg-amber-300 text-slate-950 font-bold' : 'bg-slate-800/80 text-slate-200'
                            }`}
                          >
                            <span>{label}</span>
                            {label === 'Shirt' || label === 'Pants' ? (
                              <span className="inline-flex items-center gap-1">
                                ◀ <i className="inline-block w-4 h-4 rounded" style={{ background: val }} /> ▶
                              </span>
                            ) : (
                              <span>◀ {val} ▶</span>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-1.5 mt-auto">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            eng?.lmReady(i, !s.ready);
                          }}
                          className={`flex-1 py-1.5 rounded-lg font-bold text-xs cursor-pointer ${
                            s.ready ? 'bg-slate-700 text-white' : 'bg-emerald-400 text-slate-950'
                          }`}
                        >
                          {s.ready ? 'A · Change' : 'A · READY'}
                        </button>
                        {!s.ready && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              eng?.lmLeave(i);
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-rose-500/80 text-xs font-bold cursor-pointer"
                          >
                            B
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center text-xs text-slate-300 py-4">
                      <p>Press <b>A</b> on Xbox Controller</p>
                      <p className="mt-1 opacity-75">or Enter on Keyboard / Click</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bottom Action Bar */}
          <div className="w-full max-w-5xl rounded-2xl bg-slate-900/95 border border-white/15 p-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => eng?.backToMainMenu()}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold cursor-pointer"
              >
                ← Back
              </button>
              <button
                disabled={snap.kbJoined || snap.slots.filter(Boolean).length >= 4}
                onClick={() => eng?.lmJoin('kb')}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-bold cursor-pointer"
              >
                + Join Keyboard
              </button>
              {snap.lmNet !== 'join' && (
                <>
                  <button
                    onClick={() => eng?.lmMode()}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold cursor-pointer"
                  >
                    Mode: {MODE_LABELS[snap.lmMode]} (Y)
                  </button>
                  <button
                    onClick={() => eng?.lmBots()}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold cursor-pointer"
                  >
                    Bots: {snap.lmBots < 0 ? `Auto (${snap.lmBotsEffective})` : snap.lmBots} (X)
                  </button>
                </>
              )}
              <button
                onClick={() => eng?.lmNet()}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold cursor-pointer"
              >
                Play Type: {({ off: 'Local / Bots', host: 'Host Online Party', join: 'Join Code', quick: 'Quick Play' })[snap.lmNet]} (RB)
              </button>
              {snap.lmNet === 'join' && (
                <input
                  value={snap.lmCode}
                  onChange={(e) => eng?.setLmCode(e.target.value)}
                  maxLength={4}
                  placeholder="CODE"
                  className="w-24 px-2.5 py-1.5 rounded-lg bg-slate-800 border border-amber-300/60 font-mono-num text-sm uppercase text-center"
                />
              )}
            </div>

            <button
              disabled={!snap.lmAllReady || (snap.lmNet === 'join' && snap.lmCode.trim().length < 2)}
              onClick={() => eng?.lmStart()}
              className="px-6 py-2.5 rounded-xl bg-amber-300 text-slate-950 font-display font-black text-base disabled:opacity-40 hover:bg-amber-200 cursor-pointer"
            >
              {snap.lmNet === 'host'
                ? 'OPEN PARTY (Start)'
                : snap.lmNet === 'join'
                  ? 'JOIN PARTY (Start)'
                  : snap.lmNet === 'quick'
                    ? 'FIND PARTY (Start)'
                    : 'FIGHT! (Start)'}
            </button>
          </div>
        </div>
      )}

      {/* ==================== 3. IN-GAME HUD ==================== */}
      {snap?.screen === 'game' && (
        <>
          {/* Top-left Match Bar (Single Screen) */}
          {!snap.localMode && (
            <div className="fixed top-3 left-3 z-20 max-w-md rounded-xl bg-slate-950/75 border border-white/15 px-3.5 py-2.5 text-xs sm:text-sm pointer-events-auto">
              <div className="font-bold text-amber-300">
                Party {snap.code} · {snap.players.length}/8 · {snap.phase === 'lobby' ? 'LOBBY' : `${arenaName} · Round ${snap.roundNum}`}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-[11px] text-slate-300">Dizzy:</span>
                <div className="flex-1 h-2.5 rounded bg-slate-800 overflow-hidden border border-white/10">
                  <div
                    className="h-full bg-amber-400 transition-all duration-100"
                    style={{ width: `${snap.players.find((p) => p.id === snap.myId)?.dz || 0}%` }}
                  />
                </div>
              </div>
              {(() => {
                const mp = snap.players.find((p) => p.id === snap.myId);
                const air = mp?.air ?? 100;
                const isWaterMap = snap.phase === 'arena0' || snap.phase === 'arena1';
                if (!isWaterMap || air >= 99) return null;
                return (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[11px] font-bold text-cyan-300">O₂:</span>
                    <div className="flex-1 h-2.5 rounded bg-slate-800 overflow-hidden border border-cyan-400/30">
                      <div
                        className={`h-full transition-all duration-100 ${air < 35 ? 'bg-rose-400' : 'bg-cyan-400'}`}
                        style={{ width: `${Math.max(0, Math.min(100, air))}%` }}
                      />
                    </div>
                  </div>
                );
              })()}
              {(() => {
                const mp = snap.players.find((p) => p.id === snap.myId);
                if (!mp?.wp) return null;
                return (
                  <div className="mt-1 text-cyan-300 font-semibold text-xs">
                    {WI[mp.wp]} {WN[mp.wp]} {mp.am ? `x${mp.am}` : ''}
                  </div>
                );
              })()}

              {snap.phase === 'lobby' && snap.isHost && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    onClick={() => eng?.startMatch('ffa')}
                    className="px-2.5 py-1 rounded bg-amber-300 text-slate-950 font-bold text-xs cursor-pointer"
                  >
                    FFA (G)
                  </button>
                  <button
                    onClick={() => eng?.startMatch('team')}
                    className="px-2.5 py-1 rounded bg-cyan-400 text-slate-950 font-bold text-xs cursor-pointer"
                  >
                    Team (T)
                  </button>
                  <button
                    onClick={() => eng?.startMatch('ctf')}
                    className="px-2.5 py-1 rounded bg-rose-400 text-slate-950 font-bold text-xs cursor-pointer"
                  >
                    Capture Flag
                  </button>
                  <button
                    onClick={() => eng?.startMatch('koth')}
                    className="px-2.5 py-1 rounded bg-emerald-400 text-slate-950 font-bold text-xs cursor-pointer"
                  >
                    Capture Zone
                  </button>
                  <button
                    onClick={() => eng?.addBot()}
                    className="px-2 py-1 rounded bg-slate-800 border border-white/15 text-xs cursor-pointer"
                  >
                    +Bot
                  </button>
                  <button
                    onClick={() => eng?.clearBots()}
                    className="px-2 py-1 rounded bg-slate-800 border border-white/15 text-xs cursor-pointer"
                  >
                    Clear Bots
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Split-screen Corner Panes */}
          {snap.localMode &&
            snap.panes.map((pn) => {
              const pObj = snap.players.find((x) => x.id === pn.id);
              const isTm = snap.mode === 'team' || snap.mode === 'ctf';
              return (
                <div
                  key={pn.id}
                  className="fixed z-20 pointer-events-none px-2 py-1 rounded-lg bg-slate-950/75 border border-white/15 text-xs"
                  style={{ left: pn.rect.x + 8, top: pn.rect.y + 8 }}
                >
                  <div
                    className="font-bold px-2 py-0.5 rounded text-slate-950 inline-block mb-1"
                    style={{
                      background: isTm && pn.team >= 0 ? (pn.team ? '#60a5fa' : '#f87171') : pn.color,
                    }}
                  >
                    {pn.name}
                    {pn.alive ? '' : pObj?.respawnSec ? ` (${pObj.respawnSec}s)` : ' ☠'}
                  </div>
                  <div className="w-24 h-2 rounded bg-slate-800 overflow-hidden border border-white/10">
                    <div className="h-full bg-amber-400 transition-all" style={{ width: `${pn.dz}%` }} />
                  </div>
                  {(snap.phase === 'arena0' || snap.phase === 'arena1') && pn.air < 99 && (
                    <div className="w-24 h-2 rounded bg-slate-800 overflow-hidden border border-cyan-400/30 mt-0.5">
                      <div
                        className={`h-full transition-all ${pn.air < 35 ? 'bg-rose-400' : 'bg-cyan-400'}`}
                        style={{ width: `${Math.max(0, Math.min(100, pn.air))}%` }}
                      />
                    </div>
                  )}
                  {pn.wp && (
                    <div className="text-[11px] text-cyan-300 font-semibold mt-0.5">
                      {WI[pn.wp]} {WN[pn.wp]} {pn.am ? `x${pn.am}` : ''}
                    </div>
                  )}
                  {pn.note && <div className="text-[11px] text-amber-200 font-bold mt-0.5">{pn.note}</div>}
                </div>
              );
            })}

          {/* Top-Center Map Hazard & Objective HUD */}
          {snap.phase !== 'lobby' && (
            <div className="fixed top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none text-center flex flex-col items-center gap-1.5">
              <div className={`px-4 py-1.5 rounded-xl bg-slate-950/80 border shadow-lg ${hazardName ? 'border-rose-400/40' : 'border-white/20'}`}>
                <div className="text-[11px] uppercase tracking-wider text-slate-300">
                  {MODE_LABELS[snap.mode]} · Round {snap.roundNum} · {arenaName}{hazardName ? ` · ${hazardName}` : ''}
                </div>
                {hazardName && snap.hazardStatus && (
                  <div className="font-display font-bold text-xs sm:text-sm text-rose-300">
                    {snap.hazardStatus} (Danger Lv.{snap.hazardLevel})
                  </div>
                )}
              </div>

              {/* CTF Flag Status */}
              {snap.mode === 'ctf' && snap.flags.length === 2 && (
                <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-slate-950/85 border border-white/15 text-xs shadow-lg">
                  {snap.flags.map((fl) => {
                    const carrier = fl.carrierId ? snap.players.find((q) => q.id === fl.carrierId) : null;
                    return (
                      <div
                        key={fl.team}
                        className={`px-2 py-0.5 rounded-lg font-bold ${
                          fl.team === 0 ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                        }`}
                      >
                        {fl.team === 0 ? 'RED FLAG: ' : 'BLUE FLAG: '}
                        {carrier ? `Carried by ${carrier.name}` : fl.atBase ? 'At Base' : 'Dropped!'}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Capture Zone Progress Bar */}
              {snap.mode === 'koth' && snap.zone && (
                <div className="w-64 px-3 py-1.5 rounded-xl bg-slate-950/85 border border-cyan-400/40 shadow-lg">
                  <div className="flex items-center justify-between text-[11px] font-bold mb-1">
                    <span style={{ color: snap.zone.contested ? '#fbbf24' : snap.zone.ownerColor || '#7dd3fc' }}>
                      {snap.zone.contested
                        ? 'ZONE CONTESTED!'
                        : snap.zone.ownerName
                          ? `${snap.zone.ownerName} Capturing`
                          : 'Stand in Glowing Zone!'}
                    </span>
                    <span className="font-mono-num text-white">{Math.round(snap.zone.progress)}%</span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden border border-white/15">
                    <div
                      className="h-full transition-all duration-100"
                      style={{
                        width: `${snap.zone.progress}%`,
                        background: snap.zone.contested ? '#f59e0b' : snap.zone.ownerColor || '#38bdf8',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Top-Right Scoreboard + Menu Button */}
          <div className="fixed top-3 right-3 z-20 flex flex-col items-end gap-2">
            <button
              onClick={() => eng?.togglePause()}
              className="px-3 py-1.5 rounded-xl bg-slate-950/80 hover:bg-slate-800 border border-white/20 text-xs font-bold cursor-pointer"
            >
              Start / Esc · Menu
            </button>

            {snap.phase !== 'lobby' && (
              <div className="rounded-xl bg-slate-950/80 border border-white/15 px-3 py-2 text-xs text-right min-w-36">
                <div className="font-bold text-amber-300 mb-1">
                  {snap.mode === 'team' || snap.mode === 'ctf' ? (
                    <>
                      <span className="text-rose-400">RED {snap.tscore[0]}</span> ·{' '}
                      <span className="text-sky-400">BLUE {snap.tscore[1]}</span>
                    </>
                  ) : (
                    'First to 5'
                  )}
                </div>
                <div className="space-y-0.5">
                  {snap.players
                    .slice()
                    .sort((a, b) => b.score - a.score)
                    .map((p) => (
                      <div key={p.id} className={p.alive ? 'text-slate-100' : 'text-slate-400'}>
                        {snap.mode === 'team' || snap.mode === 'ctf' ? (p.team ? '🔵 ' : '🔴 ') : ''}
                        {p.name}
                        {!p.alive && p.respawnSec > 0 ? ` (${p.respawnSec}s)` : ''}
                        {snap.mode === 'team' || snap.mode === 'ctf' ? '' : `: ${p.score}`}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Center Round / Announcement Banner */}
          {snap.banner && !snap.roundSummary && (
            <div className="fixed top-28 left-1/2 -translate-x-1/2 z-20 pointer-events-none px-6 py-2.5 rounded-2xl bg-slate-950/85 border border-amber-300/50 shadow-2xl">
              <div className="font-display font-black text-xl sm:text-2xl text-amber-300 tracking-wide text-center">
                {snap.banner}
              </div>
            </div>
          )}

          {/* Post-Round & Post-Match Character Score Tracker */}
          {snap.roundSummary && (
            <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/65 p-4 pointer-events-none">
              <div className="w-full max-w-lg rounded-2xl bg-slate-900 border-2 border-amber-300/60 p-6 shadow-2xl">
                <div className="text-center mb-4">
                  <div className="text-xs uppercase tracking-widest text-slate-300 font-bold">
                    {MODE_LABELS[snap.roundSummary.mode]} · {snap.roundSummary.mapName}
                  </div>
                  <h2 className="font-display text-2xl sm:text-3xl font-black text-amber-300 mt-1">
                    {snap.roundSummary.isMatchEnd ? 'MATCH CHAMPION!' : `ROUND ${snap.roundSummary.roundNum} SCOREBOARD`}
                  </h2>
                  <p className="text-sm font-semibold text-white mt-1">{snap.roundSummary.reason}</p>
                </div>

                {(snap.roundSummary.mode === 'team' || snap.roundSummary.mode === 'ctf') && (
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    {[0, 1].map((tm) => {
                      const won = snap.roundSummary!.winnerTeam === tm;
                      return (
                        <div
                          key={tm}
                          className={`rounded-xl p-3 border text-center ${
                            tm === 0 ? 'bg-rose-500/15 border-rose-400/50' : 'bg-sky-500/15 border-sky-400/50'
                          }`}
                        >
                          <div className="text-xs font-bold uppercase tracking-wider text-slate-200">
                            {tm === 0 ? 'Red Team' : 'Blue Team'} {won ? ' (+1 PT)' : ''}
                          </div>
                          <div className="font-display text-2xl font-black text-white mt-0.5">
                            {snap.roundSummary!.tscore[tm]} / 5
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="space-y-2">
                  {snap.roundSummary.rows
                    .slice()
                    .sort((a, b) => b.newScore - a.newScore || (b.earned ? 1 : 0) - (a.earned ? 1 : 0))
                    .map((row) => (
                      <div
                        key={row.id}
                        className={`flex items-center justify-between gap-3 px-3 py-2 rounded-xl border ${
                          row.earned ? 'bg-amber-300/15 border-amber-300/60' : 'bg-slate-800/80 border-white/10'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className="w-3.5 h-3.5 rounded-full shrink-0 border border-white/40"
                            style={{ background: row.color }}
                          />
                          <span className="font-bold text-sm text-white truncate">{row.name}</span>
                          {row.earned && (
                            <span className="px-2 py-0.5 rounded bg-amber-300 text-slate-950 font-black text-[10px] shrink-0">
                              +1 PT
                            </span>
                          )}
                        </div>

                        {snap.roundSummary!.mode === 'team' || snap.roundSummary!.mode === 'ctf' ? (
                          <span className={`text-xs font-bold ${row.team ? 'text-sky-300' : 'text-rose-300'}`}>
                            {row.team ? 'BLUE' : 'RED'}
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5 shrink-0">
                            {[1, 2, 3, 4, 5].map((pip) => {
                              const filled = pip <= row.newScore;
                              const isNew = filled && pip > row.prevScore;
                              return (
                                <span
                                  key={pip}
                                  className={`w-4 h-4 rounded-md border transition-all ${
                                    isNew
                                      ? 'bg-amber-300 border-white scale-110'
                                      : filled
                                        ? 'bg-emerald-400 border-emerald-200'
                                        : 'bg-slate-700 border-white/15'
                                  }`}
                                />
                              );
                            })}
                            <span className="font-mono-num text-xs font-bold text-slate-200 ml-1 w-6 text-right">
                              {row.newScore}/5
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* In-Game Xbox / Keyboard Pause & Match Menu */}
          {snap.pauseOpen && (
            <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/80 p-4">
              <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-white/20 p-6 shadow-2xl">
                <h2 className="font-display text-2xl font-black text-amber-300 text-center mb-1">MATCH MENU</h2>
                <p className="text-xs text-slate-300 text-center mb-4">
                  D-Pad Up/Down · A Select · B Resume
                </p>
                <div className="space-y-2">
                  {(snap.isHost && snap.phase === 'lobby'
                    ? [
                        'Resume Lobby',
                        'Start Free-for-All',
                        'Start Team Battle',
                        'Start Capture the Flag',
                        'Start Capture Zone',
                        'Add AI Bot',
                        'Remove AI Bots',
                        'Return to Main Menu',
                      ]
                    : ['Resume Match', snap.muted ? 'Unmute Mic' : 'Mute Mic', 'Leave to Main Menu']
                  ).map((label, idx) => (
                    <button
                      key={label}
                      onClick={() => eng?.activatePauseOption(idx)}
                      className={`w-full py-2.5 px-4 rounded-xl font-bold text-sm cursor-pointer transition ${
                        snap.pauseIdx === idx
                          ? 'bg-amber-300 text-slate-950 pad-focus'
                          : 'bg-slate-800 hover:bg-slate-700 text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Mobile Touch Action Buttons */}
          {snap.touchDevice && (
            <div className="fixed right-3 bottom-3 z-20 grid grid-cols-3 gap-2 w-48">
              {(
                [
                  ['H', 'HEAD'],
                  ['J', 'JUMP'],
                  ['S', 'LIFT'],
                  ['L', 'L-HAND'],
                  ['K', 'KICK'],
                  ['R', 'R-HAND'],
                  ['D', 'DANCE'],
                  ['F', 'FIRE'],
                  ['M', 'MIC'],
                ] as const
              ).map(([code, lbl]) => (
                <button
                  key={code}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    eng?.touchAction(code, true);
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    eng?.touchAction(code, false);
                  }}
                  onTouchCancel={() => eng?.touchAction(code, false)}
                  className="touch-btn py-3 rounded-xl bg-slate-900/80 border border-white/25 text-[11px] font-bold active:scale-95 active:bg-amber-300 active:text-slate-950"
                >
                  {lbl}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* ==================== TOASTS (Invites & Friend Requests) ==================== */}
      {snap && snap.toasts.length > 0 && (
        <div className="fixed bottom-4 left-4 z-40 space-y-2 max-w-sm">
          {snap.toasts.map((t) => (
            <div
              key={t.id}
              className="rounded-xl bg-slate-900 border border-amber-300/50 shadow-2xl px-4 py-3 text-sm flex items-center justify-between gap-3"
            >
              <span>{t.text}</span>
              <div className="flex gap-1.5">
                {t.inviteCode && (
                  <button
                    onClick={() => eng?.friends.joinFromInvite(t.inviteCode!, t.id)}
                    className="px-2.5 py-1 rounded bg-amber-300 text-slate-950 font-bold text-xs cursor-pointer"
                  >
                    Join
                  </button>
                )}
                <button
                  onClick={() => eng?.friends.dismissToast(t.id)}
                  className="px-2 py-1 rounded bg-slate-800 text-xs cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
