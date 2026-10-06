# The edit cycle — why repeating the same edits got slower, and what it cost

**NEW-1, 2026-10-06 (B217540 recurrence ×2).** The owner's own "Something was slow just now" report
(`public.problem_reports` `5f82f13a-40f7-4093-9e27-20c42d295ea0`, build `6338802`, plan `smu1t5vcp73y`
"Phase II - 1.2M"): after about five minutes of copy → paste of whole building assemblies, moves of ~20
elements and road resizes, **229 long tasks / 41.5 s of blocking, the worst 940 / 937 / 714 / 706 ms**, every
one attributed to `P0`.

Instrument: `ui-audit/perf-edit-cycle.mjs` (`npm run perf:editcycle`), fixture
`ui-audit/fixtures/goose-creek-phase2-1-2m.json` (his plan, pulled from `public.sites` JOIN `public.site_elements`,
live rows only: 52 elements in 16 bonded assemblies, 2 parcels, his real settings, the rotated polygon-cropped
knocked-out sheet overlay). Pure verdict: `ui-audit/lib/editCycle.mjs`. Budget: `ui-audit/perf-edit-cycle.budget.json`.

---

## 1. What `P0` is — read first, because it is a misleading name

`P0` is the **minified name of React-DOM's `dispatchDiscreteEvent`** (found by building the report's own commit,
`6338802`, and reading the function the name resolves to: it sets the event priority to "discrete" and calls
`dispatchEvent`). A long task attributed to it is **not a background job and not a script of ours** — it is the
*synchronous work a click or a key press triggers*: the handler, the React render, **and every effect React flushes
at the end of that commit**, all inside the one task. So the 940 ms blocks are single user actions (a Ctrl+V paste,
a Delete, a pointer-up) — and the work hiding under the name is whatever those events' effects do.

## 2. The finding — the cost of an edit followed what ELSE the device stored

Same harness, same plan, same sequence, **only the amount of other plan data in the browser's own storage varied**
(`--store-kb`, built from the committed real fixtures re-id'd; his cloud account is 143 plans / 1.30 MB of plan JSON,
median 1.9 KB, largest 0.94 MB, and his device's `localStorage` read 3.88 MB):

| device store | build | one cycle (paste · drag · resize ×2 · delete) | the drag step | long-task ms per cycle | worst single task |
|---:|:--|---:|---:|---:|---:|
| 0 KB | origin/main | 2,802 ms | 821 ms | 1,895 ms | 175 ms |
| 1.3 MB | origin/main | **6,783 ms** | 1,950 ms | 5,172 ms | 317 ms |
| 3 MB | origin/main | **12,523 ms** | 3,570 ms | 10,387 ms | 424 ms |

Four things were found, each by measurement, in the order they were found:

1. **The whole-plan autosave ran on every pointer-move frame of a drag.** `SitePlanner.jsx`'s autosave effect runs on
   every `els` change and a drag changes `els` every frame. Each run did: `loadSite` for an "is this plan new?"
   yes/no (**parse the entire device store**, migrate and normalise the plan, run the name authority over every
   plan), `saveSite` (parse it again, snapshot, `createSiteModel` ×2, **stringify and write the entire store**), and
   `loadSite` once more to verify the write. At ≥ every 50 ms. None of that scales with the plan being edited — it scales
   with every other plan the device holds. *Counted:* one 40-frame drag wrote the store **29×**; a 7-second drag **131×**.
2. **`usePlanName` re-parsed the entire store on every render.** `planNameOf` (the `getSnapshot` of `usePlanName`,
   called from the planner's own render body) called `loadSiteSummaries()` itself — an uncached scan, while its
   sibling `allProjectNames()` had a cache. `useSyncExternalStore` calls `getSnapshot` on every render (and again in
   the commit), a drag renders every frame. At a 3 MB store this was the largest self-time in the CPU profile:
   **20.5 s over three cycles against 0.3 s with an empty store**.
3. **A building drag re-dissolved the whole road network every frame.** `roadNet` is keyed on `els`, so moving a
   building ran Clipper twice per road cluster, then `collapseRingSpikes`' quadratic `ringDrift` scan per spike
   candidate (`nD`/`ringDrift` 1.6 s self + ~1 s Clipper in an 11 s run), then one clipper difference per curb
   stripe — although no road moved and every ring handed in was value-for-value the previous frame's.
   (The earlier `PERF-VIEW-INDEPENDENCE.md` §4b had already measured the symptom — `dissolveRings` 60×,
   `clipPolylineOutside` 400× for one building drag — and filed it as B217540 "not started".)
4. **The history ring serialised itself three times per snapshot** (`writeHistoryAll`: once for the budget test, once
   for the localStorage mirror, once for the IndexedDB copy). Every paste/delete changes the shape signature and writes
   a snapshot; the ring grew ~40 KB per cycle until its 15-per-plan cap (~cycle 8), which is the one genuinely
   *progressive* component the harness saw.

## 3. The fix — and the same table after it

* `lib/gestureSave.js` + the autosave effect: **a gesture in flight is not a save point.** While `drag.current` is set
  the effect only keeps the per-element sync diff current (`reconcileElems(true)`, which already defers its flush) and
  polls — a ref read every 120 ms, no React state — for the gesture to end; the first run after it ends is the ordinary
  full save, unchanged. **The deferral expires after 5 s** (`GESTURE_SAVE_DEFER_MAX_MS`): a `drag.current` that never
  clears (a lost pointer-up) must not switch autosave off, and a very long drag still writes a crash-safety copy.
* `storage.js`: `writeSites` remembers the exact string and object it wrote; `siteExistsLocally` / `readBackSite`
  answer the autosave's "is this new?" and "did it land?" from that **only while `localStorage` still holds exactly
  that string** — any other writer (another tab, a cloud pull) changes the bytes and the original full read runs, so
  the B473/B592 cross-tab honesty is unchanged. Three whole-store parses per autosave → one. `writeHistoryAll`
  serialises the ring once.
* `names.js`: `planNameOf` rides the project-name index's one pass, one cache and one invalidation signal
  (`onProjectsChanged`, which every rename and every cloud pull already fires).
* `roadNetwork.js`: `dissolveRings` and `clipPolylineOutside` are memoised on the exact ring **values**
  (`pointsSignature`, 1e-4 ft). A road that really moved, or a pad that really moved against it, is a different key.

| device store | build | one cycle | the drag step | long-task ms per cycle | worst single task |
|---:|:--|---:|---:|---:|---:|
| 0 KB | fix | 1,564 ms | 430 ms | 102 ms | 85 ms |
| 1.3 MB | fix | 1,824 ms | 480 ms | 473 ms | 139 ms |
| 3 MB | fix | 2,562 ms | 609 ms | 1,038 ms | 257 ms |

Ten cycles at 1.3 MB, `--assert` against `perf-edit-cycle.budget.json` — **origin/main exits 1, the fix exits 0**:
median cycle 6,783 ms → 1,824 ms · median long-task 5,172 ms → 473 ms per cycle · worst single task 317 → 139 ms.

## 4. What did NOT reproduce — stated as loudly as what did

* **Cycle-over-cycle growth at a constant model size did not reproduce.** After the first (warm-up) cycle the slope
  was ≈ 0 within noise on origin/main too (work +35 ms/cycle, long-task +42 ms/cycle over ten cycles), flattening once
  the history ring hit its cap. What reproduced is a *very large constant cost per edit, proportional to the device
  store*, plus growth with the stored data (history) — which is how "progressively slower, near-freeze after ~5 min"
  and a 40–340 MB heap sawtooth read from the owner's chair. **His own device store (3.88 MB) is outside the largest
  size run here only by ~30 %.**
* **The heap climb 136 → 344 MB is garbage, not retention.** After a forced GC the heap is flat (≈ +0.2 MB/cycle over
  ten cycles on both builds); the raw `usedJSHeapSize` the recorder samples sawtooths because every autosave parsed
  and stringified megabytes. `(garbage collector)` was 2.0–2.5 s of each profiled run.
* **A cost that scales with model size remains, and is a different item.** With `--keep` (pasted copies stay, +9
  features/cycle) the per-cycle cost still grows ~110 ms/cycle on BOTH builds: the planner renders its whole body
  every pointer-move frame (≈ 12 ms per added feature per cycle). That is `B287058` (decompose `SitePlanner.jsx` by state
  ownership), untouched here. At his +4 elements per session it is small beside what was removed.
* **Rule-outs, each against the instrument:** the overlay PDF on the main thread (Sept 7) — *not this plan*: its sheet
  overlay is `storageMissing:true` with no `storageKey`, so pdf.js never runs (it **is** present in the 2026-09-25
  report: a `FrameRequestCallback:pdf.worker…` task). The label-collision memo (B217539) and the VIEW-INDEPENDENT-ONCE
  registry — not in the top-30 self-time of any profile here; the cost is model-edit-driven, not view-driven. The
  Bain-vs-Quiddity easement A/B — this plan has no easements (`easements: null`). The overlay's rotation/crop
  (PERF-BAIN) — present in the fixture and in every arm, constant, not scaling with edits.
* **`element-op-recast` / `element-assembly-joined` churn (the signed-in sync engine) was NOT exercised** — the
  harness is signed out, so the per-element engine never runs. Reading `elementSync.js`: a recast converts a refused
  create into an update and re-arms one more commit (one extra round trip), it does not re-run heavy work, and it
  does not touch the autosave effect. Whether the paste path *should* ever produce a create that hits a live row is a
  correctness question this session did not answer — see the follow-up on B217540.
* **The two earlier slow reports do not share this signature.** `f8af1bf9` (2026-09-25): the biggest task is a
  1,474 ms task with only 38 ms of script, attributed to a pdf.js rAF callback — render/raster-bound on a PDF-backed
  overlay. `9140777b`/`2fc2424e` (2026-09-28): ~100 tasks of ~300 ms in the first 15 s of the window (load) with
  8 edits. Neither is edit-driven. The whole-store cost multiplies any of them wherever an autosave is in the path,
  but that is not established here.

## 5. Remaining O(device store) cost, and why it is not fixed here

Each discrete save still parses the store once, stringifies it and writes it, plus the 400 ms settle write: at a
3 MB store a paste is ~433 ms and a delete ~324 ms (worst task 257 ms). Removing that needs
**per-plan storage keys instead of one blob holding every plan** — a persistence-layout change with a migration,
which touches `docs/DATA.md`'s invariants and every reader of `planarfit:sites:v1`. It is filed as a follow-up with
this measurement rather than done blind in the same change.
