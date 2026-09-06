/* Model workspace — Stage 3 (NEW-2, owner brief 2026-09-03): the Inconsistencies panel — "a way
 * to list every instance in the sheet, so someone can sweep a model." Same floating-panel family
 * as NameManager.jsx/FindReplaceBar.jsx (never window.prompt/confirm — this repo's own KEY
 * DECISIONS ban dialog-box edits outright), same screen position (top-right, in normal document
 * flow — see NEW-1/B1251888) since the three never coexist — ModelApp.jsx closes the others
 * whenever this one opens, exactly the existing Find/Replace <-> Name Manager convention.
 *
 * ⛔ NEW-1 (B1251888) — like its two siblings, this used to be `position: fixed; top: 46`, the
 * same guessed offset that broke the moment Formula Auditing moved into the header row it was
 * floating over. It now renders in normal flow instead (ModelApp.jsx mounts it in the same flow
 * slot as FindReplaceBar/NameManager — only one is ever open at a time, so they never compete for
 * that slot), which cannot cover chrome that renders earlier in the column at any window width.
 *
 * Dismissing a flag never blocks or asks for confirmation — the brief is explicit that "the tool
 * flags, the modeller decides," so Dismiss is a single click, immediately reversible only by the
 * ordinary undo stack (dismissal is a normal committed edit like any other — see
 * lib/sheetModel.js's `setInconsistencyDismissed`). This panel only ever shows the CURRENTLY
 * ACTIVE (non-dismissed) flags — `flags` is already filtered by ModelApp.jsx before it reaches
 * here, the same "pure model, view decides what's shown" split lib/formulaConsistency.js itself
 * documents.
 */
import { useEffect, useRef, useState } from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import { cellAddressText } from "../lib/sheetEngine.js";

// Literal duplicates of designTokens.js's FONT_SIZE.control (12) / FONT_SIZE.label (10.5) — NOT
// an import, matching NameManager.jsx's own note on why (a second designTokens.js import point
// from this Model-only lazy chunk leaks a shared chunk onto the Site route's bundle allowlist).
const FS_CONTROL = 12;
const FS_LABEL = 10.5;

const smallBtnStyle = (enabled = true) => ({
  height: 24, padding: "0 8px", display: "inline-flex", alignItems: "center", justifyContent: "center",
  borderRadius: RADIUS.sm, border: "1px solid var(--border-default)", background: "var(--surface-page)",
  color: enabled ? "var(--text-primary)" : "var(--text-tertiary)", cursor: enabled ? "pointer" : "default",
  opacity: enabled ? 1 : 0.5, fontSize: FS_LABEL, font: "inherit",
});

const KIND_LABEL = { hardcoded: "Hardcoded value", "shape-mismatch": "Different pattern" };

function FlagRow({ flag, onGoTo, onDismiss }) {
  const addr = cellAddressText(flag.row, flag.col);
  return (
    <div data-testid="inconsistency-row" style={{ padding: "7px 8px", borderBottom: "1px solid var(--border-default)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          aria-hidden="true"
          style={{
            flex: "none", width: 0, height: 0, borderStyle: "solid", borderWidth: "7px 7px 0 0",
            borderColor: "var(--warn-text) transparent transparent transparent",
          }}
        />
        <button
          type="button" title={`Go to ${addr}`} onClick={() => onGoTo(flag.row, flag.col)}
          style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", fontSize: 13, fontWeight: 650, color: "var(--text-primary)" }}
        >{addr} <span style={{ fontWeight: 500, color: "var(--text-secondary)" }}>— {KIND_LABEL[flag.kind] || flag.kind}</span></button>
        <button type="button" title="Dismiss this flag" onClick={() => onDismiss(flag.row, flag.col)} style={smallBtnStyle()}>Dismiss</button>
      </div>
      <div style={{ marginTop: 3, fontSize: FS_LABEL, color: "var(--text-tertiary)" }}>{flag.message}</div>
    </div>
  );
}

export default function InconsistencyPanel({ open, flags, onClose, onGoTo, onDismiss }) {
  const [search, setSearch] = useState("");
  const searchRef = useRef(null);
  useEffect(() => { if (open) { setSearch(""); searchRef.current?.focus(); } }, [open]);

  if (!open) return null;

  const q = search.trim().toLowerCase();
  const rows = q
    ? flags.filter((f) => cellAddressText(f.row, f.col).toLowerCase().includes(q) || f.message.toLowerCase().includes(q))
    : flags;

  return (
    <div data-testid="inconsistency-panel-row" style={{ flex: "none", display: "flex", justifyContent: "flex-end", margin: "0 8px" }}>
    <div
      role="dialog"
      aria-label="Inconsistent Formulas"
      data-testid="inconsistency-panel"
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
      style={{
        display: "flex", flexDirection: "column", marginBottom: 8,
        width: 320, maxHeight: "min(70vh, 520px)",
        borderRadius: RADIUS.md, border: "1px solid var(--border-default)", background: "var(--surface-raised)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)", // design-exempt: no shadow-color token exists repo-wide (NameManager's/FindReplaceBar's own popPanel carries the identical gap)
        overflow: "hidden",
      }}
    >
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, padding: 8, borderBottom: "1px solid var(--border-default)" }}>
        <span style={{ flex: 1, fontSize: FS_CONTROL, fontWeight: 700, color: "var(--text-primary)" }}>Inconsistent Formulas</span>
        <button type="button" title="Close (Esc)" onClick={onClose} style={{ ...smallBtnStyle(), width: 24, padding: 0 }}>✕</button>
      </div>
      {flags.length > 0 && (
        <div style={{ flex: "none", padding: 8, borderBottom: "1px solid var(--border-default)" }}>
          <input
            ref={searchRef}
            data-testid="inconsistency-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search flagged cells…"
            style={{
              width: "100%", boxSizing: "border-box", font: "inherit", fontSize: FS_CONTROL, padding: "4px 7px",
              borderRadius: RADIUS.sm, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)",
            }}
          />
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {rows.length === 0 ? (
          <div style={{ padding: 16, textAlign: "center", fontSize: FS_CONTROL, color: "var(--text-tertiary)" }}>
            {flags.length === 0 ? "No inconsistencies found in this sheet." : "No flagged cells match your search."}
          </div>
        ) : (
          rows.map((f) => <FlagRow key={`${f.row}:${f.col}`} flag={f} onGoTo={onGoTo} onDismiss={onDismiss} />)
        )}
      </div>
    </div>
    </div>
  );
}
