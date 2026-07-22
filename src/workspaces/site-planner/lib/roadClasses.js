/* lib/roadClasses.js — road design classes + civil thresholds (B599 / NEW-4).
 *
 * A road element carries a `roadClass` key. Each class seeds (a) the default Arc radius a
 * NEW vertex gets and (b) a minimum-radius WARNING threshold for the non-blocking civil
 * check. The seeds below are BALLPARK starting points to verify against current AASHTO /
 * adopted local fire code — none is authoritative or hard-wired into the math; every value
 * is user-editable in Setup → Roads (settings.roadClasses) and per-plan.
 *
 * Pure (no React) so the formulae are unit-testable. */

/* AASHTO minimum curve radius (ft) for a design speed:  R = V² / [15 (e + f)]
 *   V — design speed (mph), e — superelevation rate, f — side-friction factor.
 * The speed-based class (public / collector) computes its threshold from this. */
export function speedMinRadius(V, e = 0.06, f = 0.165) {
  const v = +V || 0;
  const denom = 15 * ((+e || 0) + (+f || 0));
  return denom > 0 && v > 0 ? (v * v) / denom : 0;
}

/* The seed classes. `defaultRadius` = default Arc radius for a new vertex; `minRadius` =
 * the warn-below threshold (ft); a class with `designSpeed` derives its threshold from the
 * speed formula instead. `custom` carries no threshold (0 = never warn). */
export const ROAD_CLASS_SEEDS = [
  // Truck route (WB-67 controlling): generous default; warn below ~50′ (WB-67 design
  // turning radius ≈45′ — verify vs. the current AASHTO turning template).
  { key: "truck",  label: "Truck route",      defaultRadius: 120, minRadius: 50 },
  // Auto drive aisle (passenger car): small default; warn below ~24′ (P-car outer ≈24′).
  { key: "aisle",  label: "Auto drive aisle", defaultRadius: 25,  minRadius: 24 },
  // Public / collector: speed-based — threshold from R = V²/[15(e+f)] (≈185′ at 25 mph).
  { key: "public", label: "Public / collector", defaultRadius: 150, designSpeed: 25, superE: 0.06, friction: 0.165 },
  // Fire lane: warn below the local inside-radius requirement (commonly ~28′ inside per
  // IFC Appendix D — jurisdiction-specific; verify the adopted code).
  { key: "fire",   label: "Fire lane",        defaultRadius: 50,  minRadius: 28 },
  // Custom: no threshold (the civil check is silent).
  { key: "custom", label: "Custom",           defaultRadius: 50,  minRadius: 0 },
];

// A drawn road defaults to a drive aisle — the most common on-site road; a straight road
// has infinite radius so the check stays silent until a genuinely tight curve is drawn.
export const DEFAULT_ROAD_CLASS = "aisle";

/* The class list for a site: per-plan `settings.roadClasses` overrides the seeds; falls
 * back to the seeds when unset (so existing sites work unchanged). */
export function roadClassesOf(settings) {
  const list = settings && Array.isArray(settings.roadClasses) ? settings.roadClasses : null;
  return list && list.length ? list : ROAD_CLASS_SEEDS;
}

/* Look up one class config by key (falls back to the default class, then the first). */
export function roadClassOf(settings, key) {
  const list = roadClassesOf(settings);
  return (
    list.find((c) => c && c.key === key) ||
    list.find((c) => c && c.key === DEFAULT_ROAD_CLASS) ||
    list[0]
  );
}

/* The warn-below threshold (ft) for a class config: a speed-based class computes it from
 * the design speed; everything else uses the stored minRadius. 0 = no threshold. */
export function classMinRadius(cls) {
  if (!cls) return 0;
  if (cls.designSpeed) return speedMinRadius(cls.designSpeed, cls.superE, cls.friction);
  return +cls.minRadius || 0;
}

/* The default Arc radius (ft) a NEW vertex on this class gets. */
export function classDefaultRadius(cls) {
  return cls && +cls.defaultRadius > 0 ? +cls.defaultRadius : 50;
}

/* Curb-return radius seed (ft) for a road teeing into another (B953/NEW-1). Reuses the class
 * min turning radius, clamped to a sane curb-return band: auto aisle ≈ 24, fire ≈ 28, truck ≈ 50,
 * a speed-based/public class clamps to 75, and Custom (no threshold) → 25. Editable per junction. */
export function classReturnRadius(cls) {
  const m = classMinRadius(cls);
  const r = m > 0 ? m : 25;
  return Math.max(15, Math.min(75, r));
}
