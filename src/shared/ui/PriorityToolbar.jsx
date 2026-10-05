/* PriorityToolbar — THE shared toolbar primitive (NEW-2, 2026-10-05).
 *
 * The owner: "I want the frame to always work regardless of the size of computer or screen that we're
 * on." A toolbar here never wraps to a second row, never clips, never scrolls sideways on a desktop. As
 * the room it is GIVEN narrows it degrades, in this order (the pure rules live in `toolbarPlan.js`):
 *   1. text labels drop to icon-only (the label survives as tooltip + aria-label, supplied by the item);
 *   2. then the lowest-priority items move into one "More" menu at the end of the row — original order,
 *      full labels, a live badge kept (the Schedule inbox count) — and NOTHING is ever dropped.
 *
 * HOW THE ROOM IS KNOWN. A toolbar that lives in the header cannot measure its own box: its zone is
 * content-sized, so the box is whatever the toolbar already is. `AppHeader` computes the row's real
 * budget (row − tabs − centre chip − padding) and publishes it through `ToolbarBudgetContext`; a
 * toolbar outside the header (no provider) measures its own PARENT with a ResizeObserver instead.
 * Both feed ONE planning step — measured once per resize frame, with hysteresis (an item does not
 * flicker in and out at a boundary width; see `toolbarPlan.nextStep`).
 *
 * HOW WIDTHS ARE KNOWN. A hidden, `inert`, aria-hidden measuring layer renders every item in both its
 * full and icon-only form so the plan never has to guess a text width (fonts, zoom, a badge going from
 * 9 to 10 all change it). The copies' identifying attributes (title/aria-label/id/data-testid) are
 * stripped after mount so the layer is invisible to selectors and to assistive tech.
 *
 * PHONES. The `narrow` path (the header's own sideways-scrolling rows) is deliberately untouched: when
 * the budget context says `narrow`, every item renders in full, in place, exactly as before.
 *
 * AN ITEM: { id, label, priority, collapsible?, ghost?, render({iconOnly}), onSelect? | menuRows? |
 *   renderMenu?({close}), badge?, active?, disabled?, sepBefore? }
 *   - `render` draws it ON THE BAR; `iconOnly` is the cue to drop the text (the item owns title/aria-label).
 *     `measuring` is true for the hidden measuring copies: an item that owns a shared ref or a portaled menu
 *     must NOT attach them there (the copy would steal the ref from the real control).
 *   - `onSelect` / `menuRows` / `renderMenu` say how it appears IN THE MENU. An item with none of the
 *     three cannot be put in a menu, so it is treated as non-collapsible (it never moves).
 *   - `ghost` — reserves its place while unavailable (visibility:hidden), absent from the menu; it is the
 *     first thing to give up room. Used where a control mounts late and must not shift its neighbours.
 *   - Menu-open state is owned here, so focus is handed to the first row on open, returned to the More
 *     button on Escape/select, and an item moving between bar and menu mid-resize never takes focus with it.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import AnchoredMenu from "./AnchoredMenu.jsx";
import { RADIUS } from "./radius.js";
import { planToolbar, TOOLBAR_GAP, MORE_WIDTH } from "./toolbarPlan.js";

/** `{ width: number|null, narrow: boolean }` — published by AppHeader for toolbars inside its rows. */
export const ToolbarBudgetContext = createContext(null);

const STRIP = ["title", "aria-label", "aria-pressed", "aria-expanded", "aria-haspopup", "id", "data-testid", "name", "for", "data-toolbar-item-id"];
function stripIdentity(root) {
  if (!root) return;
  for (const el of root.querySelectorAll("*")) for (const a of STRIP) if (el.hasAttribute(a)) el.removeAttribute(a);
}

const moreBtnStyle = (open) => ({
  display: "flex", alignItems: "center", justifyContent: "center", flex: "none",
  height: 26, width: MORE_WIDTH, padding: 0, borderRadius: RADIUS.md, cursor: "pointer",
  border: `1px solid ${open ? "var(--accent-schedule-text)" : "var(--chrome-divider)"}`,
  background: open ? "var(--hover-ghost)" : "var(--chrome-bg)", color: "var(--chrome-text)", fontFamily: "inherit",
});
const rowStyle = { display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "7px 9px", borderRadius: RADIUS.md, border: "none", cursor: "pointer", background: "transparent", fontFamily: "inherit", fontSize: 12, fontWeight: 600, color: "var(--text-primary)" };

function menuRowsOf(it) {
  if (it.menuRows) return it.menuRows.map((r) => ({ ...r, key: `${it.id}/${r.id}`, itemId: it.id }));
  if (it.onSelect) return [{ key: it.id, itemId: it.id, id: it.id, label: it.label, onSelect: it.onSelect, badge: it.badge, active: it.active, disabled: it.disabled, sepBefore: it.sepBefore }];
  return [];
}

export default function PriorityToolbar({ name, items, gap = TOOLBAR_GAP, moreLabel = "More actions", style, budget: budgetProp, align = "center" }) {
  const ctx = useContext(ToolbarBudgetContext);
  const rootRef = useRef(null);
  const measureRef = useRef(null);
  const moreRef = useRef(null);
  const [own, setOwn] = useState(null);           // own-parent measurement when no provider
  const [widths, setWidths] = useState({});       // id -> { full, icon }
  const [step, setStep] = useState(0);
  const stepRef = useRef(0);
  const [open, setOpen] = useState(false);

  const narrow = !!(ctx && ctx.narrow);
  const budget = budgetProp != null ? budgetProp : (ctx && ctx.width != null ? ctx.width : own);

  /* An item that cannot appear in the menu cannot move there. */
  const norm = useMemo(() => items.filter(Boolean).map((it) => ({
    ...it,
    priority: it.priority ?? 50,
    collapsible: it.collapsible !== false && !!(it.onSelect || it.menuRows || it.renderMenu),
  })), [items]);
  // a signature of everything that can change a measured width — re-measure when it moves
  const sig = norm.map((it) => `${it.id}|${it.label || ""}|${it.badge ?? ""}|${it.ghost ? 1 : 0}`).join("§");

  /* ---- measure the hidden copies (layout effect: before paint, so a plan never flashes a wrong bar) ----
   * The measuring layer exists ONLY for the commit in which `measuredSig !== sig` (first mount, an item's label or
   * badge changing, web fonts arriving) and is unmounted again straight after: a permanent hidden duplicate of every
   * control would be invisible to the eye but not to selectors, the control-signature crawl or a screen reader. */
  const [measuredSig, setMeasuredSig] = useState(null);
  const measure = useCallback(() => {
    const layer = measureRef.current;
    if (!layer) return;
    stripIdentity(layer);
    const next = {};
    for (const el of layer.querySelectorAll("[data-m]")) {
      const [id, mode] = el.getAttribute("data-m").split("::");
      (next[id] = next[id] || {})[mode] = el.getBoundingClientRect().width;
    }
    setWidths((prev) => {
      const same = Object.keys(next).length === Object.keys(prev).length && Object.keys(next).every((k) => prev[k] && Math.abs((prev[k].full ?? 0) - (next[k].full ?? 0)) < 0.5 && Math.abs((prev[k].icon ?? 0) - (next[k].icon ?? 0)) < 0.5);
      return same ? prev : next;
    });
  }, []);
  const layerShown = measuredSig !== sig && !narrow;
  useLayoutEffect(() => { if (layerShown) { measure(); setMeasuredSig(sig); } }, [layerShown, sig, measure]);
  // web fonts changing a label's width is the one thing a one-shot measurement can miss: measure again when they land
  useEffect(() => { try { document.fonts && document.fonts.ready && document.fonts.ready.then(() => setMeasuredSig(null)); } catch (_) { /* optional */ } }, []);

  /* ---- no provider: the budget is this toolbar's own parent box ----------------------------------- */
  useLayoutEffect(() => {
    if (ctx && ctx.width != null) return undefined;
    const p = rootRef.current && rootRef.current.parentElement;
    if (!p) return undefined;
    const read = () => { const cs = getComputedStyle(p); setOwn(Math.floor(p.clientWidth - parseFloat(cs.paddingLeft || 0) - parseFloat(cs.paddingRight || 0))); };
    read();
    if (typeof ResizeObserver !== "function") { window.addEventListener("resize", read); return () => window.removeEventListener("resize", read); }
    const ro = new ResizeObserver(read);
    ro.observe(p);
    return () => ro.disconnect();
  }, [ctx]);

  /* ---- the plan -------------------------------------------------------------------------------------- */
  const measured = norm.filter((it) => widths[it.id] && widths[it.id].full != null);
  const ready = measured.length === norm.length && norm.length > 0 && budget != null && !narrow;
  const plan = useMemo(() => {
    if (!ready) return null;
    const planItems = norm.map((it) => ({ id: it.id, priority: it.priority, collapsible: it.collapsible, ghost: !!it.ghost, widthFull: widths[it.id].full, widthIcon: widths[it.id].icon ?? widths[it.id].full }));
    return planToolbar({ items: planItems, available: budget, prevStep: stepRef.current, opts: { gap } });
  }, [ready, norm, widths, budget, gap]);
  useLayoutEffect(() => { if (plan && plan.step !== stepRef.current) { stepRef.current = plan.step; setStep(plan.step); } }, [plan]);
  void step;

  const mode = (id) => (plan ? plan.mode.get(id) : "full");
  const menuItems = norm.filter((it) => mode(it.id) === "menu" && !it.ghost);
  const barItems = norm.filter((it) => mode(it.id) !== "menu");
  const menuIds = menuItems.map((it) => it.id);

  /* ---- More menu: keyboard + focus ------------------------------------------------------------------- */
  const menuRef = useRef(null);
  const close = useCallback((refocus = true) => { setOpen(false); if (refocus) requestAnimationFrame(() => moreRef.current && moreRef.current.focus()); }, []);
  useEffect(() => { if (open && menuIds.length === 0) setOpen(false); }, [open, menuIds.length]); // everything fits again
  useEffect(() => {
    if (!open) return;
    const t = requestAnimationFrame(() => { const first = menuRef.current && menuRef.current.querySelector("button:not([disabled])"); if (first) first.focus(); });
    return () => cancelAnimationFrame(t);
  }, [open]);
  const onMenuKey = (e) => {
    const rows = [...(menuRef.current ? menuRef.current.querySelectorAll("button:not([disabled])") : [])];
    const i = rows.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); rows[(i + 1) % rows.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); rows[(i - 1 + rows.length) % rows.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); rows[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); rows[rows.length - 1]?.focus(); }
    else if (e.key === "Escape") { e.preventDefault(); close(true); }
    else if (e.key === "Tab") { close(false); }
  };

  const allIds = norm.map((it) => it.id);
  const hasMore = menuItems.length > 0;
  const badgeTotal = menuItems.reduce((n, it) => n + (Number(it.badge) > 0 ? 1 : 0), 0);

  return (
    <div
      ref={rootRef}
      data-priority-toolbar={name}
      data-chrome-toolbar=""
      data-all-ids={allIds.join(",")}
      data-menu-ids={menuIds.join(",")}
      data-icon-ids={plan ? plan.iconIds.join(",") : ""}
      style={{ position: "relative", display: "flex", alignItems: align, gap, flex: "0 0 auto", minWidth: 0, ...style }}
    >
      <div data-toolbar-bar="" style={{ display: "flex", alignItems: align, gap, flex: "none" }}>
        {barItems.map((it) => (
          <span key={it.id} data-toolbar-item-id={it.id} aria-hidden={it.ghost ? true : undefined}
            style={{ display: "inline-flex", flex: "none", alignItems: align, ...(it.ghost ? { visibility: "hidden" } : null) }}>
            {it.render({ iconOnly: mode(it.id) === "icon" })}
          </span>
        ))}
      </div>
      {hasMore && (
        <>
          <button ref={moreRef} type="button" data-toolbar-more="" title={moreLabel} aria-label={moreLabel} aria-haspopup="menu" aria-expanded={open}
            onClick={() => setOpen((o) => !o)} style={{ ...moreBtnStyle(open), position: "relative", alignSelf: "center" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
            {badgeTotal > 0 && <span aria-hidden="true" style={{ position: "absolute", top: -3, right: -3, width: 8, height: 8, borderRadius: RADIUS.pill, background: "var(--accent-schedule-text)", border: "1px solid var(--chrome-bg)" }} />}
          </button>
          <AnchoredMenu open={open} onClose={() => close(false)} anchorRef={moreRef} placement="below-right" width={236} gap={8}>
            <div ref={menuRef} role="menu" data-toolbar-menu={name} onKeyDown={onMenuKey}>
              {menuItems.map((it) => (it.renderMenu
                ? <div key={it.id} data-menu-item-id={it.id} role="none">{it.renderMenu({ close })}</div>
                : menuRowsOf(it).map((r, k) => (
                  <button key={r.key} type="button" role="menuitem" data-menu-item-id={k === 0 ? it.id : r.key} disabled={r.disabled}
                    onClick={() => { close(true); r.onSelect && r.onSelect(); }}
                    style={{ ...rowStyle, ...(r.sepBefore || (k === 0 && it.sepBefore) ? { borderTop: "1px solid var(--chrome-divider)", borderRadius: RADIUS.sm, marginTop: 3, paddingTop: 9 } : null), opacity: r.disabled ? 0.5 : 1, fontWeight: r.active ? 700 : 600 }}>
                    <span style={{ flex: 1, minWidth: 0 }}>{r.label}</span>
                    {Number(r.badge) > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--on-accent)", background: "var(--accent-schedule-text)", borderRadius: RADIUS.pill, padding: "1px 7px", minWidth: 18, textAlign: "center", lineHeight: 1.5 }}>{r.badge}</span>}
                    {r.active && <span aria-hidden="true" style={{ color: "var(--accent-schedule-text)" }}>●</span>}
                  </button>
                )))
              )}
            </div>
          </AnchoredMenu>
        </>
      )}
      {/* measuring layer — see header. Never visible, never focusable, never read by assistive tech. */}
      {layerShown && (
        <div ref={measureRef} aria-hidden="true" inert="" data-toolbar-measure=""
          style={{ position: "absolute", left: 0, top: 0, height: 0, overflow: "hidden", visibility: "hidden", pointerEvents: "none", display: "flex", width: "max-content", alignItems: "center", gap }}>
          {norm.map((it) => (
            <span key={it.id} style={{ display: "inline-flex", flex: "none" }}>
              <span data-m={`${it.id}::full`} style={{ display: "inline-flex", flex: "none" }}>{it.render({ iconOnly: false, measuring: true })}</span>
              <span data-m={`${it.id}::icon`} style={{ display: "inline-flex", flex: "none" }}>{it.render({ iconOnly: true, measuring: true })}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
