# Named rule TIER-BY-REBUILDABILITY

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **TIER-BY-REBUILDABILITY** — **User work and re-fetchable cache NEVER share a storage tier, and anything
  that can be re-fetched belongs in the LARGE one** (B1427, 2026-08-06, after a disposable map cache
  crowded the owner's saved plans out of a ~5 MB store — the B473 "your work is safe in the cloud, this
  device's storage is full" banner, with 400 KB terrain tiles keeping their space while a real plan was
  refused). Four parts, all binding:
  1. **THE TWO TIERS ARE DIFFERENT BY THREE ORDERS OF MAGNITUDE AND ARE NEVER REASONED ABOUT AS ONE.**
     Measured on the owner's own Chrome: **localStorage 3.88 MB across 156 keys against a hard ~5 MB
     per-origin cap (~78% full)** · **IndexedDB 35.9 MB against a 10,275.9 MB quota (0.3%), persisted.**
     Never sum them, never report a combined figure, never call the large one "uncapped" or "a store that
     can't fill" (`localDb.js`'s header said exactly that, and that framing is what let the mistake live
     for a year). A combined "4 MB of 10 GB" reads as empty while the store that matters is about to throw.
  2. **THE SMALL STORE IS FOR IRREPLACEABLE WORK ONLY** — saved plans, the cloud index, the version ring,
     the autosave. A cache that competes with it is a **priority inversion**: pure cache holding room that
     irreplaceable user work needs. Put the cache in IndexedDB (`gisCache.js`'s persistent tier, B1427)
     and keep its own budget there — bounded is still right, it was just bounded against the wrong ceiling.
  3. **A BUDGET IS NOT OPTIONAL, EVEN IN THE LARGE STORE.** `SitePlannerApp.jsx` calls `idbPersist()`, so
     this origin is **PERSISTENT** — the browser will never evict it for us. That is correct for data safety
     and it makes the app solely responsible for its own size.
  4. **NO EVICTION MAY EVER COST DATA THAT CANNOT BE REBUILT.** Every reclaimable class must **declare a
     rehydration source** (cloud Storage, the source PDF, a re-fetchable GIS service) before anything is
     removed; a class that cannot name one for EVERY member is not reclaimable at any pressure. B474's
     hazard is the precedent — "a raster whose src had been dropped (idbKey set) was then unrecoverable" —
     so reference images declare `rebuild: null` and are never bulk-cleared. Declarations live in
     `shared/storage/storageCensus.js`; `shared/storage/storageReclaim.js` is the only module allowed to
     act on them, and it refuses the whole pass if any class claims to be reclaimable with no way back.
  - **Corollary — MEASURE, don't reason.** Nothing knew its own size before B1429, which is why the first
    diagnosis of this crisis blamed IndexedDB and was wrong by three orders of magnitude. Both tiers are
    now surfaced (the planner's plan menu → Storage, reachable signed-out) and both ride every storage-failure telemetry
    row, tier-labelled `local_*` / `idb_*`. Guards: the repo-root `test/` suites **storageReclaim** (incl.
    the raster-with-no-cloud-copy case) and **gisCache**.
