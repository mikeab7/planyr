/* Model workspace — the sheet TAB STRIP (Stage 3, NEW-1, owner brief 2026-09-03: multi-sheet
 * workbooks). Add / rename (inline, double-click — never a `window.prompt`, per this repo's
 * standing "no dialog-box edits" rule) / duplicate / delete (right-click menu) / reorder
 * (drag) a sheet. Delete is undo-able (Ctrl+Z), the same convention every other destructive
 * edit in this module already uses (row/column delete), so there is deliberately no confirm
 * dialog here either — one more inconsistent new pattern is worse than reusing the existing one.
 *
 * CHROME — "Direction A" (owner brief): a tinted workspace ground (ModelApp's own root
 * background, `--surface-page` — this component paints nothing of its own there, it just sits
 * on it), the ribbon and the sheet each their own rounded card, and THIS strip below the sheet
 * card, sitting directly on that ground, as pills. The active tab gets the paper fill
 * (`--surface-raised`) plus a small shadow; inactive tabs are transparent. Radius from RADIUS
 * (`radius.js` — already pulled into the app's shared entry chunk, unlike designTokens.js — see
 * SheetView.jsx's own note on why THAT file stays a literal-duplicate for SPACE/CONTROL_H; this
 * one follows the identical convention below).
 *
 * ⛔ PINNED TO THE VIEWPORT, NOT INSIDE THE GRID'S SCROLLER — this was the exact defect a real
 * sibling control hit three days before this file was built (SheetView.jsx's own "+ Add
 * column" button, B1087904 Round 4: laid out to the grid's full column extent, ~2000px past a
 * normal window's visible edge). This component is a SIBLING of `<SheetView>` in ModelApp's
 * root flex column — never a child rendered inside SheetView's own `overflow: auto` scroller —
 * so panning the grid horizontally can never move it. Its OWN overflow (many sheets) is handled
 * INSIDE this component instead: the tab LIST scrolls sideways in its own `overflow-x: auto`
 * strip, while the "+" add-sheet button is a flex:none sibling AFTER that scrolling strip, so it
 * always stays reachable at the strip's own trailing edge rather than scrolling off with the
 * tabs — Excel's/Sheets' own convention (their own tab strip scrolls, the "+" stays put).
 */
import { useCallback, useRef, useState } from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import ContextMenu from "./ContextMenu.jsx";

// SPACE.xs/SPACE.sm/SPACE.md literals (4/6/8) — deliberately NOT imported from designTokens.js.
// Same reasoning SheetView.jsx/Ribbon.jsx already document at their own top: this is a
// Model-only lazy chunk, and a second import point into designTokens.js tips Rollup into
// extracting it as its own shared chunk that then rides onto every OTHER route's bundle,
// breaching ui-audit/perf-bundle-audit.mjs's site-route allowlist.
const TAB_H = 28; // literal match to CONTROL_H.md (26) + 2 — a hair taller reads better as a pill than an exact match
const STRIP_PAD = 8; // SPACE.md literal
const TAB_GAP = 4; // SPACE.xs literal
const ADD_BTN_SIZE = 26; // literal match to CONTROL_H.md

// The strip's own real height (top padding + one row of tabs; no bottom padding — the strip
// sits flush with the window's own bottom edge). Exported so SheetView.jsx's `position: fixed`
// zoom control — which floats at the VIEWPORT's bottom-right regardless of document flow, so it
// cannot "know" this sibling exists on its own — can lift itself clear of the strip instead of
// sitting on top of the "+" add-sheet button. MEASURED LIVE: without this, the zoom pill and the
// add-sheet button occupied the same on-screen pixels.
export const TAB_STRIP_HEIGHT = STRIP_PAD + TAB_H;

function tabStyle(active, dragging, dropTarget) {
  return {
    height: TAB_H, padding: "0 14px", borderRadius: RADIUS.pill, border: "none",
    background: active ? "var(--surface-raised)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    fontWeight: active ? 650 : 500, fontSize: 12.5, font: "inherit",
    boxShadow: active ? "0 1px 3px rgba(0,0,0,0.12)" : "none", // design-exempt: no shadow-color token yet repo-wide — matches this module's other card shadows
    outline: dropTarget ? "2px solid var(--accent-model)" : "none", outlineOffset: -1,
    cursor: "pointer", flex: "none", display: "inline-flex", alignItems: "center",
    opacity: dragging ? 0.45 : 1,
    whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis",
    transition: "background 0.1s ease, color 0.1s ease",
  };
}

export default function TabStrip({ sheets, activeSheetId, onSelect, onAdd, onRename, onDuplicate, onDelete, onReorder }) {
  const [renaming, setRenaming] = useState(null); // sheetId | null
  const [contextMenu, setContextMenu] = useState(null); // { point, items } | null
  const [dragIndex, setDragIndex] = useState(null); // the sheet currently being dragged, by index
  const [dropIndex, setDropIndex] = useState(null); // the index it would land at if released now
  const dropIndexRef = useRef(null); // mirrors dropIndex — read at drag-end, where React state would be stale (SheetView.jsx's fillTo/fillToRef pattern)

  const renameCommit = (id, name) => { onRename(id, name); setRenaming(null); };

  const startDrag = useCallback((e, index) => {
    if (renaming != null || e.button !== 0) return;
    e.preventDefault();
    setDragIndex(index);
    setDropIndex(index);
    dropIndexRef.current = index;
    const onMove = (ev) => {
      const hit = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => n instanceof HTMLElement && n.dataset.tabIndex != null);
      if (!hit) return;
      const idx = Number(hit.dataset.tabIndex);
      dropIndexRef.current = idx;
      setDropIndex(idx);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const from = index, to = dropIndexRef.current;
      setDragIndex(null);
      setDropIndex(null);
      if (to != null && to !== from) onReorder(from, to);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [renaming, onReorder]);

  const openMenu = (e, sheetEntry) => {
    e.preventDefault();
    const items = [
      { key: "rename", label: "Rename", onClick: () => setRenaming(sheetEntry.id) },
      { key: "duplicate", label: "Duplicate", onClick: () => onDuplicate(sheetEntry.id) },
      "divider",
      { key: "delete", label: "Delete", danger: true, disabled: sheets.length <= 1, onClick: () => onDelete(sheetEntry.id) },
    ];
    setContextMenu({ point: { x: e.clientX, y: e.clientY }, items });
  };

  return (
    <div
      data-testid="model-tab-strip"
      style={{ flex: "none", display: "flex", alignItems: "center", gap: TAB_GAP, padding: `${STRIP_PAD}px ${STRIP_PAD}px 0`, minHeight: TAB_H + STRIP_PAD }}
    >
      <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "center", gap: TAB_GAP, overflowX: "auto", overflowY: "hidden", scrollbarWidth: "thin" }}>
        {sheets.map((s, i) => {
          const active = s.id === activeSheetId;
          return (
            <button
              key={s.id}
              type="button"
              data-testid={`model-sheet-tab-${i}`}
              data-tab-index={i}
              title={s.name}
              onClick={() => { if (renaming == null) onSelect(s.id); }}
              onDoubleClick={() => setRenaming(s.id)}
              onContextMenu={(e) => openMenu(e, s)}
              onMouseDown={(e) => startDrag(e, i)}
              style={tabStyle(active, dragIndex === i, dropIndex === i && dragIndex !== null && dragIndex !== i)}
            >
              {renaming === s.id ? (
                <input
                  autoFocus
                  defaultValue={s.name}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onBlur={(e) => renameCommit(s.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); renameCommit(s.id, e.target.value); }
                    if (e.key === "Escape") { e.preventDefault(); setRenaming(null); }
                  }}
                  // ⛔ MEASURED LIVE: a fixed 110px box clipped the START of a real name at
                  // typing's natural caret-follows-end scroll ("Assumptions" rendered as
                  // "\ssumptions" — the "A" scrolled out of view). 172px is the tab's own
                  // maxWidth (200) minus its horizontal padding (14px each side) — the true
                  // available room, so a name that fits the PILL also fits the EDITOR.
                  style={{ width: 172, font: "inherit", fontWeight: 650, color: "inherit", background: "var(--surface-page)", border: "1px solid var(--accent-model)", borderRadius: RADIUS.sm, padding: "1px 6px" }}
                />
              ) : s.name}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        data-testid="model-add-sheet"
        onClick={onAdd}
        title="Add sheet"
        aria-label="Add sheet"
        style={{
          flex: "none", width: ADD_BTN_SIZE, height: ADD_BTN_SIZE, borderRadius: RADIUS.pill,
          border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--text-secondary)",
          fontSize: 16, lineHeight: 1, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center",
        }}
      >+</button>
      {contextMenu && <ContextMenu point={contextMenu.point} items={contextMenu.items} onClose={() => setContextMenu(null)} />}
    </div>
  );
}
