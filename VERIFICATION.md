# VERIFICATION.md — live-browser test checklist

Some changes pass every check we can run **without a browser** — `npm run lint`,
`npm test`, `npm run build`, and server-side endpoint calibration — but still need a
human (or a Claude coworker with a real browser) to confirm they actually work **in the
running app**. This file is the running list of those, so nothing that "builds green but
was never clicked" quietly ships broken.

> **Production app:** https://planyr.io (Cloudflare Pages, deploys from `main`).
> **This is the runtime counterpart to `BACKLOG.md`.** An item can be `[x]` done in the
> backlog and still ⏳ unverified here — the code landed; the click-through hasn't.

> ## ⚠️ Testing policy (updated 2026-06-17 — read this)
> **Michael does NOT click through to test things himself. Ever.** Don't wait on him, don't ask
> him to verify, don't end a turn expecting him to go look.
> **Claude self-verifies in a headless browser — in the same session, no separate "cohort."**
> A headless Chromium is available in the environment (see "🤖 Self-verification" below), so a
> session that ships a UI change should **drive the live app itself** and record the result rather
> than file the click-through for someone else. The working rhythm:
> - After a change is **CI-green + build-green**, **run the headless-browser check yourself**, then
>   record the outcome here (✅/❌ + date). Don't punt it.
> - **Only if no browser is reachable** (rare), log the item below and move on — never block on Michael.
> - **Do NOT surface "these N are unverified" to Michael as a to-do for him.**
> - **Only interrupt Michael for a genuinely CRITICAL problem** — the app won't build, won't render
>   (blank screen), or a shipped feature is visibly crashing in production. Everything else: note it
>   here, keep moving.
>
> ### 🤖 Self-verification — how (proven 2026-06-17 against planyr.io + per-branch preview URLs)
> Write a short Playwright script and run it with Node:
> - Browsers live at `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; the module is the global
>   `/opt/node22/lib/node_modules/playwright` (require it by absolute path).
> - The sandbox egress proxy intercepts TLS, so launch with `args:['--ignore-certificate-errors']`
>   **and** `newContext({ ignoreHTTPSErrors: true })`, or `page.goto` throws `ERR_CERT_AUTHORITY_INVALID`.
> - **Logged-out only:** that proxy also CORS-blocks the Supabase auth handshake, so self-tests run in
>   **this-device (logged-out) mode** — full coverage for the planner/drawing tools, but anything that
>   *requires* sign-in (cloud save/sync) still needs a signed-in check elsewhere.
> - Enter the planner via **"Start blank"**; drive the SVG canvas with `page.mouse` (CDP mouse events
>   fire React's pointer handlers); `page.screenshot({clip})` then read the PNG back to eyeball it.

---

## How to use this — Claude Code / coworkers, read on every run

1. **Scan the 🔲 list below** — items waiting to be confirmed in the running app. Per the testing
   policy above, do **not** hand this list to Michael as his to-do; only escalate a **critical**
   (won't build / won't render / crashing) issue.
2. **Verify it yourself in a headless browser** (see "🤖 Self-verification" above): run the
   **Steps**, compare to **Expect**, then record the outcome — flip ⏳→✅ (or ❌ with a note),
   set `Last checked`, and bump `Next check` by the `Cadence`. Prefer doing this in the same session
   that shipped the change.
3. **Only if no browser is reachable:** leave the item logged here and move on — don't block on
   Michael. Do **not** mark anything ✅ from reading the code — confirming-in-the-running-app is the
   entire point of this file.
4. **Endpoint-liveness items (tagged 🌐) are the exception** — a `curl`/REST probe, runnable
   without a browser. Run those when due.
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
- **Richer markup (increment 2c) — also verify:** in **Select**, **drag an existing markup** to
  reposition it (cursor shows move); **double-click a Text** markup to edit it. Click **Scale**,
  draw a line along a known dimension, enter its length in feet → then **Measure**: draw lines and
  confirm they label the **real length in feet** (teal chip); the scale + markups persist on reload.
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

### V11 — Phone layout (B113) + "Cloud off" affordance (B111) ⏳
- **Why ⏳:** verified headless at 390×844 (`planner-mobile.png`, `planner-mobile-tools.png`,
  `planner-mobile-panel.png`) but real touch + rotation want a live click-through.
- **Steps (B113, on a phone or a ~390px-wide window):** open a site in the planner. The canvas
  should fill the width (not a sliver). Tap the orange **"✎ Tools"** button (bottom-right) → the tool
  palette **slides in from the right**; pick a tool → it **auto-closes** so you can draw; tap the dim
  backdrop to dismiss it. Tap a left-rail button (Yield/Parcel/…) → its panel **overlays** the canvas;
  tap the same button to close. Rotate to landscape and back. The top header should **scroll
  sideways**, not wrap onto two lines.
- **Expect:** at desktop width everything is exactly as before (the mobile styles are width-gated).
- **Steps (B111):** load a build with **no Supabase env** (cloud unconfigured). The top-right account
  corner should show a muted **"⊘ Cloud off"** pill (not empty); click it → a popover explains work is
  saved on this device only. (A configured build still shows the normal Sign in / account button.)

### V12 — Site Planner measurement tools: Length / Polylength / Area (B116) ⏳
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-16
- **Steps:** Open a site in the Site Planner. Right rail → **Measure** (the `▾` opens the mode menu:
  **Length / Polylength / Area**). (1) **Length:** click two points → expect a teal line labeled the
  real distance in feet (e.g. `462′`). (2) **Polylength:** click several points along a path, then
  **double-click or Enter** to finish → expect the running path length in feet. (3) **Area:** click
  points around a region, close by clicking the first dot (or double-click) → expect a filled polygon
  labeled **`<sf> sf · <ac> ac · <perim>′ perim`** (e.g. `12,300 sf · 0.28 ac · 462′ perim`). Then
  with **Select**, click a measurement to select it and use the **×** to delete it. Press **Esc**
  mid-draw → the in-progress measurement cancels.
- **Calibration path:** drop an **aerial/screenshot** underlay but do **not** calibrate it → with the
  Measure tool active, expect the **"⚠ Underlay isn't calibrated — distances may be wrong"** banner and
  measurement labels rendered in **amber with a ⚠**. Calibrate the underlay (Aerial ▾ → Calibrate) →
  labels return to normal (teal) and read true feet.
- **Expect:** all three modes draw, label, select, and delete; labels persist across reopen + reload
  (signed in); the amber/⚠ uncalibrated warning behaves as above. This shipped code-verified +
  build-green (B116 was already implemented in `SitePlanner.jsx`; only the mode names were aligned to
  Length/Polylength/Area) — this step confirms it in the running app.
- **If it fails:** not critical (no data risk) — log ❌ here with what looked wrong.

### V13 — ★ Persistence: saved work must never disappear (B124 / B125) ⏳ — HIGH PRIORITY
- **Added** 2026-06-16 · **Cadence** once (data-safety acceptance) + on-change · **Last checked** — · **Next check** 2026-06-16
- **Why this matters:** this is the fix for the owner-reported data-loss scare — work vanishing on its
  own a couple minutes after a reload. Root cause: `pullCloud` rebuilt the local cache from the cloud
  list **alone** and silently dropped any not-yet-synced local site; the resume then couldn't find the
  open site and bounced to the map. Confirm in a real browser that saved work is now durable.
- **Steps (signed in, on planyr.io):**
  1. Sign in. Open or create a site, add a **building**; wait for the header badge to read **"Synced ✓"**.
  2. **Reload** → you **resume straight into the planner** on that site (NOT bounced to the map) and the
     building is still there.
  3. **Switch to another browser tab for ~2–3 minutes, then return** (refocus the Planyr tab) → the site
     + building must **still be there** and you are **not** bounced to the map. (This is the exact
     "disappears on its own" trigger — a background re-sign-in event firing the cloud re-pull.)
  4. **Forced not-yet-synced repro (DevTools):** Network tab → **Offline**. Add another building → a
     **loud red banner** ("your last change didn't reach the cloud … **Retry now**") appears and the badge
     reads Offline/Unsaved. **Reload while still offline** → the building is **still there** (not dropped).
     Go back **Online** → it syncs (badge → "Synced ✓") and the red banner clears.
  5. **On-device → account bridge:** while **signed out**, create a site (saved on this device only).
     **Sign in** → a blue banner "You have N site(s) saved on **this device** that aren't in your account
     yet" appears; click **"Bring them into my account"** → the site joins the account list and the banner
     clears. The signed-out copy is **kept** (non-destructive).
- **Expect:** work **never disappears on its own**; reload resumes the open site; a failed cloud save is
  **loud** (red banner + Retry), never silent; the on-device import copies sites into the account without
  deleting the originals. No data is lost across reload, tab-refocus, offline, or sign-in/out.
- **If it fails:** this is the one **CRITICAL** class — if saved work still vanishes, flag it immediately
  (note the exact step + the browser console), don't just log-and-move-on.

### V14 — Draw-tool rail: scrolls to the bottom on desktop + denser rows (B117 / B118) ⏳
- **Added** 2026-06-16 · **Cadence** once (fix acceptance) · **Last checked** — · **Next check** 2026-06-16
- **Steps:** Open a site in the Site Planner on a normal laptop-height window (a ~13–15″ screen is the case
  that overflowed — not a tall external monitor). Look at the dark right-hand tool rail (**Tools / Site
  elements / Shapes / Measure / Annotate**). (1) **Reach the bottom (B117):** scroll the rail → expect it to
  scroll cleanly all the way to the last row, so the **Shapes** group and **Measure / Annotate** below it are
  reachable; nothing is stranded off-screen with no scrollbar. (2) **Density (B118):** the two-line buttons
  (Building / Car Parking / Road / Paving / Trailer Parking / Detention Pond, plus Measure) read tighter —
  less vertical padding and the small grey sub-label ("single-load", "drive / court", "24′ travel",
  "back-in storage", "detention basin") one step smaller — and the whole **Site elements** group should now
  fit without scrolling on a standard laptop.
- **Expect:** every tool in the rail is reachable at any window height; the rail reads as one consistent,
  denser column with rows still comfortably clickable (~40px); the **▾** preset menus (dock layout / parking
  rows / road width / measure mode) still open and pick correctly. The phone layout (narrow width, B113) is
  unchanged — the rail still slides in as an overlay there.
- **If it fails:** not critical (no data risk) — log ❌ here with the window height and what was unreachable or mis-sized.

### V15 — ★ Persistence ROOT FIX: a thinner copy can't erase a fuller one + Version history (B126) ⏳ — HIGH PRIORITY
- **Added** 2026-06-16 · **Cadence** once (data-safety acceptance) + on-change · **Last checked** — · **Next check** 2026-06-16
- **▶ Full step-by-step script:** **`PERSISTENCE_TEST_SCRIPT.md`** (T1–T11, with paste-in Console helpers and a results table) — run that end-to-end and record the outcome back here. The summary below is the short form.
- **Why this matters:** B124 stopped whole *sites* vanishing, but buildings could still disappear *inside* a
  site because sync kept whichever whole copy was saved last — so a copy with fewer buildings could overwrite
  a fuller one (a stale tab, a second device, a hiccup mid-load). B126 makes sync **merge** the two copies
  (every building in either is kept) and adds **automatic local backups** you can restore from.
- **Steps (signed in, on planyr.io):**
  1. **Merge keeps both (two-tab test — the headline):** open the same site in **two browser tabs**. In tab A
     add **building X**; in tab B (don't reload it) add **building Y**. Let both reach **"Synced ✓"**.
     **Reload both tabs** → **both X and Y are present** in each — neither tab's copy erased the other's.
  2. **Version history restore:** **Plan ▾ → Version history…** → a dialog lists earlier automatic backups
     (timestamp · N buildings). Click **Restore** on an earlier one → the canvas returns to that version and
     re-saves. Re-open Version history → the version you just replaced is now **also** listed (a restore is
     itself reversible).
  3. **De-dupe sanity:** make a few edits that change the building/element count → each appears as its own
     version; a pure move (no count change) does **not** spam a new version.
- **Expect:** a building drawn in any copy is **never lost to a sync**; the count never silently drops; Version
  history lists and restores prior versions, reversibly. (Backdrop aerials/images may need re-dropping after a
  restore — geometry is always restored in full.)
- **If it fails:** **CRITICAL** class (data) — if a building still disappears on a sync/reload, flag it
  immediately with the exact step + browser console; do **not** log-and-move-on.
- **Update 2026-06-16 (B127):** the first run found **no data loss** but one rough edge — two open tabs
  could **disagree until reload** (the durable store briefly held the thinner copy). That's now **fixed**:
  a stale tab's save **folds into** the store (never thins it) and open tabs **live-sync** via `storage`
  events. **Re-run T5/T6 to confirm:** (a) after the two-tab divergent edits, **both tabs converge while
  still open** (no reload needed), and (b) the durable `sites:v1` always holds the **union** (never the
  thinner copy), so any reload shows the full set.

### V16 — Rail/header dropdowns open fully visible, not clipped behind the rail (B127) ⏳
- **Added** 2026-06-17 · **Cadence** once (fix acceptance) · **Last checked** — · **Next check** 2026-06-17
- **Why:** the Measure mode menu (and the other rail/header flyouts) used to paint **behind / clipped by** the
  tool rail after B117 made the rail scroll (`overflow:auto`). Fix = render every such menu in a **portal** at the
  document root (`src/shared/ui/AnchoredMenu.jsx`), so it escapes the rail's clipping + stacking context. Needs a
  real browser to confirm it now floats above everything and still picks correctly.
- **Steps (planyr.io, desktop):** Open a site in the Site Planner.
  1. **Measure ▾** (the caret next to the Measure tool's mode label) → the menu opens **fully visible**, above the
     rail **and** above the map's +/– zoom-control rail to its left; **Length / Polylength / Area** are all clickable
     and selecting one updates the tool's sub-label. (This is the exact NEW-3 repro.)
  2. Repeat for the other rail flyouts — **Boundary ▾**, **Building ▾** (dock layout), **Car Parking ▾** (rows),
     **Road ▾** (width): each opens to the left of the rail, fully on-screen, nothing clipped; picking an option works.
  3. Header menus — **Site ▾**, **Plan ▾**, **File ▾**: each opens below its button, fully visible above the canvas;
     typing in the Site/Plan **name field** still works (focus lands in the input); **File ▾ → Import JSON…** still
     opens the file picker.
  4. **Click-away + scroll:** clicking anywhere off an open menu closes it; with a menu open, the rail can't be left in
     a half-open state. On a **short laptop-height window**, the menus still land on-screen (clamped into the viewport),
     not cut off at the top/bottom.
  5. **Phone width (~390px):** open the slide-in tool rail (✎ Tools) → Measure ▾ still opens above everything and is
     usable.
- **Expect:** no dropdown is ever clipped or hidden behind the rail / zoom rail; all open above the map; every option
  selects; placement + widths look the same as before (just no longer cut off).
- **If it fails:** not critical (no data risk) — log ❌ here with the menu, window size, and what was clipped/mispositioned.

### V17 — Parking hugs the building: orientation + outward growth (B119 / B120) ⏳
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-16
- **Steps:** Open a site, draw a **building**, select it, and add a **parking** row on one side (the
  per-side "add parking" control). (1) **Orientation (B119):** the **first stall row should sit directly
  against the building face**, with the **24′ drive aisle on the outside** (not the aisle against the
  wall). (2) **Growth (B120):** press the parking **＋** repeatedly — the field should grow **outward,
  away from the building**, one row at a time, depth reading **42 → 60 → 102 → 120 → 162 → 180′**
  (double-loads the aisle before adding a new one); **−** reverses it. (3) The element panel's **"Drive
  aisle on the far side"** checkbox should start **checked** and still flip the layout if unticked.
- **Expect:** stalls hug the wall, aisle outboard, field grows away from the building, +/− steps match the
  sequence. Shipped code-verified + build-green (152 tests pass); this confirms it on screen.
- **If it fails:** not critical (no data risk) — log ❌ here with what looked wrong.

### V18 — Auto-numbered building labels: "Building N" + renumber-on-delete (B122) ⏳
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-16
- **Steps:** Open a site in the Site Planner. Place a **Building** → its label reads **"Building 1"**
  (above its sf and dimensions). Place a second and third → they read **"Building 2"** then
  **"Building 3"** in placement order. Now **delete "Building 2"** → expect the old "Building 3" to
  re-label **immediately** as "Building 2" (numbers stay contiguous 1…N, no gap). Add another → it
  appends as the next number. A site with a **single** building still reads "Building 1".
- **Identity check (the important one):** give a building attached **parking** or a **bump-out**, then
  delete a *lower-numbered* building so this one renumbers. Confirm the attached pieces stay attached and
  nothing re-points — attachment binds to the hidden stable id, not the visible number, so a renumber
  must never detach or mis-link anything.
- **Expect:** every visible building label updates in one pass on delete; non-building elements
  (car parking, paving, roads, detention ponds, sidewalks) are unaffected; bump-out pieces don't get
  their own number. Shipped code-verified (139 tests) + build-green; this confirms it in the running app.
- **If it fails:** not critical (no data risk) — log ❌ here with what looked wrong.

### V19 — Site element labels: no overlap pile; level-of-detail on zoom-out (B121 increment 1) ⏳
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-16
- **Steps:** Open a site and lay out adjacent elements (a big building, a narrow trailer strip beside it,
  a detention pond, a couple of sidewalks). (1) **Zoomed in:** each element shows its full centred label
  (name + sf/count + dimensions) as before. (2) **Zoom out:** labels should *thin out*, not pile up — the
  dimensions line drops first, then the area line, leaving the name; the **narrow trailer strip** should
  drop to just its name (or hide) rather than spilling a 3-line label past its ~50′ width. (3) **Crowd
  test:** push several labelled elements close together and confirm their centred labels no longer
  overprint into an unreadable stack — a lower-priority label yields (shrinks or disappears) to the
  bigger / building label rather than stacking on top. Zoom back in → the hidden labels return.
- **Expect:** no two centred element-name labels overprint at any zoom; buildings / bigger elements keep
  their labels; nothing crashes; non-labelled elements (paving / parking / roads) are unaffected.
- **Known-not-yet (increment 2 — do NOT fail for these):** the **red edge-dimension ticks** ("300′",
  "638′") are still a separate layer and may overlap the centred names; no leader lines yet. Tracked under B121.
- **If it fails:** not critical (no data risk) — log ❌ here with what looked wrong (especially a label
  that vanished when it had room, or a pile that remained).

### V20 — GIS layers survive a CORS-blocked health-check (B129 / PR #60) ✅
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** 2026-06-17 (real Chromium/Playwright on planyr.io) · **Next check** —
- **Result 2026-06-17 — VERIFIED in a real browser.** See the full evidence in **B129** (now Done):
  - **FEMA flood zones — renders.** `/export?f=image` → HTTP 200 `image/png`; the `<img>` paints the
    standard NFHL symbology (teal Zone AE / orange floodway / red boundaries) along the bayous; host is
    CORS-clean (`Access-Control-Allow-Origin` on metadata, `/export`, and the OPTIONS preflight). **Caveat:**
    NFHL 27/28 are source-gated to `minScale ~1:36,112`, so flood zones only draw at ~zoom 14+; at
    city-wide zoom the export is a blank transparent PNG (expected, not a failure).
  - **Wetlands (NWI) — does NOT render, but the cause is an agency OUTAGE, not CORS.** The USFWS host
    returns **HTTP 500 across its whole catalog** (confirmed three ways). PR #60's resilience held up — the
    app stays alive and shows a quiet per-layer "failed" dot; no alarming toast, no dropped-layer cascade.
    The message text is now honest ("service is not responding…") instead of esri's misleading CORS line.
- **RESOLVED by B133 / V26 (2026-06-17):** rather than wait for `fwspublicservices` to recover, NWI was pointed
  at the live sibling raster host `fwsprimary.wim.usgs.gov` and **verified rendering in a real browser** — see V26.
  (The old `fwspublicservices` host is still 500; this trigger is superseded.)

### V21 — Building label is a 4-line stack; square footage persists on zoom-out (B123) ⏳
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-16
- **Steps:** Open a site, draw a **building** (rectangle), and add a **bump-out** or two (the purple ＋ at a
  dock corner). Its label should read as a 4-line stack: **"Building N"** / **"198,000 sf"** (its own line) /
  **"(incl. 2 bump-outs)"** / **"300′ × 638′"**. (1) **Wording:** the bump-out line reads **"(incl. 2
  bump-outs)"** — not the old "+2 bump-outs" — and there is **no** parenthetical line on a building with no
  bump-outs. (2) **Zoom out:** the **dimensions** line drops first, then the **(incl. …)** line, leaving
  **name + square footage** down to fairly small sizes; the square footage should **outlast** the dimensions
  (the old behavior dropped sf too early). Only at extreme zoom-out does it fall back to just the name.
- **Expect:** square footage no longer vanishes early; the 4 lines appear in that order; the parenthetical is
  conditional; the sf matches the yield panel's building total. Non-building labels are unaffected.
- **If it fails:** not critical (no data risk) — log ❌ here with what looked wrong (e.g. sf still dropping
  before the dimensions, or wrong wording).

### V22 — Red edge-dimension callouts hide when zoomed out (B121 round 2a) ⏳
- **Added** 2026-06-16 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-16
- **Steps:** Open a site with a building / road / paving element (these carry the red short-side dimension
  tick, e.g. "300′" / "24′"). (1) **Working zoom:** the red dimension callout shows exactly as before.
  (2) **Zoom out** until the site is small on screen → the red dimension ticks **drop away** (rather than
  shrinking into illegible marks that overlap the centred name labels). (3) **Zoom back in** → they return.
- **Expect:** at normal/zoomed-in working zoom nothing changed; only when zoomed out (past ~0.18 px/ft) do the
  red dimension callouts hide. The centred name/sf labels are governed separately (B121 increment 1) and are
  unaffected by this gate.
- **Known-not-yet (do NOT fail for these):** at working zoom the dimension callouts can still overlap a
  centred name on very crowded layouts (not yet in the collision pool), there's no explicit show/hide toggle,
  and no leader lines — all tracked under B121 increment 2.
- **If it fails:** not critical (no data risk) — log ❌ here (e.g. dims vanishing at working zoom = threshold
  too high; still piling when zoomed out = gate not applied).

### V23 — Warning toasts: a newer message isn't blanked early by an older one (B56b) ⏳
- **Added** 2026-06-17 · **Cadence** once (bugfix) · **Last checked** — · **Next check** 2026-06-17
- **Steps:** Trigger two bottom-banner warnings in quick succession. (1) Pop a long one (finish a metes/POB
  **encumbrance** plot, ~9 s banner) then immediately a shorter one (e.g. Calibrate with no underlay, or start a
  utility route with no building) — confirm the **second message stays up its own full time** and isn't wiped a
  few seconds early by the first one's timer. (2) Open a sticky instructional prompt right after a transient
  warning (utility routing → **"Now click the building to serve."**) — it should **persist until you act**, not
  auto-clear from the prior timer. (3) Start a ditch **cross-section**, then click again to begin a second while
  the first is still sampling — the second click is ignored (no double run / flicker).
- **Expect:** the visible warning always reflects the latest message for its own duration; sticky prompts persist
  until the next action; no cross-section double-run.
- **If it fails:** not critical (cosmetic/UX, no data risk) — log ❌ here with what looked wrong.

### V24 — "Print overlay" toggle includes the site-plan overlay in the print/export, exactly as shown (B131) ⏳
- **Added** 2026-06-17 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-17
- **Steps:** Open a site, left rail → **Overlay** → drop a site-plan PDF and place / scale / rotate it (set
  opacity < 1 so the aerial shows through). Export menu → **Print / pick frame…**. In the print-frame toolbar,
  confirm a **"Print overlay"** checkbox appears between Orientation and Print (and is **absent** when no overlay
  is loaded). (1) Leave it **checked** → **Print** → the overlay appears in the print/PDF preview at the **same
  position, scale, rotation and opacity** as on screen, **above** the aerial, with **no** selection handles or
  outline. (2) Re-open, **uncheck** it → **Print** → the overlay is gone but parcels / massing / metrics print
  normally. (3) Repeat with an **aerial underlay** present (open a parcel from the map first) — the overlay is
  honored both ways (it used to silently vanish whenever an underlay existed). (4) Export menu → **Export PNG** →
  the visible overlay is included in the image.
- **Expect:** checkbox shown only when an overlay is loaded; defaults to match on-screen visibility (checked);
  checked = WYSIWYG overlay in the output; unchecked = no overlay; editor chrome (handles, the "re-add me"
  placeholder) never prints; PNG export includes the visible overlay.
- **If it fails:** not critical (export-only, no data risk) — log ❌ here with what looked wrong (overlay missing
  when checked, handles printing, or wrong position / scale / rotation / opacity).

### V25 — Detention pond expansion: lock-as-existing baseline + storage gained (B132) ⚠️ SUPERSEDED by V30 / B139
- ⚠️ **Superseded 2026-06-17 by V30 / B139.** The "Lock as existing pond" button this verified was replaced by the **"Expand this pond"** mode (B139) — that exact flow no longer exists. The detention math + dashed ghost it checked live on and were re-verified under V30. No action; kept for history.
- **Added** 2026-06-17 · **Cadence** once (feature acceptance) · **Last checked** — · **Next check** 2026-06-17
- **Steps:** Open a site, draw a **Detention Pond** (rectangle or click-points irregular). Select it → the right
  panel's **Detention storage** section now ends with a **"Lock as existing pond"** button. (1) Click it → a toast
  confirms the lock and a faint **dashed ghost** of the current outline appears under the pond. (2) Drag a corner /
  edit a vertex to **enlarge** the footprint (and/or raise **Total depth**) → an **"Expansion vs. existing"** box
  shows **Existing storage**, **Proposed storage**, and a green **"Storage gained +X.XX ac-ft"** (plus cf) that
  updates live as you drag. (3) **Shrink** the pond below the baseline → the line flips to red **"Storage lost"**.
  (4) **Clear** → ghost and the comparison box disappear; depth/freeboard/slope are retained. (5) Save, reload the
  site → the locked baseline (ghost + numbers) persists. (6) **Rotate** the pond before locking, then enlarge → the
  ghost stays aligned to the real (rotated) original outline, not offset.
- **Expect:** the gain equals proposed − existing computed with the SAME depth/slope method (so it's apples-to-
  apples); ghost lands exactly on the original outline for both rectangle and irregular ponds, rotated or not;
  numbers and ghost survive reload; "screening only — confirm with your civil engineer" caveat shown.
- **If it fails:** not critical (screening estimate, no data-loss risk) — log ❌ here with what looked wrong (ghost
  offset/rotated, gain number not updating, baseline lost on reload).

### V26 — NWI wetlands restored from the live `fwsprimary` raster host (B133) ⚠️ SUPERSEDED by V27
- ⚠️ **Superseded 2026-06-17 by V27 / B135.** This verified the raster *renders + 200 + CORS*, but the source
  was a **100 m-per-pixel raster**, so in real use wetlands painted as coarse **blocks**, not true shapes (owner-spotted).
  B135 switched to the crisp **vector** MapServer; see **V27**. Kept here as the honest record of what shipped first.
- **Added** 2026-06-17 · **Cadence** once (bugfix acceptance) · **Last checked** 2026-06-17 (real Chromium/Playwright — esri-leaflet imageMapLayer over Sheldon Lake) · **Next check** —
- **Result 2026-06-17 — VERIFIED in a real browser.** Follow-up to B129 / V20 (the NWI outage). The old
  `fwspublicservices` host is **still HTTP 500**; the live data the official USFWS Wetlands Mapper draws sits on the
  sibling host **fwsprimary.wim.usgs.gov**, but at a different path **and as a pre-rendered RASTER ImageServer**
  (`/server/rest/services/Wetlands_Raster/ImageServer`), not the old dynamic vector MapServer — so the fix is an
  esri **imageMapLayer** (`kind:"esriImage"`, like 3DEP), **not** the one-line host swap the hand-off assumed.
  - **Renders.** esri-leaflet's `imageMapLayer` paints the standard NWI symbology (navy open water = Sheldon Lake,
    greens = vegetated wetlands) over Sheldon Lake at zoom 14 — screenshot `gis-verify/wetlands-fwsprimary-verified.png`.
  - **Network 200.** the `exportImage` request → HTTP **200 `image/png`**; the service metadata fetch → **200** JSON.
  - **CORS-clean cross-site (the flagged 403 risk DISPROVEN).** the host **reflects any Origin** in
    `Access-Control-Allow-Origin` (verified for `https://planyr.io`, localhost, and an arbitrary origin), so it loads
    from our origin with no refusal. The earlier out-of-band 403 did not reproduce.
  - **Reproduce:** `node gis-verify/wetlands-verify.mjs` (serves `gis-verify/wetlands-verify.html` from the repo
    root on :8000; uses the installed esri-leaflet, identical to the app). NB: this sandbox's egress proxy MITMs TLS
    with an "Anthropic Egress Gateway" CA the bundled headless Chromium doesn't trust, so the driver sets
    `ignoreHTTPSErrors` — an **environment artifact only**; real planyr.io users reach fwsprimary's genuine public
    USGS cert directly, no proxy.
- **Re-check trigger (🌐, no browser needed):** `curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: https://planyr.io'
  'https://fwsprimary.wim.usgs.gov/server/rest/services/Wetlands_Raster/ImageServer/exportImage?bbox=-10597000,3485000,-10589000,3493000&bboxSR=102100&imageSR=102100&size=10,10&f=image'`
  should return **200**. If it 500s/403s, NWI is down again and the B129 honest "service unavailable" path covers it.

### V27 — NWI wetlands render as crisp VECTOR polygons (Mapper look), not raster blocks (B135) ✅
- **Added** 2026-06-17 · **Cadence** once (bugfix acceptance) · **Last checked** 2026-06-17 (real Chromium/Playwright — esri-leaflet dynamicMapLayer over Sheldon Lake) · **Next check** —
- **Result 2026-06-17 — VERIFIED in a real browser.** Fixes V26/B133's coarse-raster blocks. The crisp vector
  polygons the official Mapper draws live in the staging service `…/server/rest/services/Test/Wetlands_gdb_split/MapServer`
  (layer 0 empty; data in layer 1 = CONUS_East, layer 2 = CONUS_West). `STATEWIDE.wetlands` is now a `kind:"dynamic"`
  esri **dynamicMapLayer** with `layers:[1,2]`, like FEMA.
  - **Renders crisp.** the `…/export?…layers=show:1,2&f=image` request → HTTP **200 `image/png`** with **true-shape
    polygons + NWI class labels** (PFO1A / PSS1A / PUBH…), navy open water = Sheldon Lake — screenshot
    `gis-verify/wetlands-fwsprimary-vector-verified.png`. No 100 m blocks.
  - **CORS-clean** (echoes `Access-Control-Allow-Origin: https://planyr.io`); metadata fetch → 200 JSON.
  - **Reproduce:** `node gis-verify/wetlands-verify.mjs` (vector variant). Same egress-proxy `ignoreHTTPSErrors`
    caveat as V26 — environment artifact only; real planyr.io users hit the genuine USGS cert directly.
  - **Confirmed in the LIVE app — planyr.io, not just a test harness (2026-06-17):** drove production headless
    (`node gis-verify/app-live-verify.mjs`) — ticked **Wetlands (NWI)** in the Layers panel and zoomed to NE Houston.
    Every wetland request the app issued went to the new **Wetlands_gdb_split** vector source (NOT the old raster, so
    the deploy is fresh) and returned **200** (metadata JSON + multiple `/export` `image/png` tiles, up to ~52 KB), and
    the map painted crisp labeled polygons (PFO1A / PSS1A / PUBHh) + blue open water with the USFWS credit — screenshot
    `gis-verify/app-wetlands-planyrio.png`. So production is wired to the vector source and renders end-to-end.
- **Re-check trigger (🌐, no browser needed):** `curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: https://planyr.io'
  'https://fwsprimary.wim.usgs.gov/server/rest/services/Test/Wetlands_gdb_split/MapServer/export?bbox=-10594500,3487000,-10591500,3490000&bboxSR=102100&imageSR=102100&size=10,10&layers=show:1,2&f=image'`
  should return **200**. **Also watch the `Test/` path** — it's USFWS staging and may be renamed when their production
  `Wetlands/MapServer` is repopulated; if this 404/500s, NWI shows the honest "service unavailable" (B129) until re-pointed.

### V28 — ★ Boot fix: no stale-plan flash on reload; signed-in resume shows the latest (B134) ⏳ — HIGH PRIORITY, SIGNED-IN ONLY (the "limit")
- **Added** 2026-06-17 · **Cadence** once (data-display acceptance) + on-change · **Last checked** — · **Next check** 2026-06-17
- **Why a signed-in coworker must run this — the one thing this session could NOT self-verify.** The fix lives entirely on the **signed-in boot path**: `SitePlannerApp` bumps a `loadEpoch` after `applyUser`'s `pullCloud`, folded into the planner's `key`, so the keyed planner re-reads the freshly-merged cloud copy instead of lingering on the stale pre-auth one. Per the testing policy at the top of this file, the sandbox egress proxy **CORS-blocks the Supabase auth handshake**, so the in-session headless run is **logged-out only** — it confirmed the build (lint 0 · 197 tests · build green) and that logged-out behavior is byte-identical (the fix is gated to the signed-in branch; `loadEpoch` stays 0), but the actual signed-in resume can't be exercised here.
- **Already confirmed live (no browser):** shipped via **PR #103** → `main` and **deployed** — planyr.io serves `index-DVWCJQ1q.js` / `SitePlannerApp-BUX0faXJ.js`; cloud still ON (Supabase URL baked in); Version history + "Retry now" intact.
- **Steps (SIGNED IN, on planyr.io):**
  1. Sign in. Open a site and add several **buildings** so the plan is materially bigger than its last cloud copy; wait for the header badge to read **"Synced ✓"**.
  2. **Hard-reload** (`Ctrl+Shift+R`) — several times — watching the canvas the instant it paints.
  3. **Expect:** it resumes **straight into the latest plan** (full building count) with **no flash of an older/thinner version first** and **no bounce to the map**. (The bug being fixed: a split-second older copy painted on load, then "came back on its own.")
  4. **"Disappears on its own" trigger:** switch to another tab for ~2–3 min, then return / refocus the Planyr tab → still the latest plan, no flash, no bounce.
  5. **Two-source sanity:** if this device's local cache holds a thinner copy than the cloud, boot must still end on the **fuller merged** copy, never the thin one.
- **Expect:** at no point does an older / thinner plan appear, even for one frame; the resumed plan is always the newest merged copy. This is the **display half (cause #5)** of the persistence data-loss work.
- **If it fails:** **data-display class** — if an older plan still flashes or sticks on reload, record the exact step + the browser console + whether the badge read "Synced ✓" first, and flag it (don't log-and-move-on).
- **Cross-refs:** **V13 / V15** (the durability halves — B124 / B126, work must never actually disappear), **B134** (this fix's item — its causes #3/#4, work that never reaches any store, remain open), **B125** (the still-open honest save-status / `beforeunload` guardrail for that never-saved case), **B136** (the one-time SCHIEL recovery).

### V29 — Fort Bend parcels are clickable, not just visible (B137) ✅
- **Added** 2026-06-17 · **Cadence** once (bugfix) · **Last checked** 2026-06-17 ✅ · **Next check** done
- **✅ VERIFIED LIVE 2026-06-17 on planyr.io** (headless Chromium, logged-out). Geocoded to Sugar Land (Fort
  Bend), entered **Select parcels**, clicked a lot → it **selected on the first click**: the selection card
  read **"1 parcel · 0.34 ac · Highway 90A"** with the orange highlight, and **"No parcel right there" never
  fired**. The browser console confirmed `gis.fbcad.org/serverarcgis2/.../layers` was **CORS-blocked /
  unreachable** (FBCAD down, as at fix time) — so the lot selected **purely via the statewide TxGIO fallback**,
  which is exactly the B137 fix. Screenshot evidence captured. (Signed-in county-label relabel — B36a / V3 —
  still rides the same code path; not re-exercised here since auth is CORS-blocked in the sandbox.)
- **Steps:** Map view → "＋ Select parcels" → pan to a **Fort Bend** area (e.g. Sugar Land / Rosenberg /
  Richmond) and zoom in until purple parcel outlines paint. (1) Click directly on a lot → it should
  **select** (orange highlight + the selection card shows acreage), NOT pop "No parcel right there." (2)
  Click it again → it deselects. (3) Confirm a **Harris** lot still selects exactly as before (no regression).
  (4) Plan the selected Fort Bend lot → the planner hand-off should record **county = fortbend** (the B36a
  relabel runs because the hit came via the statewide TxGIO layer).
- **Expect:** any displayed Fort Bend outline is selectable; Harris unchanged; the saved site's county reads
  Fort Bend. Works even though FBCAD's own host may be down — the statewide TxGIO layer answers the click.
- **Note:** FBCAD (`gis.fbcad.org/serverarcgis2`) was returning HTTP 503 at fix time; if it comes back up the
  county CAD will answer first and TxGIO stays the fallback — either way the lot must select.
- **If it fails:** if a clearly-outlined Fort Bend lot still won't select, that's a real regression — log ❌
  here with the coordinate; otherwise note what looked off (no data risk).

### V30 — Detention pond "Expand this pond" mode (B139) ✅
- **Added** 2026-06-17 · **Cadence** once (feature acceptance) · **Self-verified 2026-06-17** (headless Chromium, logged-out preview build) · supersedes V25
- **Steps (driven):** Start blank → draw a Detention Pond → select it. (1) Panel shows a primary **"Expand this pond"** button (no "Lock as existing pond"), footprint reads **Width / Length** (not Depth), and the generic lock now reads **"📌 Pin"**. (2) Click **Expand this pond** → enters mode ("EXPANDING · EXISTING LOCKED"), a dashed ghost appears, steppers **Push banks out (ft)** / **Dig deeper (ft)**, Existing/Proposed rows, **Storage gained +0.00 ac-ft**, Reset/Done. (3) Push banks out 40′ → footprint grows uniformly with the ghost inset evenly on all four sides → **+18.33 ac-ft**. (4) Dig deeper +6′ → **85.17 ac-ft**. (5) Reset to existing → gain 0, stepper 0. (6) Done → exits mode, "Expand this pond" returns, pond keeps the new size. (7) 📌 Pin → toggles to 📌 Unpin.
- **Expect:** every step above; gain = proposed − existing via the same depth/slope math; zero console/page errors.
- **Result 2026-06-17 — ✅ PASS.** All steps observed in the running app (screenshots captured); zero console/page errors. Residual: a **signed-in** pass that the baseline/ghost survive a cloud reload (sandbox runs logged-out) — low risk, it rides on the existing `el.det` persistence.

---

## ✅ Verified / ❌ Failed — history
_Move items here with the date and who/what checked them._

### V24 — Parking "Split rows/aisles": double-loaded modules, not single rows (B130) ✅
- **Added** 2026-06-17 · **Checked** 2026-06-17 — self-verified, headless Chromium (first run of the
  in-session self-verification flow above) · **Cadence** once
- **Steps:** Loaded the branch-preview build (= the code now on `main`) and **planyr.io** in headless
  Chromium → "Start blank" → planner → drew a Car Parking field with the mouse → selected it → read
  the panel + button text → clicked **"Split rows/aisles"** → zoomed in and screenshotted the striping.
- **Result ✅:**
  - Button reads **"Split rows/aisles"**; the old **"Split into rows"** label is gone.
  - Panel reports the right defaults — **510 stalls @ 9′×18′, 90°, 24′ aisle**.
  - Zoomed view shows the **double-loaded** pattern: stall rows pair around one **shared dashed drive
    aisle** (an aisle every *other* gap), not one aisle per row.
  - App loads cleanly (HTTP 200) on both planyr.io and the preview; the split runs without errors.
  - Backed by 10 unit tests (`test/parking.test.js`) on the split math.
- **Not covered (tracked in `BACKLOG.md` B130, still open):** free-field longest-edge auto-orientation;
  the fuller curb rule. Sign-in paths untested (proxy blocks auth — logged-out run).

### V25 — Parking B130 follow-ons: free-field orientation + full-perimeter curb (B130) ✅
- **Added** 2026-06-17 · **Checked** 2026-06-17 — self-verified, headless Chromium (local preview of the built artifact) · **Cadence** once
- **Steps:** "Start blank" → planner → zoomed in → drew a **tall** Car Parking field (item 2), drew an **isolated** field and split it (item 3); screenshotted at high zoom.
- **Result ✅:**
  - **Item 2:** a tall-drawn field runs its stall rows + dashed aisles along the **long (vertical) edge** (double-loaded), not short stacked rows.
  - **Item 3:** an isolated pad shows a grey **6″ curb band around the full perimeter** (confirmed at high zoom on a corner); a split field stays **continuous with no curbs at the internal seams**.
  - Backed by 6 unit tests (`edgeAbutsPaving`) · lint 0 · 191 tests · build green.
- **Decision recorded:** no curb against the bare building face (B70 stands; owner-confirmed 2026-06-17). Sign-in paths untested (proxy blocks auth — logged-out run).
