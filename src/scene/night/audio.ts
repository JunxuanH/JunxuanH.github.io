import { SECTIONS, type SectionId } from './journey';

/*
 * Ambient sound. Five seamless loops (public/night/audio/<name>.{opus,m4a}, see scripts/night-audio.sh):
 * a constant rain bed plus one loop per district, crossfaded by journey progress. The AudioContext is
 * created lazily on the first pointerdown/keydown (autoplay policy); everything is muted by default
 * unless the visitor unmuted before (localStorage) or `?audio=1` is set for automated checks.
 */
const DISTRICT_LOOPS: Record<Exclude<SectionId, 'city'>, string> = {
  education: 'japantown', work: 'center', projects: 'kabuki', contact: 'pier',
};
const BED = 'rain';
const STORAGE_KEY = 'night-audio';
const FEATHER = 0.05;

export interface NightAudio {
  update(p: number): void;
  setMuted(m: boolean): void;
  readonly muted: boolean;
  readonly ready: boolean;
  /** RMS of the mixed output (0..1); non-zero once something plays. */
  level(): number;
  /** Split-flap clacks: `count` short filtered noise bursts `interval` s apart (no-op while muted). */
  clack(count?: number, interval?: number): void;
  dispose(): void;
}

/** Triangle window over a section range with ±FEATHER feathering; 1 well inside, 0 outside. */
function windowFor(p: number, start: number, end: number) {
  const inA = Math.min(1, Math.max(0, (p - (start - FEATHER)) / (2 * FEATHER)));
  const outA = Math.min(1, Math.max(0, ((end + FEATHER) - p) / (2 * FEATHER)));
  return Math.min(inA, outA);
}

export function createAudio(opts: { base?: string; volume?: number } = {}): NightAudio {
  const base = opts.base ?? '/night/audio';
  const master = opts.volume ?? 0.8;
  const params = new URLSearchParams(location.search);
  let muted = true;
  try {
    if (localStorage.getItem(STORAGE_KEY) === 'on') muted = false;
  } catch { /* storage blocked */ }
  if (params.get('audio') === '1') muted = false;

  let ctx: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let analyser: AnalyserNode | null = null;
  let analyserBuf: Float32Array<ArrayBuffer> | null = null;
  const gains = new Map<string, GainNode>();
  const sources = new Map<string, AudioBufferSourceNode>();
  let ready = false;
  let starting = false;
  let lastP = 0;

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
    gain.connect(masterGain!);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(gain);
    src.start(0, Math.random() * buf.duration); // desync the loops
    gains.set(name, gain);
    sources.set(name, src);
  }

  async function start() {
    if (ctx || starting) return;
    starting = true;
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0;
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyserBuf = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
      masterGain.connect(analyser);
      analyser.connect(ctx.destination);
      const names = [BED, ...Object.values(DISTRICT_LOOPS)];
      const results = await Promise.allSettled(names.map(loadLoop));
      results.forEach((r, i) => { if (r.status === 'rejected') console.warn('[audio] loop failed', names[i], r.reason); });
      ready = gains.size > 0;
      applyMute();
      applyMix(lastP, true);
    } catch (e) {
      console.warn('[audio] unavailable', e);
    } finally {
      starting = false;
    }
  }

  function applyMute() {
    if (!ctx || !masterGain) return;
    if (ctx.state === 'suspended' && !muted) ctx.resume().catch(() => {});
    masterGain.gain.setTargetAtTime(muted ? 0 : master, ctx.currentTime, 0.25);
  }

  let noiseBuf: AudioBuffer | null = null;
  function clack(count = 1, interval = 0.07) {
    if (!ctx || !masterGain || muted) return;
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.03), ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    }
    for (let k = 0; k < count; k++) {
      const t0 = ctx.currentTime + k * interval;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.frequency.value = 1400 + Math.random() * 600; bp.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
      src.connect(bp); bp.connect(g); g.connect(masterGain);
      src.start(t0);
    }
  }

  function applyMix(p: number, immediate = false) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const set = (name: string, v: number) => {
      const g = gains.get(name);
      if (!g) return;
      if (immediate) g.gain.setValueAtTime(v, t);
      else g.gain.setTargetAtTime(v, t, 0.35);
    };
    set(BED, 0.4);
    for (const s of SECTIONS) {
      if (s.id === 'city') continue;
      set(DISTRICT_LOOPS[s.id], windowFor(p, s.start, s.end));
    }
  }

  // Autoplay policy: only a user gesture may create/resume the context.
  const onGesture = () => { start(); };
  addEventListener('pointerdown', onGesture, { passive: true });
  addEventListener('keydown', onGesture);
  // Automated checks (`?audio=1`): headless Chrome allows autoplay with --autoplay-policy=no-user-gesture-required.
  if (params.get('audio') === '1') setTimeout(start, 0);

  const api: NightAudio = {
    update(p) {
      lastP = p;
      if (ready) applyMix(p);
    },
    clack,
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
      for (const s of sources.values()) { try { s.stop(); } catch { /* already stopped */ } }
      ctx?.close().catch(() => {});
      ctx = null;
    },
  };
  document.documentElement.dataset.audio = muted ? 'off' : 'on';
  (window as any).__audio = { level: () => api.level(), ready: () => api.ready, muted: () => api.muted };
  return api;
}

/** Wire a nav button (`<button class="audio-toggle" aria-pressed>`) to the audio: click toggles, label follows. */
export function bindAudioToggle(audio: NightAudio, button: HTMLElement | null) {
  if (!button) return;
  const sync = () => {
    const on = !audio.muted;
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? 'Mute ambient sound' : 'Unmute ambient sound');
    button.dataset.state = on ? 'on' : 'off';
  };
  button.addEventListener('click', () => { audio.setMuted(!audio.muted); sync(); });
  sync();
}
