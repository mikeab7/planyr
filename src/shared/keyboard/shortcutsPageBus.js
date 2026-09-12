/* shortcutsPageBus — the open/close signal for the Keyboard Shortcuts page.
 *
 * The page is mounted once, at the app Shell (same shape as HelpReportControl), but it needs to
 * be OPENABLE from anywhere: the Shell's own "?" listener, the Help menu's new "Keyboard
 * shortcuts" row, and (later) any workspace that wants its own entry point. Threading an
 * open/close callback down through every workspace's props would mean every one of them takes a
 * new prop for a feature most of them never touch. Instead this is a tiny module-scope
 * subscribe/notify pair — the same shape `chunkReload.js`'s `subscribeChunkRecoveryStuck`
 * already uses for an app-shell signal with exactly one subscriber (the Shell) and many
 * possible callers.
 */

let openState = false;
const listeners = new Set();

export function openShortcutsPage() { openState = true; for (const cb of listeners) cb(true); }
export function closeShortcutsPage() { openState = false; for (const cb of listeners) cb(false); }
export function isShortcutsPageOpen() { return openState; }

/** Subscribe to open/close changes. Returns an unsubscribe function. */
export function subscribeShortcutsPage(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
