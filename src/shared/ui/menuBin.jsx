/* The shared skeleton of a "switcher with a bin" dropdown (NEW-1, 2026-11-04): the project switcher (ProjectBreadcrumb) and the Site
 * Planner's plan menu are the same shape — ONE scrolling list, a footer that can never be pushed out of the panel, and a
 * "Recently deleted (n)" door into a bin view with a "‹ Back" row. Written once here so a third dropdown does not grow a third copy.
 *
 *   <AnchoredMenu panelStyle={{ ...display:"flex", flexDirection:"column", overflow:"hidden" }}>
 *     <MenuScroll testId="…-list-scroll"> …rows… </MenuScroll>     ← the ONE scrolling element (`minHeight: 0` is what lets it shrink)
 *     <MenuFooter testId="…-footer"> …always visible… </MenuFooter>
 *   </AnchoredMenu>
 *
 * Presentational only; module scope; tokens only. Nothing here imports a workspace module (this file rides the entry chunk). */

// A LITERAL duplicate of designTokens.js's FONT_SIZE.control, not an import: this file is imported by ProjectBreadcrumb (the shared ENTRY
// chunk), and importing designTokens.js for one number measurably ate the route budget (see ProjectBreadcrumb's CHROME_FONT_CONTROL note).
const FONT_CONTROL = 12; // design-exempt: literal duplicate of FONT_SIZE.control — see the comment above

/** The panel style a menu using these pieces needs: a column that clips, so the footer can't be pushed out. */
export const MENU_COLUMN_PANEL = { display: "flex", flexDirection: "column", overflow: "hidden" };

/** THE ONE SCROLLING ELEMENT. `minHeight: 0` lets it shrink inside the flex column so the footer below can never be pushed out of the panel. */
export function MenuScroll({ testId, style, children }) {
  return (
    <div data-testid={testId} style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", ...style }}>
      {children}
    </div>
  );
}

/** FOOTER — always visible, whatever the list length. */
export function MenuFooter({ testId, style, children }) {
  return (
    <div data-testid={testId} style={{ flex: "none", ...style }}>
      {children}
    </div>
  );
}

/** The "‹ <Label>" row at the top of a bin view (goes back to the list). */
export function BinBackRow({ testId, label, onClick, style }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", height: 34, padding: "0 12px", border: "none", borderBottom: "1px solid var(--border-default)", background: "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: FONT_CONTROL, fontWeight: 600, color: "var(--text-primary)", textAlign: "left", ...style }}
    >
      <span aria-hidden="true">‹</span> {label}
    </button>
  );
}
