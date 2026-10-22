/* "Email Michael to request it" — the one link every no-parcel-data message carries (NEW-1, owner request 2026-10-21).
 * A prefilled mailto built by `lib/parcelGaps.js` `parcelRequestHref`; the label is `PARCEL_REQUEST_LABEL`. Module-scope and
 * shared by the map toast, the address-search card and the Pick-county-lots panel so the three can never grow apart.
 * Styled as the ghost Button skin (an anchor, not a button, because it navigates) with a full-width tap target that wraps
 * cleanly at phone width. Rendering rule: show it only beside the message it was built for. */
import { CONTROL_RADIUS, FONT, PAD } from "../../../shared/ui/controls.jsx";
import { PARCEL_REQUEST_LABEL } from "../lib/parcelGaps.js";

export default function ParcelRequestLink({ href, testId = "parcel-gap-request", style }) {
  if (!href) return null;
  return (
    <a href={href} data-testid={testId}
      style={{
        display: "block", boxSizing: "border-box", width: "100%", marginTop: 8, padding: PAD.md, textAlign: "center", textDecoration: "none",
        border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--text-primary)",
        borderRadius: CONTROL_RADIUS.control, fontSize: FONT.md, fontWeight: 600, fontFamily: "inherit", lineHeight: 1.3, ...style,
      }}>
      {PARCEL_REQUEST_LABEL}
    </a>
  );
}
