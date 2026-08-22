import { useLayoutEffect, useRef, useState } from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import { formatAge } from "../lib/gisCache.js";
import { PinIcon } from "./icons.jsx";
import { abbreviateJurisdiction, jurisdictionRungs } from "../lib/jurisdictionBadgeFit.js";

/* B763 — the passive jurisdiction badge in the site header. Display-only screening
 * info from the B93 identify, auto-run once per active-parcel activation (never per
 * pan): it tells the user WHICH jurisdiction the active parcel is in — city / ETJ /
 * county (+ ISD once B764 lands) — without toggling any boundary layer. Theme tokens
 * only (B341/B508). The `badge` prop is the `formatJurisdictionBadge` result (+ ageMs /
 * sourceName); null → renders nothing. A straddle is marked ⚑ (warn token).
 *
 * ⛔ NEW-2 (B371361) — NAVIGATION WINS, AND THIS IS THE CONTENT HALF OF THAT RULE. On a laptop the
 * owner could not open the plan switcher at all: the pill ran over the plan chip and its own text
 * span answered every point of the chip's right end, the ▾ caret included. The layout half (which
 * zone yields) is in `AppHeader`; here the pill SHORTENS ITSELF when the room it is given cannot
 * hold the full line — dropping whole SLOTS, governing one first, rather than cutting a word in
 * half.
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
  const text = badge && badge.text ? badge.text : "";
  /* ⛔ B367298 — A LADDER, NOT A SWITCH. One short form was not enough: on a SPLIT site
   * `abbreviateJurisdiction`'s output is nearly the whole line, so at laptop widths the pill fell
   * back to a CSS ellipsis and cut it mid-word — the very thing dropping whole facts exists to
   * prevent, reached from underneath. Measured in a browser on Goose Creek and Tsakiris at 761 and
   * 860 px. The last rung is the empty string: below a certain width no TRUE statement about a split
   * jurisdiction fits, and showing nothing (with the whole answer still on hover) is the only option
   * that cannot mislead. See `jurisdictionRungs`. */
  const rungs = jurisdictionRungs(badge);
  const [rung, setRung] = useState(0);

  /* ⛔ B367298 — HOW MUCH ROOM THE PILL HAS, MEASURED WITHOUT ASKING THE PILL. Three readings were
   * built before this one and each failed in a way worth recording, because the trap is the same
   * every time — a budget that depends on the text makes the comparison `shown <= shown`:
   *   • `host.clientWidth` while the zone was `flex: 0 1 auto` — the zone IS its content when the
   *     content fits, so the label RATCHETED DOWN as the window narrowed and never came back up
   *     (shortest rung at 860 px, still shortest at 1440 px).
   *   • row width minus the sibling zones' content — content-independent, but not what flex grants
   *     once the row is over-subscribed; too generous, and the pill overflowed its box.
   *   • step DOWN a rung whenever the span clips — terminates, but each step changes the layout, so
   *     it overshot by a rung and sat blank with 213 px going spare (measured, Goose Creek at 761).
   *
   * The honest budget is a property of the ZONE's mode, and `AppHeader` gives us both:
   *   • CENTRED — the zone is out of flow with a measured `max-width`, so it competes with nothing
   *     and its budget IS that max-width, whatever the pill puts inside it.
   *   • TIGHT / UNMEASURED — the zone is `flex: 1 1 0%`, i.e. basis ZERO plus grow, so its width is
   *     the row's leftover space and is likewise independent of the text.
   * Either way the number is stable, so one pass picks the rung and there is nothing to oscillate.
   */
  useLayoutEffect(() => {
    const pill = pillRef.current, span = textRef.current;
    if (!pill || !span || !pill.parentElement) return undefined;
    const host = pill.parentElement;
    const measure = () => {
      const cs = typeof getComputedStyle === "function" ? getComputedStyle(host) : null;
      const pad = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 0;
      const capPx = cs && /px$/.test(cs.maxWidth) ? parseFloat(cs.maxWidth) : null;
      const outOfFlow = cs && cs.position === "absolute";
      /* ⛔ ASK FOR EVERYTHING, THEN SEE WHAT YOU ARE GIVEN. In the in-flow (`tight`) mode the zone's
       * width still tracks its content once the row is over-subscribed, so reading it while a SHORT
       * rung is showing answers "how much room does the short rung need" — the latch again. So the
       * span is briefly filled with the FULL label, the granted width is read, and it is put back,
       * all inside this layout effect: no paint happens in between and no React state is touched. */
      const restore = span.textContent;
      span.textContent = text;
      const granted = outOfFlow && capPx != null ? capPx : host.clientWidth;
      span.textContent = restore;
      const avail = Math.max(0, granted - pad);
      // The pill's chrome — pin, gaps, padding, border, the ⚑ — is whatever it is beyond its text.
      const chrome = pill.offsetWidth - span.offsetWidth;
      const ghosts = Array.from(pill.querySelectorAll("[data-jurisdiction-measure]"));
      const widths = ghosts.map((g) => g.offsetWidth);
      let pick = Math.max(0, widths.length - 1);
      for (let i = 0; i < widths.length; i++) if (chrome + widths[i] <= avail + 0.5) { pick = i; break; }
      setRung((prev) => (prev === pick ? prev : pick));   // B1189 — guard the DISPATCH, always

      /* ⛔ B371362 — DECLARE THE LEAST WIDTH AT WHICH THIS PILL CAN STILL SAY SOMETHING TRUE, so the
       * header can decide whether a CENTRED slot is worth having for THIS content rather than for a
       * constant. `AppHeader`'s threshold was 120 px — the width of the word "Unincorporated" — while
       * the owner's Goose Creek label needs 199 for its shortest true form, so at 1000 px the header
       * ruled a 136 px centred slot worthwhile and handed it a slot it could not use. The pill then
       * correctly fell to pin-only (B367298) while, one band lower, the in-flow `tight` layout showed
       * the WHOLE label. This is the number that closes that gap.
       *
       * It is a function of the TEXT, never of the width granted, so it cannot feed back on the
       * layout that reads it. Written to the DOM rather than lifted through React state because the
       * consumer is an ancestor in another workspace's module — one attribute, no new prop chain. */
      const trueRungs = ghosts.map((g, i) => (g.textContent ? widths[i] : null)).filter((w) => w != null);
      const minFit = trueRungs.length ? Math.ceil(Math.min(...trueRungs) + chrome) : 0;
      if (minFit > 0) pill.setAttribute("data-center-min-fit", String(minFit));
      else pill.removeAttribute("data-center-min-fit");
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver(measure);
    // Observe the ROW as well as the zone: in centred mode the zone's own box does not change when
    // the row does, but its measured max-width does.
    ro.observe(host);
    if (host.parentElement) ro.observe(host.parentElement);
    return () => ro.disconnect();
  }, [text, rungs.length]);

  if (!badge || !badge.text) return null;
  const age = badge.ageMs != null ? formatAge(badge.ageMs) : null;
  const title = [
    // NEW-2 — the FULL line leads the tooltip, so a shortened pill is one hover from complete.
    text,
    // ⛔ B689905 — never claim a parcel that isn't drawn. `parcelBased` is set by SitePlanner's
    // badge effect; a legacy/fixture badge with no such field renders the original sentence.
    badge.parcelBased === false
      ? "Jurisdiction at the site location: no parcel or boundary is drawn, so this is the point only — screening only; verify with the jurisdiction."
      : "Jurisdiction of the active parcel: screening only; verify with the jurisdiction.",
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
    /* ⛔ B689904 — two ETJs named together are an APPORTIONMENT, never a place both fully govern.
     * Local Gov't Code ch. 42 apportions an ETJ overlap between the two cities along a line; a point
     * on this tract is in at most one of them. Said once, here, rather than left to the "crosses"
     * wording to carry on its own. */
    (badge.etjLabels?.length || 0) > 1
      ? `"Crosses": this boundary touches more than one city's ETJ. Texas apportions an ETJ overlap between the cities along a line — each governs only its own side, never both at once. Confirm which side with each city.`
      : "",
    badge.straddle ? "⚑ Straddles a boundary: touches multiple jurisdictions." : "",
  ].filter(Boolean).join("\n");
  return (
    <span
      ref={pillRef}
      title={title}
      data-testid="jurisdiction-badge"
      /* The complete answer, always, whatever the visible text is doing. */
      data-jurisdiction-full={text}
      data-jurisdiction-abbrev={rung > 0 ? "1" : undefined}
      style={{
        position: "relative",
        display: "inline-flex", alignItems: "center", gap: 5, maxWidth: "100%", minWidth: 0,
        background: "var(--surface-raised)", border: "1px solid var(--border-default)",
        borderRadius: RADIUS.pill, padding: "2px 10px", fontSize: 11.5, fontWeight: 600,
        color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden",
      }}
    >
      {/* NEW-3 — drawn pin, not the 📍 emoji: it now inherits the pill's own text colour. */}
      <span style={{ flex: "none", display: "grid", placeItems: "center" }}><PinIcon size={11} /></span>
      {/* ⛔ `textOverflow: clip`, not `ellipsis`, ON PURPOSE: the rung ladder is what makes the text
          fit, and an ellipsis here would quietly paper over a rung that does not — turning a
          measurable failure back into the silent mid-word cut this item removed. If nothing fits,
          the chosen rung is the empty string and the pill is the pin alone. */}
      <span ref={textRef} data-jurisdiction-text="1" data-rung={rung} style={{ overflow: "hidden", textOverflow: "clip" }}>
        {rungs[Math.min(rung, rungs.length - 1)]}
      </span>
      {badge.straddle && <span aria-hidden="true" style={{ flex: "none", color: "var(--warn-text)", fontWeight: 700 }}>⚑</span>}
      {/* The rungs, published for a headless check to read (and never laid out or shown). The FIT is
          decided by asking the browser whether the visible span clipped — see above — so these are a
          DOM contract, not a measuring device. */}
      {rungs.map((r, i) => (
        <span
          key={`rung${i}`}
          aria-hidden="true"
          data-jurisdiction-measure={i}
          style={{ position: "absolute", left: 0, top: 0, visibility: "hidden", whiteSpace: "nowrap", pointerEvents: "none" }}
        >
          {r}
        </span>
      ))}
    </span>
  );
}
