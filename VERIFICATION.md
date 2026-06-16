# VERIFICATION.md — live-browser checks for a coworker

Some changes pass `npm run lint` / `npm test` / the headless `ui-audit` screenshots but
still need a human in a **real browser on https://planyr.io** to confirm — timing races,
real PDFs, cross-device sync. This file is that checklist. Tick a box when confirmed; if
something fails, note it under the item and (re)file in `BACKLOG.md`.

> How to use: pull the latest `main` (or the named branch), open the app, sign in, and run
> the steps. "Headless status" = what automated checks already prove; your job is the
> "Live check" that they can't.

---

## ⬜ B67 — Attach & mark up a drawing on a parcel  *(branch: `claude/laughing-babbage-hrxgct`)*
**Headless status:** ✅ build/lint/56 tests green; `ui-audit/screens/parcel-drawing.png`
shows the modal rendering an immutable backdrop with pixel-relative markups (seeded SVG
stand-in, not a real PDF).

**Live check (use a REAL multi-page PDF and a JPEG):**
1. Open the Site Planner, open/select a site, click a **parcel** so the Parcel panel shows it.
2. In the Parcel panel → **"＋ Attach a drawing (PDF / JPG)"** → pick a real engineering PDF.
   - [ ] Page 1 rasterizes and opens as the **immutable backdrop** (linework on paper).
   - [ ] Draw with **Pen / Line / Box / Text**, change colour, **Select** a markup and **Delete** it.
   - [ ] **Zoom (wheel) + pan (drag in Select)**; markups stay locked to the drawing (no drift).
   - [ ] Click **Done**, reopen the same drawing → **markups persist** (same device/session).
3. Attach a **JPEG** to the same parcel → second entry appears; both list under the parcel.
4. Reload the page → the drawing list + markups are still there (signed-in, same device).

**Known/expected limits (NOT bugs — increment 2):** multi-page PDFs only show **page 1**
(no page-picker yet); after a **re-login on another device** the backdrop shows a
"re-attach to view — markups saved" placeholder (raster is local-only until Storage backing
lands; **markups always persist**).

---

## ⬜ B64 — Clicking a saved site reliably opens it  *(branch: `claude/laughing-babbage-hrxgct`)*
**Headless status:** ✅ build/tests green; the saved-site layer renders (`map-sites.png`).
The bug is an intermittent **timing race** that can't be reproduced headless.

**Live check:**
1. Have ≥1 saved site with a parcel. On the map finder, **zoom/pan to the site**, then
   **click its pin/footprint immediately** (especially right after a zoom). Repeat ~10×.
   - [ ] It opens **every** time — no clicks are swallowed.
2. While a background cloud-sync is plausible (just after sign-in), click a site repeatedly.
   - [ ] Still opens reliably.

**What changed:** the saved-site Leaflet layer no longer rebuilds **while a pointer is
pressed** (it defers the rebuild to pointer-up), so a rebuild can't land between mousedown
and mouseup and eat the click. If you can still make it drop, note the exact sequence.

---

## ⬜ B65 — No white flash when zooming/panning the planner basemap  *(already mitigated)*
**Headless status:** ✅ mitigation in place — paper backdrop behind the basemap +
`keepBuffer:4` + animation-disabled `setView`. The flash itself can't be reproduced headless.

**Live check:**
1. Open a geolocated site (basemap visible), **zoom/pan hard and repeatedly**.
   - [ ] Any momentary gap shows **paper (cream)**, not white; no jarring white flash.

**If white STILL flashes:** that's the trigger to try the deferred (riskier) fix —
re-enabling a short zoom animation or double-buffering the tile swap — which must be
weighed against SVG-overlay desync. Note it here and re-open B65 in `BACKLOG.md`.

---

### Log
- 2026-06-16: B64, B65, B67 (increment 1) filed for live verification by a coworker.
