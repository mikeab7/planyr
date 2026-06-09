import { useState, useRef, useEffect, useCallback } from "react";
import { storage } from "./lib/storage.js";
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
  building: { fill: "#c6ccd3", stroke: "#5b6470", label: "Building" },
  paving: { fill: "#e7e2d4", stroke: "#b3a98f", label: "Paving / Drive" },
  parking: { fill: "#efece0", stroke: "#b3a98f", label: "Car Parking" },
  trailer: { fill: "#e9e2cc", stroke: "#a8915f", label: "Trailer Parking" },
  pond: { fill: "#bcd6e6", stroke: "#5d89a6", label: "Detention Pond" },
};

const TOOLS = [
  { id: "select", label: "Select", hint: "Move/resize/rotate • on a selected parcel: drag a dot to move a corner, click a + to add one, Shift-click a dot to delete • drag empty space to pan" },
  { id: "parcel", label: "Parcel", hint: "Click to drop boundary points • click the first point (or double-click) to close • Esc cancels" },
  { id: "split", label: "Split", hint: "Cut a parcel: click two points to draw a line across it (e.g. 275′ off the frontage); it splits into two — then delete the piece you don't want" },
  { id: "building", label: "Building", hint: "Click-drag to draw a building footprint" },
  { id: "paving", label: "Paving", hint: "Click-drag to draw paving / drive aisle / truck court" },
  { id: "parking", label: "Parking", hint: "Click-drag to draw a car-parking field (stalls auto-count)" },
  { id: "trailer", label: "Trailer", hint: "Click-drag to draw trailer-stall storage (auto-count)" },
  { id: "pond", label: "Pond", hint: "Click-drag to draw a detention area (rectangle in this version)" },
  { id: "measure", label: "Measure", hint: "Click two points to measure a distance (truck court depth, setbacks, drive widths)" },
  { id: "calibrate", label: "Calibrate", hint: "Underlay scale: click two points a known distance apart on the screenshot, then enter the real length at right" },
];
const DRAW_TYPES = ["building", "paving", "parking", "trailer", "pond"];

/* ----------------------------- geometry ---------------------------- */
const rot2 = (x, y, deg) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
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

const DEFAULT_SETTINGS = {
  gridSize: 10, snap: true,
  setback: 25, showSetback: true,
  stallW: 9, stallDepth: 18, aisle: 24, parkAngle: 90,
  trailerW: 12, trailerL: 53, trailerAisle: 60,
  showDocks: true,
};

export default function SitePlanner({ active = true, incoming = null, onBackToMap } = {}) {
  const [parcels, setParcels] = useState([]);   // {id, points:[{x,y}]}
  const [els, setEls] = useState([]);           // {id,type,cx,cy,w,h,rot}
  const [measures, setMeasures] = useState([]); // {a,b}
  const [tool, setTool] = useState("select");
  const [toolMenu, setToolMenu] = useState(false); // Parcel ▾ dropdown open
  const [sel, setSel] = useState(null);         // {kind:'el'|'parcel', id}
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const [view, setView] = useState({ ppf: 0.35, offX: 60, offY: 60 });
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [cursor, setCursor] = useState(null);   // {x,y} feet

  // parcel drafting + draw drafting + measure
  const [draftPoly, setDraftPoly] = useState(null);  // array of feet pts
  const [draftRect, setDraftRect] = useState(null);  // {type, x,y,w,h} feet
  const [pendMeasure, setPendMeasure] = useState(null);
  const [splitA, setSplitA] = useState(null);        // first point of a split cut

  // aerial underlay + scale calibration
  const [underlay, setUnderlay] = useState(null);    // {src,imgW,imgH,x,y,ftPerPx,opacity,locked}
  const [underlayErr, setUnderlayErr] = useState(false);
  const [underlayLoading, setUnderlayLoading] = useState(false);
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

  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const drag = useRef(null);

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

  /* ------------ fit to content ------------ */
  const fit = useCallback(() => {
    const pts = [];
    parcels.forEach((pc) => pts.push(...pc.points));
    els.forEach((e) => pts.push(...elCorners(e)));
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

  // Load a site handed in from the map finder: one or more parcels in a shared
  // feet frame plus the matching aerial. Each selection is a fresh site.
  const consumedRef = useRef(null);
  useEffect(() => {
    if (incoming && incoming !== consumedRef.current && incoming.parcels?.length) {
      consumedRef.current = incoming;
      const pcs = incoming.parcels.filter((p) => p.points?.length >= 3).map((p) => ({ id: uid(), points: p.points }));
      setParcels(pcs);
      setEls([]);
      setMeasures([]);
      setUnderlay(incoming.underlay || null);
      setUnderlayErr(false);
      setUnderlayLoading(!!incoming.underlay);
      setSel(pcs.length === 1 ? { kind: "parcel", id: pcs[0].id } : null);
    }
  }, [incoming]);

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
      if (e.key === "Escape") { setDraftPoly(null); setDraftRect(null); setPendMeasure(null); setCalib(null); setSplitA(null); setSel(null); setTool("select"); }
      if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); deleteSel(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel]); // eslint-disable-line

  const deleteSel = () => {
    if (!sel) return;
    if (sel.kind === "el") setEls((a) => a.filter((e) => e.id !== sel.id));
    else setParcels((a) => a.filter((p) => p.id !== sel.id));
    setSel(null);
  };

  /* ------------ pointer handlers (svg root) ------------ */
  const onBgDown = (e) => {
    if (e.button !== 0) return;
    const fp = p2f(e.clientX, e.clientY);

    if (tool === "select") {
      setSel(null);
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
      if (!pendMeasure) setPendMeasure(sp);
      else { setMeasures((m) => [...m, { a: pendMeasure, b: sp }]); setPendMeasure(null); }
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
      const sp = snapPt(fp);
      if (!splitA) setSplitA(sp);
      else { performSplit(splitA, sp); setSplitA(null); }
      return;
    }
    if (DRAW_TYPES.includes(tool)) {
      const sp = snapPt(fp);
      drag.current = { mode: "draw", type: tool, ox: sp.x, oy: sp.y };
      setDraftRect({ type: tool, x: sp.x, y: sp.y, w: 0, h: 0 });
      svgRef.current.setPointerCapture(e.pointerId);
    }
  };

  // Split the selected parcel (or whichever parcel the cut line crosses).
  const performSplit = (A, B) => {
    const ordered = sel?.kind === "parcel"
      ? [parcels.find((p) => p.id === sel.id), ...parcels.filter((p) => p.id !== sel.id)].filter(Boolean)
      : parcels;
    for (const pc of ordered) {
      const halves = splitPolygon(pc.points, A, B);
      if (halves) {
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
      const x = Math.min(d.ox, sp.x), y = Math.min(d.oy, sp.y);
      setDraftRect({ type: d.type, x, y, w: Math.abs(sp.x - d.ox), h: Math.abs(sp.y - d.oy) });
      return;
    }
    if (d.mode === "move") {
      const dx = fp.x - d.fx, dy = fp.y - d.fy;
      if (d.kind === "el") {
        setEls((a) => a.map((el) => el.id === d.id ? { ...el, cx: snap(d.ocx + dx), cy: snap(d.ocy + dy) } : el));
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
      setEls((a) => a.map((x) => x.id === d.id ? { ...x, w: nw, h: nh, cx: newCenter.x, cy: newCenter.y } : x));
      return;
    }
    if (d.mode === "rotate") {
      const el = els.find((x) => x.id === d.id);
      if (!el) return;
      let ang = Math.atan2(fp.y - el.cy, fp.x - el.cx) * 180 / Math.PI + 90;
      ang = settings.snap ? Math.round(ang / 15) * 15 : Math.round(ang);
      setEls((a) => a.map((x) => x.id === d.id ? { ...x, rot: ((ang % 360) + 360) % 360 } : x));
      return;
    }
  };

  const onUp = (e) => {
    const d = drag.current;
    if (d && d.mode === "draw" && draftRect) {
      if (draftRect.w >= 4 && draftRect.h >= 4) {
        const el = { id: uid(), type: draftRect.type, cx: draftRect.x + draftRect.w / 2, cy: draftRect.y + draftRect.h / 2, w: draftRect.w, h: draftRect.h, rot: 0 };
        setEls((a) => [...a, el]);
        setSel({ kind: "el", id: el.id });
      }
      setDraftRect(null);
    }
    drag.current = null;
    try { svgRef.current.releasePointerCapture(e.pointerId); } catch (_) {}
  };

  const closePoly = () => {
    if (draftPoly && draftPoly.length >= 3) {
      const pc = { id: uid(), points: draftPoly };
      setParcels((a) => [...a, pc]);
      requestFit();
    }
    setDraftPoly(null);
    setTool("select");
  };
  const onBgDouble = () => { if (tool === "parcel") closePoly(); };

  const addRectParcel = () => {
    const w = Math.max(20, +lotW || 0), d = Math.max(20, +lotD || 0);
    const pc = { id: uid(), points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }] };
    setParcels((a) => [...a, pc]);
    requestFit();
  };

  /* ------------ aerial underlay ------------ */
  const onUnderlayFile = async (file) => {
    if (!file) return;
    try {
      const { src, w, h } = await loadAndDownscaleImage(file);
      // Start at ~600 ft across the image width; the user calibrates precisely next.
      setUnderlay({ src, imgW: w, imgH: h, x: 0, y: 0, ftPerPx: 600 / w, opacity: 0.85, locked: false });
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
    const pc = { id: uid(), points: pts };
    setParcels((a) => [...a, pc]);
    setSel({ kind: "parcel", id: pc.id });
    setLookupRes([]);
    requestFit();
  };

  /* ------------ element / handle interactions ------------ */
  const startMoveEl = (e, id) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    const el = els.find((x) => x.id === id);
    const fp = p2f(e.clientX, e.clientY);
    setSel({ kind: "el", id });
    drag.current = { mode: "move", kind: "el", id, fx: fp.x, fy: fp.y, ocx: el.cx, ocy: el.cy };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const startMoveParcel = (e, id) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    const pc = parcels.find((x) => x.id === id);
    const fp = p2f(e.clientX, e.clientY);
    setSel({ kind: "parcel", id });
    drag.current = { mode: "move", kind: "parcel", id, fx: fp.x, fy: fp.y, opts: pc.points };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const startResize = (e, id, sx, sy) => {
    e.stopPropagation();
    const el = els.find((x) => x.id === id);
    // fixed opposite corner in world feet
    const oppLocal = rot2(-sx * el.w / 2, -sy * el.h / 2, el.rot);
    const opp = { x: el.cx + oppLocal.x, y: el.cy + oppLocal.y };
    drag.current = { mode: "resize", id, sx, sy, opp };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const startRotate = (e, id) => {
    e.stopPropagation();
    drag.current = { mode: "rotate", id };
    svgRef.current.setPointerCapture(e.pointerId);
  };

  /* ------------ metrics ------------ */
  const siteSqft = parcels.reduce((s, p) => s + polyArea(p.points), 0);
  let bldg = 0, paving = 0, parkArea = 0, trailArea = 0, pondArea = 0, stalls = 0, trailers = 0;
  els.forEach((e) => {
    const a = e.w * e.h;
    if (e.type === "building") bldg += a;
    else if (e.type === "paving") paving += a;
    else if (e.type === "parking") { parkArea += a; stalls += carStalls(e.w, e.h, settings).count; }
    else if (e.type === "trailer") { trailArea += a; trailers += trailerStalls(e.w, e.h, settings).count; }
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
        setParcels(d.parcels || []); setEls(d.els || []); setMeasures(d.measures || []);
        if (d.settings) setSettings(d.settings);
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
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify({ parcels, els, measures, settings, underlay }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "site-plan.json";
    a.click();
    URL.revokeObjectURL(a.href);
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
  const labelEls = els.map((el) => {
    const c = f2p({ x: el.cx, y: el.cy });
    const lines = [TYPE[el.type].label.split(" / ")[0]];
    if (el.type === "parking") lines.push(`${f0(carStalls(el.w, el.h, settings).count)} stalls`);
    else if (el.type === "trailer") lines.push(`${f0(trailerStalls(el.w, el.h, settings).count)} trailers`);
    else lines.push(`${f0(el.w * el.h)} sf`);
    lines.push(`${f0(el.w)}′ × ${f0(el.h)}′`);
    return (
      <text key={`lbl${el.id}`} x={c.x} y={c.y - (lines.length - 1) * 7} textAnchor="middle" pointerEvents="none"
        fontSize="11" fontFamily="ui-monospace, Menlo, monospace" fill={PAL.ink}
        stroke={PAL.paper} strokeWidth={3} paintOrder="stroke" style={{ fontWeight: 500 }}>
        {lines.map((t, i) => <tspan key={i} x={c.x} dy={i === 0 ? 0 : 13}>{t}</tspan>)}
      </text>
    );
  });

  const parcelLabels = parcels.map((pc) => {
    const c = f2p(centroid(pc.points));
    const ac = polyArea(pc.points) / SQFT_PER_ACRE;
    return (
      <text key={`pl${pc.id}`} x={c.x} y={c.y} textAnchor="middle" pointerEvents="none"
        fontSize="12" fontFamily="ui-monospace, Menlo, monospace" fill={PAL.muted}
        stroke={PAL.paper} strokeWidth={3} paintOrder="stroke">{f2(ac)} ac</text>
    );
  });

  const handleNodes = (() => {
    if (sel?.kind !== "el") return null;
    const el = els.find((x) => x.id === sel.id);
    if (!el) return null;
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
            style={{ cursor: "nwse-resize" }} onPointerDown={(e) => startResize(e, el.id, signs[i][0], signs[i][1])} />
        ))}
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
  const btn = (active) => ({
    padding: "6px 11px", fontSize: 12.5, borderRadius: 7, cursor: "pointer",
    border: `1px solid ${active ? PAL.accent : PAL.panelLine}`,
    background: active ? PAL.accent : "#fbfaf6", color: active ? "#fff" : PAL.ink,
    fontWeight: active ? 600 : 500, fontFamily: "inherit",
  });
  const chip = { padding: "5px 9px", fontSize: 12, borderRadius: 6, border: `1px solid ${PAL.panelLine}`, background: "#fbfaf6", color: PAL.ink, cursor: "pointer", fontFamily: "inherit" };
  const numInput = { width: 58, padding: "4px 6px", fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace", border: `1px solid ${PAL.panelLine}`, borderRadius: 5, color: PAL.ink, background: "#fff" };
  const menuItem = (on) => ({ display: "block", width: "100%", textAlign: "left", padding: "8px 9px", fontSize: 12.5, borderRadius: 6, cursor: "pointer", border: "none", background: on ? PAL.accentSoft : "transparent", color: PAL.ink, fontFamily: "inherit", fontWeight: on ? 600 : 500 });
  const toolDivider = <span style={{ width: 1, alignSelf: "stretch", background: PAL.panelLine, margin: "2px 3px" }} />;
  // Switch tools and reset any in-progress drafting; also closes the Parcel menu.
  const selectTool = (id) => {
    setTool(id);
    setDraftPoly(null); setDraftRect(null); setPendMeasure(null); setSplitA(null);
    if (id !== "calibrate") setCalib(null);
    setToolMenu(false);
  };
  const metricRow = (label, value, sub) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "6px 0", borderBottom: `1px solid ${PAL.panelLine}` }}>
      <span style={{ fontSize: 12, color: PAL.muted }}>{label}</span>
      <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13.5, color: PAL.ink, fontWeight: 600 }}>{value}{sub && <span style={{ color: PAL.muted, fontWeight: 400, fontSize: 11 }}> {sub}</span>}</span>
    </div>
  );

  const selEl = sel?.kind === "el" ? els.find((e) => e.id === sel.id) : null;
  const setSelEl = (patch) => setEls((a) => a.map((e) => e.id === selEl.id ? { ...e, ...patch } : e));
  const curHint = TOOLS.find((t) => t.id === tool)?.hint;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", minHeight: 600, background: "#efeadf",
      fontFamily: "'Helvetica Neue', Helvetica, system-ui, sans-serif", color: PAL.ink, overflow: "hidden" }}>

      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: PAL.panelBg, borderBottom: `1px solid ${PAL.panelLine}`, flexWrap: "wrap" }}>
        {onBackToMap && <button style={chip} onClick={onBackToMap}>← Map</button>}
        <div style={{ fontWeight: 700, letterSpacing: "0.04em", fontSize: 13.5, textTransform: "uppercase", marginRight: 4 }}>
          <span style={{ color: PAL.accent }}>▦</span> Site Planner <span style={{ color: PAL.muted, fontWeight: 500, textTransform: "none", letterSpacing: 0 }}>· industrial</span>
        </div>
        <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
          <button style={btn(tool === "select")} onClick={() => selectTool("select")}>Select</button>

          {/* parcel tools grouped in one menu */}
          <div style={{ position: "relative" }}>
            <button style={btn(tool === "parcel" || tool === "split")} onClick={() => setToolMenu((o) => !o)}>Parcel ▾</button>
            {toolMenu && (
              <>
                <div onClick={() => setToolMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <div style={{ position: "absolute", top: "calc(100% + 5px)", left: 0, zIndex: 50, background: "#fff", border: `1px solid ${PAL.panelLine}`, borderRadius: 9, boxShadow: "0 8px 24px rgba(0,0,0,0.16)", padding: 6, width: 248 }}>
                  <button style={menuItem(tool === "parcel")} onClick={() => selectTool("parcel")}>Draw new parcel</button>
                  <button style={menuItem(tool === "split")} onClick={() => selectTool("split")}>Split a parcel</button>
                  <div style={{ fontSize: 11, color: PAL.muted, padding: "7px 8px 2px", lineHeight: 1.5, borderTop: `1px solid ${PAL.panelLine}`, marginTop: 4 }}>
                    <b style={{ color: PAL.ink }}>Reshape:</b> pick <b>Select</b>, click the parcel, then drag its dots — the <b>＋</b> on an edge adds a corner, <b>Shift-click</b> a dot removes it.
                  </div>
                </div>
              </>
            )}
          </div>

          {toolDivider}

          {DRAW_TYPES.map((id) => { const t = TOOLS.find((x) => x.id === id); return <button key={id} style={btn(tool === id)} onClick={() => selectTool(id)}>{t.label}</button>; })}

          {toolDivider}

          <button style={btn(tool === "measure")} onClick={() => selectTool("measure")}>Measure</button>
        </div>
        <div style={{ flex: 1 }} />
        <button style={chip} onClick={fit}>Fit</button>
        <button style={{ ...chip, color: settings.snap ? PAL.accent : PAL.muted, borderColor: settings.snap ? PAL.accent : PAL.panelLine }} onClick={() => setSettings((s) => ({ ...s, snap: !s.snap }))}>Snap {settings.gridSize}′</button>
        <button style={chip} onClick={() => setMeasures([])}>Clear measures</button>
        <button style={{ ...chip, color: PAL.accent }} onClick={() => { if (sel) deleteSel(); }}>Delete</button>
        <button style={chip} onClick={() => { setParcels([]); setEls([]); setMeasures([]); setSel(null); }}>Clear all</button>
      </div>

      {/* body */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* canvas */}
        <div ref={wrapRef} style={{ flex: 1, position: "relative", minWidth: 0 }}>
          <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${size.w} ${size.h}`}
            style={{ background: PAL.paper, display: "block", touchAction: "none", cursor: tool === "select" ? "default" : "crosshair" }}
            onPointerDown={onBgDown} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={onBgDouble}>

            <g>{gridLines()}</g>

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
                  fill={isSel ? PAL.accentSoft : "#faf7f0"} fillOpacity={isSel ? 0.5 : 0.55}
                  stroke={isSel ? PAL.accent : PAL.parcel} strokeWidth={isSel ? 3 : 2}
                  style={{ cursor: tool === "select" ? "move" : "crosshair" }}
                  onPointerDown={(e) => startMoveParcel(e, pc.id)} />;
              })}
              {/* elements (drawn in PIXELS; coords pre-transformed by f2p) */}
              {els.map((el) => renderElPx(el, f2p, sel, tool, settings, startMoveEl))}
              {/* measurements */}
              {measures.map((m, i) => {
                const a = f2p(m.a), b = f2p(m.b);
                const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                return (
                  <g key={`m${i}`} pointerEvents="none">
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={PAL.accent} strokeWidth={1.5} />
                    <circle cx={a.x} cy={a.y} r={3} fill={PAL.accent} /><circle cx={b.x} cy={b.y} r={3} fill={PAL.accent} />
                    <text x={mid.x} y={mid.y - 5} textAnchor="middle" fontSize="12" fontFamily="ui-monospace, Menlo, monospace"
                      fill={PAL.accent} stroke={PAL.paper} strokeWidth={3} paintOrder="stroke" fontWeight="700">{f0(dist(m.a, m.b))}′</text>
                  </g>
                );
              })}
              {pendMeasure && cursor && (
                <line x1={f2p(pendMeasure).x} y1={f2p(pendMeasure).y} x2={f2p(snapPt(cursor)).x} y2={f2p(snapPt(cursor)).y} stroke={PAL.accent} strokeWidth={1.25} strokeDasharray="5 4" pointerEvents="none" />
              )}
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
                <g pointerEvents="none"><rect x={a.x} y={a.y} width={draftRect.w * view.ppf} height={draftRect.h * view.ppf} fill={TYPE[draftRect.type].fill} fillOpacity={0.5} stroke={PAL.accent} strokeWidth={1.5} strokeDasharray="5 4" /></g>
              ); })()}
              {/* split cut preview */}
              {tool === "split" && splitA && (() => {
                const a = f2p(splitA);
                const b = cursor ? f2p(snapPt(cursor)) : a;
                const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                return (
                  <g pointerEvents="none">
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={PAL.accent} strokeWidth={1.5} strokeDasharray="6 5" />
                    <circle cx={a.x} cy={a.y} r={4} fill={PAL.paper} stroke={PAL.accent} strokeWidth={1.5} />
                    {cursor && <text x={mid.x} y={mid.y - 6} textAnchor="middle" fontSize="11" fontFamily="ui-monospace, Menlo, monospace" fill={PAL.accent} stroke={PAL.paper} strokeWidth={3} paintOrder="stroke" fontWeight="700">{f0(dist(splitA, snapPt(cursor)))}′ cut</text>}
                  </g>
                );
              })()}

              {parcelLabels}
              {labelEls}
              {parcelEdgeLabels}
              {handleNodes}
              {parcelHandles}
            </g>

            {/* scale bar */}
            <g transform={`translate(${size.w - scaleBarFt.px - 24}, ${size.h - 26})`} pointerEvents="none">
              <line x1={0} y1={0} x2={scaleBarFt.px} y2={0} stroke={PAL.ink} strokeWidth={2} />
              <line x1={0} y1={-4} x2={0} y2={4} stroke={PAL.ink} strokeWidth={2} />
              <line x1={scaleBarFt.px} y1={-4} x2={scaleBarFt.px} y2={4} stroke={PAL.ink} strokeWidth={2} />
              <text x={scaleBarFt.px / 2} y={-7} textAnchor="middle" fontSize="11" fontFamily="ui-monospace, Menlo, monospace" fill={PAL.ink}>{f0(scaleBarFt.ft)}′</text>
            </g>
          </svg>

          {/* empty state */}
          {parcels.length === 0 && els.length === 0 && !underlay && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <div style={{ textAlign: "center", color: PAL.muted, background: "rgba(255,255,255,0.7)", padding: "16px 22px", borderRadius: 10, border: `1px dashed ${PAL.gridMajor}` }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: PAL.ink, marginBottom: 4 }}>Start your site</div>
                <div style={{ fontSize: 12.5 }}>Look up a parcel by county at right, drop a screenshot underlay, type a lot size, or use the <b>Parcel</b> tool to draw a boundary.</div>
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
          <div style={{ position: "absolute", left: 0, bottom: 0, display: "flex", gap: 14, alignItems: "center", padding: "5px 12px", fontSize: 11.5, color: PAL.muted, fontFamily: "ui-monospace, Menlo, monospace", background: "rgba(244,241,234,0.85)", borderTop: `1px solid ${PAL.panelLine}`, borderRight: `1px solid ${PAL.panelLine}`, borderTopRightRadius: 8 }}>
            <span>{cursor ? `${f0(cursor.x)}′, ${f0(cursor.y)}′` : "—"}</span>
            <span>{Math.round(view.ppf * 100) / 100} px/ft</span>
            <span style={{ color: PAL.ink }}>{curHint}</span>
          </div>
        </div>

        {/* inspector */}
        <div style={{ width: 300, background: PAL.panelBg, borderLeft: `1px solid ${PAL.panelLine}`, overflowY: "auto", padding: "12px 14px" }}>
          {/* county parcel lookup */}
          <Section title="Parcel lookup">
            <div style={{ display: "flex", gap: 6, marginBottom: 7 }}>
              <select style={{ ...numInput, width: "100%", fontFamily: "inherit" }} value={county} onChange={(e) => onCountyChange(e.target.value)}>
                {Object.entries(COUNTIES).map(([k, c]) => <option key={k} value={k}>{c.label}{c.experimental ? " (beta)" : ""}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 7 }}>
              <select style={{ ...numInput, width: 96, fontFamily: "inherit" }} value={searchMode} onChange={(e) => setSearchMode(e.target.value)}>
                <option value="address">Address</option>
                <option value="id">Account #</option>
              </select>
              <input style={{ ...numInput, width: "100%", fontFamily: "inherit" }} placeholder={searchMode === "address" ? "1234 Main St" : "Account / parcel id"} value={searchVal}
                onChange={(e) => setSearchVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") runLookup(); }} />
              <button style={btn(false)} disabled={lookupBusy} onClick={runLookup}>{lookupBusy ? "…" : "Find"}</button>
            </div>
            {COUNTIES[county]?.help && <div style={{ fontSize: 11, color: PAL.muted, marginBottom: 6 }}>{COUNTIES[county].help}</div>}
            <details style={{ marginBottom: 6 }}>
              <summary style={{ fontSize: 11, color: PAL.muted, cursor: "pointer" }}>Service / layer URL</summary>
              <input style={{ ...numInput, width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 10.5, marginTop: 5 }} value={lookupUrl} onChange={(e) => setLookupUrl(e.target.value)} />
            </details>
            {lookupErr && <div style={{ fontSize: 11.5, color: PAL.accent, marginBottom: 6, lineHeight: 1.45 }}>{lookupErr}</div>}
            {lookupRes.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 4 }}>
                {lookupRes.map((entry, i) => {
                  const attrs = entry.ft.attributes || {};
                  const addr = entry.addrField ? attrs[entry.addrField] : null;
                  const id = entry.idField ? attrs[entry.idField] : null;
                  return (
                    <button key={i} style={{ ...chip, textAlign: "left", lineHeight: 1.35 }} onClick={() => importFeature(entry)}>
                      <div style={{ color: PAL.ink, fontWeight: 600, fontSize: 11.5 }}>{addr || "(no address)"}</div>
                      {id != null && <div style={{ color: PAL.muted, fontSize: 10.5, fontFamily: "ui-monospace, monospace" }}>#{String(id)}</div>}
                    </button>
                  );
                })}
                <div style={{ fontSize: 10.5, color: PAL.muted }}>Click a result to import its boundary →</div>
              </div>
            )}
          </Section>

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
                <Field label="Opacity">
                  <input type="range" min={0.1} max={1} step={0.05} value={underlay.opacity} onChange={(e) => setUnderlay((u) => ({ ...u, opacity: +e.target.value }))} />
                </Field>
                <label style={{ display: "flex", gap: 8, fontSize: 12, color: PAL.muted, margin: "2px 0 8px", cursor: "pointer" }}>
                  <input type="checkbox" checked={underlay.locked} onChange={(e) => setUnderlay((u) => ({ ...u, locked: e.target.checked }))} /> Lock (click-through so you can draw over it)
                </label>
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

          {/* quick parcel */}
          <Section title="New parcel" collapsed>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontSize: 12, color: PAL.muted }}>W</label>
              <input style={numInput} value={lotW} onChange={(e) => setLotW(e.target.value)} />
              <label style={{ fontSize: 12, color: PAL.muted }}>D</label>
              <input style={numInput} value={lotD} onChange={(e) => setLotD(e.target.value)} />
              <span style={{ fontSize: 11, color: PAL.muted }}>ft</span>
              <button style={{ ...btn(false), marginLeft: "auto" }} onClick={addRectParcel}>Add</button>
            </div>
            <div style={{ fontSize: 11, color: PAL.muted, marginTop: 6 }}>= {f2((Math.max(0, +lotW || 0) * Math.max(0, +lotD || 0)) / SQFT_PER_ACRE)} ac. Draw multiple to model an assemblage.</div>
          </Section>

          {/* selected element */}
          {selEl && (
            <Section title={`Selected · ${TYPE[selEl.type].label}`}>
              <Field label="Width (ft)"><input style={numInput} value={Math.round(selEl.w)} onChange={(e) => setSelEl({ w: Math.max(settings.gridSize, +e.target.value || 0) })} /></Field>
              <Field label="Depth (ft)"><input style={numInput} value={Math.round(selEl.h)} onChange={(e) => setSelEl({ h: Math.max(settings.gridSize, +e.target.value || 0) })} /></Field>
              <Field label="Rotation (°)"><input style={numInput} value={Math.round(selEl.rot)} onChange={(e) => setSelEl({ rot: ((+e.target.value || 0) % 360 + 360) % 360 })} /></Field>
              <div style={{ fontSize: 12, color: PAL.muted, marginTop: 6, lineHeight: 1.6 }}>
                Footprint: <b style={{ color: PAL.ink }}>{f0(selEl.w * selEl.h)} sf</b><br />
                {selEl.type === "parking" && <>Stalls: <b style={{ color: PAL.ink }}>{f0(carStalls(selEl.w, selEl.h, settings).count)}</b> @ {settings.stallW}′×{settings.stallDepth}′ {settings.parkAngle}°, {settings.aisle}′ aisle</>}
                {selEl.type === "trailer" && <>Trailer stalls: <b style={{ color: PAL.ink }}>{f0(trailerStalls(selEl.w, selEl.h, settings).count)}</b> @ {settings.trailerW}′×{settings.trailerL}′, {settings.trailerAisle}′ drive lane</>}
                {selEl.type === "building" && <>Est. dock doors (long side): <b style={{ color: PAL.ink }}>{Math.floor(Math.max(selEl.w, selEl.h) / 12)}</b> @ 12′ o.c.</>}
              </div>
              <button style={{ ...chip, marginTop: 8, color: PAL.accent }} onClick={deleteSel}>Delete element</button>
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
            <Field label="Setback (ft)"><input style={numInput} value={settings.setback} onChange={(e) => setSettings((s) => ({ ...s, setback: Math.max(0, +e.target.value || 0) }))} /></Field>
            <Field label="Stall W / D"><span><input style={{ ...numInput, width: 42 }} value={settings.stallW} onChange={(e) => setSettings((s) => ({ ...s, stallW: +e.target.value || 9 }))} /> <input style={{ ...numInput, width: 42 }} value={settings.stallDepth} onChange={(e) => setSettings((s) => ({ ...s, stallDepth: +e.target.value || 18 }))} /></span></Field>
            <Field label="Drive aisle"><input style={numInput} value={settings.aisle} onChange={(e) => setSettings((s) => ({ ...s, aisle: +e.target.value || 24 }))} /></Field>
            <Field label="Park angle"><select style={{ ...numInput, width: 58 }} value={settings.parkAngle} onChange={(e) => setSettings((s) => ({ ...s, parkAngle: +e.target.value }))}><option value={90}>90°</option><option value={60}>60°</option><option value={45}>45°</option></select></Field>
            <Field label="Trailer W / L"><span><input style={{ ...numInput, width: 42 }} value={settings.trailerW} onChange={(e) => setSettings((s) => ({ ...s, trailerW: +e.target.value || 12 }))} /> <input style={{ ...numInput, width: 42 }} value={settings.trailerL} onChange={(e) => setSettings((s) => ({ ...s, trailerL: +e.target.value || 53 }))} /></span></Field>
            <Field label="Trailer aisle"><input style={numInput} value={settings.trailerAisle} onChange={(e) => setSettings((s) => ({ ...s, trailerAisle: +e.target.value || 0 }))} /></Field>
            <label style={{ display: "flex", gap: 8, fontSize: 12, color: PAL.muted, marginTop: 6, cursor: "pointer" }}><input type="checkbox" checked={settings.showSetback} onChange={(e) => setSettings((s) => ({ ...s, showSetback: e.target.checked }))} /> Show setback line</label>
            <label style={{ display: "flex", gap: 8, fontSize: 12, color: PAL.muted, marginTop: 4, cursor: "pointer" }}><input type="checkbox" checked={settings.showDocks} onChange={(e) => setSettings((s) => ({ ...s, showDocks: e.target.checked }))} /> Show dock doors</label>
          </Section>

          {/* scenarios */}
          <Section title="Save / load" collapsed>
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
            <button style={{ ...chip, marginTop: 7, width: "100%" }} onClick={exportJSON}>Export JSON</button>
          </Section>

          {/* legend */}
          <div style={{ marginTop: 8, paddingTop: 10, borderTop: `1px solid ${PAL.panelLine}`, display: "flex", flexWrap: "wrap", gap: "6px 12px" }}>
            {Object.entries(TYPE).map(([k, v]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: PAL.muted }}>
                <span style={{ width: 12, height: 12, background: v.fill, border: `1px solid ${v.stroke}`, borderRadius: 2, display: "inline-block" }} />{v.label.split(" / ")[0]}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* element renderer working in PIXEL space (points pre-transformed by f2p).
   We draw the rect via the rotated group around the element's pixel center. */
function renderElPx(el, f2p, sel, tool, settings, startMoveEl) {
  const st = TYPE[el.type];
  const tl = f2p({ x: el.cx - el.w / 2, y: el.cy - el.h / 2 });
  const c = f2p({ x: el.cx, y: el.cy });
  const ppf = (f2p({ x: 1, y: 0 }).x - f2p({ x: 0, y: 0 }).x); // px per foot
  const w = el.w * ppf, h = el.h * ppf;
  const isSel = sel?.kind === "el" && sel.id === el.id;
  const parts = [];
  parts.push(<rect key="r" x={tl.x} y={tl.y} width={w} height={h} fill={st.fill} fillOpacity={el.type === "pond" ? 0.85 : 0.92}
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
    const ts = trailerStalls(el.w, el.h, settings);
    ts.bands.forEach((b, i) => {
      const bandW = b.n * ts.tw;
      parts.push(<rect key={`tb${i}`} x={tl.x} y={tl.y + b.y * ppf} width={bandW * ppf} height={b.depth * ppf} fill="none" stroke={st.stroke} strokeWidth={0.75} />);
      for (let k = 1; k < b.n; k++)
        parts.push(<line key={`tb${i}d${k}`} x1={tl.x + k * ts.tw * ppf} y1={tl.y + b.y * ppf} x2={tl.x + k * ts.tw * ppf} y2={tl.y + (b.y + b.depth) * ppf} stroke={st.stroke} strokeWidth={0.55} />);
    });
    ts.aisles.forEach((a, i) =>
      parts.push(<line key={`ta${i}`} x1={tl.x} y1={tl.y + (a.y0 + a.y1) / 2 * ppf} x2={tl.x + w} y2={tl.y + (a.y0 + a.y1) / 2 * ppf} stroke={st.stroke} strokeWidth={0.6} strokeDasharray="8 6" />));
  }
  if (el.type === "building" && settings.showDocks) {
    const n = Math.floor(el.w / 12);
    for (let k = 1; k < n; k++)
      parts.push(<line key={`dk${k}`} x1={tl.x + k * 12 * ppf} y1={tl.y + h} x2={tl.x + k * 12 * ppf} y2={tl.y + h + 6} stroke={PAL.ink} strokeWidth={1} />);
  }
  return <g key={el.id} transform={`rotate(${el.rot} ${c.x} ${c.y})`} style={{ cursor: tool === "select" ? "move" : "crosshair" }}
    onPointerDown={(e) => startMoveEl(e, el.id)}>{parts}</g>;
}

/* ----------------------------- small UI ----------------------------- */
function Section({ title, children, collapsed }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div style={{ marginBottom: 14 }}>
      <div onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", marginBottom: 8, userSelect: "none" }}>
        <span style={{ fontSize: 10, color: "#c2410c", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▶</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#2c2a26" }}>{title}</span>
      </div>
      {open && <div>{children}</div>}
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
