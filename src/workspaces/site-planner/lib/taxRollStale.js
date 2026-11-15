/* taxRollStale.js — NEW-3 (2026-11-12): the ops signal for "the indexed tax-unit answer is behind a newer HCAD roll".
 * `/api/taxunits` says `staleState: "refresh-pending"` when HCAD has published and adopted the next year's rates but the
 * Supabase index still serves the old one (B2158065 "Yearly refresh": action=rates, then action=resume). The caption tells the
 * person; this row tells whoever runs the rebuild. Once per (county, roll year) per page load; read-only; never throws. */
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";

const sent = new Set();
export function noteStaleRoll(county, rollYear) {
  try {
    const k = `${county}|${rollYear}`;
    if (sent.has(k)) return false;
    sent.add(k);
    reportClientEvent("tax-roll-stale", `${county} tax-unit index is on the ${rollYear} roll but a newer roll is published and adopted — run the yearly refresh`, { county, rollYear });
    return true;
  } catch { return false; }
}
export function _resetStaleNotes() { sent.clear(); }
