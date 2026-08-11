import { useLayoutEffect, useRef, useState } from "react";
import { formatAge } from "../lib/gisCache.js";
import { abbreviateJurisdiction } from "../lib/jurisdictionBadgeFit.js";

/* B763 — the passive jurisdiction badge in the site header. Display-only screening
 * info from the B93 identify, auto-run once per active-parcel activation (never per
 * pan): it tells the user WHICH jurisdiction the active parcel is in — city / ETJ /
 * county (+ ISD once B764 lands) — without toggling any boundary layer. Theme tokens
 * only (B341/B508). The `badge` prop is the `formatJurisdictionBadge` result (+ ageMs /
 * sourceName); null → renders nothing. A straddle is marked ⚑ (warn token).
 *
 * ⛔ NEW-2 — NAVIGATION WINS, AND THIS IS THE CONTENT HALF OF THAT RULE. On a laptop the owner
 * could not open the plan switcher at all: the pill ran over the plan chip and its own text span
 * answered every point of the chip's right end, the ▾ caret included. The layout half (which zone
 * yields) is in `AppHeader`; here the pill SHORTENS ITSELF when the room it is given cannot hold
 * the full line — dropping whole facts, governing one first, rather than cutting a word in half.
 *
 * THREE THINGS NOT TO UNDO:
 *  (a) the FULL string stays in the tooltip AND in `data-jurisdiction-full`, always — shortening
 *      the default view is the tool, deleting a fact is not, and a headless check reads the whole
 *      answer from the attribute rather than from pixels;
 *  (b) the fit is measured against the space the PARENT gives, never against the pill's own
 *      current width — measuring the pill would latch: abbreviating shrinks it, which would then
 *      "prove" the short form is all that fits and it could never come back;
 *  (c) the natural width is read from a hidden copy of the FULL text that is always mounted, so
 *      the measurement is independent of the decision it drives and cannot oscillate.
 */
export default function JurisdictionBadge({ badge }) {
  const pillRef = useRef(null);
  const textRef = useRef(null);
  const fullRef = useRef(null);
  const [abbrev, setAbbrev] = useState(false);
  const text = badge && badge.text ? badge.text : "";
  const short = abbreviateJurisdiction(badge);

  useLayoutEffect(() => {
    const pill = pillRef.current, span = textRef.current, ghost = fullRef.current;
    if (!pill || !span || !ghost || !pill.parentElement) return undefined;
    const host = pill.parentElement;
    const measure = () => {
      /* The pill's chrome — icon, gaps, padding, border, the ⚑ — is whatever the pill is beyond
         its text span, and that difference holds whether the text is truncated or not. */
      const chrome = pill.offsetWidth - span.offsetWidth;
      const cs = typeof getComputedStyle === "function" ? getComputedStyle(host) : null;
      const pad = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0;
      const avail = host.clientWidth - pad;
      const needed = chrome + ghost.offsetWidth;
      setAbbrev(needed > avail + 0.5);
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [text, short.text]);

  if (!badge || !badge.text) return null;
  const age = badge.ageMs != null ? formatAge(badge.ageMs) : null;
  const title = [
    // NEW-2 — the FULL line leads the tooltip, so a shortened pill is one hover from complete.
    text,
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
      ref={pillRef}
      title={title}
      data-testid="jurisdiction-badge"
      /* The complete answer, always, whatever the visible text is doing. */
      data-jurisdiction-full={text}
      data-jurisdiction-abbrev={abbrev ? "1" : undefined}
      style={{
        position: "relative",
        display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%", minWidth: 0,
        background: "var(--surface-raised)", border: "1px solid var(--border-default)",
        borderRadius: 999, padding: "2px 10px", fontSize: 11.5, fontWeight: 600,
        color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden",
      }}
    >
      <span aria-hidden="true" style={{ flex: "none", fontSize: 11 }}>📍</span>
      <span ref={textRef} data-jurisdiction-text="1" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {abbrev ? short.text : text}
      </span>
      {badge.straddle && <span aria-hidden="true" style={{ flex: "none", color: "var(--warn-text)", fontWeight: 700 }}>⚑</span>}
      {/* The measuring copy: always the FULL string, never laid out, never read by a user. It is
          what makes the fit decision independent of its own outcome. */}
      <span
        ref={fullRef}
        aria-hidden="true"
        data-jurisdiction-measure="1"
        style={{ position: "absolute", left: 0, top: 0, visibility: "hidden", whiteSpace: "nowrap", pointerEvents: "none" }}
      >
        {text}
      </span>
    </span>
  );
}
