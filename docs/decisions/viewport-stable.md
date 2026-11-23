# Named rule VIEWPORT-STABLE

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **VIEWPORT-STABLE** — When a panel / rail / divider toggle changes a render surface's width or
  left/top edge, the surface must neither **JUMP** nor **FLASH**. **(a) Compensate against the
  MEASURED delta in a layout effect:** read the real DOM edge (e.g. `wrapRef.offsetLeft`) in a
  `useLayoutEffect` (before paint) and fold the exact delta into the view transform in the SAME frame
  as the reflow — never an ASSUMED width, never a passive (after-paint) `useEffect` (that skips the
  content sideways for one-plus frames). Measuring the real edge **self-gates**: overlay / portaled /
  right-side panels steal no layout width → zero delta → no shift. **(b) Buffer the surface across any
  resize-driven re-layout / re-raster / reload:** hold the current pixels (a ghost/buffer) across the
  reflow and drop them only when the new render is ready, so it never wipes to blank; fold any separate
  un-buffered relayout (or an un-rastered remount) into the buffered path. Precedents: the Leaflet
  basemap pan-compensation + tile ghost (**B837** `SitePlanner.jsx` `panelShiftRef` / geo `sizeChanged`;
  **B65** `geoGhostRef`) and the Doc Review sheet-rail compensation + stitch-return re-raster
  (**B838** `DocReview.jsx`).
