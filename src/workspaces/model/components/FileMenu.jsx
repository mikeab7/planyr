/* Model workspace — the Excel round-trip entry point (NEW-1, owner chat block). One small "File"
 * button in AppHeader's row-1 toolbar slot, which this workspace has left empty since the
 * ICONOGRAPHY pass moved Undo/Redo into the Ribbon (see ModelApp.jsx's own note on that).
 *
 * ⛔ SCOPE GUARD (owner, verbatim): CSV is deliberately the LESSER path and must never become the
 * default or primary button. The menu below states that in its ORDER (Excel first, a divider,
 * CSV after) and in its COPY ("Download active sheet as CSV" reads as the narrower, secondary
 * action next to "Download as Excel (.xlsx)") — no separate visual-weight mechanism was invented
 * for this; MenuItem has none, and adding one JUST for this menu is exactly the over-abstraction
 * the build rules ask this session not to do.
 *
 * Hidden <input type="file"> elements are the standard way to reach the OS file picker from a
 * plain button — clicking the visible button proxies a click onto the hidden input.
 */
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import { Button, MenuItem, menuPanelStyle } from "../../../shared/ui/controls.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";

function Icon({ children }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: "block", flex: "none" }}>
      {children}
    </svg>
  );
}
function IconFile() { return <Icon><path d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><polyline points="14 3 14 9 20 9" /></Icon>; }

const chromeBtnStyle = {
  display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 10px",
  borderRadius: RADIUS.pill, border: "1px solid var(--chrome-divider)", background: "var(--chrome-bg-elev)",
  color: "var(--chrome-text)", font: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer",
};

// ⛔ NEW-1 (command palette) — `forwardRef` exposing `openImportXlsx`/`openImportCsv`, which just
// click the SAME hidden `<input type=file>` refs the menu's own "Import Excel…"/"Import CSV…"
// rows already click — so a palette-driven import opens the identical OS file picker through the
// identical DOM node, never a second import trigger.
const FileMenu = forwardRef(function FileMenu({ busy, notice, confirmReplace, onExportXlsx, onExportCsv, onImportXlsxFile, onImportCsvFile }, ref) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const xlsxInputRef = useRef(null);
  const csvInputRef = useRef(null);

  useImperativeHandle(ref, () => ({
    openImportXlsx: () => xlsxInputRef.current?.click(),
    openImportCsv: () => csvInputRef.current?.click(),
  }), []);

  const pick = (fn, ...args) => { setOpen(false); fn(...args); };
  const onXlsxFileChosen = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // so re-choosing the SAME file still fires a change event next time
    if (file) onImportXlsxFile(file);
  };
  const onCsvFileChosen = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (file) onImportCsvFile(file);
  };

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        type="button" ref={anchorRef} data-testid="model-file-menu-btn" title="Export or import this workbook"
        aria-haspopup="true" disabled={busy} onClick={() => setOpen((o) => !o)}
        style={{ ...chromeBtnStyle, opacity: busy ? 0.6 : 1, cursor: busy ? "default" : "pointer" }}
      >
        <IconFile /><span>File</span><span aria-hidden="true" style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>
      {confirmReplace ? (
        // NEW-1 (owner chat block) — the inline, no-`window.confirm` shape this app already uses
        // for every other destructive action (ReviewsBar.jsx / VisitPanel.jsx / CompEntryGrid.jsx's
        // DiscardCloseConfirm). Shown INSTEAD OF `notice` while it's up — a plain click discarding
        // real work is exactly what this replaces.
        <span
          data-testid="model-import-replace-confirm" role="alertdialog"
          style={{
            display: "inline-flex", alignItems: "center", gap: 8, padding: "3px 9px 3px 10px",
            borderRadius: RADIUS.pill, background: "var(--danger-bg)", border: "1px solid var(--danger-border)",
          }}
        >
          <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--danger)" }}>{confirmReplace.text}</span>
          <Button size="sm" variant="ghost" onClick={confirmReplace.onCancel}>Keep this workbook</Button>
          <Button size="sm" variant="danger" onClick={confirmReplace.onConfirm}>Replace</Button>
        </span>
      ) : notice && (
        <span
          data-testid="model-file-notice" role="status"
          style={{
            fontSize: 10.5, fontWeight: 600, padding: "3px 9px", borderRadius: RADIUS.pill, maxWidth: 420,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            background: notice.kind === "error" ? "var(--danger-bg)" : "var(--warn-bg)",
            border: `1px solid ${notice.kind === "error" ? "var(--danger-border)" : "var(--warn-border)"}`,
            color: notice.kind === "error" ? "var(--danger)" : "var(--warn-text)",
          }}
          title={notice.text}
        >{notice.text}</span>
      )}
      <AnchoredMenu open={open} onClose={() => setOpen(false)} anchorRef={anchorRef} placement="below-left" width={260} panelStyle={menuPanelStyle}>
        <div>
          <MenuItem data-testid="model-export-xlsx" onClick={() => pick(onExportXlsx)}>Download as Excel (.xlsx)</MenuItem>
          <MenuItem data-testid="model-export-csv" onClick={() => pick(onExportCsv)}>Download active sheet as CSV</MenuItem>
          <div style={{ height: 1, margin: "4px 0", background: "var(--border-default)" }} />
          <MenuItem data-testid="model-import-xlsx" title="Replaces every sheet in this workbook — asks first if you've already got something here" onClick={() => { setOpen(false); xlsxInputRef.current?.click(); }}>
            Import Excel (replaces workbook)…
          </MenuItem>
          <MenuItem data-testid="model-import-csv" title="Adds a new sheet — your other sheets are untouched" onClick={() => { setOpen(false); csvInputRef.current?.click(); }}>
            Import CSV (new sheet)…
          </MenuItem>
        </div>
      </AnchoredMenu>
      <input ref={xlsxInputRef} type="file" accept=".xlsx" onChange={onXlsxFileChosen} style={{ display: "none" }} data-testid="model-import-xlsx-input" />
      <input ref={csvInputRef} type="file" accept=".csv" onChange={onCsvFileChosen} style={{ display: "none" }} data-testid="model-import-csv-input" />
    </span>
  );
});

export default FileMenu;
