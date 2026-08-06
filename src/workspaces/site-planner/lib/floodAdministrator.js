/* NEW-8 — NAME the governing floodplain administrator, and the FFE rule it implies.
 *
 * The Bain header reads "City of Houston · ETJ / City of Katy · edge only / Fort Bend County" —
 * three candidate authorities — while Buildability just prints "pads assumed at 144.8' FFE" with no
 * statement of which rule produced it. The rules differ MATERIALLY:
 *
 *   Fort Bend County          non-residential lowest floor = BFE + 2 ft (FDPR §5.02(c)/(e))
 *   City of Houston Ch. 19    500-yr WSE + 2 ft — in flat Fort Bend floodplain that commonly lands
 *                             1–2 ft HIGHER than the FBC number
 *
 * So "which entity administers the floodplain here" is not a label, it is the number. This module:
 *   (a) resolves the CANDIDATE administrators from the jurisdiction signals the app already has,
 *   (b) picks a governing one — and when more than one is genuinely in play, says so and selects
 *       the STRICTER (highest required FFE) DELIBERATELY rather than by whichever matched first,
 *   (c) BACK-SOLVES the implied BFE from an assumed FFE (144.8 implies BFE ≤ 142.8 under a +2 ft
 *       rule), so a reader can sanity-check the assumption against a FIRM panel.
 *
 * LOUD-FAILURE: an ambiguous set is never silently collapsed. `ambiguous:true` + the full candidate
 * list rides every result, so the panel can flag it instead of implying a settled answer.
 *
 * Pure. No React, no DOM, Node-testable.
 */

const num = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

/* A candidate administrator, as the panel names it. `kind` distinguishes how it applies:
 *   "primary"  the entity whose floodplain ordinance governs the site
 *   "etj"      an extraterritorial jurisdiction — the city's rules may or may not reach here
 *   "edge"     the site only touches this entity at an edge
 * Each carries the FFE rule it implies (basis + freeboard) so the comparison is apples-to-apples. */
export function administratorCandidates({ authorityId = null, county = null, cityLabel = null, etjLabel = null, edgeLabels = [], rules = {}, floodJurKey = null } = {}) {
  const out = [];
  const push = (rawKey, kind, label, reason) => {
    const key = ruleKeyFor(rawKey);
    if (!key || out.some((c) => c.key === key && c.kind === kind)) return;
    const rule = rules[key] || null;
    // A candidate with NO modeled rule still counts — "City of Katy touches the edge and we have no
    // floodplain rule for it" is exactly the kind of gap NEW-8 exists to surface. It is flagged
    // (`ruleModeled:false`), never dropped and never allowed to govern.
    out.push({ key, kind, label: label || (rule && rule.label) || rawKey, reason, rule, ruleModeled: !!rule, ffe: ffeSummary(rule) });
  };
  // The resolved drainage authority / floodplain rules key is the app's best single answer.
  if (floodJurKey) push(floodJurKey, "primary", null, "resolved floodplain rules for this site");
  if (authorityId && authorityId !== floodJurKey) push(authorityId, "primary", null, "resolved drainage authority");
  // The county always administers unincorporated land — it is a candidate wherever it is named.
  const countyKey = String(county || "").toLowerCase().replace(/\s+/g, "");
  if (countyKey && rules[countyKey]) push(countyKey, "primary", null, "county floodplain administrator");
  if (cityLabel) push(cityKey(cityLabel), "primary", cityLabel, "incorporated city limits");
  if (etjLabel) push(cityKey(etjLabel), "etj", `${etjLabel} (ETJ)`, "extraterritorial jurisdiction — confirm whether the city's floodplain ordinance reaches here");
  for (const e of edgeLabels || []) push(cityKey(e), "edge", `${e} (edge only)`, "the site only touches this entity at an edge");
  return out;
}

const cityKey = (label) => String(label || "").toLowerCase().replace(/^city of\s+/, "").replace(/\s+/g, "");

/* A place NAME and the rules-registry KEY for it are not the same string — "City of Houston" is the
 * `coh` record, "Fort Bend" is `fortbend`. Without this map an ETJ candidate silently vanishes
 * (it matched no rule) and the panel shows a settled single administrator over a genuinely
 * contested site — the exact false confidence NEW-8 is about. */
const RULE_KEY_ALIAS = {
  houston: "coh", cityofhouston: "coh", coh: "coh",
  fortbend: "fortbend", fortbendcounty: "fortbend",
  harris: "harris", harriscounty: "harris", hcfcd: "harris",
  montgomery: "montgomery", montgomerycounty: "montgomery",
  chambers: "chambers", chamberscounty: "chambers",
  waller: "waller", wallercounty: "waller",
  missouricity: "fortbend", magnolia: "montgomery",
};
export const ruleKeyFor = (k) => {
  const s = String(k || "").toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  return RULE_KEY_ALIAS[s] || s;
};

/* The FFE rule a jurisdiction record implies, as a comparable summary: which water surface it keys
 * to and how much freeboard rides on top. A multi-basis rule (Fort Bend's max-of-six) reports its
 * bases; the freeboard shown is the LARGEST, which is what a screening comparison should use. */
export function ffeSummary(rule) {
  if (!rule || !rule.ffeRule) return null;
  const r = rule.ffeRule;
  if (Array.isArray(r.bases) && r.bases.length) {
    const plus = Math.max(...r.bases.map((b) => num(b.plusFt) || 0));
    const bases = r.bases.map((b) => ({ basis: b.basis, plusFt: num(b.plusFt), label: b.label || b.basis, when: b.when || null }));
    return { kind: "max-of", bases, plusFt: plus, basis: bases.map((b) => b.basis), rule: `highest of ${bases.length} bases`, verified: rule.verified !== false };
  }
  return { kind: "single", bases: [{ basis: r.basis, plusFt: num(r.plusFt), label: r.basis }], plusFt: num(r.plusFt), basis: r.basis, rule: `${r.basis} + ${num(r.plusFt)} ft`, verified: rule.verified !== false };
}

/* NEW-8 — BACK-SOLVE the implied BFE from an assumed FFE. Under a "+plusFt above the flood surface"
 * rule, an FFE of 144.8 with 2 ft of freeboard implies the governing flood surface sits at or below
 * 142.8. That is a checkable claim: the reader can hold it against the FIRM panel and catch a bad
 * assumption immediately.
 *
 * Returns `{ impliedFloodElevFt, plusFt, basis, relation:"at-or-below" }` — the relation is
 * "at-or-below" and never "equals", because the FFE may have been set higher than the minimum. Pure. */
export function impliedFloodElevation({ ffeFt = null, ffe = null, plusFt = null } = {}) {
  const f = num(ffeFt);
  if (f == null) return null;
  const plus = num(plusFt) != null ? num(plusFt) : (ffe && num(ffe.plusFt) != null ? num(ffe.plusFt) : null);
  if (plus == null) return null;
  return {
    impliedFloodElevFt: f - plus,
    plusFt: plus,
    basis: ffe ? ffe.basis : null,
    relation: "at-or-below",
    note: `A finished floor of ${f.toFixed(1)}′ under a ${plus} ft freeboard rule implies the governing flood elevation is at or below ${(f - plus).toFixed(1)}′. Check that against the FIRM panel / FIS profile.`,
  };
}

/* Resolve WHO governs, from the candidate set. When more than one candidate is genuinely in play,
 * `ambiguous` is true and `governing` is the STRICTEST — the one implying the highest required FFE
 * at the supplied water surfaces. Choosing the stricter is a deliberate, stated act, not a default:
 * `selectionReason` records why.
 *
 * `requiredFfeAt` is an injected evaluator ({rule, key} → required FFE ft | null) so this module
 * stays free of buildability.js's input plumbing (the caller already owns the WSE bag). Without it
 * the strictest is picked by declared freeboard, which is the honest screening proxy. Pure. */
export function resolveAdministrator(candidates = [], { requiredFfeAt = null } = {}) {
  const list = (candidates || []).filter(Boolean);
  if (!list.length) return { governing: null, candidates: [], ambiguous: false, selectionReason: "no floodplain administrator resolved" };
  const scored = list.map((c) => {
    const ffeFt = typeof requiredFfeAt === "function" ? num(requiredFfeAt(c)) : null;
    return { ...c, requiredFfeFt: ffeFt, score: ffeFt != null ? ffeFt : (c.ffe && num(c.ffe.plusFt) != null ? num(c.ffe.plusFt) : -Infinity) };
  });
  // Only PRIMARY candidates WITH a modeled rule can govern outright; an ETJ, an edge-only touch, or
  // an unmodeled entity is a flag, not an administrator — unless it is the only thing we have.
  const primaries = scored.filter((c) => c.kind === "primary" && c.rule);
  const pool = primaries.length ? primaries : scored.filter((c) => c.rule).length ? scored.filter((c) => c.rule) : scored;
  const sorted = [...pool].sort((a, b) => b.score - a.score);
  const governing = sorted[0];
  // Ambiguity is about REAL disagreement: two candidates whose implied requirements differ, or a
  // live ETJ/edge overlay alongside the primary.
  const distinct = new Set(pool.map((c) => (c.score === -Infinity ? "?" : c.score.toFixed(2))));
  const overlays = scored.filter((c) => c.kind !== "primary");
  const ambiguous = pool.length > 1 && distinct.size > 1 ? true : overlays.length > 0;
  const strictestBy = typeof requiredFfeAt === "function" ? "required FFE" : "declared freeboard";
  /* ⛔ B209508 — RANKING BY FREEBOARD IS NOT RANKING BY ELEVATION, and when the BASES differ the two
   * can disagree. Without a `requiredFfeAt` resolver the score is each rule's declared freeboard, so
   * "the stricter standard was chosen" compares +2 ft against +2.5 ft — while the elevations those
   * sit on may be a 100-yr surface and a 500-yr surface. That is exactly the Bain trade: City of
   * Houston Ch. 19 is 500-yr WSE + 2 ft and commonly lands 1–2 ft HIGHER than Fort Bend's number
   * despite declaring LESS freeboard. Picking the bigger `plusFt` and calling it stricter is then a
   * confident wrong answer.
   *
   * So when the pool's top candidates rest on DIFFERENT bases and we had no elevation resolver, say
   * so. This does not change which candidate is chosen — it refuses to let the choice read as
   * settled on a comparison that was never actually made. */
  const basesOf = (c) => (c.ffe && Array.isArray(c.ffe.bases) ? c.ffe.bases.map((b) => b.basis) : []).filter(Boolean);
  /* Measured over EVERY scored candidate with a rule, not just the governing `pool`. The pool
   * excludes ETJ and edge candidates by design — and the ETJ is precisely the one whose basis
   * differs at Bain (Houston Ch. 19's 500-yr surface against Fort Bend's 100-yr set). Reading only
   * the pool would report "no mismatch" on the exact site that has one. */
  const withRules = scored.filter((c) => c.ffe);
  const allBases = new Set(withRules.flatMap(basesOf));
  const basisMismatch = strictestBy === "declared freeboard" && withRules.length > 1 && allBases.size > 1;
  return {
    governing,
    candidates: scored,
    overlays,
    ambiguous,
    comparedBy: strictestBy,
    basisMismatch,
    basisNote: basisMismatch
      ? "These authorities measure from DIFFERENT flood surfaces (e.g. a 100-yr vs a 500-yr water surface), and the comparison here is on declared freeboard only — the resulting elevations were not computed. A rule with less freeboard on a higher surface can still govern."
      : null,
    selectionReason: pool.length > 1 || overlays.length
      ? `${scored.length} candidate floodplain authorities are in play; the stricter standard was chosen deliberately (highest ${strictestBy}).`
      : "one floodplain administrator resolved.",
    // The spread the reader cares about: how much higher the strictest sits over the loosest.
    spreadFt: sorted.length > 1 && Number.isFinite(sorted[0].score) && Number.isFinite(sorted[sorted.length - 1].score)
      ? sorted[0].score - sorted[sorted.length - 1].score : null,
  };
}

/* ⛔ B209508 — AN UNKNOWN JURISDICTION INPUT IS A FIRST-CLASS STATE, NOT AN ABSENT CANDIDATE.
 *
 * This module already had the right instincts — `ambiguous:true`, never silently collapse, pick the
 * STRICTER rule deliberately. But it can only reason about candidates it is GIVEN, and a FAILED
 * jurisdiction lookup hands it silence. Silence reads as "no ETJ here", so the resolver settles on
 * the remaining candidate and reports a governing authority with full confidence.
 *
 * At Bain that is not a label. With the City of Houston ETJ missing, `etjLabel` is null, the Houston
 * candidate is never pushed, and the module settles on Fort Bend County:
 *
 *   Fort Bend County        non-residential lowest floor = BFE + 2 ft   (FDPR §5.02(c)/(e))
 *   City of Houston Ch. 19  500-yr WSE + 2 ft — in flat Fort Bend floodplain this commonly lands
 *                           1–2 ft HIGHER
 *
 * So a flaky ETJ lookup silently swaps the stricter rule for the laxer one and prints the result as
 * settled. On a site with two detention ponds that is finished floors 1–2 ft too low.
 *
 * `unresolvedRoles` (from `formatJurisdictionBadge`, which reads `identifyJurisdiction`'s per-role
 * source state) makes that missing input VISIBLE. When any role failed, the result is flagged
 * `unresolved` and the panel must not print a settled FFE — the governing candidate is still
 * computed and shown as provisional, because the reader still needs to know what we DID find. */
const ROLE_STAKES = {
  etj: "a city ETJ can impose a stricter floodplain rule than the county",
  city: "city limits decide whether a city ordinance governs at all",
  county: "the county is the default floodplain administrator",
};

export function assessAdministrator({ signals = {}, rules = {}, ffeFt = null, requiredFfeAt = null } = {}) {
  const candidates = administratorCandidates({ ...signals, rules });
  const resolved = resolveAdministrator(candidates, { requiredFfeAt });
  const gov = resolved.governing;
  const unresolvedRoles = (signals.unresolvedRoles || []).filter(Boolean);
  const unresolved = unresolvedRoles.length > 0;
  return {
    ...resolved,
    impliedFlood: impliedFloodElevation({ ffeFt, ffe: gov ? gov.ffe : null }),
    governingLabel: gov ? gov.label : null,
    governingRuleText: gov && gov.ffe ? gov.ffe.rule : null,
    governingSource: gov && gov.rule ? gov.rule.source : null,
    governingVerified: gov && gov.rule ? gov.rule.verified !== false : false,
    /* B209508 — the three fields a panel needs to refuse honestly. `settled` is the one a caller
     * should gate a printed FFE on: it is false whenever an input could not be checked, EVEN IF a
     * governing candidate resolved, because the candidate set itself is incomplete. */
    unresolved,
    unresolvedRoles,
    settled: !unresolved && !!gov,
    unresolvedNote: unresolved
      ? `Jurisdiction incomplete — ${unresolvedRoles.map((r) => `the ${r} lookup failed`).join(" and ")}. ` +
        `${unresolvedRoles.map((r) => ROLE_STAKES[r]).filter(Boolean).join("; ")}. ` +
        `The FFE rule is NOT settled: a stricter authority may apply that we could not check.`
      : null,
  };
}
