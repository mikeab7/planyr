/* Planyr-ID ↔ backend-ID mapping (B206 / NEW-1).
 *
 * The ONE place a Planyr stable key is translated to/from a backend's own id (e.g. a
 * Google Drive file id). No Drive id — or any backend id — is allowed to leak past the
 * adapter into app code: the app references files ONLY by Planyr's own stable keys, and
 * this table is the only translator. Swapping backends (Drive → Planyr-native, or to a
 * stub) only rebinds this table; nothing in the app changes.
 *
 * `store` is pluggable. The default is in-memory (tests, scaffolding); in production the
 * binding records live in Supabase Postgres (NEW-2) — pass a store backed by that table.
 */

// In-memory store: two dictionaries kept in lockstep (key→backendId, backendId→key).
export function memoryIdStore() {
  const fwd = new Map(); // planyrKey -> backendId
  const rev = new Map(); // backendId -> planyrKey
  return {
    get: (planyrKey) => fwd.get(planyrKey) || null,
    getByBackend: (backendId) => rev.get(backendId) || null,
    set: (planyrKey, backendId) => { fwd.set(planyrKey, backendId); rev.set(backendId, planyrKey); },
    del: (planyrKey) => { const b = fwd.get(planyrKey); if (b != null) rev.delete(b); fwd.delete(planyrKey); },
    all: () => [...fwd.entries()].map(([planyrKey, backendId]) => ({ planyrKey, backendId })),
  };
}

export function createIdMap(store = memoryIdStore()) {
  return {
    // Planyr key → backend id (or null if this file isn't bound to the backend yet).
    resolve: (planyrKey) => store.get(planyrKey),
    // backend id → Planyr key (used to translate a backend listing back to Planyr keys;
    // a backend object with no Planyr binding is intentionally invisible to the app).
    reverse: (backendId) => store.getByBackend(backendId),
    bind: (planyrKey, backendId) => store.set(planyrKey, backendId),
    unbind: (planyrKey) => store.del(planyrKey),
    list: () => store.all(),
  };
}
