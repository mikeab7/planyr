// Element-level sync, phase 5 (B674) — the multi-writer switch.
//
// Default ON in code. The escape hatch is a CLIENT-SIDE localStorage override
// (`planyr.multiwriter` = "off") that restores the old single-active-editor lock behavior —
// deliberately NOT a build-time env var (the Cloudflare env-at-build failure pattern: a var that
// must exist at build time silently vanishes when the build env drifts; a code constant + a
// runtime localStorage read can't). Flip it from the console:
//   localStorage.setItem("planyr.multiwriter", "off");  location.reload();
// and back with removeItem. Signed-out mode never multi-writes regardless (element sync is
// cloud-active-only), so this switch only concerns signed-in tabs/users.

export const MULTIWRITER_DEFAULT = true;
export const MULTIWRITER_KEY = "planyr.multiwriter";

export function multiwriterEnabled() {
  try {
    if (localStorage.getItem(MULTIWRITER_KEY) === "off") return false;
  } catch (_) { /* storage blocked → fall through to the default */ }
  return MULTIWRITER_DEFAULT;
}
