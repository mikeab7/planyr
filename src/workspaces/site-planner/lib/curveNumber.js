/* NEW-B1 — SCS / NRCS Curve-Number runoff method (screening). Turns a design-storm rainfall
 * DEPTH (from NOAA Atlas-14, Phase B) + the site's HYDROLOGIC SOIL GROUP (from SSURGO, Phase B)
 * + its impervious % into a runoff depth and volume — a soils-aware screening input to the
 * required-detention picture, beside the rate-method + Modified-Rational cross-checks.
 *
 * The method (TR-55):
 *   S  = 1000/CN − 10           (potential retention, inches)
 *   Q  = (P − 0.2S)² / (P + 0.8S)   for P > 0.2S, else 0   (runoff depth, inches)
 *   CN = a composite: impervious area at CN 98 blended with the pervious CN for the soil
 *        group + cover (area-weighted). Antecedent-moisture II (average).
 *
 * Screening only: real detention volume comes from a routed hydrograph, not a single-storm
 * runoff depth. LOUD-FAILURE: an unknown soil group / rainfall returns null (never a
 * fabricated CN or volume). Pure + Node-testable; no DOM/network. */

const SQFT_PER_ACRE = 43560;

export const HSG = ["A", "B", "C", "D"];
// Dual groups (A/D, B/D, C/D) — drained vs undrained. Screening takes the DRAINED (first)
// letter's number unless the seasonal-high water table says otherwise (groundwater.js).
export function normalizeHsg(group) {
  if (group == null) return null;
  const g = String(group).trim().toUpperCase();
  if (HSG.includes(g)) return g;
  const dual = g.match(/^([ABCD])\/D$/); // "A/D" → drained "A"
  if (dual) return dual[1];
  return null;
}

// Pervious runoff CN by hydrologic soil group for common screening covers (TR-55 Table 2-2a,
// AMC II). Industrial pervious / open space (good condition, >75% grass) is the default for a
// screening pad; row-crop / pasture cover an undeveloped pre-condition. Each row is [A,B,C,D].
export const COVER_CN = {
  openSpaceGood: { label: "Open space, good (>75% grass)", cn: [39, 61, 74, 80] },
  openSpaceFair: { label: "Open space, fair (50–75% grass)", cn: [49, 69, 79, 84] },
  pasture: { label: "Pasture / grassland, good", cn: [39, 61, 74, 80] },
  woods: { label: "Woods, good", cn: [30, 55, 70, 77] },
  rowCrop: { label: "Row crop, straight row, good", cn: [67, 78, 85, 89] },
  dirtCompacted: { label: "Newly graded / bare soil", cn: [77, 86, 91, 94] },
};
export const IMPERVIOUS_CN = 98; // paved / roof, TR-55

/* Pervious CN for a soil group + cover. Null when the group/cover is unknown. Pure. */
export function perviousCn(group, cover = "openSpaceGood") {
  const g = normalizeHsg(group);
  const row = COVER_CN[cover];
  if (!g || !row) return null;
  return row.cn[HSG.indexOf(g)];
}

/* Composite CN = area-weighted blend of impervious (CN 98) and pervious (soil+cover) area.
 * `impPct` 0–100. Returns { cn, perviousCn } or null when the soil group is unknown. Pure. */
export function compositeCn({ group, impPct, cover = "openSpaceGood" } = {}) {
  const pcn = perviousCn(group, cover);
  if (pcn == null || impPct == null || !Number.isFinite(impPct)) return null;
  const f = Math.max(0, Math.min(100, impPct)) / 100;
  return { cn: Math.round((f * IMPERVIOUS_CN + (1 - f) * pcn) * 10) / 10, perviousCn: pcn };
}

/* Runoff depth Q (inches) for a rainfall depth P (inches) at curve number CN (TR-55).
 * Returns 0 below the initial abstraction (P ≤ 0.2S), null on bad inputs. Pure. */
export function runoffDepthIn(rainfallIn, cn) {
  const P = Number(rainfallIn), n = Number(cn);
  if (!Number.isFinite(P) || P < 0 || !Number.isFinite(n) || n <= 0 || n > 100) return null;
  const S = 1000 / n - 10;
  if (P <= 0.2 * S) return 0;
  return Math.round(((P - 0.2 * S) ** 2 / (P + 0.8 * S)) * 1000) / 1000;
}

/* The screening runoff carrier: composite CN → runoff depth → runoff volume over the area.
 * Inputs: group (HSG), impPct, cover, rainfallIn (Atlas-14 depth for the design storm),
 * areaAcres. Returns { cn, perviousCn, runoffDepthIn, runoffVolumeCf, runoffVolumeAcFt,
 * rainfallIn, flags } or a null-bearing carrier with the reason flagged — never a fabricated
 * number. `preImpPct`/`preCover` optionally compute the PRE-development runoff for a
 * post-minus-pre "increase" (what detention must hold). Pure. */
export function screenRunoff({ group, impPct, cover = "openSpaceGood", rainfallIn, areaAcres, preImpPct = null, preCover = null } = {}) {
  const flags = [];
  const comp = compositeCn({ group, impPct, cover });
  if (comp == null) flags.push(normalizeHsg(group) ? "impervious-unknown" : "soil-group-unknown");
  if (rainfallIn == null || !Number.isFinite(rainfallIn)) flags.push("rainfall-unknown");
  if (!(areaAcres > 0)) flags.push("area-unknown");
  if (flags.length) {
    return { cn: comp?.cn ?? null, perviousCn: comp?.perviousCn ?? null, runoffDepthIn: null, runoffVolumeCf: null, runoffVolumeAcFt: null, rainfallIn: Number.isFinite(rainfallIn) ? rainfallIn : null, increaseAcFt: null, flags };
  }
  const q = runoffDepthIn(rainfallIn, comp.cn);
  const areaSf = areaAcres * SQFT_PER_ACRE;
  const volCf = (q / 12) * areaSf;
  let increaseAcFt = null;
  if (preImpPct != null && Number.isFinite(preImpPct)) {
    const preComp = compositeCn({ group, impPct: preImpPct, cover: preCover || "pasture" });
    if (preComp) {
      const preQ = runoffDepthIn(rainfallIn, preComp.cn);
      if (preQ != null) increaseAcFt = Math.round(Math.max(0, (q - preQ) / 12 * areaSf) / SQFT_PER_ACRE * 10000) / 10000;
    }
  }
  return {
    cn: comp.cn,
    perviousCn: comp.perviousCn,
    runoffDepthIn: q,
    runoffVolumeCf: Math.round(volCf),
    runoffVolumeAcFt: Math.round(volCf / SQFT_PER_ACRE * 10000) / 10000,
    rainfallIn,
    increaseAcFt,
    flags: [],
    caveat: "SCS Curve-Number screening — single-storm runoff depth, not a routed detention volume. Confirm with your engineer.",
  };
}
