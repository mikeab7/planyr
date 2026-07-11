import { useEffect, useId, useRef, useState } from "react";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import { menuPanelStyle } from "../../../shared/ui/controls.jsx";

/* RowInfo (B760) — the per-row ⓘ info affordance for the Layers panel. A real
 * <button> that opens a small popover (source · data vintage / refreshed-age ·
 * notes & caveats) on hover (pointer) or click/tap, so each panel row stays ONE
 * line with no persistent explanatory text. Built on AnchoredMenu (portal → never
 * clipped by the Layers card's overflow:hidden; Escape + click-away already handled).
 * Theme tokens only (B341/B508) — no raw hex.
 *
 * `sections` is a list of { text, tone } lines: tone "warn" renders the amber
 * caveat token; anything else renders the secondary-text token. Empty/blank lines
 * are dropped, and the ⓘ isn't rendered at all when nothing has content — a row
 * with no source/vintage/note simply has no info button. */
const infoBtn = {
  flex: "none", margin: 0, padding: "0 1px", lineHeight: 1,
  border: "none", background: "transparent", color: "var(--text-tertiary)",
  fontSize: 12.5, cursor: "pointer", display: "inline-flex", alignItems: "center",
};

export default function RowInfo({ label, sections = [] }) {
  const ref = useRef(null);
  const closeT = useRef(null);
  const descId = useId();
  const [open, setOpen] = useState(false);
  const rows = (sections || []).filter((s) => s && s.text != null && String(s.text).trim() !== "");

  // Hover-open with a small close delay so the pointer can travel from the ⓘ across
  // the (portal) gap into the panel without the popover snapping shut. Entering the
  // panel cancels the pending close; leaving either the button or the panel re-arms it.
  const clearClose = () => { if (closeT.current) { clearTimeout(closeT.current); closeT.current = null; } };
  const armClose = () => { clearClose(); closeT.current = setTimeout(() => setOpen(false), 160); };
  useEffect(() => () => clearClose(), []);

  if (!rows.length) return null;

  return (
    <>
      <button
        ref={ref} type="button"
        aria-label={`About ${label}`} aria-haspopup="dialog" aria-expanded={open}
        aria-describedby={open ? descId : undefined}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); clearClose(); setOpen((o) => !o); }}
        onMouseEnter={() => { clearClose(); setOpen(true); }}
        onMouseLeave={armClose}
        onFocus={() => { clearClose(); setOpen(true); }}
        onBlur={armClose}
        style={infoBtn}
        title="" /* suppress any inherited native tooltip — the popover is the affordance */
      >ⓘ</button>
      <AnchoredMenu
        open={open} onClose={() => setOpen(false)} anchorRef={ref}
        placement="below-left" width={248} gap={6}
        panelStyle={{ ...menuPanelStyle, padding: "9px 11px", cursor: "default" }}
        className=""
      >
        <div id={descId} role="note" onMouseEnter={clearClose} onMouseLeave={armClose}
          style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 11, lineHeight: 1.42 }}>
          <div style={{ fontWeight: 700, fontSize: 11.5, color: "var(--text-primary)" }}>{label}</div>
          {rows.map((s, i) => (
            <div key={i} style={{
              color: s.tone === "warn" ? "var(--warn-text)" : "var(--text-secondary)",
              fontStyle: s.tone === "warn" ? "italic" : "normal",
            }}>{s.text}</div>
          ))}
        </div>
      </AnchoredMenu>
    </>
  );
}
