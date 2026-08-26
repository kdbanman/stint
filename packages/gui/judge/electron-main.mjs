/**
 * JUDGE apparatus — the Electron main-process probe entry (issue #351). Never shipped.
 *
 * The TRAY_HOTKEY_WIRING scene launches the REAL Electron app (playwright-core's
 * `_electron`) through this wrapper instead of `dist/main.js` directly, because the one
 * thing `electronApp.evaluate()` cannot reach on its own is the Tray INSTANCE: Electron has
 * no `Tray.getAllTrays()`, and main.ts holds its tray in module scope. So before the real
 * main module runs, the wrapper patches two `Tray.prototype` methods to expose what the app
 * does with its tray on `globalThis.__stintJudgeTray`:
 *
 *   - `setContextMenu` captures `this` (the live tray the click handlers are wired to) and
 *     every Menu the app ever sets — main.ts calls it at init and again on 'right-click',
 *     so the captured menus ARE the menus a user could get;
 *   - `popUpContextMenu` counts calls, so the scene can assert the click path never
 *     programmatically pops a menu (single left-click → popover ONLY, §12 R01 / G8).
 *
 * The patch intercepts and forwards — nothing is stubbed, the real methods still run, and
 * the app under test is byte-identical to the shipped one (`dist/main.js`, imported below).
 * The probe global is only ever read back via `electronApp.evaluate()` in run-judge.mjs.
 */
import { Tray } from 'electron';

const captured = { tray: null, menus: [], popups: 0 };
globalThis.__stintJudgeTray = captured;

const origSetContextMenu = Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu = function (menu) {
  captured.tray = this;
  captured.menus.push(menu);
  return origSetContextMenu.call(this, menu);
};

const origPopUpContextMenu = Tray.prototype.popUpContextMenu;
Tray.prototype.popUpContextMenu = function (...args) {
  captured.popups += 1;
  return origPopUpContextMenu.apply(this, args);
};

await import('../dist/main.js');
