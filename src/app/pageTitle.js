/* Browser tab title — "Planyr — <module>" using the SAME label the Row-2 nav tabs render
 * (NEW-1, 2026-08-28 — the tab title used to be a fixed marketing string, so several open
 * Planyr tabs, or one truncated inside a Chrome tab group, were indistinguishable).
 *
 * AUDIT-FIRST: before this, `document.title` was set in exactly one place in the whole
 * app — the static <title> in index.html — and never touched by JS. No prior dynamic
 * title code existed to conflict with or duplicate.
 *
 * Deliberately reads the SAME shared label table the nav tabs read (MODULE_TAB_LABEL,
 * moduleTabLabel.js) rather than a second hardcoded list — a future nav rename updates
 * the tab title for free. A module absent from that table (Food — deliberately has no
 * nav tab, NEW-2 to B568400) or the unlisted /admin surface (never a `route.module`
 * value; see route.js's isAdminRoute) falls back to the bare brand string, per the
 * brief's explicit instruction not to invent a label for a route with no real one. */
import { MODULE_TAB_LABEL } from "../shared/ui/moduleTabLabel.js";

const BRAND = "Planyr";

export function pageTitle({ module, isAdmin = false } = {}) {
  const label = !isAdmin ? MODULE_TAB_LABEL[module] : null;
  return label ? `${BRAND} — ${label}` : BRAND;
}
