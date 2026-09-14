/**
 * Phone stand-in for the CSS3D slabs: a canvas painting of a slab's content (kicker, title, meta, first
 * bullets / chips / actions) in its carrier's look, so the kiosk screen, the bus-stop light box, the LED wall,
 * the banner, the hologram and the departures board show the résumé in the scene on phones too — where the
 * readable copy lives in the bottom sheet. Static: page flips, channels and selections happen in the sheet.
 */

const MONO = '"IBM Plex Mono", ui-monospace, monospace';
const DISPLAY = '"Rajdhani", "Chakra Petch", "Impact", sans-serif';
const SANS = '"Source Sans 3 Variable", system-ui, sans-serif';

interface Look {
  bg: string | [string, string];
  kicker: string; h2: string; meta: string; h3: string; body: string; chip: string;
  h2Font: string; bodyFont: string;
  upper?: boolean; bullet: string; kickerPrefix?: string;
  border?: string; brackets?: boolean; scan?: boolean; rule?: boolean; leds?: boolean;
  header?: string; rows?: boolean;
}
const HOLO: Look = {
  bg: 'rgba(8,10,20,0.94)', kicker: '#f2ff3d', h2: '#eafcff', meta: '#00e5ff', h3: '#ff2bd6', body: 'rgba(234,252,255,0.9)', chip: '#eafcff',
  h2Font: DISPLAY, bodyFont: SANS, bullet: '•', border: 'rgba(0,229,255,0.55)', brackets: true,
};
const LOOKS: Record<string, Look> = {
  terminal: {
    bg: '#070603', kicker: '#7dff9a', h2: '#ffd27a', meta: 'rgba(255,176,0,0.75)', h3: '#7dff9a', body: '#ffb000', chip: '#ffb000',
    h2Font: MONO, bodyFont: MONO, upper: true, bullet: '>', kickerPrefix: '> ', border: '#3a2a08', scan: true,
  },
  poster: {
    bg: ['#f4f1ea', '#e2ddd3'], kicker: '#d0202a', h2: '#0b0d1c', meta: '#3a3f55', h3: '#d0202a', body: '#14161c', chip: '#14161c',
    h2Font: DISPLAY, bodyFont: SANS, bullet: '•', rule: true,
  },
  'led-wall': { ...HOLO, bg: '#05060c', leds: true, border: 'rgba(0,229,255,0.35)' },
  hologram: { ...HOLO, bg: 'rgba(6,14,24,0.92)', body: 'rgba(200,245,255,0.92)', h2: '#dffbff', scan: true },
  'flap-board': {
    bg: '#08090d', kicker: '#ffd27a', h2: '#fff3d0', meta: 'rgba(255,176,0,0.8)', h3: '#7dff9a', body: '#ffd9a0', chip: '#ffb000',
    h2Font: MONO, bodyFont: MONO, bullet: '', border: '#3a2a08', header: 'DEPARTURES · PIER 9', rows: true,
  },
};

/** Make sure the three faces are available to the canvas (they are already requested by the page's DOM). */
export function slabFontsReady(): Promise<unknown> {
  if (typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve();
  return Promise.all([
    document.fonts.load(`700 38px ${DISPLAY}`), document.fonts.load(`500 16px ${MONO}`), document.fonts.load(`400 16px ${SANS}`),
  ]).then(() => document.fonts.ready).catch(() => undefined);
}

const txt = (n: Element | null | undefined) => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Paint `el` (an index.astro slab) at `width` px wide in the carrier's `style`; the height follows the content. */
export function paintSlab(el: HTMLElement, style: string, width: number): HTMLCanvasElement {
  const L = LOOKS[style] ?? HOLO;
  const up = (s: string) => (L.upper ? s.toUpperCase() : s);
  const kicker = txt(el.querySelector('.kicker')), h2 = txt(el.querySelector('h2'));
  const meta = [...el.querySelectorAll('.meta span')].map(txt).filter(Boolean);
  const team = txt(el.querySelector('.team')), lede = txt(el.querySelector('.lede'));
  const groups: { h3?: string; lines: string[]; chips: string[] }[] = [];
  const cols = [...el.querySelectorAll(':scope > .cols > div')];
  const page = el.querySelector('.pages .page');
  if (cols.length) for (const c of cols) groups.push({ h3: txt(c.querySelector('h3')), lines: [...c.querySelectorAll('.bullets li')].map(txt), chips: [...c.querySelectorAll('.chips li')].map(txt) });
  else if (page) groups.push({ h3: txt(page.querySelector('h3')), lines: [...page.querySelectorAll('.bullets li')].map(txt), chips: [] });
  else groups.push({ lines: [...el.querySelectorAll(':scope > .bullets li')].map(txt), chips: [] });
  const actions = [...el.querySelectorAll<HTMLElement>('.actions a')].map((a) => ({ label: txt(a), status: a.dataset.status ?? '' }));

  // ---- measure pass, then paint: the canvas is as tall as the content (never shorter than 0.5 × width).
  const pad = Math.round(width * 0.042), maxW = width - pad * 2;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const wrap = (s: string, font: string, w: number) => {
    ctx.font = font;
    const words = s.split(' '), out: string[] = [];
    let line = '';
    for (const word of words) {
      const t = line ? `${line} ${word}` : word;
      if (ctx.measureText(t).width > w && line) { out.push(line); line = word; } else line = t;
    }
    if (line) out.push(line);
    return out;
  };
  const fs = (k: number) => Math.round(width * k);
  const F = {
    kicker: `500 ${fs(0.018)}px ${MONO}`, h2: `700 ${fs(0.05)}px ${L.h2Font}`, meta: `500 ${fs(0.019)}px ${MONO}`, team: `400 ${fs(0.023)}px ${L.bodyFont}`,
    h3: `500 ${fs(0.016)}px ${MONO}`, body: `400 ${fs(L.bodyFont === MONO ? 0.022 : 0.027)}px ${L.bodyFont}`, chip: `500 ${fs(0.017)}px ${MONO}`,
    lede: `400 ${fs(0.026)}px ${L.bodyFont}`, row: `500 ${fs(0.036)}px ${MONO}`, status: `500 ${fs(0.028)}px ${MONO}`,
  };
  const maxLines = 5;
  type Op = () => void;
  const ops: Op[] = [];
  let y = pad;
  const line = (s: string, font: string, color: string, lh: number, x = pad, letter = 0) => {
    const yy = y;
    ops.push(() => { ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic'; (ctx as any).letterSpacing = `${letter}px`; ctx.fillText(s, x, yy + lh * 0.78); (ctx as any).letterSpacing = '0px'; });
    y += lh;
  };
  const para = (s: string, font: string, color: string, lh: number, indent = 0, limit = maxLines) => {
    const lines = wrap(s, font, maxW - indent).slice(0, limit);
    for (const l of lines) line(l, font, color, lh, pad + indent);
  };

  if (L.header) { line(L.header, `500 ${fs(0.022)}px ${MONO}`, L.kicker, fs(0.04), pad, fs(0.006)); }
  if (kicker && !L.rows) line(up((L.kickerPrefix ?? '') + kicker), F.kicker, L.kicker, fs(0.032), pad, fs(0.004));
  for (const l of wrap(up(h2), F.h2, maxW).slice(0, 3)) line(l, F.h2, L.h2, fs(0.052));
  y += fs(0.006);
  if (meta.length) line(up(meta.join('   ·   ')), F.meta, L.meta, fs(0.03), pad, fs(0.001));
  if (team) para(team, F.team, L.meta, fs(0.032));
  if (L.rule) { const yy = y + fs(0.012); ops.push(() => { ctx.fillStyle = L.h2; ctx.fillRect(pad, yy, maxW, 3); }); y += fs(0.03); }
  else y += fs(0.014);
  if (lede) { para(lede, F.lede, L.body, fs(0.036), 0, 4); y += fs(0.012); }
  for (const g of groups) {
    if (g.h3) { y += fs(0.008); line(up(g.h3), F.h3, L.h3, fs(0.03), pad, fs(0.003)); }
    let used = 0;
    for (const b of g.lines) {
      if (used >= maxLines) break;
      const ls = wrap(b, F.body, maxW - fs(0.03)).slice(0, Math.max(1, maxLines - used));
      const bulletY = y;
      if (L.bullet) ops.push(() => { ctx.font = F.body; ctx.fillStyle = L.kicker; ctx.fillText(L.bullet, pad, bulletY + fs(L.bodyFont === MONO ? 0.03 : 0.036) * 0.78); });
      for (const l of ls) line(l, F.body, L.body, fs(L.bodyFont === MONO ? 0.03 : 0.036), pad + fs(0.03));
      used += ls.length;
      y += fs(0.006);
    }
    if (g.chips.length) {
      ctx.font = F.chip;
      let x = pad;
      const h = fs(0.034), gap = fs(0.01);
      y += fs(0.004);
      for (const ch of g.chips) {
        const w = Math.round(ctx.measureText(ch).width) + fs(0.026);
        if (x + w > pad + maxW) { x = pad; y += h + gap; }
        const xx = x, yy = y;
        ops.push(() => {
          ctx.font = F.chip; ctx.strokeStyle = L.chip; ctx.lineWidth = 1; ctx.globalAlpha = 0.6;
          if (L.upper) ctx.strokeRect(xx + 0.5, yy + 0.5, w - 1, h - 1); else { ctx.beginPath(); (ctx as any).roundRect(xx + 0.5, yy + 0.5, w - 1, h - 1, h / 2); ctx.stroke(); }
          ctx.globalAlpha = 1; ctx.fillStyle = L.chip; ctx.fillText(ch, xx + fs(0.013), yy + h * 0.7);
        });
        x += w + gap;
      }
      y += h + fs(0.012);
    }
  }
  if (actions.length) {
    y += fs(0.01);
    if (L.rows) {
      const h = fs(0.07), gap = fs(0.011);
      for (const a of actions) {
        const yy = y;
        ops.push(() => {
          ctx.fillStyle = '#111319'; ctx.fillRect(pad, yy, maxW, h);
          ctx.font = F.row; ctx.fillStyle = L.chip; (ctx as any).letterSpacing = `${fs(0.004)}px`; ctx.fillText(a.label.toUpperCase(), pad + fs(0.022), yy + h * 0.68);
          ctx.font = F.status; ctx.fillStyle = L.h3; ctx.textAlign = 'right'; ctx.fillText(a.status.toUpperCase(), pad + maxW - fs(0.022), yy + h * 0.66); ctx.textAlign = 'left'; (ctx as any).letterSpacing = '0px';
        });
        y += h + gap;
      }
    } else {
      ctx.font = `700 ${fs(0.026)}px ${DISPLAY}`;
      let x = pad;
      const h = fs(0.058), gap = fs(0.016);
      for (const [i, a] of actions.entries()) {
        const w = Math.round(ctx.measureText(a.label.toUpperCase()).width) + fs(0.07);
        if (x + w > pad + maxW) { x = pad; y += h + gap; }
        const xx = x, yy = y, primary = i === 0;
        ops.push(() => {
          ctx.beginPath(); (ctx as any).roundRect(xx, yy, w, h, h / 2);
          if (primary) { ctx.fillStyle = '#f2ff3d'; ctx.fill(); } else { ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 2; ctx.stroke(); }
          ctx.font = `700 ${fs(0.026)}px ${DISPLAY}`; ctx.fillStyle = primary ? '#101008' : '#00e5ff'; (ctx as any).letterSpacing = `${fs(0.003)}px`;
          ctx.fillText(a.label.toUpperCase(), xx + fs(0.035), yy + h * 0.68); (ctx as any).letterSpacing = '0px';
        });
        x += w + gap;
      }
      y += h;
    }
  }
  const height = Math.max(Math.round(width * 0.5), y + pad);

  // ---- paint
  c.width = width; c.height = height;
  if (Array.isArray(L.bg)) { const g = ctx.createLinearGradient(0, 0, 0, height); g.addColorStop(0, L.bg[0]); g.addColorStop(1, L.bg[1]); ctx.fillStyle = g; }
  else ctx.fillStyle = L.bg;
  ctx.fillRect(0, 0, width, height);
  if (L.rule && Array.isArray(L.bg)) { const g = ctx.createRadialGradient(width / 2, height * 0.3, 0, width / 2, height * 0.3, width * 0.5); g.addColorStop(0, 'rgba(255,255,255,0.28)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, width, height); }
  for (const op of ops) op();
  if (L.scan) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; for (let yy = 0; yy < height; yy += 3) ctx.fillRect(0, yy, width, 1); }
  if (L.leds) {
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    const pitch = 4;
    for (let yy = 0; yy < height; yy += pitch) ctx.fillRect(0, yy, width, 1);
    for (let xx = 0; xx < width; xx += pitch) ctx.fillRect(xx, 0, 1, height);
  }
  if (L.border) { ctx.strokeStyle = L.border; ctx.lineWidth = 2; ctx.strokeRect(1, 1, width - 2, height - 2); }
  if (L.brackets) {
    ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 3;
    const b = fs(0.02);
    ctx.beginPath(); ctx.moveTo(1.5, b); ctx.lineTo(1.5, 1.5); ctx.lineTo(b, 1.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(width - 1.5, height - b); ctx.lineTo(width - 1.5, height - 1.5); ctx.lineTo(width - b, height - 1.5); ctx.stroke();
  }
  return c;
}
