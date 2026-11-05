/* Parcel & setback LOOK (NEW-2) — the pure rules behind the "Line & label style" panel.
 *
 * Three styleable objects, nothing else: the parcel BOUNDARY (colour · weight · dashed), the SETBACK line
 * (colour · weight · dashed — a standalone render layer with its own style) and the side-length DIMENSION
 * LABELS (show · colour · size in points).
 *
 * ONE SHAPE PER LEVEL:   { boundary:{color,weightPx,dashed}, setback:{color,weightPx,dashed}, labels:{show,color,sizePt} }
 *   · WORKSPACE DEFAULT — one blob in the signed-in user's own `profiles.prefs.parcelLook` (own-row RLS, private
 *     by default; `userPrefsStore.js` is the only writer). Read at RENDER, so editing it restyles every parcel
 *     that does not override.
 *   · PER-PARCEL OVERRIDE — NOT a second blob. A parcel already carried a nullable per-parcel style on its own
 *     record (`stroke`/`weight`/`dash`, `sbStroke`/`sbWeight`/`sbDash`), written by the old Style section and
 *     stamped by Standards; adding a parallel `style` blob would have been two sources of truth for the same
 *     fact. So the override IS those keys (+ `dimShow`/`dimColor`/`dimSize`), `null`/absent = inherit, and
 *     "reset to workspace default" clears them. `parcelLookKeys` below is the one list of them.
 *
 * RESOLUTION, per field:  parcel override  →  workspace default  →  built-in fallback.
 *
 * WEIGHT IS SCREEN PIXELS, CONSTANT ACROSS ZOOM (owner-locked): a 2 px line stays 2 px at any zoom. The planner
 * used to scale these two strokes with zoom (B617 `strokeZoom`); the render now passes the resolved weight
 * straight through for the boundary and the setback ring, and nothing else.
 */

export const LOOK_LIMITS = { weightPx: { min: 1, max: 6 }, sizePt: { min: 8, max: 16 } };

/** Built-in fallbacks. Colours are `null` here on purpose: the built-in colour is the THEME's (PAL.parcel / PAL.setback /
 *  PAL.ink), which only the canvas can read (an SVG attribute cannot use a CSS var) — the caller passes them in. */
export const LOOK_BUILTIN = {
  boundary: { color: null, weightPx: 2, dashed: false },
  setback: { color: null, weightPx: 1.25, dashed: true },
  labels: { show: true, color: null, sizePt: null }, // sizePt null = "Auto": the existing zoom-scaled size
};

/** Every per-parcel key the look owns — the reset list, and the guard's inventory. */
export const parcelLookKeys = ["stroke", "weight", "dash", "sbStroke", "sbWeight", "sbDash", "dimShow", "dimColor", "dimSize"];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
/** Short or upper-case hex → six-digit lower-case; anything else → null. */
export const normalizeHex = (v) => {
  if (typeof v !== "string" || !HEX.test(v.trim())) return null;
  let h = v.trim().toLowerCase().slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `#${h}`;
};
const inRange = (n, r) => typeof n === "number" && Number.isFinite(n) && n >= r.min && n <= r.max;

/** Why a (partial) look blob may not be stored — [] when it is fine. Used on EVERY write, so a bad value is
 *  refused out loud instead of being quietly dropped (LOUD-FAILURE). */
export function validateLook(look) {
  const problems = [];
  if (look == null) return problems;
  if (typeof look !== "object" || Array.isArray(look)) return ["style must be an object"];
  for (const sec of ["boundary", "setback"]) {
    const s = look[sec];
    if (s == null) continue;
    if (typeof s !== "object" || Array.isArray(s)) { problems.push(`${sec} must be an object`); continue; }
    if (s.color !== undefined && s.color !== null && !normalizeHex(s.color)) problems.push(`${sec} colour "${s.color}" is not a hex colour`);
    if (s.weightPx !== undefined && s.weightPx !== null && !inRange(s.weightPx, LOOK_LIMITS.weightPx)) problems.push(`${sec} weight must be ${LOOK_LIMITS.weightPx.min}–${LOOK_LIMITS.weightPx.max}`);
    if (s.dashed !== undefined && s.dashed !== null && typeof s.dashed !== "boolean") problems.push(`${sec} dashed must be on or off`);
  }
  const l = look.labels;
  if (l != null) {
    if (typeof l !== "object" || Array.isArray(l)) problems.push("labels must be an object");
    else {
      if (l.show !== undefined && l.show !== null && typeof l.show !== "boolean") problems.push("labels show must be on or off");
      if (l.color !== undefined && l.color !== null && !normalizeHex(l.color)) problems.push(`label colour "${l.color}" is not a hex colour`);
      if (l.sizePt !== undefined && l.sizePt !== null && !inRange(l.sizePt, LOOK_LIMITS.sizePt)) problems.push(`label size must be ${LOOK_LIMITS.sizePt.min}–${LOOK_LIMITS.sizePt.max} pt`);
    }
  }
  return problems;
}

/** Read-side defence for a stored blob: keep only valid fields (the write path already refused the rest). */
export function normalizeLook(raw) {
  const out = {};
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  for (const sec of ["boundary", "setback"]) {
    const s = r[sec] && typeof r[sec] === "object" ? r[sec] : {};
    const o = {};
    const c = normalizeHex(s.color); if (c) o.color = c;
    if (inRange(s.weightPx, LOOK_LIMITS.weightPx)) o.weightPx = s.weightPx;
    if (typeof s.dashed === "boolean") o.dashed = s.dashed;
    if (Object.keys(o).length) out[sec] = o;
  }
  const l = r.labels && typeof r.labels === "object" ? r.labels : {};
  const lo = {};
  if (typeof l.show === "boolean") lo.show = l.show;
  const lc = normalizeHex(l.color); if (lc) lo.color = lc;
  if (inRange(l.sizePt, LOOK_LIMITS.sizePt)) lo.sizePt = l.sizePt;
  if (Object.keys(lo).length) out.labels = lo;
  return out;
}

/** Merge a one-section patch into a workspace-default blob; `null` clears that field. Pure. */
export function patchLook(look, section, field, value) {
  const base = normalizeLook(look);
  const sec = { ...(base[section] || {}) };
  if (value === null || value === undefined) delete sec[field]; else sec[field] = value;
  const next = { ...base };
  if (Object.keys(sec).length) next[section] = sec; else delete next[section];
  return next;
}

const dashName = (dashed) => (dashed ? "dashed" : "solid");

/**
 * Resolve one parcel's look. `theme` supplies the built-in colours { parcel, setback, ink }.
 * @returns {{boundary:{color,weightPx,dashed,dash}, setback:{...}, labels:{show,color,sizePt}, from:{...}}}
 *   `dash` is the line-style NAME the canvas already understands ("solid"/"dashed"/"dotted"/…): a legacy parcel that
 *   carries "dotted" keeps it, the new toggle only ever writes "dashed" / "solid". `from[section][field]` is
 *   "parcel" | "default" | "builtin" — what the panel uses to say which level a value is coming from.
 */
export function resolveParcelLook(pc, workspace, theme = {}) {
  const ws = normalizeLook(workspace);
  const p = pc || {};
  const from = { boundary: {}, setback: {}, labels: {} };
  const pick = (sec, field, own, wsVal, builtin) => {
    if (own !== undefined && own !== null) { from[sec][field] = "parcel"; return own; }
    if (wsVal !== undefined && wsVal !== null) { from[sec][field] = "default"; return wsVal; }
    from[sec][field] = "builtin"; return builtin;
  };
  const line = (sec, keys, themeColor) => {
    const b = LOOK_BUILTIN[sec], w = ws[sec] || {};
    const color = pick(sec, "color", normalizeHex(p[keys.color]) || (typeof p[keys.color] === "string" ? p[keys.color] : null), w.color, themeColor);
    const weightPx = pick(sec, "weightPx", typeof p[keys.weight] === "number" ? p[keys.weight] : null, w.weightPx, b.weightPx);
    const dash = pick(sec, "dashed", typeof p[keys.dash] === "string" ? p[keys.dash] : null, typeof w.dashed === "boolean" ? dashName(w.dashed) : null, dashName(b.dashed));
    return { color, weightPx, dash, dashed: dash !== "solid" };
  };
  const boundary = line("boundary", { color: "stroke", weight: "weight", dash: "dash" }, theme.parcel ?? null);
  const setback = line("setback", { color: "sbStroke", weight: "sbWeight", dash: "sbDash" }, theme.setback ?? null);
  const wl = ws.labels || {};
  const labels = {
    show: pick("labels", "show", typeof p.dimShow === "boolean" ? p.dimShow : null, wl.show, LOOK_BUILTIN.labels.show),
    color: pick("labels", "color", normalizeHex(p.dimColor), wl.color, theme.ink ?? null),
    sizePt: pick("labels", "sizePt", inRange(p.dimSize, LOOK_LIMITS.sizePt) ? p.dimSize : null, wl.sizePt, LOOK_BUILTIN.labels.sizePt),
  };
  return { boundary, setback, labels, from };
}

/** The per-parcel record patch for ONE field edit (flat keys; `null` = inherit). */
export function parcelPatchFor(section, field, value) {
  if (section === "boundary") {
    if (field === "color") return { stroke: value };
    if (field === "weightPx") return { weight: value };
    if (field === "dashed") return { dash: value === null ? null : dashName(value) };
  }
  if (section === "setback") {
    if (field === "color") return { sbStroke: value };
    if (field === "weightPx") return { sbWeight: value };
    if (field === "dashed") return { sbDash: value === null ? null : dashName(value) };
  }
  if (section === "labels") {
    if (field === "show") return { dimShow: value };
    if (field === "color") return { dimColor: value };
    if (field === "sizePt") return { dimSize: value };
  }
  return null;
}

/** Clears the whole per-parcel override ("reset to workspace default"). */
export const parcelResetPatch = () => Object.fromEntries(parcelLookKeys.map((k) => [k, null]));

/** Does this parcel carry any override of the look? (enables the Reset affordance) */
export const hasParcelOverride = (pc) => !!pc && parcelLookKeys.some((k) => pc[k] !== undefined && pc[k] !== null);

/** Label size in points → SVG user units at 96 dpi (1 pt = 4/3 px). */
export const ptToPx = (pt) => (pt * 96) / 72;

/** A stroke width the canvas may draw: the resolved weight, passed through as-is (screen px, no zoom factor). */
export const lookStrokePx = (weightPx) => weightPx;

/** Merge a debounced burst of workspace-default field edits into one patch list (last write per field wins). */
export function coalesceEdits(edits) {
  const m = new Map();
  for (const e of edits) m.set(`${e.section}.${e.field}`, e);
  return [...m.values()];
}
