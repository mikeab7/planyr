/* When the sign-in panel may close, and what survives if it goes away anyway (NEW-1, 2026-11-08).
 *
 * Owner rule: sign-in must be hassle-free, and losing a half-filled form is a dead end. The panel closes ONLY when
 * the person asked — Close, Escape that nothing else took, a press-and-release on the dark backdrop, or a successful
 * sign-in. Everything here is pure (no DOM globals except the storage handed in), so the rules are unit-tested and
 * the panel just asks.
 *
 * THE PATHS THAT CAN UNMOUNT OR CLOSE THE PANEL — each with whether the person asked (guard: test/authPanelClosePaths.test.js):
 *   Close button ........................... asked
 *   Escape, focus inside the panel, not taken
 *     by an open menu / password manager ... asked (`escapeMayClose`)
 *   Press AND release on the backdrop ....... asked (`backdropMayClose`)
 *   Successful sign-in / sign-up that signs
 *     in / password updated ................. asked (the outcome of their submit)
 *   Sign out / Sign out instead / signing out
 *     everywhere (signed-in panel) .......... asked
 *   Shell's "dead-link notice but you are
 *     already signed in" effect ............. not a close of a form anyone was filling (signed in → nothing to fill)
 *   A forced page reload (stale-build chunk
 *     rescue, `chunkReload.reloadFresh`) .... NOT asked → the draft below brings the panel back with the typed email
 * Anything else that unmounts it while signed out is reported as `auth-panel-vanished` (authTelemetry) — a defect.
 *
 * ⛔ PRIVACY: only the EMAIL ADDRESS and the tab (sign in / sign up / reset) are kept, in sessionStorage (this tab only,
 * gone when it closes). A password, a name and an organisation are never stored. */

export const DRAFT_KEY = "planyr:authPanelDraft";
/** A draft older than this describes a panel nobody is looking at any more; it is dropped, not reopened. */
export const DRAFT_MAX_AGE_MS = 5 * 60 * 1000;
const MODES = ["signin", "signup", "reset"];

/* Controls that own Escape while they are open: a combobox / menu / listbox, or a native select. Escape there closes
 * THAT, never the dialog around it. */
const OWNS_ESCAPE_SELECTOR = '[aria-expanded="true"],[role="listbox"],[role="menu"],[role="combobox"][aria-expanded="true"]';

/** May this Escape close the panel? Only when it is the person's own: focus is inside the panel (not in the browser's UI,
 *  another frame or an extension's iframe), nothing already handled it (`defaultPrevented` — a password manager closing its
 *  menu, an autocomplete closing its list), it is not part of an IME composition, and the focused control is not an open
 *  dropdown. Pure over plain values + an Element-like `target`. */
export function escapeMayClose({ defaultPrevented = false, isComposing = false, target = null, panel = null } = {}) {
  if (defaultPrevented || isComposing) return false;
  if (!panel || !target || typeof panel.contains !== "function" || !panel.contains(target)) return false;
  try {
    if (target.tagName === "SELECT") return false;                                  // a native select's popup takes Escape
    const owner = typeof target.closest === "function" ? target.closest(OWNS_ESCAPE_SELECTOR) : null;
    if (owner && panel.contains(owner)) return false;
  } catch (_) { /* an exotic target — fall through to "the person's own" */ }
  return true;
}

/** May this click close the panel? Only when the press began on the backdrop AND the click landed on it — a press that
 *  starts in the card (selecting text in a field, dragging) and is released outside produces a click whose target is the
 *  backdrop, and a click with no press behind it (an extension's injected click) never closes anything. */
export function backdropMayClose({ pressedOnBackdrop = false, target = null, currentTarget = null } = {}) {
  return !!(pressedOnBackdrop && target && target === currentTarget);
}

const cleanEmail = (e) => String(e == null ? "" : e).trim().slice(0, 254);

/** Remember what the person has typed so far (email + tab only). Never throws; returns whether it was written. */
export function saveDraft(storage, { email, mode, now = Date.now() } = {}) {
  try {
    if (!storage || !MODES.includes(mode)) return false;
    storage.setItem(DRAFT_KEY, JSON.stringify({ email: cleanEmail(email), mode, at: now }));
    return true;
  } catch (_) { return false; }
}

/** The draft to reopen, or null. Fresh, well-formed, and carrying nothing but an email + a known tab. */
export function readDraft(storage, now = Date.now()) {
  try {
    if (!storage) return null;
    const raw = storage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== "object" || !MODES.includes(d.mode) || !Number.isFinite(d.at)) return null;
    if (now - d.at > DRAFT_MAX_AGE_MS || now < d.at - 60_000) return null;
    return { email: cleanEmail(d.email), mode: d.mode };
  } catch (_) { return null; }
}

export function clearDraft(storage) {
  try { storage && storage.removeItem(DRAFT_KEY); } catch (_) { /* nothing to clear */ }
}

/** sessionStorage, or null where the browser blocks it (private window, sandboxed frame). */
export function draftStorage() {
  try { return typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : null; } catch (_) { return null; }
}
