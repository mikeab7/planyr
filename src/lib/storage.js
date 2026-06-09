/* localStorage-backed key/value store.
 *
 * The original prototype was written for Claude's artifact `window.storage`
 * sandbox API (async list/get/set/delete). This shim keeps the exact same
 * surface so the component code is unchanged, but persists to the browser's
 * localStorage instead — so scenarios survive reloads on your own machine.
 */
// Single-slot autosave of the live working canvas (separate from named scenarios).
export const AUTOSAVE_KEY = "planarfit:autosave:v1";

export function loadAutosave() {
  try {
    const v = localStorage.getItem(AUTOSAVE_KEY);
    return v ? JSON.parse(v) : null;
  } catch (_) {
    return null;
  }
}

// Persist the working state. If it's too big for localStorage (usually a large
// pasted screenshot dataURL), retry without that image so everything else saves.
export function saveAutosave(state) {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state));
    return true;
  } catch (_) {
    try {
      const u = state.underlay;
      const slim = u && String(u.src || "").startsWith("data:") ? { ...state, underlay: null } : state;
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(slim));
      return true;
    } catch (_2) {
      return false;
    }
  }
}

export const storage = {
  async list(prefix = "") {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    return { keys };
  },
  async get(key) {
    const value = localStorage.getItem(key);
    return value == null ? null : { value };
  },
  async set(key, value) {
    localStorage.setItem(key, value);
    return { ok: true };
  },
  async delete(key) {
    localStorage.removeItem(key);
    return { ok: true };
  },
};
