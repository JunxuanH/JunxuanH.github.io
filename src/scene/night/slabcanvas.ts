/**
 * The canvas font gate: makes sure the mono face has loaded before content.ts builds the boards.
 *
 * This file used to carry a line model for boards painted from the section's DOM. Boards now show
 * generated art instead, so the model, and the repaint mechanism that transformed it, are gone.
 */

const MONO = '"IBM Plex Mono", ui-monospace, monospace';

/** Make sure the mono face is available to the canvas (the page's DOM already requests it). */
export function slabFontsReady(): Promise<unknown> {
  if (typeof document === 'undefined' || !('fonts' in document)) return Promise.resolve();
  return Promise.all([document.fonts.load(`400 16px ${MONO}`), document.fonts.load(`500 16px ${MONO}`)])
    .then(() => document.fonts.ready).catch(() => undefined);
}
