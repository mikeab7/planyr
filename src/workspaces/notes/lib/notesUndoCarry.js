/* lib/notesUndoCarry.js — EACH NOTES PAGE KEEPS ITS OWN UNDO HISTORY WHEN YOU SWITCH PAGES (NEW-1, 2026-11-13).
 *
 * Owner: Ctrl+Z should keep working "even if I go to an old page or a page I wasn't on in a minute" — "if it doesn't cause much bloat".
 *
 * WHY IT WAS LOST. `Notes.jsx` keys the editor by page id (`key={pageId:bodyEpoch}`), so a page switch UNMOUNTS the editor and builds a
 * new one for the next page. That remount is a bug fix and stays exactly as it is (it is what flushes the autosave and what stops one
 * page's undo walking into another's text) — but a new editor starts with an empty history, so Ctrl+Z after "A → B → A" found nothing.
 *
 * WHAT THIS DOES, in one sentence: when a page's editor goes away its undo / redo stacks are packed into plain data and parked in a small
 * in-memory table; when that page's editor is built again the stacks are rebuilt against the NEW editor and handed to the history plugin.
 *
 * ⛔ WHY IT IS NOT "JUST KEEP THE OLD HISTORY OBJECT". Every Tiptap editor builds its OWN ProseMirror schema, so the node types inside an
 * undo step belong to the old editor's schema; applying such a step to the new editor's document throws "Invalid content for node doc".
 * So each step is stored as JSON text (`step.toJSON()`) and revived with `Step.fromJSON(newSchema, …)`. Step maps and selection bookmarks
 * are plain numbers and carry over untouched. (Measured red in test/notesUndoCarry.test.js — two schemas, the raw history object.)
 *
 * ⛔ THE STALE GUARD IS THE WHOLE SAFETY STORY. A saved history is only meaningful against the exact document it was saved against, so the
 * entry carries a fingerprint of that document and is replayed ONLY if the page's document is byte-for-byte the same when it is opened
 * again. Another tab or computer changed the page, a version was restored, a conflict was resolved, the sync adopted a newer body → the
 * fingerprints differ → the saved history is DISCARDED, never replayed. A mismatch is always a clean "nothing to undo", never a wrong undo.
 *
 * THE CAPS (what "no bloat" means here, all in this file so they are one decision):
 *   · CARRY_PAGES  = 5   — other pages remembered; the oldest-visited is dropped first
 *   · CARRY_EVENTS = 50  — undo steps kept per page (each of undo and redo); oldest dropped first (ProseMirror's own default is 100)
 *   · CARRY_BYTES  = 200 KB — step JSON per page; oldest steps dropped until under; one step bigger than that drops the page's history
 * Everything is in memory in this tab and is never written to storage or sent to the cloud: it does NOT survive a reload (stated, not an
 * oversight — a reload re-reads the page from storage with an empty history, exactly as before) and is never synced between computers.
 * No new dependency, and this file rides the editor's own lazy chunk (it imports only `@tiptap/pm`, which the editor already ships).
 *
 * Relies on prosemirror-history 1.5's state shape (HistoryState {done, undone, prevRanges, prevTime, prevComposition}, Branch {items,
 * eventCount}, Item {map, step, selection, mirrorOffset}) and on `tr.setMeta(historyKey, { historyState })` — the path its own undo uses.
 * That shape is internal, so the whole thing is pinned by test/notesUndoCarry.test.js; an upgrade that moves it fails THERE, loudly,
 * instead of silently losing undo. If the shape is not what this expects, capture / restore do nothing and say why.
 */
import { Step, StepMap } from "@tiptap/pm/transform";

export const CARRY_PAGES = 5;
export const CARRY_EVENTS = 50;
export const CARRY_BYTES = 200_000;

/** pageKey → { fp, done, undone }. A Map keeps insertion order, so the first key is the least recently parked. */
const parked = new Map();
/** The history plugin's `Item` class, learned from the first real item we pack (it is not exported by prosemirror-history). */
let ItemCtor = null;

/** For tests and sign-out. */
export function clearCarry() { parked.clear(); }
/** Forget every parked page whose key does not start with `prefix` — another account's pages must not linger in this tab after a sign-out / switch. */
export function forgetOutside(prefix) { for (const k of [...parked.keys()]) if (!k.startsWith(prefix)) parked.delete(k); }
export function carriedPages() { return [...parked.keys()]; }
export function hasCarry(pageKey) { return parked.has(pageKey); }

/** The history plugin of a state, found by its key (`new PluginKey("history")` → "history$"). Null if there is none. */
export function historyPluginOf(state) {
  return (state?.plugins || []).find((p) => typeof p.key === "string" && p.key.startsWith("history$")) || null;
}
function historyStateOf(state) {
  const plugin = historyPluginOf(state);
  const hs = plugin ? plugin.getState(state) : null;
  return hs && hs.done && hs.undone && typeof hs.done.eventCount === "number" ? { plugin, hs } : null;
}

/** A short, exact-enough fingerprint of a document: length + two independent 32-bit hashes of its JSON. Collisions are not a realistic worry for
 *  "is this the same page I left a minute ago", and it keeps a copy of the whole document out of memory. */
export function docFingerprint(doc) {
  const s = JSON.stringify(doc && typeof doc.toJSON === "function" ? doc.toJSON() : doc);
  let a = 0x811c9dc5; let b = 5381;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = (Math.imul(b, 33) + c) >>> 0;
  }
  return `${s.length}:${a.toString(36)}:${b.toString(36)}`;
}

/** Pack one Branch: oldest → newest `{ r: step-map ranges, s: step JSON text | null, b: selection bookmark | null, m: mirrorOffset }`. */
function packBranch(branch) {
  const items = [];
  branch.items.forEach((item) => {
    if (!ItemCtor && item && item.constructor && item.constructor.name !== "Object") ItemCtor = item.constructor;
    items.push({
      r: Array.from(item.map.ranges),
      s: item.step ? JSON.stringify(item.step.toJSON()) : null,
      b: item.selection || null,
      m: item.mirrorOffset == null ? undefined : item.mirrorOffset,
    });
  });
  return capPacked(items);
}

/** Enforce the caps on a packed list: an EVENT starts at an item that carries a selection bookmark; drop whole events from the old end. */
function capPacked(items) {
  const starts = [];
  items.forEach((it, i) => { if (it.b) starts.push(i); });
  let firstEvent = Math.max(0, starts.length - CARRY_EVENTS);
  const bytesFrom = (k) => { let n = 0; for (let i = k < starts.length ? starts[k] : items.length; i < items.length; i += 1) n += items[i].s ? items[i].s.length : 0; return n; };
  while (firstEvent < starts.length && bytesFrom(firstEvent) > CARRY_BYTES) firstEvent += 1;
  if (firstEvent >= starts.length) return { items: [], events: 0, bytes: 0 };
  const kept = items.slice(starts[firstEvent]);
  return { items: kept, events: starts.length - firstEvent, bytes: bytesFrom(firstEvent) };
}

/**
 * Park a page's history. Call it when the page's editor is going away, while its state is still readable.
 * @param {string} pageKey a key unique to (account, page)
 * @param {import("@tiptap/pm/state").EditorState} state
 * @returns {{ parked: boolean, reason?: string, done?: number, undone?: number }}
 */
export function captureHistory(pageKey, state) {
  parked.delete(pageKey);
  const found = historyStateOf(state);
  if (!found) return { parked: false, reason: "no-history-plugin" };
  let done; let undone;
  try { done = packBranch(found.hs.done); undone = packBranch(found.hs.undone); } catch (e) { return { parked: false, reason: `pack-failed:${e?.name || "error"}` }; }
  if (!done.events && !undone.events) return { parked: false, reason: "nothing-to-keep" };
  parked.set(pageKey, { fp: docFingerprint(state.doc), done, undone });
  while (parked.size > CARRY_PAGES) parked.delete(parked.keys().next().value);
  return { parked: true, done: done.events, undone: undone.events };
}

function reviveBranch(packed, schema, Branch, rope) {
  const items = packed.items.map((it) => new ItemCtor(
    new StepMap(it.r),
    it.s ? Step.fromJSON(schema, JSON.parse(it.s)) : undefined,
    it.b || undefined,
    it.m,
  ));
  return new Branch(rope.from(items), packed.events);
}

/**
 * Build the transaction that hands the parked history back to a freshly built editor, or say why not. Consumes the parked entry either way
 * (a page is opened once per park). It does NOT dispatch — the caller does, so a test can look first.
 * @returns {{ tr: import("@tiptap/pm/state").Transaction|null, reason?: string, done?: number, undone?: number }}
 */
export function planRestore(pageKey, state) {
  const entry = parked.get(pageKey);
  if (!entry) return { tr: null, reason: "none-parked" };
  parked.delete(pageKey);
  const found = historyStateOf(state);
  if (!found) return { tr: null, reason: "no-history-plugin" };
  if (!ItemCtor) return { tr: null, reason: "item-class-unknown" };
  if (entry.fp !== docFingerprint(state.doc)) return { tr: null, reason: "page-changed" };
  const { plugin, hs } = found;
  try {
    const Branch = hs.done.constructor;
    const rope = hs.done.items.constructor;
    const next = new hs.constructor(
      reviveBranch(entry.done, state.schema, Branch, rope),
      reviveBranch(entry.undone, state.schema, Branch, rope),
      null, 0, -1,                     // prevRanges / prevTime / prevComposition: the next keystroke opens a NEW undo step
    );
    return { tr: state.tr.setMeta(plugin.key, { historyState: next }), done: entry.done.events, undone: entry.undone.events };
  } catch (e) {
    return { tr: null, reason: `revive-failed:${e?.name || "error"}` };
  }
}
