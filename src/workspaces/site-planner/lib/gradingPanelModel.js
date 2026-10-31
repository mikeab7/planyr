/* The Grading panel's view model — what the panel shows, as data, so it is testable without a DOM (NEW-1).
 * It only READS the model GradingController already publishes; it never starts or restarts a build.
 *
 *   loading — the controller has not published yet ("Reading the ground…" / "…" as shipped)
 *   empty   — a model, but no building on the plan: one line, and the Ground section still shows
 *   cards   — one card per building (the selected one expanded, the others one line each — the controller sets `focus`)
 */
export const EMPTY_LINE = "Place a building to grade it.";
export const LOADING_LINE = "Reading the ground…";

export function gradingPanelView(model) {
  if (!model) return { state: "loading", cards: [], line: LOADING_LINE, noSetback: false };
  const cards = Array.isArray(model.cards) ? model.cards : [];
  const noSetback = !!(model.setback && model.setback.usingPropertyLine);
  if (!cards.length) return { state: "empty", cards: [], line: EMPTY_LINE, noSetback };
  return { state: "cards", cards, line: null, noSetback };
}

/* ROUND 8 (NEW-2) — the words for the line the grading may not cross: the property line less the grading margin and any
 * undisturbed buffer (never the setback). `basis` = grid.limit.basis ({ marginFt, bufferFt }); null reads as the defaults. */
const ftWord = (v) => `${Math.round(v * 10) / 10} ft`;
export function limitBasisPhrase(basis) {
  const m = basis && Number.isFinite(basis.marginFt) ? basis.marginFt : 10;
  const b = basis && Number.isFinite(basis.bufferFt) ? basis.bufferFt : 0;
  const parts = [m > 0 ? `${ftWord(m)} margin` : m < 0 ? `${ftWord(-m)} past the line` : "no margin"];
  if (b > 0) parts.push(`${ftWord(b)} buffer`);
  return `to the property line (${parts.join(", ")})`;
}
/* Where a slope that leaves the graded area lands: on the neighbour's land, in the buffer, or in the working margin. */
export function limitCrossPlace(basis, beyondParcel) {
  if (beyondParcel) return "past the property line";
  const b = basis && Number.isFinite(basis.bufferFt) ? basis.bufferFt : 0;
  return b > 0 ? "into the buffer" : "into the grading margin";
}

/* ===================================================================================================================
 * NEW-1 — the approved Grading panel layout (owner 2026-10-31). Everything below is the panel's WORDS and NUMBERS as pure
 * data, so the layout is testable without a DOM. The panel (components/GradingPanels.jsx) only draws what these return.
 * =================================================================================================================== */

/* ---- LIMITS OF DISTURBANCE: one signed number, feet off the property line ----
 * The panel shows NEGATIVE inside the property line (the old "Grading margin", default −10), ZERO on the line, POSITIVE past it
 * (cap +50). The stored cfg key is unchanged — `gradingMarginFt`, a positive inside-margin — so every existing plan keeps its
 * meaning; the panel's number is exactly its negation. Past the line the stored margin is negative (gradingCfg allows it). */
export const LIMIT_PAST_MAX_FT = 50;      // mirrors GRADING_DEFAULTS.limitPastMaxFt (a unit test holds the two equal)
export const LIMIT_INSIDE_MAX_FT = 500;
const clean0 = (v) => (v === 0 ? 0 : v);   // never −0
export function limitOffsetFt(marginFt) {
  const m = Number.isFinite(marginFt) ? marginFt : 10;
  return clean0(-m);
}
export function marginFromOffset(offsetFt) {
  const o = Number.isFinite(offsetFt) ? Math.max(-LIMIT_INSIDE_MAX_FT, Math.min(LIMIT_PAST_MAX_FT, offsetFt)) : -10;
  return clean0(-o);
}
/* "+20" / "−10" / "0" — the readout in the number box's neighbours and the aria text. */
export function limitOffsetWord(offsetFt) {
  if (!Number.isFinite(offsetFt) || offsetFt === 0) return "0";
  return offsetFt > 0 ? `+${offsetFt}` : `−${-offsetFt}`;
}

/* ---- reading a surface grid ---- */
const EDGE_EPS_FT = 0.05;
/* The deepest cut and tallest fill ANYWHERE the surface changes the ground (pad, pavement, open ground, slopes), where they
 * are, and the slope band's area (the limit-to-pad band: wedge cells that actually move dirt). `grid.cells` is the same lattice the
 * picture paints, so this adds no surface work. */
export function gridDepthStats(grid) {
  let cut = null, fill = null, slopeSf = 0;
  if (!grid || !grid.cells) return { cut, fill, slopeSf };
  for (const c of grid.cells) {
    const dz = c.dzFt;
    if (dz == null || !Number.isFinite(dz)) continue;
    if (c.wedge && Math.abs(dz) > EDGE_EPS_FT) slopeSf += (c.wFt || 0) * (c.hFt || 0);
    if (dz < 0 && (!cut || -dz > cut.ft)) cut = { ft: -dz, x: c.x, y: c.y };
    else if (dz > 0 && (!fill || dz > fill.ft)) fill = { ft: dz, x: c.x, y: c.y };
  }
  return { cut, fill, slopeSf };
}
/* One floor's numbers: earthwork ({cutCy, fillCy, netCy}, + import) less the pond spoil credited to this building (the same
 * definition the balanced-floor solver uses, so "no haul" is zero here too), the depths and the slope footprint. */
export function floorStatsOf(earthwork, depth, pondCy = 0) {
  if (!earthwork) return null;
  const net = earthwork.netCy - (pondCy || 0);
  return {
    cutCy: earthwork.cutCy, fillCy: earthwork.fillCy, netCy: earthwork.netCy, haulCy: net,
    deepestCutFt: depth && depth.cut ? depth.cut.ft : 0, tallestFillFt: depth && depth.fill ? depth.fill.ft : 0,
    slopeSf: depth ? depth.slopeSf : 0,
  };
}

/* ---- the three tiles: HAUL first ---- */
export const BALANCE_TOL_CY_PANEL = 500;   // = buildingGrade.BALANCE_TOL_CY (a unit test holds them equal)
const round100 = (v) => Math.round(Math.abs(v) / 100) * 100;
const nfmt = (v) => Math.round(v).toLocaleString("en-US");
export function haulTile(haulCy, tolCy = BALANCE_TOL_CY_PANEL) {
  if (haulCy == null || !Number.isFinite(haulCy)) return { big: "…", sub: "", tone: "muted", dir: "none" };
  if (Math.abs(haulCy) < tolCy) return { big: "0", sub: "balanced", tone: "green", dir: "none" };
  const dir = haulCy > 0 ? "in" : "out";
  const n = nfmt(round100(haulCy));
  return { big: n, sub: `${n} CY ${dir}`, tone: "amber", dir };
}
export function cutTile(cutCy, deepestFt) {
  if (cutCy == null) return { big: "…", sub: "" };
  return { big: nfmt(round100(cutCy)), sub: `deepest ${Math.round(deepestFt || 0)} ft` };
}
export function fillTile(fillCy, tallestFt) {
  if (fillCy == null) return { big: "…", sub: "" };
  return { big: nfmt(round100(fillCy)), sub: `tallest ${Math.round(tallestFt || 0)} ft` };
}

/* ---- FLAGS: a flag exists ONLY when a number crosses a threshold; one sentence; at most the action links it owns ---- */
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/* "Fill reaches 31 ft on the south side. Past 12 ft, sites usually terrace or wall." — `where` is "south side" / "NW corner" / "middle" / null. */
export function placePhrase(where) {
  if (!where) return "";
  if (/corner$/.test(where)) return ` at the ${where}`;
  if (/(side|end)$/.test(where)) return ` on the ${where}`;
  return where === "middle" ? " in the middle" : ` ${where}`;
}
export function depthSentence({ kind, ft, where, thresholdFt }) {
  return `${cap1(kind)} reaches ${Math.round(ft)} ft${placePhrase(where)}. Past ${Math.round(thresholdFt)} ft, sites usually terrace or wall.`;
}
/* The depth flags — at most one per kind. Under the PAD past `maxCutFillFt` (today's rule) wins; otherwise ANYWHERE in the
 * surface (slopes included) past `terraceDepthFt`. `pad` = ffeSuggest.padDepths (cut/fill with x,y), `anywhere` = gridDepthStats,
 * `whereOf(pt, scope)` → the place word (the controller owns the building's centre and size). */
export function depthFlags({ pad, anywhere, maxCutFillFt, terraceDepthFt, whereOf }) {
  const out = [];
  for (const kind of ["fill", "cut"]) {
    const p = pad && pad[kind], a = anywhere && anywhere[kind];
    if (p && p.ft > maxCutFillFt) {
      out.push({ id: `depth-${kind}`, kind: `depth-${kind}`, depthKind: kind, scope: "pad", ft: p.ft, thresholdFt: maxCutFillFt, at: { x: p.x, y: p.y }, text: depthSentence({ kind, ft: p.ft, where: whereOf ? whereOf(p, "pad") : null, thresholdFt: maxCutFillFt }), actions: ["second-pad"] });
    } else if (a && a.ft > terraceDepthFt) {
      out.push({ id: `depth-${kind}`, kind: `depth-${kind}`, depthKind: kind, scope: "slopes", ft: a.ft, thresholdFt: terraceDepthFt, at: { x: a.x, y: a.y }, text: depthSentence({ kind, ft: a.ft, where: whereOf ? whereOf(a, "slopes") : null, thresholdFt: terraceDepthFt }), actions: ["second-pad"] });
    }
  }
  return out.sort((x, y) => y.ft - x.ft);
}
/* The slopes cannot daylight inside the limit: ONE sentence off buildingGrade.describeFlag's result. */
export function limitFlagSentence(flag) {
  if (!flag) return null;
  const side = flag.side ? ` on the ${flag.side.toLowerCase()} side` : "";
  return `${cap1(flag.kind || "slope")} slope runs ${flag.over} ft ${flag.place || "past the limit"}${side}.`;
}
const SEAM_WORD_PANEL = { dockApron: "truck court", trailerParking: "trailer row", carParkingGeneral: "parking", carParkingAccessible: "parking", driveAisles: "road", buildingPad: "pad" };
/* A road or dock that cannot meet the pad within the max pavement slope: `steps` = grid.seams ({elId, nId, stepFt, needPct}). */
export function seamFlags(steps, planes, maxPavementSlopePct, { max = 2 } = {}) {
  const word = (id) => { const p = planes && planes.get ? planes.get(id) : null; return (p && SEAM_WORD_PANEL[p.classId]) || "pavement"; };
  const seen = new Set(), out = [];
  for (const st of [...(steps || [])].sort((a, b) => b.stepFt - a.stepFt)) {
    const key = [st.elId, st.nId].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `seam-${key}`, kind: "seam", ft: st.stepFt, text: `The ${word(st.elId)} can't meet the ${word(st.nId)} within ${Math.round(maxPavementSlopePct * 10) / 10}%; it needs a ${Math.round(st.stepFt * 10) / 10} ft step.`, actions: [] });
    if (out.length >= max) break;
  }
  return out;
}
/* Cut that runs into rock: a threshold (bedrock depth less 2 ft) like the others. `v` = ffeSuggest.rockViolation. */
export function rockFlag(v, where) {
  if (!v || !(v.raiseFt > 0.04)) return null;
  const up = Math.ceil(v.raiseFt * 10) / 10;
  return { id: "rock", kind: "rock", ft: v.raiseFt, raiseFt: up, text: `Cut reaches rock${placePhrase(where)}. About ${Math.round(up * 10) / 10} ft more floor would clear it.`, actions: ["raise-ffe"] };
}

/* ---- OTHER FLOORS TO TRY ---- */
export const FLOOR_SAME_FT = 0.25;     // two suggested floors this close are ONE row
export const HAUL_SPAN_FT = 6;          // the curve runs ±6 ft of the balanced floor
export const HAUL_STEP_FT = 0.5;        // drawn every half foot (sampled coarser and interpolated when the full sweep is too slow)
export const FLOOR_NAMES = Object.freeze({ nohaul: "no haul", digging: "least digging", slopes: "shortest slopes" });

/* The floors to BUILD for the sweep: `count` evenly spaced samples across ±span of the balanced floor (7 → every 2 ft). */
export function sweepFloors(balancedE, { span = HAUL_SPAN_FT, count = 7 } = {}) {
  if (!Number.isFinite(balancedE)) return [];
  const n = Math.max(2, count | 0), out = [];
  for (let i = 0; i < n; i++) out.push(Math.round((balancedE - span + (2 * span * i) / (n - 1)) * 100) / 100);
  return out;
}
/* The floor in `samples` ({E, slopeSf}) with the smallest slope footprint — ties go to the one nearest `nearE` (the balanced floor),
 * so a flat footprint never wanders off. */
export function shortestSlopesFloor(samples, nearE = null) {
  let best = null;
  for (const s of samples || []) {
    if (!s || !Number.isFinite(s.slopeSf) || !Number.isFinite(s.E)) continue;
    if (!best || s.slopeSf < best.slopeSf - 1e-6 || (Math.abs(s.slopeSf - best.slopeSf) <= 1e-6 && nearE != null && Math.abs(s.E - nearE) < Math.abs(best.E - nearE))) best = s;
  }
  return best;
}
/* Linear interpolation of a signed value across sorted {E, haulCy} samples; null outside the sampled span. */
export function interpolateHaul(samples, E) {
  const s = [...(samples || [])].filter((p) => Number.isFinite(p.E) && Number.isFinite(p.haulCy)).sort((a, b) => a.E - b.E);
  if (s.length < 2 || E < s[0].E - 1e-9 || E > s[s.length - 1].E + 1e-9) return null;
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i], b = s[i + 1];
    if (E >= a.E - 1e-9 && E <= b.E + 1e-9) { const t = b.E === a.E ? 0 : (E - a.E) / (b.E - a.E); return a.haulCy + t * (b.haulCy - a.haulCy); }
  }
  return null;
}
/* The haul-by-floor curve at `step` ft across the sampled span: [{E, haulCy}] (import +, export −). Raising the floor adds fill
 * and removes cut, so it rises; the crossing of zero is the no-haul floor. */
export function haulCurve(samples, { step = HAUL_STEP_FT } = {}) {
  const s = [...(samples || [])].filter((p) => Number.isFinite(p.E) && Number.isFinite(p.haulCy)).sort((a, b) => a.E - b.E);
  if (s.length < 2) return [];
  const out = [];
  for (let E = s[0].E; E <= s[s.length - 1].E + 1e-9; E += step) { const v = interpolateHaul(s, Math.round(E * 100) / 100); if (v != null) out.push({ E: Math.round(E * 100) / 100, haulCy: v }); }
  return out;
}
/* The whole sweep as ONE generator (the controller drives it through runChunked, one surface build per step; a test drives it
 * synchronously). `statsAt(floor)` is a generator returning floorStatsOf(...) or null. Builds `count` floors across ±span of the
 * balanced one, then two more (±1 ft) around the smallest slope footprint so the pick is not stuck on the coarse grid. Returns
 * { samples (sorted), nohaul (the sample AT the balanced floor), slopes (the shortest-slopes sample), curve (every half foot) }. */
export function* sweepFloorStats(statsAt, balancedE, { count = 7, span = HAUL_SPAN_FT } = {}) {
  const samples = [];
  function* take(f) { yield; const st = yield* statsAt(f); if (st) samples.push({ E: f, ...st }); }
  for (const f of sweepFloors(balancedE, { span, count })) yield* take(f);
  const lo = shortestSlopesFloor(samples, balancedE);
  if (lo) for (const d of [-1, 1]) { const f = Math.round((lo.E + d) * 100) / 100; if (!samples.some((q) => Math.abs(q.E - f) < 0.01)) yield* take(f); }
  samples.sort((a, b) => a.E - b.E);
  return { samples, nohaul: samples.find((q) => Math.abs(q.E - balancedE) < 0.011) || null, slopes: shortestSlopesFloor(samples, balancedE), curve: haulCurve(samples) };
}
/* Where the curve crosses zero (linear between the bracketing samples), or null when it never does. */
export function haulZeroFloor(curve) {
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i], b = curve[i + 1];
    if (a.haulCy === 0) return a.E;
    if ((a.haulCy < 0 && b.haulCy > 0) || (a.haulCy > 0 && b.haulCy < 0)) return a.E + ((0 - a.haulCy) / (b.haulCy - a.haulCy)) * (b.E - a.E);
  }
  return curve.length && curve[curve.length - 1].haulCy === 0 ? curve[curve.length - 1].E : null;
}
/* The table. `picks` = { nohaul: {E, stats}, digging: {E, stats, areaAc}|null, slopes: {E, stats}|null }; `currentE` highlights its row.
 * Two picks within FLOOR_SAME_FT are ONE row carrying both names (never a duplicate row). Order: no haul, least digging,
 * shortest slopes. Each row: { key, E, names[], label, sub, stats, current }. */
export function floorRows(picks, currentE) {
  const order = ["nohaul", "digging", "slopes"];
  const rows = [];
  for (const k of order) {
    const p = picks && picks[k];
    if (!p || !Number.isFinite(p.E)) continue;
    const same = rows.find((r) => Math.abs(r.E - p.E) < FLOOR_SAME_FT);
    if (same) { same.names.push(k); if (!same.stats && p.stats) same.stats = p.stats; if (k === "digging" && p.areaAc != null) same.areaAc = p.areaAc; continue; }
    rows.push({ key: k, E: p.E, names: [k], stats: p.stats || null, areaAc: k === "digging" ? p.areaAc ?? null : null });
  }
  return rows.map((r) => ({
    ...r, label: r.names.map((n) => FLOOR_NAMES[n]).join(" · "),
    sub: r.names.includes("digging") && r.areaAc != null ? `${Math.round(r.areaAc)} AC stays on natural grade` : "",
    current: Number.isFinite(currentE) && Math.abs(r.E - currentE) < 0.05,
  }));
}
/* "AUTO · NO HAUL" while the floor is the suggested balanced one, "TYPED" once the owner typed one. */
export const ffePillText = (isAuto) => (isAuto ? "AUTO · NO HAUL" : "TYPED");

/* ---- the GROUND block: two numbers only ---- */
export function groundNumbers(sum, cfg) {
  if (!sum || !sum.best) return null;
  return {
    acres: `${Math.round(sum.best.areaAc * 10) / 10} of ${Math.round(sum.parcelAc * 10) / 10} AC`, acresSub: `one pad at ${cfg.slopeRatio}:1, no walls`,
    relief: `${Math.round(sum.relief.reliefFt)} ft`, reliefSub: `relief · ${Math.round(sum.relief.lowFt)} to ${Math.round(sum.relief.highFt)}`,
  };
}
