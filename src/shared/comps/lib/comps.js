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

export const COMP_TYPES = ["land", "building_sale", "lease"];
export const LEASE_PERIODS = ["annual", "monthly"];
export const LEASE_EXPENSE_BASES = ["nnn", "gross"];
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
  // site_plan: a point pinned on an uploaded, georeferenced site plan (B848848) — lat/lon
  // above is the DERIVED, authoritative position; sitePlanOverlayId + sitePlanPoint (the
  // image-pixel point on that overlay) are the extra snapshot this anchor kind carries, the
  // same role parcelApn/parcelGeom play for 'parcel'.
  if (anchor.kind === "site_plan") {
    return !!(anchor.sitePlanOverlayId && anchor.sitePlanPoint &&
      typeof anchor.sitePlanPoint.x === "number" && typeof anchor.sitePlanPoint.y === "number");
  }
  return anchor.kind === "pin";
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

// A date-only ISO string ("2026-08-28") parsed as Y/M/D and re-rendered in the app's own
// read-view date convention (FileBrowser.jsx / SiteReviewModal.jsx / MapFinder.jsx all format a
// display date the same way) — NEW-6. Built from the parts, never `new Date(iso)` directly:
// comp_date carries no time, so parsing the bare ISO string as UTC and displaying it in a
// behind-UTC local zone would print the wrong day.
function fmtCompDate(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
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
  if (!draft?.compDate) errors.push("Date is required.");
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
    leaseRate: r.lease_rate != null ? Number(r.lease_rate) : null,
    leaseRatePeriod: r.lease_rate_period || null,
    leaseRateExpense: r.lease_rate_expense || null,
    leaseTi: r.lease_ti != null ? Number(r.lease_ti) : null,
    leaseTerm: r.lease_term || null,
    leaseSizeSf: r.lease_size_sf != null ? Number(r.lease_size_sf) : null,
    leaseFreeRentMonths: r.lease_free_rent_months != null ? Number(r.lease_free_rent_months) : null,
    partyProvider: r.comp_party_provider || null,
    partyAcquirer: r.comp_party_acquirer || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// NEVER includes user_id — the column default auth.uid() stamps the owner server-side, so a
// request can only ever write the signed-in user's rows (the pinStore.js pinToRow rule).
export function compToRow(comp) {
  return {
    comp_type: comp.compType,
    comp_date: comp.compDate,
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
    lease_rate: comp.leaseRate ?? null,
    lease_rate_period: comp.leaseRatePeriod ?? null,
    lease_rate_expense: comp.leaseRateExpense ?? null,
    lease_ti: comp.leaseTi ?? null,
    lease_term: comp.leaseTerm ?? null,
    lease_size_sf: comp.leaseSizeSf ?? null,
    lease_free_rent_months: comp.leaseFreeRentMonths ?? null,
    comp_party_provider: comp.partyProvider || null,
    comp_party_acquirer: comp.partyAcquirer || null,
    updated_at: new Date().toISOString(),
  };
}
