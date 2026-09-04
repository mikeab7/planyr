# Incident — a delete in one plan destroyed a reference image in every plan sharing it

**Date:** 2026-08-13 · **Severity:** data loss (unrecoverable, one file) · **Items:** B487600 (fix, V278320) · B487601 (wayfinding) · **PR:** #1040

Two owner reports arrived together — *"a picture I uploaded says it's not available"* and *"I duplicated a plan and the original's roads are all sorts of fucked up."* One was a real, ongoing, data-destroying defect. The other was not a defect at all. This record exists because the second one nearly buried the first.

---

## 1. What was actually wrong

`⧉ Duplicate plan` copies each overlay record **wholesale** — `storageKey` (the cloud object) and `idbKey` (the device raster) included. Two plans then point at **one** set of bytes.

Every delete path ref-counted that share against `sheetOverlays` — **the current plan's overlay list** — which by construction cannot see a sibling plan. So removing the picture from a duplicate hard-deleted the original's image, **out of both tiers at once**.

The comment at the call site even said *"a Duplicate/Paste copies the storageKey"*. It was right about the sharing and wrong about the scope: it checked the one place the sibling could never be.

### The evidence, from the database rather than from reading code

- Plan `smsrrlk9u576` ("Concept A 1M SF", Woods Road) still carries an overlay record naming `…/site-overlays/smsrrlk9u576/e1454691snsene.png`, `src: null`.
- `storage.objects` holds **zero** rows for that key — and zero for that plan, and zero for that element id.
- The record's `storageKey` is only ever written **after a successful upload** (`if (res)`), so the object existed and was later removed. Nothing but the delete path removes it.
- **Six further plans were armed identically at fix time:** Goose Creek (four plans sharing one site-plan PDF) and Bain (two).

---

## 2. Three paths produced the sharing — the fix had to cover all of them

| Operation | Shares | Notes |
|---|---|---|
| `duplicatePlan` | `sheetOverlays` — both tiers | the reported path |
| `newPlanSameParcel` | `underlay: src.underlay` | **the aerial backdrop, whose delete path had NO ref-count at all** — found late, not in the first diagnosis |
| `copyOverlay` / `placeOverlayCopy` (B461) | `src` + `storageKey` | within **and across** plans |
| `renameSiteGroup` | **nothing** | patches `{ id, site, siteRenamedAt }` on the same plan; creates no second plan |

Rename was checked explicitly, because the owner later thought he may have renamed rather than duplicated. It cannot produce sharing. The enumeration matters more than the individual fix: a fix aimed only at `duplicatePlan` would have left the backdrop path live.

---

## 3. The bigger blast radius — the same disease, one tier down

`deleteSite` evicted cached rasters by the **prefix** `raster:<siteId>:`. A duplicate carries the **source** plan's `idbKey`, so deleting the source plan wiped the device copy for every plan copied from it.

This is the same failure as the main bug: **a rule that looks precise and is actually matching on a string.** The prefix sweep is kept — it is what evicts genuine orphans — but now spares every key a surviving plan still names (`idbDeleteByPrefix(prefix, { keep })`).

---

## 4. The fix

`lib/sharedAssetRefs.js`, three rules:

1. **The ref-count spans every plan, never the current one.**
2. **An unknown answer releases nothing.** An orphaned object costs storage; a destroyed one costs the owner's work, and there is no bucket versioning and no PITR covering storage bytes to undo it.
3. **Both tiers are released together or neither.** Releasing one leaves a plan rendering from a cache it can never rebuild, or a cloud object nothing points at — both were reachable before, because the two ref-counts were written separately at one call site.

Soft-deleted plans count as holders: a binned plan is restorable, so its bytes are owed to it.

### The database is the authority

The client's plan list is only ever best-effort — it knows what *this device* has hydrated. A stale tab, a second device or a direct Storage API call all reason from an incomplete list and would orphan the bytes exactly as before.

`db/overlay_object_release_guard.sql` — a `BEFORE DELETE` row trigger on `storage.objects` that refuses while any plan still references the key.

**Proven on the real path, not assumed.** Supabase's own `protect_delete` is a *statement*-level trigger that blocks direct SQL, so a naive probe proves nothing. The Storage API bypasses it by setting `storage.allow_delete_query`; the probe set the same flag:

- shared object → **refused**, naming all four Goose Creek plans
- unreferenced object (**the discriminating control**) → **passed through**, proving the guard discriminates rather than blanket-blocking
- both probes aborted unconditionally, so neither could commit a delete either way

---

## 5. Recovery

**The image: not recoverable.** No bucket versioning; database PITR does not cover storage bytes. The only possible surviving copy was the device raster, and the same delete wipes that.

**The plan: recovered.** `smsrpaiqu5sv` was soft-deleted and intact. Restored as **`smt0rwoodsa1` "Concept A (restored)"** — 30 elements including the 1,675′ × 613′ (~1,026,775 sf) building.

⛔ **Restored under a NEW id, deliberately.** The device holds a durable 30-day delete tombstone (B757) for the old id, and `pullCloud`'s `deleteRetry` **re-issues the cloud delete for a plan whose removal never landed**. An in-place restore would have been re-deleted on his next pull — reported as success and silently undone. A fresh id no tombstone names cannot be caught by that.

**The roads stay deleted**, at the owner's explicit instruction — he removed them deliberately while reworking that plan. They belong to `smsrrlk9u576`, never to the restored plan, and remain recoverable as soft-deleted rows.

---

## 6. The report that was NOT a defect — and why it nearly cost the real one

*"I duplicated a plan and the original's roads are all sorts of fucked up."* Every hypothesis was refuted by the data:

- **Duplication does not share the drawing.** Each plan owns its own element rows; the original sat untouched from 16:58 while the copies were edited for four more hours.
- **No migration touched his data.** The last database migration changed a function, not a row. PR #1034's z-respacing is a client-side load-time repair. The original had not been written since before any of it.
- **No save race, no second tab.** Every deletion is an explicit `key:delete` from his own tab, one telemetry row per press.
- **The roads were his own edits**, and the plan he was hunting **never had roads at all**.

He later self-corrected: he may have renamed rather than duplicated. **The correction does not retract the image bug**, which rests on database evidence, not on his account — and the cross-plan sharing itself proves duplication happened at some point.

The real cause of the false report is **B487601**: three near-identical plan names, `Concept A (copy) (copy)`, and no visible cue for which plan is being edited. It cost him an hour and produced a corruption report against working code.

---

## 7. Where the device copy went — a properly controlled negative

Checked read-only on the owner's own Chrome, without booting the app (`/robots.txt` on the origin; `indexedDB.open("planyr")` with **no version argument**, so `onupgradeneeded` can never fire; readonly transaction; no writes).

Safe because the origin's only service worker (`/gis-sw.js`) is a **tombstone** — no `fetch` handler, touches only the Cache API, unregisters itself — and `_redirects` deliberately omits the SPA catch-all (B449), so an unmatched path returns a real 404 and never the app bundle.

**Result:** control key `planarfit:sites:history:v1` present at 3.74 MB (the query works); target key **absent**; the only surviving rasters belong to `smqueru4e4sn`, a site that no longer exists in the database at all.

**Two lessons worth more than the result:**

- **A UA string is not a device identity.** Chrome reports only the major version, so two installs on Chrome 151 are indistinguishable. An inference drawn from it was stated to the operator and was **wrong**; the probe designed to test it is what caught it. Never treat `navigator.userAgent` as machine identity.
- **The version-history ring is the better witness, and it is first-party.** Nothing in the site planner ever deletes a ring entry (`clearHistory` has no site-planner caller; `deleteSite` does not touch it; the IndexedDB copy is uncapped), and `smsrrlk9u576` **was never deleted** — it is the live plan. So its absence from the ring cannot be a blast-radius effect: it means the plan was never saved on that profile. The ring holds today's Richfield (16:47) and Bain (19:37) work but **not one plan of the Woods Road group**, with overlapping working windows — so that project was worked somewhere else.

The operator also caught a **truncation in their own first pass** (a site-id list sliced at 40 of 56) before trusting it — exactly the false-negative shape this repo keeps generating. Re-run unsliced, the answer held.

---

## 8. Guards

- `test/sharedAssetRefs.test.js` (17) — **replays the pre-fix rule verbatim** as the mutation check, so the suite goes red if the old scope ever passes again; plus source guards on all three call sites and on the SQL.
- LOUD-FAILURE: a retained file reports its holders **by name** — `overlay-asset-retained` / `underlay-asset-retained` / `plan-delete-raster-retained`. A kept file is never silent.
- **V278320** — the client half has never run signed-in against real Storage (the sandbox blocks sign-in). Steps in `VERIFICATION.md`. ⚠ Run it on a throwaway duplicate: a wrong result destroys a real file.
