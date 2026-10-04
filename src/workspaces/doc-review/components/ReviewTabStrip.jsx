/* Review's tab strip (NEW-1, 2026-10-04) — one tab per open file, Bluebeam-style, directly above the toolbar.
 * Shows nothing at all when no file is open (Review is then simply blank). Pure presentation: every decision
 * (open, close, reorder, which tab is next) lives in lib/reviewTabs.js and DocReview.jsx.
 *   Desktop: truncated name (full name + project on hover) · × · dot for unsaved Word/text · drag to reorder ·
 *            middle-click closes. Ctrl+W / Ctrl+Tab are deliberately NOT bound — the browser owns them.
 *   Phone:   the strip scrolls sideways, keeps the active tab in view, × only on the active tab, 44px touch targets.
 */
import { useEffect, useRef, useState } from "react";
import { tabTitle } from "../lib/reviewTabs.js";
import { useProjectNames } from "../../../shared/names/names.js";
import { FONT_SIZE, CONTROL_H, SPACE } from "../../../shared/ui/designTokens.js";
import { RADIUS } from "../../../shared/ui/radius.js";

export default function ReviewTabStrip({ tabs, activeId, dirty = {}, narrow = false, notice = "", onNotice, onSelect, onClose, onMove }) {
  const stripRef = useRef(null);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  // Keep the active tab on screen (a phone strip scrolls sideways; ten tabs overflow a desktop strip too).
  const names = useProjectNames(); // B1991040 — a tab's project label is resolved live by id, never the persisted text
  useEffect(() => {
    const el = stripRef.current && stripRef.current.querySelector('[aria-selected="true"]');
    if (el && el.scrollIntoView) { try { el.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (_) { /* older engines */ } }
  }, [activeId, tabs.length]);

  if (!tabs.length && !notice) return null;
  const h = narrow ? CONTROL_H.touch : CONTROL_H.lg;
  return (
    <div data-testid="review-tabs-wrap" style={{ flex: "none", minWidth: 0, maxWidth: "100%" }}>
      {tabs.length > 0 && (
        <div ref={stripRef} role="tablist" aria-label="Open files" data-testid="review-tabs"
          style={{ display: "flex", alignItems: "stretch", gap: SPACE.xxs, minWidth: 0, maxWidth: "100%", overflowX: "auto", overflowY: "hidden", padding: `${SPACE.xs}px ${SPACE.sm}px 0`, boxSizing: "border-box", background: "var(--chrome-bg-elev, var(--surface-raised))", borderBottom: "1px solid var(--chrome-divider, var(--border-default))", scrollbarWidth: "thin" }}>
          {tabs.map((t) => {
            const active = t.id === activeId;
            const showX = !narrow || active;
            return (
              <div key={t.id} role="tab" aria-selected={active} data-testid="review-tab" data-tab-id={t.id} data-active={active ? "1" : "0"}
                tabIndex={active ? 0 : -1} title={tabTitle(t, names)}
                draggable={!narrow}
                onDragStart={(e) => { setDragId(t.id); try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", t.id); } catch (_) { /* some engines */ } }}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); if (overId !== t.id) setOverId(t.id); } }}
                onDrop={(e) => { if (!dragId) return; e.preventDefault(); e.stopPropagation(); onMove?.(dragId, t.id); setDragId(null); setOverId(null); }}
                onDragEnd={() => { setDragId(null); setOverId(null); }}
                onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }} // no browser autoscroll on a middle press
                onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose?.(t.id); } }}
                onClick={() => onSelect?.(t.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect?.(t.id); } }}
                style={{ flex: narrow ? "0 0 auto" : "0 1 190px", minWidth: narrow ? 0 : 96, maxWidth: narrow ? "70vw" : 220, minHeight: h, boxSizing: "border-box", display: "flex", alignItems: "center", gap: SPACE.sm, padding: `0 ${SPACE.md}px`, cursor: "pointer", userSelect: "none",
                  borderRadius: `${RADIUS.sm}px ${RADIUS.sm}px 0 0`, border: "1px solid var(--border-default)", borderBottom: active ? "2px solid var(--accent-review, var(--accent))" : "1px solid var(--border-default)",
                  background: active ? "var(--surface-raised)" : "transparent", color: "var(--text-primary)", fontFamily: "system-ui, sans-serif", fontSize: FONT_SIZE.control, fontWeight: active ? 700 : 500,
                  opacity: dragId === t.id ? 0.5 : 1, outline: overId === t.id && dragId && dragId !== t.id ? "2px solid var(--accent-review, var(--accent))" : "none", outlineOffset: -2 }}>
                <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name || "Untitled"}</span>
                {dirty[t.id] && <span data-testid="review-tab-dirty" role="img" aria-label="Unsaved changes" title="Unsaved changes" style={{ flex: "none", width: 8, height: 8, borderRadius: RADIUS.pill, background: "var(--warn-text, var(--accent))" }} />}
                {showX && (
                  <button type="button" data-testid="review-tab-close" aria-label={`Close ${t.name}`} title={`Close ${t.name}`}
                    onClick={(e) => { e.stopPropagation(); onClose?.(t.id); }}
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{ flex: "none", minWidth: narrow ? CONTROL_H.touch : CONTROL_H.md, minHeight: narrow ? CONTROL_H.touch : CONTROL_H.md, marginRight: narrow ? -SPACE.md : -SPACE.xs, display: "inline-grid", placeItems: "center", background: "transparent", border: "none", borderRadius: RADIUS.sm, cursor: "pointer", color: "inherit", fontFamily: "inherit", fontSize: FONT_SIZE.display, lineHeight: 1, padding: 0 }}>×</button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {notice && (
        <div role="status" data-testid="review-tabs-notice" style={{ display: "flex", alignItems: "center", gap: SPACE.lg, padding: `${SPACE.sm}px ${SPACE.xl}px`, background: "var(--warn-bg)", color: "var(--warn-text)", fontSize: FONT_SIZE.control, fontFamily: "system-ui, sans-serif" }}>
          <span style={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>{notice}</span>
          <button type="button" onClick={() => onNotice?.("")} aria-label="Dismiss" title="Dismiss" style={{ flex: "none", minWidth: CONTROL_H.md, minHeight: CONTROL_H.md, cursor: "pointer", background: "transparent", color: "inherit", border: "none", fontFamily: "inherit", fontSize: FONT_SIZE.emphasis, fontWeight: 700 }}>×</button>
        </div>
      )}
    </div>
  );
}
