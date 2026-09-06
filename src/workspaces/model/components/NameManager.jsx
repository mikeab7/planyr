/* Model workspace — Stage 3 pt 2: the Name Manager (NEW-1).
 *
 * A floating in-app panel, same family as FindReplaceBar.jsx (never window.prompt/confirm —
 * this repo's own KEY DECISIONS ban dialog-box edits outright).
 *
 * ⛔ NEW-1 (B1251888) — like its two siblings (FindReplaceBar.jsx, InconsistencyPanel.jsx), this
 * used to be `position: fixed; top: 46`, the same guessed offset that broke the moment Formula
 * Auditing moved into the header row it was floating over. It now renders in normal document
 * flow instead (ModelApp.jsx mounts it in the same flow slot as Find/Replace and Inconsistencies
 * — only one is ever open at a time, so they never compete for that slot), which cannot cover
 * chrome that renders earlier in the column at any window width.
 *
 * Two jobs in one surface, per the
 * build brief: (1) the list/search/jump-to-target Name Manager itself, and (2) the FAST PATH to
 * define a name from the current selection — rather than a second popup for that, the "New
 * name" row at the top is always live-bound to whatever is currently selected (its "Refers to"
 * readout tracks `selRange` the whole time the panel is open), so opening this panel with
 * something already selected and typing a name IS the fast path.
 *
 * Delete never blocks (see lib/namedRanges.js's own header for why) — each row shows its live
 * usage count instead, so the blast radius is visible without a confirmation dialog standing in
 * the way.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import {
  validateNameText, namesList, nameUsageCount, rectFromSelRange, rectToAddressText,
} from "../lib/namedRanges.js";

// Literal duplicates of designTokens.js's FONT_SIZE.control (12) / FONT_SIZE.label (10.5) —
// NOT an import. SitePlanner.jsx (the Site route) already imports designTokens.js directly for
// SPACE/CONTROL_H, so a second importer from this Model-only lazy chunk would pull it into a
// NEW shared chunk that leaks onto the Site route's bundle allowlist (the exact trap
// Ribbon.jsx's own header documents, and the exact one measured here: `bundle.siteRouteAllowlist`
// failed on first attempt with precisely a stray "designTokens" chunk). Ribbon.jsx already
// established this "duplicate the number, document why" pattern for CTRL_H/GROUP_GAP; this
// mirrors it. design-drift-audit.mjs checks the NUMBER against FONT_SIZE's values, not whether
// it came from an import, so these literals are exactly as on-scale as the token would be.
const FS_CONTROL = 12; // designTokens.js FONT_SIZE.control
const FS_LABEL = 10.5; // designTokens.js FONT_SIZE.label

const fieldStyle = {
  flex: 1, minWidth: 0, font: "inherit", fontSize: FS_CONTROL, padding: "4px 7px",
  borderRadius: RADIUS.sm, border: "1px solid var(--border-default)",
  background: "var(--surface-page)", color: "var(--text-primary)",
};
const smallBtnStyle = (enabled = true) => ({
  height: 24, padding: "0 8px", display: "inline-flex", alignItems: "center", justifyContent: "center",
  borderRadius: RADIUS.sm, border: "1px solid var(--border-default)", background: "var(--surface-page)",
  color: enabled ? "var(--text-primary)" : "var(--text-tertiary)", cursor: enabled ? "pointer" : "default",
  opacity: enabled ? 1 : 0.5, fontSize: FS_LABEL, font: "inherit",
});

function NewNameRow({ sheet, selRange, onDefineName }) {
  const [text, setText] = useState("");
  const rect = useMemo(() => rectFromSelRange(selRange), [selRange]);
  const validation = text.trim() ? validateNameText(text, sheet) : null;
  const canCreate = !!(validation && validation.ok);

  const create = () => {
    if (!canCreate) return;
    onDefineName(validation.text, rect);
    setText("");
  };

  return (
    <div style={{ padding: 8, borderBottom: "1px solid var(--border-default)", display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          data-testid="name-manager-new-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); create(); }
            else if (e.key === "Escape") { e.preventDefault(); setText(""); e.currentTarget.blur(); }
          }}
          placeholder="New name…"
          style={{ ...fieldStyle, borderColor: text.trim() && !canCreate ? "var(--danger)" : "var(--border-default)" }}
        />
        <button type="button" data-testid="name-manager-create" onClick={create} disabled={!canCreate} style={smallBtnStyle(canCreate)}>
          Define
        </button>
      </div>
      <div style={{ fontSize: FS_LABEL, color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
        Refers to: <span style={{ color: "var(--text-secondary)", fontWeight: 650 }}>{rectToAddressText(rect)}</span>
      </div>
      {text.trim() && !canCreate && (
        <div data-testid="name-manager-new-error" style={{ fontSize: FS_LABEL, color: "var(--danger)" }}>{validation.reason}</div>
      )}
    </div>
  );
}

function NameRow({ entry, sheet, selRange, onGoTo, onRenameName, onRetargetName, onDeleteName }) {
  const [renaming, setRenaming] = useState(false);
  const [renameText, setRenameText] = useState(entry.name);
  useEffect(() => { if (!renaming) setRenameText(entry.name); }, [entry.name, renaming]);
  const usage = nameUsageCount(sheet, entry.name);
  const validation = renaming && renameText.trim() ? validateNameText(renameText, sheet, { excludeKey: entry.key }) : null;
  const renameOk = renameText.trim() === entry.name || !!(validation && validation.ok);

  const commitRename = () => {
    const trimmed = renameText.trim();
    if (!trimmed || trimmed === entry.name) { setRenaming(false); setRenameText(entry.name); return; }
    if (!validation || !validation.ok) return;
    onRenameName(entry.name, validation.text);
    setRenaming(false);
  };

  return (
    <div data-testid="name-manager-row" style={{ padding: "7px 8px", borderBottom: "1px solid var(--border-default)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {renaming ? (
          <input
            autoFocus
            value={renameText}
            onChange={(e) => setRenameText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitRename(); }
              else if (e.key === "Escape") { e.preventDefault(); setRenaming(false); setRenameText(entry.name); }
            }}
            onBlur={commitRename}
            style={{ ...fieldStyle, borderColor: renameText.trim() && !renameOk ? "var(--danger)" : "var(--border-default)" }}
          />
        ) : (
          <button
            type="button" title="Rename" onClick={() => setRenaming(true)}
            style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "text", font: "inherit", fontSize: 13, fontWeight: 650, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >{entry.name}</button>
        )}
        <button type="button" title="Jump to this name's target" onClick={() => onGoTo(entry.r1 - 1, entry.c1 - 1, entry.r2 - 1, entry.c2 - 1)} style={smallBtnStyle()}>Go</button>
        <button type="button" title="Point this name at the current selection" onClick={() => onRetargetName(entry.name, rectFromSelRange(selRange))} style={smallBtnStyle()}>Use selection</button>
        <button type="button" title={`Delete "${entry.name}"`} aria-label={`Delete ${entry.name}`} onClick={() => onDeleteName(entry.name)} style={{ ...smallBtnStyle(), width: 24, padding: 0, color: "var(--danger)" }}>✕</button>
      </div>
      <div style={{ marginTop: 3, display: "flex", justifyContent: "space-between", fontSize: FS_LABEL, color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
        <span>{rectToAddressText(entry)}</span>
        <span>{usage === 0 ? "not used" : usage === 1 ? "1 formula" : `${usage} formulas`}</span>
      </div>
      {renaming && renameText.trim() && !renameOk && (
        <div style={{ marginTop: 3, fontSize: FS_LABEL, color: "var(--danger)" }}>{validation.reason}</div>
      )}
    </div>
  );
}

export default function NameManager({ open, sheet, selRange, onClose, onGoTo, onDefineName, onRenameName, onRetargetName, onDeleteName }) {
  const [search, setSearch] = useState("");
  const searchRef = useRef(null);
  useEffect(() => { if (open) { setSearch(""); searchRef.current?.focus(); } }, [open]);

  if (!open) return null;

  const q = search.trim().toLowerCase();
  const rows = namesList(sheet).filter((n) => !q || n.name.toLowerCase().includes(q));

  return (
    // NEW-1 (B1251888) — same fix as FindReplaceBar.jsx: renders IN NORMAL FLOW, never
    // `position: fixed`. This panel carried the identical `top: 46, right: 16` overlay that
    // broke the moment Formula Auditing moved into the header row it was floating over.
    <div data-testid="name-manager-row" style={{ flex: "none", display: "flex", justifyContent: "flex-end", margin: "0 8px" }}>
    <div
      role="dialog"
      aria-label="Name Manager"
      data-testid="name-manager"
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }}
      style={{
        display: "flex", flexDirection: "column", marginBottom: 8,
        width: 320, maxHeight: "min(70vh, 520px)",
        borderRadius: RADIUS.md, border: "1px solid var(--border-default)", background: "var(--surface-raised)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)", // design-exempt: no shadow-color token exists repo-wide (FindReplaceBar's own popPanel carries the identical gap)
        overflow: "hidden",
      }}
    >
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, padding: 8, borderBottom: "1px solid var(--border-default)" }}>
        <span style={{ flex: 1, fontSize: FS_CONTROL, fontWeight: 700, color: "var(--text-primary)" }}>Name Manager</span>
        <button type="button" title="Close (Esc)" onClick={onClose} style={{ ...smallBtnStyle(), width: 24, padding: 0 }}>✕</button>
      </div>
      <div style={{ flex: "none", padding: 8, borderBottom: "1px solid var(--border-default)" }}>
        <input
          ref={searchRef}
          data-testid="name-manager-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search names…"
          style={fieldStyle}
        />
      </div>
      <NewNameRow sheet={sheet} selRange={selRange} onDefineName={onDefineName} />
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {rows.length === 0 ? (
          <div style={{ padding: 16, textAlign: "center", fontSize: FS_CONTROL, color: "var(--text-tertiary)" }}>
            {q ? "No names match your search." : "No named ranges yet — select a cell or range above and give it a name."}
          </div>
        ) : (
          rows.map((entry) => (
            <NameRow
              key={entry.key} entry={entry} sheet={sheet} selRange={selRange}
              onGoTo={onGoTo} onRenameName={onRenameName} onRetargetName={onRetargetName} onDeleteName={onDeleteName}
            />
          ))
        )}
      </div>
    </div>
    </div>
  );
}
