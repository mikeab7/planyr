# shared/overlay — the ONE overlay engine (NEW-1)

Both overlay surfaces call this folder; storage and render targets stay split by owner decision
(Site tab: `sheetOverlays` in `sites.data` + the hand-rolled SVG canvas in the planner;
Map/Comps: the `site_plan_overlays` table + Leaflet). **Math, never storage, is shared.**

- `overlayCrop.js` — crop geometry: `{kind:'rect',x,y,w,h}` | `{kind:'poly',pts}` in IMAGE PIXELS; a
  missing `kind` reads as rect (migrate on read, never rewrite a row); absent crop = full image.
  `clipPathValueForCrop` (Leaflet/CSS) and `cropClipShapeScreen` (SVG) project it at render time only.
- **The crop SWITCH (NEW-2, 2026-10-21): `crop.off === true` keeps the shape and makes every consumer draw the whole sheet.** One gate — `activeCrop(o)` / `hasCrop(o)` (never test `o.crop` truthiness for "is the sheet clipped"); `cropClipShapeScreen`, `clipPathValueForCrop` and `effectiveCropRect` (so the handles / frame fit) all honour it, `normalizeCropShape` carries it, `withCropOff(crop, off)` flips it (ON drops the key), `hasSavedCrop` is "a shape exists, on or off", `cropOutlinePath` draws the panel picture's dashed outline. Additive: an old record has no key and behaves as before; both DB CHECKs allow the extra key, so there is no storage change. Guard: repo-root `test/` **overlayCropOff**.
- `overlayPlacement.js` — placement math. GEO half (`overlayCornersFromPlacement`, `imagePointToLatLon`,
  `latLonToImagePoint`, `scalePlacement`, `rotatePlacement`) and CANVAS half (`imagePointToWorld`,
  `scaleOverlayAbout`, `applySimilarityToOverlay`, `alignOverlaySimilarity`) share `rotateOffset` and
  `normalizeDeg`; every fit comes from the shared similarity-transform module (`geometry/`).
- Visible extent (NEW-2): `visibleFrame` / `visibleCenterPx` / `visibleCornersPx` + `anchorVisibleCentre` (canvas) / `anchorVisibleCentreGeo` (map) in `overlayPlacement.js` — the selection chrome of a CROPPED overlay fits the crop (poly → bbox) and scale/rotate pivot about its centre; stored scale/crop meaning unchanged.
- `overlayRaster.js` — raster sizing (DPI / long-edge caps, JPEG + thumbnail constants). the OCR PDF rasteriser and the Site tab
  image loader call it instead of mirroring it.

Guards (repo-root `test/`): the overlayEngineGolden suite (pins every export's output) and the
overlayEngineSingleSource suite (fails if a second copy of rotate / Procrustes / crop clip / dpi-cap appears), and the
ui-audit harness verify-overlay-engine-export-parity (hash of the real export, before vs after a change).
Canvas writes still go through the shared cloud write serializer — never route around it.

**NEW-7 (B2254630) — scale from the Map/Comps Adjust panel.** GEO half also has `anchorImagePointGeo(o, px, py, patch)` (scale/rotate keeping ONE image point fixed in lat/lon; `anchorVisibleCentreGeo` delegates to it) and `alignOverlayGeo(o, pairs)` ("Match 2 points": similarity fit in the placement's own State Plane frame, round-trips through `imagePointToLatLon`). The three actions' rules live in the sitePlans lib's overlayScaleGeo module (PDF px-per-inch, Set scale / Trace a length / Match), the click state in its dependency-free overlayCalibration leaf. Crop editing: right-click point rules (`nearestEdgeIndex`, `addPointAtNearestEdge`, `deletePointAt`) are here too; a saved crop carries ONLY its active shape from B2254628 on (renderers always read just the active `kind`).
