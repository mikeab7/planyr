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
export const ANCHOR_KINDS = ["pin", "parcel"];

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

/* ---- basis normalization for any list / average / sort / comparison view ---------------- */

/** Groups LEASE comps by their EXPENSE basis (NNN vs gross) after normalizing period to
 * annual. NNN and gross are never blended into one number — there is no honest conversion
 * between them without the underlying expense figures the app doesn't have, so blending them
 * would be exactly the "table that silently mixes monthly and annual figures" the owner ruled
 * out, just for the other axis. The default DISPLAY basis is annual NNN: the headline reads
 * the NNN group when any exist, falling back to gross, and always names which one it is
 * showing. A comp missing its rate or basis counts toward `unknownCount`, never toward either
 * average. */
export function summarizeLeaseComps(comps) {
  let nnnSum = 0, nnnCount = 0, grossSum = 0, grossCount = 0, unknownCount = 0;
  for (const c of comps || []) {
    if (c?.compType !== "lease") continue;
    const annual = annualLeaseRate(c);
    const basis = c?.leaseRateExpense;
    if (annual == null || (basis !== "nnn" && basis !== "gross")) { unknownCount++; continue; }
    if (basis === "nnn") { nnnSum += annual; nnnCount++; } else { grossSum += annual; grossCount++; }
  }
  const nnn = nnnCount ? { avg: nnnSum / nnnCount, count: nnnCount } : null;
  const gross = grossCount ? { avg: grossSum / grossCount, count: grossCount } : null;
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

/* ---- presentation: the ONE place that decides which fields render ----------------------- */

function fmtMoney(n) {
  return n == null ? null : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
function fmtPsf(n) {
  return n == null ? null : `$${n.toFixed(2)}/SF`;
}

/** Ordered {key,label,value} rows for a comp — a field with no value is simply not in the
 * array, never rendered as an empty row or an em-dash. The list panel, the map popup and the
 * detail form all read this instead of re-deriving which fields apply per type. */
export function compFieldRows(comp) {
  const rows = [];
  const push = (key, label, value) => {
    if (value != null && value !== "") rows.push({ key, label, value });
  };

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
    if (comp?.leaseTi != null) push("ti", "TI allowance", `${fmtMoney(comp.leaseTi)}/SF`);
    if (comp?.leaseTerm) push("term", "Term", comp.leaseTerm);
  }

  push("date", "Date", comp?.compDate || null);
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
    updated_at: new Date().toISOString(),
  };
}
