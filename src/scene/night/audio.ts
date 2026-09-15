/*
 * One continuous instrumental synthwave loop across every location, with quiet interaction effects.
 * No layered rain or district ambience. The AudioContext is
 * created lazily on the first pointerdown/keydown (autoplay policy); everything is muted by default
 * unless the visitor unmuted before (localStorage) or `?audio=1` is set for automated checks.
 */
const TRACK = 'neon-cruise-v1';
const STORAGE_KEY = 'night-audio';

export interface NightAudio {
  update(p: number): void;
  setMuted(m: boolean): void;
  readonly muted: boolean;
  readonly ready: boolean;
  /** RMS of the mixed output (0..1); non-zero once something plays. */
  level(): number;
  /** Split-flap clacks: `count` short filtered noise bursts `interval` s apart (no-op while muted). */
  clack(count?: number, interval?: number): void;
  /** Footstep: a soft 120 Hz thump, 40 ms, very quiet (player.ts calls it on each stride). */
  step(): void;
  /** Quiet solid-contact cue, throttled by the player's collision response. */
  bump(): void;
  /** Menu cursor move: 1.2 kHz, 30 ms. */
  select(): void;
  /** Confirm: two blips, 900 → 1400 Hz. */
  confirm(): void;
  /** Channel change: 80 ms of band-passed noise. */
  static(): void;
  dispose(): void;
}

/**
 * Module-level handle for code that has no reference to the NightAudio instance (the carriers' dock
 * interactions): every call forwards to the most recently created audio, and is a no-op before that.
 */
let current: NightAudio | null = null;
export const sfx = {
  step: () => current?.step(),
  select: () => current?.select(),
  confirm: () => current?.confirm(),
  static: () => current?.static(),
  clack: (count?: number, interval?: number) => current?.clack(count, interval),
};

let primed: AudioContext | null = null;
/**
 * Create the AudioContext inside a user gesture (the landing gate's Enter): iOS / Safari only unlock audio from one.
 * Nothing plays; createAudio adopts the context when the sound starts. Safe to call more than once.
 */
export function primeAudio() {
  if (primed) return;
  try {
    primed = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (primed.state === 'suspended') primed.resume().catch(() => {});
  } catch { primed = null; }
}

export function createAudio(opts: { base?: string; volume?: number } = {}): NightAudio {
  const base = opts.base ?? '/night/audio';
  const master = Math.min(1, Math.max(0, opts.volume ?? 0.55));
  const params = new URLSearchParams(location.search);
  let muted = true;
  try {
    if (localStorage.getItem(STORAGE_KEY) === 'on') muted = false;
  } catch { /* storage blocked */ }
  if (params.get('audio') === '1') muted = false;

  let ctx: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let ambience: BiquadFilterNode | null = null;
  let analyser: AnalyserNode | null = null;
  let analyserBuf: Float32Array<ArrayBuffer> | null = null;
  const gains = new Map<string, GainNode>();
  const sources = new Map<string, AudioBufferSourceNode>();
  let ready = false;
  let starting = false;

  const canOpus = (() => {
    try { return document.createElement('audio').canPlayType('audio/ogg; codecs=opus') !== ''; } catch { return false; }
  })();

  async function loadLoop(name: string) {
    if (!ctx) return;
    const ext = canOpus ? 'opus' : 'm4a';
    const res = await fetch(`${base}/${name}.${ext}`);
    if (!res.ok) throw new Error(`audio ${name}.${ext} ${res.status}`);
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(ambience!);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain);
    src.start(0); // start on the downbeat; location changes never restart the track
    gains.set(name, gain);
    sources.set(name, src);
  }

  async function start() {
    if (ctx || starting) return;
    starting = true;
    try {
      ctx = primed ?? new (window.AudioContext || (window as any).webkitAudioContext)();
      if (ctx.state === 'suspended' && !muted) ctx.resume().catch(() => {});
      masterGain = ctx.createGain();
      masterGain.gain.value = 0;
      // Gentle bandwidth control without muffling the synth melody.
      ambience = ctx.createBiquadFilter();
      ambience.type = 'lowpass'; ambience.frequency.value = 8500; ambience.Q.value = 0.5;
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass'; highpass.frequency.value = 45; highpass.Q.value = 0.5;
      ambience.connect(highpass); highpass.connect(masterGain);
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -12; compressor.knee.value = 12;
      compressor.ratio.value = 4; compressor.attack.value = 0.004; compressor.release.value = 0.2;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyserBuf = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
      masterGain.connect(compressor); compressor.connect(analyser);
      analyser.connect(ctx.destination);
      const names = [TRACK];
      const results = await Promise.allSettled(names.map(loadLoop));
      results.forEach((r, i) => { if (r.status === 'rejected') console.warn('[audio] loop failed', names[i], r.reason); });
      ready = gains.size > 0;
      applyMute();
      gains.get(TRACK)?.gain.setTargetAtTime(0.65, ctx.currentTime, 0.6);
    } catch (e) {
      console.warn('[audio] unavailable', e);
    } finally {
      starting = false;
    }
  }

  function applyMute() {
    if (!ctx || !masterGain) return;
    if (ctx.state === 'suspended' && !muted) ctx.resume().catch(() => {});
    masterGain.gain.setTargetAtTime(muted || document.hidden ? 0 : master, ctx.currentTime, 0.25);
  }

  // ---- synth SFX: one-shot bursts (oscillator or band-passed noise) with an exponential decay, straight into the master.
  interface Burst {
    /** Oscillator pitch, or the bandpass centre for `noise`. */
    freq: number;
    /** Bandpass Q (noise only). */
    q?: number;
    gain: number;
    /** Decay time (s). */
    dur: number;
    noise?: boolean;
    type?: OscillatorType;
    /** Pitch glide target (oscillator only). */
    to?: number;
    /** Start offset (s) from now. */
    at?: number;
  }
  let noiseBuf: AudioBuffer | null = null;
  let bursts = 0;
  let activeBursts = 0;
  function burst(b: Burst) {
    if (!ctx || !masterGain || muted || document.hidden || activeBursts >= 6) return;
    const t0 = ctx.currentTime + (b.at ?? 0);
    const g = ctx.createGain();
    // Start and end at silence instead of switching an arbitrary oscillator/noise sample on abruptly.
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(b.gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + b.dur);
    g.gain.linearRampToValueAtTime(0, t0 + b.dur + 0.01);
    g.connect(masterGain);
    let src: AudioScheduledSourceNode;
    let filter: BiquadFilterNode | null = null;
    if (b.noise) {
      if (!noiseBuf) {
        noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const n = ctx.createBufferSource();
      n.buffer = noiseBuf;
      n.loop = true;
      const bp = ctx.createBiquadFilter();
      filter = bp;
      bp.type = 'bandpass'; bp.frequency.value = b.freq; bp.Q.value = b.q ?? 1;
      n.connect(bp); bp.connect(g);
      src = n;
    } else {
      const o = ctx.createOscillator();
      o.type = b.type ?? 'sine';
      o.frequency.setValueAtTime(b.freq, t0);
      if (b.to) o.frequency.exponentialRampToValueAtTime(b.to, t0 + b.dur);
      o.connect(g);
      src = o;
    }
    src.start(t0);
    src.stop(t0 + b.dur + 0.02);
    activeBursts++;
    src.onended = () => { src.disconnect(); filter?.disconnect(); g.disconnect(); activeBursts--; };
    bursts++;
  }
  /** Split-flap clacks: `count` bursts `interval` s apart, each a random 1.4–2 kHz bandpassed tick. */
  function clack(count = 1, interval = 0.07) {
    for (let k = 0; k < Math.min(3, count); k++) burst({ freq: 900 + Math.random() * 300, q: 2, gain: 0.08, dur: 0.05, noise: true, at: k * Math.max(.1, interval) });
  }
  const step = () => burst({ freq: 120, to: 70, gain: 0.025, dur: 0.05 });
  const select = () => burst({ freq: 750, gain: 0.055, dur: 0.045 });
  const confirm = () => { burst({ freq: 660, gain: 0.065, dur: 0.06 }); burst({ freq: 990, gain: 0.055, dur: 0.08, at: 0.08 }); };
  const staticBurst = () => burst({ freq: 1100, q: 1, gain: 0.035, dur: 0.08, noise: true });

  // Autoplay policy: only a user gesture may create/resume the context.
  const onGesture = () => { start(); };
  addEventListener('pointerdown', onGesture, { passive: true });
  addEventListener('keydown', onGesture);
  document.addEventListener('visibilitychange', applyMute);
  // Automated checks (`?audio=1`): headless Chrome allows autoplay with --autoplay-policy=no-user-gesture-required.
  if (params.get('audio') === '1') setTimeout(start, 0);

  const api: NightAudio = {
    update(_p) { /* The soundtrack continues unchanged between locations. */ },
    clack, step, select, confirm, static: staticBurst,
    bump: () => burst({ freq: 95, to: 45, gain: .09, dur: .1 }),
    setMuted(m) {
      muted = m;
      try { localStorage.setItem(STORAGE_KEY, m ? 'off' : 'on'); } catch { /* ignore */ }
      if (!m) start();
      applyMute();
      document.documentElement.dataset.audio = m ? 'off' : 'on';
    },
    get muted() { return muted; },
    get ready() { return ready; },
    level() {
      if (!analyser || !analyserBuf) return 0;
      analyser.getFloatTimeDomainData(analyserBuf);
      let sum = 0;
      for (let i = 0; i < analyserBuf.length; i++) sum += analyserBuf[i] * analyserBuf[i];
      return Math.sqrt(sum / analyserBuf.length);
    },
    dispose() {
      removeEventListener('pointerdown', onGesture);
      removeEventListener('keydown', onGesture);
      document.removeEventListener('visibilitychange', applyMute);
      for (const s of sources.values()) { try { s.stop(); } catch { /* already stopped */ } }
      ctx?.close().catch(() => {});
      ctx = null;
    },
  };
  document.documentElement.dataset.audio = muted ? 'off' : 'on';
  (window as any).__audio = { level: () => api.level(), ready: () => api.ready, muted: () => api.muted, bursts: () => bursts };
  current = api;
  return api;
}

/** Wire a nav button (`<button class="audio-toggle" aria-pressed>`) to the audio: click toggles, label follows. */
export function bindAudioToggle(audio: NightAudio, button: HTMLElement | null) {
  if (!button) return;
  const sync = () => {
    const on = !audio.muted;
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? 'Mute soundtrack' : 'Unmute soundtrack');
    button.dataset.state = on ? 'on' : 'off';
  };
  button.addEventListener('click', () => { audio.setMuted(!audio.muted); sync(); });
  sync();
}
