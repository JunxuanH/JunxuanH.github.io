/**
 * Terminal boards. Every carrier's content surface is a canvas painting of its résumé section in ONE look —
 * amber phosphor on near-black, green kicker and prompts, scanlines, a block cursor — textured onto a plane on the
 * carrier's mount (content.ts). Real geometry, so the boards depth-test against the character and the city.
 * The doc is scraped from the section's DOM element (index.astro's `[data-slab]`, the same element the dock
 * overlay shows), so a board mirrors the session: the current page, the selected row, the open project.
 */

const MONO = '"IBM Plex Mono", ui-monospace, monospace';

export interface TermLine {
  kind: 'kicker' | 'title' | 'meta' | 'h' | 'row' | 'sub' | 'text' | 'chips' | 'kv' | 'prompt';
  text?: string;
  /** kv: the right-hand status. */
  right?: string;
  /** chips: the tokens. */
  items?: string[];
  /** Highlighted (inverse video): the overlay's `.is-sel` row. */
  sel?: boolean;
  /** chips: index of the highlighted token (−1 = none). */
  selItem?: number;
  /** Wrap limit for row / text (the rest is elided). */
  maxLines?: number;
}
export interface TermDoc {
  lines: TermLine[];
  /** Framebuffer: a screenshot drawn in a bracketed frame beside the rows (projects). */
  fb?: { img: HTMLImageElement };
}
export interface PaintOptions {
  /** Canvas pixels per layout px (crispness). */
  scale?: number;
  /** Exact height / width; rows that do not fit are dropped. */
  aspect?: number;
  /** Natural height, but never shorter than this × width. */
  minAspect?: number;
  /** Repaint at a fixed layout height (px) so the board's geometry never changes. */
  height?: number;
  /** Reuse a canvas (repaints). */
  canvas?: HTMLCanvasElement;
}

const C = {
  bg: '#070603', border: '#3a2a08', rule: 'rgba(255,176,0,0.3)',
  green: '#7dff9a', title: '#ffd27a', amber: '#ffb000', dim: 'rgba(255,176,0,0.72)', light: '#ffd9a0',
  tile: '#111319', ink: '#101008',
};

/** Make sure the mono face is available to the canvas (the page's DOM already requests it). */
export function slabFontsReady(): Promise<unknown> {
  if (typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve();
  return Promise.all([document.fonts.load(`400 16px ${MONO}`), document.fonts.load(`500 16px ${MONO}`)])
    .then(() => document.fonts.ready).catch(() => undefined);
}

const txt = (n: Node | null | undefined) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
const isSel = (n: Element) => n.classList.contains('is-sel');

/** The section's DOM (a `.slab` or the projects `.stack`) as terminal lines. */
export function docFromSlab(el: HTMLElement): TermDoc {
  const L: TermLine[] = [];
  let fb: TermDoc['fb'];
  if (el.classList.contains('stack')) {
    // Projects: a directory listing — name · tagline, the stack beneath; the selected (or first) project's shot is the framebuffer.
    const cards = [...el.querySelectorAll<HTMLElement>('.card')];
    const cur = Math.max(0, cards.findIndex(isSel));
    L.push({ kind: 'kicker', text: 'PROJECTS' }, { kind: 'title', text: '~/PROJECTS' }, { kind: 'meta', text: `${cards.length} ENTRIES · SELECT TO OPEN` });
    cards.forEach((c, i) => {
      const h3 = c.querySelector('h3');
      const name = txt(h3?.firstChild), status = txt(h3?.querySelector('small'));
      L.push({ kind: 'row', text: `${name}${status ? ` [${status}]` : ''} · ${txt(c.querySelector('.tagline'))}`, sel: i === cur, maxLines: 2 });
      L.push({ kind: 'sub', text: [...c.querySelectorAll('.chips li')].map(txt).join(' / ') });
    });
    const img = cards[cur]?.querySelector('img');
    if (img) fb = { img };
  } else {
    const kicker = txt(el.querySelector('.kicker')), h2 = txt(el.querySelector('h2'));
    if (kicker) L.push({ kind: 'kicker', text: kicker });
    if (h2) L.push({ kind: 'title', text: h2 });
    const meta = [...el.querySelectorAll('.meta span')].map(txt).filter(Boolean);
    if (meta.length) L.push({ kind: 'meta', text: meta.join('   ·   ') });
    const team = txt(el.querySelector('.team'));
    if (team) L.push({ kind: 'meta', text: team });
    const lede = txt(el.querySelector('.lede'));
    if (lede) L.push({ kind: 'text', text: lede, maxLines: 4 });
    const group = (root: Element, head?: string) => {
      if (head) L.push({ kind: 'h', text: head });
      for (const li of root.querySelectorAll('.bullets li')) L.push({ kind: 'row', text: txt(li), sel: isSel(li), maxLines: 3 });
      const chips = [...root.querySelectorAll('.chips li')];
      if (chips.length) L.push({ kind: 'chips', items: chips.map(txt), selItem: chips.findIndex(isSel) });
    };
    const cols = [...el.querySelectorAll(':scope > .cols > div')];
    const page = el.querySelector('.pages .page.is-cur') ?? el.querySelector('.pages .page');
    if (cols.length) for (const c of cols) group(c, txt(c.querySelector('h3')));
    else if (page) group(page, txt(page.querySelector('h3')));
    else for (const li of el.querySelectorAll(':scope > .bullets li')) L.push({ kind: 'row', text: txt(li), sel: isSel(li), maxLines: 3 });
    for (const a of el.querySelectorAll<HTMLElement>('.actions a')) L.push({ kind: 'kv', text: txt(a), right: a.dataset.status ?? '', sel: isSel(a) });
  }
  L.push({ kind: 'prompt' });
  return { lines: L, fb };
}

/** Paint `doc` at `width` layout px; the height follows the content (or `aspect` / `height`). */
export function paintTerminal(doc: TermDoc, width: number, opts: PaintOptions = {}): HTMLCanvasElement {
  const W = width, scale = opts.scale ?? 1;
  const c = opts.canvas ?? document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const fs = (k: number) => Math.round(W * k);
  const pad = fs(0.05), maxW = W - pad * 2;
  const F = {
    kicker: `500 ${fs(0.022)}px ${MONO}`, title: `500 ${fs(0.046)}px ${MONO}`, meta: `400 ${fs(0.021)}px ${MONO}`, h: `500 ${fs(0.02)}px ${MONO}`,
    row: `400 ${fs(0.026)}px ${MONO}`, sub: `400 ${fs(0.02)}px ${MONO}`, text: `400 ${fs(0.024)}px ${MONO}`, chip: `400 ${fs(0.022)}px ${MONO}`,
    kv: `500 ${fs(0.03)}px ${MONO}`, status: `400 ${fs(0.022)}px ${MONO}`, prompt: `500 ${fs(0.026)}px ${MONO}`,
  };
  const up = (s: string) => s.toUpperCase();
  const wrap = (s: string, font: string, w: number, limit = Infinity) => {
    ctx.font = font;
    const words = s.split(' '), out: string[] = [];
    let line = '';
    for (const word of words) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width > w && line) { out.push(line); line = word; } else line = t;
    }
    if (line) out.push(line);
    if (out.length > limit) {
      const kept = out.slice(0, limit);
      let last = kept[limit - 1];
      while (last.length && ctx.measureText(`${last}…`).width > w) last = last.slice(0, -1).trimEnd();
      kept[limit - 1] = `${last}…`;
      return kept;
    }
    return out;
  };

  // ---- layout pass: ops record what to draw; y advances; `room()` stops the rows when an exact aspect runs out.
  type Op = () => void;
  const ops: Op[] = [];
  const fbW = doc.fb ? fs(0.34) : 0, fbGap = doc.fb ? fs(0.035) : 0;
  const fbH = doc.fb ? Math.round(fbW * 0.625) + fs(0.044) : 0;
  let fbTop = 0;
  const promptH = fs(0.05);
  const maxH = opts.height ?? (opts.aspect ? Math.round(W * opts.aspect) : Infinity);
  let y = pad, stopped = false;
  const room = (h: number) => y + h <= maxH - pad - promptH;
  const text = (s: string, font: string, color: string, x: number, yy: number, lh: number, letter = 0, align: CanvasTextAlign = 'left') => {
    ops.push(() => {
      ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
      (ctx as any).letterSpacing = `${letter}px`;
      ctx.fillText(s, x, yy + lh * 0.74);
      (ctx as any).letterSpacing = '0px'; ctx.textAlign = 'left';
    });
  };
  const rect = (x: number, yy: number, w: number, h: number, color: string) => ops.push(() => { ctx.fillStyle = color; ctx.fillRect(x, yy, w, h); });
  /** Rows beside the framebuffer wrap to the narrower column while they overlap it. */
  const rowW = (h: number) => (doc.fb && fbTop && y < fbTop + fbH ? maxW - fbW - fbGap : maxW);

  for (const l of doc.lines) {
    if (stopped && l.kind !== 'prompt') continue;
    switch (l.kind) {
      case 'kicker': {
        const lh = fs(0.036);
        if (!room(lh)) { stopped = true; break; }
        text(`> ${up(l.text ?? '')}`, F.kicker, C.green, pad, y, lh, fs(0.004));
        y += lh;
        break;
      }
      case 'title': {
        const lh = fs(0.056), lines = wrap(up(l.text ?? ''), F.title, maxW, 2);
        if (!room(lh * lines.length)) { stopped = true; break; }
        for (const s of lines) { text(s, F.title, C.title, pad, y, lh); y += lh; }
        y += fs(0.004);
        break;
      }
      case 'meta': {
        const lh = fs(0.032), lines = wrap(up(l.text ?? ''), F.meta, maxW, 2);
        if (!room(lh * lines.length)) { stopped = true; break; }
        for (const s of lines) { text(s, F.meta, C.dim, pad, y, lh, fs(0.001)); y += lh; }
        break;
      }
      case 'h': {
        const lh = fs(0.036);
        if (!room(lh + fs(0.012))) { stopped = true; break; }
        y += fs(0.012);
        text(`## ${up(l.text ?? '')}`, F.h, C.green, pad, y, lh, fs(0.003));
        y += lh;
        break;
      }
      case 'row': {
        const lh = fs(0.036), indent = fs(0.035);
        const w = rowW(lh) - indent;
        const lines = wrap(up(l.text ?? ''), F.row, w, l.maxLines ?? 2);
        const h = lh * lines.length;
        if (!room(h + fs(0.006))) { stopped = true; break; }
        if (l.sel) rect(pad - fs(0.01), y + fs(0.002), w + indent + fs(0.02), h + fs(0.004), C.amber);
        text(l.sel ? '▶' : '>', F.row, l.sel ? C.ink : C.green, pad, y, lh);
        for (const s of lines) { text(s, F.row, l.sel ? C.ink : C.amber, pad + indent, y, lh); y += lh; }
        y += fs(0.006);
        break;
      }
      case 'sub': {
        const lh = fs(0.03), indent = fs(0.035);
        if (!room(lh + fs(0.008))) { stopped = true; break; }
        const [s] = wrap(up(l.text ?? ''), F.sub, rowW(lh) - indent, 1);
        if (s) text(s, F.sub, C.dim, pad + indent, y, lh);
        y += lh + fs(0.008);
        break;
      }
      case 'text': {
        const lh = fs(0.034), lines = wrap(l.text ?? '', F.text, maxW, l.maxLines ?? 4);
        if (!room(lh * lines.length + fs(0.012))) { stopped = true; break; }
        for (const s of lines) { text(s, F.text, C.light, pad, y, lh); y += lh; }
        y += fs(0.012);
        break;
      }
      case 'chips': {
        const h = fs(0.036), gap = fs(0.018), selItem = l.selItem ?? -1;
        ctx.font = F.chip;
        let x = pad, rows = 1;
        const items = (l.items ?? []).map((s) => `[ ${up(s)} ]`);
        const widths = items.map((s) => Math.round(ctx.measureText(s).width));
        for (const w of widths) { if (x + w > pad + maxW && x > pad) { x = pad; rows++; } x += w + gap; }
        if (!room(h * rows + fs(0.01))) { stopped = true; break; }
        x = pad;
        items.forEach((s, i) => {
          const w = widths[i];
          if (x + w > pad + maxW && x > pad) { x = pad; y += h; }
          const xx = x, yy = y, sel = i === selItem;
          if (sel) rect(xx - fs(0.004), yy + fs(0.002), w + fs(0.008), h - fs(0.002), C.amber);
          text(s, F.chip, sel ? C.ink : C.amber, xx, yy, h);
          x += w + gap;
        });
        y += h + fs(0.01);
        break;
      }
      case 'kv': {
        const h = fs(0.07), gap = fs(0.011);
        if (!room(h + gap)) { stopped = true; break; }
        const yy = y;
        rect(pad, yy, maxW, h, l.sel ? C.amber : C.tile);
        text(`${l.sel ? '▶' : '>'} ${up(l.text ?? '')}`, F.kv, l.sel ? C.ink : C.amber, pad + fs(0.022), yy + h * 0.16, h * 0.68, fs(0.004));
        text(up(l.right ?? ''), F.status, l.sel ? C.ink : C.green, pad + maxW - fs(0.022), yy + h * 0.2, h * 0.6, fs(0.002), 'right');
        y += h + gap;
        break;
      }
      case 'prompt': {
        y += fs(0.008);
        text(stopped ? '> … ▮' : '> ▮', F.prompt, C.green, pad, y, promptH);
        y += promptH;
        break;
      }
    }
    // The framebuffer hangs at the top-right of the rows area (under the header block).
    if (doc.fb && !fbTop && (l.kind === 'meta' || l.kind === 'title')) fbTop = y + fs(0.024);
  }
  let height = y + pad;
  if (opts.height) height = opts.height;
  else if (opts.aspect) height = Math.round(W * opts.aspect);
  else height = Math.max(Math.round(W * (opts.minAspect ?? 0.5)), height, fbTop + fbH + pad);

  // ---- paint
  c.width = Math.round(W * scale); c.height = Math.round(height * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, height);
  ctx.shadowColor = 'rgba(255,176,0,0.55)'; ctx.shadowBlur = fs(0.008);
  for (const op of ops) op();
  ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
  if (doc.fb && fbTop) drawFramebuffer(ctx, doc.fb.img, pad + maxW - fbW, fbTop, fbW, fbH, fs);
  // Scanlines + vignette in canvas pixels, then the housing border and an amber corner bracket.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  const pitch = Math.max(2, Math.round(3 * scale));
  for (let yy = 0; yy < c.height; yy += pitch) ctx.fillRect(0, yy, c.width, Math.max(1, Math.round(scale)));
  const vg = ctx.createRadialGradient(c.width / 2, c.height / 2, 0, c.width / 2, c.height / 2, Math.max(c.width, c.height) * 0.62);
  vg.addColorStop(0.55, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, c.width, c.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.strokeStyle = C.border; ctx.lineWidth = 2; ctx.strokeRect(1, 1, W - 2, height - 2);
  ctx.strokeStyle = C.amber; ctx.lineWidth = 2;
  const b = fs(0.03);
  ctx.beginPath(); ctx.moveTo(1, b); ctx.lineTo(1, 1); ctx.lineTo(b, 1); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W - 1, height - b); ctx.lineTo(W - 1, height - 1); ctx.lineTo(W - b, height - 1); ctx.stroke();
  return c;
}

/** The screenshot as an amber phosphor image in a bracketed frame (desaturated, tinted, scanlined). */
function drawFramebuffer(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, fs: (k: number) => number) {
  const capH = fs(0.044), ih = h - capH;
  ctx.save();
  ctx.fillStyle = '#0b0906'; ctx.fillRect(x, y, w, ih);
  if (img.complete && img.naturalWidth > 0) {
    // Cover-fit from the top (the screenshots are 1280 × 800 hero crops).
    const s = Math.max(w / img.naturalWidth, ih / img.naturalHeight);
    const sw = Math.min(img.naturalWidth, w / s), sh = Math.min(img.naturalHeight, ih / s);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, ih); ctx.clip();
    ctx.drawImage(img, (img.naturalWidth - sw) / 2, 0, sw, sh, x, y, w, ih);
    ctx.globalCompositeOperation = 'saturation'; ctx.fillStyle = '#808080'; ctx.fillRect(x, y, w, ih);
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#ffb000'; ctx.fillRect(x, y, w, ih);
    ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = 'rgba(255,176,0,0.08)'; ctx.fillRect(x, y, w, ih);
    ctx.restore();
  } else {
    ctx.font = `500 ${fs(0.02)}px ${MONO}`; ctx.fillStyle = C.dim; ctx.textAlign = 'center';
    ctx.fillText('NO SIGNAL', x + w / 2, y + ih / 2); ctx.textAlign = 'left';
  }
  ctx.strokeStyle = C.border; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, ih - 2);
  ctx.strokeStyle = C.amber; ctx.lineWidth = 2;
  const b = fs(0.02);
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    const x0 = sx > 0 ? x + 1 : x + w - 1, y0 = sy > 0 ? y + 1 : y + ih - 1;
    ctx.beginPath(); ctx.moveTo(x0, y0 + sy * b); ctx.lineTo(x0, y0); ctx.lineTo(x0 + sx * b, y0); ctx.stroke();
  }
  ctx.font = `400 ${fs(0.018)}px ${MONO}`; ctx.fillStyle = C.dim;
  ctx.fillText('FB0 · 1280×800', x, y + ih + capH * 0.8);
  ctx.restore();
}
