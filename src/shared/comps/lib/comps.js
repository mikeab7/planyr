/* Leasing Comps — pure data model (NEW-COMPS; provisional label until the real B# is minted
 * at push time, per /CLAUDE.md's LATE-BIND rule).
 *
 * A comp is its own entity, owned by the user who entered it. It is NOT a project type — it
 * may optionally associate with a project (siteId), but never requires one. Every comp a
 * viewer can access (their own + their team's) is a candidate for the map regardless of which
 * project it was entered under, per the owner's decision: "I don't need to build on it to
 * place a lease comp on it."
 *
 * Three comp types, each with its own optional field set. The one rule that applies to ALL of
 * them: a field left empty must never render as an empty row or an em-dash placeholder —
 * `compFieldRows` is the single place that decision is made, so no renderer has to re-derive it.
 */
import { formatDateDisplay } from "./compDates.js";

export const COMP_TYPES = ["land", "building_sale", "lease"];
export const LEASE_PERIODS = ["annual", "monthly"];
export const LEASE_EXPENSE_BASES = ["nnn", "gross"];
// ⛔ EXHAUSTIVE, not open to extension (B972512-HARDENING new finding 4) — the database's
// `comps_anchor_kind_check` CHECK constraint enumerates exactly these three values. Adding a
// fourth kind here without a matching migration (drop + recreate that constraint, and
// comps_parcel_anchor_has_identity alongside it) fails every insert/update of that kind with a
// raw 23514 the instant it reaches Postgres — never just a frontend change.
export const ANCHOR_KINDS = ["pin", "parcel", "site_plan"];

const SF_PER_ACRE = 43560;

export function isCompType(t) {
  return COMP_TYPES.includes(t);
}

function positiveNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* ---- anchor (pin OR real parcel selection — never a hand-drawn rectangle) --------------- */

export function validAnchor(anchor) {
  if (!anchor || typeof anchor.lat !== "number" || typeof anchor.lon !== "number") return false;
  if (!Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lon)) return false;
  if (anchor.kind === "parcel") return !!(anchor.parcelApn || anchor.parcelGeom);
  // site_plan: a point pinned on an uploaded, georeferenced site plan (B848848).
  //
  // ⛔ B972512-HARDENING item 2 — SOURCE OF TRUTH, WRITTEN DOWN: `sitePlanPoint` ({x,y}, an
  // image-pixel point on the overlay's own raster) is the SOURCE OF TRUTH for where this comp
  // sits — it is what the user actually clicked, and it never changes on its own. `lat`/`lon`
  // (every comp's one required, universally-read position — every map marker, list, filter and
  // proximity screen in the app reads ONLY lat/lon, never anchor-kind-specific fields) is a
  // DERIVED CACHE: `sitePlanPoint` run through the overlay's CURRENT placement transform
  // (center/scale/rotation — shared/sitePlans/lib/overlayGeoref.js `imagePointToLatLon`). That
  // cache is why it must be NOT NULL and always populated (a comp is otherwise unfindable on the
  // map), and why it goes stale — silently wrong — the instant someone drags, scales, rotates or
  // re-anchors the overlay. `SitePlansSection.jsx`'s placement-commit handler is the one place
  // that keeps the cache honest: every placement change atomically recomputes and rewrites
  // lat/lon for every comp referencing that overlay (via the `commit_site_plan_overlay_placement`
  // RPC, which can reach a teammate's comp too — comps.update is owner-only RLS, but the
  // overlay's OWNER must still be able to correct every pin on their own plan). Never treat a
  // 'site_plan' comp's lat/lon as independently editable/authoritative the way a 'pin' comp's
  // is — it is a computed value with exactly one legitimate writer.
  //
  // sitePlanOverlayId + sitePlanPoint together are the extra snapshot this anchor kind carries,
  // the same role parcelApn/parcelGeom play for 'parcel'.
  if (anchor.kind === "site_plan") {
    return !!(anchor.sitePlanOverlayId && anchor.sitePlanPoint &&
      typeof anchor.sitePlanPoint.x === "number" && typeof anchor.sitePlanPoint.y === "number");
  }
  return anchor.kind === "pin";
}

// B986096-HARDENING-7 (owner rule, "i dont need to input county as a default … do not just write
// null and move on") — county is derived from the anchor at pick time (MapFinder.jsx's
// `placeCompPinAt`/`placeCompOnOverlay`, `compParcelAnchor.js`'s `parcelCountyFromSelection`) and
// is NEVER a sheet input. A comp has no load-time self-heal the way a planned site does (B792
// re-resolves a site's county from its origin on every load), so a lookup that failed silently —
// timed out, no match, a thrown error — would leave `county: null` forever with nothing to catch
// it. This is that catch: a positioned anchor with no county gets a soft, non-blocking flag on
// the sheet's Location cell, naming exactly what Michael asked for ("log it and say so") without
// blocking the row (the comp is still real and still savable; county is metadata, not a fact
// required to record the deal). Returns null once a county IS present, or the anchor has no
// position yet at all (nothing to flag — the row is simply not located yet).
export function anchorCountyFlag(anchor) {
  if (!anchor || typeof anchor.lat !== "number" || typeof anchor.lon !== "number") return null;
  if (anchor.county) return null;
  return {
    level: "soft",
    reason: "Couldn't determine the county for this location — comps are grouped and filtered by county, so this one may be missed until it resolves. Re-pick the location to try again.",
  };
}

/* ---- LAND: $/SF headline, date required, optional price, optional size (ac or SF) ------- */

/** LAND size normalized to square feet. Null if the size or its unit is missing — never guessed. */
export function landSizeSf(sizeValue, sizeUnit) {
  const v = positiveNumber(sizeValue);
  if (!v) return null;
  if (sizeUnit === "ac") return v * SF_PER_ACRE;
  if (sizeUnit === "sf") return v;
  return null;
}

/** LAND's headline number. Null unless BOTH price and a resolvable size are present — the
 * user is never made to type $/SF directly when price + size already say it. */
export function landPricePerSf(comp) {
  const price = positiveNumber(comp?.landPrice);
  const sf = landSizeSf(comp?.landSizeValue, comp?.landSizeUnit);
  return price && sf ? price / sf : null;
}

/* ---- BUILDING SALE: $/SF on BUILDING sf (not land), date required ----------------------- */

export function buildingPricePerSf(comp) {
  const price = positiveNumber(comp?.bldgPrice);
  const sf = positiveNumber(comp?.bldgSizeSf);
  return price && sf ? price / sf : null;
}

/* ---- LEASE: rate + basis (period × expense) + TI$ + term, date required ----------------- */

/** LEASE rate normalized to an ANNUAL figure — exact math only (monthly × 12). Returns null
 * (never a guessed default) when the rate or its PERIOD is unknown, because assuming annual
 * on a comp quoted monthly would silently misstate it by 12x in any aggregate view. */
export function annualLeaseRate(comp) {
  const rate = positiveNumber(comp?.leaseRate);
  if (!rate) return null;
  if (comp?.leaseRatePeriod === "monthly") return rate * 12;
  if (comp?.leaseRatePeriod === "annual") return rate;
  return null;
}

/** Total annual rent for one lease comp — the whole reason a leased-SF figure matters: the
 * rate alone is $/SF, so without a size there is no dollar total to derive. Null unless BOTH
 * an annual-normalizable rate AND a positive size are present — never guessed. */
export function leaseTotalAnnualRent(comp) {
  const annual = annualLeaseRate(comp);
  const sf = positiveNumber(comp?.leaseSizeSf);
  return annual != null && sf ? annual * sf : null;
}

/** LAND's price per unit of AREA, in the SIZE'S OWN RECORDED UNIT — $/AC when `landSizeUnit` is
 * acres, $/SF when it's square feet. ⛔ B986096-HARDENING-6, corrected TWICE in one session: a
 * single shared "$/SF" derived slot was made to carry a lease's annualized rate AND a sale's
 * price/size (a genuine unit conflation, not just a bad label) — and the FIRST fix only renamed
 * the header while leaving the conflation itself intact, because industrial land is quoted BOTH
 * ways and forcing an acre-priced deal through `landPricePerSf`'s SF conversion is the exact same
 * class of error one level down. This function is deliberately NOT `landPricePerSf` (which always
 * normalizes to SF, correctly for its own callers — a stated $/SF headline, sale summaries — and
 * is unchanged): it divides by the RAW recorded size, in whatever unit the comp actually used, so
 * an acre-quoted deal reads as a genuine $/ACRE figure. Returns `{ value, unit }` — `unit` is
 * `"ac"` or `"sf"` — so a renderer can label the figure with the unit that is ACTUALLY true for
 * this row, never a borrowed one. Null when price or size is missing. */
export function landPricePerAreaUnit(comp) {
  const price = positiveNumber(comp?.landPrice);
  const sizeValue = positiveNumber(comp?.landSizeValue);
  if (!price || !sizeValue) return null;
  const unit = comp?.landSizeUnit === "ac" ? "ac" : "sf";
  return { value: price / sizeValue, unit };
}

/** Parses this app's own normalized lease-term strings ("126 mo", "5 yrs" — `compParse.js`'s
 * `findTermBare`) into a fractional YEAR count, and loosely accepts a hand-typed variant too
 * ("10 years", "18 months"). Null if the text carries no recognizable duration — never guessed. */
export function parseLeaseTermYears(text) {
  const m = String(text || "").match(/(\d+(?:\.\d+)?)\s*(yr|year|yrs|years|mo|mos|month|months)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return /yr|year/i.test(m[2]) ? n : n / 12;
}

/** NET EFFECTIVE RENT ($/SF/yr) — the figure brokers actually compare, because a face rate
 * alone hides free rent, a TI allowance, and how an escalating rate compounds over the term.
 * ⛔ B986096-HARDENING-6, owner-decided: this is a NET-OF-CONCESSIONS annualized figure on the
 * comp's OWN quoted basis (NNN stays NNN, gross stays gross) — deliberately NOT converted to a
 * true NNN-equivalent for a gross-quoted comp, because that conversion needs an operating-
 * expense figure this app doesn't capture anywhere; inventing one would be a guessed number
 * wearing a precise decimal. True NNN normalization is future work, gated on an opex field —
 * flagged loudly rather than silently built as if it were already handled.
 *
 * Method: the face rate compounds by the escalation percentage once per full year of the term
 * (a partial final year weighted by its fraction), summed to a total $/SF over the whole term;
 * free rent (valued at the FACE/starting rate — the standard simplification, since the
 * escalated rate hasn't started yet during free-rent months) and the TI allowance (a one-time
 * $/SF cost to the landlord) are both subtracted; the net total is spread evenly back across the
 * term to one comparable annual $/SF figure. A missing escalation/free-rent/TI is treated as
 * ZERO (its absence in a real abstract means the deal doesn't have one, not "unknown") — a
 * missing RATE, PERIOD or TERM makes the whole figure null, the same "never guess the
 * load-bearing inputs" rule `annualLeaseRate` already follows. */
export function netEffectiveLeaseRate(comp) {
  if (comp?.compType !== "lease") return null;
  const faceAnnual = annualLeaseRate(comp);
  const termYears = parseLeaseTermYears(comp?.leaseTerm);
  if (faceAnnual == null || termYears == null) return null;
  const escalation = positiveNumber(comp?.leaseEscalationPct) ? Number(comp.leaseEscalationPct) / 100 : 0;
  const freeRentYears = positiveNumber(comp?.leaseFreeRentMonths) ? Number(comp.leaseFreeRentMonths) / 12 : 0;
  const ti = positiveNumber(comp?.leaseTi) ? Number(comp.leaseTi) : 0;

  let grossPsfOverTerm = 0;
  let remaining = termYears;
  let year = 0;
  while (remaining > 1e-9) {
    const yearFraction = Math.min(1, remaining);
    grossPsfOverTerm += faceAnnual * (1 + escalation) ** year * yearFraction;
    remaining -= 1;
    year += 1;
  }
  const netPsfOverTerm = grossPsfOverTerm - faceAnnual * freeRentYears - ti;
  return netPsfOverTerm / termYears;
}

/* ---- basis normalization for any list / average / sort / comparison view ---------------- */

/** One NNN or one gross group's average — SF-WEIGHTED when every comp being averaged carries a
 * leaseSizeSf, otherwise a plain mean, explicitly flagged `weighted:false` with a
 * `sizeMissingCount`. Deliberately all-or-nothing per group: averaging some comps by size and
 * others not, then reporting one number, is exactly the "silently mixes weighted and
 * unweighted values" the owner ruled out — so a group with even one comp missing its size
 * falls back to the unweighted mean for ALL of it, rather than quietly dropping or
 * part-weighting members. */
function leaseGroupAverage(entries) {
  if (!entries.length) return null;
  const missing = entries.filter((e) => e.sf == null).length;
  if (missing === 0) {
    let weightedSum = 0, sizeSum = 0;
    for (const e of entries) { weightedSum += e.annual * e.sf; sizeSum += e.sf; }
    return { avg: weightedSum / sizeSum, count: entries.length, weighted: true, sizeMissingCount: 0 };
  }
  const sum = entries.reduce((a, e) => a + e.annual, 0);
  return { avg: sum / entries.length, count: entries.length, weighted: false, sizeMissingCount: missing };
}

/** Groups LEASE comps by their EXPENSE basis (NNN vs gross) after normalizing period to
 * annual. NNN and gross are never blended into one number — there is no honest conversion
 * between them without the underlying expense figures the app doesn't have, so blending them
 * would be exactly the "table that silently mixes monthly and annual figures" the owner ruled
 * out, just for the other axis. The default DISPLAY basis is annual NNN: the headline reads
 * the NNN group when any exist, falling back to gross, and always names which one it is
 * showing. A comp missing its rate or basis counts toward `unknownCount`, never toward either
 * average. Each group's average is SF-weighted per `leaseGroupAverage` above. */
export function summarizeLeaseComps(comps) {
  const nnnEntries = [], grossEntries = [];
  let unknownCount = 0;
  for (const c of comps || []) {
    if (c?.compType !== "lease") continue;
    const annual = annualLeaseRate(c);
    const basis = c?.leaseRateExpense;
    if (annual == null || (basis !== "nnn" && basis !== "gross")) { unknownCount++; continue; }
    const entry = { annual, sf: positiveNumber(c?.leaseSizeSf) };
    if (basis === "nnn") nnnEntries.push(entry); else grossEntries.push(entry);
  }
  const nnn = leaseGroupAverage(nnnEntries);
  const gross = leaseGroupAverage(grossEntries);
  const headlineBasis = nnn ? "nnn" : gross ? "gross" : null;
  const headline = headlineBasis === "nnn" ? nnn : headlineBasis === "gross" ? gross : null;
  return { headlineBasis, headline, nnn, gross, unknownCount };
}

/** Mean $/SF for LAND or BUILDING_SALE comps — no basis ambiguity for these (a $/SF figure
 * means the same thing regardless of the underlying deal size), so this is a plain mean over
 * whichever comps have a computable $/SF. */
export function summarizeSaleComps(comps, compType) {
  const psfFn = compType === "land" ? landPricePerSf : buildingPricePerSf;
  const vals = (comps || []).filter((c) => c?.compType === compType).map(psfFn).filter((v) => v != null);
  if (!vals.length) return { avg: null, count: 0 };
  return { avg: vals.reduce((a, b) => a + b, 0) / vals.length, count: vals.length };
}

/** Text bits for the Comps rail's list-view summary strip — sale-comp (land/building) averages
 * only. LEASE deliberately contributes no line here (NEW-1, owner verbatim: "i dont think it
 * needs to show the avg on the main page") — with as few as one lease comp on record, an
 * average restates the single row directly beneath it, at the top of a narrow rail. This does
 * NOT touch `summarizeLeaseComps`: its NNN/gross basis-normalization and SF-weighting are
 * unchanged and still fully unit-tested above — they simply have no rail consumer today. */
export function compsSummaryBits(comps) {
  const land = summarizeSaleComps(comps, "land");
  const bldg = summarizeSaleComps(comps, "building_sale");
  const bits = [];
  if (land.count) bits.push(`Land avg $${land.avg.toFixed(2)}/SF (${land.count})`);
  if (bldg.count) bits.push(`Bldg sale avg $${bldg.avg.toFixed(2)}/SF (${bldg.count})`);
  return bits;
}

/* ---- presentation: the ONE place that decides which fields render ----------------------- */

function fmtMoney(n) {
  return n == null ? null : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
// Whole-dollar currency — for a derived TOTAL (never a per-SF rate, which needs its cents).
// `maximumFractionDigits` alone left a lone trailing decimal on a non-round total (B831603
// NEW-5: ".65 x 613,208 x 12" rendered as "$4,783,022.4"); this floors it to whole dollars,
// matching the live rent-total preview the create form already shows under Leased SF.
function fmtMoneyWhole(n) {
  return n == null ? null : Number(n).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtPsf(n) {
  return n == null ? null : `$${n.toFixed(2)}/SF`;
}

// ⛔ B986096-HARDENING-8 (owner rule, "change the date formatting to something people would
// normally see") — mm/dd/yy, the Schedule task report's own convention (08/20/26, 06/15/26),
// never the raw ISO string. AUDIT-FIRST note: FileBrowser.jsx/SiteReviewModal.jsx/MapFinder.jsx
// use a DIFFERENT existing convention ("Jun 1, 2027") — this app already has two date display
// conventions, not one; this function now follows the owner's explicit instruction for comps
// specifically (mm/dd/yy) rather than the longer form those other modules use.
function fmtCompDate(iso) {
  return formatDateDisplay(iso) || null;
}

/** The party-field axis, labeled per comp type (NEW-7 amended): one shared pair of columns — the
 * party disposing/providing space or the asset, and the party acquiring/occupying it — wearing
 * three sets of clothes. Never six per-type columns: a name typed as a lease's Owner/Developer
 * and a land sale's Seller has to be the SAME suggestion pool for NEW-8's autocomplete, and a
 * fourth comp type later costs nothing this way. */
export function partyLabels(compType) {
  if (compType === "land") return { provider: "Seller", acquirer: "Buyer" };
  if (compType === "building_sale") return { provider: "Seller", acquirer: "Buyer/User" };
  return { provider: "Owner/Developer", acquirer: "Tenant" }; // lease, and the honest default
}

/** Ordered {key,label,value} rows for a comp — a field with no value is simply not in the
 * array, never rendered as an empty row or an em-dash. The list panel, the map popup and the
 * detail form all read this instead of re-deriving which fields apply per type. */
export function compFieldRows(comp) {
  const rows = [];
  const push = (key, label, value) => {
    if (value != null && value !== "") rows.push({ key, label, value });
  };

  // Party fields lead — they're facts about who the deal is BETWEEN, not its economics, so they
  // read right under the title rather than buried in the money block (NEW-7 amended).
  const { provider, acquirer } = partyLabels(comp?.compType);
  push("partyProvider", provider, comp?.partyProvider || null);
  push("partyAcquirer", acquirer, comp?.partyAcquirer || null);

  if (comp?.compType === "land") {
    const psf = landPricePerSf(comp);
    push("psf", "$/SF", psf != null ? fmtPsf(psf) : null);
    push("price", "Price", comp?.landPrice != null ? fmtMoney(comp.landPrice) : null);
    if (comp?.landSizeValue != null) {
      push("size", "Size", `${Number(comp.landSizeValue).toLocaleString()} ${comp.landSizeUnit === "sf" ? "SF" : "AC"}`);
    }
  } else if (comp?.compType === "building_sale") {
    const psf = buildingPricePerSf(comp);
    push("psf", "$/SF", psf != null ? fmtPsf(psf) : null);
    push("price", "Price", comp?.bldgPrice != null ? fmtMoney(comp.bldgPrice) : null);
    if (comp?.bldgSizeSf != null) push("size", "Building size", `${Number(comp.bldgSizeSf).toLocaleString()} SF`);
    // B986096-HARDENING-7 — Price/NOI/Cap are a triangle (any two determine the third; see
    // resolveCapTriangle), so by the time a comp is saved all three are populated whenever at
    // least two were ever known. Shown together, in the same order Michael specified them.
    if (comp?.bldgNoi != null) push("noi", "NOI", fmtMoney(comp.bldgNoi));
    if (comp?.bldgCapRate != null) push("capRate", "Cap rate", `${(Number(comp.bldgCapRate) * 100).toFixed(2)}%`);
  } else if (comp?.compType === "lease") {
    if (comp?.leaseRate != null) {
      const period = comp.leaseRatePeriod === "monthly" ? "/mo" : comp.leaseRatePeriod === "annual" ? "/yr" : "";
      const basis = comp.leaseRateExpense ? ` ${comp.leaseRateExpense.toUpperCase()}` : "";
      push("rate", "Rate", `$${Number(comp.leaseRate).toFixed(2)}/SF${period}${basis}`);
    }
    if (comp?.leaseSizeSf != null) push("size", "Leased SF", `${Number(comp.leaseSizeSf).toLocaleString()} SF`);
    const totalRent = leaseTotalAnnualRent(comp);
    // NEW-3: labeled FACE (never blended with an effective/net-of-abatement figure this app
    // doesn't compute — see the item for why) + NEW-5: whole-dollar currency, never a raw float.
    if (totalRent != null) push("totalRent", "Total annual rent (face)", fmtMoneyWhole(totalRent));
    if (comp?.leaseTi != null) push("ti", "TI allowance", `${fmtMoney(comp.leaseTi)}/SF`);
    if (comp?.leaseTerm) push("term", "Term", comp.leaseTerm);
    // NEW-2: free rent sits right next to Term, the field it belongs with.
    if (comp?.leaseFreeRentMonths != null) push("freeRent", "Free rent", `${Number(comp.leaseFreeRentMonths).toLocaleString()} mo`);
    // B986096 — annual rate escalation, a normal and materially-valuable part of an industrial
    // lease (it changes what the deal is worth over its term); has its own column rather than
    // being dropped into notes, matching every other structured lease term here.
    if (comp?.leaseEscalationPct != null) push("escalation", "Escalation", `${Number(comp.leaseEscalationPct).toLocaleString()}%/yr`);
    if (comp?.leaseCommencementDate) push("commencement", "Commencement", fmtCompDate(comp.leaseCommencementDate));
    const net = netEffectiveLeaseRate(comp);
    if (net != null) push("netEffective", "Net effective", `$${net.toFixed(2)}/SF/yr`);
  }

  push("date", "Date", fmtCompDate(comp?.compDate));
  push("notes", "Notes", comp?.notes || null);
  return rows;
}

/** Compact one-line label for a map marker / list row. */
export function compHeadline(comp) {
  if (comp?.compType === "land") {
    const psf = landPricePerSf(comp);
    return psf != null ? `${fmtPsf(psf)} land` : "Land comp";
  }
  if (comp?.compType === "building_sale") {
    const psf = buildingPricePerSf(comp);
    return psf != null ? `${fmtPsf(psf)} sale` : "Building sale";
  }
  if (comp?.compType === "lease") {
    if (comp?.leaseRate != null) {
      const period = comp.leaseRatePeriod === "monthly" ? "/mo" : "/yr";
      const basis = comp.leaseRateExpense ? ` ${comp.leaseRateExpense.toUpperCase()}` : "";
      return `$${Number(comp.leaseRate).toFixed(2)}/SF${period}${basis}`;
    }
    return "Lease comp";
  }
  return "Comp";
}

/* ---- validation for the create/edit form -------------------------------------------------- */

export function validateComp(draft) {
  const errors = [];
  if (!isCompType(draft?.compType)) errors.push("Pick a comp type.");
  if (!draft?.compDate) errors.push("Executed date is required.");
  if (!validAnchor(draft?.anchor)) errors.push("Drop a pin or select a parcel.");
  return errors;
}

/* ---- row <-> model, mirroring shared/pins/pinStore.js's rowToPin/pinToRow shape ---------- */

// numeric columns round-trip as JSON STRINGS over PostgREST (preserves precision) — Number()
// wrap on every read, matching the repo's existing food_visits.cost / .rating convention.
export function rowToComp(r) {
  return {
    id: r.id,
    userId: r.user_id,
    teamId: r.team_id || null,
    projectId: r.project_id || null,
    compType: r.comp_type,
    compDate: r.comp_date,
    leaseCommencementDate: r.lease_commencement_date || null,
    title: r.title || "",
    notes: r.notes || "",
    anchor: {
      kind: r.anchor_kind,
      lat: Number(r.lat),
      lon: Number(r.lon),
      county: r.county || null,
      parcelApn: r.parcel_apn || null,
      parcelGeom: r.parcel_geom || null,
      sitePlanOverlayId: r.site_plan_overlay_id || null,
      sitePlanPoint: r.site_plan_point || null,
    },
    landPrice: r.land_price != null ? Number(r.land_price) : null,
    landSizeValue: r.land_size_value != null ? Number(r.land_size_value) : null,
    landSizeUnit: r.land_size_unit || null,
    bldgPrice: r.bldg_price != null ? Number(r.bldg_price) : null,
    bldgSizeSf: r.bldg_size_sf != null ? Number(r.bldg_size_sf) : null,
    bldgNoi: r.bldg_noi != null ? Number(r.bldg_noi) : null,
    // Decimal fraction (0.0575), never a percentage number — see resolveCapTriangle's header.
    bldgCapRate: r.bldg_cap_rate != null ? Number(r.bldg_cap_rate) : null,
    leaseRate: r.lease_rate != null ? Number(r.lease_rate) : null,
    leaseRatePeriod: r.lease_rate_period || null,
    leaseRateExpense: r.lease_rate_expense || null,
    leaseTi: r.lease_ti != null ? Number(r.lease_ti) : null,
    leaseTerm: r.lease_term || null,
    leaseSizeSf: r.lease_size_sf != null ? Number(r.lease_size_sf) : null,
    leaseFreeRentMonths: r.lease_free_rent_months != null ? Number(r.lease_free_rent_months) : null,
    leaseEscalationPct: r.lease_escalation_pct != null ? Number(r.lease_escalation_pct) : null,
    partyProvider: r.comp_party_provider || null,
    partyAcquirer: r.comp_party_acquirer || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/* ---- draft <-> comp: the string-field shape every entry surface edits ------------------- */
// Moved here from CompsPanel.jsx (B849232/NEW-1) so the paste-grid (CompEntryGrid.jsx) and the
// single-comp edit form share ONE conversion instead of two copies that can drift. A "draft" is
// the form-string shape (every numeric field a string, so a controlled <input> never fights
// React over a NaN) — this module is the only place that decides how a draft becomes the typed
// `comp` shape `compToRow`/`validateComp` expect, and back.

/** A blank draft, optionally pre-filled from a just-picked map anchor (pin/parcel/site_plan). */
export function emptyDraft(anchor) {
  // B941152 — a parcel-anchored comp arrives with the acreage the map toolbar already computed
  // (`asm.totalAc`); land size defaults to LAND (the default comp type) rather than forcing a
  // re-type of the number already selected the parcels to get. Rounded to match the toolbar's
  // own 2-decimal display (66.17 AC in, 66.17 out).
  const landSizeValue = anchor?.acreageAc != null ? String(Math.round(anchor.acreageAc * 100) / 100) : "";
  return {
    compType: "land", compDate: "", leaseCommencementDate: "", title: "", notes: "", teamId: null, projectId: null,
    anchor: anchor || null,
    partyProvider: "", partyAcquirer: "",
    landPrice: "", landSizeValue, landSizeUnit: "ac",
    bldgPrice: "", bldgSizeSf: "", bldgNoi: "", bldgCapRate: "",
    // HARDENING-10 NEW-4 (owner: "an empty row must not pre-assert a basis") — Per/Basis used to
    // default to annual/NNN, so a genuinely untouched row displayed YR/NNN as if he'd chosen them.
    // A $7 NNN and a $7 gross are different deals; guessing the basis silently is worse than
    // leaving it blank and making him state it. Blank also correctly keeps the derived $/SF/yr
    // column dashed until a period is actually picked — that gate only works if "unset" is real.
    leaseRate: "", leaseRatePeriod: "", leaseRateExpense: "", leaseTi: "", leaseTerm: "", leaseSizeSf: "",
    leaseFreeRentMonths: "", leaseEscalationPct: "",
  };
}

// B986096-HARDENING-7 (owner rule, "lets add an option for cap on building sales") — three
// quantities where any two determine the third: cap = NOI / price. Building-sale comps only
// (land and lease are untouched — Michael scoped this to sales, "a ground lease can carry a cap
// but do not extend it without asking"). Cap rate is stored as a DECIMAL FRACTION internally
// (0.0575), rendered as a percentage (5.75%) — a DELIBERATE difference from `leaseEscalationPct`,
// which stores a raw percentage number (3.5) for its own unrelated reasons; the two conventions
// must never be read as interchangeable or "fixed" to match each other.
//
// Given fewer than two of {price, noi, capRate}, nothing is derivable. Given exactly two, the
// third is derived (and reported so, `derived: true`) — never overwriting what was actually
// typed. Given all three, nothing is derived; instead they are checked for disagreement (a
// rounded, brokered cap next to an exact price/NOI often won't reconcile to the last basis
// point) and a real mismatch is reported, never silently recomputed over.
const CAP_RATE_TOLERANCE = 0.0005; // 5 basis points — past ordinary rounding, a genuine mismatch.

export function resolveCapTriangle(obj) {
  const price = positiveNumber(obj?.bldgPrice);
  const noi = positiveNumber(obj?.bldgNoi);
  const capRate = positiveNumber(obj?.bldgCapRate);
  const givenCount = [price, noi, capRate].filter((v) => v != null).length;

  if (givenCount === 3) {
    const implied = noi / price;
    const disagreement = Math.abs(implied - capRate) > CAP_RATE_TOLERANCE
      ? { impliedCapRate: implied, statedCapRate: capRate }
      : null;
    return {
      price: { value: price, derived: false }, noi: { value: noi, derived: false },
      capRate: { value: capRate, derived: false }, disagreement,
    };
  }
  if (givenCount === 2) {
    if (price != null && noi != null) {
      return {
        price: { value: price, derived: false }, noi: { value: noi, derived: false },
        capRate: { value: noi / price, derived: true }, disagreement: null,
      };
    }
    if (price != null && capRate != null) {
      return {
        price: { value: price, derived: false }, noi: { value: price * capRate, derived: true },
        capRate: { value: capRate, derived: false }, disagreement: null,
      };
    }
    return {
      price: { value: noi / capRate, derived: true }, noi: { value: noi, derived: false },
      capRate: { value: capRate, derived: false }, disagreement: null,
    };
  }
  return {
    price: { value: price, derived: false }, noi: { value: noi, derived: false },
    capRate: { value: capRate, derived: false }, disagreement: null,
  };
}

// Draft (form strings) -> the numeric/typed shape lib/comps.js + compsStore.js expect.
//
// ⛔ B986096-HARDENING-7 — a building-sale draft's Price/NOI/Cap are resolved through
// `resolveCapTriangle` BEFORE numeric conversion (on the raw string draft `d`, not the already-
// converted comp being built) and the derived one is BACK-FILLED into the saved comp. This is
// what keeps `bldgPrice`/`bldgNoi`/`bldgCapRate` consistently all-populated-or-all-null once at
// least two are known — so a comp entered from NOI + Cap alone still has a real `bldgPrice`,
// which is what lets the pre-existing `buildingPricePerSf` (and the sheet's $/SF derived column)
// work unchanged for it, with zero knowledge of the triangle. `resolveCapTriangle` itself is
// called on the RAW draft so it can still tell which field the user left empty — calling it on
// the back-filled comp instead would see three populated numbers and report nothing as derived.
export function draftToComp(d) {
  const num = (v) => (v === "" || v == null ? null : Number(v));
  const tri = d.compType === "building_sale" ? resolveCapTriangle(d) : null;
  return {
    ...d,
    landPrice: num(d.landPrice), landSizeValue: num(d.landSizeValue),
    bldgPrice: tri ? tri.price.value : num(d.bldgPrice),
    bldgSizeSf: num(d.bldgSizeSf),
    bldgNoi: tri ? tri.noi.value : num(d.bldgNoi),
    bldgCapRate: tri ? tri.capRate.value : num(d.bldgCapRate),
    leaseRate: num(d.leaseRate), leaseTi: num(d.leaseTi), leaseSizeSf: num(d.leaseSizeSf),
    leaseFreeRentMonths: num(d.leaseFreeRentMonths), leaseEscalationPct: num(d.leaseEscalationPct),
    leaseCommencementDate: d.leaseCommencementDate || null,
  };
}

export function compToDraft(c) {
  const str = (v) => (v == null ? "" : String(v));
  return {
    id: c.id, compType: c.compType, compDate: c.compDate || "", leaseCommencementDate: c.leaseCommencementDate || "",
    title: c.title || "", notes: c.notes || "",
    teamId: c.teamId, projectId: c.projectId, anchor: c.anchor,
    partyProvider: c.partyProvider || "", partyAcquirer: c.partyAcquirer || "",
    landPrice: str(c.landPrice), landSizeValue: str(c.landSizeValue), landSizeUnit: c.landSizeUnit || "ac",
    bldgPrice: str(c.bldgPrice), bldgSizeSf: str(c.bldgSizeSf),
    bldgNoi: str(c.bldgNoi), bldgCapRate: str(c.bldgCapRate),
    leaseRate: str(c.leaseRate), leaseRatePeriod: c.leaseRatePeriod || "annual",
    leaseRateExpense: c.leaseRateExpense || "nnn", leaseTi: str(c.leaseTi), leaseTerm: c.leaseTerm || "",
    leaseSizeSf: str(c.leaseSizeSf), leaseFreeRentMonths: str(c.leaseFreeRentMonths),
    leaseEscalationPct: str(c.leaseEscalationPct),
  };
}

// NEVER includes user_id — the column default auth.uid() stamps the owner server-side, so a
// request can only ever write the signed-in user's rows (the pinStore.js pinToRow rule).
export function compToRow(comp) {
  return {
    comp_type: comp.compType,
    comp_date: comp.compDate,
    lease_commencement_date: comp.leaseCommencementDate || null,
    title: comp.title || null,
    notes: comp.notes || null,
    team_id: comp.teamId || null,
    project_id: comp.projectId || null,
    anchor_kind: comp.anchor?.kind,
    lat: comp.anchor?.lat,
    lon: comp.anchor?.lon,
    county: comp.anchor?.county || null,
    parcel_apn: comp.anchor?.parcelApn || null,
    parcel_geom: comp.anchor?.parcelGeom || null,
    site_plan_overlay_id: comp.anchor?.sitePlanOverlayId || null,
    site_plan_point: comp.anchor?.sitePlanPoint || null,
    land_price: comp.landPrice ?? null,
    land_size_value: comp.landSizeValue ?? null,
    land_size_unit: comp.landSizeUnit ?? null,
    bldg_price: comp.bldgPrice ?? null,
    bldg_size_sf: comp.bldgSizeSf ?? null,
    bldg_noi: comp.bldgNoi ?? null,
    bldg_cap_rate: comp.bldgCapRate ?? null,
    lease_rate: comp.leaseRate ?? null,
    lease_rate_period: comp.leaseRatePeriod ?? null,
    lease_rate_expense: comp.leaseRateExpense ?? null,
    lease_ti: comp.leaseTi ?? null,
    lease_term: comp.leaseTerm ?? null,
    lease_size_sf: comp.leaseSizeSf ?? null,
    lease_free_rent_months: comp.leaseFreeRentMonths ?? null,
    lease_escalation_pct: comp.leaseEscalationPct ?? null,
    comp_party_provider: comp.partyProvider || null,
    comp_party_acquirer: comp.partyAcquirer || null,
    updated_at: new Date().toISOString(),
  };
}
