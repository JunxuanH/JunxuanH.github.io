/**
 * Harbor departures board (contact). A split-flap board on two legs at the pier end, between the
 * LinkedIn / GitHub neon poles, facing −z toward the arriving camera at (134.6, 5, 14.5).
 *
 * The face is painted here (`art`, handed to content.ts's board plane) rather than by district-art's poster,
 * because the board says DEPARTURES and so it should list departures: one row per link in the contact
 * section's own markup, gate / destination / time / status, read from the DOM so the board and the terminal
 * can never disagree. The arrival cue shuffles the letters and they settle column by column as the car lands
 * — the frame's header has always promised a split-flap board and this is what finally animates it. ~5 draws.
 */
import * as THREE from 'three/webgpu';
import { glowMaterial } from '../tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { THEMES } from '../theme';
import { neonText } from '../signs';
import { sfx } from '../audio';
import { keyToAction, setSel, hint, clearHint, retrigger, type DockActions } from './dock';
import type {Carrier, CarrierCtx } from './index';

const DECK_Y = 2.9;        // pier deck (districts/pier.ts)
const BX = 140, BZ = 32.1; // board centre
const BOTTOM = 5.9;        // board bottom edge: the landed car stays below it
const FRAME_H = 5.4;

// ---- the departures listing. The board carries what its header promises: one row per contact link, in
// split-flap type, painted from the section's own DOM so the statuses on the board and in the terminal
// are the same strings. content.ts hands this canvas to the board plane (Carrier.art).
const CW = 1024, CH = 512;
/** Per-column x origin and character count, in canvas px. Cells are PITCH apart. */
const PITCH = 38, CELL_W = 34, CELL_H = 84;
const COLS = { gate: 32, dest: 132, time: 466, status: 684 } as const;
const LEN = { gate: 2, dest: 8, time: 5, status: 8 } as const;
const ROW_TOP = 110, ROW_PITCH = 132;
/** Departure times, one per row. Fixed: a board that counted down would be a clock, not a set piece. */
const TIMES = ['21:40', '22:05', '23:15'];
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const AMBER = '#ffb000';
/**
 * A character settles this long after its flap starts, plus this much per column to its left, and each row
 * starts ROW_LAG after the one above it. The arrival cue fires behind the location fade (nav.ts CUT.fade,
 * 0.3 s), so the whole flap has to outlast the black or the visitor never sees it.
 */
const SETTLE = 0.5, PER_CHAR = 0.09, ROW_LAG = 0.22, SPIN = 0.045;

type Field = keyof typeof COLS;
const FIELDS: Field[] = ['gate', 'dest', 'time', 'status'];
/** Uppercase ASCII of a link's label: the flaps carry one glyph set, and Résumé has to fit it. */
const flatten = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9 :]/g, '');


export function create(ctx: CarrierCtx): Carrier {
  const T = THEMES.contact;
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x0b0c12, roughness: 0.5, metalness: 0.6 });
  const yellow = glowMaterial(T.secondary, 1.2);

  // Two legs from the deck to the board bottom, merged.
  group.add(new THREE.Mesh(mergeGeometries([
    new THREE.BoxGeometry(0.24, 3.0, 0.24).translate(BX - 4.4, DECK_Y + 1.5, BZ),
    new THREE.BoxGeometry(0.24, 3.0, 0.24).translate(BX + 4.4, DECK_Y + 1.5, BZ),
  ], false)!, dark));
  // Frame with a yellow bezel behind it (both re-sized in fit()), header cap + neon on top.
  const frame = new THREE.Mesh(new THREE.BoxGeometry(10.6, FRAME_H, 0.35), dark);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(10.8, FRAME_H + 0.2, 0.2), yellow);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.5, 0.4), dark);
  const header = neonText('PIER 9 · DEPARTURES', T.signGlow, 6, { gain: 1.1 });
  header.rotation.y = Math.PI;
  const mount = new THREE.Object3D();
  mount.rotation.y = Math.PI; // local +z → world −z, toward the quay
  group.add(frame, bezel, cap, header, mount);

  /** Lay the frame out around a board of height h with its bottom edge pinned at BOTTOM. */
  const place = (h: number) => {
    const H = h + 0.5, cy = BOTTOM + h / 2;
    frame.scale.y = H / FRAME_H;
    bezel.scale.y = (H + 0.2) / (FRAME_H + 0.2);
    frame.position.set(BX, cy, BZ);
    bezel.position.set(BX, cy, BZ + 0.25);
    cap.position.set(BX, cy + H / 2 + 0.25, BZ);
    header.position.set(BX, cy + H / 2 + 0.55, BZ - 0.22);
    mount.position.set(BX, cy, BZ - 0.2);
  };
  place(4.8); // frame centred at 8.3 until the board is painted

  // ---- dock: the three links are departure rows; ↑/↓ move the cursor, Enter flaps the row's status to BOARDED
  // (clacks) and opens the link in a new tab half a second later. Statuses go back to normal on undock.
  let rows: HTMLAnchorElement[] = [], sel = 0, docked = false;
  const timers: number[] = [];
  const move = (d: number) => { if (!rows.length) return; sel = (sel + d + rows.length) % rows.length; setSel(rows, sel); sfx.select(); };
  const board = () => {
    const row = rows[sel];
    if (!row) return;
    row.dataset.statusHome ??= row.dataset.status ?? '';
    row.dataset.status = 'BOARDED';
    retrigger(row, 'is-flip');
    sfx.clack(6);
    timers.push(window.setTimeout(() => { if (docked) window.open(row.href, '_blank', 'noopener'); }, 500));
  };
  const actions: DockActions = { up: () => move(-1), down: () => move(1), confirm: board };

  // ---- the board face. Painted here rather than by district-art's poster: the rows are this section's own
  // links, read from its DOM, so the board and the terminal always show the same statuses. Driven from the
  // frame loop (content.ts ticks `art.update`) rather than timers, which background tabs throttle to seconds.
  let links: HTMLAnchorElement[] = [];
  let g: CanvasRenderingContext2D | null = null;
  let dirty = true;
  /** Seconds into the current flap, −1 at rest; per row, when its flap started (−1 = this row is not flipping). */
  let flapT = -1, flapFields: Field[] = FIELDS;
  const rowStart = [-1, -1, -1];
  const FLAP_END = SETTLE + PER_CHAR * LEN.status + ROW_LAG * 2 + 0.1;

  /** Start a flap of `fields`; `only` restricts it to one row, otherwise the rows cascade. */
  function flap(fields: Field[], only = -1) {
    dirty = true;
    if (ctx.reducedMotion) return;
    flapFields = fields;
    for (let i = 0; i < 3; i++) rowStart[i] = only >= 0 ? (i === only ? 0 : -1) : i * ROW_LAG;
    flapT = 0;
  }

  const LABEL: Record<Field, string> = { gate: 'GATE', dest: 'DESTINATION', time: 'DEPARTS', status: 'STATUS' };
  const textOf = (f: Field, i: number): string => {
    const a = links[i];
    if (f === 'gate') return String(i + 1).padStart(2, '0');
    if (f === 'time') return TIMES[i % TIMES.length];
    if (f === 'dest') return flatten(a?.textContent ?? '').trim().slice(0, LEN.dest);
    return (flatten(a?.dataset.status ?? '') || 'ON TIME').slice(0, LEN.status);
  };
  const colorOf = (f: Field, s: string) =>
    f === 'dest' ? '#e9eef6' : f !== 'status' ? AMBER : s.startsWith('BOARDED') ? '#54f09a' : s === 'PDF' ? '#6fd3ff' : AMBER;
  /** A flap settles from the left, so a row reads as it lands rather than all at once. */
  const settled = (i: number, k: number) => flapT < 0 || rowStart[i] < 0 || flapT - rowStart[i] > SETTLE + PER_CHAR * k;
  const glyph = (f: Field, i: number, k: number, ch: string) => {
    if (settled(i, k) || !flapFields.includes(f)) return ch;
    // A hashed spin grid rather than Math.random, so the cells tick together and a repaint of the same frame
    // matches. It has to be mixed, not linear: stepping the index by a constant put the same marching run of
    // letters in every column at once, which reads as a pattern instead of as flaps.
    let h = (i * 374761393 + k * 668265263 + FIELDS.indexOf(f) * 2654435761 + Math.floor(flapT / SPIN) * 1013904223) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return GLYPHS[((h ^ (h >>> 16)) >>> 0) % GLYPHS.length];
  };

  function paint() {
    if (!g) return;
    g.fillStyle = '#05070b'; g.fillRect(0, 0, CW, CH);
    g.textBaseline = 'middle';
    // Column headers, on the strip under the frame's neon nameplate.
    g.fillStyle = '#0f1218'; g.fillRect(0, 0, CW, 92);
    g.fillStyle = AMBER; g.fillRect(0, 92, CW, 4);
    g.textAlign = 'left'; g.font = '600 26px ui-monospace, "SF Mono", Menlo, monospace'; g.fillStyle = '#8d97a8';
    for (const f of FIELDS) g.fillText(LABEL[f], COLS[f] + 2, 50);

    const n = Math.min(3, links.length);
    for (let i = 0; i < n; i++) {
      const top = ROW_TOP + i * ROW_PITCH, bandH = CELL_H + 12, cy = top + bandH / 2;
      g.fillStyle = '#0a0d13';
      g.fillRect(16, top, CW - 32, bandH);
      for (const f of FIELDS) {
        const text = textOf(f, i).padEnd(LEN[f], ' ');
        const color = colorOf(f, text.trim());
        for (let k = 0; k < LEN[f]; k++) {
          const x = COLS[f] + k * PITCH;
          g.fillStyle = '#171c25'; g.fillRect(x, cy - CELL_H / 2, CELL_W, CELL_H);
          g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(x, cy - 1, CELL_W, 2); // the flap's hinge line
          const ch = glyph(f, i, k, text[k]);
          if (ch === ' ') continue;
          g.textAlign = 'center'; g.font = 'bold 46px ui-monospace, "SF Mono", Menlo, monospace'; g.fillStyle = color;
          g.fillText(ch, x + CELL_W / 2, cy + 2);
        }
      }
    }
  }

  return {
    group, mount, width: 10, px: 640, style: 'flap-board', node: 'PIER 9 DEPARTURES', range: [0.8, 1.01],
    lights: [[140, 5.0, 28, 0xffb000, 45, 10]],
    fit: place,
    art(el) {
      links = [...el.querySelectorAll<HTMLAnchorElement>('.actions a')];
      const canvas = document.createElement('canvas');
      canvas.width = CW; canvas.height = CH;
      g = canvas.getContext('2d');
      paint(); dirty = false;
      return {
        canvas,
        update(_t, dt) {
          if (flapT >= 0) {
            flapT += dt;
            if (flapT > FLAP_END) { flapT = -1; for (let i = 0; i < 3; i++) rowStart[i] = -1; }
            paint();
            return true;
          }
          if (!dirty) return false;
          dirty = false; paint();
          return true;
        },
      };
    },
    cue: {
      p: 0.975,
      run() { if (!ctx.reducedMotion) { flap(FIELDS); ctx.onFlap?.(); } },
    },
    interact: {
      onEnter(el) {
        docked = true;
        rows = [...el.querySelectorAll<HTMLAnchorElement>('.actions a')];
        sel = 0; setSel(rows, sel);
        hint(el, '<kbd>↑</kbd><kbd>↓</kbd> select · <kbd>Enter</kbd> board · <kbd>Esc</kbd> back');
      },
      onExit(el) {
        docked = false;
        timers.splice(0).forEach(clearTimeout);
        for (const a of rows) {
          a.classList.remove('is-flip');
          if (a.dataset.statusHome !== undefined) { a.dataset.status = a.dataset.statusHome; delete a.dataset.statusHome; }
        }
        setSel(rows, -1); rows = [];
        clearHint(el);
      },
      onKey: (e) => keyToAction(e, actions),
      actions,
    },
  };
}
