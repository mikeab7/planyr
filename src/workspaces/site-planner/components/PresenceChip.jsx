import { useEffect, useRef, useState } from "react";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import { menuPanelStyle } from "../../../shared/ui/controls.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";
import { presenceChipContent, presenceDisplayName, presenceInitials, presenceLastOpLabel } from "../lib/presencePill.js";
import { PeopleIcon, DuplicateIcon } from "./icons.jsx";

/* PresenceChip — the header's "who's here" chip (NEW-1, rebuilt from the old plain-dot "N here"
 * pill). MODULE-SCOPE-COMPONENTS: this lives at module scope, not inside SitePlanner's render body,
 * so it never remounts (and loses hover/open state) on an unrelated re-render.
 *
 * All of the DECIDING happens in presencePill.js's presenceChipContent — this component is a thin
 * map from that plain object to JSX, so every case is covered by that pure function's own unit
 * tests without mounting anything here.
 *
 * Three cases (see presenceChipContent's header):
 *  - no `data` at all → render nothing (alone, single tab — chrome-quiet by design)
 *  - `kind:"self-tabs"` → this account's own extra tabs, never presented as people: a small
 *    "copies of you" glyph + a bare tab count. Static — there is nothing further to disclose.
 *  - `kind:"people"` → the two-person silhouette + each other real person's initials (capped,
 *    "+N" overflow), interactive: hover reveals the full breakdown on desktop, a tap/click does
 *    the same on phone (same pattern SourcesLegend.jsx already uses for this exact affordance —
 *    open on hover OR click, a short delay before closing so moving onto the popover doesn't
 *    flash it shut). */

const chipBase = {
  display: "inline-flex", alignItems: "center", gap: 5, background: "var(--surface-raised)",
  border: "1px solid var(--border-strong)", borderRadius: RADIUS.md, padding: "2px 9px",
  fontSize: FONT_SIZE.control, fontWeight: 800, color: "var(--text-primary)", whiteSpace: "nowrap",
  fontFamily: "inherit",
};

// NEW-1 — the GLOBAL accent pair (`--accent`/`--on-accent`), not `--accent-site`/`--on-accent-site`:
// the contrast audit (ui-audit/contrast-audit.mjs) marks the site pair "safe for large/bold only"
// (it clears the 3:1 UI-graphic floor, not the 4.5:1 body-text floor) — fine for a decorative dot,
// wrong for the initials text this badge actually renders. `--accent`/`--on-accent` clears 4.5:1 in
// both themes with no exception, which is what a small two-letter label needs.
const initialsBadge = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 17, height: 17,
  borderRadius: RADIUS.pill, background: "var(--accent)", color: "var(--on-accent)",
  fontSize: 9, fontWeight: 800, letterSpacing: "0.01em", flex: "none",
};

const overflowBadge = { ...initialsBadge, background: "var(--border-default)", color: "var(--text-secondary)" };

// NEW-1 (top-right toolbar cluster, Option B) — the "self-tabs" chip is this row's "open tabs"
// control (a text pill reading "N tabs"); Option B's spec is an icon-only 32×32 button with a
// small numeric badge, matching every other bordered control in the cluster (the sync badge,
// Full screen, the account trigger) rather than a differently-shaped text pill. Only the
// "self-tabs" kind changes shape — the "people" kind (who's editing) is a distinct feature the
// brief didn't ask to touch and keeps its existing variable-width chip below.
const selfTabsBtn = {
  position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 32, height: 32, flex: "none", borderRadius: RADIUS.md,
  border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--text-primary)",
};
const selfTabsCountBadge = {
  position: "absolute", top: -2, right: -2, minWidth: 14, height: 14, padding: "0 3px",
  borderRadius: RADIUS.pill, background: "var(--accent)", color: "var(--on-accent)",
  fontSize: FONT_SIZE.micro, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center",
  boxSizing: "border-box", border: "1.5px solid var(--surface-raised)",
};

export default function PresenceChip({ data }) {
  const content = presenceChipContent(data);
  const ref = useRef(null);
  const closeT = useRef(null);
  const [open, setOpen] = useState(false);
  const clearClose = () => { if (closeT.current) { clearTimeout(closeT.current); closeT.current = null; } };
  const armClose = () => { clearClose(); closeT.current = setTimeout(() => setOpen(false), 160); };
  useEffect(() => () => clearClose(), []);

  if (!content) return null;

  if (content.kind === "self-tabs") {
    // Alone, several tabs: a static fact, nothing to disclose further — no hover target, no
    // silhouette (there is no one else here to draw one for).
    return (
      <span
        data-testid="presence-chip" data-presence-kind="self-tabs"
        title={content.tooltip} aria-label={content.tooltip}
        style={selfTabsBtn}
      >
        <DuplicateIcon size={15} />
        <span aria-hidden="true" data-testid="presence-self-tabs-count" style={selfTabsCountBadge}>{content.selfWindows}</span>
      </span>
    );
  }

  return (
    <>
      <button
        ref={ref} type="button" data-testid="presence-chip" data-presence-kind="people"
        aria-haspopup="dialog" aria-expanded={open}
        aria-label={`Who's here: ${content.tooltip}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); clearClose(); setOpen((o) => !o); }}
        onMouseEnter={() => { clearClose(); setOpen(true); }}
        onMouseLeave={armClose}
        onFocus={() => { clearClose(); setOpen(true); }}
        onBlur={armClose}
        style={{ ...chipBase, cursor: "pointer" }}
        title=""
      >
        <PeopleIcon size={13} />
        {content.selfWindows > 1 && (
          <span data-testid="presence-self-tabs" style={{ color: "var(--text-secondary)", fontWeight: 700 }}>×{content.selfWindows}</span>
        )}
        {content.visible.map((o) => (
          <span key={o.uid} data-testid="presence-initial" style={initialsBadge} aria-hidden="true">{presenceInitials(o)}</span>
        ))}
        {content.overflow > 0 && (
          <span data-testid="presence-overflow" style={overflowBadge} aria-hidden="true">+{content.overflow}</span>
        )}
      </button>
      <AnchoredMenu
        open={open} onClose={() => setOpen(false)} anchorRef={ref} hoverSafe
        placement="below-right" width={220} gap={6}
        panelStyle={{ ...menuPanelStyle, padding: "8px 10px", cursor: "default" }}
        className=""
      >
        <div
          data-testid="presence-breakdown"
          onMouseEnter={clearClose} onMouseLeave={armClose}
          style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: FONT_SIZE.control, color: "var(--text-primary)" }}
        >
          {content.selfWindows > 1 && (
            <div>You <span style={{ color: "var(--text-secondary)" }}>— {content.selfWindows} tabs</span></div>
          )}
          {data.others.map((o) => {
            // B472048 (NEW-7/NEW-2) — "who is here" is only half the question the owner asked;
            // this line is "and what were they doing", from operation envelopes seen over
            // realtime (SitePlanner.jsx tracks lastOpByUid) — null renders nothing rather than a
            // placeholder, since "hasn't touched anything this page load" is a real, quiet state.
            const opLabel = presenceLastOpLabel(o.lastOp);
            return (
              <div key={o.uid}>
                <div>
                  {presenceDisplayName(o)}
                  {o.windows > 1 && <span style={{ color: "var(--text-secondary)" }}> ({o.windows} windows)</span>}
                </div>
                {opLabel && (
                  <div data-testid="presence-last-op" style={{ color: "var(--text-secondary)", fontSize: FONT_SIZE.micro }}>{opLabel}</div>
                )}
              </div>
            );
          })}
        </div>
      </AnchoredMenu>
    </>
  );
}
