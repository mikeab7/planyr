import { useEffect, useRef, useState } from "react";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import { menuPanelStyle } from "../../../shared/ui/controls.jsx";
import { SOURCE_TAG_ORDER, SOURCE_TAGS, SOURCE_TAG_COLOR_VAR } from "../lib/provenance.js";

/* SourcesLegend (B895) — the ONE "Sources (i)" legend for the whole Yield panel:
 * a first-time user opens this once to learn what the six tag colors mean, rather
 * than re-explaining each tag inline everywhere. Hover (pointer) or click/focus
 * (keyboard) — same portaled-popover pattern as RowInfo/SourceTag, so it's reachable
 * without a mouse. Theme tokens only. */
const trigger = {
  flex: "none", margin: 0, padding: "2px 8px", lineHeight: 1.4, borderRadius: 999,
  border: "1px solid var(--planner-border)", background: "transparent", color: "var(--text-tertiary)",
  fontSize: 9.5, fontWeight: 700, letterSpacing: "0.03em", cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit",
};

export default function SourcesLegend({ style }) {
  const ref = useRef(null);
  const closeT = useRef(null);
  const [open, setOpen] = useState(false);
  const clearClose = () => { if (closeT.current) { clearTimeout(closeT.current); closeT.current = null; } };
  const armClose = () => { clearClose(); closeT.current = setTimeout(() => setOpen(false), 160); };
  useEffect(() => () => clearClose(), []);

  return (
    <>
      <button
        ref={ref} type="button"
        aria-haspopup="dialog" aria-expanded={open} aria-label="Sources — what the colored tags mean"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); clearClose(); setOpen((o) => !o); }}
        onMouseEnter={() => { clearClose(); setOpen(true); }}
        onMouseLeave={armClose}
        onFocus={() => { clearClose(); setOpen(true); }}
        onBlur={armClose}
        style={{ ...trigger, ...style }}
        title=""
      >Sources ⓘ</button>
      <AnchoredMenu
        open={open} onClose={() => setOpen(false)} anchorRef={ref} hoverSafe
        placement="below-right" width={272} gap={6}
        panelStyle={{ ...menuPanelStyle, padding: "10px 12px", cursor: "default" }}
        className=""
      >
        <div onMouseEnter={clearClose} onMouseLeave={armClose} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 11, color: "var(--text-primary)" }}>Where each figure comes from</div>
          {SOURCE_TAG_ORDER.map((id) => {
            const tag = SOURCE_TAGS[id];
            const color = `var(${SOURCE_TAG_COLOR_VAR[id]})`;
            return (
              <div key={id} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{
                  flex: "none", width: 66, textAlign: "center", fontSize: 8.5, fontWeight: 800, letterSpacing: "0.05em",
                  color, border: `1px ${id === "unverified" ? "dashed" : "solid"} ${color}`, borderRadius: 4, padding: "1.5px 5px",
                }}>{tag.label}</span>
                <span style={{ fontSize: 10.5, color: "var(--text-secondary)", lineHeight: 1.35 }}>{tag.short}</span>
              </div>
            );
          })}
        </div>
      </AnchoredMenu>
    </>
  );
}
