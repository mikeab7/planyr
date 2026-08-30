/* Per-jurisdiction utility-easement rules (required easement width over a public
 * main). EDITABLE and seeded with PLACEHOLDERS clearly marked "verify" — these
 * are NOT authoritative values. Each jurisdiction's real requirement lives in its
 * design manual / utility criteria; the user confirms and edits here. Stored in
 * localStorage so edits persist per device.
 */
import { normCountyKey } from "../../../shared/gis/countyKeys.js";

const LS = "planarfit:easementRules:v1";

export const DEFAULT_EASEMENT_RULES = {
  coh:        { label: "City of Houston",   waterWidth: 20, verified: false, note: "Placeholder — VERIFY against COH Infrastructure Design Manual / Public Works." },
  harris_mud: { label: "Harris County MUD", waterWidth: 20, verified: false, note: "Placeholder — varies by district; VERIFY with the specific MUD's design criteria." },
  katy:       { label: "City of Katy",      waterWidth: 20, verified: false, note: "Placeholder — VERIFY with City of Katy engineering standards." },
  fortbend:   { label: "Fort Bend County",  waterWidth: 20, verified: false, note: "Placeholder — VERIFY with Fort Bend County / MUD criteria." },
  generic:    { label: "Generic / unknown", waterWidth: 20, verified: false, note: "Placeholder — no jurisdiction matched; VERIFY locally." },
};

const clone = () => JSON.parse(JSON.stringify(DEFAULT_EASEMENT_RULES));

export function loadEasementRules() {
  try { const v = JSON.parse(localStorage.getItem(LS)); return v ? { ...clone(), ...v } : clone(); }
  catch (_) { return clone(); }
}
export function saveEasementRules(rules) { try { localStorage.setItem(LS, JSON.stringify(rules)); } catch (_) {} }

/* Best-guess jurisdiction key for a county (user can override in the UI).
 * NEW-4 — the key is NORMALISED first. This lookup was raw, so the two production rows storing
 * `"Harris"` resolved to `"generic"` instead of `"coh"` — silently, because a missing key returns
 * undefined and the `|| "generic"` fallback made it look like a deliberate answer.
 *
 * ⛔ B877440 — returns `null` (never "generic") for a county with no easement record, instead of
 * silently routing it to the same placeholder numbers "City of Houston" carries. "generic" is now
 * reachable ONLY by an explicit pick from the jurisdiction selector — never as an auto-default. A
 * `null` return means "no easement criteria on file for this county"; the caller shows that state
 * plainly (with a "Request criteria" action) rather than rendering a fabricated width. */
export const defaultJurForCounty = (county) =>
  ({ harris: "coh", fortbend: "fortbend" }[normCountyKey(county)] || null);

/* The counties this registry actually carries a record for — the admin "County criteria
 * requests" page (B877442) cross-references a request's county against this (and the sibling
 * lists in detentionRules.js's COUNTY_AUTHORITY / pondCriteriaRules.js / floodplainRules.js) to
 * decide whether an outstanding request has since been wired. Keep in sync with the map above. */
export const MODELED_COUNTIES = ["harris", "fortbend"];
