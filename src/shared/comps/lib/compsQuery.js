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
 *    An undated comp is excluded by ANY active date filter — and, like every other blank, is never
 *    called out anywhere (owner, 2026-10-23: the count line is just "12 of 41 comps").
 *  · A filter only exists while the selected TYPES can show its field. `normalizeFilters` prunes the
 *    rest (deselect Lease and the rate / NNN / term state is DROPPED), so a hidden filter can never
 *    keep filtering, and the chips list exactly what is applied.
 *  · Search NEVER triggers geocoding: the caller passes `cachedLocation(comp)`, which may only read
 *    what is already resolved (B1497889's gating stays).
 */
import { annualLeaseRate, buildingPricePerSf, landPricePerSf, landSizeSf, parseLeaseTermYears, sortCompsByRecency } from "./comps.js";
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
    sf: RANGE(), acres: RANGE(), clearHt: RANGE(), yearBuilt: RANGE(), docks: RANGE(), power: RANGE(),
    rate: RANGE(), basis: [], term: RANGE(), escal: RANGE(), freeRent: RANGE(), ti: RANGE(),
    bldgPsf: RANGE(), capRate: RANGE(), noi: RANGE(), landPsf: RANGE(),
    landlord: "", tenant: "",
    counties: [],
  };
}

/** Which field families the selected types can show (none selected = all). The filter panel renders
 * from this and `normalizeFilters` prunes by it, so what is visible, applied and chipped never differ. */
export function typeScope(types) {
  const none = !types || types.length === 0;
  const has = (t) => none || types.includes(t);
  return { lease: has("lease"), sale: has("building_sale"), land: has("land"), building: none || types.some((t) => t !== "land") };
}

/** `filters` with every filter its types can no longer show reset. Pure; idempotent. */
export function pruneForTypes(f) {
  const sc = typeScope(f.types);
  const d = defaultFilters();
  const out = { ...f };
  if (!sc.lease) for (const k of ["rate", "basis", "term", "escal", "freeRent", "ti"]) out[k] = d[k];
  if (!sc.sale) for (const k of ["bldgPsf", "capRate", "noi"]) out[k] = d[k];
  if (!sc.land) for (const k of ["landPsf", "acres"]) out[k] = d[k];
  if (!sc.building) for (const k of ["sf", "clearHt", "yearBuilt", "docks", "power"]) out[k] = d[k];
  return out;
}

/** The filters after a type toggle: the new types, with whatever they no longer show dropped. */
export function withTypes(filters, types) {
  return normalizeFilters({ ...filters, types });
}

/** A stored / foreign value → a complete, well-typed filters object (junk dropped, never thrown on). */
export function normalizeFilters(raw) {
  const d = defaultFilters();
  if (!raw || typeof raw !== "object") return d;
  const str = (v) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  const range = (v) => ({ min: str(v?.min), max: str(v?.max) });
  const list = (v, allowed) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && (!allowed || allowed.includes(x))) : []);
  // Power / dock doors used to be a single "at least" box (powerMin / docksMin); carry a stored one over.
  const legacy = (min) => ({ min: str(min), max: "" });
  return pruneForTypes({
    q: str(raw.q),
    types: list(raw.types, Object.keys(TYPE_FILTER_LABEL)),
    date: {
      mode: ["any", "3mo", "6mo", "12mo", "custom"].includes(raw.date?.mode) ? raw.date.mode : "any",
      from: str(raw.date?.from), to: str(raw.date?.to),
    },
    sf: range(raw.sf), acres: range(raw.acres), clearHt: range(raw.clearHt), yearBuilt: range(raw.yearBuilt),
    docks: raw.docks ? range(raw.docks) : legacy(raw.docksMin), power: raw.power ? range(raw.power) : legacy(raw.powerMin),
    rate: range(raw.rate), basis: list(raw.basis, ["nnn", "gross"]),
    term: range(raw.term), escal: range(raw.escal), freeRent: range(raw.freeRent), ti: range(raw.ti),
    bldgPsf: range(raw.bldgPsf), capRate: range(raw.capRate), noi: range(raw.noi), landPsf: range(raw.landPsf),
    landlord: str(raw.landlord).trim() ? str(raw.landlord) : "", tenant: str(raw.tenant).trim() ? str(raw.tenant) : "",
    counties: list(raw.counties),
  });
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
const leaseOnly = (comp, v) => (comp?.compType === "lease" ? v : null);
const saleOnly = (comp, v) => (comp?.compType === "building_sale" ? v : null);
/** Cap rate as a percentage (it is stored as a decimal fraction, 0.0575 → 5.75). */
export function capRatePct(comp) {
  const v = comp?.bldgCapRate;
  return v == null || !Number.isFinite(Number(v)) ? null : Number((Number(v) * 100).toFixed(6));
}

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
    docks: rangeOf(f.docks), power: rangeOf(f.power),
    rate: rangeOf(f.rate), term: rangeOf(f.term), escal: rangeOf(f.escal), freeRent: rangeOf(f.freeRent), ti: rangeOf(f.ti),
    bldgPsf: rangeOf(f.bldgPsf), capRate: rangeOf(f.capRate), noi: rangeOf(f.noi), landPsf: rangeOf(f.landPsf),
    landlord: f.landlord.trim().toLowerCase(), tenant: f.tenant.trim().toLowerCase(),
    basis: f.basis.length ? new Set(f.basis) : null,
    counties: f.counties.length ? new Set(f.counties) : null,
  };
}

/** True when `comp` passes every active filter. */
function passes(comp, c, { cachedLocation } = {}) {
  if (c.tokens.length && !matchesSearch(comp, c.tokens, { cachedLocation })) return false;
  if (c.types && !c.types.has(comp.compType)) return false;
  if (c.dateB) {
    const d = comp.compDate ? String(comp.compDate).slice(0, 10) : null;
    if (!d) return false;
    if (c.dateB.from && d < c.dateB.from) return false;
    if (c.dateB.to && d > c.dateB.to) return false;
  }
  if (rangeActive(c.sf) && !inRange(buildingOnly(comp, compSizeSf(comp)), c.sf.min, c.sf.max)) return false;
  if (rangeActive(c.acres) && !inRange(landAcres(comp), c.acres.min, c.acres.max)) return false;
  if (rangeActive(c.clearHt) && !inRange(buildingOnly(comp, comp.clearHeightFt), c.clearHt.min, c.clearHt.max)) return false;
  if (rangeActive(c.yearBuilt) && !inRange(buildingOnly(comp, comp.yearBuilt), c.yearBuilt.min, c.yearBuilt.max)) return false;
  if (rangeActive(c.power) && !inRange(buildingOnly(comp, comp.powerAmps), c.power.min, c.power.max)) return false;
  if (rangeActive(c.docks) && !inRange(buildingOnly(comp, comp.dockDoors), c.docks.min, c.docks.max)) return false;
  if (rangeActive(c.rate) && !inRange(leaseAnnualRate(comp), c.rate.min, c.rate.max)) return false;
  if (c.basis && !(comp.compType === "lease" && c.basis.has(comp.leaseRateExpense))) return false;
  if (rangeActive(c.term) && !inRange(leaseOnly(comp, parseLeaseTermYears(comp.leaseTerm)), c.term.min, c.term.max)) return false;
  if (rangeActive(c.escal) && !inRange(leaseOnly(comp, comp.leaseEscalationPct), c.escal.min, c.escal.max)) return false;
  if (rangeActive(c.freeRent) && !inRange(leaseOnly(comp, comp.leaseFreeRentMonths), c.freeRent.min, c.freeRent.max)) return false;
  if (rangeActive(c.ti) && !inRange(leaseOnly(comp, comp.leaseTi), c.ti.min, c.ti.max)) return false;
  if (rangeActive(c.bldgPsf) && !(comp.compType === "building_sale" && inRange(buildingPricePerSf(comp), c.bldgPsf.min, c.bldgPsf.max))) return false;
  if (rangeActive(c.capRate) && !inRange(saleOnly(comp, capRatePct(comp)), c.capRate.min, c.capRate.max)) return false;
  if (rangeActive(c.noi) && !inRange(saleOnly(comp, comp.bldgNoi), c.noi.min, c.noi.max)) return false;
  if (rangeActive(c.landPsf) && !(comp.compType === "land" && inRange(landPricePerSf(comp), c.landPsf.min, c.landPsf.max))) return false;
  if (c.landlord && !String(comp.partyProvider || "").toLowerCase().includes(c.landlord)) return false;
  if (c.tenant && !String(comp.partyAcquirer || "").toLowerCase().includes(c.tenant)) return false;
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

/** { shown, total }. A comp missing a filtered value is simply not shown — never counted or called out. */
export function countFiltered(comps, filters, opts = {}) {
  const { now = new Date(), cachedLocation } = opts;
  const c = compile(filters, now);
  let shown = 0;
  for (const comp of comps || []) if (passes(comp, c, { cachedLocation })) shown++;
  return { shown, total: (comps || []).length };
}

/** The results line — exactly "12 of 41 comps". */
export function resultsLine({ shown, total }) {
  return `${shown} of ${total} ${total === 1 ? "comp" : "comps"}`;
}
/** The panel footer's button — "Show 12 comps". */
export function showButtonLabel({ shown }) {
  return `Show ${shown} ${shown === 1 ? "comp" : "comps"}`;
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

const executedMs = (c) => (c.compDate ? Date.parse(String(c.compDate).slice(0, 10)) : null);

/** A NEW array in `key` order. The incoming array is assumed to be in recency order already (the
 * panel's list is `sortCompsByRecency` output), which is what ties fall back to. */
export function sortComps(comps, key = "newest") {
  const list = [...(comps || [])];
  switch (normalizeSort(key)) {
    // Executed-date order both ways; an undated comp always sorts to the END (owner, 2026-10-20),
    // so Newest is recency order with the undated comps (themselves by Date entered) moved last.
    case "newest": return missingLast(sortCompsByRecency(list), executedMs, "desc");
    case "oldest": return missingLast(sortCompsByRecency(list), executedMs, "asc");
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

/** "Harris County, TX" → "Harris" (the panel and chips stay short). */
export function countyShort(key) {
  const full = countyLabel(key) || key;
  return full.replace(/ County, [A-Z]{2}$/, "");
}

/* ---- chips and section summaries ----------------------------------------------------------- */

const fmtN = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const fmtMoney = (n) => `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
/** 100000 → "100k" (chips stay short); anything not a clean thousand keeps its full figure. */
const fmtK = (n) => (Number.isInteger(n) && n >= 1000 && n % 1000 === 0 ? `${n / 1000}k` : fmtN(n));
const fmtYear = (n) => String(n);
const fmtDayShort = (iso) => { const [y, m, d] = iso.split("-"); return `${Number(m)}/${Number(d)}/${y.slice(2)}`; };

/** One row per range filter: its state key, chip key, the panel section it lives in, and how it reads.
 * The single table chips, removal and the section-header summaries all read, so they cannot drift. */
const RANGE_DEFS = [
  { field: "rate", key: "rate", section: "deal", name: "Rate", fmt: fmtMoney, unit: "/SF/yr" },
  { field: "term", key: "term", section: "deal", name: "Term", fmt: fmtN, unit: "yrs" },
  { field: "escal", key: "escal", section: "deal", name: "Escalations", fmt: fmtN, unit: "%" },
  { field: "freeRent", key: "freeRent", section: "deal", name: "Free rent", fmt: fmtN, unit: "mo" },
  { field: "ti", key: "ti", section: "deal", name: "TI", fmt: fmtMoney, unit: "/SF" },
  { field: "bldgPsf", key: "bldgPsf", section: "deal", name: "Price", fmt: fmtMoney, unit: "/SF" },
  { field: "capRate", key: "capRate", section: "deal", name: "Cap rate", fmt: fmtN, unit: "%" },
  { field: "noi", key: "noi", section: "deal", name: "NOI", fmt: fmtMoney, unit: "" },
  { field: "landPsf", key: "landPsf", section: "deal", name: "Land price", fmt: fmtMoney, unit: "/SF" },
  { field: "sf", key: "sf", section: "building", name: "", fmt: fmtN, unit: "SF" },
  { field: "clearHt", key: "clearHt", section: "building", name: "Clear height", fmt: fmtN, unit: "ft" },
  { field: "docks", key: "docks", section: "building", name: "Dock doors", fmt: fmtN, unit: "" },
  { field: "power", key: "power", section: "building", name: "Power", fmt: fmtN, unit: "A" },
  { field: "yearBuilt", key: "year", section: "building", name: "Built", fmt: fmtYear, unit: "" },
  { field: "acres", key: "acres", section: "land", name: "", fmt: fmtN, unit: "AC" },
];
const TEXT_DEFS = [
  { field: "landlord", key: "landlord", section: "parties", name: "Landlord" },
  { field: "tenant", key: "tenant", section: "parties", name: "Tenant" },
];
const FIELD_FOR_KEY = Object.fromEntries([...RANGE_DEFS, ...TEXT_DEFS].map((d) => [d.key, d.field]));

/** "100,000 – 300,000" / "≥ 100,000" / "≤ 300,000", or null when the range is open at both ends. */
function rangeText(r, fmt) {
  const { min, max } = rangeOf(r);
  if (min == null && max == null) return null;
  if (min != null && max != null) return `${fmt(min)} – ${fmt(max)}`;
  return min != null ? `≥ ${fmt(min)}` : `≤ ${fmt(max)}`;
}
const joinLabel = (name, text, unit) => [name, text, unit].filter(Boolean).join(" ");

/** The party names switch to Seller / Buyer once only sales and land are in play. */
export function partyLabels(types) {
  const t = types || [];
  if (t.length && t.every((x) => x === "lease")) return { landlord: "Landlord", tenant: "Tenant" };
  if (t.length && t.every((x) => x !== "lease")) return { landlord: "Seller", tenant: "Buyer" };
  return { landlord: "Landlord / seller", tenant: "Tenant / buyer" };
}

const DATE_WORDS = { "3mo": ["Past 3 mo", "Past 3 months"], "6mo": ["Past 6 mo", "Past 6 months"], "12mo": ["Past 12 mo", "Past 12 months"] };

/** Ordered `[{ key, label, summary, section }]` — one removable chip per active filter (search text is
 * not a chip; it lives in the search box). `label` is the compact chip text, `summary` the full text a
 * section header shows. Exactly the filters that are applied: the filters are pruned by type first.
 * `removeFilter(filters, key)` is the inverse. */
export function activeFilterChips(filters, { now = new Date() } = {}) {
  const f = normalizeFilters(filters);
  const labels = partyLabels(f.types);
  const chips = [];
  const push = (key, section, label, summary = label) => chips.push({ key, section, label, summary });
  for (const t of f.types) push(`type:${t}`, "type", TYPE_FILTER_LABEL[t]);
  const db = dateBounds(f.date, now);
  if (db) {
    if (f.date.mode === "custom") {
      const text = db.from && db.to ? `${fmtDayShort(db.from)} – ${fmtDayShort(db.to)}` : db.from ? `Since ${fmtDayShort(db.from)}` : `Through ${fmtDayShort(db.to)}`;
      push("date", "date", text);
    } else push("date", "date", DATE_WORDS[f.date.mode][0], DATE_WORDS[f.date.mode][1]);
  }
  for (const c of f.counties) push(`county:${c}`, "location", countyShort(c));
  for (const section of ["deal", "building", "land"]) {
    for (const d of RANGE_DEFS) {
      if (d.section !== section) continue;
      const compact = d.fmt === fmtN ? fmtK : d.fmt;
      const chip = rangeText(f[d.field], compact);
      if (chip == null) continue;
      push(d.key, section, joinLabel(d.name, chip, d.unit), joinLabel(d.name, rangeText(f[d.field], d.fmt), d.unit));
      if (d.field === "rate") for (const b of f.basis) push(`basis:${b}`, "deal", b === "nnn" ? "NNN" : "Gross");
    }
    if (section === "deal" && !chips.some((c) => c.key === "rate")) for (const b of f.basis) push(`basis:${b}`, "deal", b === "nnn" ? "NNN" : "Gross");
  }
  for (const d of TEXT_DEFS) {
    const v = f[d.field].trim();
    if (v) push(d.key, d.section, `${labels[d.field]}: ${v}`);
  }
  return chips;
}

/** `filters` with the filter behind chip `key` cleared. Unknown key → unchanged. */
export function removeFilter(filters, key) {
  const f = normalizeFilters(filters);
  const d = defaultFilters();
  const [head, rest] = key.split(/:(.*)/s);
  switch (head) {
    case "type": return withTypes(f, f.types.filter((t) => t !== rest));
    case "basis": return { ...f, basis: f.basis.filter((b) => b !== rest) };
    case "county": return { ...f, counties: f.counties.filter((c) => c !== rest) };
    case "date": return { ...f, date: d.date };
    default: {
      const field = FIELD_FOR_KEY[head];
      return field ? { ...f, [field]: d[field] } : f;
    }
  }
}

/** What each panel section's header shows at the right: the current setting, or null ("Any"). */
export function sectionSummaries(filters, opts = {}) {
  const chips = activeFilterChips(filters, opts);
  const out = { type: null, date: null, location: null, deal: null, building: null, land: null, parties: null };
  for (const section of Object.keys(out)) {
    const mine = chips.filter((c) => c.section === section);
    if (!mine.length) continue;
    const groups = new Set(mine.map((c) => c.key.split(":")[0]));
    if (groups.size > 1) out[section] = `${groups.size} set`;
    else if (section === "location" && mine.length > 2) out[section] = `${mine.length} counties`;
    else out[section] = mine.map((c) => c.summary).join(", ");
  }
  return out;
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
  return [...counts.entries()].map(([key, count]) => ({ key, count, label: countyLabel(key) || key, short: countyShort(key) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
