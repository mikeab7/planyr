# Planyr — Roadmap (not yet built)

Moved out of `CLAUDE.md` 2026-07-02. Read when planning new feature work.

## ROADMAP / NOT YET BUILT
Two parallel tracks now.

### Track 1 — Site Planner (continue maturing)
1. **GIS layer caching** — next immediate item. Stale-while-revalidate: load
   last-known-good copy instantly, refresh in background, always show data age,
   screening-only. Makes layers fast and resilient.
2. Tier 1 "site-killer" features: storm outfall *(split 2026-07-03: the detention
   rate-rules half shipped as **B636–B640** — versioned rules engine, required-vs-provided
   yield readout, DIA-tier, hydraulic regime, pond auto-size — plus watershed overlays
   **B642**; the flowline/design-tailwater sourcing half is **B641** in the backlog
   Later/Roadmap, its LiDAR-screening slice already shipped. Code/tests/branch keep the
   provisional B629–B635 labels — see the B636 note in BACKLOG-DONE.md)*, then sanitary sewer,
   fire flow, finished-floor-vs-base-flood, environmental screen (TCEQ LPST / EPA),
   entitlement/zoning status.
3. Tier 2: earthwork / cut-fill, soils.
4. Tier 3: swept-path, driveway access.
5. Tier 4: the buildable-area / cost verdict engine (reads the whole Site Model via
   `developableArea()`, currently a stub).

### Track 2 — Document Review (new module)
Build the **browser-only** tranche first (no backend, no credentials), then the
**backend** tranche.
- **Browser-only:** PDF review core (PDF.js viewer, multi-sheet nav, calibrate-to-
  scale, measure tools — distance/area/perimeter/count, basic redline, takeoff rollup
  into the yield panel) → semi-automatic match-line stitching → metes-and-bounds →
  polygon (parse calls incl. curves; flag unreadable calls; require one tie to the
  ground for the Point of Beginning).
- **Cloud persistence (DONE):** the browser-only tranche now saves/loads its reviews
  (single sheet + stitched sets, with their PDFs) to the **existing Supabase** backend
  — see DONE & VERIFIED. This reuses the user-data backend (Supabase), NOT the
  `/server` CAD/filing backend below; keep the two distinct.
- **Backend tranche** (needs `/server`; distinct from the existing Supabase backend):
  auto-filing + index → DWG conversion pipeline (LibreDWG → APS) → overlay & version
  compare → markup-list and flattened marked-up PDF export.
- **Auto-filing detail:** drop a file → read its title block → match against the 4
  named projects (+ aliases: address, parcel, job number) → auto-route and auto-name
  into a central drive (likely Google Drive). A lightweight index/database stores
  facts per file (project, discipline, sheet, revision, date) so files are queryable
  without re-reading them.

### Document Review — roadmap additions
- Drag-and-drop to open: drop PDF/drawing files onto the screen to load them for
  viewing (browser-only, low effort). NOTE: distinct from the auto-filing system
  (drop → read title block → file into Drive), which is the backend feature already
  on the roadmap. Two different things, two timelines.
- Multi-sheet stitcher: assisted alignment (built — `Stitcher.jsx`, 2-point pairwise
  align); **automatic match-line detection — BUILT (B337)**: drop a set → it auto-groups
  (B335) + auto-stitches from match-line labels + auto-calibrates (B339) + crops title
  blocks (B338); the 2-point manual Align stays the safety net (pre-seeded when a seam is
  detected). **Scanned sheets read via OCR too (B349).** The remaining CV tails (scale-bar,
  geometric edge-match, legend symbol-union) → B340. Near-automatic once DWG conversion lands.
- Revision compare: add a revision to a discipline set and compare the two
  (overlay/diff) — confirm against the existing overlay/version-compare item.
- ★ North-star: "map → drawings → latest set" — from the Site Planner map, click a
  project → Drawings → pick a discipline (e.g., Landscaping) → see the latest
  revision's full set, already stitched. Depends on the filing system + file index,
  the stitcher (the **auto-group + auto-stitch** half is now built — B335–B339), and
  project nav on the map. The convergence point; build once those exist.
