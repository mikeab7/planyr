/* Model workspace — Find (Ctrl+F) and Replace (Ctrl+H), Stage 1.
 *
 * A floating in-app bar, never window.prompt/confirm — this repo's own KEY DECISIONS ban
 * dialog-box edits outright ("that is horrible UI"), and Find/Replace needs live Next/Prev
 * navigation + a running match count a single prompt() round-trip could never give anyway.
 * Search is over each cell's RAW text (a formula's own source, never its computed value) — the
 * same convention the formula bar already uses, so what you SEE searched is what you'd see if
 * you opened that cell to look.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { findMatches } from "../lib/sheetOps.js";
import { RADIUS } from "../../../shared/ui/radius.js";

const btnStyle = (enabled) => ({
  height: 24, width: 24, display: "grid", placeItems: "center", borderRadius: RADIUS.sm,
  border: "1px solid var(--border-default)", background: "var(--surface-page)",
  color: enabled ? "var(--text-primary)" : "var(--text-tertiary)", cursor: enabled ? "pointer" : "default",
  opacity: enabled ? 1 : 0.5, fontSize: 12,
});

export default function FindReplaceBar({ open, showReplace, sheet, onClose, onGoTo, onReplaceOne, onReplaceAll }) {
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [idx, setIdx] = useState(0); // index into `matches` — the "current" hit
  const findRef = useRef(null);

  const matches = useMemo(() => findMatches(sheet, findText), [sheet, findText]);

  // Re-focus the Find field and reset position every time the bar opens (Ctrl+F/Ctrl+H again
  // while already open just refocuses — matches every browser's own Find bar).
  useEffect(() => { if (open) { findRef.current?.focus(); findRef.current?.select(); setIdx(0); } }, [open]);
  // A changed search text always restarts at the first hit, never a stale index into a
  // completely different match list.
  useEffect(() => { setIdx(0); }, [findText]);
  // Keep the active cell on the current match as the list itself changes (typing narrows it,
  // an edit elsewhere shifts it) — never point at a match that no longer exists.
  useEffect(() => {
    if (open && matches.length) onGoTo(matches[Math.min(idx, matches.length - 1)].r, matches[Math.min(idx, matches.length - 1)].c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, matches, idx]);

  if (!open) return null;

  const go = (delta) => { if (!matches.length) return; setIdx((i) => (i + delta + matches.length) % matches.length); };

  return (
    <div
      role="dialog"
      aria-label={showReplace ? "Find and Replace" : "Find"}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); onClose(); }
        else if (e.key === "Enter") { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
      }}
      style={{
        position: "fixed", top: 46, right: 16, zIndex: 60, display: "flex", flexDirection: "column", gap: 6,
        padding: 8, borderRadius: RADIUS.md, border: "1px solid var(--border-default)", background: "var(--surface-raised)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.18)", width: 300, // design-exempt: no shadow-color token exists repo-wide yet (AnchoredMenu's own popPanel carries the identical gap)
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          ref={findRef}
          data-testid="model-find-input"
          value={findText}
          onChange={(e) => setFindText(e.target.value)}
          placeholder="Find"
          style={{ flex: 1, minWidth: 0, font: "inherit", fontSize: 12.5, padding: "4px 7px", borderRadius: RADIUS.sm, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)" }}
        />
        <span data-testid="model-find-count" style={{ flex: "none", fontSize: 11, color: "var(--text-tertiary)", minWidth: 40, textAlign: "center" }}>
          {findText ? `${matches.length ? idx + 1 : 0}/${matches.length}` : ""}
        </span>
        <button type="button" title="Previous (Shift+Enter)" onClick={() => go(-1)} disabled={!matches.length} style={btnStyle(matches.length > 0)}>↑</button>
        <button type="button" title="Next (Enter)" onClick={() => go(1)} disabled={!matches.length} style={btnStyle(matches.length > 0)}>↓</button>
        <button type="button" title="Close (Esc)" onClick={onClose} style={btnStyle(true)}>✕</button>
      </div>
      {showReplace && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            data-testid="model-replace-input"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            placeholder="Replace with"
            style={{ flex: 1, minWidth: 0, font: "inherit", fontSize: 12.5, padding: "4px 7px", borderRadius: RADIUS.sm, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)" }}
          />
          <button
            type="button" data-testid="model-replace-one"
            disabled={!matches.length}
            onClick={() => { if (matches.length) onReplaceOne(matches[idx], findText, replaceText); }}
            style={{ ...btnStyle(matches.length > 0), width: "auto", padding: "0 8px" }}
          >Replace</button>
          <button
            type="button" data-testid="model-replace-all"
            disabled={!findText}
            onClick={() => onReplaceAll(findText, replaceText)}
            style={{ ...btnStyle(!!findText), width: "auto", padding: "0 8px" }}
          >All</button>
        </div>
      )}
    </div>
  );
}
