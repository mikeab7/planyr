/* georgiaMillage.js — a Georgia county lot's taxing-unit table from a county tax-district CODE (NEW-1, Bartow).
 *
 * Georgia differs from Texas on every axis the per-$100 table assumes: a lot carries ONE tax-district code (not a
 * list of CAD unit codes), the rate is in MILLS (dollars per $1,000 of ASSESSED value), and assessed value is 40% of
 * fair market value (O.C.G.A. 48-5-7). So this is its own tiny engine rather than a branch of `taxTableFor`:
 * a data file maps each district code to the LIST of levies that code pays, and each levy carries an adopted 2025
 * rate or `mills: null` (not yet transcribed).
 *
 * OWNER RULE (taxRates.js header): complete per the source, or HIDDEN. A district whose list contains any levy with
 * no rate returns null — a partial list understates the total. A TAD (tax allocation district) is an increment
 * allocation, not an extra levy, so a TAD code pays exactly its base jurisdiction's list; a CID / DDA-BID IS a levy.
 * A development-authority PILOT lot (bond-for-title) pays no ordinary tax: a "held" note, never an estimate.
 * Pure — the data file is passed in, so tests need no network.
 */
const asMills = (n) => Math.round(n * 1e4) / 1e4; // mills carry up to 3 decimals (2.662); 4 keeps the sum exact

/** The district code on a parcel's attribute bag, normalised to the two-character string the layer publishes, or null. */
export function districtCodeOf(attrs, data) {
  const raw = attrs && data ? attrs[data.codeField] : null;
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return /^\d$/.test(s) ? "0" + s : s;
}

/** True when this lot is a development-authority PILOT lot (bond-for-title). */
export function isPilotLot(attrs, data) {
  const p = data && data.pilot;
  if (!p || !attrs) return false;
  const v = attrs[p.field];
  return typeof v === "string" && v.trim().toLowerCase().startsWith(String(p.prefix).toLowerCase());
}

/** Why a code cannot show a table (for the coverage record / diagnostics), or null when it is complete. Pure. */
export function districtGap(code, data) {
  const d = data && data.districts && data.districts[code];
  if (!d) return "unknown tax-district code";
  if (!Array.isArray(d.levies)) return d.pending || "district composition not sourced";
  for (const id of d.levies) {
    const l = data.levies && data.levies[id];
    if (!l) return `levy ${id} is not defined`;
    if (typeof l.mills !== "number" || !Number.isFinite(l.mills)) return `${l.name}: ${l.pending || "rate not transcribed"}`;
  }
  return null;
}

/**
 * The table for one lot → `{ year, source, sourceUrl, unit:"mills", caption, rows:[{unit, rate}], total }`,
 * `{ held: "<note>", year, source, sourceUrl, caption }` for a PILOT lot, or null (hide). Pure.
 * `ctx.covered` is the county's TAX_COVERAGE gate — false (the default) hides everything.
 */
export function millageTableFor(parcel, data, ctx = {}) {
  if (!ctx.covered || !data || !data.districts || !data.levies || !data.year || !data.source) return null;
  const attrs = parcel && parcel.attrs;
  if (!attrs) return null;
  const base = { year: data.year, source: data.source, sourceUrl: data.sourceUrl || "", unit: data.rateUnit || "mills", caption: data.caption || "" };
  if (isPilotLot(attrs, data)) return { ...base, held: data.pilot.note };
  const code = districtCodeOf(attrs, data);
  if (!code || districtGap(code, data)) return null;
  const rows = data.districts[code].levies.map((id) => ({ unit: data.levies[id].name, rate: data.levies[id].mills }));
  return { ...base, rows, total: asMills(rows.reduce((s, r) => s + r.rate, 0)) };
}

/** Every district code that has no complete table yet → its reason. Drives TAX_COVERAGE's honest reason. Pure. */
export function pendingDistricts(data) {
  const out = {};
  for (const code of Object.keys(data.districts || {})) { const g = districtGap(code, data); if (g) out[code] = g; }
  return out;
}
