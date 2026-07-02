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
    set: (planyrKey, backendId) => { fwd.set(planyrKey, backendId); rev.set(backendId, planyrKey); return { ok: true }; },
    del: (planyrKey) => { const b = fwd.get(planyrKey); if (b != null) rev.delete(b); fwd.delete(planyrKey); },
    all: () => [...fwd.entries()].map(([planyrKey, backendId]) => ({ planyrKey, backendId })),
  };
}

export function createIdMap(store = memoryIdStore()) {
  // All methods are async so the store can be in-memory (sync, awaited transparently) OR
  // a durable Supabase-backed store (async REST) — the adapter awaits either the same way.
  return {
    // Planyr key → backend id (or null if this file isn't bound to the backend yet).
    resolve: async (planyrKey) => store.get(planyrKey),
    // backend id → Planyr key (used to translate a backend listing back to Planyr keys;
    // a backend object with no Planyr binding is intentionally invisible to the app).
    reverse: async (backendId) => store.getByBackend(backendId),
    // Returns { ok } so the adapter can roll back a just-saved file whose mapping didn't
    // persist. A legacy store whose set() returns nothing is treated as success (back-compat);
    // only an explicit { ok:false } triggers rollback.
    bind: async (planyrKey, backendId, meta) => {
      const r = await store.set(planyrKey, backendId, meta);
      return r && typeof r === "object" && "ok" in r ? r : { ok: true };
    },
    unbind: async (planyrKey) => store.del(planyrKey),
    list: async () => store.all(),
  };
}
