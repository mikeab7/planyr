/* Per-jurisdiction utility-easement rules (required easement width over a public
 * main). EDITABLE and seeded with PLACEHOLDERS clearly marked "verify" — these
 * are NOT authoritative values. Each jurisdiction's real requirement lives in its
 * design manual / utility criteria; the user confirms and edits here. Stored in
 * localStorage so edits persist per device.
 */
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

// Best-guess jurisdiction key for a county (user can override in the UI).
export const defaultJurForCounty = (county) =>
  ({ harris: "coh", fortbend: "fortbend", chambers: "generic", waller: "generic" }[county] || "generic");
