/* "Version history" for one Library file (B2022929 / NEW-1) — a side panel on a desktop, a bottom sheet on a
 * phone (never wider than the screen, so nothing scrolls sideways). It only LISTS and ASKS: opening, restoring
 * and copying are done by the Review root, which owns the bytes. It never deletes a version and never downloads. */
import { useState } from "react";
import { Button } from "../../../shared/ui/controls.jsx";
import { versionDateLabel, fmtVersionSize, canOpenEarlier } from "../lib/docVersions.js";

const FS = { row: "12.5px", meta: "11.5px", head: "13px" }; // design-exempt: sheet-local reading scale
const CSS = `
.vh-scrim{position:fixed;inset:0;background:var(--scrim, rgba(0,0,0,.25));z-index:60}
.vh-sheet{position:fixed;top:0;right:0;bottom:0;width:min(400px,100vw);max-width:100vw;box-sizing:border-box;background:var(--surface-raised);color:var(--text-primary);border-left:1px solid var(--border-default);z-index:61;display:flex;flex-direction:column;font-family:system-ui,sans-serif;overflow-x:hidden}
.vh-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid var(--border-default);font-size:${FS.head};font-weight:700}
.vh-list{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:8px 12px;display:flex;flex-direction:column;gap:8px}
.vh-row{border:1px solid var(--border-default);border-radius:8px;padding:8px 10px;background:var(--surface-page);font-size:${FS.row};overflow-wrap:anywhere;min-width:0}
.vh-row.viewing{border-color:var(--accent-review)}
.vh-meta{font-size:${FS.meta};color:var(--text-secondary)}
.vh-tag{font-size:${FS.meta};font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text-secondary)}
.vh-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.vh-note{font-size:${FS.meta};color:var(--text-secondary);padding:8px 12px;border-top:1px solid var(--border-default);overflow-wrap:anywhere}
.vh-note.err{color:var(--danger-text);background:var(--danger-bg)}
.vh-note.warn{color:var(--warn-text);background:var(--warn-bg)}
@media (max-width:640px){.vh-sheet{top:auto;left:0;right:0;width:100%;max-height:82vh;border-left:0;border-top:1px solid var(--border-default);border-radius:12px 12px 0 0}}
`;

export default function VersionHistorySheet({ fileName, versions, isDoc, viewingSrcId = null, busy = false, dirty = false, signedIn = true, message = "", error = "", onOpen, onRestore, onCopy, onBackToLatest, onClose }) {
  const [armed, setArmed] = useState(null); // `${action}:${srcId}` waiting for a second tap because it would discard unsaved edits
  const can = canOpenEarlier(versions, isDoc);
  const act = (kind, v, fn) => () => {
    if (busy) return;
    if (dirty && armed !== `${kind}:${v.srcId}`) { setArmed(`${kind}:${v.srcId}`); return; }
    setArmed(null); fn(v);
  };
  const lbl = (kind, v, text) => (armed === `${kind}:${v.srcId}` ? "Discard my edits and continue" : text);
  return (
    <>
      <div className="vh-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="vh-sheet" role="dialog" aria-label="Version history" data-testid="version-history">
        <style>{CSS}</style>
        <div className="vh-head">
          <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>Version history{fileName ? ` — ${fileName}` : ""}</span>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close version history" data-testid="vh-close">✕</Button>
        </div>
        <div className="vh-list">
          {versions.map((v) => (
            <div key={v.srcId} className={`vh-row${viewingSrcId === v.srcId ? " viewing" : ""}`} data-testid="vh-row" data-current={v.isCurrent ? "1" : "0"}>
              <div><b>Version {v.number}</b> {v.isCurrent && <span className="vh-tag">· Latest</span>}{viewingSrcId === v.srcId && <span className="vh-tag"> · Viewing</span>}</div>
              <div>{versionDateLabel(v.savedAt)}</div>
              <div className="vh-meta">{v.savedBy ? `Saved by ${v.savedBy}` : "Saved by — not recorded"} · {fmtVersionSize(v.size)}{v.restoredFrom ? " · restored from an earlier version" : ""}</div>
              {can && (
                <div className="vh-acts">
                  {v.isCurrent
                    ? (viewingSrcId ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => onBackToLatest && onBackToLatest()} data-testid="vh-latest">Back to latest</Button> : null)
                    : (<>
                        <Button size="sm" variant="ghost" disabled={busy || !v.readable} onClick={act("open", v, onOpen)} data-testid="vh-open">{lbl("open", v, "Open (read-only)")}</Button>
                        <Button size="sm" variant="primary" disabled={busy || !v.readable} onClick={act("restore", v, onRestore)} data-testid="vh-restore">{lbl("restore", v, "Restore")}</Button>
                        <Button size="sm" variant="ghost" disabled={busy || !v.readable || !signedIn} onClick={act("copy", v, onCopy)} data-testid="vh-copy">{lbl("copy", v, "Save a copy")}</Button>
                      </>)}
                </div>
              )}
            </div>
          ))}
        </div>
        {!isDoc && <div className="vh-note" data-testid="vh-pdf-note">Drawings keep one stored file. A re-issued drawing is filed as its own Library file and the older one is marked superseded, so there are no earlier saves to open here.</div>}
        {isDoc && versions.length <= 1 && <div className="vh-note" data-testid="vh-single-note">Only one version so far. Each time you Save, the earlier one is kept and shows up here.</div>}
        {isDoc && can && !signedIn && <div className="vh-note warn">Signed out: a restore stays on this device only. Sign in to save a copy to the Library.</div>}
        {busy && <div className="vh-note" role="status">Working…</div>}
        {message && <div className="vh-note" role="status" data-testid="vh-message">{message}</div>}
        {error && <div className="vh-note err" role="alert" data-testid="vh-error">{error}</div>}
        {isDoc && can && <div className="vh-note">Restoring saves that content as a new latest version. Nothing is ever deleted.</div>}
      </aside>
    </>
  );
}
