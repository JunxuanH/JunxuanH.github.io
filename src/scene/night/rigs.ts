/**
 * Per-rig runtime table for the fal/Meshy characters (public/night/characters/<name>). The numbers come
 * from the audit (`scripts/rig-audit.mjs` → design/night/characters/audit.json); `ok` / `note` are the
 * hand-written verdicts. characters.ts wraps every instance in a pivot that applies `yaw` and
 * `groundOffset`, scales the rig to `height`, and drives the walk/run clips at `stride` / `strideRun`
 * (u/s at timeScale 1) so the planted foot does not slide. Values are in rig units (Meshy: metres at the
 * declared height); `headY` / `stepLen` scale with `height / asset.height` at runtime.
 */
export interface RigMeta {
  /** Default world height of the character (bbox, u). */
  height: number;
  /** Yaw correction so the rig faces +z (radians). */
  yaw: number;
  /** Walk clip stride speed at timeScale 1 (u/s). */
  stride: number;
  /** Run clip stride speed at timeScale 1 (u/s). */
  strideRun: number;
  /** Added to the model's y so the planted foot sits on y = 0 (rig units; walk clip, and any clip without its own). */
  groundOffset: number;
  /** Same for the run / idle clips when they differ (the run dips deeper, the idle pose sits on 0). */
  groundOffsetRun?: number;
  groundOffsetIdle?: number;
  /** Any other clip by key (lookaround, gesture, strut, …); unlisted clips use the idle offset. */
  groundOffsets?: Record<string, number>;
  /** Head bone height at rest (rig units) — look-at target, follow-camera focus. */
  headY: number;
  /** Distance between successive footfalls when walking (u, footstep cue). */
  stepLen: number;
  /** Same for the run clip. */
  stepLenRun: number;
  /** false = keep the rig out of the crowd rosters (still loadable in the lab). */
  ok: boolean;
  /** Audit verdict / decision (also mirrored in design/night/characters/README.md). */
  note: string;
}

export const RIG_DEFAULT: RigMeta = {
  height: 1.75, yaw: 0, stride: 1.2, strideRun: 3.4, groundOffset: 0, headY: 1.6, stepLen: 0.6, stepLenRun: 1.1, ok: true, note: '',
};

/**
 * Filled from audit.json (2026-09-14 raw audit, scripts/rig-audit.mjs); only the fields that differ from
 * RIG_DEFAULT are listed. Facing: every Meshy rig already faces +z (yaw 0, none mirrored). Strides: the
 * walk clip is 1.25–1.72 u/s and the run clip 3.6–6.4 u/s at timeScale 1 (the old runtime assumed 1.2 /
 * 3.4 for all rigs, so every walker's feet slid ~20 %). Ground: the planted foot dips 1–5 cm below y = 0 in
 * the walk/run clips while the idle pose sits on 0, hence the per-clip offsets.
 */
export const RIG_META: Record<string, Partial<RigMeta>> = {
  'ronin-player': { height: 1.8, stride: 1.483, strideRun: 5.392, groundOffset: .002, groundOffsetRun: .022, groundOffsetIdle: -.0153, headY: 1.567, stepLen: .791, stepLenRun: 1.797, note: 'Selected anime protagonist: silver hair, purple bomber. Hunyuan 3.1 Pro + one Meshy skeleton; 39,757 triangles, no stray weights. Idle offset expressed in exported 1.17647x clip units; normalized at runtime.' },
  soldier: { height: 1.85, stride: 1.54, strideRun: 4.6, groundOffset: 0.02, groundOffsetRun: 0, groundOffsetIdle: 0, groundOffsets: { lookaround: -0.077, combat: -0.077, gesture: -0.014, strut: 0 }, headY: 1.65, stepLen: 0.82, stepLenRun: 1.76, note: 'protagonist v2 (2026-09-14): concept-1 of 3, Hunyuan Normal+PBR (39.6 k tris) + Meshy multi-animation on one skeleton — idle 0, lookaround 338 (one-shot idle variety after 8 s), run 14 Run_02, walk = Meshy basic walking; extras on disk: combat 89 (crouched guard stance, floats 7.7 cm → offset), strut 106 Confident_Walk (0.71 u/s, too slow for the 2.4 u/s walk), gesture 2 Alert. Clean skin (stray 0, maxDisp 0.12 on walk/run)' },
  agent: { height: 1.8, stride: 1.42, strideRun: 5.03, groundOffset: 0.025, groundOffsetRun: 0.039, groundOffsetIdle: 0, headY: 1.57, stepLen: 0.76, stepLenRun: 1.68, note: 'protagonist (2026-09-14): concept-2 of 3 (cleanest A-pose), Hunyuan LowPoly + Meshy idle 0; clean rig, no faults' },
  netrunner: { height: 1.75, stride: 1.44, strideRun: 5.25, groundOffset: 0, groundOffsetRun: 0.019, headY: 1.56, stepLen: 0.77, stepLenRun: 1.75, note: 'clean; was the protagonist, now a crowd rig. Data fix only (stride 1.44 vs the old 1.2 assumption)' },
  corpo: { height: 1.75, stride: 1.36, strideRun: 4.98, groundOffset: 0.022, groundOffsetRun: 0.03, groundOffsetIdle: 0.014, headY: 1.54, stepLen: 0.73, stepLenRun: 1.66, note: 'clean (OBJ-zip quirk at generation, see README); data fix only' },
  vendor: { height: 1.75, stride: 1.3, strideRun: 4.54, groundOffset: 0.027, groundOffsetRun: 0.035, groundOffsetIdle: 0.014, headY: 1.53, stepLen: 0.69, stepLenRun: 1.51, note: 'accepted: stretch 2.8 is the raised-arm idle (Meshy 12) pulling the apron, maxDisp 0.39 only in idle; no stray weights. Re-rigged 2026-09-14 by the multi-animation call ($0.56) that added talk (313) + wave (28)' },
  punk: { height: 1.75, stride: 1.33, strideRun: 4.81, groundOffset: 0.011, groundOffsetRun: 0.021, groundOffsetIdle: 0, headY: 1.5, stepLen: 0.71, stepLenRun: 1.6, note: "clean; re-rigged 2026-09-14 by the multi-animation call ($0.56) that added talk (308) + wave (290); numbers re-audited on the new rig" },
  'sec-bot': { height: 2.1, stride: 1.72, strideRun: 6.42, groundOffset: 0.012, groundOffsetRun: 0.033, groundOffsetIdle: 0, headY: 1.87, stepLen: 0.92, stepLenRun: 2.14, note: 'clean; the rig was made at 2.1 m (meta.json said 1.75 — corrected). Robot patrols keep height 2.1' },
  chef: { height: 1.78, stride: 1.41, strideRun: 5.08, groundOffset: 0.024, groundOffsetRun: 0.034, groundOffsetIdle: 0, headY: 1.55, stepLen: 0.75, stepLenRun: 1.69, note: 'regenerated 2026-09-14 (concept-v3, props-free, $1.07): v2 had a wok + holo sign that became geometry weighted to the forearm/legs (stray 14 %, maxDisp 0.46, stretch 18); v3 audits clean (stray 0, maxDisp 0.17)' },
  'geisha-bot': { height: 1.8, stride: 1.31, strideRun: 4.92, groundOffset: 0.019, groundOffsetRun: 0.033, groundOffsetIdle: 0.011, headY: 1.52, stepLen: 0.7, stepLenRun: 1.64, note: "accepted: stretch 3.1 is the kimono hem while the legs move (maxDisp 0.57 only in the big wave); re-rigged 2026-09-14 by the multi-animation call ($0.56) that added talk (313) + wave (28)" },
  idol: { height: 1.65, stride: 1.35, strideRun: 4.66, groundOffset: 0.036, groundOffsetRun: 0.051, groundOffsetIdle: 0, headY: 1.4, stepLen: 0.72, stepLenRun: 1.55, note: "accepted: 12.5 % 'stray' is the twin-tail hair weighted to Head/neck (far from the bone by design), maxDisp 0.20; sinking fixed by offset" },
  ronin: { height: 1.78, stride: 1.4, strideRun: 4.86, groundOffset: 0.026, groundOffsetRun: 0.035, groundOffsetIdle: 0, headY: 1.53, stepLen: 0.74, stepLenRun: 1.62, note: 'clean; data fix only' },
  'schoolgirl-hacker': { height: 1.6, stride: 1.55, strideRun: 3.55, groundOffset: 0.047, groundOffsetRun: 0.049, groundOffsetIdle: -0.038, headY: 1.32, stepLen: 0.83, stepLenRun: 1.18, note: 'clean (kiosk NPC, camera-close): 4.7 cm sink in walk / 3.8 cm float in idle fixed per clip; short legs → run stride 3.55' },
  'mech-pilot': { height: 1.9, stride: 1.46, strideRun: 5.27, groundOffset: 0.041, groundOffsetRun: 0.056, groundOffsetIdle: 0, headY: 1.5, stepLen: 0.78, stepLenRun: 1.76, note: 'accepted: stretch 2.0 / run maxDisp 0.38 are the shoulder pads of the bulky suit; sinking fixed by offset' },
  'cat-courier': { height: 1.65, stride: 1.28, strideRun: 4.63, groundOffset: 0.031, groundOffsetRun: 0.044, groundOffsetIdle: 0, headY: 1.36, stepLen: 0.69, stepLenRun: 1.54, note: 'clean; sinking fixed by offset' },
  'oni-bouncer': { height: 2.0, stride: 1.57, strideRun: 5.51, groundOffset: 0.021, groundOffsetRun: 0.034, groundOffsetIdle: 0, headY: 1.71, stepLen: 0.84, stepLenRun: 1.84, note: 'accepted (bus-stop NPC): 1.9 % stray = the long coat hem weighted to Hips/UpLegs; no explosion' },
  'maid-bot': { height: 1.7, stride: 1.38, strideRun: 4.96, groundOffset: 0.021, groundOffsetRun: 0.033, groundOffsetIdle: -0.018, headY: 1.46, stepLen: 0.73, stepLenRun: 1.65, note: 'clean; data fix only' },
  medic: { height: 1.72, stride: 1.38, strideRun: 4.97, groundOffset: 0.011, groundOffsetRun: 0.027, groundOffsetIdle: -0.011, headY: 1.49, stepLen: 0.74, stepLenRun: 1.66, note: 'clean; data fix only' },
  skater: { height: 1.65, stride: 1.28, strideRun: 4.56, groundOffset: 0.039, groundOffsetRun: 0.056, groundOffsetIdle: 0, headY: 1.43, stepLen: 0.68, stepLenRun: 1.52, note: 'clean; sinking fixed by offset' },
  salaryman: { height: 1.75, stride: 1.41, strideRun: 5.03, groundOffset: 0.017, groundOffsetRun: 0.028, groundOffsetIdle: 0, headY: 1.53, stepLen: 0.75, stepLenRun: 1.68, note: "clean; re-rigged 2026-09-14 by the multi-animation call ($0.56) that added talk (312, phone call) + wave (290)" },
  dj: { height: 1.7, stride: 1.4, strideRun: 4.95, groundOffset: 0.012, groundOffsetRun: 0.036, groundOffsetIdle: -0.014, headY: 1.41, stepLen: 0.75, stepLenRun: 1.65, note: 'clean; data fix only' },
  nomad: { height: 1.78, stride: 1.45, strideRun: 5.25, groundOffset: 0, groundOffsetRun: 0.011, groundOffsetIdle: -0.013, headY: 1.59, stepLen: 0.78, stepLenRun: 1.75, note: 'clean; data fix only' },
  'noodle-cook': { height: 1.68, stride: 1.25, strideRun: 4.42, groundOffset: 0.031, groundOffsetRun: 0.037, groundOffsetIdle: 0, headY: 1.45, stepLen: 0.67, stepLenRun: 1.47, note: 'clean; sinking fixed by offset' },
  'patrol-bot': { height: 1.9, stride: 1.54, strideRun: 5.65, groundOffset: 0, groundOffsetIdle: -0.033, headY: 1.56, stepLen: 0.82, stepLenRun: 1.89, note: 'clean (v2 concept); idle floats 3 cm → per-clip offset' },
  'delivery-rider': { height: 1.68, stride: 1.37, strideRun: 4.87, groundOffset: 0.011, groundOffsetRun: 0.026, groundOffsetIdle: -0.017, headY: 1.41, stepLen: 0.73, stepLenRun: 1.62, note: "batch 3 (2026-09-14, $0.92 + concept): bubble-helmet food rider; clean (run maxDisp 0.32 = puffer sleeves)" },
  'tech-shaman': { height: 1.65, stride: 1.31, strideRun: 4.64, groundOffset: 0, groundOffsetIdle: -0.03, headY: 1.44, stepLen: 0.7, stepLenRun: 1.55, note: "batch 3: elderly cable-dreadlock shaman; accepted: the patchwork robe hem shears a little in walk/run (maxDisp 0.29/0.35 on the legs), no stray weights" },
  'tagger': { height: 1.58, stride: 1.23, strideRun: 4.3, groundOffset: 0.048, groundOffsetRun: 0.06, groundOffsetIdle: 0, headY: 1.35, stepLen: 0.66, stepLenRun: 1.44, note: "batch 3: teen graffiti tagger; clean; sinks 4.8 cm in walk → offset, stretch 2.0 = the oversized vest" },
  'dock-worker': { height: 1.95, stride: 1.6, strideRun: 5.67, groundOffset: 0.041, groundOffsetRun: 0.061, groundOffsetIdle: 0, headY: 1.75, stepLen: 0.85, stepLenRun: 1.89, note: "batch 3: heavy augmented dock worker; clean; sinks 4.1 cm in walk → offset" },
  'bouncer-android': { height: 2.0, stride: 1.65, strideRun: 6.0, groundOffset: 0.028, groundOffsetRun: 0.041, groundOffsetIdle: 0, headY: 1.76, stepLen: 0.88, stepLenRun: 2.0, note: "batch 3: club bouncer android, red visor; clean" },
  'yakuza-boss': { height: 1.8, stride: 1.5, strideRun: 5.3, groundOffset: 0.037, groundOffsetRun: 0.017, groundOffsetIdle: 0, headY: 1.6, stepLen: 0.8, stepLenRun: 1.77, note: "batch 3 (concept re-rolled once: v1 had the arms down and the feet cropped): glowing-suit yakuza boss; clean; sinks 3.7 cm → offset" },
  'nurse': { height: 1.7, stride: 1.33, strideRun: 4.8, groundOffset: 0.015, groundOffsetRun: 0.028, groundOffsetIdle: 0, headY: 1.45, stepLen: 0.71, stepLenRun: 1.6, note: "batch 3: bioluminescent-tattoo nurse; clean" },
  'tourist': { height: 1.72, stride: 1.6, strideRun: 4.53, groundOffset: 0.059, groundOffsetRun: 0.079, groundOffsetIdle: 0.087, headY: 1.29, stepLen: 0.85, stepLenRun: 1.51, ok: false, note: "DROPPED (batch 3): the clear rain poncho + chest camera became geometry weighted to both legs (stray 15 %, run maxDisp 0.90, stretch 26 — a black smear down the front mid-run); no budget left for a re-rig, kept on disk for the lab only" },
  'exo-courier': { height: 1.78, stride: 1.42, strideRun: 4.99, groundOffset: 0.033, groundOffsetRun: 0.05, groundOffsetIdle: -0.021, headY: 1.48, stepLen: 0.76, stepLenRun: 1.66, note: "batch 3: slim exo-frame courier; clean; sinks 3.3 cm → offset" },
};

/** Every rigged character (lab page rosters, contact sheets). */
export const RIG_NAMES = Object.keys(RIG_META);

/** Ground offset to apply while `clip` plays (rig units). */
export function groundOffsetFor(meta: RigMeta, clip: string | null | undefined) {
  if (clip && meta.groundOffsets && meta.groundOffsets[clip] !== undefined) return meta.groundOffsets[clip];
  if (clip === 'run' && meta.groundOffsetRun !== undefined) return meta.groundOffsetRun;
  if (clip === 'idle' && meta.groundOffsetIdle !== undefined) return meta.groundOffsetIdle;
  if (clip && clip !== 'walk' && clip !== 'run' && meta.groundOffsetIdle !== undefined) return meta.groundOffsetIdle; // talk/wave/sit: standing clips
  return meta.groundOffset;
}

/** Merged meta for a rig; the asset's measured height is the fallback when the table has none. */
export function rigMeta(name: string, asset?: { height?: number } | null): RigMeta {
  const row = RIG_META[name] ?? {};
  return { ...RIG_DEFAULT, height: row.height ?? asset?.height ?? RIG_DEFAULT.height, ...row };
}
