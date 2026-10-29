/* The strip that tells the person what Spreadsheet is showing when it is a Library FILE (NEW-1,
 * "open an uploaded Excel in Spreadsheet"): which file, where its edits go, anything the file
 * contains that this module can't show, and a save problem if there is one. Module-scope components
 * only (MODULE-SCOPE-COMPONENTS). Theme tokens only — no raw colours, radii or font sizes. */
import { useEffect, useState } from "react";
import { Button } from "../../../shared/ui/controls.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE, SPACE } from "../../../shared/ui/designTokens.js";

const barStyle = (tone) => ({
  flex: "none", display: "flex", alignItems: "center", flexWrap: "wrap", gap: SPACE.md,
  margin: `${SPACE.md}px ${SPACE.md}px 0`, padding: `${SPACE.sm}px ${SPACE.xl}px`, borderRadius: RADIUS.md,
  fontSize: FONT_SIZE.control, lineHeight: 1.45, color: "var(--text-primary)",
  background: tone === "danger" ? "var(--danger-bg)" : tone === "warn" ? "var(--warn-bg)" : "var(--surface-raised)",
  border: `1px solid ${tone === "danger" ? "var(--danger)" : tone === "warn" ? "var(--warn-border)" : "var(--border-default)"}`,
});

/** The file line + the save problem (if any). */
export function FileBar({ name, inPlace, saving, saveError, conflict, hasOriginal, onClose, onRetry, onReload, onDownloadOriginal }) {
  return (
    <div data-testid="model-file-bar" style={barStyle(saveError ? "danger" : "plain")} role={saveError ? "alert" : undefined}>
      <span style={{ fontWeight: 700, minWidth: 0, overflowWrap: "anywhere" }} data-testid="model-file-name">{name}</span>
      <span style={{ color: "var(--text-secondary)" }}>
        {saveError ? "" : saving ? "Saving to your Library…" : inPlace ? "From your Library · edits save to this file" : "From your Library · edits save to a new Excel copy"}
      </span>
      {saveError && <span style={{ flex: "1 1 260px", fontWeight: 600 }} data-testid="model-file-save-error">{saveError} Your edits are kept on this device.</span>}
      {saveError && !conflict && <Button size="sm" variant="ghost" onClick={onRetry} data-testid="model-file-retry">Try again</Button>}
      {conflict && <Button size="sm" variant="ghost" onClick={onReload} data-testid="model-file-reload">Show the Library’s version</Button>}
      <span style={{ flex: 1 }} />
      {hasOriginal && <Button size="sm" variant="ghost" onClick={onDownloadOriginal} data-testid="model-file-download-original" title="Download the file exactly as you first uploaded it">Download original</Button>}
      <Button size="sm" variant="ghost" onClick={onClose} data-testid="model-file-close" title="Close this file and go back to the project’s own spreadsheet">Close file</Button>
    </div>
  );
}

/** "What this file has that won't carry over" and the other plain heads-ups. Dismissible per open. */
export function FileNotes({ notes, fileKey }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => { setHidden(false); }, [fileKey, notes]);
  if (!notes || !notes.length || hidden) return null;
  const warn = notes.some((n) => ["unsupported", "macros-save", "formulas", "merges", "xls", "hidden", "stale-draft"].includes(n.key));
  return (
    <div data-testid="model-file-notes" role="note" style={barStyle(warn ? "warn" : "plain")}>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", flex: "1 1 320px", minWidth: 0 }}>
        {notes.map((n) => <li key={n.key} data-note={n.key} style={{ overflowWrap: "anywhere" }}>{n.text}</li>)}
      </ul>
      <Button size="sm" variant="ghost" onClick={() => setHidden(true)} data-testid="model-file-notes-dismiss">Got it</Button>
    </div>
  );
}

/** Opening failed: a plain message naming the file and what to do — never a blank grid. */
export function FileProblem({ message, onRetry, onClose, canRetry }) {
  return (
    <div data-testid="model-file-problem" role="alert" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: SPACE.xxl, background: "var(--surface-page)" }}>
      <div style={{ maxWidth: 460, textAlign: "center" }}>
        <h2 style={{ margin: `0 0 ${SPACE.md}px`, fontSize: FONT_SIZE.display, fontWeight: 700, color: "var(--text-primary)" }}>This file couldn’t be opened</h2>
        <p style={{ margin: `0 0 ${SPACE.xxl}px`, fontSize: FONT_SIZE.emphasis, lineHeight: 1.6, color: "var(--text-primary)" }} data-testid="model-file-problem-text">{message}</p>
        <div style={{ display: "flex", gap: SPACE.md, justifyContent: "center" }}>
          {canRetry && <Button variant="ghost" onClick={onRetry} data-testid="model-file-open-retry">Try again</Button>}
          <Button onClick={onClose} data-testid="model-file-problem-close">Back to the spreadsheet</Button>
        </div>
      </div>
    </div>
  );
}

export function FileLoading({ name }) {
  return (
    <div data-testid="model-file-loading" role="status" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: SPACE.xxl, background: "var(--surface-page)", color: "var(--text-primary)", fontSize: FONT_SIZE.emphasis }}>
      Opening {name ? `“${name}”` : "your file"}…
    </div>
  );
}
