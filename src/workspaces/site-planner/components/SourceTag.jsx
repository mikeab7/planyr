import RowInfo from "./RowInfo.jsx";
import { SOURCE_TAGS, SOURCE_TAG_COLOR_VAR } from "../lib/provenance.js";

/* SourceTag (B895) — the one reusable "where did this number come from" tag. Every
 * Yield/pond-card headline figure gets exactly ONE of these, right-aligned: a small
 * color-coded word (CODE/PLAN/SURVEY/ESTIMATE/YOURS/UNVERIFIED — color is never the
 * only signal, the word always renders too) plus a ⓘ that opens the full "Basis" —
 * method, citation, eff./verified dates, freshness — on hover OR keyboard focus
 * (built on RowInfo/AnchoredMenu — a real portaled popover, not a mouse-only native
 * title). UNVERIFIED renders with a dashed border ("hollow") per the spec so a
 * placeholder default reads as visually unsettled even before the ⓘ is opened.
 * Theme tokens only (see lib/provenance.js SOURCE_TAG_COLOR_VAR) — no raw hex. */
const pillBase = {
  flex: "none", display: "inline-block", fontSize: 8.5, fontWeight: 800,
  letterSpacing: "0.05em", textTransform: "uppercase", lineHeight: 1.5,
  borderRadius: 4, padding: "1.5px 5px", whiteSpace: "nowrap",
};

export default function SourceTag({ code, label, basis, style }) {
  const tag = SOURCE_TAGS[code];
  if (!tag) return null;
  const color = `var(${SOURCE_TAG_COLOR_VAR[code]})`;
  const extra = Array.isArray(basis) ? basis : basis ? [{ text: basis }] : [];
  const sections = [{ text: tag.short }, ...extra];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 1, flex: "none" }}>
      <span style={{ ...pillBase, color, border: `1px ${code === "unverified" ? "dashed" : "solid"} ${color}`, ...style }}>
        {tag.label}
      </span>
      <RowInfo label={`${tag.label}${label ? ` · ${label}` : ""}`} sections={sections} />
    </span>
  );
}
