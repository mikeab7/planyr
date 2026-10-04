/* ReviewTrash — the ONE implementation of "delete a Library file → Recently deleted → restore / delete forever".
 *
 * Extracted from FileBrowser (NEW-F3 / NEW-4) so the project folder tree's list AND the no-project Home
 * (Recent + Unfiled) share it instead of Home growing a second copy (B2086368: Home had no delete at all, so a file
 * saved from Review with no project could never be removed). Everything here is soft-delete semantics:
 * `deleteReview` stamps deleted_at (row, markups and bytes all kept ~30 days), `restoreReview` clears it,
 * `purgeReview` is the only hard delete and sits behind a two-step confirm.
 *
 *   useReviewTrash({ titleOf, refresh }) → state + handlers (del / undoDelete / restoreRow / purgeRow)
 *   <TrashNotice>       — the loud failure / stranded-bytes rail (never a silent dead click)
 *   <UndoToast>         — ~10s "Moved … to Recently deleted · Undo"
 *   <RecentlyDeletedList> — the bin: Restore + Delete forever (two-step)
 *   <DeleteButton>      — the ✕ with the confirm, for any file row (44px target on coarse pointers)
 */
import { useRef, useState } from "react";
import { deleteReview, restoreReview, purgeReview } from "../../doc-review/lib/reviewStore.js";
import { friendlySaveError } from "../../../shared/sitePlans/lib/overlayErrors.js";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";

export const FileTypeIcon = ({ kind }) => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", color: "var(--text-tertiary)" }}>
    {kind === "stitch"
      ? <><rect x="2" y="3" width="5.5" height="10" rx="1" /><rect x="8.5" y="3" width="5.5" height="10" rx="1" /></>
      : <><path d="M4 1.7h5l3 3v9.6H4z" /><path d="M9 1.7v3h3" /></>}
  </svg>
);

/* `titleOf(id)` names the file for the undo toast; `refresh()` re-reads the caller's lists afterwards. */
export function useReviewTrash({ titleOf, refresh }) {
  const [pendingDel, setPendingDel] = useState(null);     // two-step arm for the ✕
  const [pendingPurge, setPendingPurge] = useState(null); // two-step arm for "Delete forever"
  const [delNotice, setDelNotice] = useState(null);
  const [undoDel, setUndoDel] = useState(null);           // { id, title }
  const undoTimer = useRef(null);

  // Delete = move to Recently deleted (soft) — restorable for ~30 days. The pre-migration degrade path can still
  // hard-delete (r.soft absent); its cleanup failures stay loud (NEW-4).
  const del = async (id) => {
    setPendingDel(null);
    const title = titleOf(id) || "file";
    const r = await deleteReview(id);
    if (r && (r.orphaned || r.cleanupFailed)) setDelNotice({ orphaned: r.orphaned || 0, sharedKept: r.sharedKept || 0 });
    if (r && r.ok && r.soft && r.removed > 0) { // undo toast ONLY for a delete that really landed (B757 removed-count honesty)
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndoDel({ id, title });
      undoTimer.current = setTimeout(() => setUndoDel(null), 10000);
    } else if (!r || !r.ok || (r.soft && r.removed === 0)) {
      setDelNotice({ deleteFailed: true }); // a failed/0-row delete is never a silent dead click (NEW-4)
    }
    refresh();
  };
  const undoDelete = async () => {
    const u = undoDel;
    setUndoDel(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (!u) return;
    const r = await restoreReview(u.id);
    if (!r.ok) setDelNotice({ restoreFailed: true }); // never silent (NEW-4)
    refresh();
  };
  const restoreRow = async (id) => {
    const r = await restoreReview(id);
    if (!r.ok) setDelNotice({ restoreFailed: true });
    refresh();
  };
  // "Delete forever" out of Recently deleted — the only user-facing hard delete (NEW-F3). A document with a site-plan
  // overlay still built from it REFUSES this outright (B972512-HARDENING) — a real failure, checked first.
  const purgeRow = async (id) => {
    setPendingPurge(null);
    const r = await purgeReview(id);
    if (!r || !r.ok) setDelNotice({ purgeBlocked: friendlySaveError(r && r.error) });
    else if (r.orphaned || r.cleanupFailed) setDelNotice({ orphaned: r.orphaned || 0, sharedKept: r.sharedKept || 0 });
    refresh();
  };
  return { pendingDel, setPendingDel, pendingPurge, setPendingPurge, delNotice, setDelNotice, undoDel, setUndoDel, del, undoDelete, restoreRow, purgeRow };
}

export function TrashNotice({ notice, onDismiss, style }) {
  if (!notice) return null;
  return (
    <div role="alert" data-testid="trash-notice" style={{ flex: "none", margin: "8px 12px 0", padding: "7px 10px", borderRadius: 7, display: "flex", alignItems: "center", gap: 8,
      border: "1px solid var(--warn-border)", background: "var(--warn-bg)", color: "var(--warn-text)", fontSize: 11.5, lineHeight: 1.45, ...style }}>
      <span style={{ flex: 1 }}>
        {notice.restoreFailed ? "Couldn’t restore that file — check your connection and try again from Recently deleted."
          : notice.deleteFailed ? "Couldn’t delete that file — it may already be deleted, or the cloud is unreachable. Refresh and try again."
          : notice.purgeBlocked ? notice.purgeBlocked
          : notice.purgeFailed ? "Couldn’t fully clear expired items from Recently deleted — anything left will be retried next time this list loads."
          : <>Deleted — but {notice.orphaned ? `${notice.orphaned} ` : ""}file{notice.orphaned === 1 ? "" : "s"} couldn’t be removed from storage, so a copy may linger. You can remove it directly in Google Drive.{notice.sharedKept ? ` ${notice.sharedKept} stored file${notice.sharedKept === 1 ? " was" : "s were"} kept because another drawing still uses ${notice.sharedKept === 1 ? "it" : "them"}.` : ""}</>}
      </span>
      <button onClick={onDismiss} title="Dismiss" aria-label="Dismiss" style={{ flex: "none", border: "none", background: "transparent", color: "var(--warn-text)", cursor: "pointer", fontSize: FONT_SIZE.emphasis, fontWeight: 700, padding: 2 }}>✕</button>
    </div>
  );
}

export function UndoToast({ undo, onUndo, onDismiss }) {
  if (!undo) return null;
  return (
    <div role="status" data-testid="trash-undo" style={{ position: "absolute", bottom: 14, right: 14, zIndex: 6, display: "flex", alignItems: "center", gap: 10,
      padding: "9px 14px", borderRadius: 9, background: "var(--surface-raised)", border: "1px solid var(--border-default)",
      boxShadow: "0 4px 16px rgba(0,0,0,0.18)", fontSize: FONT_SIZE.control, color: "var(--text-primary)" }}>
      <span style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        Moved “{undo.title}” to Recently deleted.
      </span>
      <button onClick={onUndo} title="Put it right back"
        style={{ flex: "none", fontSize: 11.5, fontFamily: "inherit", fontWeight: 800, cursor: "pointer", borderRadius: 7, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)", padding: "3px 12px" }}>Undo</button>
      <button onClick={onDismiss} title="Dismiss" aria-label="Dismiss" style={{ flex: "none", border: "none", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: FONT_SIZE.emphasis, fontWeight: 700, padding: 2 }}>✕</button>
    </div>
  );
}

/* The bin. Rows are soft-deleted doc_reviews — everything (markups, bytes, index) is still intact. */
export function RecentlyDeletedList({ rows, pendingPurge, setPendingPurge, onRestore, onPurge }) {
  return (
    <div data-testid="recently-deleted">
      <div style={{ fontSize: 11.5, color: "var(--text-secondary)", padding: "4px 4px 10px", lineHeight: 1.5 }}>
        Deleted files wait here about 30 days, then clear out on their own. Restore brings
        everything back — the drawing and your markups.
      </div>
      {rows.length === 0 && <div style={{ fontSize: 12.5, color: "var(--text-secondary)", padding: 12 }}>Nothing in Recently deleted.</div>}
      {rows.map((d) => (
        <div key={d.id} data-testid="deleted-row" data-review-id={d.id} style={{ border: "1px solid var(--border-default)", borderRadius: 8, padding: "8px 10px", marginBottom: 6, background: "var(--surface-raised)", display: "flex", alignItems: "center", gap: 9 }}>
          <FileTypeIcon kind={d.kind} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {d.title || d.item || d.sfile || "Untitled"}
            </span>
            <span style={{ display: "block", fontSize: FONT_SIZE.label, color: "var(--text-tertiary)", marginTop: 2 }}>
              Deleted {(() => { try { return new Date(d.deleted_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch (_) { return ""; } })()}
              {d.project ? ` · ${d.project}` : ""}
            </span>
          </span>
          <button onClick={() => onRestore(d.id)} title="Put this file back in the Library" data-testid="deleted-restore"
            style={{ flex: "none", fontSize: FONT_SIZE.label, fontFamily: "inherit", fontWeight: 700, cursor: "pointer", borderRadius: RADIUS.md, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)", padding: "3px 10px" }}>Restore</button>
          {pendingPurge === d.id ? (
            <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 5, fontSize: FONT_SIZE.label, color: "var(--danger-text)", fontWeight: 700 }}>
              Delete forever — markups too?
              <button onClick={() => onPurge(d.id)} title="Permanently delete this file and its markups" aria-label="Confirm delete forever" data-testid="deleted-purge-confirm" style={{ border: "none", background: "transparent", color: "var(--danger-text)", cursor: "pointer", fontSize: FONT_SIZE.emphasis, fontWeight: 700, padding: 2 }}>✓</button>
              <button onClick={() => setPendingPurge(null)} title="Cancel" aria-label="Cancel" style={{ border: "none", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: FONT_SIZE.emphasis, padding: 2 }}>✕</button>
            </span>
          ) : (
            <button onClick={() => setPendingPurge(d.id)} title="Permanently delete (cannot be undone)" data-testid="deleted-purge"
              style={{ flex: "none", fontSize: FONT_SIZE.label, fontFamily: "inherit", fontWeight: 600, cursor: "pointer", borderRadius: RADIUS.md, border: "1px solid var(--border-default)", background: "transparent", color: "var(--danger-text)", padding: "3px 8px" }}>Delete forever</button>
          )}
        </div>
      ))}
    </div>
  );
}

/* The ✕ + its two-step confirm for one file row. `armed` = this row's confirm is showing. The 44px coarse-pointer
 * target comes from the `.trash-del` rule in index.css (a media query — inline styles cannot express it). */
export function DeleteButton({ id, armed, onArm, onCancel, onConfirm, label = "file" }) {
  if (armed) {
    return (
      <span style={{ flex: "none", display: "flex", alignItems: "center", gap: 5, fontSize: FONT_SIZE.label, color: "var(--text-secondary)", fontWeight: 700, whiteSpace: "nowrap" }}>
        Move to Recently deleted?
        <button className="trash-del" onClick={() => onConfirm(id)} title="Yes — move it (restorable ~30 days)" aria-label={`Yes, move “${label}” to Recently deleted`} data-testid="trash-confirm" autoFocus
          style={{ border: "none", background: "transparent", color: "var(--danger-text)", cursor: "pointer", fontSize: FONT_SIZE.emphasis, fontWeight: 700, padding: 2 }}>✓</button>
        <button className="trash-del" onClick={onCancel} title="Cancel" aria-label="Cancel" style={{ border: "none", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: FONT_SIZE.emphasis, padding: 2 }}>✕</button>
      </span>
    );
  }
  return (
    <button className="trash-del" onClick={() => onArm(id)} title="Delete (moves to Recently deleted)" aria-label={`Delete “${label}” (moves to Recently deleted)`} data-testid="trash-delete"
      style={{ flex: "none", border: "none", background: "transparent", color: "var(--danger-text)", cursor: "pointer", fontSize: FONT_SIZE.display, padding: 3 }}>✕</button>
  );
}
