/**
 * Ambient globals for the CHECKED classic renderer scripts (issue #83 — checkJs is on for
 * packages/gui/renderer/**; see tsconfig.renderer.json / tsconfig.popover.json).
 *
 * `window.SU` needs no entry here — su.ts declares it globally with its real inferred
 * type, so every SU call site in the classic scripts typechecks against the actual API.
 */
/**
 * The checked classic scripts address page elements by id/selector and then use
 * form-element properties (.value/.checked/…) that the selector string alone cannot
 * prove to the checker. These pragmatic augmentations — visible ONLY to the renderer
 * typecheck programs, never to gui/src — keep checkJs focused on what it is here for
 * (cross-module API drift: SU calls, window.stint, signatures) without a cast at every
 * DOM read. Element-shape correctness is owned by the behavioral guards (JUDGE / the
 * QA driver), not the static pass.
 */
interface Element {
  value: any;
  checked: any;
  disabled: any;
  hidden: boolean;
  name: any;
  selectedIndex: any;
  options: any;
  dataset: DOMStringMap;
  reset(): void;
  focus(options?: FocusOptions): void;
  blur(): void;
}

interface EventTarget {
  closest(selectors: string): Element | null;
}

interface Window {
  /**
   * The preload bridge (gui/src/preload.ts, `contextBridge.exposeInMainWorld('stint', …)`).
   * Its surface is built dynamically from the CHANNELS loop plus the update namespace, so
   * it is typed as a dynamic invoke map rather than restated channel-by-channel here —
   * restating it would be exactly the hand-mirroring issue #83 removes.
   */
  stint: Record<string, (payload?: unknown) => Promise<any>> & {
    onChange(cb: () => void): () => void;
    update: {
      getVersion(): Promise<any>;
      check(): Promise<any>;
      download(): Promise<any>;
      reveal(): Promise<any>;
      onUpdateProgress(cb: (p: unknown) => void): () => void;
    };
  };
  /**
   * app.js's shared inline affordances (issue #52), reached as `window.confirmInline` /
   * `window.inlineRenameForm` from the OTHER classic scripts on the main page
   * (reports.js, settings.js) — classic scripts, so a top-level function IS a window
   * property; these declarations just teach the checker that.
   */
  confirmInline(
    btn: Element,
    opts: { kind?: string; question?: string; confirmLabel?: string; onConfirm?: () => void | Promise<void> },
  ): void;
  inlineRenameForm(
    current: string,
    onSave: (name: string) => void | Promise<void>,
    opts?: { onCancel?: () => void; commitLabel?: string },
  ): HTMLFormElement;
  /** The start-only interval picker (timepicker.js) — declared for app.js's call sites. */
  STP: {
    openStartOnly(opts: Record<string, unknown>): void;
    snapToStep(min: number, stepMin: number): number;
    minutesToY(min: number, startMin: number, endMin: number, height: number): number;
    yToMinutes(y: number, startMin: number, endMin: number, height: number): number;
    TRACK_H: number;
  };
}
