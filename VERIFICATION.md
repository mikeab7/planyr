# VERIFICATION.md — live-browser test checklist

Some changes pass every check we can run **without a browser** — `npm run lint`,
`npm test`, `npm run build`, and server-side endpoint calibration — but still need a
human (or a Claude coworker with a real browser) to confirm they actually work **in the
running app**. This file is the running list of those, so nothing that "builds green but
was never clicked" quietly ships broken.

> **Production app:** https://planyr.io (Cloudflare Pages, deploys from `main`).
> **This is the runtime counterpart to `BACKLOG.md`.** An item can be `[x]` done in the
> backlog and still ⏳ unverified here — the code landed; the click-through hasn't.

---

## How to use this — Claude Code / coworkers, read on every run

1. **Scan the 🔲 list below.** Surface to the user every item that is **⏳ unverified** or
   **due** (today is on/after its `Next check`). A one-line "these N are due" is enough.
2. **If you have a browser** (the `/verify` or `/run` skill, or any runtime): run the
   **Steps**, compare to **Expect**, then record the outcome — flip ⏳→✅ (or ❌ with a
   note), set `Last checked`, and bump `Next check` by the `Cadence`.
3. **If you have no browser:** just *remind*. Do **not** mark anything ✅ from reading the
   code — confirming-in-the-running-app is the entire point of this file.
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

### V7 — 🌐 GIS endpoint liveness (no browser needed) ⏳
- **Added** 2026-06-16 · **Cadence** monthly · **Last checked** 2026-06-16 (built green) · **Next check** 2026-07-16
- **Steps (any session, curl):** probe each source root for HTTP 200 + JSON:
  - County `https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/Texas_County_Boundaries/FeatureServer/0?f=json`
  - City `https://feature.geographic.texas.gov/arcgis/rest/services/City_Boundaries/Texas_City_Boundaries/MapServer/0?f=json`
  - ETJ `https://services.arcgis.com/NummVBqZSIJKUeVR/arcgis/rest/services/COH_ETJ_view/FeatureServer/1?f=json`
  - Road `https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_Roadway_Inventory/FeatureServer/0?f=json`
- **Expect:** all 200 with a `fields` array. County/city GIS hosts move occasionally — if one
  404s/moves, re-point its row in `src/workspaces/site-planner/lib/jurisdiction.js`.

---

## ✅ Verified / ❌ Failed — history
_Move items here with the date and who/what checked them. Nothing yet._
