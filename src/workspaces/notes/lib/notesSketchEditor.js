/* notesSketchEditor — the INTERACTIVE half of Sketch mode: DIRECT MANIPULATION on the
 * canvas. Double-click empty space to make a box, type in the box, drag from one box onto
 * another to draw an arrow, drag a box to move it.
 *
 * ⛔ REACHED ONLY BY A CACHED DYNAMIC import() FROM lib/notesSketchNode.js, for the same
 * reason lib/notesCloud.js and lib/notesImageDb.js are: most notes contain no sketch, and a
 * feature most pages do not use should not be bytes every page downloads. The schema node
 * and the pure drawing stay in the editor chunk (they must — `renderHTML` is synchronous
 * and the printed sheet goes through it); everything in THIS file is deferred until a
 * sketch is genuinely on screen.
 *
 * ═══ ⛔ SUPERSEDED: THE OUTLINE PANE IS GONE, AND IT IS NOT COMING BACK ════════════════
 *
 * This file used to be built around a textarea in which you typed an indented outline, and
 * the boxes were a rendering of that text. That was the defect: a person had to learn an
 * indent-and-caret syntax before a single box appeared. It is deleted rather than kept "just
 * in case" — two authoring paths is exactly the accumulation PANEL-BREVITY forbids, and the
 * second one was the half the owner disliked. The full history is in the header of
 * lib/notesSketchModel.js.
 *
 * ═══ EVERY GESTURE, AND ITS KEYBOARD EQUIVALENT ════════════════════════════════════════
 *
 *   double-click empty canvas → a box appears there, caret already in it
 *   double-click a box        → edit its words         (keyboard: focus it, Enter)
 *   drag a box                → move it
 *   drag from a box's dot     → an arrow to the box you drop on   (keyboard: ↗ Arrow)
 *   click an arrow            → select it; Delete removes it
 *   Delete with a box picked  → the box AND every arrow that named it (TOMBSTONE-DELETES)
 *
 * Every box is a real focus stop with an accessible name, so nothing above is mouse-only:
 * the three buttons in the tool row (＋ Box · ↗ Arrow · Delete) reach all of it.
 *
 * ⛔ NO DIALOG BOXES (house rule). A box's words are edited IN THE BOX — two plain fields
 * laid over it, a short label and an optional longer body. There is no `window.prompt` in
 * this module and there must never be one.
 *
 * ═══ WHAT WRITES TO THE DOCUMENT, AND WHEN ════════════════════════════════════════════
 *
 * Every write goes through `handle.commit`, which is ONE ProseMirror transaction:
 *   • DRAGGING previews locally and commits ONCE on release, so a drag across the canvas is
 *     one undo step and not eighty.
 *   • A NEW BOX is previewed locally too and is committed only when it has words in it — so
 *     a double-click you thought better of leaves NOTHING in the document, not an empty box.
 *   • Everything else (an arrow, a delete, a text edit) is a single act and commits at once.
 */
import {
  addBox, addLink, boxAt, BOX_MIN_H, BOX_W, layoutSketch, moveBox, nextSpot, normalizeSketch,
  removeBox, removeLink, updateBox,
} from "./notesSketchModel.js";

const el = (tag, cls, attrs = {}) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v));
  return node;
};

function toolButton(label, title, testid) {
  const b = el("button", "planyr-sketch-btn", { type: "button", title, "aria-label": title, "data-testid": testid });
  b.textContent = label;
  // A press on a control must not blur the box being edited before we have read its fields.
  b.addEventListener("mousedown", (e) => e.preventDefault());
  return b;
}

/** Attach the interactive layer to one sketch node view.
 *  `handle` is the shell from lib/notesSketchNode.js: `{ dom, toolsSlot, drawSlot, paneSlot,
 *  attrs, draw, commit, setSelected, getSelected, isEditable }`. */
export function attachSketchEditor(handle) {
  const { dom, toolsSlot, drawSlot, paneSlot } = handle;

  let selected = null;          // { kind: "box", id } | { kind: "edge", from, to }
  let editing = null;           // { id, model, committed } — model may hold an uncommitted box
  let dragging = null;          // moving a box
  let linking = null;           // dragging an arrow out of a grip
  let pendingFrom = null;       // the keyboard route: ↗ Arrow, then pick the second box
  let destroyed = false;

  /* ---- the tool bar ------------------------------------------------------------------ */

  const addBtn = toolButton("＋ Box", "Add a box (or just double-click the canvas)", "sketch-add-box");
  const arrowBtn = toolButton("↗ Arrow", "Draw an arrow from the selected box to another (or drag from the box's dot)", "sketch-arrow");
  const delBtn = toolButton("Delete", "Delete what is selected — a box takes its arrows with it", "sketch-delete");
  const status = el("span", "planyr-sketch-status", { "data-testid": "sketch-status", role: "status", "aria-live": "polite" });

  toolsSlot.append(el("span", "planyr-sketch-kind"), addBtn, arrowBtn, delBtn, status);
  toolsSlot.querySelector(".planyr-sketch-kind").textContent = "Sketch";

  const say = (msg) => { status.textContent = msg || ""; };

  /* The one line of instruction, and it shows ONLY while the canvas is empty — after the
   * first box it has taught what it had to teach and gets out of the way (PANEL-BREVITY). */
  const hint = el("p", "planyr-sketch-hint", { "data-testid": "sketch-hint" });
  hint.textContent = "Double-click anywhere to add a box · drag from a box’s dot onto another box to connect them.";
  paneSlot.append(hint);

  /* ---- painting ---------------------------------------------------------------------- */

  /** What is on screen right now: the document's sketch, unless a box is being typed into
   *  that the document has not been told about yet. */
  const painted = () => (editing ? editing.model : handle.attrs);

  function paint(model = painted()) {
    handle.setSelected(selected);
    handle.draw(model);
    syncTools(model);
  }

  /** Selection without a redraw — a redraw would destroy the element that has DOM focus,
   *  which is exactly what happens when a keyboard user tabs onto a box. */
  function paintSelection() {
    handle.setSelected(selected);
    for (const g of drawSlot.querySelectorAll("[data-sketch-node]")) {
      g.classList.toggle("is-selected", selected?.kind === "box" && g.getAttribute("data-sketch-node") === selected.id);
    }
    for (const g of drawSlot.querySelectorAll("[data-sketch-edge]")) {
      const [from, to] = (g.getAttribute("data-sketch-edge") || "").split(" ");
      g.classList.toggle("is-selected", selected?.kind === "edge" && selected.from === from && selected.to === to);
    }
    syncTools();
  }

  function syncTools(model = painted()) {
    const empty = !normalizeSketch(model).boxes.length;
    hint.style.display = empty ? "" : "none";
    arrowBtn.disabled = !(selected?.kind === "box");
    delBtn.disabled = !selected;
    arrowBtn.classList.toggle("is-on", !!pendingFrom);
    arrowBtn.setAttribute("aria-pressed", pendingFrom ? "true" : "false");
  }

  const select = (sel) => { selected = sel; paintSelection(); };

  /* ---- canvas geometry ---------------------------------------------------------------- */

  const canvasEl = () => drawSlot.querySelector("[data-sketch-canvas]");

  /** How many CANVAS units one screen pixel is worth. The SVG may be scaled down to fit a
   *  narrow sheet, so a raw client delta would move a box by the wrong amount. */
  function canvasScale(svg) {
    const rect = svg.getBoundingClientRect();
    const vb = (svg.getAttribute("viewBox") || "0 0 1 1").split(/\s+/).map(Number);
    return { rect, sx: rect.width ? vb[2] / rect.width : 1, sy: rect.height ? vb[3] / rect.height : 1 };
  }

  /** Canvas coordinates for a pointer event. */
  function canvasPoint(svg, e) {
    const { rect, sx, sy } = canvasScale(svg);
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }

  const boxUnder = (svg, e, model = painted()) => {
    const pt = canvasPoint(svg, e);
    return boxAt(layoutSketch(model), pt.x, pt.y);
  };

  /* ---- editing a box's words, IN the box ---------------------------------------------- */

  /* The overlay lives on the HOST, not in the drawing: every redraw replaces the drawing's
   * children, and a field that got replaced mid-keystroke would eat the keystroke. */
  const editor = el("div", "planyr-sketch-edit", { "data-testid": "sketch-box-edit" });
  const labelField = el("input", "planyr-sketch-edit-label", {
    type: "text", "data-testid": "sketch-box-label", placeholder: "Box", "aria-label": "Box label", spellcheck: "false",
  });
  const bodyField = el("textarea", "planyr-sketch-edit-body", {
    "data-testid": "sketch-box-body", rows: "2", placeholder: "More detail (optional)", "aria-label": "Box detail",
  });
  editor.append(labelField, bodyField);
  editor.style.display = "none";
  dom.appendChild(editor);

  function positionEditor() {
    if (!editing) return;
    const svg = canvasEl();
    if (!svg) return;
    const box = layoutSketch(editing.model).boxes.find((b) => b.id === editing.id);
    if (!box) return;
    const { rect, sx, sy } = canvasScale(svg);
    const host = dom.getBoundingClientRect();
    const kx = sx ? 1 / sx : 1;
    const ky = sy ? 1 / sy : 1;
    editor.style.left = `${Math.round(rect.left - host.left + box.x * kx)}px`;
    editor.style.top = `${Math.round(rect.top - host.top + box.y * ky)}px`;
    editor.style.width = `${Math.round(box.w * kx)}px`;
    editor.style.minHeight = `${Math.round(box.h * ky)}px`;
  }

  /** Put the caret in a box. `model` may be a preview that holds a box the document has not
   *  been told about — that is how a double-click can be undone by simply not typing.
   *  ⛔ Any open edit is closed FIRST and the document re-read AFTER, never before: the close
   *  writes the previous box's words, and a base read before it would paint them away. */
  function openEditor(id, model = null, committed = true) {
    if (editing && editing.id === id) { labelField.focus(); return; }
    if (editing) closeEditor(true);
    const base = model || handle.attrs;
    const box = normalizeSketch(base).boxes.find((b) => b.id === id);
    if (!box) return;
    editing = { id, model: normalizeSketch(base), committed };
    selected = { kind: "box", id };
    paint(editing.model);
    labelField.value = box.label;
    bodyField.value = box.body;
    editor.style.display = "";
    positionEditor();
    labelField.focus();
    labelField.select();
    say("");
  }

  function closeEditor(commit = true) {
    if (!editing) return;
    const { id, model, committed } = editing;
    const label = labelField.value.trim();
    const body = bodyField.value.trim();
    editing = null;                              // before any commit — the write comes back to us
    editor.style.display = "none";

    if (!commit) { paint(); return; }

    if (!label && !body) {
      /* Nothing was typed. An uncommitted box never existed; a committed one goes, and it
       * goes through the cascade like any other delete. */
      if (committed) {
        const { model: next, removedLinks } = removeBox(handle.attrs, id);
        handle.commit(next);
        say(removedLinks.length
          ? `Empty box removed, with ${removedLinks.length} arrow${removedLinks.length === 1 ? "" : "s"}.`
          : "Empty box removed.");
      } else {
        selected = null;
        paint();
      }
      return;
    }
    handle.commit(updateBox(committed ? handle.attrs : model, id, { label, body }));
  }

  /* A press anywhere outside the two fields ends the edit. `relatedTarget` inside the
   * overlay is the label→body Tab, which is not leaving at all. */
  editor.addEventListener("focusout", (e) => {
    if (destroyed || !editing) return;
    if (editor.contains(e.relatedTarget)) return;
    closeEditor(true);
  });
  /* A press on the overlay's own padding must not blur the field it is wrapped around —
   * clicking between the two fields is not "I am done". */
  editor.addEventListener("mousedown", (e) => { if (e.target === editor) e.preventDefault(); });
  editor.addEventListener("keydown", (e) => {
    e.stopPropagation();                        // the note's own Tab/Escape handling is not ours
    if (e.key === "Escape") { e.preventDefault(); closeEditor(true); focusBox(); return; }
    if (e.key === "Enter" && e.target === labelField) { e.preventDefault(); closeEditor(true); focusBox(); return; }
    /* ⛔ TAB HAS A DEFINED MEANING IN BOTH FIELDS (B1392 ×2). These two arrived long after
     * B1392, and its rule — "Tab belongs to the document while the caret is in it" — could
     * not reach them: the caret is in an <input>/<textarea> in a node view, and this handler
     * stops propagation, so Tab was the browser's focus key and walked out of the note.
     *   label  → the detail field of the same box
     *   detail → close the box and hand the caret back to the sketch
     * Shift+Tab reverses both. The escape hatch is unchanged: Escape closes the box, and the
     * document's own Escape-then-Tab release still gets you out to the browser. */
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.target === labelField) {
        if (e.shiftKey) { closeEditor(true); focusBox(); } else bodyField.focus();
        return;
      }
      if (e.target === bodyField) {
        if (e.shiftKey) labelField.focus();
        else { closeEditor(true); focusBox(); }
      }
    }
  });

  const focusBox = () => {
    const g = selected?.kind === "box" ? drawSlot.querySelector(`[data-sketch-node="${cssId(selected.id)}"]`) : null;
    if (g && typeof g.focus === "function") g.focus();
  };
  const cssId = (id) => String(id).replace(/["\\]/g, "\\$&");

  /* ---- making a box ------------------------------------------------------------------- */

  /** A box arrives at a point and takes the caret. Nothing is written to the document yet —
   *  see the header: a double-click you thought better of must leave nothing behind. */
  function beginBox(x, y) {
    if (editing) closeEditor(true);                 // …and only then read the document
    const { model, id } = addBox(handle.attrs, { x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) });
    openEditor(id, model, false);
  }

  addBtn.addEventListener("click", () => {
    if (!handle.isEditable()) return;
    const spot = nextSpot(handle.attrs);
    beginBox(spot.x, spot.y);
  });

  /* ---- the canvas: create, select, move, connect --------------------------------------- */

  function onDoubleClick(e) {
    if (destroyed || !handle.isEditable()) return;
    const svg = canvasEl();
    if (!svg) return;
    e.preventDefault();
    const target = e.target instanceof Element ? e.target : null;
    const group = target?.closest("[data-sketch-node]");
    if (group) { openEditor(group.getAttribute("data-sketch-node")); return; }
    /* AN EMPTY SPOT. The box is centred on the press, which is where a person expects the
     * thing they just double-clicked into existence to be. */
    const pt = canvasPoint(svg, e);
    beginBox(pt.x - BOX_W / 2, pt.y - BOX_MIN_H / 2);
  }

  function onPointerDown(e) {
    if (destroyed || !handle.isEditable()) return;
    let svg = canvasEl();
    if (!svg) return;
    const target = e.target instanceof Element ? e.target : null;

    /* ⛔ Read every id off the pressed element BEFORE anything else, because closing an open
     * edit commits it, which redraws the canvas and detaches the very node under the pointer.
     * Ids survive that; element references do not. */
    const gripId = target?.closest("[data-sketch-grip]")?.getAttribute("data-sketch-grip") || null;
    const nodeId = target?.closest("[data-sketch-node]")?.getAttribute("data-sketch-node") || null;
    const edgeEnds = target?.closest("[data-sketch-edge]")?.getAttribute("data-sketch-edge") || null;

    /* A press anywhere on the canvas ends the edit that is open, and the model is re-read
     * afterwards — so a drag or an arrow always starts from what was actually saved. */
    if (editing && editing.id !== nodeId) { closeEditor(true); svg = canvasEl(); if (!svg) return; }

    /* THE GRIP — an arrow, dragged straight out of the box, with no mode to turn on first.
     * Checked before the box itself: it sits on the box's edge, so a press on it must never
     * start a move instead. */
    if (gripId) {
      e.preventDefault();
      const from = gripId;
      if (editing) { closeEditor(true); svg = canvasEl(); if (!svg) return; }
      const box = layoutSketch(painted()).boxes.find((b) => b.id === from);
      if (!box) return;
      linking = { from, x1: box.x + box.w, y1: box.y + box.h / 2, line: null };
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("class", "planyr-sketch-pending");
      line.setAttribute("x1", String(linking.x1));
      line.setAttribute("y1", String(linking.y1));
      line.setAttribute("x2", String(linking.x1));
      line.setAttribute("y2", String(linking.y1));
      svg.appendChild(line);
      linking.line = line;
      drawSlot.classList.add("is-linking");
      say("Drop on another box to connect them.");
      try { drawSlot.setPointerCapture(e.pointerId); } catch (_) { /* a mouse without capture still works */ }
      return;
    }

    const id = nodeId;

    if (!id) {
      // An arrow can be picked up to delete it; anything else clears the selection.
      if (edgeEnds) {
        e.preventDefault();
        const [from, to] = edgeEnds.split(" ");
        select({ kind: "edge", from, to });
        say("Arrow selected — press Delete to remove it.");
        return;
      }
      if (pendingFrom) { pendingFrom = null; say("Arrow cancelled."); }
      select(null);
      return;
    }

    /* The keyboard route's second half: ↗ Arrow was pressed with a box selected, and this
     * is the box it points at. */
    if (pendingFrom) {
      e.preventDefault();
      connect(pendingFrom, id);
      pendingFrom = null;
      return;
    }

    select({ kind: "box", id });

    /* A DRAG. It previews locally and commits once on release — see the header.
     *
     * Two details that are fixes, not style. The pointer capture goes on `drawSlot`, which
     * is a STABLE element: every preview frame replaces the `<svg>`, so capturing on the
     * canvas would throw the capture away on the first move and the drag would stop the
     * moment the pointer left the box. And the movement is measured as a CLIENT-PIXEL DELTA
     * against a scale read once, because the canvas grows as a box is dragged right — a
     * position recomputed from the live canvas rect would drift under the pointer. */
    const box = layoutSketch(handle.attrs).boxes.find((b) => b.id === id);
    if (!box) return;
    e.preventDefault();
    const { sx, sy } = canvasScale(svg);
    dragging = { id, sx, sy, moved: false, base: handle.attrs, startX: box.x, startY: box.y, clientX: e.clientX, clientY: e.clientY };
    try { drawSlot.setPointerCapture(e.pointerId); } catch (_) { /* as above */ }
  }

  function onPointerMove(e) {
    if (linking) {
      const svg = canvasEl();
      if (!svg || !linking.line) return;
      const pt = canvasPoint(svg, e);
      linking.line.setAttribute("x2", String(Math.round(pt.x)));
      linking.line.setAttribute("y2", String(Math.round(pt.y)));
      return;
    }
    if (!dragging) return;
    const x = dragging.startX + (e.clientX - dragging.clientX) * dragging.sx;
    const y = dragging.startY + (e.clientY - dragging.clientY) * dragging.sy;
    if (!dragging.moved && Math.abs(e.clientX - dragging.clientX) < 2 && Math.abs(e.clientY - dragging.clientY) < 2) return;
    const next = moveBox(dragging.base, dragging.id, Math.max(0, x), Math.max(0, y));
    dragging.preview = next;
    dragging.moved = true;
    paint(next);
  }

  function onPointerUp(e) {
    if (linking) {
      const { from, line } = linking;
      linking = null;
      drawSlot.classList.remove("is-linking");
      line?.remove();
      const svg = canvasEl();
      const target = svg ? boxUnder(svg, e, handle.attrs) : null;
      if (!target) { say("No arrow — let go on the box you want to point at."); return; }
      connect(from, target.id);
      return;
    }
    if (!dragging) return;
    const { moved, preview } = dragging;
    dragging = null;
    if (moved && preview) { handle.commit(preview); say("Box moved."); }
    else paint();
  }

  /** One arrow, or a stated reason there is none (LOUD-FAILURE). */
  function connect(from, to) {
    const { model, added, reason } = addLink(handle.attrs, from, to);
    if (added) { selected = null; handle.commit(model); say("Arrow added."); }
    else say(`No arrow — ${reason}.`);
    syncTools();
  }

  arrowBtn.addEventListener("click", () => {
    if (selected?.kind !== "box") { say("Pick the box the arrow starts from first."); return; }
    pendingFrom = selected.id;
    say("Now click the box the arrow points to.");
    syncTools();
  });

  /* ---- deleting, and THE CASCADE ------------------------------------------------------- */

  function deleteSelection() {
    if (!selected) { say("Nothing selected."); return; }
    if (selected.kind === "edge") {
      handle.commit(removeLink(handle.attrs, selected.from, selected.to));
      selected = null;
      say("Arrow removed.");
      return;
    }
    const { model, removedLinks } = removeBox(handle.attrs, selected.id);
    selected = null;
    handle.commit(model);
    /* The consequence the user did not explicitly ask for is STATED, never silent. */
    say(removedLinks.length
      ? `Box deleted, and the ${removedLinks.length} arrow${removedLinks.length === 1 ? "" : "s"} that touched it.`
      : "Box deleted.");
  }

  delBtn.addEventListener("click", deleteSelection);

  function onKeyDown(e) {
    if (destroyed || !handle.isEditable() || editing) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      if (!selected) return;
      e.preventDefault();
      e.stopPropagation();
      deleteSelection();
      return;
    }
    if ((e.key === "Enter" || e.key === "F2") && selected?.kind === "box") {
      e.preventDefault();
      e.stopPropagation();
      openEditor(selected.id);
      return;
    }
    if (e.key === "Escape" && (selected || pendingFrom)) {
      e.stopPropagation();
      pendingFrom = null;
      select(null);
      say("");
    }
  }

  /* A box is a real focus stop, so tabbing onto one selects it — the same state a click
   * produces, which is what makes the tool buttons work for a keyboard user. */
  function onFocusIn(e) {
    const group = e.target instanceof Element ? e.target.closest("[data-sketch-node]") : null;
    if (!group) return;
    const id = group.getAttribute("data-sketch-node");
    if (selected?.kind === "box" && selected.id === id) return;
    selected = { kind: "box", id };
    paintSelection();
  }

  drawSlot.addEventListener("pointerdown", onPointerDown);
  drawSlot.addEventListener("pointermove", onPointerMove);
  drawSlot.addEventListener("pointerup", onPointerUp);
  drawSlot.addEventListener("pointercancel", onPointerUp);
  drawSlot.addEventListener("dblclick", onDoubleClick);
  drawSlot.addEventListener("keydown", onKeyDown);
  drawSlot.addEventListener("focusin", onFocusIn);
  drawSlot.addEventListener("scroll", positionEditor);

  /* ---- staying in step with the document ---------------------------------------------- */

  /** Called when the node's attributes changed underneath us — another window, an undo, a
   *  cloud adopt. A live edit keeps its own preview; everything else repaints. */
  function refresh() {
    if (destroyed) return;
    if (editing) {
      /* The document moved while a box is being typed into. Keep the words, re-base the
       * preview on what the document now says, and drop the edit if the box itself is gone. */
      const live = handle.attrs;
      if (!live.boxes.some((b) => b.id === editing.id)) {
        if (editing.committed) { editing = null; editor.style.display = "none"; }
      } else if (editing.committed) {
        editing.model = live;
      }
    }
    paint();
    positionEditor();
  }

  paint();

  /* A sketch inserted from the toolbar with nothing selected arrives holding ONE EMPTY BOX,
   * and this is what puts the caret in it — so "press Box, type three words" needs no
   * instructions. An existing sketch never steals focus. */
  const boxes = handle.attrs.boxes;
  if (handle.isEditable() && boxes.length === 1 && !boxes[0].label && !boxes[0].body) {
    setTimeout(() => { if (!destroyed && !editing) openEditor(boxes[0].id); }, 0);
  }

  return {
    refresh,
    destroy() {
      destroyed = true;
      editing = null;
      editor.remove();
      drawSlot.removeEventListener("pointerdown", onPointerDown);
      drawSlot.removeEventListener("pointermove", onPointerMove);
      drawSlot.removeEventListener("pointerup", onPointerUp);
      drawSlot.removeEventListener("pointercancel", onPointerUp);
      drawSlot.removeEventListener("dblclick", onDoubleClick);
      drawSlot.removeEventListener("keydown", onKeyDown);
      drawSlot.removeEventListener("focusin", onFocusIn);
      drawSlot.removeEventListener("scroll", positionEditor);
    },
  };
}

export default attachSketchEditor;
