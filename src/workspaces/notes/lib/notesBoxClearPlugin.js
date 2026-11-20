/* notesBoxClearPlugin — the live half of `notesBoxClear.js` (NEW-1 / NEW-2, B2671237 + B2671238). READ THAT FILE'S HEADER FIRST.
 *
 * After a person's edit changes a box's rectangle, this measures every box, asks the pure planner which boxes the change NEWLY
 * covers, and writes their new `y` as ONE appended transaction — so the push rides the edit's own undo step (one Ctrl+Z puts the
 * words AND the neighbours back), survives a reload (it is stored on the node, like any placement) and is announced to nothing.
 *
 * ⛔ WHICH BOXES ARE "PLACED BY HAND" (owner decision 2026-11-15, NEW-2: a dropped / resized / pasted box may overlap, nothing moves for it).
 * Every USER transaction is compared box-by-box against the document before it: a box whose STORED placement (x, y, width, height on the
 * node) changed was placed by a gesture's commit, an arrow-key nudge or a paste — those write the attributes — whereas growth from a box's
 * own words changes only its rendered height and leaves the stored attributes alone. The quiet self-fitting width write is not a user
 * transaction, so it never counts. A placed box is handed to the planner as `placed`, and the planner never lets it push anything.
 *
 * WHEN IT ACTS, and when it deliberately does not:
 *   · only after a `user` transaction (typing, paste, a toolbar change, a resize / move commit). NOT after undo / redo (the history
 *     already restores the positions it saved), NOT after the pass's own push, NOT after a whole-document replace (a sync or a
 *     version restore hands over somebody else's layout), NOT on open — the first measurement is only a baseline.
 *   · NOT while a drag / resize gesture is live (a pinned drag cursor is the one signal every gesture here raises): the commit at
 *     release is the edit, and `last` keeps the pre-gesture picture so "newly covered" is judged against what was there.
 *   · a box without an `aid` is skipped (ids are stamped on mount; a legacy box simply is not tracked until then).
 * Measured in a MICROTASK after the dispatch: layout is already current (reading `offsetHeight` forces it), and a microtask runs
 * before the browser paints, so the overlap is never on screen for a frame.
 * A ResizeObserver covers the edit whose height settles later (a picture decoding, a web font landing) for three seconds after the
 * last user edit — and never at rest, so opening a note writes nothing. */
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { planClear } from "./notesBoxClear.js";

export const BOX_CLEAR_META = "planyrBoxClear";
const key = new PluginKey("noteBoxClear");
const RECENT_EDIT_MS = 3000;

/** The stored placement of every top-level box by id: "x|y|w|h". */
function storedPlacements(doc) {
  const out = new Map();
  doc.forEach((node) => {
    if (node.type.name !== "noteAnchor" || !node.attrs.aid) return;
    const a = node.attrs;
    out.set(String(a.aid), [Number(a.x) || 0, Number(a.y) || 0, a.w == null ? "" : Number(a.w), a.h == null ? "" : Number(a.h)].join("|"));
  });
  return out;
}
/** Ids present in both documents whose stored placement differs. Pure. */
export function placedBetween(before, after) {
  const out = [];
  const a = storedPlacements(before);
  for (const [id, now] of storedPlacements(after)) { const was = a.get(id); if (was !== undefined && was !== now) out.push(id); }
  return out;
}

const replacesWholeDoc = (tr) => tr.steps.some((s, i) => s instanceof ReplaceStep && s.from === 0 && s.to === tr.docs[i].content.size && tr.docs[i].content.size > 0);

function kindOf(tr, prev) {
  if (tr.getMeta(BOX_CLEAR_META)) return "clear";
  if (tr.getMeta("appendedTransaction")) return prev;   // an appended housekeeping step takes its root's kind
  if (tr.getMeta("history$")) return "history";
  if (tr.getMeta("addToHistory") === false) return "quiet";
  if (replacesWholeDoc(tr)) return "external";
  return "user";
}

/** Every tracked box's rectangle in the editor's own (unscaled) frame, and where it sits in the document. */
function measureBoxes(view) {
  const map = new Map(); const at = new Map();
  view.state.doc.forEach((node, offset) => {
    if (node.type.name !== "noteAnchor" || !node.attrs.aid) return;
    const dom = view.nodeDOM(offset);
    if (!dom || dom.nodeType !== 1) return;
    map.set(node.attrs.aid, { x: dom.offsetLeft, y: dom.offsetTop, w: dom.offsetWidth, h: dom.offsetHeight });
    at.set(node.attrs.aid, offset);
  });
  return { map, at };
}

const gestureLive = () => typeof document !== "undefined" && !!document.head.querySelector("style[data-pinned-cursor]");

export function boxClearPlugin() {
  /* ids placed by hand since the last stable measurement; filled by the state's `apply` (every transaction passes through it exactly once),
   * drained by `run`. A closure rather than plugin state because several transactions can land inside one microtask batch. */
  const placedAcc = new Set();
  return new Plugin({
    key,
    state: {
      init: () => ({ kind: "init", n: 0 }),
      apply(tr, prev) {
        if (!tr.docChanged) return prev;
        const kind = kindOf(tr, prev.kind);
        if (kind === "user") for (const id of placedBetween(tr.before, tr.doc)) placedAcc.add(id);
        return { kind, n: prev.n + 1 };
      },
    },
    view(editorView) {
      let last = null;
      let seen = 0;
      let batch = null;           // the strongest kind queued for the next microtask
      let lastUserAt = 0;
      let ro = null;
      const observed = new Set();

      const run = (view, kind) => {
        if (!view || view.isDestroyed || !view.dom?.isConnected) return;
        if (gestureLive()) return;                       // the release commits; `last` stays the pre-gesture picture
        const { map, at } = measureBoxes(view);
        const placed = new Set(placedAcc); placedAcc.clear();
        if (!last || kind !== "user") { last = map; return; }
        const plan = planClear(last, map, placed);
        if (!plan.size) { last = map; return; }
        const tr = view.state.tr;
        const next = new Map(map);
        for (const [id, newY] of plan) {
          const pos = at.get(id);
          const node = view.state.doc.nodeAt(pos);
          if (!node) continue;
          const cur = map.get(id);
          const delta = newY - cur.y;
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, y: Math.round((Number(node.attrs.y) || 0) + delta) });
          next.set(id, { ...cur, y: newY });
        }
        if (!tr.docChanged) { last = map; return; }
        tr.setMeta(BOX_CLEAR_META, true);
        tr.setMeta("appendedTransaction", view.state.tr);   // joins the edit's undo step instead of opening a new one
        tr.setMeta("addToHistory", true);
        last = next;
        view.dispatch(tr);
      };

      const schedule = (view, kind) => {
        const first = batch === null;
        batch = batch === "user" || kind === "user" ? "user" : kind;
        if (!first) return;
        queueMicrotask(() => { const k = batch; batch = null; run(view, k); });
      };

      const observe = (view) => {
        if (typeof ResizeObserver !== "function") return;
        if (!ro) ro = new ResizeObserver(() => schedule(view, Date.now() - lastUserAt < RECENT_EDIT_MS ? "user" : "quiet"));
        for (const el of view.dom.querySelectorAll(".planyr-anchor")) if (!observed.has(el)) { observed.add(el); ro.observe(el); }
      };

      /* The baseline: measured once the first layout exists. */
      queueMicrotask(() => run(editorView, "quiet"));
      observe(editorView);
      return {
        update(view) {
          const st = key.getState(view.state);
          if (st.n === seen) return;
          seen = st.n;
          if (st.kind === "user") lastUserAt = Date.now();
          schedule(view, st.kind);
          observe(view);
        },
        destroy() { if (ro) ro.disconnect(); observed.clear(); },
      };
    },
  });
}
