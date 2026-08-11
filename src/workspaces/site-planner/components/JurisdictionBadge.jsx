import { formatAge } from "../lib/gisCache.js";
import { PinIcon } from "./icons.jsx";

/* B763 — the passive jurisdiction badge in the site header. Display-only screening
 * info from the B93 identify, auto-run once per active-parcel activation (never per
 * pan): it tells the user WHICH jurisdiction the active parcel is in — city / ETJ /
 * county (+ ISD once B764 lands) — without toggling any boundary layer. Theme tokens
 * only (B341/B508). The `badge` prop is the `formatJurisdictionBadge` result (+ ageMs /
 * sourceName); null → renders nothing. A straddle is marked ⚑ (warn token). */
export default function JurisdictionBadge({ badge }) {
  if (!badge || !badge.text) return null;
  const age = badge.ageMs != null ? formatAge(badge.ageMs) : null;
  const title = [
    "Jurisdiction of the active parcel: screening only; verify with the jurisdiction.",
    badge.sourceName ? `Source: ${badge.sourceName}` : "",
    age ? `As of ${age}` : "",
    /* ⛔ NEW-1 — WHY "UNINCORPORATED" IS NOT PRINTED BESIDE AN ETJ, said once, where the reader is.
     * The two are not alternatives: in Texas an extraterritorial jurisdiction IS the unincorporated
     * band outside a city's limits, so ETJ land is unincorporated by definition and the word adds
     * nothing. The label leads with what GOVERNS; the fact itself is unchanged in the model. */
    badge.shape === "etj" ? "In a city's ETJ — which is, by definition, unincorporated land just outside that city's limits. The city's platting and (often) floodplain rules still reach here; the county remains the taxing authority." : "",
    /* ⛔ NEW-1 — ANYTHING AFTER THE EM DASH REGULATES NOTHING HERE, and that is the whole point of
     * the dash: the old label joined "this city governs your platting" and "this city is next door"
     * with the same slash, and a reader could not tell them apart. B793's edge-only sliver is the
     * ordinary case — the city's limits meet the parcel boundary and nothing more. */
    badge.edgeOnlyCities?.length ? `After the dash — ${badge.edgeOnlyCities.map((c) => `City of ${c}`).join(", ")} meets only the parcel edge. It does not govern this site; it is named so a neighbouring jurisdiction is never a surprise.` : "",
    // NEW-1 — the two states the whole-site containment model added. A "part in" city really does
    // govern part of the site, so it is stated as membership; a "touches" city is a city we could
    // not classify, and saying which it is matters more than hiding the gap.
    badge.partialCities?.length ? `"Part in": some of the drawn parcels sit inside ${badge.partialCities.map((c) => `City of ${c}`).join(", ")} and some do not — the site is split, and both standards may apply.` : "",
    badge.touchesCities?.length ? `"Containment unchecked": ${badge.touchesCities.map((c) => `City of ${c}`).join(", ")} borders the site, but the containment check did not complete — we cannot yet say whether the site is inside it.` : "",
    badge.failureNote || "",
    badge.etjNote || "",
    badge.straddle ? "⚑ Straddles a boundary: touches multiple jurisdictions." : "",
  ].filter(Boolean).join("\n");
  return (
    <span
      title={title}
      data-testid="jurisdiction-badge"
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%",
        background: "var(--surface-raised)", border: "1px solid var(--border-default)",
        borderRadius: 999, padding: "2px 10px", fontSize: 11.5, fontWeight: 600,
        color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden",
      }}
    >
      {/* NEW-3 — drawn pin, not the 📍 emoji: it now inherits the pill's own text colour. */}
      <span style={{ flex: "none", display: "grid", placeItems: "center" }}><PinIcon size={11} /></span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{badge.text}</span>
      {badge.straddle && <span aria-hidden="true" style={{ flex: "none", color: "var(--warn-text)", fontWeight: 700 }}>⚑</span>}
    </span>
  );
}
