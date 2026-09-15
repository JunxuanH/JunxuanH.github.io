/**
 * Terminal board types and the canvas font gate. `TermDoc` is the line model a carrier's board repaint can transform
 * (carriers/index.ts `Board`, the flapboard's letter shuffle); `slabFontsReady` makes sure the mono face has loaded
 * before content.ts builds the boards.
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
/** Make sure the mono face is available to the canvas (the page's DOM already requests it). */
export function slabFontsReady(): Promise<unknown> {
  if (typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve();
  return Promise.all([document.fonts.load(`400 16px ${MONO}`), document.fonts.load(`500 16px ${MONO}`)])
    .then(() => document.fonts.ready).catch(() => undefined);
}
