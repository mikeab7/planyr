/* roadNamesSnapshot — the Site Plan map's road lines + road names, rendered ONCE for a printed sheet (owner, 2026-11-25: public street
 * names "don't show up on the exhibit … let's not even make a toggle … have it match whatever is on the site plan").
 *
 * On screen those names are vector (MapLibre GL inside Leaflet, `vectorLabelLayer.js`), drawn on a WebGL canvas the export's SVG clone
 * cannot capture. So the sheet renders its own copy: a throwaway, off-screen MapLibre map with the SAME style (`buildVectorStyle`,
 * mode "site") framed on exactly the sheet's extent, at the SHEET's scale (the label tier's `labelPpf`, "the sheet as it reads at 100%
 * on a monitor"), with `pixelRatio` > 1 so the text is print-crisp. Its pixels come back as a transparent PNG plus the exact lon/lat
 * box they cover, which the export places in the plan's feet frame like the aerial.
 *
 * Pure planning (`roadNamesSnapshotPlan`) is split from the browser work so the scale maths is unit-tested. */
import { VECTOR_SOURCE, SITE_ROADS_FROM, VECTOR_ZOOM_OFFSET } from "./basemaps.js";
import { buildVectorStyle, absoluteGlyphsUrl } from "./vectorStyle.js";

const EARTH_CIRC_M = 40075016.686;
const FT_M = 0.3048;
/* WebGL drawing buffers above ~4096 px a side are refused or silently downscaled on many GPUs. */
export const SNAPSHOT_MAX_DEVICE_PX = 4096;
/* Never render text softer than 2× or heavier than 4× the CSS size. */
const MIN_PR = 2, MAX_PR = 4;
export const SNAPSHOT_TIMEOUT_MS = 20000;

/* extentWft/extentHft: the sheet's framed extent in feet; labelPpf: CSS px per foot the sheet reads at; lat: the site's latitude.
 * Returns { cssW, cssH, pixelRatio, glZoom, leafletZoom } or null when nothing can be drawn (no extent, or a frame so wide the Site
 * Plan map itself would not draw roads at that scale — the screen's own gate, SITE_ROADS_FROM). */
export function roadNamesSnapshotPlan({ extentWft, extentHft, labelPpf, lat } = {}) {
  if (!(extentWft > 0) || !(extentHft > 0) || !(labelPpf > 0) || !Number.isFinite(lat)) return null;
  let ppf = labelPpf;
  // A frame whose CSS size would already exceed the buffer at 1× is drawn at a coarser CSS scale (bigger text relative to the plan).
  const maxCss = SNAPSHOT_MAX_DEVICE_PX / MIN_PR;
  const big = Math.max(extentWft, extentHft) * ppf;
  if (big > maxCss) ppf *= maxCss / big;
  const cssW = Math.max(1, Math.round(extentWft * ppf));
  const cssH = Math.max(1, Math.round(extentHft * ppf));
  const pixelRatio = Math.max(MIN_PR, Math.min(MAX_PR, SNAPSHOT_MAX_DEVICE_PX / Math.max(cssW, cssH)));
  // MapLibre zoom (512-px tiles) at which one CSS px spans FT_M/ppf metres at this latitude.
  const mPerPx = FT_M / ppf;
  const glZoom = Math.log2((EARTH_CIRC_M * Math.cos((lat * Math.PI) / 180)) / (512 * mPerPx));
  const leafletZoom = glZoom + VECTOR_ZOOM_OFFSET;
  if (!(leafletZoom >= SITE_ROADS_FROM)) return null;
  return { cssW, cssH, pixelRatio, glZoom, leafletZoom };
}

/* Browser only. center: { lat, lon }; plan: roadNamesSnapshotPlan(...). Resolves { src: "data:image/png…", bounds: { west, south,
 * east, north } } once every tile and label has settled, or REJECTS (unreachable source, WebGL refused, timeout) so the caller can fall
 * back and say so. Always tears its map and container down. */
export async function renderRoadNamesSnapshot({ center, plan, source = VECTOR_SOURCE, timeoutMs = SNAPSHOT_TIMEOUT_MS }) {
  const [maplibre, { default: workerUrl }] = await Promise.all([
    import("maplibre-gl"),
    import("maplibre-gl/dist/maplibre-gl-worker.mjs?url"), // B2671297 — name the worker file explicitly (see vectorLabelLayer.js)
  ]);
  const ml = maplibre.default || maplibre;
  if (typeof ml.setWorkerUrl === "function") ml.setWorkerUrl(workerUrl);
  const host = document.createElement("div");
  // Off-screen but laid out (WebGL will not draw into a display:none box).
  host.style.cssText = `position:fixed;left:-${plan.cssW + 200}px;top:0;width:${plan.cssW}px;height:${plan.cssH}px;pointer-events:none;`;
  host.setAttribute("aria-hidden", "true");
  host.setAttribute("data-export", "skip");
  document.body.appendChild(host);
  let map = null;
  try {
    map = new ml.Map({
      container: host,
      style: buildVectorStyle(source, absoluteGlyphsUrl(source, location.origin), { includePois: false, mode: "site" }),
      center: [center.lon, center.lat], zoom: plan.glZoom,
      interactive: false, attributionControl: false, fadeDuration: 0,
      pixelRatio: plan.pixelRatio,
      canvasContextAttributes: { preserveDrawingBuffer: true }, // so the pixels can be read back after the frame is drawn
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("road names timed out")), timeoutMs);
      let loaded = false;
      map.on("load", () => { loaded = true; });
      map.on("error", (e) => { if (!loaded) { clearTimeout(timer); reject((e && e.error) || new Error("road names source failed")); } });
      map.on("idle", () => { if (loaded) { clearTimeout(timer); resolve(); } });
    });
    const b = map.getBounds();
    const src = map.getCanvas().toDataURL("image/png");
    if (!src || src.length < 64) throw new Error("road names render was empty");
    return { src, bounds: { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() } };
  } finally {
    try { map && map.remove(); } catch (_) { /* already gone */ }
    host.remove();
  }
}
