import type { ArenaId, ShotType, SpecialKind } from '@picklebros/shared';

/**
 * All game sounds, generated with Web Audio (no audio files). Sounds placed on the court are
 * panned left/right and get quieter with distance from your player.
 */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private ambience!: GainNode;
  private noise!: AudioBuffer;
  private chargeOsc: OscillatorNode | null = null;
  private chargeGain: GainNode | null = null;
  /** Crowd chatter voices (each a filtered noise band whose loudness changes like speech). */
  private babble: { gain: GainNode; filter: BiquadFilterNode }[] = [];
  private babbleBus: GainNode | null = null;
  private babbleTimer: ReturnType<typeof setInterval> | null = null;
  private crowdOn = false;
  /** The current court's background sound (nodes and timers to stop when it changes). */
  private bed: { nodes: AudioScheduledSourceNode[]; timers: ReturnType<typeof setInterval>[] } = { nodes: [], timers: [] };
  private arena: ArenaId | null = null;
  private _enabled = true;
  /** Your position and end of the court, for left/right panning. */
  private listener = { x: 0, z: 0, side: 1 as 1 | -1 };

  constructor(enabled: boolean) {
    this._enabled = enabled;
    // Browsers only allow audio after the player interacts with the page.
    const unlock = () => this.ensure();
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);
  }

  get enabled(): boolean {
    return this._enabled;
  }

  setEnabled(on: boolean): void {
    this._enabled = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
    if (!on) {
      this.setCharge(null);
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    }
  }

  private ensure(): AudioContext | null {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this._enabled ? 0.8 : 0;
      this.master.connect(ctx.destination);
      this.sfx = ctx.createGain();
      this.sfx.connect(this.master);
      this.ambience = ctx.createGain();
      this.ambience.gain.value = 0;
      this.ambience.connect(this.master);
      // One second of white noise, reused by every noisy sound.
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      // Start whatever background was asked for before audio was allowed.
      const arena = this.arena;
      this.arena = null;
      if (arena) this.setAmbience(arena);
      if (this.crowdOn) this.setCrowd(true);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** Where you are (call each frame) so court sounds pan and fade correctly. */
  setListener(x: number, z: number, side: 1 | -1): void {
    this.listener = { x, z, side };
  }

  // ---------------------------------------------------------------- building blocks

  private live(): AudioContext | null {
    if (!this._enabled || !this.ctx || this.ctx.state !== 'running') return null;
    return this.ctx;
  }

  /** Output for a sound at a court position (pan + distance), or straight to the mix. */
  private out(ctx: AudioContext, at?: { x: number; z: number }, gain = 1): AudioNode {
    const g = ctx.createGain();
    let level = gain;
    if (at) {
      const { x, z, side } = this.listener;
      const pan = ctx.createStereoPanner();
      pan.pan.value = clamp(((at.x - x) * side) / 4, -0.9, 0.9);
      level /= 1 + Math.hypot(at.x - x, at.z - z) * 0.08;
      g.connect(pan).connect(this.sfx);
    } else {
      g.connect(this.sfx);
    }
    g.gain.value = level;
    return g;
  }

  private env(ctx: AudioContext, node: AudioNode, dest: AudioNode, peak: number, attack: number, decay: number, delay = 0): void {
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    node.connect(g).connect(dest);
  }

  private tone(
    ctx: AudioContext,
    dest: AudioNode,
    type: OscillatorType,
    from: number,
    to: number,
    peak: number,
    attack: number,
    decay: number,
    delay = 0,
  ): void {
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + attack + decay);
    this.env(ctx, o, dest, peak, attack, decay, delay);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  private hiss(
    ctx: AudioContext,
    dest: AudioNode,
    filter: BiquadFilterType,
    freqFrom: number,
    freqTo: number,
    peak: number,
    attack: number,
    decay: number,
    delay = 0,
    q = 1,
  ): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    const t = ctx.currentTime + delay;
    f.frequency.setValueAtTime(freqFrom, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), t + attack + decay);
    src.connect(f);
    this.env(ctx, f, dest, peak, attack, decay, delay);
    src.start(t, Math.random() * 0.5);
    src.stop(t + attack + decay + 0.05);
  }

  // ---------------------------------------------------------------- rally

  /** Paddle on ball: a hollow "pock". Smashes crack, dinks tap. */
  hit(shot: ShotType, at: { x: number; z: number }, strength = 1): void {
    const ctx = this.live();
    if (!ctx) return;
    const loud = shot === 'smash' ? 1.4 : shot === 'dink' ? 0.55 : 1;
    const out = this.out(ctx, at, loud * strength);
    const pitch = shot === 'dink' ? 1.15 : shot === 'smash' ? 0.85 : 1;
    this.tone(ctx, out, 'triangle', 1100 * pitch, 420 * pitch, 0.5, 0.002, 0.07);
    this.hiss(ctx, out, 'bandpass', 2400, 1600, 0.35, 0.001, 0.035, 0, 2);
  }

  /** Ball on court: a short low thud. */
  bounce(at: { x: number; z: number }, speed: number): void {
    const ctx = this.live();
    if (!ctx) return;
    const out = this.out(ctx, at, clamp(speed / 10, 0.15, 0.9));
    this.tone(ctx, out, 'sine', 230, 110, 0.6, 0.002, 0.07);
    this.hiss(ctx, out, 'lowpass', 900, 400, 0.25, 0.001, 0.03);
  }

  /** Ball into the net: a muffled thump with a little rattle. */
  net(at: { x: number; z: number }): void {
    const ctx = this.live();
    if (!ctx) return;
    const out = this.out(ctx, at, 2.6);
    this.hiss(ctx, out, 'lowpass', 600, 220, 0.8, 0.004, 0.18);
    this.hiss(ctx, out, 'bandpass', 3200, 2600, 0.12, 0.002, 0.05, 0.03, 4);
    this.hiss(ctx, out, 'bandpass', 3000, 2400, 0.08, 0.002, 0.05, 0.08, 4);
  }

  /** A swing through the air. */
  swing(at: { x: number; z: number }): void {
    const ctx = this.live();
    if (!ctx) return;
    this.hiss(ctx, this.out(ctx, at, 1.6), 'bandpass', 500, 2200, 0.3, 0.06, 0.12, 0, 1.5);
  }

  // ---------------------------------------------------------------- points & crowd

  /** Short chime: up when you win the point, down when you lose it. */
  point(won: boolean): void {
    const ctx = this.live();
    if (!ctx) return;
    const out = this.out(ctx, undefined, 0.35);
    const notes = won ? [659, 988] : [440, 330];
    notes.forEach((f, i) => this.tone(ctx, out, 'sine', f, f, 0.6, 0.005, 0.22, i * 0.09));
  }

  /**
   * Applause: hundreds of individual hand claps spread over a second or two, plus a few
   * "whoo"s when it's a big moment (0..1).
   */
  cheer(intensity: number): void {
    const ctx = this.live();
    if (!ctx) return;
    const out = this.out(ctx, undefined, 0.5 + intensity * 0.5);
    const duration = 1.1 + intensity * 1.6;
    const claps = Math.round((70 + 230 * intensity) * duration);
    for (let i = 0; i < claps; i++) {
      // More claps early on, tailing off.
      const t = duration * Math.pow(Math.random(), 1.6);
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = 0.8 + Math.random() * 0.6;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900 + Math.random() * 1800;
      f.Q.value = 1.2 + Math.random();
      src.connect(f);
      const peak = (0.15 + Math.random() * 0.35) * (1 - (t / duration) * 0.6);
      this.env(ctx, f, out, peak, 0.002, 0.025 + Math.random() * 0.02, t);
      const at = ctx.currentTime + t;
      src.start(at, Math.random() * 0.9);
      src.stop(at + 0.08);
    }
    // A few cheers from the crowd for the big ones.
    const whoos = intensity > 0.45 ? Math.round(intensity * 4) : 0;
    for (let i = 0; i < whoos; i++) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      const start = ctx.currentTime + 0.05 + Math.random() * 0.4;
      const base = 260 + Math.random() * 220;
      o.frequency.setValueAtTime(base, start);
      o.frequency.exponentialRampToValueAtTime(base * 1.7, start + 0.25);
      o.frequency.exponentialRampToValueAtTime(base * 1.3, start + 0.9);
      const vib = ctx.createOscillator();
      const vibDepth = ctx.createGain();
      vib.frequency.value = 6;
      vibDepth.gain.value = 12;
      vib.connect(vibDepth).connect(o.frequency);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1400;
      o.connect(f);
      this.env(ctx, f, out, 0.05, 0.12, 0.8, start - ctx.currentTime);
      o.start(start);
      vib.start(start);
      o.stop(start + 1.1);
      vib.stop(start + 1.1);
    }
  }

  /**
   * Crowd chatter during matches: several voices, each a band of noise whose loudness and pitch
   * keep changing like syllables, so together they sound like people talking rather than hiss.
   */
  setCrowd(on: boolean): void {
    this.crowdOn = on;
    const ctx = this.ctx;
    if (!ctx) return;
    if (on && !this.babbleBus) {
      this.babbleBus = ctx.createGain();
      this.babbleBus.gain.value = 0;
      this.babbleBus.connect(this.ambience);
      for (let i = 0; i < 9; i++) {
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 400 + Math.random() * 1400;
        filter.Q.value = 7;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        src.connect(filter).connect(gain).connect(this.babbleBus);
        src.start(0, Math.random());
        this.babble.push({ gain, filter });
      }
    }
    if (on && !this.babbleTimer) {
      this.babbleTimer = setInterval(() => {
        const c = this.ctx;
        if (!c) return;
        for (const v of this.babble) {
          // Pauses between "words", and the formant drifts.
          const talking = Math.random() < 0.55;
          v.gain.gain.setTargetAtTime(talking ? 0.4 + Math.random() * 0.6 : 0, c.currentTime, 0.035);
          if (Math.random() < 0.3) v.filter.frequency.setTargetAtTime(350 + Math.random() * 1600, c.currentTime, 0.05);
        }
      }, 110);
    } else if (!on && this.babbleTimer) {
      clearInterval(this.babbleTimer);
      this.babbleTimer = null;
    }
    this.babbleBus?.gain.setTargetAtTime(on ? 0.06 : 0, ctx.currentTime, 0.5);
    this.ambience.gain.setTargetAtTime(1, ctx.currentTime, 0.3);
  }

  /** Background sound for a court: birds, waves and gulls, arena hum, ship drone, city traffic. */
  setAmbience(arena: ArenaId): void {
    if (this.arena === arena) return;
    this.arena = arena;
    const ctx = this.ctx;
    if (!ctx) return; // started once audio is allowed
    for (const n of this.bed.nodes) n.stop();
    for (const t of this.bed.timers) clearInterval(t);
    this.bed = { nodes: [], timers: [] };
    this.ambience.gain.setTargetAtTime(1, ctx.currentTime, 0.3);

    const loopNoise = (filter: BiquadFilterType, freq: number, level: number, swell = 0) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filter;
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = level;
      src.connect(f).connect(g).connect(this.ambience);
      if (swell) {
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = swell;
        depth.gain.value = level * 0.8;
        lfo.connect(depth).connect(g.gain);
        lfo.start();
        this.bed.nodes.push(lfo);
      }
      src.start(0, Math.random());
      this.bed.nodes.push(src);
    };
    const drone = (type: OscillatorType, freq: number, level: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 220;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(f).connect(g).connect(this.ambience);
      o.start();
      this.bed.nodes.push(o);
    };
    const every = (min: number, max: number, fn: () => void) => {
      let next = performance.now() + (min + Math.random() * (max - min)) * 1000;
      this.bed.timers.push(
        setInterval(() => {
          if (performance.now() < next || !this.live()) return;
          next = performance.now() + (min + Math.random() * (max - min)) * 1000;
          fn();
        }, 250),
      );
    };
    const bg = () => this.out(ctx, undefined, 1);
    switch (arena) {
      case 'park': // light breeze and birdsong
        loopNoise('lowpass', 500, 0.012, 0.07);
        every(2.5, 7, () => {
          const out = bg();
          const f = 2600 + Math.random() * 1500;
          for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) this.tone(ctx, out, 'sine', f, f * 1.25, 0.05, 0.005, 0.07, i * 0.11);
        });
        break;
      case 'beach': // waves rolling in, gulls overhead
        loopNoise('lowpass', 520, 0.05, 0.09);
        every(6, 14, () => {
          const out = bg();
          for (let i = 0; i < 3; i++) this.tone(ctx, out, 'triangle', 1500, 1050, 0.04, 0.02, 0.18, i * 0.22);
        });
        break;
      case 'ice': // big indoor arena hum
        drone('sine', 60, 0.03);
        loopNoise('bandpass', 250, 0.012);
        break;
      case 'space': // ship engines and the odd console beep
        drone('sawtooth', 55, 0.025);
        drone('sawtooth', 55.6, 0.025);
        every(4, 10, () => {
          const out = bg();
          this.tone(ctx, out, 'sine', 1320, 1320, 0.05, 0.003, 0.08);
          this.tone(ctx, out, 'sine', 990, 990, 0.04, 0.003, 0.08, 0.12);
        });
        break;
      case 'rooftop': // city traffic far below, a distant horn now and then
        loopNoise('lowpass', 260, 0.04, 0.05);
        every(7, 16, () => {
          const out = bg();
          this.tone(ctx, out, 'square', 392, 392, 0.015, 0.02, 0.35);
          this.tone(ctx, out, 'square', 494, 494, 0.012, 0.02, 0.35);
        });
        break;
    }
  }

  /** The referee calls out ("Out!", the score...) using the browser's speech voice, if there is one. */
  say(text: string): void {
    if (!this._enabled || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('en'));
    if (voice) u.voice = voice;
    u.rate = 1.05;
    u.pitch = 0.85;
    u.volume = 0.9;
    speechSynthesis.speak(u);
  }

  gameOver(won: boolean): void {
    const ctx = this.live();
    if (!ctx) return;
    const out = this.out(ctx, undefined, 0.4);
    const notes = won ? [523, 659, 784, 1047] : [392, 330, 262];
    notes.forEach((f, i) => this.tone(ctx, out, 'triangle', f, f, 0.6, 0.01, i === notes.length - 1 ? 0.6 : 0.18, i * 0.14));
    if (won) this.cheer(1);
  }

  // ---------------------------------------------------------------- power mode

  special(kind: SpecialKind, at?: { x: number; z: number }): void {
    const ctx = this.live();
    if (!ctx) return;
    const out = this.out(ctx, at, 1);
    switch (kind) {
      case 'fire': // roaring whoosh over a low rumble
        this.hiss(ctx, out, 'lowpass', 300, 4000, 0.7, 0.05, 0.5);
        this.tone(ctx, out, 'sawtooth', 90, 55, 0.25, 0.02, 0.5);
        break;
      case 'curve': // rising zing
        this.tone(ctx, out, 'sine', 420, 1700, 0.35, 0.02, 0.4);
        this.tone(ctx, out, 'sine', 425, 1720, 0.2, 0.02, 0.4);
        break;
      case 'phantom': // eerie detuned warble that fades in and out
        this.tone(ctx, out, 'sine', 620, 560, 0.25, 0.25, 0.5);
        this.tone(ctx, out, 'sine', 628, 552, 0.2, 0.25, 0.5);
        this.hiss(ctx, out, 'highpass', 5000, 7000, 0.08, 0.3, 0.4);
        break;
      case 'freeze': // ice chimes
        [1760, 2637, 3520].forEach((f, i) => this.tone(ctx, out, 'sine', f, f, 0.25, 0.003, 0.5, i * 0.06));
        this.hiss(ctx, out, 'highpass', 6000, 9000, 0.12, 0.01, 0.3);
        break;
      case 'thunder': // crack and boom
        this.hiss(ctx, out, 'highpass', 2000, 800, 0.8, 0.002, 0.12);
        this.tone(ctx, out, 'sine', 90, 40, 0.7, 0.01, 0.6, 0.03);
        break;
      case 'clone': // a shimmer that splits in three
        [880, 1108, 1320].forEach((f, i) => this.tone(ctx, out, 'triangle', f, f * 0.98, 0.18, 0.01, 0.35, i * 0.05));
        break;
      case 'quake': // deep rumble
        this.tone(ctx, out, 'sawtooth', 50, 30, 0.5, 0.02, 0.9);
        this.hiss(ctx, out, 'lowpass', 300, 80, 0.8, 0.03, 1.0);
        break;
      case 'blizzard': // icy wind
        this.hiss(ctx, out, 'bandpass', 1500, 4000, 0.5, 0.2, 0.9, 0, 2);
        [2093, 2637, 3136].forEach((f, i) => this.tone(ctx, out, 'sine', f, f, 0.18, 0.003, 0.6, 0.1 + i * 0.08));
        break;
      case 'meteor': // whistle down into a deep boom
        this.tone(ctx, out, 'sine', 1800, 300, 0.25, 0.02, 0.7);
        this.tone(ctx, out, 'sine', 70, 28, 0.9, 0.02, 1.2, 0.5);
        this.hiss(ctx, out, 'lowpass', 1200, 150, 0.7, 0.05, 1.3, 0.5);
        break;
    }
  }

  /** Metallic clang when a special is blocked. */
  block(): void {
    const ctx = this.live();
    if (!ctx) return;
    const out = this.out(ctx, undefined, 0.6);
    this.tone(ctx, out, 'square', 1250, 1180, 0.25, 0.002, 0.25);
    this.tone(ctx, out, 'square', 1870, 1800, 0.15, 0.002, 0.2);
  }

  /** Combo blip, higher for each step. */
  combo(n: number): void {
    const ctx = this.live();
    if (!ctx) return;
    const f = 600 * Math.pow(1.12, Math.min(n, 10));
    this.tone(ctx, this.out(ctx, undefined, 0.25), 'sine', f, f * 1.5, 0.5, 0.005, 0.12);
  }

  // ---------------------------------------------------------------- your controls

  /** A rising tone while you hold a click to charge (null = stop). Above 1 it wobbles. */
  setCharge(charge: number | null): void {
    const ctx = this.ctx;
    if (charge === null || !this.live()) {
      if (this.chargeOsc && ctx) {
        this.chargeGain!.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
        this.chargeOsc.stop(ctx.currentTime + 0.1);
      }
      this.chargeOsc = this.chargeGain = null;
      return;
    }
    if (!ctx) return;
    if (!this.chargeOsc) {
      this.chargeOsc = ctx.createOscillator();
      this.chargeOsc.type = 'triangle';
      this.chargeGain = ctx.createGain();
      this.chargeGain.gain.value = 0;
      this.chargeOsc.connect(this.chargeGain).connect(this.sfx);
      this.chargeOsc.start();
    }
    const over = charge > 1;
    const f = 260 + Math.min(charge, 1) * 520 + (over ? Math.sin(ctx.currentTime * 40) * 60 : 0);
    this.chargeOsc.frequency.setTargetAtTime(f, ctx.currentTime, 0.02);
    this.chargeGain!.gain.setTargetAtTime(over ? 0.09 : 0.05, ctx.currentTime, 0.03);
  }

  /** Soft tick when the timing ring turns green. */
  tick(): void {
    const ctx = this.live();
    if (!ctx) return;
    this.tone(ctx, this.out(ctx, undefined, 0.3), 'sine', 1500, 1500, 0.4, 0.002, 0.05);
  }

  /** Menu button click. */
  click(): void {
    const ctx = this.live();
    if (!ctx) return;
    this.tone(ctx, this.out(ctx, undefined, 0.2), 'sine', 900, 700, 0.5, 0.002, 0.04);
  }
}
