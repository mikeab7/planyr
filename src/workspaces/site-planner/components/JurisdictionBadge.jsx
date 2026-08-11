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
    // B793 — "edge only" = the city's limits touch only the parcel edge (the centroid is
    // outside), so that city's rules are unlikely to govern the site as a whole.
    badge.edgeOnlyCities?.length ? `"Edge only": ${badge.edgeOnlyCities.map((c) => `City of ${c}`).join(", ")} touches only the parcel edge: unlikely to govern the site as a whole.` : "",
    // NEW-1 — the two states the whole-site containment model added. A "part in" city really does
    // govern part of the site, so it is stated as membership; a "touches" city is a city we could
    // not classify, and saying which it is matters more than hiding the gap.
    badge.partialCities?.length ? `"Part in": some of the drawn parcels sit inside ${badge.partialCities.map((c) => `City of ${c}`).join(", ")} and some do not — the site is split, and both standards may apply.` : "",
    badge.touchesCities?.length ? `"Touches": ${badge.touchesCities.map((c) => `City of ${c}`).join(", ")} borders the site, but the containment check did not complete — we cannot yet say whether the site is inside it.` : "",
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
