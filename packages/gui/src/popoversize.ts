/**
 * Tray-popover window sizing (PRD §12 R22, issue #126). The popover BrowserWindow sizes
 * itself to the rendered card on every show: a fixed window number rots as the card grows
 * (280×200 shipped clipping a 332×273 card), so the card measurement is the source of
 * truth and this module only clamps it. Electron-free so the JUDGE/record harnesses import
 * the same clamp the shipped window uses instead of hand-copying its numbers.
 */

export interface WindowSize {
  width: number;
  height: number;
}

/** The ceiling on the auto-sized popover — past this a "compact" tray surface isn't. */
export const POPOVER_MAX: WindowSize = { width: 480, height: 640 };

/** Used when the card measurement comes back malformed; roughly today's running card. */
export const POPOVER_FALLBACK: WindowSize = { width: 340, height: 280 };

/**
 * The window size for a measured card. The measurement crosses the renderer boundary as
 * `unknown` (executeJavaScript / page.evaluate), so it is parsed here, once.
 */
export function popoverWindowSize(card: unknown): WindowSize {
  if (typeof card !== 'object' || card === null) return { ...POPOVER_FALLBACK };
  const { width, height } = card as { width?: unknown; height?: unknown };
  if (typeof width !== 'number' || typeof height !== 'number' || !(width > 0) || !(height > 0)) {
    return { ...POPOVER_FALLBACK };
  }
  return {
    width: Math.min(Math.ceil(width), POPOVER_MAX.width),
    height: Math.min(Math.ceil(height), POPOVER_MAX.height),
  };
}
