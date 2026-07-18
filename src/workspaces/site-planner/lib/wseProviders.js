/* B881 (scope note 2) — the pluggable ESTIMATED-WSE provider registry.
 *
 * For a FEMA Zone A / unstudied "no published BFE" location, several sources can estimate the
 * flood water surface, and they have an explicit PRECEDENCE per location. This module is the
 * ONE place that precedence + provenance lives, so adding a future local district is a
 * registry entry, not a new code path.
 *
 * Precedence (highest → lowest):
 *   1. LOCAL DISTRICT model data where published, per county —
 *        • Harris:    HCFCD MAAPnext model  (often HIGHER than effective FIRM and enforced by
 *                     Harris-area reviewers, so it outranks EBFE and effective-style data)
 *        • Fort Bend: FBCDD Atlas-14 watershed study (DRAFT)
 *      (Montgomery / Brazoria / Galveston: viewer-only today — left as registry room, not wired.)
 *   2. FEMA / USGS InFRM EBFE (Base Level Engineering) — regional screening estimate (Region 6).
 *   3. GRADE-based estimate — ground elevation along the mapped Zone A boundary (last resort).
 *
 * The winning source is NAMED in the provenance label. Everything is SCREENING language — an
 * estimate, never a regulatory/published BFE; a sealed H&H study + the reviewing agency set the
 * final value. This module changes no downstream formula: it only chooses the estimated-WSE
 * INPUT + its provenance, and (for the "challenge" layer) reports cross-provider disagreement.
 *
 * Pure — no I/O. The SitePlanner drainage check does the actual per-provider fetches (each
 * gated to its county) and passes the candidate values here to resolve. */
import { compareEstimates } from "./estimateChallenge.js";

// Provider metadata. `tier` orders precedence within the resolver; `county` gates a district
// provider to where it publishes. `wse1pctSrc` is the bfeSrc tag the ghost writes when its
// estimate is accepted (all are "est-*" estimate tags — uniformly labeled downstream);
// `wse02Src` is the source tag for the 0.2% fill (a derived, non-accept-gated seam).
export const WSE_PROVIDERS = [
  {
    id: "maapnext", key: "maapnext", tier: "district", county: /harris/i,
    label: "HCFCD MAAPnext model",
    wse1pctSrc: "est-maapnext", wse02Src: "maapnext-wse02",
  },
  {
    id: "fbcdd", key: "fbcdd", tier: "district", county: /fort\s*bend/i,
    label: "FBCDD Atlas-14 study (DRAFT)",
    wse1pctSrc: "est-fbcdd", wse02Src: "fbcdd-wse02-draft",
  },
  {
    // id is the public/provenance id; `key` is the candidate-object key the caller passes.
    id: "fema-ebfe", key: "ebfe", tier: "ebfe", county: null,
    label: "FEMA InFRM BLE (screening estimate)",
    wse1pctSrc: "est-ebfe", wse02Src: "ebfe-wse02",
  },
  {
    id: "grade", key: "grade", tier: "grade", county: null,
    label: "grade estimate (Zone A boundary)",
    wse1pctSrc: "est-boundary-grade", wse02Src: null,
  },
];

export const wseProviderMeta = (id) => WSE_PROVIDERS.find((p) => p.id === id) || null;

const countyMatches = (re, county) => !re || (county || []).some((c) => re.test(String(c)));
const fin = (v) => (v != null && Number.isFinite(v) ? v : null);

/* Resolve the estimated WSE for a location from the candidate values, by precedence.
 *   county     — the identify county list (e.g. ["Harris County"]); gates district providers.
 *   candidates — { maapnext:{wse1pctFt,wse02Ft}|null, fbcdd:{...}|null, ebfe:{...}|null,
 *                 grade:{wseFt}|null }. A district value is only considered where its county
 *                 gate matches (the samplers already only run in-county; this is the guard).
 * Returns null when nothing is available, else:
 *   { wse1pctFt, wse1pctProviderId, wse1pctLabel, wse1pctSrc,
 *     wse02Ft, wse02ProviderId, wse02Label, wse02Src,
 *     ordered: [{ id, label, tier, wse1pctFt, wse02Ft }],   (precedence order, available only)
 *     disagreement }   — the winner-vs-runner-up 1% disagreement (challenge layer, cross-provider)
 * Pure. */
export function resolveEstimatedWse({ county = [], candidates = {} } = {}) {
  const ordered = [];
  for (const p of WSE_PROVIDERS) {
    if (!countyMatches(p.county, county)) continue;
    const c = candidates[p.key];
    if (!c) continue;
    const wse1pctFt = p.id === "grade" ? fin(c.wseFt) : fin(c.wse1pctFt);
    const wse02Ft = p.id === "grade" ? null : fin(c.wse02Ft);
    if (wse1pctFt == null && wse02Ft == null) continue;
    ordered.push({ id: p.id, label: p.label, tier: p.tier, wse1pctFt, wse02Ft, meta: p });
  }
  if (!ordered.length) return null;

  const win1 = ordered.find((e) => e.wse1pctFt != null) || null;
  const win02 = ordered.find((e) => e.wse02Ft != null) || null;
  if (!win1 && !win02) return null;

  // Cross-provider disagreement: the winning 1% vs the next-highest-precedence provider that
  // ALSO offers a 1% value. Disagreement is itself the challenge signal (show both + delta).
  let disagreement = null;
  if (win1) {
    const runnerUp = ordered.find((e) => e !== win1 && e.wse1pctFt != null) || null;
    if (runnerUp) {
      const cmp = compareEstimates({ ebfeFt: win1.wse1pctFt, gradeFt: runnerUp.wse1pctFt });
      disagreement = {
        ...cmp,
        winner: { id: win1.id, label: win1.label, wseFt: win1.wse1pctFt },
        other: { id: runnerUp.id, label: runnerUp.label, wseFt: runnerUp.wse1pctFt },
      };
    }
  }

  return {
    wse1pctFt: win1 ? win1.wse1pctFt : null,
    wse1pctProviderId: win1 ? win1.id : null,
    wse1pctLabel: win1 ? win1.label : null,
    wse1pctSrc: win1 ? win1.meta.wse1pctSrc : null,
    wse02Ft: win02 ? win02.wse02Ft : null,
    wse02ProviderId: win02 ? win02.id : null,
    wse02Label: win02 ? win02.label : null,
    wse02Src: win02 ? win02.meta.wse02Src : null,
    ordered: ordered.map(({ meta, ...rest }) => rest), // drop the meta ref from the public shape
    disagreement,
  };
}
