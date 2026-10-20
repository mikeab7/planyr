/* compsQuery — the pure search / filter / sort engine behind the Records list (NEW-1). No React, no
 * network, no storage. The panel calls it inside a `useMemo` over the comps `fetchAllComps` already
 * loaded: the filter is a VIEW over that array (comps follow project sharing — CLAUDE.md #21), never
 * a second query with its own visibility rules.
 *
 * Rules that are easy to get wrong, decided here once:
 *  · A comp with a BLANK value in a filtered field is EXCLUDED by that filter (CoStar behaviour).
 *    "Blank" includes a value that cannot be derived: a lease whose rate period is unset has no
 *    annual rate (`annualLeaseRate` refuses to guess), so a rate range excludes it.
 *  · Rate / $-per-SF ranges compare DERIVED figures through the model's own helpers
 *    (`annualLeaseRate`, `buildingPricePerSf`, `landPricePerSf`) — never a second formula.
 *  · SF filters read building SF (sale) / leased SF (lease); acre filters read land size normalised
 *    to acres. A land comp has no building SF and a building has no acreage, so each pair excludes
 *    the other family — the panel only offers the acres pair when Land can match.
 *  · Date windows are relative to `now` and count DAYS (3 mo = 90, 6 mo = 180, 12 mo = 365), include
 *    today, and have no upper bound (a comp dated after today is not hidden by a rolling window).
 *    An undated comp is excluded by ANY active date filter; `undatedHidden` reports how many were.
 *  · Search NEVER triggers geocoding: the caller passes `cachedLocation(comp)`, which may only read
 *    what is already resolved (B1497889's gating stays).
 */
import { annualLeaseRate, buildingPricePerSf, landPricePerSf, landSizeSf, sortCompsByRecency } from "./comps.js";
import { compSizeSf, countyLabel } from "../../../workspaces/dashboard/lib/compsCardModel.js";

export const SF_PER_ACRE = 43560;
export const DATE_WINDOW_DAYS = { "3mo": 90, "6mo": 180, "12mo": 365 };
export const SORT_OPTIONS = [
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
  { key: "largest", label: "Largest" },
  { key: "smallest", label: "Smallest" },
  { key: "rateHigh", label: "Rate high to low" },
  { key: "rateLow", label: "Rate low to high" },
  { key: "psfHigh", label: "Price/SF high to low" },
  { key: "psfLow", label: "Price/SF low to high" },
];
export const TYPE_FILTER_LABEL = { land: "Land", building_sale: "Bldg Sale", lease: "Lease" };
const RANGE = () => ({ min: "", max: "" });

export function defaultFilters() {
  return {
    q: "",
    types: [],
    date: { mode: "any", from: "", to: "" },
    sf: RANGE(), acres: RANGE(), clearHt: RANGE(), yearBuilt: RANGE(),
    powerMin: "", docksMin: "",
    rate: RANGE(), basis: [], bldgPsf: RANGE(), landPsf: RANGE(),
    counties: [],
  };
}

/** A stored / foreign value → a complete, well-typed filters object (junk dropped, never thrown on). */
export function normalizeFilters(raw) {
  const d = defaultFilters();
  if (!raw || typeof raw !== "object") return d;
  const str = (v) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  const range = (v) => ({ min: str(v?.min), max: str(v?.max) });
  const list = (v, allowed) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && (!allowed || allowed.includes(x))) : []);
  return {
    q: str(raw.q),
    types: list(raw.types, Object.keys(TYPE_FILTER_LABEL)),
    date: {
      mode: ["any", "3mo", "6mo", "12mo", "custom"].includes(raw.date?.mode) ? raw.date.mode : "any",
      from: str(raw.date?.from), to: str(raw.date?.to),
    },
    sf: range(raw.sf), acres: range(raw.acres), clearHt: range(raw.clearHt), yearBuilt: range(raw.yearBuilt),
    powerMin: str(raw.powerMin), docksMin: str(raw.docksMin),
    rate: range(raw.rate), basis: list(raw.basis, ["nnn", "gross"]), bldgPsf: range(raw.bldgPsf), landPsf: range(raw.landPsf),
    counties: list(raw.counties),
  };
}

export function normalizeSort(key) {
  return SORT_OPTIONS.some((o) => o.key === key) ? key : "newest";
}

/** "1,200" / " 5 " / "" → number | null. Anything non-finite is "not set". */
export function toNum(v) {
  if (v == null) return null;
  const s = String(v).replace(/[,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* ---- search ------------------------------------------------------------------------------- */

/** Lowercased, whitespace-split, non-empty tokens. */
export function parseSearch(q) {
  return String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every token must appear somewhere in the comp's searchable text. `cachedLocation(comp)` is
 * optional and must be a CACHE READ ONLY — this function never resolves anything itself. */
export function matchesSearch(comp, tokens, { cachedLocation } = {}) {
  if (!tokens || !tokens.length) return true;
  const county = comp?.anchor?.county;
  const parts = [
    comp?.title, comp?.notes, comp?.partyProvider, comp?.partyAcquirer, comp?.anchor?.parcelApn,
    county, countyLabel(county), cachedLocation ? cachedLocation(comp) : null,
  ];
  const hay = parts.filter(Boolean).join("\n").toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

/* ---- dates -------------------------------------------------------------------------------- */

const pad2 = (n) => String(n).padStart(2, "0");
/** A Date → its LOCAL calendar day as "YYYY-MM-DD". */
export function isoDay(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
/** "YYYY-MM-DD" minus N days, via UTC arithmetic so a DST change can never shift the day. */
export function isoMinusDays(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) - days * 86400000);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** { from, to } ISO bounds (either may be null) for a date filter, or null when it is inactive. */
export function dateBounds(date, now = new Date()) {
  const mode = date?.mode || "any";
  if (mode === "any") return null;
  if (DATE_WINDOW_DAYS[mode]) return { from: isoMinusDays(isoDay(now), DATE_WINDOW_DAYS[mode]), to: null };
  if (mode === "custom") {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(date.from || "") ? date.from : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(date.to || "") ? date.to : null;
    return from || to ? { from, to } : null;
  }
  return null;
}

/* ---- derived figures ---------------------------------------------------------------------- */

/** Land size in acres (sf ÷ 43,560), or null. */
export function landAcres(comp) {
  if (comp?.compType !== "land") return null;
  const sf = landSizeSf(comp.landSizeValue, comp.landSizeUnit);
  return sf == null ? null : sf / SF_PER_ACRE;
}
/** $/SF for a sale — building or land — through the model's own helpers; null for a lease. */
export function salePsf(comp) {
  if (comp?.compType === "building_sale") return buildingPricePerSf(comp);
  if (comp?.compType === "land") return landPricePerSf(comp);
  return null;
}
/** The lease's annualised $/SF/yr whatever period it was entered in; null for non-leases. */
export function leaseAnnualRate(comp) {
  return comp?.compType === "lease" ? annualLeaseRate(comp) : null;
}
const buildingOnly = (comp, v) => (comp?.compType === "land" ? null : v);

function inRange(value, min, max) {
  if (value == null || !Number.isFinite(value)) return false;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}
const rangeOf = (r) => ({ min: toNum(r?.min), max: toNum(r?.max) });
const rangeActive = ({ min, max }) => min != null || max != null;

/* ---- the filter pass ---------------------------------------------------------------------- */

/** Precompile the filters once so the per-comp loop does no parsing. */
function compile(filters, now) {
  const f = normalizeFilters(filters);
  return {
    tokens: parseSearch(f.q),
    types: f.types.length ? new Set(f.types) : null,
    dateB: dateBounds(f.date, now),
    sf: rangeOf(f.sf), acres: rangeOf(f.acres), clearHt: rangeOf(f.clearHt), yearBuilt: rangeOf(f.yearBuilt),
    rate: rangeOf(f.rate), bldgPsf: rangeOf(f.bldgPsf), landPsf: rangeOf(f.landPsf),
    powerMin: toNum(f.powerMin), docksMin: toNum(f.docksMin),
    basis: f.basis.length ? new Set(f.basis) : null,
    counties: f.counties.length ? new Set(f.counties) : null,
  };
}

/** True when `comp` passes every active filter. `skipDate` lets the caller ask "would it pass if
 * the date filter were off" (to count undated comps the date filter alone hid). */
function passes(comp, c, { cachedLocation, skipDate = false } = {}) {
  if (c.tokens.length && !matchesSearch(comp, c.tokens, { cachedLocation })) return false;
  if (c.types && !c.types.has(comp.compType)) return false;
  if (!skipDate && c.dateB) {
    const d = comp.compDate ? String(comp.compDate).slice(0, 10) : null;
    if (!d) return false;
    if (c.dateB.from && d < c.dateB.from) return false;
    if (c.dateB.to && d > c.dateB.to) return false;
  }
  if (rangeActive(c.sf) && !inRange(buildingOnly(comp, compSizeSf(comp)), c.sf.min, c.sf.max)) return false;
  if (rangeActive(c.acres) && !inRange(landAcres(comp), c.acres.min, c.acres.max)) return false;
  if (rangeActive(c.clearHt) && !inRange(buildingOnly(comp, comp.clearHeightFt), c.clearHt.min, c.clearHt.max)) return false;
  if (rangeActive(c.yearBuilt) && !inRange(buildingOnly(comp, comp.yearBuilt), c.yearBuilt.min, c.yearBuilt.max)) return false;
  if (c.powerMin != null && !inRange(buildingOnly(comp, comp.powerAmps), c.powerMin, null)) return false;
  if (c.docksMin != null && !inRange(buildingOnly(comp, comp.dockDoors), c.docksMin, null)) return false;
  if (rangeActive(c.rate) && !inRange(leaseAnnualRate(comp), c.rate.min, c.rate.max)) return false;
  if (c.basis && !(comp.compType === "lease" && c.basis.has(comp.leaseRateExpense))) return false;
  if (rangeActive(c.bldgPsf) && !(comp.compType === "building_sale" && inRange(buildingPricePerSf(comp), c.bldgPsf.min, c.bldgPsf.max))) return false;
  if (rangeActive(c.landPsf) && !(comp.compType === "land" && inRange(landPricePerSf(comp), c.landPsf.min, c.landPsf.max))) return false;
  if (c.counties && !c.counties.has(comp.anchor?.county)) return false;
  return true;
}

/** The comps that pass every active filter, in their incoming order. */
export function applyFilters(comps, filters, { now = new Date(), cachedLocation } = {}) {
  const c = compile(filters, now);
  const out = [];
  for (const comp of comps || []) if (passes(comp, c, { cachedLocation })) out.push(comp);
  return out;
}

/** { shown, total, undatedHidden } — `undatedHidden` is how many undated comps ONLY the date filter
 * kept out (0 when no date filter is active), so the count line is never mysterious. */
export function countFiltered(comps, filters, opts = {}) {
  const { now = new Date(), cachedLocation } = opts;
  const c = compile(filters, now);
  let shown = 0, undatedHidden = 0;
  for (const comp of comps || []) {
    if (passes(comp, c, { cachedLocation })) shown++;
    else if (c.dateB && !comp.compDate && passes(comp, c, { cachedLocation, skipDate: true })) undatedHidden++;
  }
  return { shown, total: (comps || []).length, undatedHidden };
}

/* ---- sort --------------------------------------------------------------------------------- */

function missingLast(list, valueOf, dir) {
  const rows = list.map((comp, i) => ({ comp, i, v: valueOf(comp) }));
  rows.sort((a, b) => {
    const am = a.v == null || !Number.isFinite(a.v), bm = b.v == null || !Number.isFinite(b.v);
    if (am !== bm) return am ? 1 : -1;
    if (!am && a.v !== b.v) return dir === "desc" ? b.v - a.v : a.v - b.v;
    return a.i - b.i; // ties (and two blanks) keep the incoming — recency — order
  });
  return rows.map((r) => r.comp);
}

/** A NEW array in `key` order. The incoming array is assumed to be in recency order already (the
 * panel's list is `sortCompsByRecency` output), which is what ties fall back to. */
export function sortComps(comps, key = "newest") {
  const list = [...(comps || [])];
  switch (normalizeSort(key)) {
    case "newest": return sortCompsByRecency(list);
    case "oldest": {
      // Executed-date ascending; an undated comp always sorts to the END.
      const dated = (c) => (c.compDate ? Date.parse(String(c.compDate).slice(0, 10)) : null);
      return missingLast(sortCompsByRecency(list), dated, "asc");
    }
    case "largest": return missingLast(sortCompsByRecency(list), compSizeSf, "desc");
    case "smallest": return missingLast(sortCompsByRecency(list), compSizeSf, "asc");
    case "rateHigh": return missingLast(sortCompsByRecency(list), leaseAnnualRate, "desc");
    case "rateLow": return missingLast(sortCompsByRecency(list), leaseAnnualRate, "asc");
    case "psfHigh": return missingLast(sortCompsByRecency(list), salePsf, "desc");
    case "psfLow": return missingLast(sortCompsByRecency(list), salePsf, "asc");
    default: return sortCompsByRecency(list);
  }
}

/** Filter, then sort. */
export function queryComps(comps, filters, sortKey, opts = {}) {
  return sortComps(applyFilters(comps, filters, opts), sortKey);
}

/* ---- chips -------------------------------------------------------------------------------- */

const fmtN = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const fmtMoney = (n) => `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
function rangeLabel(r, fmt, unit) {
  const { min, max } = rangeOf(r);
  if (min == null && max == null) return null;
  const u = unit ? ` ${unit}` : "";
  if (min != null && max != null) return `${fmt(min)}–${fmt(max)}${u}`;
  return min != null ? `≥ ${fmt(min)}${u}` : `≤ ${fmt(max)}${u}`;
}
const fmtDayShort = (iso) => { const [y, m, d] = iso.split("-"); return `${Number(m)}/${Number(d)}/${y.slice(2)}`; };

/** Ordered `[{ key, label }]` — one removable chip per active filter (search text is not a chip; it
 * lives in the search box). `removeFilter(filters, key)` is the inverse. */
export function activeFilterChips(filters, { now = new Date() } = {}) {
  const f = normalizeFilters(filters);
  const chips = [];
  for (const t of f.types) chips.push({ key: `type:${t}`, label: TYPE_FILTER_LABEL[t] });
  const db = dateBounds(f.date, now);
  if (db) {
    const label = f.date.mode === "custom"
      ? (db.from && db.to ? `${fmtDayShort(db.from)}–${fmtDayShort(db.to)}` : db.from ? `Since ${fmtDayShort(db.from)}` : `Through ${fmtDayShort(db.to)}`)
      : f.date.mode.replace("mo", " mo");
    chips.push({ key: "date", label });
  }
  const add = (key, label) => { if (label) chips.push({ key, label }); };
  add("sf", rangeLabel(f.sf, fmtN, "SF"));
  add("acres", rangeLabel(f.acres, fmtN, "A"));
  add("clearHt", rangeLabel(f.clearHt, fmtN, "ft clear"));
  if (toNum(f.powerMin) != null) add("power", `Power ≥ ${fmtN(toNum(f.powerMin))} A`);
  if (toNum(f.docksMin) != null) add("docks", `≥ ${fmtN(toNum(f.docksMin))} docks`);
  add("year", rangeLabel(f.yearBuilt, (n) => String(n), "built"));
  add("rate", rangeLabel(f.rate, fmtMoney, "/SF/yr"));
  for (const b of f.basis) chips.push({ key: `basis:${b}`, label: b.toUpperCase() });
  add("bldgPsf", rangeLabel(f.bldgPsf, fmtMoney, "/SF bldg"));
  add("landPsf", rangeLabel(f.landPsf, fmtMoney, "/SF land"));
  for (const c of f.counties) chips.push({ key: `county:${c}`, label: countyLabel(c) || c });
  return chips;
}

/** `filters` with the filter behind chip `key` cleared. Unknown key → unchanged. */
export function removeFilter(filters, key) {
  const f = normalizeFilters(filters);
  const d = defaultFilters();
  const [head, rest] = key.split(/:(.*)/s);
  switch (head) {
    case "type": return { ...f, types: f.types.filter((t) => t !== rest) };
    case "basis": return { ...f, basis: f.basis.filter((b) => b !== rest) };
    case "county": return { ...f, counties: f.counties.filter((c) => c !== rest) };
    case "date": return { ...f, date: d.date };
    case "sf": return { ...f, sf: d.sf };
    case "acres": return { ...f, acres: d.acres };
    case "clearHt": return { ...f, clearHt: d.clearHt };
    case "power": return { ...f, powerMin: "" };
    case "docks": return { ...f, docksMin: "" };
    case "year": return { ...f, yearBuilt: d.yearBuilt };
    case "rate": return { ...f, rate: d.rate };
    case "bldgPsf": return { ...f, bldgPsf: d.bldgPsf };
    case "landPsf": return { ...f, landPsf: d.landPsf };
    default: return f;
  }
}

/** Anything narrowing the list at all (chips OR search text) — drives "Clear all" and the map signal. */
export function hasActiveQuery(filters) {
  const f = normalizeFilters(filters);
  return parseSearch(f.q).length > 0 || activeFilterChips(f).length > 0;
}

/** Distinct county routing keys present in `comps`, each with its count, most common first. */
export function countyOptions(comps) {
  const counts = new Map();
  for (const c of comps || []) { const k = c?.anchor?.county; if (k) counts.set(k, (counts.get(k) || 0) + 1); }
  return [...counts.entries()].map(([key, count]) => ({ key, count, label: countyLabel(key) || key }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
