# VERIFICATION.md — live-browser test checklist

Some changes pass every check we can run **without a browser** — `npm run lint`,
`npm test`, `npm run build`, and server-side endpoint calibration — but still need a
human (or a Claude coworker with a real browser) to confirm they actually work **in the
running app**. This file is the running list of those, so nothing that "builds green but
was never clicked" quietly ships broken.

> **Production app:** https://planyr.io (Cloudflare Pages, deploys from `main`).
> **This is the runtime counterpart to `BACKLOG.md`.** An item can be `[x]` done in the
> backlog and still ⏳ unverified here — the code landed; the click-through hasn't.

> ## ⚠️ Testing policy (2026-06-16, standing — read this)
> **Michael does NOT click through to test things himself. Ever.** Don't wait on him, don't ask
> him to verify, don't end a turn expecting him to go look. Live verification is **delegated to the
> Claude cohort** (browser-capable Claude sessions running `/verify` or `/run`). The working rhythm:
> - After a change is **CI-green + build-green**, the **default is to move on.** Log anything that
>   needs a real browser as an item below for the cohort to pick up — that's all the follow-up needed.
> - **Do NOT surface "these N are unverified" to Michael as a to-do for him.** File them here instead.
> - **Only interrupt Michael for a genuinely CRITICAL problem** — the app won't build, won't render
>   (blank screen), or a shipped feature is visibly crashing in production. Everything else: note it
>   here, keep moving.

---

## How to use this — Claude Code / coworkers, read on every run

1. **Scan the 🔲 list below.** This is the **Claude cohort's** queue — items here are waiting for a
   browser-capable session to verify. Per the testing policy above, do **not** hand this list to
   Michael as his to-do; only escalate a **critical** (won't build / won't render / crashing) issue.
2. **If you have a browser** (the `/verify` or `/run` skill, or any runtime): run the
   **Steps**, compare to **Expect**, then record the outcome — flip ⏳→✅ (or ❌ with a
   note), set `Last checked`, and bump `Next check` by the `Cadence`. This is the cohort's job.
3. **If you have no browser:** **just leave the item logged here for the cohort and move on** — don't
   block on Michael. Do **not** mark anything ✅ from reading the code — confirming-in-the-running-app
   is the entire point of this file.
4. **Endpoint-liveness items (tagged 🌐) are the exception** — they're a `curl`/REST probe,
   runnable from any session *without* a browser. Run those when due.
5. Keep it honest: a ❌ stays ❌ with the date and what broke until it's re-fixed and re-run.

`CLAUDE.md` points every session here, so this list is consulted automatically.

---

## 🔲 Needs verification

### V1 — Jurisdiction & road-authority identify (B93 / B94) ⏳
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-16
- **Steps:** On planyr.io open a georeferenced site (or bring a parcel in from the map).
  Right panel → **🔍 Identify parcel** → click a lot → **⚖︎ Jurisdiction & road authority**.
- **Expect:** County / City (or "Unincorporated") / ETJ / Road maint. rows each render with
  a data-age. A City-of-Houston lot reads **Houston / Harris**; an unincorporated lot near
  Houston reads **Unincorporated + "Houston ETJ"**; the road row shows an authority (e.g.
  **State (TxDOT) · City**). **No CORS or network errors in the browser console.**
- **If it fails:** most likely a CORS block — a GIS host must allow the planyr.io origin.
  Note the failing host from the console. The feature degrades to honest "unknown"/error
  text, so a failure is visible, not silent.
- **2026-06-16 — data path verified live** (Node, calling the shipped functions against
  the production endpoints): downtown Houston → **Houston / Harris**, not in ETJ, road
  **City**; Spring → **unincorporated + Houston ETJ + Harris**; Sugar Land → **Fort Bend**.
  Field maps, normalization, the ETJ constant and county-key mapping are all correct
  against live data. **Still ⏳ for the browser layer only** — CORS from the planyr.io
  origin + the on-screen Identify-panel render — which needs a real browser (preview
  https://claude-festive-davinci-0oco2.planyr.pages.dev, or planyr.io).

### V2 — GIS stale-while-revalidate cache + data-age (B96) ⏳
- **Added** 2026-06-16 · **Cadence** once · **Last checked** — · **Next check** 2026-06-16
- **Steps:** Enable an OSM/Overpass evidence layer on the map, let it load, then **reload
  the page** with the same view.
- **Expect:** On reload the layer paints **instantly from cache** (no blank wait) and the
  Layers panel shows a **"refreshed Xm ago"** age that keeps counting; a background refresh
  swaps in fresh data. Confirms the cache survives reload (the old in-memory map did not).

### V3 — County-label correction on the statewide fallback (B36a) ⏳
- **Added** 2026-06-16 · **Cadence** once · **Last checked** — · **Next check** 2026-06-16
- **Steps:** Select a parcel that the statewide TxGIO source answers (a Fort Bend or border
  lot where the county CAD is slow/down). Open it into the planner.
- **Expect:** The saved site records the **true county** (Harris / Fort Bend), not a
  mislabeled "Chambers". Hard to force on demand — opportunistic; verify when a border/FB
  lot is handy.

### V4 — Site-plan overlay tool: drop → scale → align → reload (B72 / B73, main) ⏳
- **Added** 2026-06-16 · **Cadence** once · **Last checked** — · **Next check** 2026-06-16
- **Steps:** Left rail → **Overlay** → drag a site-plan PDF onto the map. Move / scale /
  rotate / opacity. Try **Trace a length** and **Align to map** (click drawing points then
  the matching map points → Apply). Reload the page; on another device if possible.
- **Expect:** The sheet places, manipulates, and aligns; **Align to map** captures clicks
  on the drawing itself; the overlay **persists across reload** (re-fetches the PDF from
  Storage and re-rasterizes when signed in). This was shipped UNVERIFIED — confirm on the
  preview/prod.

### V5 — Opening a saved site is reliable (B64) ⏳
- **Added** 2026-06-16 · **Cadence** on-change + monthly · **Last checked** — · **Next check** 2026-07-16
- **Steps:** Open a saved site, zoom/pan to find its pin, then click it to enter the planner
  — repeatedly, especially right after a zoom.
- **Expect:** The open registers **every time** (no dropped click). A mitigation shipped but
  is UNVERIFIED; if it still drops, that confirms the map-level hit-test fallback is needed.

### V6 — No white flashing on zoom/pan (B65) ⏳
- **Added** 2026-06-16 · **Cadence** on-change + monthly · **Last checked** — · **Next check** 2026-07-16
- **Steps:** Open a site and zoom/pan hard, including big zoom jumps.
- **Expect:** No repeated white flash between frames (the paper backdrop holds). A partial
  fix shipped UNVERIFIED; if it persists, re-enable zoom animation / double-buffer next.

### V8 — UI/UX overhaul batch: parcel state + chrome (B97–B107) ⏳
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-16
- Shipped code-verified + build-green, NOT browser-checked. Cohort to confirm each in the running app:
  - **B100 active/inactive** — in the planner, select a parcel → Parcel panel → **◯ Inactive**; expect it
    to render **dimmed + dashed**, drop out of Site area / coverage / FAR / detention, and the Yield panel
    to read "Excludes 1 inactive parcel." Toggle back to **✓ Active** restores it. New parcels start Active.
  - **B99 lock** — the always-on 🔒 badge is gone from the saved-parcel list; Lock/Unlock still works from
    the Parcel panel and a locked parcel can't be dragged/reshaped.
  - **B97 layers panel** — on map + planner, the **Map layers / Utility evidence / jurisdiction** group
    headers collapse on click (chevron + "N on" count), state persists across reload; panel fits without
    scrolling.
  - **B106 sites panel** — "Your sites · N" header collapses (persists); per-row **crosshair + delete
    reveal on hover** (no always-on ✕); delete still asks to confirm; zero-count status chips are hidden.
  - **B104 map header** — only **one** "Site Planyr" brand shows (shell header); the map bar reads
    "Find a site" + search + Start blank, no duplicate lockup.
  - **B105 hint** — the "Drag to move the map" card appears once, dismisses with ✕, and stays gone on reload.
  - **B107 left tabs** — order reads **Yield · Parcel · Element · Aerial · Overlay · Setup**.
- **If any fails:** none are critical (no data risk) — log ❌ here with what looked wrong; fixes are small.

### V7 — 🌐 GIS endpoint liveness (no browser needed) ✅
- **Added** 2026-06-16 · **Cadence** monthly · **Last checked** 2026-06-16 (all 4 → HTTP 200 + fields: county 12 / city 11 / etj 6 / road 133) · **Next check** 2026-07-16
- **Steps (any session, curl):** probe each source root for HTTP 200 + JSON:
  - County `https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/Texas_County_Boundaries/FeatureServer/0?f=json`
  - City `https://feature.geographic.texas.gov/arcgis/rest/services/City_Boundaries/Texas_City_Boundaries/MapServer/0?f=json`
  - ETJ `https://services.arcgis.com/NummVBqZSIJKUeVR/arcgis/rest/services/COH_ETJ_view/FeatureServer/1?f=json`
  - Road `https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Roadway_Inventory/FeatureServer/0?f=json`
- **Expect:** all 200 with a `fields` array. County/city GIS hosts move occasionally — if one
  404s/moves, re-point its row in `src/workspaces/site-planner/lib/jurisdiction.js`.

### V9 — Attach & mark up a drawing on a parcel (B67) ⏳
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-16
- **Steps:** Open a site, select a **parcel** → Parcel panel → **"＋ Attach a drawing (PDF / JPG)"**
  → pick a real **multi-page** engineering PDF (then also a JPEG). For the multi-page PDF a
  **"Pick a sheet"** dialog should list every page — choose one. Draw with **Pen / Line / Box /
  Text**, recolour, **Select** + **Delete**, **zoom (wheel) + pan (drag in Select)**, click
  **Done**, reopen the drawing, then **reload the page**.
- **Expect:** the **chosen** sheet rasterizes as an **immutable backdrop** (named "<file> — p.N");
  markups stay **locked to the drawing** through zoom/pan (stored pixel-relative); multiple
  drawings list under the parcel; markups **persist** across reopen + reload (signed in, same
  device). `ui-audit/screens/parcel-drawing.png` shows the modal headless (an SVG stand-in, not a
  real PDF) — this step confirms it with a real file, including the page-picker.
- **Cross-device (increment 2b, landed 2026-06-16) — please test:** signed in, attach a drawing on
  device A; on **device B** (or after clearing local cache) open the same site + drawing → the
  backdrop should **rebuild from cloud Storage** ("Loading the drawing from the cloud…", then it
  appears with its markups). The source file is uploaded to the private `doc-review-files` bucket at
  `<uid>/parcel-drawings/<siteId>/<drawingId>.<ext>`; on reopen without a local raster it re-fetches +
  re-rasterizes the stored sheet. Deleting a drawing removes its stored object. **Fallback:** logged
  out / >50 MB / upload error → keeps the local raster + the old "re-attach" placeholder cross-device
  (markups always persist), so nothing regresses.
- **Increment 2a (multi-page sheet picker) also landed** — verify the "Pick a sheet" dialog lists all
  pages and attaches the chosen one.

### V10 — Snap defaults OFF; toggle + Alt hold-to-suppress (B114) ⏳
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-16
- **Steps:** (0) Open **any** site — incl. an existing one made before this change — and confirm the
  toolbar pill reads **`Snap off`** (grey dot) and dragging a road up against trailer parking does
  **not** stick to its edge (it lands where you drop it). (1) Press **S** (cursor on the canvas, not
  in a text field) → pill flips to **`Snap 10′`** (green dot); now the road flush-snaps to the edge.
  (2) **Hold Alt** and drag it to a deliberate ~15-ft gap and drop — with snap on, Alt still places
  it freely for that one move; release Alt and snapping is back. (3) Click the toolbar **Snap** pill —
  same toggle as S. (4) Turn snap on, **switch to another site / reload the page** → snap stays **on**
  (the choice persists); turn it off → stays off. (5) With snap on, resize a box / rotate it (grid /
  15° steps) vs. Alt-held (smooth/free).
- **Expect:** Snap starts **OFF for every site** (free movement is the default, even on old sites that
  had snap baked in). The **S** key, the pill, and the Setup checkbox all toggle one **global**
  preference that persists across sites/reloads. Alt suppresses snapping for just that one drag and
  re-enables on release; "off" fully disables grid snap, neighbour flush-snap, resize-to-grid and
  rotate-to-15°. **Shift-drag still bonds to a neighbour** (the green +) regardless of the toggle.
- **If it fails:** none critical (no data risk) — log ❌ here with what looked wrong.

---

## ✅ Verified / ❌ Failed — history
_Move items here with the date and who/what checked them. Nothing yet._
