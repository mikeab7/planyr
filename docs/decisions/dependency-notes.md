# Dependency notes (client bundle)

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

### Dependency notes (client bundle)
Runtime deps are kept few and deliberate. **No new dependency for "open an uploaded Excel in Spreadsheet" (NEW-1, 2026-10-29):** it reuses ExcelJS (`lib/xlsxIO.js`), `fflate` (already the .docx unzipper) and the already-installed `xlsx` (SheetJS) — the last now ALSO read client-side, for old `.xls` files only, inside the lazy parse worker (`model/lib/spreadsheetWorker.js`), never in an eager chunk. New client dependency added 2026-07-10:
- **`three` (NEW-1, 2026-11-11, pinned `0.170.0` exact — the owner chose three.js for the 3D grading viewer)** — the WebGL renderer for the owner-only 3D cut-and-fill viewer, ~0.46 MB minified of the viewer's own ~0.49 MB lazy chunk (128 KB gzip). **Loaded ONLY by `lib/grading3d/threeScene.js` → the `Grading3DViewer` lazy chunk, opened by the map's "3D" button**; named imports only, our own orbit controls (no `three/examples`); the main bundle and the plan editor chunk carry none of it (repo-root `test/` **grading3dGate**; `node ui-audit/verify-grading-3d-bundle.mjs`). Justified over MapLibre's built-in terrain (one raster-dem surface from tiles, the map kept around it) because the viewer needs TWO surfaces from the plan's own grids in a black void. Never statically import it, never raise the Site-route limits for it.
- **`dxf-parser` (B747, ~380 KB, one transitive dep `loglevel`)** — parse-only DXF tokeniser used by
  the site-plan overlay's CAD import. Justified over hand-rolling: DXF group-code parsing has to
  survive many real-world exporter/version quirks, and a robust hand-rolled full parser fails the
  cost/benefit test. We hand-roll ONLY the entity→SVG rendering (the civil subset), never the parse.
  It's **parse-only** (no DOM), so it runs inside the DXF Web Worker, and it's imported lazily behind
  a `?worker` specifier + a dynamic `import()` in `openOverlayFile` — so the CAD parser never rides
  the initial planner bundle (loads only on the first `.dxf`/`.dwg` drop).
