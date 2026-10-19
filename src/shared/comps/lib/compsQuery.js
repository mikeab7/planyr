/* compsQuery — the pure search / filter / sort layer behind the Records tab (All comps).
 *
 * A VIEW over the comps array `fetchAllComps` already returned: it never queries, never fetches,
 * and never geocodes. Everything here derives from that array at call time (comps follow project
 * sharing — CLAUDE.md #21 — so the filter must not become a second query with its own visibility).
 * No React in this file; CompsPanel calls it inside useMemo.
 *
 * Rules worth knowing before editing:
 *  · A comp with a BLANK value in a filtered field is EXCLUDED by that filter (CoStar behaviour),
 *    never treated as 0 and never as "passes".
 *  · Lease rates are always compared ANNUALISED (`annualLeaseRate`), whatever period the comp was
 *    entered in; a lease with no stated period has no rate to compare (null — never guessed).
 *  · Date windows are relative to today, inclusive of today: 3 mo = 90 days, 6 mo = 180, 12 mo = 365.
 *    A comp dated in the future is not "past", so a window excludes it. Undated comps are excluded
 *    by any active date filter and COUNTED (`undatedHidden`) so the results line never has a
 *    mystery gap.
 *  · "Newest" is today's `sortCompsByRecency` (an undated comp falls back to its Date entered —
 *    owner decision 2026-09-02); a comp with neither sorts last.
 */
import {
  annualLeaseRate, buildingPricePerSf, landPricePerSf, sortCompsByRecency,
} from "./comps.js";
import { compSizeSf, countyLabel, countyNameWords } from "../../../workspaces/dashboard/lib/compsCardModel.js";

const SF_PER_ACRE = 43560;
const DAY_MS = 86400000;

export const COMP_TYPE_KEYS = ["land", "building_sale", "lease"];
export const TYPE_CHIP_LABEL = { land: "Land", building_sale: "Bldg Sale", lease: "Lease" };
export const DATE_MODES = ["any", "3m", "6m", "12m", "custom"];
export const DATE_WINDOW_DAYS = { "3m": 90, "6m": 180, "12m": 365 };
export const SORT_KEYS = ["newest", "oldest", "largest", "smallest", "rateHigh", "rateLow", "psfHigh", "psfLow"];
export const SORT_LABEL = {
  newest: "Newest", oldest: "Oldest", largest: "Largest", smallest: "Smallest",
  rateHigh: "Rate high to low", rateLow: "Rate low to high", psfHigh: "Price/SF high to low", psfLow: "Price/SF low to high",
};

/** Min/Max pairs the panel edits. Values are digit strings so a controlled <input> never fights React. */
const RANGE_KEYS = ["sizeSf", "acres", "clearFt", "yearBuilt", "leaseRate", "bldgPsf", "landPsf"];
const MIN_KEYS = ["powerAmps", "dockDoors"];

export function emptyFilters() {
  const f = { types: [], date: { mode: "any", from: "", to: "" }, bases: [], counties: [] };
  for (const k of RANGE_KEYS) f[k] = { min: "", max: "" };
  for (const k of MIN_KEYS) f[k] = { min: "" };
  return f;
}

/** Defensive reader for a persisted / partial filters object — anything unreadable falls to empty. */
export function normalizeFilters(raw) {
  const base = emptyFilters();
  if (!raw || typeof raw !== "object") return base;
  const strs = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  base.types = strs(raw.types).filter((t) => COMP_TYPE_KEYS.includes(t));
  base.bases = strs(raw.bases).filter((b) => b === "nnn" || b === "gross");
  base.counties = strs(raw.counties);
  if (raw.date && typeof raw.date === "object") {
    base.date = {
      mode: DATE_MODES.includes(raw.date.mode) ? raw.date.mode : "any",
      from: typeof raw.date.from === "string" ? raw.date.from : "",
      to: typeof raw.date.to === "string" ? raw.date.to : "",
    };
  }
  for (const k of RANGE_KEYS) if (raw[k] && typeof raw[k] === "object") base[k] = { min: String(raw[k].min ?? ""), max: String(raw[k].max ?? "") };
  for (const k of MIN_KEYS) if (raw[k] && typeof raw[k] === "object") base[k] = { min: String(raw[k].min ?? "") };
  return base;
}

export function normalizeSort(raw) {
  return SORT_KEYS.includes(raw) ? raw : "newest";
}

/* ---- number / date parsing ---------------------------------------------------------------- */

/** "100,000" / "100000" -> 100000; blank or unparseable -> null (an empty bound is no bound). */
export function parseBound(v) {
  if (v == null) return null;
  const s = String(v).replace(/[,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const pad2 = (n) => String(n).padStart(2, "0");
/** Local-calendar ISO day for a Date (comp dates are calendar days, not instants). */
export function isoDay(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function todayIso(today) {
  if (today instanceof Date) return isoDay(today);
  if (typeof today === "string" && /^\d{4}-\d{2}-\d{2}/.test(today)) return today.slice(0, 10);
  return isoDay(new Date());
}
function shiftIso(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  // Date.UTC keeps the arithmetic free of DST: a calendar day is always exactly 24h here.
  const t = Date.UTC(y, m - 1, d) + days * DAY_MS;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** The [from, to] ISO bounds a date filter implies ("" = open end), or null when it is inactive. */
export function dateBounds(date, today) {
  const mode = date?.mode || "any";
  if (mode === "any") return null;
  if (mode === "custom") {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(date.from || "") ? date.from : "";
    const to = /^\d{4}-\d{2}-\d{2}$/.test(date.to || "") ? date.to : "";
    return from || to ? { from, to } : null; // both blank = no bound = inactive
  }
  const days = DATE_WINDOW_DAYS[mode];
  if (!days) return null;
  const t = todayIso(today);
  return { from: shiftIso(t, -days), to: t };
}

/* ---- derived values (all reuse the model's one-answer helpers) ----------------------------- */

/** Land size in acres, sf-quoted sizes normalised (÷ 43,560). Null when unrecorded. */
export function compAcres(c) {
  if (c?.compType !== "land" || c.landSizeValue == null) return null;
  const v = Number(c.landSizeValue);
  if (!(v >= 0) || !Number.isFinite(v)) return null;
  return c.landSizeUnit === "sf" ? v / SF_PER_ACRE : v;
}
/** BUILDING square feet (sale or lease). Land has none — its size is acres. */
export function compBuildingSf(c) {
  if (c?.compType === "building_sale") return c.bldgSizeSf ?? null;
  if (c?.compType === "lease") return c.leaseSizeSf ?? null;
  return null;
}
/** The price-per-SF a sale comp sorts on (building or land); leases have none. */
export function compPsf(c) {
  if (c?.compType === "building_sale") return buildingPricePerSf(c);
  if (c?.compType === "land") return landPricePerSf(c);
  return null;
}
function compRate(c) { return c?.compType === "lease" ? annualLeaseRate(c) : null; }
function hasBuilding(c) { return c?.compType === "building_sale" || c?.compType === "lease"; }

/* ---- search -------------------------------------------------------------------------------- */

export function parseSearch(text) {
  return String(text || "").toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every token must match somewhere in the comp's searchable text. `locationText(comp)` is OPTIONAL
 * and must return only an ALREADY-CACHED address (or null) — search never triggers a geocode. */
export function matchesSearch(comp, tokens, locationText) {
  if (!tokens || !tokens.length) return true;
  const hay = [
    comp.title, comp.notes, comp.partyProvider, comp.partyAcquirer, comp.anchor?.parcelApn,
    countyLabel(comp.anchor?.county), locationText ? locationText(comp) : null,
  ].filter(Boolean).join("\n").toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

/* ---- filtering ----------------------------------------------------------------------------- */

function inRange(value, min, max) {
  if (min == null && max == null) return true;
  if (value == null || !Number.isFinite(value)) return false; // blank never matches a range
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

/** County keys present in the comps, with counts, labelled — for the County chips. */
export function countyOptions(comps) {
  const m = new Map();
  for (const c of comps || []) {
    const k = c?.anchor?.county;
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()]
    .map(([key, count]) => {
      const { words } = countyNameWords(key);
      return { key, count, label: words ? `${words.join(" ")} County` : key };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function compileFilters(filters, today) {
  const f = normalizeFilters(filters);
  const b = (k) => ({ min: parseBound(f[k].min), max: parseBound(f[k].max) });
  const ranges = {};
  for (const k of RANGE_KEYS) ranges[k] = b(k);
  return {
    types: f.types, bases: f.bases, counties: f.counties,
    dates: dateBounds(f.date, today),
    ranges,
    powerMin: parseBound(f.powerAmps.min), docksMin: parseBound(f.dockDoors.min),
  };
}

/** Everything EXCEPT the date window. Split out so the "N undated hidden" count can ask whether a
 * comp would otherwise have been shown. */
function passesNonDate(c, q) {
  if (q.types.length && !q.types.includes(c.compType)) return false;
  if (q.counties.length && !q.counties.includes(c.anchor?.county)) return false;
  const r = q.ranges;
  if (!inRange(compBuildingSf(c), r.sizeSf.min, r.sizeSf.max)) return false;
  if (!inRange(compAcres(c), r.acres.min, r.acres.max)) return false;
  if (!inRange(hasBuilding(c) ? c.clearHeightFt : null, r.clearFt.min, r.clearFt.max)) return false;
  if (!inRange(hasBuilding(c) ? c.yearBuilt : null, r.yearBuilt.min, r.yearBuilt.max)) return false;
  if (q.powerMin != null && !inRange(hasBuilding(c) ? c.powerAmps : null, q.powerMin, null)) return false;
  if (q.docksMin != null && !inRange(hasBuilding(c) ? c.dockDoors : null, q.docksMin, null)) return false;
  if (!inRange(compRate(c), r.leaseRate.min, r.leaseRate.max)) return false;
  if (q.bases.length && !(c.compType === "lease" && q.bases.includes(c.leaseRateExpense))) return false;
  if (!inRange(c.compType === "building_sale" ? buildingPricePerSf(c) : null, r.bldgPsf.min, r.bldgPsf.max)) return false;
  if (!inRange(c.compType === "land" ? landPricePerSf(c) : null, r.landPsf.min, r.landPsf.max)) return false;
  return true;
}

function passesDate(c, dates) {
  if (!dates) return true;
  const d = c.compDate ? String(c.compDate).slice(0, 10) : "";
  if (!d) return false;
  if (dates.from && d < dates.from) return false;
  if (dates.to && d > dates.to) return false;
  return true;
}

/** Single pass. Returns { shown, undatedHidden }. `opts`: { today, search, locationText }. */
export function applyFilters(comps, filters, opts = {}) {
  const q = compileFilters(filters, opts.today);
  const tokens = Array.isArray(opts.search) ? opts.search : parseSearch(opts.search);
  const shown = [];
  let undatedHidden = 0;
  for (const c of comps || []) {
    if (!c) continue;
    if (!matchesSearch(c, tokens, opts.locationText)) continue;
    if (!passesNonDate(c, q)) continue;
    if (!passesDate(c, q.dates)) {
      if (!c.compDate) undatedHidden += 1;
      continue;
    }
    shown.push(c);
  }
  return { shown, undatedHidden };
}

/* ---- sort ---------------------------------------------------------------------------------- */

function recencyKey(c) {
  return c?.compDate || (c?.createdAt ? String(c.createdAt).slice(0, 10) : "");
}

/** Stable sort; a comp lacking the sorted field goes to the END under every order. */
export function sortComps(comps, sortKey) {
  const key = normalizeSort(sortKey);
  if (key === "newest") return sortCompsByRecency(comps);
  const list = [...(comps || [])];
  const pick = {
    oldest: recencyKey,
    largest: compSizeSf,
    smallest: (c) => compSizeSf(c),
    rateHigh: compRate, rateLow: compRate,
    psfHigh: compPsf, psfLow: compPsf,
  }[key];
  const dir = { oldest: 1, largest: -1, smallest: 1, rateHigh: -1, rateLow: 1, psfHigh: -1, psfLow: 1 }[key];
  const keyed = list.map((c, i) => ({ c, i, v: pick(c) }));
  const has = (v) => v != null && v !== "" && !(typeof v === "number" && !Number.isFinite(v));
  keyed.sort((a, b) => {
    const ha = has(a.v), hb = has(b.v);
    if (ha !== hb) return ha ? -1 : 1;
    if (!ha) return a.i - b.i;
    let d;
    if (typeof a.v === "string") d = a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
    else d = a.v - b.v;
    return d ? d * dir : a.i - b.i;
  });
  return keyed.map((k) => k.c);
}

/* ---- active filter chips ------------------------------------------------------------------- */

const fmt = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

function rangeText(rng, unit, { prefix = "" } = {}) {
  const lo = parseBound(rng?.min), hi = parseBound(rng?.max);
  if (lo == null && hi == null) return null;
  const u = unit ? ` ${unit}` : "";
  if (lo != null && hi != null) return `${prefix}${fmt(lo)}–${prefix}${fmt(hi)}${u}`;
  if (lo != null) return `≥ ${prefix}${fmt(lo)}${u}`;
  return `≤ ${prefix}${fmt(hi)}${u}`;
}

/** Removable chips, one per active filter: [{ key, label }]. `removeFilter(filters, key)` clears it. */
export function activeFilterChips(filters, opts = {}) {
  const f = normalizeFilters(filters);
  const chips = [];
  for (const t of f.types) chips.push({ key: `type:${t}`, label: TYPE_CHIP_LABEL[t] });
  const d = f.date;
  if (d.mode === "3m" || d.mode === "6m" || d.mode === "12m") chips.push({ key: "date", label: d.mode.replace("m", " mo") });
  else if (d.mode === "custom" && dateBounds(d, opts.today)) {
    const b = dateBounds(d, opts.today);
    chips.push({ key: "date", label: b.from && b.to ? `${b.from} – ${b.to}` : b.from ? `From ${b.from}` : `Through ${b.to}` });
  }
  const push = (key, label) => { if (label) chips.push({ key, label }); };
  push("sizeSf", rangeText(f.sizeSf, "SF"));
  push("acres", rangeText(f.acres, "AC"));
  push("clearFt", rangeText(f.clearFt, "ft clear"));
  const amps = parseBound(f.powerAmps.min);
  if (amps != null) push("powerAmps", `≥ ${fmt(amps)} A`);
  const docks = parseBound(f.dockDoors.min);
  if (docks != null) push("dockDoors", `≥ ${fmt(docks)} docks`);
  push("yearBuilt", rangeText(f.yearBuilt, "", {}) && `Built ${rangeText(f.yearBuilt, "")}`);
  push("leaseRate", rangeText(f.leaseRate, "/SF/yr", { prefix: "$" }));
  for (const b of f.bases) chips.push({ key: `basis:${b}`, label: b.toUpperCase() });
  push("bldgPsf", rangeText(f.bldgPsf, "/SF bldg", { prefix: "$" }));
  push("landPsf", rangeText(f.landPsf, "/SF land", { prefix: "$" }));
  for (const k of f.counties) {
    const { words } = countyNameWords(k);
    chips.push({ key: `county:${k}`, label: words ? `${words.join(" ")} County` : k });
  }
  return chips;
}

/** The filters with ONE chip's filter cleared. */
export function removeFilter(filters, chipKey) {
  const f = normalizeFilters(filters);
  const [head, rest] = String(chipKey).split(":");
  if (head === "type") f.types = f.types.filter((t) => t !== rest);
  else if (head === "basis") f.bases = f.bases.filter((b) => b !== rest);
  else if (head === "county") f.counties = f.counties.filter((k) => k !== rest);
  else if (head === "date") f.date = { mode: "any", from: "", to: "" };
  else if (RANGE_KEYS.includes(head)) f[head] = { min: "", max: "" };
  else if (MIN_KEYS.includes(head)) f[head] = { min: "" };
  return f;
}

export function activeFilterCount(filters, opts) {
  return activeFilterChips(filters, opts).length;
}

/** One-call convenience for the panel: search + filters + sort, plus the counts the results line needs. */
export function countFiltered(comps, filters, opts = {}) {
  const { shown, undatedHidden } = applyFilters(comps, filters, opts);
  const sorted = sortComps(shown, opts.sort);
  return { shown: sorted, shownCount: sorted.length, total: (comps || []).length, undatedHidden };
}
