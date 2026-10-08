# Planyr — Backlog

> **⛔ THIS FILE IS GENERATED — DO NOT EDIT IT (NEW-1, 2026-10-05).** It is a view of `ledger/backlog/_frame.md` (the prose below) plus one file per entry in `ledger/backlog/<state>/B<id>.md`, and a nightly job refreshes it, so it can **lag** the real ledger by up to a day. Read it for orientation only; the entry folders are the truth.
> - **File an entry:** create `ledger/backlog/open/B<id>.md` — the whole block, starting with its `### B<id> — title` heading. Two PRs that each add an entry touch different files, so they can never conflict.
> - **Move an entry** (Open → Verify → Done, or back for a recurrence): `npm run ledger -- move B<id> <open|verify|later|done>` — it renames the file; edit the text in the same commit.
> - **Orient cheaply:** `npm run ledger -- list open` (one heading per entry), or Grep `^### B` over `ledger/backlog/open` and `ledger/backlog/verify`.
> - **Never edit this file or `BACKLOG_OPEN.md`**; the build fails a PR that does. Only `_frame.md` (these rules, the tag legend, the section headings) is hand-edited — keep that rare.

Single source of truth for bugs and feature requests. Repo: `planyr` (product: **Planyr**).

> *"Single source of truth"* = the one file everyone trusts for what's done and what's left, so status never has to be tracked in anyone's head or in a chat thread.

---

## How this file works — Claude Code, read this first

- **On each run:** address every item under **🔲 Open**. Do **not** action anything under **🕓 Later / Roadmap** unless it's been moved up to Open. **⏳ Verify** items are already implemented and only awaiting a live check — they **park**, they never block a session (see the lifecycle below). Completed items live in `ledger/backlog/done/` — do not read the folder wholesale; look up one past item by id (`ledger/backlog/done/B###.md`).
- **IDs are permanent.** Mint from your reserved block with `npm run next-id -- --against-main` (it reads every entry under `ledger/backlog/`, all states). Never renumber or reuse a number, even after items are done.
- **Items pasted from another chat are "blind" to this file** and may carry provisional `NEW-#` (or stale/colliding `B#`) labels — treat those as scratch references only and assign the real next `B#` when filing. When you file a chat item, add an **`Origin: filed <date> from chat`** line so its provisional `NEW-#` resolves to the real `B#` later.
- **Owner chat blocks are SHIP ORDERS (owner rule, 2026-07-15).** Filing a pasted item is step one, never the finish line: every chat-block item is **implement-in-this-session** work — file, ship, then park per the lifecycle. An item that genuinely can't ship this session (hard unshipped dependency / true blocker) is **flagged loudly in the session reply AND on the item**, never silently filed. A diagnosis/handoff doc arriving without a B# → **mint one on sight** (DEDUPE-FIRST still applies). Full text in `CLAUDE.md` → "Owner CHAT BLOCKS are SHIP ORDERS".
- **Before filing, DEDUPE-FIRST.** Search **Open, ⏳ Verify, AND Done** (`^### B` headings) before minting a `B#`. If an arriving report matches an existing item, do **NOT** create a new number — apply the **recurrence rule** below instead.
- **Bracket tags** like `[Site Planner]` mark the module. `(bug)` / `(feature)` / `(task)` marks the type. **`#tags`** (from the legend below) mark the theme — every Open / ⏳ Verify item carries one or more.
- **Always commit after filing or editing an entry** — never leave the working tree dirty. A fix that isn't committed doesn't count as done.
- **Never edit `BACKLOG.md` or `BACKLOG_OPEN.md` — both are GENERATED** (BACKLOG.md is a nightly-refreshed view of `ledger/backlog/`; BACKLOG_OPEN.md the small Open/Verify index). A branch that touches either fails the `Generated-index touch guard`. File and edit entries under `ledger/backlog/` (below).
- **Never delete items.** Completed ones stay in `ledger/backlog/done/` as a record (write-only — never read the folder wholesale).
- **If an item is ambiguous,** don't guess. Mark it `[?]`, add your question inline, and leave it in Open.

### Item lifecycle — 🔲 Open → ⏳ Verify → ✅ Done (three states, B636)

Items no longer jump straight from Open to Done on a sandbox pass — live-only bugs (dependency arrows, export furniture sizing, …) kept boomeranging back. Every item carries a **`Verify:` field**:

- **`Verify: sandbox`** (the default) — a green build + the right unit/headless self-test is sufficient proof. On completion, move the entry file to `ledger/backlog/done/` (`npm run ledger -- move B### done`).
- **`Verify: live`** — the fix can only be *confirmed* in the live app. **Mandatory `live` classes:** timing/race bugs · concurrency / multi-writer · GIS endpoint behavior · zoom- or data-density-dependent rendering · PDF / export parity · anything whose repro cites real project data. (This is the **LIVE-VERIFY** rule in `CLAUDE.md`.) After implementing, move the block to the **⏳ Verify** section with a dated note; it moves to Done **only after** a verification note is appended (date · method — Cowork or Michael on planyr.io · observed result). **Moving a `live` item straight to Done is a protocol violation.**

⏳ Verify items **park** — they never block a session; the session that implements one keeps going.

### Recurrence — a fix that didn't stick does NOT get a new number (B636)

When a new report matches an existing **Done or ⏳ Verify** item (search titles, tags, symbols): do **NOT** mint a new `B#`. **Move the original entry back to Open** (`npm run ledger -- move B### open`), append a `Recurrence: <date> — <one-line report>` line, and add a visible count to the title, e.g. `(×3)`. Non-sticking fixes become visible on the one ID instead of scattering across new numbers.

### Theme tags (legend) — a tag may be used only if it appears here (B638)

Add a new tag to this legend **in the same commit** you first use it (this prevents tag sprawl; CI's `build-backlog-index --check` fails on an off-legend tag):

`#persistence` `#gis` `#gantt` `#export` `#site-planner` `#doc-review` `#scheduler` `#selection` `#pond` `#drive` `#testing` `#ui` `#markup` `#infra` `#auth` `#perf` `#files` `#compare` `#stitching` `#yield` `#filing` `#library` `#road` `#sync` `#coordinates` `#thoroughfare` `#entitlements` `#floodplain` `#grading` `#notes` `#parcel` `#geometry` `#food`
`#persistence` `#gis` `#gantt` `#export` `#site-planner` `#doc-review` `#scheduler` `#selection` `#pond` `#drive` `#testing` `#ui` `#markup` `#infra` `#auth` `#perf` `#files` `#compare` `#stitching` `#yield` `#filing` `#library` `#road` `#sync` `#coordinates` `#thoroughfare` `#entitlements` `#floodplain` `#grading` `#notes` `#parcel` `#geometry` `#keyboard` `#view` `#food`
`#persistence` `#gis` `#gantt` `#export` `#site-planner` `#doc-review` `#scheduler` `#selection` `#pond` `#drive` `#testing` `#ui` `#markup` `#infra` `#auth` `#perf` `#files` `#compare` `#stitching` `#yield` `#filing` `#library` `#road` `#sync` `#coordinates` `#thoroughfare` `#entitlements` `#floodplain` `#grading` `#notes` `#parcel` `#geometry`
`#persistence` `#gis` `#gantt` `#export` `#site-planner` `#doc-review` `#scheduler` `#selection` `#pond` `#drive` `#testing` `#ui` `#markup` `#infra` `#auth` `#perf` `#files` `#compare` `#stitching` `#yield` `#filing` `#library` `#road` `#sync` `#coordinates` `#thoroughfare` `#entitlements` `#floodplain` `#grading` `#notes` `#parcel` `#geometry` `#keyboard` `#view` `#a11y` `#admin` `#comps` `#mobile` `#telemetry` `#model` `#formula` `#security` `#dashboard` `#process` `#map-notes`

### Item template

<pre>
### B### — &lt;title&gt; `[Module]` (bug|feature|task) #tag1 #tag2  *(provenance note)*
`[ ]` &lt;one-line summary&gt;
- Verify: sandbox            # or `live` — see the mandatory-live classes above
- Origin: filed &lt;date&gt; from chat   # only when filed from a pasted chat item
- &lt;details…&gt;
</pre>

---

## 🔲 Open
<!-- ledger:entries open -->

## 🎨 UI audit pass — 2026-06-16

Full UI workstream from `UI_AUDIT.md` (re-authored this session: the predecessor 58-item
audit lived only in a parallel chat and was never committed, and several of its findings
were already implemented on `main`, so it was redone against HEAD + headless screenshots in
`ui-audit/screens/`). The brief's "coordinate-with" B-numbers (B2/B3/B10/B15/B16/B18/B19) were
that chat's provisional numbers — reconciled in `UI_AUDIT.md` (they map to real B2/B3/B10/**B65**/**B66** + two net-new). **Renumbered on merge:** these were minted B93–B99 on the branch, but `main` had meanwhile spent B93–B107 on its own UI/GIS work, so they are **B108–B113** here — and a couple are now superseded by main's parallel changes (noted inline; the legend item was dropped entirely).

## 🐞 Bug audit — 2026-06-15 (overnight sweep)

Systematic read-through of the whole codebase (5 parallel audits, each finding verified against the source). Severity/confidence noted per item. Items tagged **🔧 fixed in audit PR** were fixed in the same PR that added this section; the rest are triaged for review. IDs are permanent (B15+).

> **✅ Fixed in PR #27 (2026-06-15).** The remaining net-new items not already covered by #19–#26:
> **B25** curve calls flagged `curve:true` + kept as a chord approximation + UI warns (tessellation still deferred); **B31** `splitPolygon` falls back to the widest distinct-edge crossing pair; **B61** two-click road clamps its length axis ≥ cross axis; **B37d** `testConnection` accepts custom Supabase domains; **B48** `printPDF` escape also handles `>`/`"`. (Items duplicated by the parallel PRs — B26/B28/B30/B32/B47/B54/B58/B59/B60/B29/B62 — were dropped, not re-landed. **B18** left open: the merge-by-`updatedAt` half is a deliberate trade-off best reviewed, not auto-applied.)
>
> **✅ Fixed in PR #29 (2026-06-15).** **B43** `applyUser` captures a monotonic token before its `await pullCloud` and bails stale completions, so overlapping auth events can't apply to the wrong user; **B46** the Mapillary token is now a same-tab pub/sub so both `LayerPanel` copies stay in sync; **B55** the `probeService(...)` overlay continuation gets a `.catch` and guards `addTo` with `map._loaded` (the `uploadSource`/flush halves shipped in #17).
>
> **Follow-up (this session).** Completed: **B18** (`pullCloud` keeps a strictly-newer local copy of a still-present cloud record — recovers a missed last-second push, no cross-device-delete resurrection; the `sendBeacon` alternative was unnecessary). Partial within grouped items (which stay `[ ]`): **B36(b)** evidence opacity re-renders so per-feature fill ratios survive the slider; **B56(a)** address-search Enter gated on `busy`; **B56(d)** evidence layers do a trailing-edge refresh for a view that moved mid-fetch; **B57(a)** manual Calibrate disabled for a from-map underlay; **B36(c)** parcel import now picks the outer ring + an area-weighted centroid (shared `largestRing`/`ringCentroid` helpers, deduped across the three parsers); **B57(c)** the account/address lookup projects via the same 365223 equirectangular model as map-click (was true EPSG:2278 feet, a ~0.3% size mismatch).
> Still open: **B36** (a/d only — county-resolution that ties to **B13**; **(e) fetch-abort SHIPPED 2026-07-15** — evidence layers abort a slow OSM/Mapillary fetch on toggle-off and guard against a stale response rendering into a detached group; see BACKLOG-DONE), **B56** (b broad warn-timer refactor; c/e are doc-review), **B57** (b only — a cosmetic ~2 ppm foot-constant nicety), **B13**, and the doc-review items (parallel session's area).

<!-- ledger:entries bug-audit -->

---

## 🎨 UI/UX & parcel-interaction overhaul — 2026-06-16 (product walkthrough)

Filed from a product walkthrough of the map + planner chrome and the parcel-interaction
model. Provisional **NEW-1…NEW-8** were minted B93–B100, but **B93–B96 collided** with the
same-day GIS batch (PR #46, which had already shipped code under B93–B96); per the dedupe
protocol they are **renumbered B104–B107** here (B97–B100 were unique and keep their IDs; the
GIS batch keeps B93–B96). Deduped against existing items — **B10** (two-header consolidation +
product switcher) already shipped for the *planner* context bar and explicitly left "a single
physical row is a later polish," so **B104** is that remaining polish for the *map* view
(net-new, not a re-file); the rest have no existing Open counterpart. All eight are `[ ]` Open.

<!-- 2026-06-22: owner-dropped corrected chat batch (Scheduler PDF/Print Exhibit export quality) —
     amended NEW-1/NEW-2/NEW-4/NEW-5 (NEW-3 unchanged). Minted **B401/B402/B403**; the amended NEW-1
     folded into **B361** (its explicit home — "the continuous companion to B159's discrete selector").
     Per STANDING RULE #1 all four were filed AND fixed + headless-verified (V116, 16/16) + committed
     this session on branch `claude/vigilant-brown-5dqcog`. All touch ONE surface:
     public/sequence/index.html (buildGanttSVG + PDFExportModal + buildPDFHtml). Full [x] blocks live
     in BACKLOG-DONE.md:
       • B361 — export time-axis controls: a discrete Days/Wk/Mo/Qtr selector (sidebar) + a continuous
                Time −/+ (toolbar) wired to the SAME span state + Pan (renamed from Move, drags the
                time window, today-centered default) + FIXED the dead/intermittent floating toolbar
                (rebuilt as a pinned absolute overlay). Page Zoom + Fit kept.
       • B401 — the default time window auto-fits so every start/end label sits on the sheet (extend the
                frame, never move a label; capped at ~22% of span/side so a long label can't crush it).
       • B402 — dependency connectors stay CURVED but now terminate at 12 o'clock (descend into the bar/
                diamond TOP, clearing the endpoint date) + a vertical de-collision pass for co-dated names.
       • B403 — silently persist & restore ALL export-screen state (orientation/size/margins/columns/
                name-align/header/section-collapse/timescale/pan) via localStorage `planar:exportPrefs:v1`,
                synchronously, NO badge. Column width keeps riding data.exportColWidths (B392).
     B160 (the whole-split table-vs-chart divider ratio) left Open by design — distinct from B361's
     in-chart time axis; B392's per-column drag-resize already covers most of the need. -->

---

## ⏳ Verify — awaiting live confirmation

<!-- ledger:entries verify -->

## 🕓 Later / Roadmap

*Deliberately deferred. Do **not** action these unless moved up to 🔲 Open.*

*The four items below are Stages 2–5 of the owner's "make this an actual financial model" roadmap
(same chat block that shipped Stage 1 as B979392). The owner was explicit and binding: ship in
sequential PRs, one stage per session, never starting a stage until the previous one is merged
AND he has confirmed it. These are filed for the record per the "diagnosis/handoff without a B#
is itself a protocol violation" rule — they are NOT to be started without his go-ahead on Stage 1.*

<!-- ledger:entries later -->

---

## ✅ Done

> Completed items live in **`ledger/backlog/done/`** (one file each; write-only — never read the folder wholesale).
> When finishing an item: `npm run ledger -- move B### done`. Mint the next B# with `npm run next-id -- --against-main`.
