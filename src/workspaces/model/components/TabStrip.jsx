/* Model workspace — the sheet TAB STRIP (Stage 3, NEW-1, owner brief 2026-09-03: multi-sheet
 * workbooks). Add / rename (inline, double-click — never a `window.prompt`, per this repo's
 * standing "no dialog-box edits" rule) / duplicate / delete (right-click menu) / reorder
 * (drag) a sheet. Delete is undo-able (Ctrl+Z), the same convention every other destructive
 * edit in this module already uses (row/column delete), so there is deliberately no confirm
 * dialog here either — one more inconsistent new pattern is worse than reusing the existing one.
 *
 * ⛔ B1157360 (owner chat block 2026-09-04) — CHROME REBUILT: "attached tab" idiom, not floating
 * pills. MEASURED live on the deployed build this replaced: the grid card ended at its own
 * rounded bottom edge, then a bare 16px band of plain page ground, THEN this strip's own pill
 * buttons — a free-floating filter/segmented-control shape belonging to nothing. Sheet-switching
 * swaps the whole surface above it, which is the TAB idiom (Excel/Sheets: flat rectangular tabs,
 * the active one carrying the document's own surface color and connecting to it with no seam),
 * never the chip/pill idiom. So this strip is now built and reasoned about as THE GRID CARD'S
 * OWN BOTTOM SECTION, not a separate floating row:
 *   - SheetView.jsx's own card lost its bottom margin/border/radius — it now ends in a flat,
 *     square-bottomed edge, on the understanding that THIS strip supplies the rest of the card.
 *   - This strip carries the card's bottom-left/right corners (`RADIUS.lg`, the outer card's own
 *     radius — this IS the card's corner now, not an inset control, so it takes the value
 *     directly rather than nesting into anything) and the card's actual outer shadow (moved here
 *     from SheetView.jsx, since this is now the assembly's true bottom edge).
 *   - The ACTIVE tab paints the same surface as the grid (`--surface-raised`) and sits flush
 *     against it (zero gap, zero border between them) — the visual "join." Its own top corners
 *     use `nestedIn(RADIUS.lg, 0)` (radius.js) — the zero-gap case, which resolves to the SAME
 *     12px as the card itself, because the active tab is a continuation of that surface, not a
 *     control inset inside it. Its bottom corners are square (0): it meets the strip's own
 *     bottom border there, same as every inactive tab.
 *   - The strip's OWN band (behind inactive tabs) paints the app's page ground
 *     (`--surface-page`) rather than staying transparent — same color as before (this component
 *     sat on that ground either way), just now stated explicitly since the strip carries its own
 *     border/shadow and can no longer rely on "transparent" to reveal what's behind it.
 *   - No pill shape on the TABS themselves — flat rectangular, per the owner's explicit "not
 *     Excel's skeuomorphic trapezoid, not a pill — flat and connected."
 *
 * ⛔ B1176976 (adjacent-case sweep, 2026-09-05) — THE "+" ADD-SHEET BUTTON'S OWN `RADIUS.pill` WAS
 * THE SAME DEFECT THIS ITEM FIXED ELSEWHERE (`HelpReportControl.jsx`), JUST NOT YET REPORTED. This
 * file's own comment above used to read "the circular '+' add-sheet button legitimately keeps
 * `RADIUS.pill` — it's a round icon button, not a tab," which conflates "visually round" with the
 * shape rule's actual test (container-vs-standalone, docs/DESIGN.md's shape rule, B942176): this
 * button holds no sub-controls, performs one action, and is exactly the "standalone action
 * button's own resting shape" the rule says `pill` may never be — fixed to `RADIUS.md`.
 *   - The 16px dead band is gone outright (SheetView's old 8px bottom margin + this strip's old
 *     8px top padding) — that height goes back to the grid: the strip is now exactly `TAB_H`
 *     tall, tabs fill it edge to edge, and the grid (still `flex: 1`) absorbs the rest.
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
 * tabs — Excel's/Sheets' own convention (their own tab strip scrolls, the "+" stays put). The
 * outer band's own `overflow: hidden` clips any tab sitting near the rounded bottom corners to
 * that curve (a flush, full-height tab would otherwise poke a square corner past the curve —
 * cheaper and more robust than computing exactly how much horizontal inset would clear it).
 */
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { RADIUS, nestedIn } from "../../../shared/ui/radius.js";
import ContextMenu from "./ContextMenu.jsx";

// SPACE.xs/SPACE.sm/SPACE.md and FONT_SIZE.control/FONT_SIZE.display literals (4/6/8, 12/14) —
// deliberately NOT imported from designTokens.js. Same reasoning SheetView.jsx/Ribbon.jsx already
// document at their own top: this is a Model-only lazy chunk, and a second import point into
// designTokens.js tips Rollup into extracting it as its own shared chunk that then rides onto
// every OTHER route's bundle, breaching ui-audit/perf-bundle-audit.mjs's site-route allowlist.
const TAB_H = 28; // literal match to CONTROL_H.md (26) + 2 — a hair taller reads better as a tab than an exact match
const STRIP_PAD = 8; // SPACE.md literal — horizontal inset only now (see B1157360 header note)
const TAB_GAP = 4; // SPACE.xs literal
const ADD_BTN_SIZE = 26; // literal match to CONTROL_H.md

// The active tab is a zero-gap continuation of the grid card above (see B1157360 header note),
// so its own top corners take the SAME radius the card uses — derived via nestedIn rather than
// re-typing RADIUS.lg, so the relationship (zero gap → same radius) stays visible at the call site.
const TAB_TOP_RADIUS = nestedIn(RADIUS.lg, 0);

// The strip's own real height — exactly one row of tabs, no padding above or below it (the strip
// sits flush against the grid card above and its own bottom border below). Exported so
// SheetView.jsx's `position: fixed` zoom control — which floats at the VIEWPORT's bottom-right
// regardless of document flow, so it cannot "know" this sibling exists on its own — can lift
// itself clear of the strip instead of sitting on top of the "+" add-sheet button. MEASURED LIVE:
// without this, the zoom pill and the add-sheet button occupied the same on-screen pixels.
export const TAB_STRIP_HEIGHT = TAB_H;

function tabStyle(active, dragging, dropTarget) {
  return {
    // `font: "inherit"` FIRST — it's a shorthand that resets EVERY font sub-property (including
    // size and weight) to the inherited value, so setting it AFTER fontWeight/fontSize (the old
    // order) silently threw both away again. That was the live 16px-and-unweighted-text defect:
    // the source already read `fontSize: 12`, but the button rendered at its ambient inherited
    // size because the later `font: "inherit"` overwrote it right back. Ordered correctly here,
    // this resets only font-family to the surrounding chrome's, and the two explicit properties
    // below stand.
    font: "inherit",
    height: "100%", padding: "0 14px", border: "none",
    borderTopLeftRadius: TAB_TOP_RADIUS, borderTopRightRadius: TAB_TOP_RADIUS,
    borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
    background: active ? "var(--surface-raised)" : "transparent",
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    fontWeight: active ? 650 : 500, fontSize: 12, // FONT_SIZE.control literal — designTokens.js note above
    outline: dropTarget ? "2px solid var(--accent-model)" : "none", outlineOffset: -1,
    cursor: "pointer", flex: "none", display: "inline-flex", alignItems: "center",
    opacity: dragging ? 0.45 : 1,
    whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis",
    transition: "background 0.1s ease, color 0.1s ease",
  };
}

// ⛔ NEW-1 (command palette) — `forwardRef` + `startRename` so the palette's "Rename Sheet"
// command can open the SAME inline editor a double-click or the right-click menu's "Rename" row
// already open — never a second rename mechanism (this app's own "no dialog-box edits" rule
// means there is exactly one way to rename a sheet: this inline field).
const TabStrip = forwardRef(function TabStrip({ sheets, activeSheetId, onSelect, onAdd, onRename, onDuplicate, onDelete, onReorder }, ref) {
  const [renaming, setRenaming] = useState(null); // sheetId | null
  const [contextMenu, setContextMenu] = useState(null); // { point, items } | null
  const [dragIndex, setDragIndex] = useState(null); // the sheet currently being dragged, by index
  const [dropIndex, setDropIndex] = useState(null); // the index it would land at if released now
  const dropIndexRef = useRef(null); // mirrors dropIndex — read at drag-end, where React state would be stale (SheetView.jsx's fillTo/fillToRef pattern)

  useImperativeHandle(ref, () => ({ startRename: (id) => setRenaming(id) }), []);

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
      style={{
        flex: "none", height: TAB_H, display: "flex", alignItems: "stretch", gap: TAB_GAP,
        margin: "0 8px 8px", // SPACE.md literal — left/right/bottom only; zero top margin is what lets the active tab join the grid card above with no seam
        background: "var(--surface-page)",
        borderLeft: "1px solid var(--border-default)", borderRight: "1px solid var(--border-default)", borderBottom: "1px solid var(--border-default)",
        borderBottomLeftRadius: RADIUS.lg, borderBottomRightRadius: RADIUS.lg,
        boxShadow: "0 2px 6px rgba(0,0,0,0.10)", // design-exempt: no shadow-color token yet repo-wide — moved here from SheetView.jsx's card: this strip is now the assembly's true bottom edge
        overflow: "hidden", // clips a flush, full-height tab to the rounded bottom corners instead of poking a square corner past the curve
      }}
    >
      <div style={{ flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "stretch", gap: TAB_GAP, overflowX: "auto", overflowY: "hidden", scrollbarWidth: "thin", padding: `0 ${STRIP_PAD}px` }}>
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
          // alignSelf: "center" — the strip's outer row is `alignItems: "stretch"` (so a tab's
          // own height:"100%" reaches the strip's full height, edge to edge); this button keeps
          // an explicit size, so it needs its own cross-axis centering rather than stretching.
          flex: "none", alignSelf: "center", width: ADD_BTN_SIZE, height: ADD_BTN_SIZE, margin: `0 ${STRIP_PAD}px 0 0`, borderRadius: RADIUS.md,
          border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--text-secondary)",
          fontSize: 14, lineHeight: 1, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", // FONT_SIZE.display literal — designTokens.js note above
        }}
      >+</button>
      {contextMenu && <ContextMenu point={contextMenu.point} items={contextMenu.items} onClose={() => setContextMenu(null)} />}
    </div>
  );
});

export default TabStrip;
