/* PasteOptions — the Word/Excel-style paste-options flyout, moved verbatim out of NoteEditor.jsx (audit batch L1; module scope, MODULE-SCOPE-COMPONENTS). */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { placeChip } from "../lib/notesChipPlace.js";
import { PASTE_MODE_META, pasteSetFor, modesOfSet } from "../lib/notesPasteModes.js";
import { PasteGlyph, ClipboardGlyph } from "./PasteIcons.jsx";

/** Is keyboard focus inside the paste-options menu right now? (Module scope: used by the editor's blur guard and by closePasteMenu.) */
export function pasteMenuHasFocus() {
  const a = typeof document !== "undefined" ? document.activeElement : null;
  return !!(a && a.closest && a.closest("[data-testid='note-paste-options']"));
}

/** ⛔ WORD'S AND EXCEL'S PASTE OPTIONS, and it is NOT a dialog (house rule) — B36051, then NEW-1 (Office-style).
 *
 *  After a paste that carried formatting a small bordered TAB — a clipboard, "(Ctrl)", a caret — sits at the end of the
 *  pasted range, exactly where Word puts it. Clicking it, or pressing Ctrl once, opens the FLYOUT: a square-cornered
 *  panel headed "Paste Options:" with one square icon button per option. Hovering or focusing a button names it the
 *  way Word does ("Keep Text Only (T)"); the option currently applied shows a light-blue pressed state; the letter in
 *  the bracket picks it while the flyout is open. Picking one RE-TRANSFORMS THE JUST-PASTED RANGE IN PLACE, as a single
 *  undo step, and may be done again — each pick starts from the paste as it first landed (notesPasteModes.js).
 *
 *  A paste that landed a TABLE shows Excel's set, grouped under small bold headings (Paste · Paste Values · Other Paste
 *  Options); anything else shows Word's three. Which set is the pure `pasteSetFor(offer)`.
 *
 *  Module scope (MODULE-SCOPE-COMPONENTS): a component declared inside a render body is a new type every render, so
 *  React would remount it out from under its own click. The flyout is clamped into the visible mat in a LAYOUT effect
 *  (measured before paint, so it never shows at an unclamped spot) and flips above the line when it would run off the
 *  bottom — it has to fit a phone, where the buttons also grow to a thumb-sized target. */
export function PasteOptions({ offer, expanded, focusIn, onExpand, onPick, onPreview }) {
  const rootRef = useRef(null);
  const [tip, setTip] = useState(null);
  const [place, setPlace] = useState(null);
  /* ⛔ THE HIGHLIGHT (NEW-1, 2026-11-10). One option is "current" — the one a key would act on. It starts on the option applied now
   * and follows the arrow keys and the pointer, and it is the one real DOM focus sits on (a roving tabindex), so Enter / Space press
   * it natively and a screen reader says its name. `null` = "the applied one". */
  const [active, setActive] = useState(null);
  const order = offer ? modesOfSet(pasteSetFor(offer)) : [];
  const cur = order.includes(active) ? active : (order.includes(offer?.applied) ? offer.applied : order[0]);
  useEffect(() => { if (!expanded) setActive(null); }, [expanded]);
  const x = offer?.x; const y = offer?.y; const yTop = offer?.yTop;
  const kind = offer?.kind;
  useLayoutEffect(() => {
    const el = rootRef.current;
    const host = el?.offsetParent;
    if (!el || !host) { setPlace(null); return; }
    const w = el.offsetWidth; const h = el.offsetHeight;
    const hw = host.clientWidth; const hh = host.clientHeight;
    /* ⛔ IT COVERS NO TEXT (B2671237, owner screenshot: "(Ctrl) v" printed over the next box's words). Every line of text on the
     * page is an obstacle; `placeChip` takes the historic spot when it is clear and otherwise the nearest clear one. */
    let obstacles = [];
    try {
      const pm = host.querySelector(".ProseMirror");
      const hr = host.getBoundingClientRect();
      if (pm) {
        const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        let node;
        while ((node = walker.nextNode())) {
          if (!node.nodeValue || !node.nodeValue.trim()) continue;
          range.selectNodeContents(node);
          for (const r of range.getClientRects()) obstacles.push({ left: r.left - hr.left, top: r.top - hr.top, right: r.right - hr.left, bottom: r.bottom - hr.top });
        }
      }
    } catch (_) { obstacles = []; }
    const spot = placeChip({ chip: { w, h }, at: { x, y, yTop }, obstacles, host: { w: hw, h: hh } });
    const left = spot.left;
    const top = spot.top;
    const tipRight = left + 250 > hw;
    setPlace((prev) => (prev && prev.left === left && prev.top === top && prev.tipRight === tipRight ? prev : { left, top, tipRight }));
  }, [x, y, yTop, expanded, kind]);
  /* ⛔ OPENING THE MENU HANDS IT THE KEYBOARD (NEW-1). It used to open while the editor kept focus, so the arrow keys moved the
   * caret / the selected box and "use the arrows" did nothing. Focus lands on the current option; Escape or a pick gives it back
   * to the caret (NoteEditor `closePasteMenu` / `applyPasteMode`). Not on a touch screen (`focusIn` false there): moving focus
   * off the editor would drop the soft keyboard and re-lay the page under the finger. */
  useLayoutEffect(() => {
    if (!expanded || !focusIn || !rootRef.current) return;
    const btn = rootRef.current.querySelector(`[data-testid="note-paste-${cur}"]`);
    if (btn && document.activeElement !== btn) btn.focus({ preventScroll: true });
  }, [expanded, focusIn, cur, offer?.kind]);
  /* ⛔ NOTHING UNDER THE MENU HEARS A PRESS ON IT (NEW-1). The canvas around it pans on a drag, zooms on the wheel, places a caret on
   * a press, drags a box by its body and opens its own right-click menu — all from listeners on the canvas, which a press on this
   * panel would reach. Stopped natively here (a React `stopPropagation` cannot stop a native listener on an ancestor); `click` is
   * left alone because the buttons' own React onClick rides it, and `mousedown` is cancelled so the editor's selection survives. */
  const menuUp = !!offer;
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const stop = (e) => { e.stopPropagation(); if (e.type === "mousedown" || e.type === "contextmenu") e.preventDefault(); };
    const types = ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "touchstart", "touchend", "wheel", "contextmenu"];
    for (const t of types) el.addEventListener(t, stop, { passive: false });
    return () => { for (const t of types) el.removeEventListener(t, stop); };
  }, [menuUp, expanded]);
  if (!offer) return null;
  const box = {
    position: "absolute", left: place ? place.left : Math.max(6, x), top: place ? place.top : y + 4, zIndex: 40,
    cursor: "default",   // chrome: the arrow, not the mat's open hand
    background: "var(--surface-raised)", border: "1px solid var(--border-strong)",
    boxShadow: "0 3px 10px rgba(0,0,0,0.18)",
  };
  if (!expanded) {
    return (
      <div ref={rootRef} data-testid="note-paste-options" className="planyr-paste-ctx" style={box}>
        <button
          type="button"
          data-testid="note-paste-badge"
          title="Paste Options (Ctrl)"
          aria-label="Paste Options (Ctrl)"
          aria-expanded={false}
          onClick={onExpand}
          className="planyr-paste-tab"
        >
          <ClipboardGlyph size={22} />
          <span style={{ fontSize: 10.5, fontWeight: 700 }}>(Ctrl)</span>
          <span aria-hidden="true" style={{ fontSize: 10.5 }}>▾</span>
        </button>
      </div>
    );
  }
  const set = pasteSetFor(offer);
  return (
    <div ref={rootRef} data-testid="note-paste-options" data-paste-kind={offer.kind} role="group" aria-label="Paste Options"
      onClick={(e) => e.stopPropagation()}
      onMouseLeave={() => onPreview?.(null)}
      onKeyDown={(e) => {
        /* Arrows, Tab and Home / End move the highlight; Enter / Space press the focused button natively; the option's own
         * letter and Escape are NoteEditor's (they must work from outside the menu's focus too). */
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const i = order.indexOf(cur);
        const n = order.length;
        let next = null;
        if (e.key === "ArrowRight" || e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) next = order[(i + 1) % n];
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) next = order[(i - 1 + n) % n];
        else if (e.key === "Home") next = order[0];
        else if (e.key === "End") next = order[n - 1];
        if (!next) return;
        e.preventDefault(); e.stopPropagation();
        setActive(next);
        rootRef.current?.querySelector(`[data-testid="note-paste-${next}"]`)?.focus({ preventScroll: true });
      }}
      className="planyr-paste-ctx" style={{ ...box, padding: "6px 8px 8px" }}>
      <div className="planyr-paste-head">Paste Options:</div>
      {set.map((g) => (
        <div key={g.title || "main"} role="group" aria-label={g.title || "Paste"} data-paste-group={g.title || ""}>
          {g.title ? <div className="planyr-paste-group">{g.title}</div> : null}
          <div className="planyr-paste-row">
            {g.modes.map((mode) => {
              const meta = PASTE_MODE_META[mode];
              return (
                <button
                  key={mode}
                  type="button"
                  data-testid={`note-paste-${mode}`}
                  data-tip={`${meta.label} (${meta.key})`}
                  aria-label={`${meta.label} (${meta.key})`}
                  aria-keyshortcuts={meta.key}
                  aria-pressed={offer.applied === mode}
                  data-active={mode === cur ? "1" : undefined}
                  tabIndex={mode === cur ? 0 : -1}
                  onClick={() => onPick(mode)}
                  onMouseEnter={(e) => {
                    onPreview?.(mode);
                    setActive(mode);
                    if (rootRef.current?.contains(document.activeElement)) e.currentTarget.focus({ preventScroll: true });
                    setTip({ mode, left: e.currentTarget.offsetLeft, top: e.currentTarget.offsetTop + e.currentTarget.offsetHeight });
                  }}
                  onMouseLeave={() => setTip((t) => (t && t.mode === mode ? null : t))}
                  onFocus={(e) => { onPreview?.(mode); setActive(mode); setTip({ mode, left: e.currentTarget.offsetLeft, top: e.currentTarget.offsetTop + e.currentTarget.offsetHeight }); }}
                  onBlur={() => setTip((t) => (t && t.mode === mode ? null : t))}
                  className="planyr-paste-btn"
                >
                  <PasteGlyph mode={mode} size={28} />
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {tip ? (
        <div role="tooltip" data-testid="note-paste-tip" className="planyr-paste-tip"
          style={{ top: tip.top, ...(place?.tipRight ? { right: 0 } : { left: tip.left }) }}>
          {PASTE_MODE_META[tip.mode].label} ({PASTE_MODE_META[tip.mode].key})
        </div>
      ) : null}
    </div>
  );
}

/** The document's own right-click menu — one item, because there is exactly one thing here
 *  that the keyboard route hides (B36051). Not a dialog, closes on Escape and on an outside
 *  press, and reachable from the keyboard through the context-menu key like every other
 *  menu in this module. */
/* ⛔ THE RIGHT-CLICK MENU IS WORD'S, NOT AN INVENTION (B539651, owner instruction 2026-08-14).
 *
 * HIS WORDS: *"the right click should have the normal formatting option, like it's a Word
 * document or an email where I can change text, I can underline, make it the exact same format.
 * Just copy Word."* And, in the same breath, the thing that must NOT be on screen: *"the delete
 * option shouldn't just be shown, like, anytime I click on the box… I should only be able to use
 * the keystroke to delete or a right click and then delete option."*
 *
 * ⛔ THE ITEMS ARE A TABLE, NOT MARKUP, and that is what lets the DOCUMENT menu and the BOX menu
 * be the same component with different rows rather than two menus that drift apart. A box's menu
 * is the document's plus its own actions — because right-clicking a box is still right-clicking
 * inside text, and everything that applied to the words still applies.
 *
 * ⛔ EVERY ITEM CANCELS `mousedown`. A menu that steals the selection cannot act on it, and the
 * failure is silent: the command runs against an empty range and appears to do nothing. This is
 * the same rule the toolbar has had since B1370.
 */
