/* OrgWorkbookPicker — the landing list for the Spreadsheet workspace at ORGANIZATION scope
 * (NEW-1, B1912209). A project's Spreadsheet has exactly one workbook (model_sheets, id = the
 * project id); Organization scope holds SEVERAL — a portfolio pro forma, a pipeline tracker, a
 * cost database — so it needs a real list to choose from before the grid/ribbon/File-menu UI
 * (unchanged, reused verbatim by ModelApp once a workbook is open) has anything to show.
 *
 * Every control here is the shared primitive set (Button/IconButton, src/shared/ui/controls.jsx)
 * — per docs/DESIGN.md, a new control is never invented at this call site. Rename is an inline
 * text editor (no dialog-box edits — root CLAUDE.md), and delete is the same inline two-step
 * confirm ReviewsBar.jsx already uses (no window.confirm) — Enter/blur commit a rename, Escape
 * abandons it (EDITOR-EXIT-CONTRACT's "text" class).
 */
import { useEffect, useRef, useState } from "react";
import { Button, IconButton } from "../../../shared/ui/controls.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";

function fmtWhen(ts) {
  if (!ts) return "";
  try { return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch (_) { return ""; }
}

function WorkbookRow({ wb, onOpen, onRename, onDelete }) {
  const [renaming, setRenaming] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => { if (renaming) inputRef.current?.focus(); }, [renaming]);

  const commitRename = () => {
    const next = (inputRef.current?.value || "").trim();
    setRenaming(false);
    if (next && next !== wb.name) onRename(wb.id, next);
  };

  return (
    <div
      data-testid="org-workbook-row"
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
        borderRadius: RADIUS.md, border: "1px solid var(--border-default)", background: "var(--surface-raised)",
      }}
    >
      {renaming ? (
        <input
          ref={inputRef}
          defaultValue={wb.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitRename(); }
            if (e.key === "Escape") { e.preventDefault(); setRenaming(false); }
          }}
          style={{ flex: 1, minWidth: 0, font: "inherit", fontSize: 13.5, fontWeight: 650, color: "var(--text-primary)", background: "var(--surface-page)", border: "1px solid var(--accent-model)", borderRadius: RADIUS.sm, padding: "3px 6px" }}
        />
      ) : (
        <button
          type="button"
          data-testid="org-workbook-open"
          onClick={() => onOpen(wb.id)}
          title={`Open “${wb.name}”`}
          style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "transparent", cursor: "pointer", padding: 0 }}
        >
          <div style={{ fontSize: 13.5, fontWeight: 650, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{wb.name}</div>
          <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{wb.updatedAt ? `Edited ${fmtWhen(wb.updatedAt)}` : "Never saved"}</div>
        </button>
      )}
      {pendingDelete ? (
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)", fontWeight: 600, whiteSpace: "nowrap" }}>
          Delete this workbook?
          <button type="button" onClick={() => { setPendingDelete(false); onDelete(wb.id); }} title="Delete" style={{ border: "none", background: "transparent", color: "var(--danger)", cursor: "pointer", fontSize: 13, fontWeight: 700, padding: 2 }}>✓</button>
          <button type="button" onClick={() => setPendingDelete(false)} title="Cancel" style={{ border: "none", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13, padding: 2 }}>✕</button>
        </div>
      ) : (
        <div style={{ flex: "none", display: "flex", gap: 4 }}>
          <IconButton size={26} onClick={() => setRenaming(true)} title="Rename">✎</IconButton>
          <IconButton size={26} onClick={() => setPendingDelete(true)} title="Delete">🗑</IconButton>
        </div>
      )}
    </div>
  );
}

export default function OrgWorkbookPicker({ workbooks, loading, notice, onOpen, onCreate, onRename, onDelete }) {
  return (
    <div style={{ flex: 1, overflow: "auto", padding: 24, display: "flex", justifyContent: "center", background: "var(--surface-page)" }}>
      <div style={{ width: "100%", maxWidth: 640 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: "var(--text-primary)" }}>Organization spreadsheets</h2>
          <Button size="sm" accent="var(--accent-model)" onClick={onCreate} data-testid="org-workbook-new">+ New workbook</Button>
        </div>
        <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "var(--text-secondary)" }}>
          Workbooks here belong to your organization, not one project — a portfolio pro forma, a pipeline tracker, a cost database.
        </p>
        {notice && <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--warn-text)" }}>{notice}</p>}
        {loading && workbooks.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>Loading…</div>
        ) : workbooks.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>No organization workbooks yet. Create one — it's visible from every project as reference.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {workbooks.map((wb) => (
              <WorkbookRow key={wb.id} wb={wb} onOpen={onOpen} onRename={onRename} onDelete={onDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
