/* NEW-2 — DRAWDOWN TIME at the jurisdiction's allowable release rate.
 *
 * The Yield panel already prints the assumption "the pond recovers to normal tailwater between
 * storms (design storm not coincident with the flood); confirm the coincident-storm rule" — but it
 * gives the reader nothing to evaluate that assumption WITH. This module computes time-to-empty
 * from stored volume and the allowable release rate, per pond and site-wide, so the assumption can
 * be checked instead of taken on faith.
 *
 * Worked example the regression test pins (Bain / Concept A, FBCDD Sec 6 max release 0.125 cfs/ac):
 *   0.125 cfs/ac × 80.34 ac              = 10.04 cfs
 *   150.9 ac-ft × 43,560                 = 6,573,204 cf
 *   6,573,204 / 10.04                    = 654,701 s = 7.6 days
 *   the full 206.3 ac-ft                 = 10.4 days
 *
 * ⚠ This is deliberately the OPTIMISTIC bound. Real outflow through an orifice decays as head
 * drops (Q ∝ √h), so the true drawdown is LONGER than the constant-rate figure — never shorter.
 * Every result carries `optimistic:true` and the copy says so; the number is a floor on the answer,
 * which is exactly what you want for a screen that flags "this takes too long".
 *
 * Why it matters beyond tidiness: a multi-day drawdown is what invalidates the recovery assumption
 * above, and it is also what makes a SHARED detention/mitigation pond fail FBC §5.02(h)(1)'s "full
 * capacity available for subsequent flood events" test — the pond is still full when the next storm
 * arrives.
 *
 * Pure: cubic feet + cfs in, hours out. No React, no DOM, Node-testable.
 */

const CF_PER_ACFT = 43560;
const SEC_PER_HR = 3600;
// The screening threshold a drawdown is flagged against. 72 hr is the default the panel ships with
// (a common criteria-manual maximum); a jurisdiction record's own `drawdownMaxHr` overrides it.
export const DEFAULT_DRAWDOWN_MAX_HR = 72;

/* The site's ALLOWABLE RELEASE, from the jurisdiction's rate criterion. FBCDD Drainage Criteria
 * Manual Sec 6: max release 0.125 cfs/ac in the 100-yr. An explicit `overrideCfs` (a modeled outlet
 * rating, or the user's entry) always wins. Returns null when neither is resolvable — the caller
 * must say "release rate not set", never assume one. Pure. */
export function allowableReleaseCfs({ rateCfsPerAc = null, acres = null, overrideCfs = null } = {}) {
  const ov = num(overrideCfs);
  if (ov != null && ov > 0) return { cfs: ov, basis: "outlet", rateCfsPerAc: null, acres: num(acres) };
  const rate = num(rateCfsPerAc), ac = num(acres);
  if (rate == null || rate <= 0 || ac == null || ac <= 0) return null;
  return { cfs: rate * ac, basis: "rate", rateCfsPerAc: rate, acres: ac };
}

/* Time to empty `volumeCf` at a constant `releaseCfs`. Null when either input is unusable — never
 * a zero (a zero would read as "drains instantly", the exact opposite of the truth). Pure. */
export function drawdownHours({ volumeCf = null, releaseCfs = null } = {}) {
  const v = num(volumeCf), q = num(releaseCfs);
  if (v == null || v < 0 || q == null || q <= 0) return null;
  return v / q / SEC_PER_HR;
}

/* Band a drawdown time against the threshold:
 *   "ok"    ≤ threshold
 *   "amber" over the threshold but under twice it — over the criterion, not yet a multi-day stall
 *   "red"   ≥ twice the threshold — the recovery assumption is not credible at this rate
 * Pure. */
export function drawdownTone(hours, maxHr = DEFAULT_DRAWDOWN_MAX_HR) {
  if (hours == null || !Number.isFinite(hours)) return null;
  if (hours <= maxHr) return "ok";
  return hours >= maxHr * 2 ? "red" : "amber";
}

/* Format hours the way the panel says it out loud: hours under a day, days above. Deliberately no
 * unit-free numbers — "7.6 days" is the readable form of 654,701 seconds. Pure. */
export function fmtDrawdown(hours) {
  if (hours == null || !Number.isFinite(hours)) return null;
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hr`;
  const d = hours / 24;
  return `${d < 10 ? d.toFixed(1) : Math.round(d)} days`;
}

/* The full assessment: per pond AND site-wide.
 *
 *   ponds        [{ id, name, volumeCf }]  — the volume each pond has to release
 *   siteVolumeCf                            — the site volume the drawdown is quoted on (the
 *                                             COUNTED detention by default; pass the physical total
 *                                             to answer "and how long to empty everything?")
 *   release      allowableReleaseCfs() result (or null)
 *   maxHr        the flag threshold (jurisdiction `drawdownMaxHr`, else the 72 hr default)
 *   siteShareRelease  true (default) → each pond's share of the site release is prorated by its
 *                     volume, which is the honest screening read for a site whose TOTAL release is
 *                     capped per acre (the ponds discharge into one capped outfall, not one cap
 *                     each). false → each pond is quoted the full site release.
 *
 * Returns { known, releaseCfs, maxHr, site: {...}, ponds: [...], optimistic:true, note } — or a
 * `known:false` payload naming what is missing. Pure. */
export function assessDrawdown({ ponds = [], siteVolumeCf = null, release = null, maxHr = DEFAULT_DRAWDOWN_MAX_HR, siteShareRelease = true } = {}) {
  const q = release && num(release.cfs) > 0 ? release.cfs : null;
  const threshold = num(maxHr) && num(maxHr) > 0 ? num(maxHr) : DEFAULT_DRAWDOWN_MAX_HR;
  if (q == null) {
    return {
      known: false, releaseCfs: null, maxHr: threshold, site: null, ponds: [], optimistic: true,
      reason: "allowable release rate not set — enter the jurisdiction's release rate (or the pond's outlet capacity) to screen drawdown time.",
    };
  }
  const totalPondCf = ponds.reduce((s, p) => s + (num(p.volumeCf) || 0), 0);
  const rows = ponds.map((p) => {
    const v = num(p.volumeCf);
    // Prorate the capped site release across the ponds by stored volume: N ponds sharing one
    // capped outfall do not each get the full site rate.
    const share = siteShareRelease && totalPondCf > 0 && v != null ? (v / totalPondCf) * q : q;
    const hours = drawdownHours({ volumeCf: v, releaseCfs: share });
    return {
      id: p.id ?? null, name: p.name ?? null, volumeCf: v,
      releaseCfs: share, hours, days: hours == null ? null : hours / 24,
      tone: drawdownTone(hours, threshold), label: fmtDrawdown(hours),
    };
  });
  const sv = num(siteVolumeCf) != null ? num(siteVolumeCf) : totalPondCf;
  const siteHours = drawdownHours({ volumeCf: sv, releaseCfs: q });
  return {
    known: true,
    releaseCfs: q,
    releaseBasis: release.basis,
    rateCfsPerAc: release.rateCfsPerAc ?? null,
    acres: release.acres ?? null,
    maxHr: threshold,
    optimistic: true,
    site: {
      volumeCf: sv, volumeAcFt: sv / CF_PER_ACFT, releaseCfs: q,
      hours: siteHours, days: siteHours == null ? null : siteHours / 24,
      tone: drawdownTone(siteHours, threshold), label: fmtDrawdown(siteHours),
    },
    ponds: rows,
    worstTone: worst([...rows.map((r) => r.tone), drawdownTone(siteHours, threshold)]),
    note: "Optimistic bound: outflow decays as the water level drops, so the real drawdown is longer than this constant-rate figure.",
  };
}

const TONE_RANK = { ok: 0, amber: 1, red: 2 };
const worst = (tones) => tones.filter(Boolean).sort((a, b) => TONE_RANK[b] - TONE_RANK[a])[0] || null;
const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
