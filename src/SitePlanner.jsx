import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { storage, loadSite, saveSite } from "./lib/storage.js";
import { loadAndDownscaleImage } from "./lib/image.js";
import { COUNTIES, detectField } from "./lib/counties.js";
import {
  getLayerInfo,
  resolveLayerUrl,
  queryFeatures,
  featureToParcel,
  humanizeError,
} from "./lib/arcgis.js";

/* ------------------------------------------------------------------ *
 *  Industrial Site Planner — prototype (TestFit-style, industrial)
 *  Units: everything internal is in FEET. The canvas <g> scales
 *  feet -> pixels via pxPerFoot + pan offsets. Labels & handles are
 *  drawn in screen (pixel) space for crisp, zoom-independent UI.
 * ------------------------------------------------------------------ */

const SQFT_PER_ACRE = 43560;

const PAL = {
  paper: "#f4f1ea",
  gridMinor: "#e3ddd0",
  gridMajor: "#cfc6af",
  ink: "#2c2a26",
  accent: "#c2410c", // drafting red-orange (selection)
  accentSoft: "#f0d9cc",
  setback: "#b45309",
  parcel: "#5b6650", // parcel boundary line (drafting green)
  panelBg: "#ffffff",
  panelLine: "#e7e2d6",
  muted: "#8a8473",
};

const TYPE = {
  building: { fill: "#ffffff", stroke: "#2b2b2b", label: "Building" },
  paving: { fill: "#555555", stroke: "#333333", label: "Paving / Drive" },
  parking: { fill: "#555555", stroke: "#cfcfcf", label: "Car Parking" },
  trailer: { fill: "#555555", stroke: "#d4d4d4", label: "Trailer Parking" },
  pond: { fill: "#1ed4e1", stroke: "#0b8a96", label: "Detention Pond" },
  sidewalk: { fill: "#c9cccd", stroke: "#9aa1a8", label: "Sidewalk" },
  road: { fill: "#4a4a4a", stroke: "#e8e8e8", label: "Road" },
};

// Resolved style for a type = built-in default merged with any user-set default
// (settings.typeStyles). An individual element may further override fill/stroke/
// fillOpacity on itself (the Bluebeam-style per-element Properties).
const typeStyle = (type, settings) => ({ ...TYPE[type], ...((settings && settings.typeStyles && settings.typeStyles[type]) || {}) });
const elStyle = (el, settings) => {
  const base = typeStyle(el.type, settings);
  return {
    label: base.label,
    fill: el.fill ?? base.fill,
    stroke: el.stroke ?? base.stroke,
    fillOpacity: el.fillOpacity ?? base.fillOpacity ?? 1,
  };
};
// Coerce any CSS color we store into the #rrggbb form an <input type=color> needs.
const toHex6 = (c) => {
  if (!c) return "#000000";
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return "#" + c.slice(1).split("").map((h) => h + h).join("");
  return c;
};

const TOOLS = [
  { id: "select", label: "Select", hint: "Move/resize/rotate • Shift-drag an element to snap & bond it to a neighbour (green +); Alt-drop to place free • on a selected parcel: drag a dot to move a corner, click a + to add one, Shift-click a dot to delete • drag empty space to pan" },
  { id: "parcel", label: "Parcel", hint: "Click to drop boundary points • click the first point (or double-click) to close • Esc cancels" },
  { id: "split", label: "Split", hint: "Cut a parcel: click points to draw a line across it — two points cut straight, or add more for a bent/stepped cut; double-click (or Enter) to finish. It splits into two — then delete the piece you don't want" },
  { id: "building", label: "Building", hint: "Drag for a rectangle, or click points for an irregular footprint (click the 1st point / double-click to close)" },
  { id: "paving", label: "Paving", hint: "Drag for a rectangle, or click points for an irregular paving / drive / truck court (double-click to close)" },
  { id: "parking", label: "Parking", hint: "Pick a row preset from Parking ▾ (single 42′ / double 60′) and drag to set the length, or use Free draw for any rectangle / click points for an irregular field; stalls auto-count" },
  { id: "trailer", label: "Trailer", hint: "Drag for a rectangle, or click points to outline irregular trailer storage (double-click to close); auto-counts" },
  { id: "pond", label: "Pond", hint: "Drag for a rectangle, or click points to outline an irregular detention area (double-click to close)" },
  { id: "road", label: "Road", hint: "Drag for a straight road, or click points for a bent road (double-click to close); shows a centerline" },
  { id: "measure", label: "Measure", hint: "Pick a mode from Measure ▾ — Line (two-point distance), Polyline (click a path, double-click / Enter to finish), or Area (outline a region, click the first dot or double-click to close)" },
  { id: "calibrate", label: "Calibrate", hint: "Underlay scale: click two points a known distance apart on the screenshot, then enter the real length at right" },
];
const DRAW_TYPES = ["building", "paving", "road", "parking", "trailer", "pond"];

/* ----------------------------- geometry ---------------------------- */
const rot2 = (x, y, deg) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
};
// Black or white label text depending on how light the element's fill is.
const labelInk = (hex) => {
  const h = (hex || "#ffffff").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 0.6 ? "#1a1a1a" : "#ffffff";
};
// Pick the CSS resize cursor that matches an on-screen direction vector
// (so grips read correctly even when the element is rotated).
const resizeCursor = (dx, dy) => {
  let a = (Math.atan2(dy, dx) * 180) / Math.PI;
  a = ((a % 180) + 180) % 180; // fold to [0,180)
  if (a < 22.5 || a >= 157.5) return "ew-resize";
  if (a < 67.5) return "nwse-resize";
  if (a < 112.5) return "ns-resize";
  return "nesw-resize";
};
// Snap a dragged rectangle flush against nearby axis-aligned rectangles.
// Returns an adjusted {cx,cy}. thr = contact/alignment threshold in feet.
const edgeSnapCenter = (moved, others, thr) => {
  let cx = moved.cx, cy = moved.cy;
  const hw = moved.w / 2, hh = moved.h / 2;
  const mx0 = cx - hw, mx1 = cx + hw, my0 = cy - hh, my1 = cy + hh;
  let bestX = { d: thr }, bestY = { d: thr }, alignX = { d: thr }, alignY = { d: thr };
  for (const t of others) {
    if (t.points || (((t.rot % 360) + 360) % 360) !== 0) continue;
    const thw = t.w / 2, thh = t.h / 2;
    const tx0 = t.cx - thw, tx1 = t.cx + thw, ty0 = t.cy - thh, ty1 = t.cy + thh;
    const yNear = Math.min(my1, ty1) - Math.max(my0, ty0) > -thr; // roughly side-by-side
    const xNear = Math.min(mx1, tx1) - Math.max(mx0, tx0) > -thr; // roughly stacked
    if (yNear) {
      let d = Math.abs(mx0 - tx1); if (d < bestX.d) bestX = { d, cx: tx1 + hw }; // our left → their right
      d = Math.abs(mx1 - tx0); if (d < bestX.d) bestX = { d, cx: tx0 - hw };     // our right → their left
      let dy = Math.abs(my0 - ty0); if (dy < alignY.d) alignY = { d: dy, cy: ty0 + hh };
      dy = Math.abs(my1 - ty1); if (dy < alignY.d) alignY = { d: dy, cy: ty1 - hh };
    }
    if (xNear) {
      let d = Math.abs(my0 - ty1); if (d < bestY.d) bestY = { d, cy: ty1 + hh }; // our top → their bottom
      d = Math.abs(my1 - ty0); if (d < bestY.d) bestY = { d, cy: ty0 - hh };     // our bottom → their top
      let dx = Math.abs(mx0 - tx0); if (dx < alignX.d) alignX = { d: dx, cx: tx0 + hw };
      dx = Math.abs(mx1 - tx1); if (dx < alignX.d) alignX = { d: dx, cx: tx1 - hw };
    }
  }
  if (bestX.cx !== undefined) { cx = bestX.cx; if (alignY.cy !== undefined) cy = alignY.cy; }
  if (bestY.cy !== undefined) { cy = bestY.cy; if (alignX.cx !== undefined) cx = alignX.cx; }
  return { cx, cy };
};
const elCorners = (el) => {
  const hw = el.w / 2, hh = el.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => {
    const p = rot2(lx, ly, el.rot);
    return { x: el.cx + p.x, y: el.cy + p.y };
  });
};
const polyArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
};
const centroid = (pts) => {
  let x = 0, y = 0;
  pts.forEach((p) => { x += p.x; y += p.y; });
  return { x: x / pts.length, y: y / pts.length };
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// Measure records are {mode, pts}. Old records were {a,b} — normalize both.
const measPts = (m) => (m.pts ? m.pts : (m.a && m.b ? [m.a, m.b] : []));
const measMode = (m) => m.mode || "line";
const pathLen = (pts) => { let t = 0; for (let i = 1; i < pts.length; i++) t += dist(pts[i - 1], pts[i]); return t; };

function lineIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

// Inward offset of a polygon by distance d (good for convex / mildly concave lots).
function offsetPolygon(pts, d) {
  const n = pts.length;
  if (n < 3) return null;
  const cen = centroid(pts);
  // Determine inward direction using edge 0
  const a0 = pts[0], b0 = pts[1];
  let nx = -(b0.y - a0.y), ny = b0.x - a0.x;
  const l0 = Math.hypot(nx, ny);
  if (l0 === 0) return null;
  nx /= l0; ny /= l0;
  const mid = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const plus = { x: mid.x + nx, y: mid.y + ny };
  const flip = dist(plus, cen) > dist(mid, cen) ? -1 : 1;

  const off = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    let ex = -(b.y - a.y), ey = b.x - a.x;
    const len = Math.hypot(ex, ey);
    if (len === 0) return null;
    ex = (ex / len) * flip; ey = (ey / len) * flip;
    off.push({ ax: a.x + ex * d, ay: a.y + ey * d, bx: b.x + ex * d, by: b.y + ey * d });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const e1 = off[(i - 1 + n) % n], e2 = off[i];
    const p = lineIntersect(e1.ax, e1.ay, e1.bx, e1.by, e2.ax, e2.ay, e2.bx, e2.by);
    if (!p) return null;
    out.push(p);
  }
  return out;
}

/* --------------------------- parking math -------------------------- */
// Double-loaded modules (two stall rows + a drive aisle) filling a rectangle.
// Supports 90/60/45° stalls: angling narrows the row depth and the aisle the
// user sets, and spaces stalls farther apart along the row.
function carStalls(w, h, s) {
  const ang = [45, 60, 90].includes(+s.parkAngle) ? +s.parkAngle : 90;
  const rad = (ang * Math.PI) / 180, sinA = Math.sin(rad);
  const rowDepth = s.stallDepth * sinA;        // perpendicular depth of a stall row
  const pitch = s.stallW / sinA;               // spacing along the row
  const ai = s.aisle;
  const slantDx = ang === 90 ? 0 : rowDepth / Math.tan(rad); // lean across the depth
  const mod = rowDepth * 2 + ai;
  const perRow = Math.max(0, Math.floor((w - slantDx) / pitch));
  const mods = Math.max(0, Math.floor(h / mod));
  let count = 0;
  const bands = [], aisles = [];
  for (let i = 0; i < mods; i++) {
    const y = i * mod;
    bands.push({ y, depth: rowDepth, n: perRow, pitch, slantDx, dir: 1 });
    aisles.push({ y0: y + rowDepth, y1: y + rowDepth + ai });
    bands.push({ y: y + rowDepth + ai, depth: rowDepth, n: perRow, pitch, slantDx, dir: -1 });
    count += perRow * 2;
  }
  const used = mods * mod, left = h - used;
  if (left >= rowDepth && perRow > 0) {
    bands.push({ y: used, depth: rowDepth, n: perRow, pitch, slantDx, dir: 1 });
    count += perRow;
  }
  return { count, bands, aisles, pitch, rowDepth, angle: ang };
}
// Trailer storage as double-loaded rows (53′ deep) separated by a maneuvering
// drive lane (~60′) so tractors can back trailers in — not a solid pack.
function trailerStalls(w, h, s) {
  const tl = s.trailerL, tw = s.trailerW, ai = Math.max(0, s.trailerAisle || 0);
  const perRow = Math.max(0, Math.floor(w / tw));
  // Single striped row (e.g. trailer parking flush against a wall): one band
  // filling the strip depth, columns every tw.
  if (s.single) {
    const bands = perRow > 0 ? [{ y: 0, depth: h, n: perRow }] : [];
    return { count: perRow, bands, aisles: [], cols: perRow, tw, tl };
  }
  const mod = tl * 2 + ai;
  const mods = Math.max(0, Math.floor(h / mod));
  let count = 0;
  const bands = [], aisles = [];
  for (let i = 0; i < mods; i++) {
    const y = i * mod;
    bands.push({ y, depth: tl, n: perRow });
    aisles.push({ y0: y + tl, y1: y + tl + ai });
    bands.push({ y: y + tl + ai, depth: tl, n: perRow });
    count += perRow * 2;
  }
  const used = mods * mod, left = h - used;
  if (left >= tl && perRow > 0) {
    bands.push({ y: used, depth: tl, n: perRow });
    count += perRow;
  }
  return { count, bands, aisles, cols: perRow, tw, tl };
}
// Area-based stall estimates for irregular (polygon) fields — gross sf per stall
// including its share of drive aisle, with an efficiency factor for edge loss.
function estStalls(area, s) {
  const per = s.stallW * (s.stallDepth + s.aisle / 2) || 1;
  return Math.max(0, Math.floor((area * 0.8) / per));
}
function estTrailers(area, s) {
  const per = s.trailerW * (s.trailerL + (s.trailerAisle || 0) / 2) || 1;
  return Math.max(0, Math.floor((area * 0.8) / per));
}

/* ----------------------- polygon split (parcels) ------------------- */
// Intersection of segment p->q with the infinite line through A,B (if within pq).
function segLineIntersect(p, q, A, B) {
  const rx = q.x - p.x, ry = q.y - p.y, sx = B.x - A.x, sy = B.y - A.y;
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((A.x - p.x) * sy - (A.y - p.y) * sx) / denom;
  if (t < -1e-9 || t > 1 + 1e-9) return null;
  return { x: p.x + t * rx, y: p.y + t * ry };
}
// Closest point on segment a-b to point p (used for snapping to a boundary).
function nearestPointOnSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

// Split a polygon along an open polyline cut (>=2 vertices). The first and last
// vertices are projected onto the nearest polygon edge (the entry/exit points);
// interior vertices bend the cut across the interior. Returns [ringA, ringB] or null.
function splitPolygonPath(points, path) {
  const n = points.length;
  if (path.length < 2) return null;
  // nearest polygon edge (+ projected point) for an endpoint
  const projectToEdge = (pt) => {
    let best = null;
    for (let i = 0; i < n; i++) {
      const proj = nearestPointOnSeg(pt, points[i], points[(i + 1) % n]);
      const d = (proj.x - pt.x) ** 2 + (proj.y - pt.y) ** 2;
      if (!best || d < best.d) best = { edge: i, point: proj, d };
    }
    return best;
  };
  const inHit = projectToEdge(path[0]);
  const outHit = projectToEdge(path[path.length - 1]);
  if (!inHit || !outHit || inHit.edge === outHit.edge) return null;
  const interior = path.slice(1, -1); // oriented path[0] -> path[last]
  let a1, a2, midPath;
  if (inHit.edge < outHit.edge) { a1 = inHit; a2 = outHit; midPath = interior; }
  else { a1 = outHit; a2 = inHit; midPath = interior.slice().reverse(); }
  const polyA = [a1.point];
  for (let k = a1.edge + 1; k <= a2.edge; k++) polyA.push(points[k % n]);
  polyA.push(a2.point, ...midPath.slice().reverse());
  const polyB = [a2.point];
  for (let k = a2.edge + 1; k <= a1.edge + n; k++) polyB.push(points[k % n]);
  polyB.push(a1.point, ...midPath);
  if (polyA.length < 3 || polyB.length < 3) return null;
  return [polyA, polyB];
}

// Split a simple polygon by the line through A,B. Returns [ringA, ringB] or null.
function splitPolygon(points, A, B) {
  const n = points.length;
  const dx = B.x - A.x, dy = B.y - A.y, denom2 = dx * dx + dy * dy || 1;
  const hits = [];
  for (let i = 0; i < n; i++) {
    const inter = segLineIntersect(points[i], points[(i + 1) % n], A, B);
    if (inter) hits.push({ i, point: inter, t: ((inter.x - A.x) * dx + (inter.y - A.y) * dy) / denom2 });
  }
  if (hits.length < 2) return null;
  hits.sort((u, v) => u.t - v.t);
  const lo = hits[0], hi = hits[hits.length - 1];
  if (lo.i === hi.i) return null;
  const a1 = lo.i < hi.i ? lo : hi, a2 = lo.i < hi.i ? hi : lo;
  const polyA = [a1.point];
  for (let k = a1.i + 1; k <= a2.i; k++) polyA.push(points[k % n]);
  polyA.push(a2.point);
  const polyB = [a2.point];
  for (let k = a2.i + 1; k <= a1.i + n; k++) polyB.push(points[k % n]);
  polyB.push(a1.point);
  if (polyA.length < 3 || polyB.length < 3) return null;
  return [polyA, polyB];
}

/* ------------------------------ format ----------------------------- */
const f0 = (n) => Math.round(n).toLocaleString();
const f2 = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

let _id = 1;
const uid = () => `e${_id++}`;
// After restoring saved work, bump the id counter past any restored ids so new
// elements don't collide with old ones (which would break keys/selection).
const ensureIdAbove = (ids) => {
  (ids || []).forEach((id) => {
    const n = parseInt(String(id).replace(/\D/g, ""), 10);
    if (!isNaN(n) && n >= _id) _id = n + 1;
  });
};

const DEFAULT_SETTINGS = {
  gridSize: 10, snap: true,
  setback: 25, showSetback: true,
  stallW: 9, stallDepth: 18, aisle: 24, parkAngle: 90,
  trailerW: 12, trailerL: 53, trailerAisle: 60,
  showDocks: true,
  typeStyles: {}, // user-set default colors per element type (Bluebeam-style defaults)
};

export default function SitePlanner({ active = true, siteId = null, onBackToMap } = {}) {
  // Restore this site's saved canvas (and advance the id counter past saved ids).
  // Keyed remount in App means this runs once per site.
  const restored = useMemo(() => {
    const s = loadSite(siteId);
    if (s) ensureIdAbove([...(s.parcels || []).map((p) => p.id), ...(s.els || []).map((e) => e.id)]);
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [parcels, setParcels] = useState(() => restored?.parcels || []);    // {id, points:[{x,y}]}
  const [els, setEls] = useState(() => restored?.els || []);                // {id,type,cx,cy,w,h,rot}
  const [measures, setMeasures] = useState(() => restored?.measures || []); // {a,b}
  const [tool, setTool] = useState("select");
  const [toolMenu, setToolMenu] = useState(false); // Parcel ▾ dropdown open
  const [buildingMenu, setBuildingMenu] = useState(false); // Building ▾ dock-type dropdown open
  const [buildingDock, setBuildingDock] = useState("single"); // dock layout for newly drawn buildings
  const [parkingMenu, setParkingMenu] = useState(false); // Parking ▾ row-preset dropdown open
  const [exportMenu, setExportMenu] = useState(false);   // Export ▾ dropdown open
  const [saveMenu, setSaveMenu] = useState(false);       // Save / load ▾ dropdown open
  const [parkingRows, setParkingRows] = useState("free"); // "free" | "single" | "double" — drawn-parking depth preset
  const [sidewalkFor, setSidewalkFor] = useState(null); // building id awaiting a "click a side" to add a sidewalk
  const [attachFor, setAttachFor] = useState(null);     // element id awaiting a "click a host" to attach to
  const [attachHint, setAttachHint] = useState(null);   // {x,y} feet — green "+" while a drag is about to bond
  const [panning, setPanning] = useState(false);   // dragging empty canvas to pan
  const [sel, setSel] = useState(null);         // {kind:'el'|'parcel', id}
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...(restored?.settings || {}) }));

  const [view, setView] = useState({ ppf: 0.35, offX: 60, offY: 60 });
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [cursor, setCursor] = useState(null);   // {x,y} feet

  // parcel drafting + draw drafting + measure
  const [draftPoly, setDraftPoly] = useState(null);  // array of feet pts
  const [draftRect, setDraftRect] = useState(null);  // {type, x,y,w,h} feet
  const [draftElPoly, setDraftElPoly] = useState(null); // {type, pts:[{x,y}]} polygon element being drawn
  const [measDraft, setMeasDraft] = useState([]);    // in-progress measure vertices
  const [measureMode, setMeasureMode] = useState("line"); // "line" | "polyline" | "area"
  const [measureMenu, setMeasureMenu] = useState(false);  // Measure ▾ dropdown open
  const [splitPath, setSplitPath] = useState([]);    // vertices of a split cut polyline

  // aerial underlay + scale calibration
  const [underlay, setUnderlay] = useState(() => restored?.underlay || null);    // {src,imgW,imgH,x,y,ftPerPx,opacity,locked}
  const [underlayErr, setUnderlayErr] = useState(false);
  const [underlayLoading, setUnderlayLoading] = useState(() => {
    const u = restored?.underlay;
    return !!(u && u.src && !String(u.src).startsWith("data:")); // show spinner until the remote aerial loads
  });
  const [calib, setCalib] = useState(null);          // {a:{x,y}, b?:{x,y}}
  const [calibInput, setCalibInput] = useState("");
  const fileRef = useRef(null);

  // county parcel lookup
  const [county, setCounty] = useState("harris");
  const [lookupUrl, setLookupUrl] = useState(COUNTIES.harris.layerUrl || COUNTIES.harris.serviceUrl);
  const [searchMode, setSearchMode] = useState("address"); // "address" | "id"
  const [searchVal, setSearchVal] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupErr, setLookupErr] = useState("");
  const [lookupRes, setLookupRes] = useState([]);    // [{ft, layerUrl, idField, addrField}]

  // rectangular parcel quick-add inputs
  const [lotW, setLotW] = useState(600);
  const [lotD, setLotD] = useState(800);

  // scenarios
  const [scenName, setScenName] = useState("");
  const [scenList, setScenList] = useState([]);
  const [scenPick, setScenPick] = useState("");

  const [typeMenu, setTypeMenu] = useState(null); // {id, x, y} screen coords for change-type popup

  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const drag = useRef(null);
  const clip = useRef(null); // copied element (for Ctrl+C / X / V)

  // Undo/redo history (snapshots of the editable state, stored by reference).
  const stateRef = useRef({ parcels: [], els: [], measures: [], underlay: null });
  const pastRef = useRef([]);
  const futureRef = useRef([]);
  useEffect(() => { stateRef.current = { parcels, els, measures, underlay }; });
  // Autosave this site (debounced) so reloads, switching sites, and the map
  // list all stay current. saveSite merges, preserving name/origin.
  useEffect(() => {
    if (!siteId) return;
    const t = setTimeout(() => saveSite({ id: siteId, parcels, els, measures, settings, underlay }), 400);
    return () => clearTimeout(t);
  }, [siteId, parcels, els, measures, settings, underlay]);
  // Flush immediately when this site goes inactive (back to map) or unmounts
  // (switching sites), so nothing in the last debounce window is lost.
  const liveRef = useRef({});
  useEffect(() => { liveRef.current = { parcels, els, measures, settings, underlay }; });
  useEffect(() => {
    if (active || !siteId) return;
    saveSite({ id: siteId, ...liveRef.current });
  }, [active]); // eslint-disable-line
  useEffect(() => () => { if (siteId) saveSite({ id: siteId, ...liveRef.current }); }, []); // eslint-disable-line
  const histKey = (s) =>
    JSON.stringify({ p: s.parcels, e: s.els, m: s.measures }) +
    "|" + (s.underlay ? `${s.underlay.x},${s.underlay.y},${s.underlay.ftPerPx},${s.underlay.ftPerPxY},${s.underlay.opacity},${s.underlay.locked},${s.underlay.src?.length}` : "none");
  const pushHistory = () => {
    pastRef.current.push(stateRef.current);
    if (pastRef.current.length > 80) pastRef.current.shift();
    futureRef.current = [];
  };
  const applySnapshot = (s) => {
    setParcels(s.parcels); setEls(s.els); setMeasures(s.measures); setUnderlay(s.underlay);
    setSel(null); setSplitPath([]); setTypeMenu(null);
  };
  const undo = () => {
    let prev = null;
    while (pastRef.current.length) {
      const cand = pastRef.current.pop();
      if (histKey(cand) !== histKey(stateRef.current)) { prev = cand; break; }
    }
    if (!prev) return;
    futureRef.current.push(stateRef.current);
    applySnapshot(prev);
  };
  const redo = () => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(stateRef.current);
    applySnapshot(next);
  };

  /* ------------ size tracking ------------ */
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((ents) => {
      const r = ents[0].contentRect;
      setSize({ w: Math.max(320, r.width), h: Math.max(360, r.height) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  /* ------------ coordinate transforms ------------ */
  const f2p = useCallback((p) => ({ x: p.x * view.ppf + view.offX, y: p.y * view.ppf + view.offY }), [view]);
  const p2f = useCallback((cx, cy) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: (cx - r.left - view.offX) / view.ppf, y: (cy - r.top - view.offY) / view.ppf };
  }, [view]);
  const snap = useCallback((v) => (settings.snap ? Math.round(v / settings.gridSize) * settings.gridSize : Math.round(v * 100) / 100), [settings]);
  const snapPt = useCallback((p) => ({ x: snap(p.x), y: snap(p.y) }), [snap]);
  // Snap to the nearest parcel boundary within ~5 ft (or ~10 px); used by Split.
  const snapToBoundary = useCallback((p) => {
    const tol = Math.max(5, 10 / view.ppf);
    let best = null, bestD = Infinity;
    for (const pc of parcels) {
      const pts = pc.points;
      for (let i = 0; i < pts.length; i++) {
        const q = nearestPointOnSeg(p, pts[i], pts[(i + 1) % pts.length]);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) { bestD = d; best = q; }
      }
    }
    return best && bestD <= tol ? best : null;
  }, [parcels, view]);
  const snapSplit = useCallback((p) => snapToBoundary(p) || snapPt(p), [snapToBoundary, snapPt]);

  /* ------------ fit to content ------------ */
  const fit = useCallback(() => {
    const pts = [];
    parcels.forEach((pc) => pts.push(...pc.points));
    els.forEach((e) => pts.push(...(e.points ? e.points : elCorners(e))));
    if (underlay) {
      const sy = underlay.ftPerPxY || underlay.ftPerPx;
      pts.push({ x: underlay.x, y: underlay.y });
      pts.push({ x: underlay.x + underlay.imgW * underlay.ftPerPx, y: underlay.y + underlay.imgH * sy });
    }
    if (pts.length === 0) { setView({ ppf: 0.35, offX: 60, offY: 60 }); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach((p) => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
    const bw = Math.max(maxX - minX, 10), bh = Math.max(maxY - minY, 10);
    const pad = 60;
    const ppf = Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh);
    setView({ ppf, offX: pad - minX * ppf + (size.w - pad * 2 - bw * ppf) / 2, offY: pad - minY * ppf + (size.h - pad * 2 - bh * ppf) / 2 });
  }, [parcels, els, underlay, size]);

  // Fit *after* a state change has committed: bump the nonce instead of calling
  // fit() from a stale closure (which would frame the view without the content
  // we just added). The effect runs post-render so fit() sees current state.
  const [fitNonce, setFitNonce] = useState(0);
  const requestFit = useCallback(() => setFitNonce((n) => n + 1), []);
  useEffect(() => { if (fitNonce) fit(); }, [fitNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select the single restored parcel so its handles are ready to use.
  useEffect(() => {
    if (restored?.parcels?.length === 1 && !(restored?.els?.length)) setSel({ kind: "parcel", id: restored.parcels[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reframe when this view becomes active — its real size is known only once shown.
  useEffect(() => {
    if (active) { const t = setTimeout(() => requestFit(), 120); return () => clearTimeout(t); }
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------ wheel zoom (non-passive) ------------ */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setView((v) => {
        const fx = (mx - v.offX) / v.ppf, fy = (my - v.offY) / v.ppf;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const ppf = Math.max(0.02, Math.min(8, v.ppf * factor));
        return { ppf, offX: mx - fx * ppf, offY: my - fy * ppf };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  /* ------------ keyboard ------------ */
  useEffect(() => {
    const onKey = (e) => {
      const t = document.activeElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) { if (sel?.kind === "el") { e.preventDefault(); copySel(); } return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "x" || e.key === "X")) { if (sel?.kind === "el") { e.preventDefault(); cutSel(); } return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) { if (clip.current) { e.preventDefault(); pasteClip(); } return; }
      if ((e.key === "l" || e.key === "L") && !e.ctrlKey && !e.metaKey && sel?.kind === "el") { e.preventDefault(); toggleLock(sel.id); return; }
      if (e.key === "Enter" && tool === "split" && splitPath.length >= 2) { e.preventDefault(); finishSplit(); return; }
      if (e.key === "Enter" && tool === "measure" && measDraft.length >= 2) { e.preventDefault(); finishMeasure(); return; }
      if (e.key === "Escape") { setDraftPoly(null); setDraftRect(null); setDraftElPoly(null); setMeasDraft([]); setCalib(null); setSplitPath([]); setSidewalkFor(null); setAttachFor(null); setSel(null); setTypeMenu(null); setToolMenu(false); setMeasureMenu(false); setTool("select"); }
      if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); deleteSel(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, tool, splitPath, els, settings, measDraft, measureMode]); // eslint-disable-line

  const deleteSel = () => {
    if (!sel) return;
    pushHistory();
    if (sel.kind === "el") setEls((a) => a.filter((e) => e.id !== sel.id && e.attachedTo !== sel.id));
    else if (sel.kind === "measure") setMeasures((a) => a.filter((_, i) => i !== sel.i));
    else setParcels((a) => a.filter((p) => p.id !== sel.id));
    setSel(null);
  };
  // Copy / cut / paste the selected element (rectangles or polygons).
  const copySel = () => { if (sel?.kind === "el") clip.current = els.find((x) => x.id === sel.id) || clip.current; };
  const cutSel = () => { if (sel?.kind === "el") { copySel(); deleteSel(); } };
  const pasteClip = () => {
    if (!clip.current) return;
    const { attachedTo, ...src } = clip.current; // a pasted copy starts unattached
    const off = (settings.gridSize || 10) * 2; // nudge the copy so it's visible
    const el = src.points
      ? { ...src, id: uid(), points: src.points.map((p) => ({ x: p.x + off, y: p.y + off })) }
      : { ...src, id: uid(), cx: src.cx + off, cy: src.cy + off };
    pushHistory();
    setEls((a) => [...a, el]);
    setSel({ kind: "el", id: el.id });
  };
  const selectMeasure = (e, i) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    setSel({ kind: "measure", i });
  };

  /* ------------ pointer handlers (svg root) ------------ */
  const onBgDown = (e) => {
    if (e.button !== 0) return;
    const fp = p2f(e.clientX, e.clientY);

    if (sidewalkFor) { setSidewalkFor(null); return; } // clicked off the building → cancel
    if (attachFor) { setAttachFor(null); return; }     // clicked empty space → cancel attach
    if (tool === "select") {
      setSel(null);
      setPanning(true);
      drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: view.offX, oy: view.offY };
      svgRef.current.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === "parcel") {
      const sp = snapPt(fp);
      if (draftPoly && draftPoly.length >= 3 && dist(f2p(sp), f2p(draftPoly[0])) < 12) { closePoly(); return; }
      setDraftPoly((d) => (d ? [...d, sp] : [sp]));
      return;
    }
    if (tool === "measure") {
      const sp = snapPt(fp);
      if (measureMode === "line") {
        // two-click distance
        if (measDraft.length === 0) setMeasDraft([sp]);
        else { pushHistory(); setMeasures((m) => [...m, { id: uid(), mode: "line", pts: [measDraft[0], sp] }]); setMeasDraft([]); }
      } else {
        // polyline / area: accumulate points; close an area by clicking the first dot
        if (measureMode === "area" && measDraft.length >= 3 && dist(f2p(sp), f2p(measDraft[0])) < 12) { finishMeasure(); return; }
        setMeasDraft((d) => [...d, sp]);
      }
      return;
    }
    if (tool === "calibrate") {
      // Calibration points are NOT grid-snapped — we want to land exactly on
      // the screenshot feature the user is clicking.
      if (!underlay) return;
      if (!calib || calib.b) { setCalib({ a: fp }); setCalibInput(""); }
      else setCalib((c) => ({ a: c.a, b: fp }));
      return;
    }
    if (tool === "split") {
      // Build up a cut polyline; double-click (or Enter) finishes the cut.
      const sp = snapSplit(fp);
      setSplitPath((pts) => [...pts, sp]);
      return;
    }
    if (DRAW_TYPES.includes(tool)) {
      const sp = snapPt(fp);
      if (draftElPoly) { // adding points to an in-progress polygon element
        if (draftElPoly.pts.length >= 3 && dist(f2p(sp), f2p(draftElPoly.pts[0])) < 12) { closeElPoly(); return; }
        setDraftElPoly((d) => ({ ...d, pts: [...d.pts, sp] }));
        return;
      }
      pushHistory();
      const parkDepth = tool === "parking" && parkingRows !== "free"
        ? (parkingRows === "double" ? settings.stallDepth * 2 + settings.aisle : settings.stallDepth + settings.aisle)
        : 0;
      drag.current = { mode: "draw", type: tool, ox: sp.x, oy: sp.y, depth: parkDepth };
      setDraftRect({ type: tool, x: sp.x, y: sp.y, w: 0, h: 0 });
      svgRef.current.setPointerCapture(e.pointerId);
    }
  };

  // Finish the in-progress cut polyline and split.
  const finishSplit = () => {
    if (splitPath.length >= 2) performSplit(splitPath);
    setSplitPath([]);
  };
  // Commit the in-progress polyline / area measurement.
  const finishMeasure = () => {
    if (measureMode === "polyline" && measDraft.length >= 2) { pushHistory(); setMeasures((m) => [...m, { id: uid(), mode: "polyline", pts: measDraft }]); }
    else if (measureMode === "area" && measDraft.length >= 3) { pushHistory(); setMeasures((m) => [...m, { id: uid(), mode: "area", pts: measDraft }]); }
    setMeasDraft([]);
  };
  // Split the selected parcel (or whichever parcel the cut crosses) along a
  // polyline of >=2 points. Two points cut along the infinite line through them
  // (the original behaviour); 3+ points bend the cut through the interior.
  const performSplit = (path) => {
    // Drop consecutive coincident points (a finishing double-click adds the last twice).
    const pts = path.filter((p, i) => i === 0 || dist(p, path[i - 1]) > 0.01);
    if (pts.length < 2) return;
    const ordered = sel?.kind === "parcel"
      ? [parcels.find((p) => p.id === sel.id), ...parcels.filter((p) => p.id !== sel.id)].filter(Boolean)
      : parcels;
    for (const pc of ordered) {
      const halves = pts.length === 2
        ? splitPolygon(pc.points, pts[0], pts[1])
        : splitPolygonPath(pc.points, pts);
      if (halves) {
        pushHistory();
        const a = { id: uid(), points: halves[0] };
        const b = { id: uid(), points: halves[1] };
        setParcels((arr) => arr.flatMap((p) => (p.id === pc.id ? [a, b] : [p])));
        setSel({ kind: "parcel", id: a.id });
        return;
      }
    }
  };

  /* ------------ parcel vertex editing ------------ */
  const startVertex = (e, id, index) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    pushHistory();
    if (e.shiftKey) { // shift-click removes a vertex (keep a triangle minimum)
      setParcels((a) => a.map((pc) => pc.id === id && pc.points.length > 3
        ? { ...pc, points: pc.points.filter((_, i) => i !== index) } : pc));
      return;
    }
    setSel({ kind: "parcel", id });
    drag.current = { mode: "vertex", id, index };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const addVertex = (e, id, index) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    pushHistory();
    setParcels((a) => a.map((pc) => {
      if (pc.id !== id) return pc;
      const p = pc.points[index], q = pc.points[(index + 1) % pc.points.length];
      const mid = snapPt({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
      const points = [...pc.points];
      points.splice(index + 1, 0, mid);
      return { ...pc, points };
    }));
    setSel({ kind: "parcel", id });
  };

  const onMove = (e) => {
    const fp = p2f(e.clientX, e.clientY);
    setCursor(fp);
    const d = drag.current;
    if (!d) return;

    if (d.mode === "pan") {
      setView((v) => ({ ...v, offX: d.ox + (e.clientX - d.sx), offY: d.oy + (e.clientY - d.sy) }));
      return;
    }
    if (d.mode === "moveUnderlay") {
      const dx = fp.x - d.fx, dy = fp.y - d.fy;
      setUnderlay((u) => (u ? { ...u, x: d.ox + dx, y: d.oy + dy } : u));
      return;
    }
    if (d.mode === "draw") {
      const sp = snapPt(fp);
      if (d.depth) { // parking preset: lock the depth, drag sets length & direction
        const dx = sp.x - d.ox, dy = sp.y - d.oy, depth = d.depth;
        const horizontal = Math.abs(dx) >= Math.abs(dy);
        const len = Math.max(0, horizontal ? Math.abs(dx) : Math.abs(dy));
        const x = horizontal ? (dx >= 0 ? d.ox : d.ox - len) : (dx >= 0 ? d.ox : d.ox - depth);
        const y = horizontal ? (dy >= 0 ? d.oy : d.oy - depth) : (dy >= 0 ? d.oy : d.oy - len);
        setDraftRect({ type: d.type, x, y, w: horizontal ? len : depth, h: horizontal ? depth : len, parkLen: len, parkDepth: depth, parkRot: horizontal ? 0 : 90 });
        return;
      }
      const x = Math.min(d.ox, sp.x), y = Math.min(d.oy, sp.y);
      setDraftRect({ type: d.type, x, y, w: Math.abs(sp.x - d.ox), h: Math.abs(sp.y - d.oy) });
      return;
    }
    if (d.mode === "move") {
      const dx = fp.x - d.fx, dy = fp.y - d.fy;
      const shift = e.shiftKey; // live — works whether Shift is held before or mid-drag
      if (d.kind === "el") {
        // Snap based on the grabbed element, then shift the whole assembly by that delta.
        const g = d.members.find((m) => m.id === d.id);
        let effDx, effDy, hint = null, newRot = null;
        const gel = els.find((x) => x.id === d.id);
        const gbox = ortho(gel); // effective box (handles 90/180/270)
        if (g.cx !== undefined) {
          let ncx = snap(g.cx + dx), ncy = snap(g.cy + dy);
          const ids = new Set(d.members.map((m) => m.id));
          if (shift && d.canAttach && !gel.points) {
            // Shift: align to a nearby host's angle and snap flush in its frame
            const cands = els.filter((x) => !ids.has(x.id) && !x.points && rootIdOf(x.id) !== d.id);
            const res = alignSnap(gel, ncx, ncy, cands, Math.min(40, 24 / view.ppf));
            if (res) { ncx = res.cx; ncy = res.cy; newRot = res.rot; hint = { id: res.hostId, x: res.hintX, y: res.hintY }; }
          } else if (settings.snap && gbox) { // ambient flush-snap along world axes
            const others = els.filter((x) => !ids.has(x.id)).map(ortho).filter(Boolean);
            const sc = edgeSnapCenter({ cx: ncx, cy: ncy, w: gbox.w, h: gbox.h }, others, Math.min(20, 10 / view.ppf));
            ncx = sc.cx; ncy = sc.cy;
            if (d.canAttach) {
              const hit = flushContact({ cx: ncx, cy: ncy, w: gbox.w, h: gbox.h, rot: 0 }, others, 2);
              if (hit && rootIdOf(hit.id) !== d.id) hint = hit;
            }
          }
          effDx = ncx - g.cx; effDy = ncy - g.cy;
        } else {
          effDx = snap(g.points[0].x + dx) - g.points[0].x;
          effDy = snap(g.points[0].y + dy) - g.points[0].y;
        }
        d.bondTarget = hint ? hint.id : null; // remember for the drop (els may lag a frame)
        d.bondRot = newRot; // remember the aligned angle for the drop
        setEls((a) => a.map((el) => {
          const m = d.members.find((x) => x.id === el.id);
          if (!m) return el;
          if (m.points) return { ...el, points: m.points.map((p) => ({ x: p.x + effDx, y: p.y + effDy })) };
          const moved = { ...el, cx: m.cx + effDx, cy: m.cy + effDy };
          if (newRot != null && el.id === d.id) moved.rot = newRot; // align to host angle
          return moved;
        }));
        setAttachHint(hint ? { x: hint.x, y: hint.y } : null);
      } else {
        setParcels((a) => a.map((pc) => pc.id === d.id ? { ...pc, points: d.opts.map((p) => ({ x: snap(p.x + dx), y: snap(p.y + dy) })) } : pc));
      }
      return;
    }
    if (d.mode === "vertex") {
      const sp = snapPt(fp);
      setParcels((a) => a.map((pc) => pc.id === d.id
        ? { ...pc, points: pc.points.map((p, i) => (i === d.index ? sp : p)) } : pc));
      return;
    }
    if (d.mode === "resize") {
      const el = els.find((x) => x.id === d.id);
      if (!el) return;
      const opp = d.opp; // fixed opposite corner (world feet)
      const local = rot2(fp.x - opp.x, fp.y - opp.y, -el.rot);
      let nw = Math.abs(local.x), nh = Math.abs(local.y);
      nw = Math.max(settings.gridSize, settings.snap ? Math.round(nw / settings.gridSize) * settings.gridSize : Math.round(nw));
      nh = Math.max(settings.gridSize, settings.snap ? Math.round(nh / settings.gridSize) * settings.gridSize : Math.round(nh));
      // opposite stays fixed; new center is the midpoint of opp and the dragged corner
      const half = rot2(d.sx * nw, d.sy * nh, el.rot);
      const newCenter = { x: opp.x + half.x / 2, y: opp.y + half.y / 2 };
      const nb = { cx: newCenter.x, cy: newCenter.y, w: nw, h: nh, rot: el.rot };
      setEls((a) => a.map((x) => {
        if (x.id === d.id) return { ...x, w: nw, h: nh, cx: newCenter.x, cy: newCenter.y };
        const k = d.kids?.find((kk) => kk.id === x.id);
        return k ? { ...x, ...fitKid(nb, k) } : x;
      }));
      return;
    }
    if (d.mode === "edgeResize") {
      // Drag one side; the opposite side stays put (only that dimension changes).
      const el = els.find((x) => x.id === d.id);
      if (!el) return;
      const { nx, ny, opp } = d; // outward local normal of the dragged edge
      const local = rot2(fp.x - opp.x, fp.y - opp.y, -el.rot);
      const snapDim = (v) => Math.max(settings.gridSize, settings.snap ? Math.round(Math.abs(v) / settings.gridSize) * settings.gridSize : Math.round(Math.abs(v)));
      const nw = nx !== 0 ? snapDim(local.x) : el.w;
      const nh = ny !== 0 ? snapDim(local.y) : el.h;
      const half = rot2(nx * nw, ny * nh, el.rot);
      const newCenter = { x: opp.x + half.x / 2, y: opp.y + half.y / 2 };
      const nb = { cx: newCenter.x, cy: newCenter.y, w: nw, h: nh, rot: el.rot };
      setEls((a) => a.map((x) => {
        if (x.id === d.id) return { ...x, w: nw, h: nh, cx: newCenter.x, cy: newCenter.y };
        const k = d.kids?.find((kk) => kk.id === x.id);
        return k ? { ...x, ...fitKid(nb, k) } : x;
      }));
      return;
    }
    if (d.mode === "rotate") {
      const cur = (Math.atan2(fp.y - d.pivot.y, fp.x - d.pivot.x) * 180) / Math.PI;
      let delta = cur - d.startPtr;
      const prim = d.start.find((s) => s.id === d.id);
      if (prim && prim.rot !== undefined) { // snap the grabbed element to 15°, carry the rest along
        let target = prim.rot + delta;
        target = settings.snap ? Math.round(target / 15) * 15 : Math.round(target);
        delta = target - prim.rot;
      }
      setEls((a) => a.map((el) => {
        const s = d.start.find((x) => x.id === el.id);
        if (!s) return el;
        if (s.points) return { ...el, points: s.points.map((p) => { const r = rot2(p.x - d.pivot.x, p.y - d.pivot.y, delta); return { x: d.pivot.x + r.x, y: d.pivot.y + r.y }; }) };
        const r = rot2(s.cx - d.pivot.x, s.cy - d.pivot.y, delta);
        return { ...el, cx: d.pivot.x + r.x, cy: d.pivot.y + r.y, rot: ((s.rot + delta) % 360 + 360) % 360 };
      }));
      return;
    }
  };

  const onUp = (e) => {
    const d = drag.current;
    if (d && d.mode === "draw" && draftRect) {
      if (d.depth) {
        // parking preset: build as a length×depth strip, rotated for a vertical drag
        if (draftRect.parkLen >= 4) {
          const el = { id: uid(), type: "parking", cx: draftRect.x + draftRect.w / 2, cy: draftRect.y + draftRect.h / 2, w: draftRect.parkLen, h: draftRect.parkDepth, rot: draftRect.parkRot };
          setEls((a) => [...a, el]);
          setSel({ kind: "el", id: el.id });
          setTool("select");
        }
      } else if (draftRect.w >= 4 && draftRect.h >= 4) {
        const el = { id: uid(), type: draftRect.type, cx: draftRect.x + draftRect.w / 2, cy: draftRect.y + draftRect.h / 2, w: draftRect.w, h: draftRect.h, rot: 0, ...(draftRect.type === "building" ? { dock: buildingDock, dockSide: draftRect.w >= draftRect.h ? "bottom" : "right" } : {}) };
        setEls((a) => [...a, el]);
        setSel({ kind: "el", id: el.id });
        setTool("select"); // one element per click — drop back to Select
      } else {
        // a click (no drag) → begin a polygon element by dropping perimeter points
        setDraftElPoly({ type: draftRect.type, pts: [{ x: draftRect.x, y: draftRect.y }] });
      }
      setDraftRect(null);
    }
    // Bond on drop: if a flush bond target was found during the drag (Shift held,
    // or Snap on), attach so they move together. Alt drops it free.
    if (d && d.mode === "move" && d.kind === "el" && d.canAttach && d.bondTarget && !e.altKey) {
      const root = rootIdOf(d.bondTarget);
      if (root !== d.id) setEls((a) => a.map((x) => x.id === d.id ? { ...x, attachedTo: root, ...(d.bondRot != null ? { rot: d.bondRot } : {}) } : x));
    }
    setAttachHint(null);
    drag.current = null;
    setPanning(false);
    try { svgRef.current.releasePointerCapture(e.pointerId); } catch (_) {}
  };

  const closePoly = () => {
    if (draftPoly && draftPoly.length >= 3) {
      pushHistory();
      const pc = { id: uid(), points: draftPoly };
      setParcels((a) => [...a, pc]);
      requestFit();
    }
    setDraftPoly(null);
    setTool("select");
  };
  const closeElPoly = () => {
    if (draftElPoly && draftElPoly.pts.length >= 3) {
      const el = { id: uid(), type: draftElPoly.type, points: draftElPoly.pts, rot: 0 };
      setEls((a) => [...a, el]);
      setSel({ kind: "el", id: el.id });
    }
    setDraftElPoly(null);
    setTool("select");
  };
  const onBgDouble = () => { if (tool === "parcel") closePoly(); else if (tool === "split") finishSplit(); else if (tool === "measure") finishMeasure(); else if (draftElPoly) closeElPoly(); };

  const addRectParcel = () => {
    const w = Math.max(20, +lotW || 0), d = Math.max(20, +lotD || 0);
    pushHistory();
    const pc = { id: uid(), points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }] };
    setParcels((a) => [...a, pc]);
    requestFit();
  };

  /* ------------ aerial underlay ------------ */
  const onUnderlayFile = async (file) => {
    if (!file) return;
    try {
      const { src, w, h } = await loadAndDownscaleImage(file);
      pushHistory();
      // Start at ~600 ft across the image width; the user calibrates precisely next.
      // Auto-locked (click-through) so you can immediately draw over it.
      setUnderlay({ src, imgW: w, imgH: h, x: 0, y: 0, ftPerPx: 600 / w, opacity: 1, locked: true });
      setUnderlayErr(false);
      setUnderlayLoading(true);
      setCalib(null);
      requestFit();
    } catch (err) {
      alert(humanizeError(err));
    }
  };
  const startMoveUnderlay = (e) => {
    if (tool !== "select" || e.button !== 0 || !underlay || underlay.locked) return;
    e.stopPropagation();
    const fp = p2f(e.clientX, e.clientY);
    setSel(null);
    pushHistory();
    drag.current = { mode: "moveUnderlay", fx: fp.x, fy: fp.y, ox: underlay.x, oy: underlay.y };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const applyCalibration = () => {
    const knownFt = +calibInput;
    if (!underlay || !calib?.a || !calib?.b || !(knownFt > 0)) return;
    const measured = dist(calib.a, calib.b);
    if (measured <= 0) return;
    const factor = knownFt / measured;
    const sy = underlay.ftPerPxY || underlay.ftPerPx;
    const newFtPerPx = underlay.ftPerPx * factor;
    const newSy = sy * factor;
    // image-pixel coords of point a under the current placement
    const aPxX = (calib.a.x - underlay.x) / underlay.ftPerPx;
    const aPxY = (calib.a.y - underlay.y) / sy;
    pushHistory();
    // keep point a pinned in world space so the image scales about that point
    setUnderlay((u) => ({ ...u, ftPerPx: newFtPerPx, ftPerPxY: u.ftPerPxY ? newSy : undefined, x: calib.a.x - aPxX * newFtPerPx, y: calib.a.y - aPxY * newSy }));
    setCalib(null);
    setCalibInput("");
    setTool("select");
  };

  /* ------------ county parcel lookup ------------ */
  const onCountyChange = (key) => {
    setCounty(key);
    const c = COUNTIES[key];
    setLookupUrl(c.layerUrl || c.serviceUrl || "");
    setLookupRes([]);
    setLookupErr("");
  };
  const runLookup = async () => {
    setLookupErr(""); setLookupRes([]);
    const v = searchVal.trim();
    if (!v) { setLookupErr("Type an account number or address to search."); return; }
    setLookupBusy(true);
    try {
      const layerUrl = await resolveLayerUrl(lookupUrl.trim());
      const meta = await getLayerInfo(layerUrl);
      const idField = detectField(meta.fields, "id") || COUNTIES[county]?.idField;
      const addrField = detectField(meta.fields, "address") || COUNTIES[county]?.addrField;
      const esc = v.replace(/'/g, "''");
      let where;
      if (searchMode === "id") {
        if (!idField) throw new Error("No account/parcel-id field on this layer — try an address search.");
        const fld = meta.fields.find((f) => f.name === idField);
        const numeric = fld && /integer|double|single|oid|smallinteger/i.test(fld.type);
        where = numeric && /^\d+$/.test(v) ? `${idField} = ${v}` : `UPPER(${idField}) LIKE UPPER('%${esc}%')`;
      } else {
        if (!addrField) throw new Error("No address field on this layer — try an account/ID search.");
        where = `UPPER(${addrField}) LIKE UPPER('%${esc}%')`;
      }
      const feats = await queryFeatures(layerUrl, { where, count: 10 });
      if (!feats.length) { setLookupErr("No matches. Check spelling, try a shorter/partial value, or switch search mode."); return; }
      setLookupRes(feats.map((ft) => ({ ft, layerUrl, idField, addrField })));
    } catch (err) {
      setLookupErr(humanizeError(err));
    } finally {
      setLookupBusy(false);
    }
  };
  const importFeature = (entry) => {
    const pts = featureToParcel(entry.ft);
    if (!pts || pts.length < 3) { setLookupErr("That record has no usable polygon geometry."); return; }
    pushHistory();
    const pc = { id: uid(), points: pts };
    setParcels((a) => [...a, pc]);
    setSel({ kind: "parcel", id: pc.id });
    setLookupRes([]);
    requestFit();
  };

  /* ------------ element / handle interactions ------------ */
  // Attachment: an element may be bonded to a host (attachedTo). Bonded members
  // move and rotate as one assembly and can't be separated by dragging.
  const rootIdOf = (id) => { const el = els.find((x) => x.id === id); return (el && el.attachedTo) || id; };
  const assemblyOf = (id) => { const r = rootIdOf(id); return els.filter((e) => e.id === r || e.attachedTo === r); };
  const isAxisRect = (el) => !el.points && (((el.rot % 360) + 360) % 360) === 0;
  // Axis-aligned bounding box of a rect element at any quarter-turn (0/90/180/270),
  // swapping w/h for 90/270. Returns {cx,cy,w,h,rot:0} or null if not orthogonal.
  const ortho = (el) => {
    if (el.points) return null;
    const r = (((el.rot || 0) % 360) + 360) % 360;
    if (r % 90 !== 0) return null;
    const swap = r === 90 || r === 270;
    return { id: el.id, cx: el.cx, cy: el.cy, w: swap ? el.h : el.w, h: swap ? el.w : el.h, rot: 0 };
  };
  // Align a dragged rect to a nearby host's angle and snap it flush in the host's
  // own frame — so an off-angle element drops onto a rotated building/sidewalk.
  // Returns { cx, cy, rot, hostId, hintX, hintY } or null.
  const alignSnap = (gel, ncx, ncy, cands, thr) => {
    let best = null;
    for (const host of cands) {
      const th = host.rot || 0;
      const q = (((Math.round((gel.rot - th) / 90)) % 4) + 4) % 4; // quarter-turns off the host
      const swap = q === 1 || q === 3;
      const gbw = swap ? gel.h : gel.w, gbh = swap ? gel.w : gel.h;
      const loc = rot2(ncx - host.cx, ncy - host.cy, -th);          // grabbed centre in host frame
      const box = [{ id: host.id, cx: 0, cy: 0, w: host.w, h: host.h, rot: 0 }];
      const sc = edgeSnapCenter({ cx: loc.x, cy: loc.y, w: gbw, h: gbh }, box, thr);
      const hit = flushContact({ cx: sc.cx, cy: sc.cy, w: gbw, h: gbh, rot: 0 }, box, 6);
      if (!hit) continue;
      const back = rot2(sc.cx, sc.cy, th);
      const cx = host.cx + back.x, cy = host.cy + back.y, move2 = (cx - ncx) ** 2 + (cy - ncy) ** 2;
      if (!best || move2 < best.move2) {
        const hp = rot2(hit.x, hit.y, th);
        best = { cx, cy, rot: ((th + q * 90) % 360 + 360) % 360, hostId: host.id, hintX: host.cx + hp.x, hintY: host.cy + hp.y, move2 };
      }
    }
    return best;
  };
  const attachTo = (childId, hostId) => {
    if (childId === hostId) return;
    const hostRoot = rootIdOf(hostId);
    if (hostRoot === childId) return; // don't bond a host to its own child
    pushHistory();
    setEls((a) => a.map((e) => (e.id === childId ? { ...e, attachedTo: hostRoot } : e)));
    setSel({ kind: "el", id: childId });
  };
  const detach = (id) => {
    pushHistory();
    setEls((a) => a.map((e) => { if (e.id !== id) return e; const { attachedTo, ...rest } = e; return rest; }));
  };
  // Find an axis-aligned rect element that `m` is sitting flush against (a shared
  // edge with real overlap). Returns { id, x, y } where x,y is the contact-edge
  // midpoint (for the snap/attach indicator), or null.
  const flushContact = (m, others, eps) => {
    if (m.points || !isAxisRect(m)) return null;
    const mx0 = m.cx - m.w / 2, mx1 = m.cx + m.w / 2, my0 = m.cy - m.h / 2, my1 = m.cy + m.h / 2;
    let best = null;
    for (const t of others) {
      if (t.points || !isAxisRect(t)) continue;
      const tx0 = t.cx - t.w / 2, tx1 = t.cx + t.w / 2, ty0 = t.cy - t.h / 2, ty1 = t.cy + t.h / 2;
      const ya = Math.max(my0, ty0), yb = Math.min(my1, ty1), yov = yb - ya;
      const xa = Math.max(mx0, tx0), xb = Math.min(mx1, tx1), xov = xb - xa;
      if (yov > 5) {
        if (Math.abs(mx0 - tx1) <= eps && (!best || yov > best.ov)) best = { id: t.id, x: tx1, y: (ya + yb) / 2, ov: yov };
        if (Math.abs(mx1 - tx0) <= eps && (!best || yov > best.ov)) best = { id: t.id, x: tx0, y: (ya + yb) / 2, ov: yov };
      }
      if (xov > 5) {
        if (Math.abs(my0 - ty1) <= eps && (!best || xov > best.ov)) best = { id: t.id, x: (xa + xb) / 2, y: ty1, ov: xov };
        if (Math.abs(my1 - ty0) <= eps && (!best || xov > best.ov)) best = { id: t.id, x: (xa + xb) / 2, y: ty0, ov: xov };
      }
    }
    return best;
  };
  // Sidewalks / parking / trailer fields attached to a building track the wall
  // they hug when the building is resized. At drag start, capture each child in
  // the building's LOCAL frame: which wall it hugs (the axis it sits outside of),
  // its fixed depth, and its position/length along the wall.
  const WALL_KID_TYPES = ["sidewalk", "parking", "trailer", "paving"];
  // noFit children (dog-ears, the rotated opposite-dock trailer strip) keep their
  // fixed size/position when the building is resized instead of scaling with a wall.
  const wallKids = (b) => els.filter((x) => x.attachedTo === b.id && !x.noFit && WALL_KID_TYPES.includes(x.type) && !x.points).map((c) => {
    const l = rot2(c.cx - b.cx, c.cy - b.cy, -b.rot); // child centre in the building's local frame
    const outX = Math.abs(l.x) - b.w / 2, outY = Math.abs(l.y) - b.h / 2;
    const perpIsY = outY >= outX; // hugs a horizontal (top/bottom) wall → perpendicular axis is Y
    // perpGap = clearance between the child's near face and the building edge
    // (0 when flush; e.g. a sidewalk's width when parking sits beyond a sidewalk).
    return perpIsY
      ? { id: c.id, perpIsY: true, sidePerp: l.y >= 0 ? 1 : -1, perpDepth: c.h, perpGap: Math.abs(l.y) - b.h / 2 - c.h / 2, alongCenter: l.x, alongHalf: c.w / 2, oldAlongHalf: b.w / 2 }
      : { id: c.id, perpIsY: false, sidePerp: l.x >= 0 ? 1 : -1, perpDepth: c.w, perpGap: Math.abs(l.x) - b.w / 2 - c.w / 2, alongCenter: l.y, alongHalf: c.h / 2, oldAlongHalf: b.h / 2 };
  });
  // ...then re-fit each child: it stays flush against the wall and keeps its
  // depth, while its length/position ALONG the wall scale with that wall.
  const fitKid = (nb, k) => {
    const newAlongHalf = (k.perpIsY ? nb.w : nb.h) / 2;
    const newPerpHalf = (k.perpIsY ? nb.h : nb.w) / 2;
    const ratio = k.oldAlongHalf ? newAlongHalf / k.oldAlongHalf : 1;
    const along = k.alongCenter * ratio;          // position along the wall
    const alongDim = 2 * k.alongHalf * ratio;      // length along the wall
    const perp = k.sidePerp * (newPerpHalf + k.perpDepth / 2 + Math.max(0, k.perpGap || 0)); // keep its clearance outside the wall
    const lx = k.perpIsY ? along : perp, ly = k.perpIsY ? perp : along;
    const w = k.perpIsY ? alongDim : k.perpDepth, h = k.perpIsY ? k.perpDepth : alongDim;
    const off = rot2(lx, ly, nb.rot);
    return { cx: nb.cx + off.x, cy: nb.cy + off.y, w, h, rot: ((nb.rot % 360) + 360) % 360 };
  };
  // Add a sidewalk strip flush against whichever side of the building was clicked.
  const SIDEWALK_W = 5;
  const TRUCK_COURT_D = 135; // truck dock apron + drive depth
  const DOGEAR_W = 55;       // dog-ear / corner bump-out: along the dock wall
  const DOGEAR_D = 60;       // dog-ear projection out from the dock face
  const OPP_TRAILER_D = 50;  // trailer-parking depth on the side opposite the docks
  const OPP_TRAILER_W = 12;  // trailer stall width for that strip
  const SIDE_N = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
  // Resolve a building's dock side(s) and the side opposite a single-load dock.
  const dockSidesOf = (el) => {
    const dock = el.dock || "single";
    const dside = el.dockSide || (el.w >= el.h ? "bottom" : "right");
    if (dock === "none") return { dside, dockSides: [], opp: null };
    if (dock === "cross") return { dside, dockSides: (dside === "top" || dside === "bottom") ? ["top", "bottom"] : ["left", "right"], opp: null };
    return { dside, dockSides: [dside], opp: { top: "bottom", bottom: "top", left: "right", right: "left" }[dside] };
  };
  // Build (don't commit) a full-wall strip element flush against one building side.
  const makeStrip = (b, nx, ny, type, depth, extra = {}) => {
    const w = nx !== 0 ? depth : b.w;
    const h = ny !== 0 ? depth : b.h;
    const off = rot2(nx * (b.w / 2 + depth / 2), ny * (b.h / 2 + depth / 2), b.rot);
    return { id: uid(), type, cx: b.cx + off.x, cy: b.cy + off.y, w, h, rot: ((b.rot % 360) + 360) % 360, attachedTo: b.id, ...extra };
  };
  // Build a 55′×60′ dog-ear bump-out at one corner (sign = ±1 along the wall) of a dock side.
  const makeDogEar = (b, nx, ny, sign) => {
    const alongIsX = ny !== 0; // horizontal (top/bottom) dock wall → corners spread along X
    const w = alongIsX ? DOGEAR_W : DOGEAR_D;
    const h = alongIsX ? DOGEAR_D : DOGEAR_W;
    const lx = alongIsX ? sign * (b.w / 2 + DOGEAR_W / 2) : nx * (b.w / 2 + DOGEAR_D / 2);
    const ly = alongIsX ? ny * (b.h / 2 + DOGEAR_D / 2) : sign * (b.h / 2 + DOGEAR_W / 2);
    const off = rot2(lx, ly, b.rot);
    return { id: uid(), type: "paving", cx: b.cx + off.x, cy: b.cy + off.y, w, h, rot: ((b.rot % 360) + 360) % 360, attachedTo: b.id, noFit: true };
  };
  // Commit a batch of building-attached elements in one history step.
  const addBuildingEls = (list, hostId) => { if (!list.length) return; pushHistory(); setEls((a) => [...a, ...list]); setSel({ kind: "el", id: hostId }); };
  // Add a strip element of `type`/`depth` flush against one side of the building
  // (local normal nx,ny), full wall length, bonded to the building. Keeps the
  // building selected so several can be added in a row.
  const addStripSide = (b, nx, ny, type, depth, extra = {}) => addBuildingEls([makeStrip(b, nx, ny, type, depth, extra)], b.id);
  // Striped 50′-deep, 12′-stall trailer parking on the side opposite a single-load
  // dock. Oriented so the stalls stripe ALONG the wall (rotate +90 on a side wall).
  const makeOppTrailer = (b, name) => {
    const [nx, ny] = SIDE_N[name];
    const horiz = ny !== 0;                 // top/bottom wall → stalls run along X
    const depth = OPP_TRAILER_D, along = horiz ? b.w : b.h;
    const off = rot2(nx * (b.w / 2 + depth / 2), ny * (b.h / 2 + depth / 2), b.rot);
    return {
      id: uid(), type: "trailer", cx: b.cx + off.x, cy: b.cy + off.y,
      w: along, h: depth, rot: ((b.rot + (horiz ? 0 : 90)) % 360 + 360) % 360,
      attachedTo: b.id, noFit: true, cfg: { trailerW: OPP_TRAILER_W, trailerL: OPP_TRAILER_D, trailerAisle: 0, single: true },
    };
  };
  const addOppTrailer = (b, name) => addBuildingEls([makeOppTrailer(b, name)], b.id);
  // 135′ truck court on every dock side.
  const addTruckCourt = (b) => { const { dockSides } = dockSidesOf(b); addBuildingEls(dockSides.map((s) => makeStrip(b, ...SIDE_N[s], "paving", TRUCK_COURT_D)), b.id); };
  // Dog-ears at both corners of every dock side.
  const addDogEars = (b) => {
    const { dockSides } = dockSidesOf(b);
    const list = [];
    dockSides.forEach((s) => { const [nx, ny] = SIDE_N[s]; list.push(makeDogEar(b, nx, ny, 1), makeDogEar(b, nx, ny, -1)); });
    addBuildingEls(list, b.id);
  };
  // Trailer parking opposite the dock (single-load only).
  const addOppTrailerAll = (b) => { const { opp } = dockSidesOf(b); if (opp) addOppTrailer(b, opp); };
  const addSidewalk = (b, clickFp) => {
    const local = rot2(clickFp.x - b.cx, clickFp.y - b.cy, -b.rot);
    let nx = 0, ny = 0;
    if (Math.abs(local.x) / (b.w / 2) >= Math.abs(local.y) / (b.h / 2)) nx = local.x >= 0 ? 1 : -1;
    else ny = local.y >= 0 ? 1 : -1;
    addStripSide(b, nx, ny, "sidewalk", SIDEWALK_W);
  };
  const startMoveEl = (e, id) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    const el = els.find((x) => x.id === id);
    const fp = p2f(e.clientX, e.clientY);
    if (sidewalkFor) { // placing a sidewalk: this click picks the building side
      if (el && el.id === sidewalkFor && !el.points) addSidewalk(el, fp);
      setSidewalkFor(null);
      return;
    }
    if (attachFor) { // bonding: this click picks the host to attach to
      if (el) attachTo(attachFor, el.id);
      setAttachFor(null);
      return;
    }
    if (el && el.locked) { setSel({ kind: "el", id }); return; } // locked: select only, don't move
    setSel({ kind: "el", id });
    pushHistory();
    // Snapshot every member of the assembly so they move together.
    const members = assemblyOf(id).map((m) => m.points
      ? { id: m.id, points: m.points }
      : { id: m.id, cx: m.cx, cy: m.cy, w: m.w, h: m.h });
    // Bonding (Shift-drag / snap) can only attach a free, rectangular element
    // that isn't already a host of something else. Shift is read live in onMove.
    const canAttach = !el.attachedTo && !el.points && !els.some((x) => x.attachedTo === id);
    drag.current = { mode: "move", kind: "el", id, fx: fp.x, fy: fp.y, members, canAttach };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const startMoveParcel = (e, id) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    const pc = parcels.find((x) => x.id === id);
    const fp = p2f(e.clientX, e.clientY);
    setSel({ kind: "parcel", id });
    pushHistory();
    drag.current = { mode: "move", kind: "parcel", id, fx: fp.x, fy: fp.y, opts: pc.points };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  // Pin a building's dock to its current side before a resize, so growing the
  // long axis can't flip the loading dock to a different face.
  const freezeDockSide = (el) => {
    if (el.type === "building" && !el.dockSide) {
      const side = el.w >= el.h ? "bottom" : "right";
      setEls((a) => a.map((x) => x.id === el.id ? { ...x, dockSide: side } : x));
    }
  };
  const startResize = (e, id, sx, sy) => {
    e.stopPropagation();
    const el = els.find((x) => x.id === id);
    freezeDockSide(el);
    // fixed opposite corner in world feet
    const oppLocal = rot2(-sx * el.w / 2, -sy * el.h / 2, el.rot);
    const opp = { x: el.cx + oppLocal.x, y: el.cy + oppLocal.y };
    pushHistory();
    drag.current = { mode: "resize", id, sx, sy, opp, kids: wallKids(el) };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const startEdgeResize = (e, id, nx, ny) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    const el = els.find((x) => x.id === id);
    freezeDockSide(el);
    // midpoint of the opposite edge stays fixed (world feet)
    const oppLocal = rot2(-nx * el.w / 2, -ny * el.h / 2, el.rot);
    const opp = { x: el.cx + oppLocal.x, y: el.cy + oppLocal.y };
    pushHistory();
    drag.current = { mode: "edgeResize", id, nx, ny, opp, kids: wallKids(el) };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const startRotate = (e, id) => {
    e.stopPropagation();
    const el = els.find((x) => x.id === id);
    const fp = p2f(e.clientX, e.clientY);
    const pivot = { x: el.cx, y: el.cy };
    const startPtr = (Math.atan2(fp.y - pivot.y, fp.x - pivot.x) * 180) / Math.PI;
    // Rotate the whole assembly about this element's centre.
    const start = assemblyOf(id).map((m) => m.points
      ? { id: m.id, points: m.points }
      : { id: m.id, cx: m.cx, cy: m.cy, rot: m.rot });
    pushHistory();
    drag.current = { mode: "rotate", id, pivot, startPtr, start };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  // Double- or right-click an element to open its actions menu (dock / sidewalk / attach).
  const onElDouble = (e, id) => {
    e.stopPropagation();
    const el = els.find((x) => x.id === id);
    if (!el) return;
    setSel({ kind: "el", id });
    setTypeMenu({ id, x: e.clientX, y: e.clientY });
  };
  const setDockOf = (id, dock) => {
    pushHistory();
    setEls((a) => a.map((el) => (el.id === id ? { ...el, dock } : el)));
  };
  const toggleLock = (id) => {
    pushHistory();
    setEls((a) => a.map((el) => (el.id === id ? { ...el, locked: !el.locked } : el)));
  };
  const setDockSideOf = (id, side) => {
    pushHistory();
    setEls((a) => a.map((el) => (el.id === id ? { ...el, dockSide: side, dock: (el.dock && el.dock !== "none") ? el.dock : "single" } : el)));
  };

  /* ------------ metrics ------------ */
  // Per-element striping/count config: a strip may override the global standards
  // (e.g. the 50′ × 12′ single-row trailer parking carries its own cfg).
  const cfgOf = (el) => (el.cfg ? { ...settings, ...el.cfg } : settings);
  const siteSqft = parcels.reduce((s, p) => s + polyArea(p.points), 0);
  let bldg = 0, paving = 0, parkArea = 0, trailArea = 0, pondArea = 0, stalls = 0, trailers = 0;
  els.forEach((e) => {
    const a = e.points ? polyArea(e.points) : e.w * e.h;
    if (e.type === "building") bldg += a;
    else if (e.type === "paving" || e.type === "sidewalk" || e.type === "road") paving += a;
    else if (e.type === "parking") { parkArea += a; stalls += e.points ? estStalls(a, settings) : carStalls(e.w, e.h, settings).count; }
    else if (e.type === "trailer") { trailArea += a; trailers += e.points ? estTrailers(a, settings) : trailerStalls(e.w, e.h, cfgOf(e)).count; }
    else if (e.type === "pond") pondArea += a;
  });
  const impervious = bldg + paving + parkArea + trailArea;
  const cov = siteSqft ? (bldg / siteSqft) * 100 : 0;
  const far = siteSqft ? bldg / siteSqft : 0; // single-story assumption
  const impPct = siteSqft ? (impervious / siteSqft) * 100 : 0;
  const ratio = bldg ? stalls / (bldg / 1000) : 0;
  const open = Math.max(0, siteSqft - impervious - pondArea);

  /* ------------ scenarios (localStorage) ------------ */
  const refreshScen = useCallback(async () => {
    try {
      const r = await storage.list("scenario:");
      setScenList((r?.keys || []).map((k) => k.replace("scenario:", "")));
    } catch (_) { setScenList([]); }
  }, []);
  useEffect(() => { refreshScen(); }, [refreshScen]);

  const saveScen = async () => {
    const name = scenName.trim();
    if (!name) return;
    try {
      await storage.set(`scenario:${name}`, JSON.stringify({ parcels, els, measures, settings, underlay }));
      setScenName("");
      refreshScen();
    } catch (err) {
      alert("Could not save — likely too large for browser storage (a big underlay image). Use Export JSON instead.");
    }
  };
  const loadScen = async () => {
    if (!scenPick) return;
    try {
      const r = await storage.get(`scenario:${scenPick}`);
      if (r?.value) {
        const d = JSON.parse(r.value);
        ensureIdAbove([...(d.parcels || []).map((p) => p.id), ...(d.els || []).map((e) => e.id)]);
        setParcels(d.parcels || []); setEls(d.els || []); setMeasures(d.measures || []);
        setSettings({ ...DEFAULT_SETTINGS, ...(d.settings || {}) });
        setUnderlay(d.underlay || null);
        setSel(null);
        requestFit();
      }
    } catch (_) {}
  };
  const delScen = async () => {
    if (!scenPick) return;
    try { await storage.delete(`scenario:${scenPick}`); setScenPick(""); refreshScen(); } catch (_) {}
  };
  const importRef = useRef(null);
  const importJSONFile = (file) => {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const d = JSON.parse(fr.result);
        if (!d || (!Array.isArray(d.parcels) && !Array.isArray(d.els))) throw new Error();
        ensureIdAbove([...(d.parcels || []).map((p) => p.id), ...(d.els || []).map((e) => e.id)]);
        pushHistory();
        setParcels(d.parcels || []); setEls(d.els || []); setMeasures(d.measures || []);
        setSettings((s) => ({ ...s, ...(d.settings || {}) }));
        setUnderlay(d.underlay || null);
        setSel(null);
        requestFit();
      } catch (_) { alert("That file doesn't look like a Planar Fit export."); }
    };
    fr.readAsText(file);
  };
  const siteName = useMemo(() => loadSite(siteId)?.name || "Site plan", [siteId]);
  const fileSlug = () => (siteName || "site-plan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "site-plan";
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify({ parcels, els, measures, settings, underlay }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileSlug()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* ------------ export (PNG / print-to-PDF) ------------ */
  // Snapshot the live SVG cropped to the site, with editor chrome (grid,
  // handles, scale bar) stripped via data-export="skip" tags.
  const buildExportSvg = () => {
    let pts = [];
    parcels.forEach((p) => pts.push(...p.points));
    els.forEach((e) => (e.points ? pts.push(...e.points) : pts.push(...elCorners(e))));
    if (!pts.length && underlay) {
      const sy = underlay.ftPerPxY || underlay.ftPerPx;
      pts = [{ x: underlay.x, y: underlay.y }, { x: underlay.x + underlay.imgW * underlay.ftPerPx, y: underlay.y + underlay.imgH * sy }];
    }
    if (!pts.length || !svgRef.current) return null;
    const PAD = 60; // ft of margin around the site
    const minX = Math.min(...pts.map((p) => p.x)) - PAD, maxX = Math.max(...pts.map((p) => p.x)) + PAD;
    const minY = Math.min(...pts.map((p) => p.y)) - PAD, maxY = Math.max(...pts.map((p) => p.y)) + PAD;
    const a = f2p({ x: minX, y: minY }), b = f2p({ x: maxX, y: maxY });
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    const clone = svgRef.current.cloneNode(true);
    clone.querySelectorAll('[data-export="skip"]').forEach((n) => n.remove());
    clone.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    clone.setAttribute("width", Math.round(w));
    clone.setAttribute("height", Math.round(h));
    clone.removeAttribute("style");
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", x); bg.setAttribute("y", y); bg.setAttribute("width", w); bg.setAttribute("height", h);
    bg.setAttribute("fill", PAL.paper);
    clone.insertBefore(bg, clone.firstChild);
    return { clone, w, h };
  };
  const exportPNG = async () => {
    const built = buildExportSvg();
    if (!built) { alert("Nothing to export yet — add a parcel or some elements first."); return; }
    const { clone, w, h } = built;
    // Rasterizing an SVG can't fetch external resources, so inline the aerial.
    for (const img of clone.querySelectorAll("image")) {
      const href = img.getAttribute("href") || img.getAttributeNS("http://www.w3.org/1999/xlink", "href");
      if (href && !href.startsWith("data:")) {
        try {
          const blob = await fetch(href, { mode: "cors" }).then((r) => { if (!r.ok) throw new Error(); return r.blob(); });
          const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
          img.setAttribute("href", dataUrl);
        } catch (_) { img.remove(); } // aerial blocked → export the plan without it
      }
    }
    const xml = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      await new Promise((res, rej) => { image.onload = res; image.onerror = rej; image.src = url; });
      const scale = Math.max(1, Math.min(3, 3500 / Math.max(w, h))); // crisp but bounded
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((png) => {
        if (!png) return;
        const aEl = document.createElement("a");
        aEl.href = URL.createObjectURL(png);
        aEl.download = `${fileSlug()}.png`;
        aEl.click();
        URL.revokeObjectURL(aEl.href);
      }, "image/png");
    } finally { URL.revokeObjectURL(url); }
  };
  const printPDF = () => {
    const built = buildExportSvg();
    if (!built) { alert("Nothing to print yet — add a parcel or some elements first."); return; }
    const xml = new XMLSerializer().serializeToString(built.clone);
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const rows = [
      ["Site area", `${f2(siteSqft / SQFT_PER_ACRE)} ac (${f0(siteSqft)} sf)`],
      ["Building", `${f0(bldg)} sf`],
      ["Lot coverage", `${f0(cov)}%`],
      ["FAR (1-story)", f2(far)],
      ["Car stalls", `${f0(stalls)}${ratio ? ` (${f2(ratio)}/1k sf)` : ""}`],
      ["Trailer stalls", f0(trailers)],
      ["Impervious", `${f0(impPct)}%`],
      ["Detention", `${f0(pondArea)} sf`],
      ["Open / green", `${f2(open / SQFT_PER_ACRE)} ac`],
    ];
    const win = window.open("", "_blank");
    if (!win) { alert("Pop-up blocked — allow pop-ups for this site to print."); return; }
    win.document.write(`<!doctype html><html><head><title>${esc(siteName)}</title><style>
      @page { size: letter landscape; margin: 11mm; }
      body { font-family: "Helvetica Neue", Helvetica, system-ui, sans-serif; color: #26231e; margin: 0; }
      header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #26231e; padding-bottom: 6px; margin-bottom: 10px; }
      h1 { font-size: 17px; margin: 0; } .sub { font-size: 11px; color: #6b6557; }
      .wrap { display: flex; gap: 14px; align-items: flex-start; }
      .plan { flex: 1; min-width: 0; } .plan svg { width: 100%; height: auto; border: 1px solid #d8d2c2; }
      table { border-collapse: collapse; font-size: 11px; width: 200px; }
      td { padding: 4px 6px; border-bottom: 1px solid #eee8da; } td:last-child { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
      footer { margin-top: 8px; font-size: 9.5px; color: #8a8473; }
    </style></head><body>
      <header><h1>${esc(siteName)}</h1><span class="sub">${new Date().toLocaleDateString()} · Planar Fit</span></header>
      <div class="wrap">
        <div class="plan">${xml}</div>
        <table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
      </div>
      <footer>Concept site plan — areas and counts are planning-level estimates, not a survey.</footer>
    </body></html>`);
    win.document.close();
    // Print once the aerial has loaded (or after a beat if it's cached/absent).
    const go = () => setTimeout(() => { try { win.focus(); win.print(); } catch (_) {} }, 350);
    if (win.document.readyState === "complete") go(); else win.onload = go;
  };

  /* ------------ grid lines ------------ */
  const gridLines = () => {
    const out = [];
    const minF = p2fStatic(0, 0), maxF = p2fStatic(size.w, size.h);
    const step = settings.gridSize;
    const major = step * 10;
    const startX = Math.floor(minF.x / step) * step, endX = Math.ceil(maxF.x / step) * step;
    const startY = Math.floor(minF.y / step) * step, endY = Math.ceil(maxF.y / step) * step;
    // cap line count for performance at low zoom
    if ((endX - startX) / step > 600 || (endY - startY) / step > 600) {
      // only majors
      for (let x = Math.floor(minF.x / major) * major; x <= maxF.x; x += major) {
        const px = x * view.ppf + view.offX;
        out.push(<line key={`gx${x}`} x1={px} y1={0} x2={px} y2={size.h} stroke={PAL.gridMajor} strokeWidth={1} />);
      }
      for (let y = Math.floor(minF.y / major) * major; y <= maxF.y; y += major) {
        const py = y * view.ppf + view.offY;
        out.push(<line key={`gy${y}`} x1={0} y1={py} x2={size.w} y2={py} stroke={PAL.gridMajor} strokeWidth={1} />);
      }
      return out;
    }
    for (let x = startX; x <= endX; x += step) {
      const px = x * view.ppf + view.offX;
      out.push(<line key={`gx${x}`} x1={px} y1={0} x2={px} y2={size.h} stroke={Math.round(x) % major === 0 ? PAL.gridMajor : PAL.gridMinor} strokeWidth={1} />);
    }
    for (let y = startY; y <= endY; y += step) {
      const py = y * view.ppf + view.offY;
      out.push(<line key={`gy${y}`} x1={0} y1={py} x2={size.w} y2={py} stroke={Math.round(y) % major === 0 ? PAL.gridMajor : PAL.gridMinor} strokeWidth={1} />);
    }
    return out;
  };
  // static p2f that doesn't need the DOM rect (uses view only, origin at svg 0,0)
  const p2fStatic = (px, py) => ({ x: (px - view.offX) / view.ppf, y: (py - view.offY) / view.ppf });

  /* labels + handles in screen space */
  // Labels scale with zoom so they stay proportional to the plan when zoomed
  // out (no ballooning chips), capping at a comfortable size when zoomed in.
  const ls = Math.max(0.34, Math.min(1, view.ppf / 0.45));
  const NO_LABEL = ["paving", "parking", "road"]; // truck courts / employee parking / roads stay unlabelled
  const labelEls = els.map((el) => {
    if (NO_LABEL.includes(el.type)) return null;
    const poly = !!el.points;
    const area = poly ? polyArea(el.points) : el.w * el.h;
    const c = f2p(poly ? centroid(el.points) : { x: el.cx, y: el.cy });
    let lines;
    if (el.type === "sidewalk") {
      // e.g. "5′ Sidewalk" — width only, no sf / length
      lines = [poly ? "Sidewalk" : `${f0(Math.min(el.w, el.h))}′ Sidewalk`];
    } else if (el.type === "pond") {
      lines = ["Detention Pond", `${f0(area)} sf`]; // SF only, no linear dimensions
    } else {
      lines = [TYPE[el.type].label.split(" / ")[0]];
      if (el.type === "trailer") lines.push(`${f0(poly ? estTrailers(area, settings) : trailerStalls(el.w, el.h, cfgOf(el)).count)} trailers${poly ? " (est)" : ""}`);
      else lines.push(`${f0(area)} sf`);
      lines.push(poly ? `${f2(area / SQFT_PER_ACRE)} ac` : `${f0(el.w)}′ × ${f0(el.h)}′`);
    }
    const fs = 11 * ls, lh = 14.5 * ls;
    // Element fills are solid, so labels need no chip — just contrasting text.
    const top = c.y - (lines.length * lh) / 2, first = top + fs * 0.82;
    const ink = labelInk(elStyle(el, settings).fill);
    return (
      <g key={`lbl${el.id}`} pointerEvents="none">
        {el.locked && <text x={c.x} y={top - 3 * ls} textAnchor="middle" fontSize={12 * ls}>🔒</text>}
        <text x={c.x} y={first} textAnchor="middle" fontSize={fs}
          fontFamily="ui-monospace, Menlo, monospace" fill={ink} style={{ fontWeight: 600, letterSpacing: "0.02em" }}>
          {lines.map((t, i) => <tspan key={i} x={c.x} dy={i === 0 ? 0 : lh}>{t}</tspan>)}
        </text>
      </g>
    );
  });

  const parcelLabels = parcels.map((pc) => {
    const c = f2p(centroid(pc.points));
    const txt = `${f2(polyArea(pc.points) / SQFT_PER_ACRE)} ac`;
    const fs = 12 * ls, padX = 9 * ls, padY = 5 * ls, charW = fs * 0.6;
    const boxW = txt.length * charW + padX * 2, boxH = fs + padY * 2;
    return (
      <g key={`pl${pc.id}`} pointerEvents="none">
        <rect x={c.x - boxW / 2} y={c.y - boxH / 2} width={boxW} height={boxH} rx={7 * ls}
          fill="rgba(17,24,39,0.62)" stroke="rgba(255,255,255,0.14)" strokeWidth={1} />
        <text x={c.x} y={c.y - boxH / 2 + padY + fs * 0.82} textAnchor="middle" fontSize={fs}
          fontFamily="ui-monospace, Menlo, monospace" fill="#e9edf2" style={{ fontWeight: 500, letterSpacing: "0.02em" }}>{txt}</text>
      </g>
    );
  });

  // Dashed tethers between the selected element and anything bonded to it.
  const attachLinks = (() => {
    if (sel?.kind !== "el") return null;
    const members = assemblyOf(sel.id);
    if (members.length < 2) return null;
    const ctr = (m) => (m.points ? centroid(m.points) : { x: m.cx, y: m.cy });
    const sc = f2p(ctr(els.find((x) => x.id === sel.id)));
    return (
      <g pointerEvents="none">
        {members.filter((m) => m.id !== sel.id).map((m) => {
          const p = f2p(ctr(m));
          return <line key={`lk${m.id}`} x1={sc.x} y1={sc.y} x2={p.x} y2={p.y} stroke={PAL.accent} strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />;
        })}
      </g>
    );
  })();

  // "+" quick-add handles on a selected building:
  //  • dock side(s): a 135′ truck dock + drive (orange)
  //  • side opposite a single-load dock: 50′ striped trailer parking (teal)
  //  • other sides: a 5′ sidewalk (green)
  //  • each dock-side corner: a 55′×60′ dog-ear / bump-out (purple)
  const plusNode = (key, pos, fill, title, onAdd, r = 9) => (
    <g key={key} style={{ cursor: "pointer" }} onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); onAdd(); }}>
      <title>{title}</title>
      <circle cx={pos.x} cy={pos.y} r={r} fill={fill} stroke="#ffffff" strokeWidth={1.75} />
      <line x1={pos.x - r * 0.5} y1={pos.y} x2={pos.x + r * 0.5} y2={pos.y} stroke="#ffffff" strokeWidth={1.75} />
      <line x1={pos.x} y1={pos.y - r * 0.5} x2={pos.x} y2={pos.y + r * 0.5} stroke="#ffffff" strokeWidth={1.75} />
    </g>
  );
  const sideAddNodes = (() => {
    if (sel?.kind !== "el" || tool !== "select") return null;
    const el = els.find((x) => x.id === sel.id);
    if (el && el.locked) return null;
    if (!el || el.type !== "building" || el.points) return null;
    const { dockSides, opp } = dockSidesOf(el);
    const cpx = f2p({ x: el.cx, y: el.cy });
    const sides = [["top", 0, -1], ["bottom", 0, 1], ["left", -1, 0], ["right", 1, 0]];
    return (
      <g>
        {sides.map(([name, nx, ny]) => {
          const o = rot2(nx * el.w / 2, ny * el.h / 2, el.rot);
          const ms = f2p({ x: el.cx + o.x, y: el.cy + o.y });
          let ux = ms.x - cpx.x, uy = ms.y - cpx.y; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
          const pos = { x: ms.x - ux * 22, y: ms.y - uy * 22 }; // just inside the wall
          const isDock = dockSides.includes(name), isOpp = name === opp;
          const fill = isDock ? "#b45309" : isOpp ? "#0e7490" : "#16a34a";
          const title = isDock ? `Add ${TRUCK_COURT_D}′ truck dock + drive` : isOpp ? `Add ${OPP_TRAILER_D}′ striped trailer parking` : `Add ${SIDEWALK_W}′ sidewalk`;
          const onAdd = isDock ? () => addStripSide(el, nx, ny, "paving", TRUCK_COURT_D)
            : isOpp ? () => addOppTrailer(el, name)
            : () => addStripSide(el, nx, ny, "sidewalk", SIDEWALK_W);
          return plusNode(`add${name}`, pos, fill, title, onAdd);
        })}
        {/* dog-ear bump-outs at each corner of every dock side */}
        {dockSides.flatMap((name) => {
          const [nx, ny] = SIDE_N[name];
          const alongIsX = ny !== 0;
          return [1, -1].map((sign) => {
            const cl = alongIsX ? { x: sign * el.w / 2, y: ny * el.h / 2 } : { x: nx * el.w / 2, y: sign * el.h / 2 };
            const co = rot2(cl.x, cl.y, el.rot);
            const cs = f2p({ x: el.cx + co.x, y: el.cy + co.y });
            let dx = cs.x - cpx.x, dy = cs.y - cpx.y; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
            const pos = { x: cs.x + dx * 15, y: cs.y + dy * 15 }; // just outside the corner
            return plusNode(`dog${name}${sign}`, pos, "#7c3aed", `Add ${DOGEAR_W}′×${DOGEAR_D}′ dock dog-ear`, () => addBuildingEls([makeDogEar(el, nx, ny, sign)], el.id), 8);
          });
        })}
      </g>
    );
  })();

  const handleNodes = (() => {
    if (sel?.kind !== "el") return null;
    const el = els.find((x) => x.id === sel.id);
    if (!el || el.points || el.locked) return null; // locked / polygon: no resize/rotate handles
    const corners = elCorners(el).map(f2p);
    const signs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const topMid = f2p({ x: el.cx + rot2(0, -el.h / 2, el.rot).x, y: el.cy + rot2(0, -el.h / 2, el.rot).y });
    const cpx = f2p({ x: el.cx, y: el.cy });
    let ux = topMid.x - cpx.x, uy = topMid.y - cpx.y;
    const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    const rotPos = { x: topMid.x + ux * 26, y: topMid.y + uy * 26 };
    return (
      <g>
        <line x1={topMid.x} y1={topMid.y} x2={rotPos.x} y2={rotPos.y} stroke={PAL.accent} strokeWidth={1.25} />
        <circle cx={rotPos.x} cy={rotPos.y} r={6} fill={PAL.paper} stroke={PAL.accent} strokeWidth={1.5}
          style={{ cursor: "grab" }} onPointerDown={(e) => startRotate(e, el.id)} />
        {corners.map((c, i) => (
          <rect key={i} x={c.x - 5} y={c.y - 5} width={10} height={10} fill={PAL.paper} stroke={PAL.accent} strokeWidth={1.5}
            style={{ cursor: resizeCursor(c.x - cpx.x, c.y - cpx.y) }} onPointerDown={(e) => startResize(e, el.id, signs[i][0], signs[i][1])} />
        ))}
        {/* side grips: drag one edge to expand/shrink that side (opposite side stays put) */}
        {[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([nx, ny], i) => {
          const o = rot2(nx * el.w / 2, ny * el.h / 2, el.rot);
          const m = f2p({ x: el.cx + o.x, y: el.cy + o.y });
          return (
            <rect key={`edge${i}`} x={m.x - 4.5} y={m.y - 4.5} width={9} height={9} rx={2}
              fill={PAL.accent} stroke={PAL.paper} strokeWidth={1.5}
              style={{ cursor: resizeCursor(m.x - cpx.x, m.y - cpx.y) }}
              onPointerDown={(e) => startEdgeResize(e, el.id, nx, ny)} />
          );
        })}
      </g>
    );
  })();

  // Edge-length labels on the selected parcel (so you can read/trim frontage).
  const parcelEdgeLabels = (() => {
    if (sel?.kind !== "parcel") return null;
    const pc = parcels.find((p) => p.id === sel.id);
    if (!pc) return null;
    return pc.points.map((a, i) => {
      const b = pc.points[(i + 1) % pc.points.length];
      const am = f2p(a), bm = f2p(b);
      const mid = { x: (am.x + bm.x) / 2, y: (am.y + bm.y) / 2 };
      return (
        <text key={`pe${i}`} x={mid.x} y={mid.y} dy={-7} textAnchor="middle" fontSize="11"
          fontFamily="ui-monospace, Menlo, monospace" fill={PAL.ink} stroke={PAL.paper} strokeWidth={3}
          paintOrder="stroke" pointerEvents="none" fontWeight="600">{f0(dist(a, b))}′</text>
      );
    });
  })();

  // Draggable vertices + add-point (+) handles on the selected parcel (select tool).
  const parcelHandles = (() => {
    if (sel?.kind !== "parcel" || tool !== "select") return null;
    const pc = parcels.find((p) => p.id === sel.id);
    if (!pc) return null;
    const nodes = [];
    pc.points.forEach((a, i) => {
      const b = pc.points[(i + 1) % pc.points.length];
      const am = f2p(a), bm = f2p(b);
      const mid = { x: (am.x + bm.x) / 2, y: (am.y + bm.y) / 2 };
      nodes.push(
        <g key={`addv${i}`} style={{ cursor: "copy" }} onPointerDown={(e) => addVertex(e, pc.id, i)}>
          <circle cx={mid.x} cy={mid.y} r={5.5} fill={PAL.paper} stroke={PAL.accent} strokeWidth={1.25} />
          <line x1={mid.x - 2.5} y1={mid.y} x2={mid.x + 2.5} y2={mid.y} stroke={PAL.accent} strokeWidth={1.25} />
          <line x1={mid.x} y1={mid.y - 2.5} x2={mid.x} y2={mid.y + 2.5} stroke={PAL.accent} strokeWidth={1.25} />
        </g>
      );
    });
    pc.points.forEach((a, i) => {
      const c = f2p(a);
      nodes.push(
        <rect key={`pv${i}`} x={c.x - 5} y={c.y - 5} width={10} height={10} rx={2}
          fill={PAL.accent} stroke={PAL.paper} strokeWidth={1.5}
          style={{ cursor: "move" }} onPointerDown={(e) => startVertex(e, pc.id, i)} />
      );
    });
    return <g>{nodes}</g>;
  })();

  const scaleBarFt = (() => {
    const targetPx = 120;
    const raw = targetPx / view.ppf;
    const steps = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    const ft = steps.reduce((a, b) => (Math.abs(b - raw) < Math.abs(a - raw) ? b : a), steps[0]);
    return { ft, px: ft * view.ppf };
  })();

  /* ----------------------------- UI ----------------------------- */
  // primary buttons (inspector actions)
  const btn = (active) => ({
    padding: "6px 12px", fontSize: 12.5, borderRadius: 8, cursor: "pointer",
    border: `1px solid ${active ? PAL.accent : "#ddd6c5"}`,
    background: active ? PAL.accent : "#fff", color: active ? "#fff" : PAL.ink,
    fontWeight: 600, fontFamily: "inherit",
    boxShadow: active ? "none" : "0 1px 2px rgba(28,25,20,0.05)",
  });
  // toolbar segmented-control buttons (active = raised white card)
  const tbtn = (active) => ({
    padding: "5px 11px", fontSize: 12.5, borderRadius: 7, cursor: "pointer",
    border: "1px solid transparent", whiteSpace: "nowrap",
    background: active ? "#fff" : "transparent", color: active ? PAL.accent : PAL.ink,
    fontWeight: active ? 700 : 500, fontFamily: "inherit",
    boxShadow: active ? "0 1px 3px rgba(28,25,20,0.16)" : "none",
  });
  // right-side tool-rail buttons (full-width, left-aligned)
  const rbtn = (active) => ({ ...tbtn(active), width: "100%", textAlign: "left", padding: "7px 11px", borderRadius: 8, border: `1px solid ${active ? PAL.accent : "transparent"}` });
  // quiet (ghost) buttons for the top-bar action cluster
  const ghostBtn = { padding: "5px 10px", fontSize: 12, borderRadius: 7, border: "1px solid transparent", background: "transparent", color: PAL.ink, cursor: "pointer", fontFamily: "inherit", fontWeight: 500, whiteSpace: "nowrap" };
  const iconBtn = { ...ghostBtn, width: 28, height: 28, padding: 0, display: "grid", placeItems: "center", fontSize: 14.5 };
  const chip = { padding: "5px 10px", fontSize: 12, borderRadius: 7, border: `1px solid #ddd6c5`, background: "#fff", color: PAL.ink, cursor: "pointer", fontFamily: "inherit", fontWeight: 500, boxShadow: "0 1px 2px rgba(28,25,20,0.04)" };
  const numInput = { width: 58, padding: "5px 8px", fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace", border: `1px solid #ddd6c5`, borderRadius: 7, color: PAL.ink, background: "#fff" };
  const menuItem = (on) => ({ display: "block", width: "100%", textAlign: "left", padding: "7px 9px", fontSize: 12.5, borderRadius: 6, cursor: "pointer", border: "none", background: on ? PAL.accentSoft : "transparent", color: PAL.ink, fontFamily: "inherit", fontWeight: on ? 650 : 500 });
  const menuPanel = { background: "#fff", border: `1px solid ${PAL.panelLine}`, borderRadius: 10, boxShadow: "0 10px 32px rgba(28,25,20,0.16), 0 2px 8px rgba(28,25,20,0.08)", padding: 5 };
  const vSep = <span style={{ width: 1, height: 18, background: PAL.panelLine, margin: "0 5px" }} />;
  const toolDivider = <span style={{ width: 1, height: 16, background: "#ddd5c4", margin: "0 3px", alignSelf: "center" }} />;
  // Switch tools and reset any in-progress drafting; also closes the Parcel menu.
  const selectTool = (id) => {
    setTool(id);
    setDraftPoly(null); setDraftRect(null); setDraftElPoly(null); setMeasDraft([]); setSplitPath([]);
    if (id !== "calibrate") setCalib(null);
    setToolMenu(false);
    if (id !== "building") setBuildingMenu(false);
    if (id !== "parking") setParkingMenu(false);
    if (id !== "measure") setMeasureMenu(false);
  };
  const metricRow = (label, value, sub) => (
    <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5.5px 0", borderBottom: "1px solid #f3efe5" }}>
      <span style={{ fontSize: 12, color: PAL.muted }}>{label}</span>
      <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, color: PAL.ink, fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>{value}{sub && <span style={{ color: PAL.muted, fontWeight: 400, fontSize: 10.5 }}> {sub}</span>}</span>
    </div>
  );

  const selEl = sel?.kind === "el" ? els.find((e) => e.id === sel.id) : null;
  const setSelEl = (patch) => setEls((a) => a.map((e) => e.id === selEl.id ? { ...e, ...patch } : e));
  const selParcel = sel?.kind === "parcel" ? parcels.find((p) => p.id === sel.id) : null;
  const setSelParcel = (patch) => setParcels((a) => a.map((p) => p.id === selParcel.id ? { ...p, ...patch } : p));
  const curHint = TOOLS.find((t) => t.id === tool)?.hint;

  /* ------------ element colors / defaults (Bluebeam-style Properties) ------------ */
  const curStyle = selEl ? elStyle(selEl, settings) : null;
  // Merge a default-color patch for one type into settings.typeStyles.
  const setTypeStyle = (type, patch) => { pushHistory(); setSettings((s) => ({ ...s, typeStyles: { ...(s.typeStyles || {}), [type]: { ...((s.typeStyles || {})[type] || {}), ...patch } } })); };
  // Make the selected element's current colors the default for its type.
  const setStyleDefault = () => { if (!selEl || !curStyle) return; setTypeStyle(selEl.type, { fill: curStyle.fill, stroke: curStyle.stroke, fillOpacity: curStyle.fillOpacity }); };
  // Drop the selected element's per-element overrides (back to the type default).
  const clearElStyle = () => { if (!selEl) return; pushHistory(); setEls((a) => a.map((e) => { if (e.id !== selEl.id) return e; const { fill, stroke, fillOpacity, ...rest } = e; return rest; })); };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", minHeight: 600, background: "#efeadf",
      fontFamily: "'Helvetica Neue', Helvetica, system-ui, sans-serif", color: PAL.ink, overflow: "hidden" }}>

      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", background: PAL.panelBg, borderBottom: `1px solid ${PAL.panelLine}`, boxShadow: "0 1px 6px rgba(28,25,20,0.05)", flexWrap: "wrap", position: "relative", zIndex: 60 }}>
        {onBackToMap && <button className="gbtn" style={ghostBtn} onClick={onBackToMap} title="Back to the map finder">‹ Map</button>}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 4 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3.5, background: PAL.accent, display: "inline-block", boxShadow: "0 1px 2px rgba(194,65,12,0.4)" }} />
          <span style={{ fontWeight: 800, letterSpacing: "-0.01em", fontSize: 15 }}>Planar Fit</span>
          <span style={{ color: PAL.muted, fontSize: 11.5, fontWeight: 500, borderLeft: `1px solid ${PAL.panelLine}`, paddingLeft: 8 }}>Industrial Site Planner</span>
        </div>

        <div style={{ flex: 1 }} />

        {/* action cluster */}
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <button className="gbtn" style={iconBtn} onClick={undo} title="Undo (Ctrl+Z)">↶</button>
          <button className="gbtn" style={iconBtn} onClick={redo} title="Redo (Ctrl+Shift+Z)">↷</button>
          <button className="gbtn" style={iconBtn} onClick={fit} title="Zoom to fit">⤢</button>
          <button className="gbtn" style={{ ...ghostBtn, display: "flex", alignItems: "center", gap: 6, color: settings.snap ? PAL.ink : PAL.muted, fontWeight: 600 }}
            onClick={() => setSettings((s) => ({ ...s, snap: !s.snap }))} title="Snap to the grid and flush against neighbouring elements">
            <span style={{ width: 7, height: 7, borderRadius: 99, background: settings.snap ? "#16a34a" : "#cfc6af", display: "inline-block" }} />
            Snap {settings.gridSize}′
          </button>
          {vSep}
          <div style={{ position: "relative" }}>
            <button className="gbtn" style={{ ...ghostBtn, fontWeight: 600 }} onClick={() => setSaveMenu((o) => !o)}>Save / load ▾</button>
            {saveMenu && (
              <>
                <div onClick={() => setSaveMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <div className="menu" style={{ ...menuPanel, position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 50, width: 268, padding: 10 }}>
                  <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Scenarios</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input style={{ ...numInput, width: "100%", fontFamily: "inherit" }} placeholder="Scenario name" value={scenName} onChange={(e) => setScenName(e.target.value)} />
                    <button style={chip} onClick={saveScen}>Save</button>
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 7 }}>
                    <select style={{ ...numInput, width: "100%", fontFamily: "inherit" }} value={scenPick} onChange={(e) => setScenPick(e.target.value)}>
                      <option value="">— saved scenarios —</option>
                      {scenList.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <button style={chip} onClick={loadScen}>Load</button>
                    <button style={{ ...chip, color: PAL.accent }} onClick={delScen}>✕</button>
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 7 }}>
                    <button style={{ ...chip, flex: 1 }} onClick={() => { setSaveMenu(false); exportJSON(); }}>Export JSON</button>
                    <button style={{ ...chip, flex: 1 }} onClick={() => importRef.current?.click()}>Import JSON</button>
                    <input ref={importRef} type="file" accept="application/json,.json" style={{ display: "none" }}
                      onChange={(e) => { importJSONFile(e.target.files?.[0]); e.target.value = ""; }} />
                  </div>
                </div>
              </>
            )}
          </div>
          <div style={{ position: "relative" }}>
            <button className="gbtn" style={{ ...ghostBtn, fontWeight: 600 }} onClick={() => setExportMenu((o) => !o)}>Export ▾</button>
            {exportMenu && (
              <>
                <div onClick={() => setExportMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <div className="menu" style={{ ...menuPanel, position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 50, width: 196 }}>
                  <button style={menuItem(false)} onClick={() => { setExportMenu(false); printPDF(); }}>Print / save as PDF…</button>
                  <button style={menuItem(false)} onClick={() => { setExportMenu(false); exportPNG(); }}>PNG image</button>
                  <button style={menuItem(false)} onClick={() => { setExportMenu(false); exportJSON(); }}>JSON file (re-importable)</button>
                </div>
              </>
            )}
          </div>
          {vSep}
          <button className="gbtn" style={{ ...ghostBtn, color: PAL.muted }} onClick={() => { pushHistory(); setMeasures([]); }}>Clear measures</button>
          <button className="gbtn-danger" style={{ ...ghostBtn, color: "#b3361b" }} onClick={() => { if (sel) deleteSel(); }}>Delete</button>
          <button className="gbtn-danger" style={{ ...ghostBtn, color: "#b3361b" }} onClick={() => { pushHistory(); setParcels([]); setEls([]); setMeasures([]); setSel(null); }}>Clear all</button>
        </div>
      </div>

      {/* body */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* canvas */}
        <div ref={wrapRef} style={{ flex: 1, position: "relative", minWidth: 0, order: 2 }}>
          <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${size.w} ${size.h}`}
            style={{ background: PAL.paper, display: "block", touchAction: "none", userSelect: "none", WebkitUserSelect: "none", cursor: (sidewalkFor || attachFor) ? "crosshair" : tool === "select" ? (panning ? "grabbing" : "grab") : "crosshair" }}
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={onBgDown} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={onBgDouble}>

            <g data-export="skip">{gridLines()}</g>

            {/* scaled feet space */}
            <g>
              {/* aerial underlay (drawn beneath everything) */}
              {underlay && (() => {
                const tl = f2p({ x: underlay.x, y: underlay.y });
                const sy = underlay.ftPerPxY || underlay.ftPerPx;
                const w = underlay.imgW * underlay.ftPerPx * view.ppf;
                const h = underlay.imgH * sy * view.ppf;
                return <image href={underlay.src} x={tl.x} y={tl.y} width={w} height={h}
                  opacity={underlay.opacity} preserveAspectRatio="none"
                  style={{ cursor: tool === "select" && !underlay.locked ? "move" : "crosshair" }}
                  pointerEvents={underlay.locked ? "none" : "auto"}
                  onError={() => { setUnderlayErr(true); setUnderlayLoading(false); }} onLoad={() => { setUnderlayErr(false); setUnderlayLoading(false); }}
                  onPointerDown={startMoveUnderlay} />;
              })()}

              {/* setback outlines */}
              {settings.showSetback && settings.setback > 0 && parcels.map((pc) => {
                const o = offsetPolygon(pc.points, settings.setback);
                if (!o) return null;
                return <polygon key={`sb${pc.id}`} points={o.map((p) => `${f2p(p).x},${f2p(p).y}`).join(" ")} fill="none" stroke={PAL.setback} strokeWidth={1.25} strokeDasharray="7 6" />;
              })}
              {/* parcels */}
              {parcels.map((pc) => {
                const isSel = sel?.kind === "parcel" && sel.id === pc.id;
                return <polygon key={pc.id} points={pc.points.map((p) => `${f2p(p).x},${f2p(p).y}`).join(" ")}
                  fill={pc.fill || "#faf7f0"} fillOpacity={pc.fillOpacity ?? 0.12}
                  stroke={isSel ? PAL.accent : (pc.stroke || PAL.parcel)} strokeWidth={isSel ? 3 : 2}
                  style={{ cursor: tool === "select" ? "move" : "crosshair" }}
                  onPointerDown={(e) => startMoveParcel(e, pc.id)} />;
              })}
              {/* elements (drawn in PIXELS; coords pre-transformed by f2p) */}
              {els.map((el) => renderElPx(el, f2p, sel, tool, settings, startMoveEl, onElDouble))}
              {/* measurements — line (distance), polyline (path length), area */}
              {measures.map((m, i) => {
                const fpts = measPts(m);
                if (fpts.length < 2) return null;
                const mode = measMode(m);
                const pts = fpts.map(f2p);
                const isSel = sel?.kind === "measure" && sel.i === i;
                const isArea = mode === "area";
                const ptsStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
                // label + anchor point
                const lbl = isArea
                  ? `${f0(polyArea(fpts))} sf · ${f2(polyArea(fpts) / SQFT_PER_ACRE)} ac`
                  : `${f0(pathLen(fpts))}′`;
                const anchor = isArea ? f2p(centroid(fpts)) : (() => {
                  const a = pts[pts.length - 2], b = pts[pts.length - 1];
                  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                })();
                return (
                  <g key={m.id || `m${i}`}>
                    {isArea
                      ? <polygon points={ptsStr} fill={PAL.accent} fillOpacity={isSel ? 0.16 : 0.1} stroke={PAL.accent} strokeWidth={isSel ? 2.5 : 1.5} pointerEvents="none" />
                      : <polyline points={ptsStr} fill="none" stroke={PAL.accent} strokeWidth={isSel ? 2.5 : 1.5} pointerEvents="none" />}
                    {pts.map((p, k) => <circle key={k} cx={p.x} cy={p.y} r={3} fill={PAL.accent} pointerEvents="none" />)}
                    <text x={anchor.x} y={anchor.y - 5} textAnchor="middle" fontSize="12" fontFamily="ui-monospace, Menlo, monospace"
                      fill={PAL.accent} stroke={PAL.paper} strokeWidth={3} paintOrder="stroke" fontWeight="700" pointerEvents="none">{lbl}</text>
                    {/* wide invisible hit path to select the measurement (select tool only) */}
                    {isArea
                      ? <polygon points={ptsStr} fill="transparent" stroke="transparent" strokeWidth={14}
                          pointerEvents={tool === "select" ? "all" : "none"} style={{ cursor: "pointer" }} onPointerDown={(e) => selectMeasure(e, i)} />
                      : <polyline points={ptsStr} fill="none" stroke="transparent" strokeWidth={14}
                          pointerEvents={tool === "select" ? "stroke" : "none"} style={{ cursor: "pointer" }} onPointerDown={(e) => selectMeasure(e, i)} />}
                    {isSel && (
                      <g style={{ cursor: "pointer" }} onPointerDown={(e) => { e.stopPropagation(); pushHistory(); setMeasures((arr) => arr.filter((_, idx) => idx !== i)); setSel(null); }}>
                        <circle cx={anchor.x} cy={anchor.y - 22} r={8.5} fill={PAL.paper} stroke={PAL.accent} strokeWidth={1.5} />
                        <text x={anchor.x} y={anchor.y - 22} dy={3.5} textAnchor="middle" fontSize="12" fontWeight="700" fill={PAL.accent} pointerEvents="none">×</text>
                      </g>
                    )}
                  </g>
                );
              })}
              {/* in-progress measure draft */}
              {tool === "measure" && measDraft.length > 0 && (() => {
                const live = cursor ? snapPt(cursor) : null;
                const all = live ? [...measDraft, live] : measDraft;
                const pts = all.map(f2p);
                const ptsStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
                const isArea = measureMode === "area";
                const lp = pts[pts.length - 1];
                const lbl = isArea
                  ? (all.length >= 3 ? `${f0(polyArea(all))} sf` : "")
                  : (all.length >= 2 ? `${f0(pathLen(all))}′` : "");
                return (
                  <g pointerEvents="none">
                    {isArea && all.length >= 3
                      ? <polygon points={ptsStr} fill={PAL.accent} fillOpacity={0.1} stroke={PAL.accent} strokeWidth={1.5} strokeDasharray="5 4" />
                      : <polyline points={ptsStr} fill="none" stroke={PAL.accent} strokeWidth={1.5} strokeDasharray="5 4" />}
                    {measDraft.map((p, k) => { const c = f2p(p); return <circle key={k} cx={c.x} cy={c.y} r={k === 0 ? 5 : 3.5} fill={k === 0 ? PAL.paper : PAL.accent} stroke={PAL.accent} strokeWidth={1.5} />; })}
                    {lbl && <text x={lp.x} y={lp.y - 8} textAnchor="middle" fontSize="11" fontFamily="ui-monospace, Menlo, monospace" fill={PAL.accent} stroke={PAL.paper} strokeWidth={3} paintOrder="stroke" fontWeight="700">{lbl}</text>}
                  </g>
                );
              })()}
              {/* calibration pick (unsnapped, drawn over the underlay) */}
              {calib?.a && (() => {
                const a = f2p(calib.a);
                const b = calib.b ? f2p(calib.b) : (cursor ? f2p(cursor) : a);
                const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                const measured = calib.b ? dist(calib.a, calib.b) : (cursor ? dist(calib.a, cursor) : 0);
                return (
                  <g pointerEvents="none">
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={PAL.accent} strokeWidth={1.5} strokeDasharray={calib.b ? "none" : "5 4"} />
                    <circle cx={a.x} cy={a.y} r={4} fill={PAL.paper} stroke={PAL.accent} strokeWidth={1.5} />
                    {calib.b && <circle cx={b.x} cy={b.y} r={4} fill={PAL.paper} stroke={PAL.accent} strokeWidth={1.5} />}
                    <text x={mid.x} y={mid.y - 7} textAnchor="middle" fontSize="12" fontFamily="ui-monospace, Menlo, monospace"
                      fill={PAL.accent} stroke={PAL.paper} strokeWidth={3} paintOrder="stroke" fontWeight="700">{f0(measured)}′ now</text>
                  </g>
                );
              })()}
              {/* draft polygon */}
              {draftPoly && (
                <g pointerEvents="none">
                  <polyline points={[...draftPoly, ...(cursor ? [snapPt(cursor)] : [])].map((p) => `${f2p(p).x},${f2p(p).y}`).join(" ")} fill="none" stroke={PAL.accent} strokeWidth={1.75} strokeDasharray="6 5" />
                  {draftPoly.map((p, i) => { const c = f2p(p); return <circle key={i} cx={c.x} cy={c.y} r={i === 0 ? 5 : 3.5} fill={i === 0 ? PAL.paper : PAL.accent} stroke={PAL.accent} strokeWidth={1.5} />; })}
                </g>
              )}
              {/* draft rect */}
              {draftRect && (() => { const a = f2p({ x: draftRect.x, y: draftRect.y }); return (
                <g pointerEvents="none"><rect x={a.x} y={a.y} width={draftRect.w * view.ppf} height={draftRect.h * view.ppf} fill={typeStyle(draftRect.type, settings).fill} fillOpacity={0.5} stroke={PAL.accent} strokeWidth={1.5} strokeDasharray="5 4" /></g>
              ); })()}
              {/* draft polygon element (clicking perimeter points) */}
              {draftElPoly && (
                <g pointerEvents="none">
                  <polyline points={[...draftElPoly.pts, ...(cursor ? [snapPt(cursor)] : [])].map((p) => `${f2p(p).x},${f2p(p).y}`).join(" ")} fill={typeStyle(draftElPoly.type, settings).fill} fillOpacity={0.35} stroke={PAL.accent} strokeWidth={1.75} strokeDasharray="6 5" />
                  {draftElPoly.pts.map((p, i) => { const c = f2p(p); return <circle key={i} cx={c.x} cy={c.y} r={i === 0 ? 5 : 3.5} fill={i === 0 ? PAL.paper : PAL.accent} stroke={PAL.accent} strokeWidth={1.5} />; })}
                </g>
              )}
              {/* split cut preview (polyline) */}
              {tool === "split" && splitPath.length > 0 && (() => {
                const live = cursor ? snapSplit(cursor) : null;
                const all = live ? [...splitPath, live] : splitPath;
                const ptsStr = all.map((p) => { const c = f2p(p); return `${c.x},${c.y}`; }).join(" ");
                let total = 0;
                for (let i = 1; i < all.length; i++) total += dist(all[i - 1], all[i]);
                const lp = f2p(all[all.length - 1]);
                return (
                  <g pointerEvents="none">
                    <polyline points={ptsStr} fill="none" stroke={PAL.accent} strokeWidth={1.5} strokeDasharray="6 5" />
                    {splitPath.map((p, i) => { const c = f2p(p); return <circle key={i} cx={c.x} cy={c.y} r={4} fill={PAL.paper} stroke={PAL.accent} strokeWidth={1.5} />; })}
                    {live && all.length >= 2 && <text x={lp.x} y={lp.y - 8} textAnchor="middle" fontSize="11" fontFamily="ui-monospace, Menlo, monospace" fill={PAL.accent} stroke={PAL.paper} strokeWidth={3} paintOrder="stroke" fontWeight="700">{f0(total)}′ cut</text>}
                  </g>
                );
              })()}

              {parcelLabels}
              {labelEls}
              {/* selection / editing chrome — stripped from exports */}
              <g data-export="skip">
                {attachLinks}
                {parcelEdgeLabels}
                {handleNodes}
                {sideAddNodes}
                {parcelHandles}
                {attachHint && (() => {
                  const p = f2p(attachHint);
                  return (
                    <g pointerEvents="none">
                      <circle cx={p.x} cy={p.y} r={9} fill="#16a34a" stroke="#ffffff" strokeWidth={1.75} />
                      <line x1={p.x - 4.5} y1={p.y} x2={p.x + 4.5} y2={p.y} stroke="#ffffff" strokeWidth={1.75} />
                      <line x1={p.x} y1={p.y - 4.5} x2={p.x} y2={p.y + 4.5} stroke="#ffffff" strokeWidth={1.75} />
                    </g>
                  );
                })()}
              </g>
            </g>

            {/* scale bar (sits above the status bar) */}
            <g data-export="skip" transform={`translate(${size.w - scaleBarFt.px - 24}, ${size.h - 42})`} pointerEvents="none">
              <line x1={0} y1={0} x2={scaleBarFt.px} y2={0} stroke={PAL.ink} strokeWidth={2} />
              <line x1={0} y1={-4} x2={0} y2={4} stroke={PAL.ink} strokeWidth={2} />
              <line x1={scaleBarFt.px} y1={-4} x2={scaleBarFt.px} y2={4} stroke={PAL.ink} strokeWidth={2} />
              <text x={scaleBarFt.px / 2} y={-7} textAnchor="middle" fontSize="11" fontFamily="ui-monospace, Menlo, monospace" fill={PAL.ink}>{f0(scaleBarFt.ft)}′</text>
            </g>
          </svg>

          {/* empty state */}
          {parcels.length === 0 && els.length === 0 && !underlay && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <div style={{ textAlign: "left", color: PAL.muted, background: "rgba(255,255,255,0.88)", padding: "20px 24px", borderRadius: 14, border: `1px solid ${PAL.panelLine}`, boxShadow: "0 8px 32px rgba(28,25,20,0.08)", maxWidth: 380 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: PAL.ink, marginBottom: 10 }}>Start your site</div>
                {[
                  ["1", <>Pick a <b>parcel from the map</b> (‹ Map) to start from real county data,</>],
                  ["2", <>or drop a <b>screenshot underlay</b> and calibrate it,</>],
                  ["3", <>or draw a boundary with the <b>Parcel</b> tool on the right.</>],
                ].map(([n, body]) => (
                  <div key={n} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12.5, lineHeight: 1.55, marginBottom: 5 }}>
                    <span style={{ width: 17, height: 17, borderRadius: 99, background: "#f1ece1", color: "#6b6557", fontSize: 10.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", transform: "translateY(2px)" }}>{n}</span>
                    <span>{body}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* aerial loading indicator */}
          {underlayLoading && (
            <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", background: "rgba(44,42,38,0.85)", color: "#fff", padding: "6px 13px", borderRadius: 7, fontSize: 12.5, pointerEvents: "none", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: PAL.accent, display: "inline-block" }} />
              Loading aerial…
            </div>
          )}

          {/* status bar */}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex", gap: 0, alignItems: "center", padding: "5px 14px", fontSize: 11.5, color: PAL.muted, background: "rgba(252,251,247,0.92)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", borderTop: `1px solid ${PAL.panelLine}` }}>
            <span style={{ fontFamily: "ui-monospace, Menlo, monospace", minWidth: 110, fontVariantNumeric: "tabular-nums" }}>{cursor ? `${f0(cursor.x)}′, ${f0(cursor.y)}′` : "—"}</span>
            <span style={{ fontFamily: "ui-monospace, Menlo, monospace", minWidth: 80 }}>{Math.round(view.ppf * 100) / 100} px/ft</span>
            <span style={{ width: 1, height: 14, background: PAL.panelLine, margin: "0 12px" }} />
            <span style={{ color: (sidewalkFor || attachFor) ? PAL.accent : "#6b6557", fontWeight: (sidewalkFor || attachFor) ? 600 : 400, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {sidewalkFor ? "Click the side of the building where you want the sidewalk · Esc cancels" : attachFor ? "Click the element to attach the selected one to — they'll move together · Esc cancels" : curHint}
            </span>
          </div>
        </div>

        {/* right-side tool rail */}
        <div style={{ width: 158, flex: "none", order: 3, background: PAL.panelBg, borderLeft: `1px solid ${PAL.panelLine}`, display: "flex", flexDirection: "column", gap: 4, padding: "12px 10px", overflowY: "visible", position: "relative", zIndex: 30 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b6557", padding: "0 2px 4px" }}>Tools</div>
          <button style={rbtn(tool === "select")} onClick={() => selectTool("select")}>Select</button>

          {/* parcel tools grouped in one menu (opens to the left) */}
          <div style={{ position: "relative" }}>
            <button style={rbtn(tool === "parcel" || tool === "split")} onClick={() => setToolMenu((o) => !o)}>Parcel ▾</button>
            {toolMenu && (
              <>
                <div onClick={() => setToolMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <div className="menu" style={{ ...menuPanel, position: "absolute", top: 0, right: "calc(100% + 8px)", zIndex: 50, width: 248 }}>
                  <button style={menuItem(tool === "parcel")} onClick={() => selectTool("parcel")}>Draw new parcel</button>
                  <button style={menuItem(tool === "split")} onClick={() => selectTool("split")}>Split a parcel</button>
                  <div style={{ fontSize: 11, color: PAL.muted, padding: "7px 8px 2px", lineHeight: 1.5, borderTop: `1px solid ${PAL.panelLine}`, marginTop: 4 }}>
                    <b style={{ color: PAL.ink }}>Reshape:</b> pick <b>Select</b>, click the parcel, then drag its dots — the <b>＋</b> on an edge adds a corner, <b>Shift-click</b> a dot removes it.
                  </div>
                </div>
              </>
            )}
          </div>

          <div style={{ height: 1, background: "#e7e2d6", margin: "3px 2px" }} />

          {DRAW_TYPES.map((id) => {
            const t = TOOLS.find((x) => x.id === id);
            if (id === "building") return (
              <div key={id} style={{ position: "relative" }}>
                <button style={rbtn(tool === "building")} onClick={() => setBuildingMenu((o) => !o)}>Building ▾</button>
                {buildingMenu && (
                  <>
                    <div onClick={() => setBuildingMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                    <div className="menu" style={{ ...menuPanel, position: "absolute", top: 0, right: "calc(100% + 8px)", zIndex: 50, width: 200 }}>
                      <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", padding: "4px 8px 6px" }}>Dock layout</div>
                      {[["single", "Single-load (1 side)"], ["cross", "Cross-dock (2 sides)"], ["none", "No docks"]].map(([k, label]) => (
                        <button key={k} style={menuItem(tool === "building" && buildingDock === k)} onClick={() => { setBuildingDock(k); selectTool("building"); setBuildingMenu(false); }}>{label}</button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
            if (id === "parking") {
              const sd = settings.stallDepth, ai = settings.aisle;
              return (
                <div key={id} style={{ position: "relative" }}>
                  <button style={rbtn(tool === "parking")} onClick={() => setParkingMenu((o) => !o)}>Parking ▾</button>
                  {parkingMenu && (
                    <>
                      <div onClick={() => setParkingMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                      <div className="menu" style={{ ...menuPanel, position: "absolute", top: 0, right: "calc(100% + 8px)", zIndex: 50, width: 248 }}>
                        <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", padding: "4px 8px 6px" }}>Parking rows</div>
                        {[["free", "Free draw (any size)"], ["single", `Single row (${sd}′ + ${ai}′ = ${sd + ai}′ deep)`], ["double", `Double row (${sd}′ + ${ai}′ + ${sd}′ = ${sd * 2 + ai}′ deep)`]].map(([k, label]) => (
                          <button key={k} style={menuItem(tool === "parking" && parkingRows === k)} onClick={() => { setParkingRows(k); selectTool("parking"); setParkingMenu(false); }}>{label}</button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            }
            return <button key={id} style={rbtn(tool === id)} onClick={() => selectTool(id)}>{t.label}</button>;
          })}

          <div style={{ height: 1, background: "#e7e2d6", margin: "3px 2px" }} />

          {/* measure with line / polyline / area modes */}
          <div style={{ position: "relative" }}>
            <button style={rbtn(tool === "measure")} onClick={() => setMeasureMenu((o) => !o)}>Measure ▾</button>
            {measureMenu && (
              <>
                <div onClick={() => setMeasureMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <div className="menu" style={{ ...menuPanel, position: "absolute", top: 0, right: "calc(100% + 8px)", zIndex: 50, width: 230 }}>
                  <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", padding: "4px 8px 6px" }}>Measure</div>
                  {[["line", "Line (two-point distance)"], ["polyline", "Polyline (path length)"], ["area", "Area (closed region)"]].map(([k, label]) => (
                    <button key={k} style={menuItem(tool === "measure" && measureMode === k)} onClick={() => { setMeasureMode(k); selectTool("measure"); setMeasureMenu(false); }}>{label}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* left properties panel */}
        <div style={{ width: 312, flex: "none", order: 1, background: "#fcfbf7", borderRight: `1px solid ${PAL.panelLine}`, overflowY: "auto", padding: "14px 16px" }}>
          {/* aerial underlay */}
          <Section title="Aerial underlay">
            {!underlay ? (
              <>
                <button style={{ ...btn(false), width: "100%" }} onClick={() => fileRef.current?.click()}>Load screenshot…</button>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { onUnderlayFile(e.target.files?.[0]); e.target.value = ""; }} />
                <div style={{ fontSize: 11, color: PAL.muted, marginTop: 7, lineHeight: 1.5 }}>Drop in an aerial/screenshot, calibrate it to a known distance, then trace your parcel and buildings on top at true scale.</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 11, color: PAL.muted, marginBottom: 8, lineHeight: 1.5 }}>Locked &amp; click-through so you can draw right over it. Calibrate it to a known distance for true scale.</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button style={{ ...btn(tool === "calibrate"), flex: 1 }} onClick={() => { setTool("calibrate"); setCalib(null); }}>Calibrate scale</button>
                  <button style={chip} onClick={requestFit}>Fit</button>
                  <button style={{ ...chip, color: PAL.accent }} onClick={() => { setUnderlay(null); setCalib(null); }}>Remove</button>
                </div>
                <div style={{ fontSize: 11, color: PAL.muted, marginTop: 7 }}>Scale: <b style={{ color: PAL.ink }}>{f2(1 / underlay.ftPerPx)}</b> px/ft · image ≈ {f0(underlay.imgW * underlay.ftPerPx)}′ wide</div>
                {underlayErr && <div style={{ fontSize: 11, color: PAL.accent, marginTop: 6, lineHeight: 1.45 }}>Aerial image didn't load from the source. Your boundary and tools still work — go back to the map and re-pick the site, or drop a screenshot here instead.</div>}
                {tool === "calibrate" && (
                  <div style={{ marginTop: 9, padding: "9px 10px", borderRadius: 7, background: "#fbf3ee", border: `1px solid ${PAL.accentSoft}` }}>
                    {!calib?.a && <div style={{ fontSize: 11.5, color: PAL.ink }}>Click the <b>first</b> end of a known distance on the image (e.g. a building wall, a road width).</div>}
                    {calib?.a && !calib?.b && <div style={{ fontSize: 11.5, color: PAL.ink }}>Now click the <b>second</b> end.</div>}
                    {calib?.a && calib?.b && (
                      <>
                        <div style={{ fontSize: 11.5, color: PAL.muted, marginBottom: 6 }}>Picked segment reads <b style={{ color: PAL.ink }}>{f0(dist(calib.a, calib.b))}′</b> at the current scale.</div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <span style={{ fontSize: 11.5, color: PAL.muted }}>Actual ft</span>
                          <input autoFocus style={numInput} value={calibInput} onChange={(e) => setCalibInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyCalibration(); }} />
                          <button style={btn(false)} onClick={applyCalibration}>Apply</button>
                          <button style={chip} onClick={() => setCalib(null)}>Reset</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </Section>

          {/* selected element */}
          {selEl && (
            <Section title={`Selected · ${TYPE[selEl.type].label}`}>
              {!selEl.points ? (
                <>
                  <Field label="Width (ft)"><input style={numInput} value={Math.round(selEl.w)} onChange={(e) => setSelEl({ w: Math.max(settings.gridSize, +e.target.value || 0) })} /></Field>
                  <Field label="Depth (ft)"><input style={numInput} value={Math.round(selEl.h)} onChange={(e) => setSelEl({ h: Math.max(settings.gridSize, +e.target.value || 0) })} /></Field>
                  <Field label="Rotation (°)"><input style={numInput} value={Math.round(selEl.rot)} onChange={(e) => setSelEl({ rot: ((+e.target.value || 0) % 360 + 360) % 360 })} /></Field>
                  {selEl.type === "building" && (
                    <Field label="Docks">
                      <select style={{ ...numInput, width: 112, fontFamily: "inherit" }} value={selEl.dock || "single"} onChange={(e) => { pushHistory(); setSelEl({ dock: e.target.value }); }}>
                        <option value="single">Single-load</option>
                        <option value="cross">Cross-dock</option>
                        <option value="none">None</option>
                      </select>
                    </Field>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 11.5, color: PAL.muted, marginBottom: 4, lineHeight: 1.5 }}>Polygon area · {selEl.points.length} points. Drag to move; double-click to change type; re-draw to reshape.</div>
              )}
              {(() => {
                const poly = !!selEl.points;
                const area = poly ? polyArea(selEl.points) : selEl.w * selEl.h;
                return (
                  <div style={{ fontSize: 12, color: PAL.muted, marginTop: 6, lineHeight: 1.6 }}>
                    {poly ? "Area" : "Footprint"}: <b style={{ color: PAL.ink }}>{f0(area)} sf</b>{poly ? ` · ${f2(area / SQFT_PER_ACRE)} ac` : ""}<br />
                    {selEl.type === "parking" && <>Stalls: <b style={{ color: PAL.ink }}>{f0(poly ? estStalls(area, settings) : carStalls(selEl.w, selEl.h, settings).count)}</b>{poly ? " (est.)" : <> @ {settings.stallW}′×{settings.stallDepth}′ {settings.parkAngle}°, {settings.aisle}′ aisle</>}</>}
                    {selEl.type === "trailer" && (() => { const tc = cfgOf(selEl); return <>Trailer stalls: <b style={{ color: PAL.ink }}>{f0(poly ? estTrailers(area, settings) : trailerStalls(selEl.w, selEl.h, tc).count)}</b>{poly ? " (est.)" : <> @ {tc.trailerW}′×{tc.trailerL}′{tc.single ? "" : `, ${tc.trailerAisle}′ drive lane`}</>}</>; })()}
                    {selEl.type === "building" && !poly && (() => {
                      const dock = selEl.dock || "single";
                      const per = Math.floor(Math.max(selEl.w, selEl.h) / 12);
                      const total = dock === "cross" ? per * 2 : dock === "none" ? 0 : per;
                      return <>Dock doors: <b style={{ color: PAL.ink }}>{f0(total)}</b> @ 12′ o.c.{dock === "cross" ? " · both long sides" : dock === "single" ? " · one long side" : ""}</>;
                    })()}
                  </div>
                );
              })()}
              <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
                <button style={chip} onClick={() => toggleLock(selEl.id)}>{selEl.locked ? "🔒 Unlock" : "Lock"}</button>
                <button style={{ ...chip, color: "#b3361b" }} onClick={deleteSel}>Delete element</button>
              </div>
            </Section>
          )}

          {/* Bluebeam-style Properties — colors for the selected element + set defaults */}
          {selEl && curStyle && (
            <Section title="Properties">
              <Field label="Fill color">
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="color" value={toHex6(curStyle.fill)} onChange={(e) => { pushHistory(); setSelEl({ fill: e.target.value }); }} style={{ width: 34, height: 26, padding: 0, border: `1px solid #ddd6c5`, borderRadius: 6, background: "#fff", cursor: "pointer" }} />
                  <span style={{ fontSize: 10.5, color: PAL.muted, fontFamily: "ui-monospace, monospace" }}>{toHex6(curStyle.fill)}</span>
                </span>
              </Field>
              <Field label="Line color">
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="color" value={toHex6(curStyle.stroke)} onChange={(e) => { pushHistory(); setSelEl({ stroke: e.target.value }); }} style={{ width: 34, height: 26, padding: 0, border: `1px solid #ddd6c5`, borderRadius: 6, background: "#fff", cursor: "pointer" }} />
                  <span style={{ fontSize: 10.5, color: PAL.muted, fontFamily: "ui-monospace, monospace" }}>{toHex6(curStyle.stroke)}</span>
                </span>
              </Field>
              <Field label="Fill opacity">
                <input type="range" min={0.1} max={1} step={0.05} value={curStyle.fillOpacity}
                  onChange={(e) => setSelEl({ fillOpacity: +e.target.value })} />
              </Field>
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                <button style={{ ...chip, flex: 1 }} onClick={setStyleDefault} title={`Use these colors for every new ${TYPE[selEl.type].label}`}>Set as default</button>
                <button style={chip} onClick={clearElStyle} title="Revert this element to the type default">Reset</button>
              </div>
            </Section>
          )}

          {/* selected parcel — translucence + setback standards */}
          {selParcel && (
            <Section title="Parcel">
              <div style={{ fontSize: 12, color: PAL.muted, marginBottom: 8, lineHeight: 1.6 }}>
                Area: <b style={{ color: PAL.ink }}>{f0(polyArea(selParcel.points))} sf</b> · {f2(polyArea(selParcel.points) / SQFT_PER_ACRE)} ac · {selParcel.points.length} corners
              </div>
              <Field label="Translucence">
                <input type="range" min={0} max={0.6} step={0.02} value={selParcel.fillOpacity ?? 0.12}
                  onChange={(e) => setSelParcel({ fillOpacity: +e.target.value })} />
              </Field>
              <Field label="Fill color">
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="color" value={toHex6(selParcel.fill || "#faf7f0")} onChange={(e) => { pushHistory(); setSelParcel({ fill: e.target.value }); }} style={{ width: 34, height: 26, padding: 0, border: `1px solid #ddd6c5`, borderRadius: 6, background: "#fff", cursor: "pointer" }} />
                  <span style={{ fontSize: 10.5, color: PAL.muted, fontFamily: "ui-monospace, monospace" }}>{toHex6(selParcel.fill || "#faf7f0")}</span>
                </span>
              </Field>
              <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "10px 0 4px" }}>Standards</div>
              <Field label="Setback (ft)"><input style={numInput} value={settings.setback} onChange={(e) => setSettings((s) => ({ ...s, setback: Math.max(0, +e.target.value || 0) }))} /></Field>
              <label style={{ display: "flex", gap: 8, fontSize: 12, color: PAL.muted, marginTop: 2, cursor: "pointer" }}><input type="checkbox" checked={settings.showSetback} onChange={(e) => setSettings((s) => ({ ...s, showSetback: e.target.checked }))} /> Show setback line</label>
              <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                <button style={{ ...chip, color: "#b3361b" }} onClick={deleteSel}>Delete parcel</button>
              </div>
            </Section>
          )}

          {/* metrics */}
          <Section title="Site yield">
            {metricRow("Site area", `${f2(siteSqft / SQFT_PER_ACRE)} ac`, `(${f0(siteSqft)} sf)`)}
            {metricRow("Building", `${f0(bldg)} sf`)}
            {metricRow("Lot coverage", `${f0(cov)}%`)}
            {metricRow("FAR", f2(far), "(1-story)")}
            {metricRow("Car stalls", f0(stalls), ratio ? `· ${f2(ratio)}/1k sf` : "")}
            {metricRow("Trailer stalls", f0(trailers))}
            {metricRow("Impervious", `${f0(impPct)}%`)}
            {metricRow("Detention", `${f0(pondArea)} sf`)}
            {metricRow("Open/green", `${f2(open / SQFT_PER_ACRE)} ac`)}
          </Section>

          {/* settings */}
          <Section title="Standards" collapsed>
            <Field label="Grid (ft)"><input style={numInput} value={settings.gridSize} onChange={(e) => setSettings((s) => ({ ...s, gridSize: Math.max(1, +e.target.value || 1) }))} /></Field>
            <Field label="Stall W / D"><span><input style={{ ...numInput, width: 42 }} value={settings.stallW} onChange={(e) => setSettings((s) => ({ ...s, stallW: +e.target.value || 9 }))} /> <input style={{ ...numInput, width: 42 }} value={settings.stallDepth} onChange={(e) => setSettings((s) => ({ ...s, stallDepth: +e.target.value || 18 }))} /></span></Field>
            <Field label="Drive aisle"><input style={numInput} value={settings.aisle} onChange={(e) => setSettings((s) => ({ ...s, aisle: +e.target.value || 24 }))} /></Field>
            <Field label="Park angle"><select style={{ ...numInput, width: 58 }} value={settings.parkAngle} onChange={(e) => setSettings((s) => ({ ...s, parkAngle: +e.target.value }))}><option value={90}>90°</option><option value={60}>60°</option><option value={45}>45°</option></select></Field>
            <Field label="Trailer W / L"><span><input style={{ ...numInput, width: 42 }} value={settings.trailerW} onChange={(e) => setSettings((s) => ({ ...s, trailerW: +e.target.value || 12 }))} /> <input style={{ ...numInput, width: 42 }} value={settings.trailerL} onChange={(e) => setSettings((s) => ({ ...s, trailerL: +e.target.value || 53 }))} /></span></Field>
            <Field label="Trailer aisle"><input style={numInput} value={settings.trailerAisle} onChange={(e) => setSettings((s) => ({ ...s, trailerAisle: +e.target.value || 0 }))} /></Field>
            <label style={{ display: "flex", gap: 8, fontSize: 12, color: PAL.muted, marginTop: 6, cursor: "pointer" }}><input type="checkbox" checked={settings.showDocks} onChange={(e) => setSettings((s) => ({ ...s, showDocks: e.target.checked }))} /> Show dock doors</label>
          </Section>

          {/* element default colors — edit without selecting anything */}
          <Section title="Element defaults" collapsed>
            <div style={{ fontSize: 11, color: PAL.muted, marginBottom: 8, lineHeight: 1.5 }}>Default fill / line color for each element type. New elements use these; per-element overrides live in <b style={{ color: PAL.ink }}>Properties</b>.</div>
            {Object.keys(TYPE).map((k) => {
              const st = typeStyle(k, settings);
              return (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                  <span style={{ flex: 1, fontSize: 12, color: PAL.ink }}>{TYPE[k].label.split(" / ")[0]}</span>
                  <input type="color" title="Fill" value={toHex6(st.fill)} onChange={(e) => setTypeStyle(k, { fill: e.target.value })} style={{ width: 30, height: 24, padding: 0, border: `1px solid #ddd6c5`, borderRadius: 6, background: "#fff", cursor: "pointer" }} />
                  <input type="color" title="Line" value={toHex6(st.stroke)} onChange={(e) => setTypeStyle(k, { stroke: e.target.value })} style={{ width: 30, height: 24, padding: 0, border: `1px solid #ddd6c5`, borderRadius: 6, background: "#fff", cursor: "pointer" }} />
                </div>
              );
            })}
            <button style={{ ...chip, marginTop: 4, color: PAL.accent }} onClick={() => { pushHistory(); setSettings((s) => ({ ...s, typeStyles: {} })); }}>Reset all to built-in</button>
          </Section>

          {/* legend */}
          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: "7px 14px", padding: "10px 12px", background: "#f7f4ec", borderRadius: 10 }}>
            {Object.keys(TYPE).map((k) => {
              const st = typeStyle(k, settings);
              return (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#6b6557" }}>
                  <span style={{ width: 11, height: 11, background: st.fill, border: `1px solid ${st.stroke}`, borderRadius: 3, display: "inline-block" }} />{TYPE[k].label.split(" / ")[0]}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {typeMenu && (() => {
        const MW = 200, GAP = 8, vw = window.innerWidth, vh = window.innerHeight;
        const left = Math.max(GAP, Math.min(typeMenu.x + 6, vw - MW - GAP));
        const spaceBelow = vh - typeMenu.y - GAP, spaceAbove = typeMenu.y - GAP;
        const openUp = spaceBelow < spaceAbove; // open toward whichever side has more room
        const maxH = Math.max(140, openUp ? spaceAbove : spaceBelow);
        const vEdge = openUp ? { bottom: vh - typeMenu.y + 6 } : { top: typeMenu.y + 6 };
        return (
        <>
          <div onClick={() => setTypeMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 1998 }} />
          <div className="menu" style={{ ...menuPanel, position: "fixed", left, ...vEdge, zIndex: 1999, width: MW, maxHeight: maxH, overflowY: "auto" }}>
            {(() => {
              const t = els.find((el) => el.id === typeMenu.id);
              if (!t) return null;
              const isBuildingRect = t.type === "building" && !t.points;
              const hdr = (top) => ({ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", padding: top ? "8px 8px 6px" : "4px 8px 6px", ...(top ? { borderTop: `1px solid ${PAL.panelLine}`, marginTop: 4 } : {}) });
              const dock = t.dock || "single";
              return (
                <>
                  {isBuildingRect && (
                    <>
                      <div style={hdr(false)}>Dock layout</div>
                      {[["single", "Single-load (1 side)"], ["cross", "Cross-dock (2 sides)"], ["none", "No docks"]].map(([k, label]) => (
                        <button key={k} style={menuItem(dock === k)} onClick={() => setDockOf(typeMenu.id, k)}>{label}</button>
                      ))}
                      {dock !== "none" && (() => {
                        const side = t.dockSide || (t.w >= t.h ? "bottom" : "right");
                        const active = dock === "cross"
                          ? ((side === "top" || side === "bottom") ? ["top", "bottom"] : ["left", "right"])
                          : [side];
                        return (
                          <>
                            <div style={hdr(true)}>Dock side</div>
                            {[["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"]].map(([k, label]) => (
                              <button key={k} style={menuItem(active.includes(k))} onClick={() => setDockSideOf(typeMenu.id, k)}>{label}</button>
                            ))}
                          </>
                        );
                      })()}
                      <div style={hdr(true)}>Sidewalk</div>
                      <button style={menuItem(false)} onClick={() => { setSidewalkFor(typeMenu.id); setTypeMenu(null); }}>Add sidewalk — then click a side</button>
                      {dock !== "none" && (
                        <>
                          <div style={hdr(true)}>Dock features</div>
                          <button style={menuItem(false)} onClick={() => { addTruckCourt(t); setTypeMenu(null); }}>Add {TRUCK_COURT_D}′ truck court</button>
                          <button style={menuItem(false)} onClick={() => { addDogEars(t); setTypeMenu(null); }}>Add dock dog-ears ({DOGEAR_W}′×{DOGEAR_D}′)</button>
                          {dockSidesOf(t).opp && <button style={menuItem(false)} onClick={() => { addOppTrailerAll(t); setTypeMenu(null); }}>Add {OPP_TRAILER_D}′ trailer parking (opposite docks)</button>}
                        </>
                      )}
                    </>
                  )}
                  <div style={hdr(isBuildingRect)}>Attach</div>
                  {t.attachedTo
                    ? <button style={menuItem(false)} onClick={() => { detach(typeMenu.id); setTypeMenu(null); }}>Detach from its host</button>
                    : <button style={menuItem(false)} onClick={() => { setAttachFor(typeMenu.id); setTypeMenu(null); }}>Attach to another element — then click it</button>}
                  <div style={hdr(true)}>Lock</div>
                  <button style={menuItem(!!t.locked)} onClick={() => { toggleLock(typeMenu.id); setTypeMenu(null); }}>{t.locked ? "🔒 Unlock" : "🔒 Lock in place"} <span style={{ color: PAL.muted }}>(L)</span></button>
                </>
              );
            })()}
          </div>
        </>
        );
      })()}
    </div>
  );
}

/* element renderer working in PIXEL space (points pre-transformed by f2p).
   We draw the rect via the rotated group around the element's pixel center. */
function renderElPx(el, f2p, sel, tool, settings, startMoveEl, onElDouble) {
  const st = elStyle(el, settings);
  const fillOp = st.fillOpacity ?? 1;
  const isSel = sel?.kind === "el" && sel.id === el.id;
  if (el.points) { // polygon element (irregular area drawn by clicking points)
    const dPath = el.points.map((p, i) => { const q = f2p(p); return `${i ? "L" : "M"}${q.x},${q.y}`; }).join(" ") + "Z";
    return (
      <path key={el.id} d={dPath} fill={st.fill} fillOpacity={fillOp}
        stroke={isSel ? PAL.accent : st.stroke} strokeWidth={isSel ? 2.5 : 1.25}
        style={{ cursor: tool === "select" ? "move" : "crosshair" }}
        onPointerDown={(e) => startMoveEl(e, el.id)} onDoubleClick={(e) => onElDouble && onElDouble(e, el.id)}
        onContextMenu={(e) => { if (onElDouble) { e.preventDefault(); onElDouble(e, el.id); } }} />
    );
  }
  const tl = f2p({ x: el.cx - el.w / 2, y: el.cy - el.h / 2 });
  const c = f2p({ x: el.cx, y: el.cy });
  const ppf = (f2p({ x: 1, y: 0 }).x - f2p({ x: 0, y: 0 }).x); // px per foot
  const w = el.w * ppf, h = el.h * ppf;
  const parts = [];
  parts.push(<rect key="r" x={tl.x} y={tl.y} width={w} height={h} fill={st.fill} fillOpacity={fillOp}
    stroke={isSel ? PAL.accent : st.stroke} strokeWidth={isSel ? 2 : 1.25} rx={el.type === "pond" ? Math.min(w, h) * 0.12 : 0} />);

  if (el.type === "parking") {
    const cs = carStalls(el.w, el.h, settings);
    cs.bands.forEach((b, i) => {
      const bandW = b.n * b.pitch;
      parts.push(<rect key={`b${i}`} x={tl.x} y={tl.y + b.y * ppf} width={bandW * ppf} height={b.depth * ppf} fill="none" stroke={st.stroke} strokeWidth={0.75} />);
      const lean = b.dir * b.slantDx; // angled stalls lean toward their aisle
      for (let k = 1; k < b.n; k++) {
        const x = tl.x + k * b.pitch * ppf;
        parts.push(<line key={`b${i}d${k}`} x1={x} y1={tl.y + b.y * ppf} x2={x + lean * ppf} y2={tl.y + (b.y + b.depth) * ppf} stroke={st.stroke} strokeWidth={0.5} />);
      }
    });
    cs.aisles.forEach((a, i) =>
      parts.push(<line key={`a${i}`} x1={tl.x} y1={tl.y + (a.y0 + a.y1) / 2 * ppf} x2={tl.x + w} y2={tl.y + (a.y0 + a.y1) / 2 * ppf} stroke={st.stroke} strokeWidth={0.6} strokeDasharray="6 5" />));
  }
  if (el.type === "trailer") {
    const ts = trailerStalls(el.w, el.h, el.cfg ? { ...settings, ...el.cfg } : settings);
    ts.bands.forEach((b, i) => {
      const bandW = b.n * ts.tw;
      parts.push(<rect key={`tb${i}`} x={tl.x} y={tl.y + b.y * ppf} width={bandW * ppf} height={b.depth * ppf} fill="none" stroke={st.stroke} strokeWidth={0.75} />);
      for (let k = 1; k < b.n; k++)
        parts.push(<line key={`tb${i}d${k}`} x1={tl.x + k * ts.tw * ppf} y1={tl.y + b.y * ppf} x2={tl.x + k * ts.tw * ppf} y2={tl.y + (b.y + b.depth) * ppf} stroke={st.stroke} strokeWidth={0.55} />);
    });
    ts.aisles.forEach((a, i) =>
      parts.push(<line key={`ta${i}`} x1={tl.x} y1={tl.y + (a.y0 + a.y1) / 2 * ppf} x2={tl.x + w} y2={tl.y + (a.y0 + a.y1) / 2 * ppf} stroke={st.stroke} strokeWidth={0.6} strokeDasharray="8 6" />));
  }
  if (el.type === "building" && settings.showDocks && (el.dock || "single") !== "none") {
    const dock = el.dock || "single";
    const side = el.dockSide || (el.w >= el.h ? "bottom" : "right"); // persistent dock side
    const Dpx = Math.min(8, Math.min(el.w, el.h) * 0.25) * ppf; // dock-apron depth
    const sides = dock === "cross"
      ? ((side === "top" || side === "bottom") ? ["bottom", "top"] : ["right", "left"])
      : [side];
    sides.forEach((s) => {
      const horiz = s === "top" || s === "bottom";
      const bx = s === "right" ? w - Dpx : 0;
      const by = s === "bottom" ? h - Dpx : 0;
      const bw = horiz ? w : Dpx, bh = horiz ? Dpx : h;
      parts.push(<rect key={`db${s}`} x={tl.x + bx} y={tl.y + by} width={bw} height={bh} fill="#9aa3b0" fillOpacity={0.9} stroke="#5b6470" strokeWidth={1} />);
      const n = Math.floor((horiz ? el.w : el.h) / 12); // door divisions every 12'
      for (let k = 1; k < n; k++) {
        if (horiz) { const x = tl.x + bx + k * 12 * ppf; parts.push(<line key={`db${s}d${k}`} x1={x} y1={tl.y + by} x2={x} y2={tl.y + by + bh} stroke="#5b6470" strokeWidth={0.5} />); }
        else { const y = tl.y + by + k * 12 * ppf; parts.push(<line key={`db${s}d${k}`} x1={tl.x + bx} y1={y} x2={tl.x + bx + bw} y2={y} stroke="#5b6470" strokeWidth={0.5} />); }
      }
    });
  }
  if (el.type === "road") { // dashed centerline down the long axis
    if (el.w >= el.h) parts.push(<line key="cl" x1={tl.x} y1={tl.y + h / 2} x2={tl.x + w} y2={tl.y + h / 2} stroke="#f5d90a" strokeWidth={1.5} strokeDasharray="11 9" />);
    else parts.push(<line key="cl" x1={tl.x + w / 2} y1={tl.y} x2={tl.x + w / 2} y2={tl.y + h} stroke="#f5d90a" strokeWidth={1.5} strokeDasharray="11 9" />);
  }
  if ((el.type === "building" || el.type === "paving") && !el.points) {
    // Dimension line along the short side (depth of a building/truck court,
    // width of a drive). Scales text down a bit when zoomed out; kept upright.
    const k = Math.max(0.34, Math.min(1, ppf / 0.45));
    const RED = "#dc2626", tick = 4 * k, fz = 11 * k, txt = `${f0(Math.min(el.w, el.h))}′`;
    const horizLong = el.w >= el.h;
    const dim = [];
    if (horizLong) { // short side is vertical (h)
      const x = tl.x + w * 0.18, y0 = tl.y, y1 = tl.y + h, my = (y0 + y1) / 2;
      dim.push(<line key="dl" x1={x} y1={y0} x2={x} y2={y1} stroke={RED} strokeWidth={1.25} />);
      dim.push(<line key="t0" x1={x - tick} y1={y0} x2={x + tick} y2={y0} stroke={RED} strokeWidth={1.25} />);
      dim.push(<line key="t1" x1={x - tick} y1={y1} x2={x + tick} y2={y1} stroke={RED} strokeWidth={1.25} />);
      dim.push(<text key="tx" x={x + 5} y={my} transform={`rotate(${-el.rot} ${x + 5} ${my})`} fontSize={fz} fontFamily="ui-monospace, Menlo, monospace" fill={RED} stroke="#fff" strokeWidth={2.5} paintOrder="stroke" dominantBaseline="middle" fontWeight="600">{txt}</text>);
    } else { // short side is horizontal (w)
      const y = tl.y + h * 0.18, x0 = tl.x, x1 = tl.x + w, mx = (x0 + x1) / 2;
      dim.push(<line key="dl" x1={x0} y1={y} x2={x1} y2={y} stroke={RED} strokeWidth={1.25} />);
      dim.push(<line key="t0" x1={x0} y1={y - tick} x2={x0} y2={y + tick} stroke={RED} strokeWidth={1.25} />);
      dim.push(<line key="t1" x1={x1} y1={y - tick} x2={x1} y2={y + tick} stroke={RED} strokeWidth={1.25} />);
      dim.push(<text key="tx" x={mx} y={y - 5} transform={`rotate(${-el.rot} ${mx} ${y - 5})`} textAnchor="middle" fontSize={fz} fontFamily="ui-monospace, Menlo, monospace" fill={RED} stroke="#fff" strokeWidth={2.5} paintOrder="stroke" fontWeight="600">{txt}</text>);
    }
    parts.push(<g key="dim">{dim}</g>);
  }
  return <g key={el.id} transform={`rotate(${el.rot} ${c.x} ${c.y})`} style={{ cursor: tool === "select" ? "move" : "crosshair" }}
    onPointerDown={(e) => startMoveEl(e, el.id)} onDoubleClick={(e) => onElDouble && onElDouble(e, el.id)}
    onContextMenu={(e) => { if (onElDouble) { e.preventDefault(); onElDouble(e, el.id); } }}>{parts}</g>;
}

/* ----------------------------- small UI ----------------------------- */
function Section({ title, children, collapsed }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div style={{ marginBottom: 4, paddingBottom: 12, borderBottom: "1px solid #f0ebdf" }}>
      <div onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", padding: "6px 0", userSelect: "none" }}>
        <span style={{ fontSize: 8.5, color: "#b3aa92", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s", width: 9 }}>▶</span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b6557" }}>{title}</span>
      </div>
      {open && <div style={{ paddingTop: 4 }}>{children}</div>}
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
      <span style={{ fontSize: 12, color: "#8a8473" }}>{label}</span>{children}
    </div>
  );
}
