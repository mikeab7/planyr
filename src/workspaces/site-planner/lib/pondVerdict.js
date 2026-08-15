/* NEW-1 / NEW-2 (pond-inspector verdict rows) — the ONE derivation of the pond
 * inspector's DETENTION + MITIGATION verdict strings (heading / sub-line / qualifier /
 * tone). Pure — no React, no DOM, no fetch; SitePlanner owns the context and memos and
 * only feeds this module already-resolved facts.
 *
 * WHY IT EXISTS (NEW-1): the detention row used to headline the BUILDABILITY answer
 * ("Buildable") over a VOLUME sub-line ("150.9 of 76.7 ac-ft"), so one row answered two
 * different questions and NOTHING on it named its own ledger — the only cue that the row
 * was about detention was the acre-feet unit. Worse, "buildable" is overloaded in this
 * product: to a developer it means land you can put a building on, measured in ACRES. So:
 *   • the HEADING always names the ledger and its verdict — "Detention covered" /
 *     "Detention short 4.6 ac-ft" / "Detention not achievable here" — symmetric with the
 *     mitigation row directly below it;
 *   • the buildability answer is NOT deleted (it is real and load-bearing: floodway hard
 *     stops, the no-rise certification, fill-to-elevate) — it is DEMOTED to its own
 *     qualifier line ("Buildable — no-rise certification required"), with the caller's
 *     plain-English body copy unchanged underneath it.
 *
 * WHY IT EXISTS (NEW-2): the detention row had only three tones (amber / short / ok), so a
 * pond providing ~2× the requirement rendered as a clean green pass — visually identical to
 * one sized exactly to requirement, with nothing saying the owner is paying to move dirt
 * that buys him nothing. `overdugAcFt` + `overProvision` add that state.
 *
 * AUDIT-FIRST note (recorded because it contradicts the brief): the site-level MITIGATION
 * ledger's LOUD over-dug state (B834) was deliberately RETIRED by a later session — the
 * Yield balance row now reads a quiet green "covered" for a surplus plus a separate
 * efficiency note, on the rule that "a surplus must never out-shout a real shortfall"
 * (yieldBar.js `stormwaterBarSpecs`, SitePlanner's mit-balance row, printSheet parity). This
 * module therefore keeps the detention HEADING green when the requirement is met and puts
 * the over-provision in a WARN-toned QUALIFIER beneath it: loud enough to see, never louder
 * than a shortfall — and it keeps the card's tone `ok`, which matters because the panel
 * hangs its single ⚡ Optimize pond button on the first non-ok card (an over-provided pond
 * must not offer a shortfall solver).
 */

const AC_FT = 43560;
const CF_PER_CY = 27;
const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);
const f0 = (n) => Math.round(n).toLocaleString("en-US");

/* The over-provision slack: how far past the requirement is normal freeboard-and-rounding
 * headroom rather than waste. `slackAcFt` / `slackPct` come from the jurisdiction criteria
 * registry (detentionCriteria.js `overdugSlackAcFt` / `overdugSlackPct`) — NEVER an inline
 * constant at a call site. The fallbacks here match the shipped site-level mitigation rule
 * (required + max(1 ac-ft, 10%)) so the two ledgers can't disagree by default. Pure. */
export const OVERDUG_SLACK_FALLBACK = { slackAcFt: 1, slackPct: 10 };

export function overdugAcFt(providedAcFt, requiredAcFt, { slackAcFt = 1, slackPct = 10 } = {}) {
  if (!Number.isFinite(providedAcFt) || !Number.isFinite(requiredAcFt)) return 0;
  const a = Number.isFinite(slackAcFt) ? Math.max(0, slackAcFt) : 0;
  const p = Number.isFinite(slackPct) ? Math.max(0, slackPct) : 0;
  return Math.max(0, providedAcFt - requiredAcFt - Math.max(a, requiredAcFt * (p / 100)));
}

/* Screening dirt + money for an over-provided ledger. The volume→cut ratio is the SAME 1:1
 * screening convention the shipped ledger-balancer shrink move uses (1 ac-ft of storage =
 * 1 ac-ft of cut) — stated in `basis`, never hidden. LOUD-FAILURE: with no $/CY entered,
 * `costUsd` is null and the caller shows volume only — a cost is NEVER fabricated. Pure. */
export function overProvision(overAcFt, { earthPerCy = null } = {}) {
  if (!Number.isFinite(overAcFt) || overAcFt <= 0) return null;
  const cy = (overAcFt * AC_FT) / CF_PER_CY;
  const price = Number.isFinite(earthPerCy) && earthPerCy > 0 ? earthPerCy : null;
  const costUsd = price != null ? cy * price : null;
  return {
    overAcFt,
    cy,
    costUsd,
    text: `Over by ~${f1(overAcFt)} AC-FT — about ${f0(cy)} CY of excavation that buys no detention credit${costUsd != null ? ` (~$${f0(costUsd)} at your $/CY)` : ""}.`,
    basis: `Screening: 1 ac-ft of storage = 1 ac-ft of cut, the same convention the ledger balancer's shrink moves use. ${costUsd != null ? "Priced at the Earthwork card's $/CY unit price." : "Enter a $/CY unit price in Yield → Costs → Earthwork to see this as a dollar figure."}`,
  };
}

/* The DETENTION verdict row.
 *
 * BASIS (NEW-2's blocking basis check, resolved by reading the call site): `providedAcFt`
 * and `requiredAcFt` are the SITE-WIDE pair — the same usable-provided total and the same
 * site requirement the Yield verdict shows — not this pond alone. So the over-provision
 * delta is computed on that same site basis, which is exactly why a single large basin on a
 * multi-pond site can NOT false-flag: every other pond's storage is already inside
 * `providedAcFt`. `basisNote` says so on the row's hover, so the pair is never mistaken for
 * a per-pond figure.
 *
 * Inputs: { providedAcFt, requiredAcFt, hardBlocked, needsNoRise, slack, earthPerCy }.
 * Returns { kind, short, over, overAcFt, tone, heading, subline, qualifier } where
 * `qualifier` is { text, tone, title } | null. `tone` preserves the shipped behavior —
 * amber whenever the design is not buildable or carries an outstanding requirement, short
 * (danger) on a real shortfall, ok otherwise — an over-provision never changes it. */
export function detentionVerdict({
  providedAcFt,
  requiredAcFt,
  hardBlocked = false,
  needsNoRise = false,
  slack = null,
  earthPerCy = null,
} = {}) {
  const prov = Number.isFinite(providedAcFt) ? providedAcFt : null;
  const req = Number.isFinite(requiredAcFt) ? requiredAcFt : null;
  const short = prov != null && req != null && prov < req - 0.005;
  const shortByAcFt = short ? req - prov : 0;
  const amber = !!hardBlocked || !!needsNoRise;
  const over = !short && !hardBlocked && prov != null && req != null
    ? overdugAcFt(prov, req, slack || OVERDUG_SLACK_FALLBACK)
    : 0;
  const heading = hardBlocked
    ? (short ? "Detention not achievable here" : "Detention volume met — not buildable as drawn")
    : short
      ? `Detention short ${f1(shortByAcFt)} AC-FT`
      : "Detention covered";
  const subline = prov == null || req == null
    ? null
    : `${f1(prov)} of ${f1(req)} AC-FT${hardBlocked && short ? " achievable" : ""}`;
  // The buildability answer, DEMOTED off the headline but never deleted. The caller's body
  // copy (the floodway / no-rise gloss, the below-flood-level explanation) still renders
  // underneath — this line is the one-glance version of it.
  let qualifier = null;
  if (hardBlocked) {
    qualifier = { text: "Not buildable as drawn — see below", tone: "amber", title: "A hard physical limit blocks this design: the rim sits above what the site can drain into by gravity, or the outlet sits below the 100-yr receiving water. The options for making it buildable are spelled out below." };
  } else if (needsNoRise) {
    qualifier = { text: "Buildable — no-rise certification required", tone: "amber", title: "Berming inside a mapped regulatory floodway is allowed with a no-rise certification: an engineer's study showing the berm adds zero rise to the 100-yr flood level." };
  } else {
    const op = overProvision(over, { earthPerCy });
    if (op) qualifier = { text: op.text, tone: "warn", title: op.basis, over: op };
  }
  return {
    kind: "detention",
    short,
    shortByAcFt,
    over: over > 0,
    overAcFt: over,
    tone: amber ? "amber" : short ? "short" : "ok",
    heading,
    subline,
    qualifier,
    basisNote: "Site-wide: the whole plan's detention ledger (every pond's usable storage against the site requirement), the same pair the Yield verdict shows — not this pond alone.",
  };
}

/* The MITIGATION verdict row — already the correct pattern before NEW-1 (it names its
 * ledger and its verdict); routed through this module so the two rows can only ever be
 * changed together. A mitigation surplus stays deliberately quiet (the retired-over-dug
 * rule above): compensating storage past the requirement is not the developer's dirt
 * decision the detention row's over-provision is. */
export function mitigationVerdict({ providedAcFt, requiredAcFt } = {}) {
  const prov = Number.isFinite(providedAcFt) ? providedAcFt : null;
  const req = Number.isFinite(requiredAcFt) ? requiredAcFt : null;
  const short = prov != null && req != null && prov < req - 0.005;
  return {
    kind: "mitigation",
    short,
    tone: short ? "short" : "ok",
    // Unchanged wording (the brief holds this row up as the correct pattern) — only its
    // derivation moved here, so the two rows can never drift apart again.
    heading: short ? "Mitigation short" : "Mitigation covered",
    subline: prov == null || req == null ? null : `${f1(prov)} of ${f1(req)} AC-FT`,
    qualifier: null,
  };
}
