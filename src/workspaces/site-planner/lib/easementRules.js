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

export function loadEasementRules(store) {
  try {
    const s = store || localStorage;
    const v = JSON.parse(s.getItem(LS));
    if (!v) return clone();
    // PER-JURISDICTION merge (B1953793): a stored record fills over its seed field by field, so a
    // patch-shaped record never drops the seed's label/note and a seed correction still reaches it.
    const out = clone();
    for (const [k, r] of Object.entries(v)) out[k] = { ...(out[k] || {}), ...(r || {}) };
    return out;
  }
  catch (_) { return clone(); }
}
export function saveEasementRules(rules) { try { localStorage.setItem(LS, JSON.stringify(rules)); } catch (_) {} }

/** B1953793 — fresh read-modify-write of ONE jurisdiction (see floodplainRules.patchFloodplainRule). */
export function patchEasementRule(key, patch, store) {
  try {
    const s = store || (typeof localStorage !== "undefined" ? localStorage : null);
    if (s) {
      let raw = {};
      try { raw = JSON.parse(s.getItem(LS)) || {}; } catch (_) { raw = {}; }
      raw[key] = { ...(raw[key] || {}), ...patch };
      s.setItem(LS, JSON.stringify(raw));
      notifyEase();
    }
  } catch (_) {}
  return loadEasementRules(store);
}
const easeListeners = new Set();
function notifyEase() { easeListeners.forEach((l) => { try { l(); } catch (_) {} }); }
export function subscribeEasementRules(cb) {
  easeListeners.add(cb);
  const on = (e) => { if (!e || e.key === null || e.key === LS) cb(); };
  if (typeof window !== "undefined" && window.addEventListener) window.addEventListener("storage", on);
  return () => { easeListeners.delete(cb); if (typeof window !== "undefined" && window.removeEventListener) window.removeEventListener("storage", on); };
}

/* A-B1953794 — the ONE answer to "which easement jurisdiction applies?". Derived at read time from
 * the plan's (healed) county; an explicit user pick (`override`, persisted in plan settings) stays
 * an override and wins; an override naming a record that no longer exists is ignored, not obeyed. */
export const resolveEasementJur = (override, county, rules) =>
  (override && (!rules || rules[override]) ? override : null) || defaultJurForCounty(county);

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
