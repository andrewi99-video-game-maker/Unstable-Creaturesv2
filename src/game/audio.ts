// Procedural Web Audio API synthesizer with master dynamics compression & rich layered SFX

class SoundEngine {
  private ctx: AudioContext | null = null;
  private out: AudioNode | null = null;
  private remoteAudios: Record<string, HTMLAudioElement> = {};
  private remoteAnalysers: Record<string, AnalyserNode> = {};
  public muted = false;
  public micStream: MediaStream | null = null;
  public micOK = false;
  public localAnalyser: AnalyserNode | null = null;

  public unlock(): AudioContext | null {
    return this.ensure();
  }

  public ensureMicStreamFallback(): void {
    const ac = this.ensure();
    if (ac && !this.micStream) {
      try {
        this.micStream = ac.createMediaStreamDestination().stream;
      } catch {
        this.micStream = null;
      }
    }
  }

  public attachRemoteAudio(pid: string, stream: MediaStream): void {
    if (!pid || this.remoteAudios[pid]) return;
    try {
      const a = new Audio();
      a.srcObject = stream;
      a.autoplay = true;
      a.play().catch(() => {});
      this.remoteAudios[pid] = a;
      const ac = this.ensure();
      if (ac) {
        const an = ac.createAnalyser();
        an.fftSize = 256;
        ac.createMediaStreamSource(stream).connect(an);
        this.remoteAnalysers[pid] = an;
      }
    } catch {
      // ignore
    }
  }

  public dropRemoteAudio(pid: string): void {
    if (!pid) return;
    const a = this.remoteAudios[pid];
    if (a) {
      a.pause();
      delete this.remoteAudios[pid];
      delete this.remoteAnalysers[pid];
    }
  }

  public isSpeaking(pidOrLocal: string): boolean {
    const an = pidOrLocal === 'local' ? (this.muted ? null : this.localAnalyser) : this.remoteAnalysers[pidOrLocal];
    if (!an) return false;
    const d = new Uint8Array(an.fftSize);
    an.getByteTimeDomainData(d);
    let s = 0;
    for (const v of d) s += (v - 128) * (v - 128);
    return Math.sqrt(s / d.length) / 128 > 0.03;
  }

  public updateSpatialVolume(pid: string, dist: number): void {
    const a = this.remoteAudios[pid];
    if (!a) return;
    a.volume = Math.max(0, Math.min(1, 1.4 - dist / 32));
  }

  public ensure(): AudioContext | null {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      try {
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.knee.value = 12;
        comp.ratio.value = 6;
        comp.attack.value = 0.004;
        comp.release.value = 0.15;
        const master = this.ctx.createGain();
        master.gain.value = 0.92;
        comp.connect(master);
        master.connect(this.ctx.destination);
        this.out = comp;
      } catch {
        this.out = this.ctx.destination;
      }
      if (!this.micStream) {
        try {
          this.micStream = this.ctx.createMediaStreamDestination().stream;
        } catch {
          this.micStream = null;
        }
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public getContext(): AudioContext | null {
    return this.ensure();
  }

  private tone(
    freq: number,
    dur = 0.12,
    type: OscillatorType = 'triangle',
    vol = 0.08,
    slideTo?: number,
    delay = 0
  ): void {
    const ac = this.ctx;
    if (!ac || ac.state !== 'running') return;
    const dest = this.out || ac.destination;
    try {
      const t0 = ac.currentTime + delay;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(Math.max(20, freq), t0);
      if (slideTo !== undefined) {
        o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
      }
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.012, dur * 0.25));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(dest);
      o.start(t0);
      o.stop(t0 + dur + 0.01);
    } catch {
      // ignore audio glitches
    }
  }

  public beep(freq: number, dur = 0.12, type: OscillatorType = 'square', vol = 0.06, slideTo?: number): void {
    this.tone(freq, dur, type, vol, slideTo, 0);
  }

  public noise(
    dur = 0.25,
    vol = 0.09,
    filterFreq = 900,
    filterType: BiquadFilterType = 'lowpass',
    delay = 0
  ): void {
    const ac = this.ctx;
    if (!ac || ac.state !== 'running') return;
    const dest = this.out || ac.destination;
    try {
      const t0 = ac.currentTime + delay;
      const len = Math.max(64, Math.floor(ac.sampleRate * dur));
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 0.85);
      }
      const src = ac.createBufferSource();
      src.buffer = buf;
      const filter = ac.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.setValueAtTime(filterFreq, t0);
      if (filterType === 'bandpass') filter.Q.value = 1.8;
      const g = ac.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter);
      filter.connect(g);
      g.connect(dest);
      src.start(t0);
    } catch {
      // ignore
    }
  }

  public uiClick(pitch = 560): void {
    this.tone(pitch, 0.045, 'triangle', 0.055, pitch * 1.15);
  }

  public uiConfirm(): void {
    this.tone(520, 0.07, 'triangle', 0.07, 680, 0);
    this.tone(780, 0.1, 'triangle', 0.06, 980, 0.055);
  }

  public jumpSfx(inWater = false): void {
    if (inWater) {
      this.noise(0.16, 0.07, 1500, 'bandpass');
      this.tone(240, 0.14, 'sine', 0.07, 460);
    } else {
      this.tone(190, 0.12, 'sine', 0.075, 440);
      this.tone(290, 0.08, 'triangle', 0.035, 580, 0.02);
    }
  }

  public punchSwing(heavy = false): void {
    this.noise(heavy ? 0.14 : 0.09, heavy ? 0.08 : 0.055, heavy ? 680 : 1200, 'bandpass');
    this.tone(heavy ? 180 : 260, heavy ? 0.11 : 0.07, 'triangle', 0.04, heavy ? 70 : 120);
  }

  public hitImpact(heavy = false): void {
    // Sub punch thud + crisp body slap + transient crack
    this.tone(heavy ? 145 : 175, heavy ? 0.22 : 0.14, 'sine', heavy ? 0.18 : 0.13, 36);
    this.tone(heavy ? 310 : 410, 0.09, 'triangle', heavy ? 0.1 : 0.075, 85);
    this.noise(heavy ? 0.14 : 0.08, heavy ? 0.14 : 0.1, heavy ? 1300 : 1800, 'lowpass');
  }

  public koBell(): void {
    // Twin metallic arena bell strikes + woozy descending chime
    this.tone(920, 0.42, 'sine', 0.11, 900, 0);
    this.tone(1385, 0.36, 'triangle', 0.065, 1360, 0);
    this.tone(920, 0.48, 'sine', 0.1, 890, 0.15);
    this.tone(1385, 0.4, 'triangle', 0.06, 1350, 0.15);
    this.tone(440, 0.35, 'sawtooth', 0.045, 130, 0.05);
  }

  public pickupSfx(): void {
    this.tone(660, 0.08, 'triangle', 0.07, 740, 0);
    this.tone(880, 0.09, 'triangle', 0.075, 980, 0.05);
    this.tone(1320, 0.14, 'sine', 0.08, 1390, 0.1);
  }

  public weaponShot(): void {
    this.tone(280, 0.13, 'sawtooth', 0.085, 95);
    this.tone(540, 0.08, 'square', 0.045, 190);
    this.noise(0.1, 0.075, 1100, 'bandpass');
  }

  public hookZip(): void {
    this.tone(880, 0.06, 'square', 0.055, 1280);
    this.noise(0.14, 0.065, 2200, 'bandpass', 0.03);
    this.tone(360, 0.13, 'sawtooth', 0.05, 190, 0.04);
  }

  public bananaSlip(): void {
    this.tone(520, 0.1, 'sine', 0.08, 1080, 0);
    this.tone(1040, 0.18, 'sine', 0.07, 240, 0.09);
  }

  public iceSpray(): void {
    this.noise(0.07, 0.04, 3400, 'highpass');
    this.tone(1650 + Math.random() * 450, 0.045, 'sine', 0.028, 2200);
  }

  public iceFreeze(): void {
    this.tone(1280, 0.14, 'triangle', 0.075, 1980, 0);
    this.tone(1980, 0.18, 'sine', 0.07, 2500, 0.05);
    this.noise(0.1, 0.05, 2800, 'highpass');
  }

  public iceBreak(): void {
    this.noise(0.18, 0.11, 2600, 'highpass');
    this.tone(420, 0.12, 'square', 0.07, 130);
    this.tone(260, 0.18, 'sawtooth', 0.07, 75, 0.03);
  }

  public blackHoleStart(): void {
    this.tone(120, 0.55, 'sine', 0.11, 48);
    this.tone(240, 0.45, 'triangle', 0.055, 65, 0.04);
    this.noise(0.45, 0.06, 480, 'bandpass');
  }

  public blackHoleCollapse(): void {
    this.tone(95, 0.45, 'sawtooth', 0.13, 28);
    this.tone(180, 0.25, 'sine', 0.1, 42);
    this.noise(0.42, 0.15, 620, 'lowpass');
  }

  public vortexBlast(): void {
    this.noise(0.32, 0.1, 950, 'bandpass');
    this.tone(160, 0.34, 'sine', 0.09, 340);
    this.tone(240, 0.28, 'triangle', 0.055, 90, 0.06);
  }

  public boing(): void {
    this.tone(220, 0.18, 'sine', 0.085, 590);
    this.tone(440, 0.15, 'triangle', 0.045, 290, 0.08);
  }

  public cannonBoom(): void {
    this.tone(115, 0.42, 'sawtooth', 0.13, 30);
    this.tone(75, 0.36, 'sine', 0.16, 26);
    this.noise(0.38, 0.14, 520, 'lowpass');
  }

  public splash(): void {
    this.noise(0.3, 0.1, 1600, 'bandpass');
    this.tone(320, 0.16, 'sine', 0.07, 110);
    this.tone(540, 0.1, 'sine', 0.04, 240, 0.04);
  }

  public sharkBite(): void {
    this.tone(165, 0.16, 'sawtooth', 0.12, 55);
    this.tone(105, 0.25, 'square', 0.08, 42);
    this.noise(0.15, 0.11, 950, 'lowpass');
  }

  public laserZap(): void {
    this.tone(820, 0.13, 'sawtooth', 0.075, 190);
    this.tone(1240, 0.08, 'sine', 0.04, 380);
  }

  public rumbleImpact(): void {
    this.tone(88, 0.34, 'sine', 0.16, 28);
    this.tone(145, 0.2, 'triangle', 0.1, 45);
    this.noise(0.26, 0.12, 420, 'lowpass');
  }

  public scoreFanfare(isWin = false): void {
    const notes = isWin ? [523, 659, 784, 1046] : [523, 659, 784];
    notes.forEach((f, idx) => {
      this.tone(f, isWin && idx === notes.length - 1 ? 0.32 : 0.13, 'triangle', 0.085, f * 1.02, idx * 0.085);
    });
  }

  public async requestMic(): Promise<boolean> {
    const ac = this.ensure();
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no mic api');
      let late = false;
      const st = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        }).then((x) => {
          if (late) x.getTracks().forEach((t) => t.stop());
          return x;
        }),
        new Promise<never>((_, rej) => setTimeout(() => { late = true; rej(new Error('timeout')); }, 8000)),
      ]);
      this.micStream = st;
      this.micOK = true;
      if (ac) {
        this.localAnalyser = ac.createAnalyser();
        this.localAnalyser.fftSize = 256;
        ac.createMediaStreamSource(st).connect(this.localAnalyser);
      }
      return true;
    } catch {
      if (ac && !this.micStream) {
        this.micStream = ac.createMediaStreamDestination().stream;
      }
      this.micOK = false;
      return false;
    }
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.micStream) {
      this.micStream.getAudioTracks().forEach((t) => {
        t.enabled = !this.muted;
      });
    }
    this.uiClick(this.muted ? 260 : 560);
    return this.muted;
  }
}

export const sound = new SoundEngine();
