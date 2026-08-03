/* notesSketchEditor — the INTERACTIVE half of Sketch mode: the outline pane, dragging,
 * arrow mode, and opening a body in place.
 *
 * ⛔ REACHED ONLY BY A CACHED DYNAMIC import() FROM lib/notesSketchNode.js, for the same
 * reason lib/notesCloud.js and lib/notesImageDb.js are: most notes contain no sketch, and a
 * feature most pages do not use should not be bytes every page downloads. The schema node
 * and the pure drawing stay in the editor chunk (they must — `renderHTML` is synchronous
 * and the printed sheet goes through it); everything in THIS file is deferred until a
 * sketch is genuinely on screen.
 *
 * ⛔ NO DIALOG BOXES (house rule). Every edit here happens in place: the outline is a real
 * field on the page, a body opens inside its own box, an arrow is drawn by pressing the two
 * boxes it joins. There is no `window.prompt` in this module and there must never be one.
 *
 * ═══ WHAT WRITES TO THE DOCUMENT, AND WHEN ════════════════════════════════════════════
 *
 * Every write goes through `handle.commit`, which is ONE ProseMirror transaction — and that
 * is deliberately not the same thing as "on every input event":
 *   • DRAGGING previews locally (the drawing is re-rendered from a temporary model) and
 *     commits ONCE on release, so a drag across the canvas is ONE undo step and not eighty.
 *   • TYPING in the outline is debounced, so a sentence is a couple of undo steps rather
 *     than one per keystroke — and the note's own autosave debounce sees a settled document.
 *   • Everything else (an arrow, a body opening) is immediate; they are single acts.
 *
 * ═══ THE RULE, RESTATED WHERE IT IS EASIEST TO BREAK ══════════════════════════════════
 *
 * A drag writes a POSITION and nothing else. It must never touch the outline. That is not
 * a convention here — `moveNode` in lib/notesSketchModel.js is the only way this file moves
 * a box, and it returns the same outline array it was given. The headless check asserts the
 * stored text is BYTE-IDENTICAL across a drag.
 */
import {
  addLink, applyOutlineText, boxAt, clearPosition, layoutSketch, moveNode,
  outlineToText, removeLink,
} from "./notesSketchModel.js";

const TYPING_DEBOUNCE_MS = 320;

const el = (tag, cls, attrs = {}) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v));
  return node;
};

function toolButton(label, title, testid) {
  const b = el("button", "planyr-sketch-btn", { type: "button", title, "aria-label": title, "data-testid": testid });
  b.textContent = label;
  // A press on a control must not blur the outline field or move the note's caret.
  b.addEventListener("mousedown", (e) => e.preventDefault());
  return b;
}

/** Attach the interactive layer to one sketch node view.
 *  `handle` is the shell from lib/notesSketchNode.js: `{ toolsSlot, drawSlot, paneSlot,
 *  attrs, draw, commit, setExpanded, getExpanded, isEditable }`. */
export function attachSketchEditor(handle) {
  const { toolsSlot, drawSlot, paneSlot } = handle;

  let linkMode = false;          // "draw an arrow" is a MODE, because it takes two presses
  let linkFrom = null;
  let typingTimer = 0;
  let dragging = null;
  let destroyed = false;

  /* ---- the tool bar ------------------------------------------------------------------ */

  const outlineBtn = toolButton("Outline", "Show or hide the outline this sketch is drawn from", "sketch-outline-toggle");
  const arrowBtn = toolButton("＋ Arrow", "Draw an extra arrow: press one box, then another", "sketch-arrow-mode");
  const resetBtn = toolButton("Tidy up", "Put every box back where the outline puts it", "sketch-tidy");
  const status = el("span", "planyr-sketch-status", { "data-testid": "sketch-status", role: "status", "aria-live": "polite" });

  toolsSlot.append(el("span", "planyr-sketch-kind"), outlineBtn, arrowBtn, resetBtn, status);
  toolsSlot.querySelector(".planyr-sketch-kind").textContent = "Sketch";

  const say = (msg) => { status.textContent = msg || ""; };

  /* ---- the outline pane — the ONLY way content is authored --------------------------- */

  const pane = el("div", "planyr-sketch-outline");
  const field = el("textarea", "planyr-sketch-textarea", {
    "data-testid": "sketch-outline",
    spellcheck: "false",
    rows: "6",
    "aria-label": "Sketch outline. One line per box; indent a line to make it a child. Start a line with > for detail.",
  });
  const hint = el("p", "planyr-sketch-hint");
  hint.textContent = "One line per box · indent to make a child · start a line with “>” for the detail inside a box.";
  pane.append(field, hint);
  paneSlot.append(pane);

  let paneOpen = true;
  const syncPane = () => {
    pane.style.display = paneOpen ? "" : "none";
    outlineBtn.setAttribute("aria-pressed", paneOpen ? "true" : "false");
    outlineBtn.classList.toggle("is-on", paneOpen);
  };
  outlineBtn.addEventListener("click", () => { paneOpen = !paneOpen; syncPane(); if (paneOpen) field.focus(); });

  /** Pull the field's text into the document. The reconcile inside `applyOutlineText` is
   *  what carries ids — and therefore positions and arrows — across the edit, and what runs
   *  the delete cascade for a line that is gone. */
  const commitText = () => {
    if (destroyed) return;
    const before = handle.attrs;
    const next = applyOutlineText(before, field.value);
    const lost = before.links.length - next.links.length;
    handle.commit(next);
    if (lost > 0) say(`${lost} extra arrow${lost === 1 ? "" : "s"} went with the deleted line${lost === 1 ? "" : "s"}.`);
    else say("");
  };

  field.addEventListener("input", () => {
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(commitText, TYPING_DEBOUNCE_MS);
  });
  // Leaving the field must never leave a keystroke unwritten — the same discipline the note
  // body's own autosave uses (components/NoteEditor.jsx).
  field.addEventListener("blur", () => { if (typingTimer) { clearTimeout(typingTimer); typingTimer = 0; } commitText(); });

  /* Tab INDENTS inside the outline rather than escaping to the browser chrome — the same
   * decision lib/notesTabKey.js made for the note body (B1392), for the same reason: in a
   * field whose whole syntax is indentation, Tab has an obvious meaning. Escape releases it. */
  let tabEscapes = false;
  field.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { tabEscapes = true; return; }
    if (e.key !== "Tab" || tabEscapes) { tabEscapes = false; return; }
    e.preventDefault();
    const { selectionStart: s, selectionEnd: t, value } = field;
    const lineStart = value.lastIndexOf("\n", s - 1) + 1;
    if (e.shiftKey) {
      const head = value.slice(lineStart, s);
      const cut = head.startsWith("  ") ? 2 : head.startsWith("\t") ? 1 : 0;
      if (!cut) return;
      field.value = value.slice(0, lineStart) + value.slice(lineStart + cut);
      field.setSelectionRange(s - cut, t - cut);
    } else {
      field.value = `${value.slice(0, lineStart)}  ${value.slice(lineStart)}`;
      field.setSelectionRange(s + 2, t + 2);
    }
    field.dispatchEvent(new Event("input", { bubbles: false }));
  });

  /* ---- the canvas: drag, arrow mode, open a body ------------------------------------- */

  /** How many CANVAS units one screen pixel is worth. The SVG may be scaled down to fit a
   *  narrow sheet, so a raw client delta would move a box by the wrong amount. */
  function canvasScale(svg) {
    const rect = svg.getBoundingClientRect();
    const vb = (svg.getAttribute("viewBox") || "0 0 1 1").split(/\s+/).map(Number);
    return {
      rect,
      sx: rect.width ? vb[2] / rect.width : 1,
      sy: rect.height ? vb[3] / rect.height : 1,
    };
  }

  /** Canvas coordinates for a pointer event. */
  function canvasPoint(svg, e) {
    const { rect, sx, sy } = canvasScale(svg);
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }

  function onPointerDown(e) {
    if (destroyed || !handle.isEditable()) return;
    const svg = drawSlot.querySelector("[data-sketch-canvas]");
    if (!svg) return;

    const target = e.target instanceof Element ? e.target : null;

    // A chevron opens or closes THAT box's detail, in place. Checked first: it sits on top
    // of the box, so a press on it must never also start a drag.
    const toggle = target?.closest("[data-sketch-toggle]");
    if (toggle) {
      e.preventDefault();
      const id = toggle.getAttribute("data-sketch-toggle");
      const open = new Set(handle.getExpanded());
      if (open.has(id)) open.delete(id); else open.add(id);
      handle.setExpanded(open);
      handle.draw();
      return;
    }

    // An extra arrow can be pressed to remove it. A parent→child arrow cannot: it belongs
    // to the outline, and the way to remove it is to change the outline.
    const edge = target?.closest('[data-sketch-edge-kind="link"]');
    if (edge && !linkMode) {
      e.preventDefault();
      const [from, to] = (edge.getAttribute("data-sketch-edge") || "").split(" ");
      handle.commit(removeLink(handle.attrs, from, to));
      say("Arrow removed.");
      return;
    }

    const group = target?.closest("[data-sketch-node]");
    const id = group?.getAttribute("data-sketch-node");
    if (!id) { if (linkMode) { linkFrom = null; paintLinkMode(); say("Arrow: press one box, then another."); } return; }

    if (linkMode) {
      e.preventDefault();
      if (!linkFrom) { linkFrom = id; paintLinkMode(); say("Now press the box the arrow points to."); return; }
      const { model, added, reason } = addLink(handle.attrs, linkFrom, id);
      linkFrom = null;
      if (added) { handle.commit(model); say("Arrow added."); }
      else say(`No arrow — ${reason}.`);   // LOUD-FAILURE: a refused act says why, never nothing
      setLinkMode(false);
      return;
    }

    /* A DRAG. It previews locally and commits once on release — see the header.
     *
     * Two details that are fixes, not style. The pointer capture goes on `drawSlot`, which
     * is a STABLE element: every preview frame replaces the `<svg>`, so capturing on the
     * canvas would throw the capture away on the first move and the drag would stop the
     * moment the pointer left the box. And the movement is measured as a CLIENT-PIXEL DELTA
     * against a scale read once, because the canvas grows as a box is dragged right — a
     * position recomputed from the live canvas rect would drift under the pointer. */
    const pt = canvasPoint(svg, e);
    const layout = layoutSketch(handle.attrs, { expanded: handle.getExpanded() });
    const box = boxAt(layout, pt.x, pt.y);
    if (!box) return;
    e.preventDefault();
    const { sx, sy } = canvasScale(svg);
    dragging = {
      id, sx, sy, moved: false, base: handle.attrs,
      startX: box.x, startY: box.y, clientX: e.clientX, clientY: e.clientY,
    };
    try { drawSlot.setPointerCapture(e.pointerId); } catch (_) { /* a mouse without capture still works */ }
  }

  function onPointerMove(e) {
    if (!dragging) return;
    const x = dragging.startX + (e.clientX - dragging.clientX) * dragging.sx;
    const y = dragging.startY + (e.clientY - dragging.clientY) * dragging.sy;
    if (!dragging.moved && Math.abs(e.clientX - dragging.clientX) < 2 && Math.abs(e.clientY - dragging.clientY) < 2) return;
    const next = moveNode(dragging.base, dragging.id, Math.max(0, x), Math.max(0, y));
    dragging.preview = next;
    dragging.moved = true;
    handle.draw(next);
  }

  function onPointerUp() {
    if (!dragging) return;
    const { moved, preview } = dragging;
    dragging = null;
    if (moved && preview) { handle.commit(preview); say("Box moved. The outline is unchanged."); }
    else handle.draw();
  }

  /* A double-press puts a box back under the automatic layout — the per-box undo of a drag,
   * and the reason "Tidy up" is not the only way out of a placement you did not want. */
  function onDoubleClick(e) {
    if (destroyed || !handle.isEditable()) return;
    const group = e.target instanceof Element ? e.target.closest("[data-sketch-node]") : null;
    const id = group?.getAttribute("data-sketch-node");
    if (!id) return;
    e.preventDefault();
    const before = handle.attrs;
    if (!(id in before.positions)) return;
    handle.commit(clearPosition(before, id));
    say("Box back where the outline puts it.");
  }

  drawSlot.addEventListener("pointerdown", onPointerDown);
  drawSlot.addEventListener("pointermove", onPointerMove);
  drawSlot.addEventListener("pointerup", onPointerUp);
  drawSlot.addEventListener("pointercancel", onPointerUp);
  drawSlot.addEventListener("dblclick", onDoubleClick);

  /* ---- arrow mode + tidy up ---------------------------------------------------------- */

  function paintLinkMode() {
    drawSlot.classList.toggle("is-linking", linkMode);
    for (const g of drawSlot.querySelectorAll("[data-sketch-node]")) {
      g.classList.toggle("is-link-source", !!linkFrom && g.getAttribute("data-sketch-node") === linkFrom);
    }
  }
  function setLinkMode(on) {
    linkMode = on;
    if (!on) linkFrom = null;
    arrowBtn.setAttribute("aria-pressed", on ? "true" : "false");
    arrowBtn.classList.toggle("is-on", on);
    paintLinkMode();
  }
  arrowBtn.addEventListener("click", () => {
    setLinkMode(!linkMode);
    say(linkMode ? "Arrow: press one box, then another." : "");
  });

  resetBtn.addEventListener("click", () => {
    const before = handle.attrs;
    const count = Object.keys(before.positions).length;
    if (!count) { say("Every box is already where the outline puts it."); return; }
    handle.commit({ ...before, positions: {} });
    say(`${count} box${count === 1 ? "" : "es"} put back. Nothing you typed changed.`);
  });

  /* ---- staying in step with the document --------------------------------------------- */

  /** Called when the node's attributes changed underneath us — another window, an undo, a
   *  cloud adopt. The field is only rewritten when the text genuinely differs, so a redraw
   *  never eats the cursor position of someone mid-sentence. */
  function refresh() {
    if (destroyed) return;
    const text = outlineToText(handle.attrs.outline);
    if (document.activeElement !== field && field.value !== text) field.value = text;
    handle.draw();
    paintLinkMode();
  }

  field.value = outlineToText(handle.attrs.outline);
  syncPane();
  setLinkMode(false);
  handle.draw();

  /* A brand-new sketch takes the caret, so "insert, type three words, see a box" needs no
   * instructions. An existing one does NOT steal focus — that would yank the caret out of
   * the note every time a page with a sketch opened. */
  if (!handle.attrs.outline.length && handle.isEditable()) {
    field.setAttribute("placeholder", "Type a line, then Tab to indent the next one.");
    setTimeout(() => { if (!destroyed) field.focus(); }, 0);
  }

  return {
    refresh,
    destroy() {
      destroyed = true;
      if (typingTimer) clearTimeout(typingTimer);
      drawSlot.removeEventListener("pointerdown", onPointerDown);
      drawSlot.removeEventListener("pointermove", onPointerMove);
      drawSlot.removeEventListener("pointerup", onPointerUp);
      drawSlot.removeEventListener("pointercancel", onPointerUp);
      drawSlot.removeEventListener("dblclick", onDoubleClick);
    },
  };
}

export default attachSketchEditor;
