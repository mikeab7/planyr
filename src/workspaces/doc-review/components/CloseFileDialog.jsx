/* "Save changes before closing?" prompt (NEW-1) — shown only when a Word/text file has edits that were never saved.
 * Save / Discard / Cancel: Save writes to the Library and then closes; Discard closes and drops the edits;
 * Cancel (or Escape, or a click outside) leaves the file exactly as it was. */
import { useEffect } from "react";
import { Button } from "../../../shared/ui/controls.jsx";
import { FONT_SIZE, SPACE } from "../../../shared/ui/designTokens.js";
import { RADIUS } from "../../../shared/ui/radius.js";

export default function CloseFileDialog({ name = "this file", verb = "closing", busy = false, onSave, onDiscard, onCancel }) {
  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel?.(); } };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onCancel]);
  return (
    <div data-testid="close-file-scrim" onClick={() => !busy && onCancel?.()}
      style={{ position: "absolute", inset: 0, zIndex: 40, display: "grid", placeItems: "center", padding: SPACE.xl, background: "var(--scrim, rgba(0,0,0,0.35))" }}>
      <div role="dialog" aria-modal="true" aria-label="Unsaved changes" data-testid="close-file-dialog" onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 380, boxSizing: "border-box", padding: SPACE.xl, borderRadius: RADIUS.md, background: "var(--surface-raised)", border: "1px solid var(--border-default)", boxShadow: "0 16px 44px rgba(0,0,0,0.22)", color: "var(--text-primary)", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ fontSize: FONT_SIZE.emphasis, fontWeight: 700, marginBottom: SPACE.sm }}>Save changes before {verb}?</div>
        <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)", marginBottom: SPACE.xl, overflowWrap: "anywhere" }}>
          “{name}” has changes that haven’t been saved to the Library.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: SPACE.md, justifyContent: "flex-end" }}>
          <Button variant="ghost" disabled={busy} onClick={onCancel} data-testid="close-file-cancel">Cancel</Button>
          <Button variant="ghost" disabled={busy} onClick={onDiscard} data-testid="close-file-discard">Discard</Button>
          <Button variant="primary" disabled={busy} onClick={onSave} data-testid="close-file-save">{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}
