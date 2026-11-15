/* notesBoxClipboard — COPYING A BOX IS NOT COPYING TEXT (NEW-1, owner 2026-11-15: "it must be obvious when he is copying a BOX as opposed to TEXT,
 * the way Excel shows a copied cell").
 *
 * TWO KINDS OF COPY, and they never share a path:
 *   · A BOX COPY — one or more boxes are SELECTED (he clicked a box's outline) and there is no text selection. Ctrl+C puts the whole boxes
 *     on the clipboard (`encodeBoxPayload`: every box as stored — position, width, formatting, table, picture reference — in a data attribute of
 *     the clipboard HTML), draws Excel's moving dashed outline on them, and the next Ctrl+V makes NEW boxes. The HTML and the plain text still
 *     carry the boxes' content, so pasting into Word / Excel / an email works like any other copy.
 *   · A TEXT COPY — any text selection (a drag, Shift+arrows, Ctrl+A). It copies the TEXT ONLY: `unwrapCopiedSlice` (run by ProseMirror's own
 *     `transformCopied`) takes the box frame out of the copied slice, so the clipboard never says "this came from a box at x,y" and a paste never
 *     recreates one. MEASURED on 2026-11-15 before this existed: a partial copy carried `data-pm-slice="1 1 ["noteAnchor",{aid,x,y,w…}]"`, and a
 *     Ctrl+A copy put every `.planyr-anchor` div (with `data-anchor-x/y/w`) on the clipboard.
 *
 * PURE where it can be (no DOM, no editor). The one DOM-free plugin at the bottom is the `transformCopied` hook. */
import { Fragment, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { unnestDoc } from "./notesAnchorNest.js";

export const BOX_ATTR = "data-planyr-boxes";
/** How far a pasted copy sits from the box it was copied from, down and right, each time it is pasted again (PowerPoint's offset-paste). */
export const PASTE_STEP = 24;
export const MAX_PASTE_BOXES = 40;
export const MAX_PAYLOAD_CHARS = 1_500_000;

const ANCHOR = "noteAnchor";
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export function mintBoxId() { return `a${Date.now().toString(36)}k${Math.floor(Math.random() * 1e6).toString(36)}${Math.floor(Math.random() * 1e3).toString(36)}`; }
export function mintToken() { return `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`; }

/* ── the clipboard payload ───────────────────────────────────────────────────────────────────── */

/** `{ token, pageId, boxes }` → the string that goes in the HTML attribute. encodeURIComponent leaves nothing that needs HTML escaping in a double-quoted attribute. */
export function encodeBoxPayload({ token, pageId, boxes }) {
  return encodeURIComponent(JSON.stringify({ v: 1, token: String(token || ""), pageId: pageId == null ? null : String(pageId), boxes }));
}

/** The payload inside clipboard HTML. `null` = this clipboard holds no box copy; `{ error }` = it claims to but cannot be read (the caller says so). */
export function decodeBoxPayload(html) {
  if (!html || typeof html !== "string" || html.indexOf(BOX_ATTR) < 0) return null;
  const m = new RegExp(`${BOX_ATTR}="([^"]*)"`).exec(html);
  if (!m) return null;
  if (m[1].length > MAX_PAYLOAD_CHARS) return { error: "too-big" };
  let raw;
  try { raw = JSON.parse(decodeURIComponent(m[1])); } catch (_) { return { error: "unreadable" }; }
  if (!raw || raw.v !== 1 || !Array.isArray(raw.boxes)) return { error: "unreadable" };
  const flat = unnestDoc({ type: "doc", content: raw.boxes.filter((b) => b && b.type === ANCHOR && Array.isArray(b.content)) }).content || [];
  if (!flat.length) return { error: "empty" };
  if (flat.length > MAX_PASTE_BOXES) return { error: "too-many" };
  return { token: String(raw.token || ""), pageId: raw.pageId == null ? null : String(raw.pageId), boxes: flat };
}

/** Does this clipboard HTML hold a readable box copy? The other paste routes (loose paste, armed paste) stand down for it: a box copy is claimed once, by `pasteBoxCopy`. */
export function carriesBoxCopy(html) { const p = decodeBoxPayload(html); return !!p && !p.error; }

/** The node JSON of the selected boxes, in document order, ready for the payload. Frames only — arrows and ids are never carried over. */
export function boxesForCopy(doc, ids) {
  const want = new Set([...ids].map(String));
  const out = [];
  doc.forEach((node) => { if (node.type.name === ANCHOR && want.has(String(node.attrs.aid || ""))) out.push(node.toJSON()); });
  return out;
}

/* ── where a pasted copy lands ───────────────────────────────────────────────────────────────── */

const repeats = new Map();
/** How many times this copy has already been pasted on this page (so each paste steps further from the original). */
export function nextRepeat(token, pageId) {
  const k = `${token}|${pageId}`; const n = repeats.get(k) || 0; repeats.set(k, n + 1);
  if (repeats.size > 200) repeats.delete(repeats.keys().next().value);
  return n;
}

/**
 * The boxes to insert: fresh ids, new places.
 *   · an ARMED POINT on blank paper (he clicked there, then pasted) — the group's top-left lands on that point;
 *   · otherwise the SAME page — offset from the source, down and right, one step further per repeat (PowerPoint);
 *   · otherwise ANOTHER page — in place (the same x, y), one step further per repeat.
 * A group keeps its arrangement (one shift for all). Position is the only thing that changes: width, height, formatting and content are the box's own.
 */
export function planBoxPaste({ boxes, samePage, repeat = 0, armed = null }) {
  const minX = Math.min(...boxes.map((b) => num(b.attrs?.x)));
  const minY = Math.min(...boxes.map((b) => num(b.attrs?.y)));
  let dx; let dy;
  if (armed && Number.isFinite(Number(armed.x)) && Number.isFinite(Number(armed.y))) { dx = Math.round(armed.x - minX) + PASTE_STEP * repeat; dy = Math.round(armed.y - minY) + PASTE_STEP * repeat; }
  else if (samePage) { dx = dy = PASTE_STEP * (repeat + 1); }
  else { dx = dy = PASTE_STEP * repeat; }
  return boxes.map((b) => ({
    ...b,
    attrs: { ...(b.attrs || {}), aid: mintBoxId(), x: Math.round(num(b.attrs?.x) + dx), y: Math.round(num(b.attrs?.y) + dy) },
  }));
}

/** Every picture / attachment inside the boxes: `[{ kind: "image"|"file", id, mime, … }]`, so a paste onto ANOTHER page can give the copy bytes of its own. */
export function mediaRefs(boxes) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "noteImage" && n.attrs?.imageId) out.push({ kind: "image", id: String(n.attrs.imageId), mime: n.attrs.mime || "", w: num(n.attrs.w), h: num(n.attrs.h) });
    if (n.type === "noteAttachment" && n.attrs?.fileId) out.push({ kind: "file", id: String(n.attrs.fileId), name: n.attrs.name || "", mime: n.attrs.mime || "" });
    (n.content || []).forEach(walk);
  };
  boxes.forEach(walk);
  return out;
}
/** The boxes with each media id replaced through `idMap` (old → new). Pure; boxes that reference nothing are returned as-is. */
export function remapMedia(boxes, idMap) {
  if (!idMap || !idMap.size) return boxes;
  const swap = (n) => {
    if (!n || typeof n !== "object") return n;
    let attrs = n.attrs;
    if (n.type === "noteImage" && attrs?.imageId && idMap.has(String(attrs.imageId))) attrs = { ...attrs, imageId: idMap.get(String(attrs.imageId)) };
    if (n.type === "noteAttachment" && attrs?.fileId && idMap.has(String(attrs.fileId))) attrs = { ...attrs, fileId: idMap.get(String(attrs.fileId)) };
    return { ...n, ...(attrs !== n.attrs ? { attrs } : {}), ...(Array.isArray(n.content) ? { content: n.content.map(swap) } : {}) };
  };
  return boxes.map(swap);
}

/* ── a text copy never carries the box ───────────────────────────────────────────────────────── */

/**
 * A copied slice with every box frame taken out: the words, tables and pictures stay, the `noteAnchor` wrapper goes. Same Slice object back when it
 * held no box, so callers can compare by identity.
 * `openStart` / `openEnd` count open levels INTO the first / last node, so unwrapping an open first / last box takes one level off that side.
 */
export function unwrapCopiedSlice(slice) {
  if (!slice || !slice.content) return slice;
  let any = false;
  slice.content.forEach((n) => { if (n.type.name === ANCHOR) any = true; });
  if (!any) return slice;
  const kids = [];
  let { openStart, openEnd } = slice;
  const last = slice.content.childCount - 1;
  slice.content.forEach((n, _o, i) => {
    if (n.type.name !== ANCHOR) { kids.push(n); return; }
    if (i === 0 && openStart > 0) openStart -= 1;
    if (i === last && openEnd > 0) openEnd -= 1;
    n.forEach((c) => kids.push(c));
  });
  if (!kids.length) return Slice.empty;
  const frag = Fragment.from(kids);
  return new Slice(frag, Math.min(openStart, maxOpen(frag.firstChild, false)), Math.min(openEnd, maxOpen(frag.lastChild, true)));
}
/** How many levels a slice side can stay open into `node`: each non-leaf level with a child to step into counts one. */
function maxOpen(node, fromEnd) { let d = 0; let n = node; while (n && !n.isLeaf && (fromEnd ? n.lastChild : n.firstChild)) { d += 1; n = fromEnd ? n.lastChild : n.firstChild; } return d; }

const key = new PluginKey("noteCopyScope");
/** ProseMirror's own `transformCopied` hook: every copy and cut of a text selection passes through it. */
export function copyScopePlugin() {
  return new Plugin({ key, props: { transformCopied: (slice) => unwrapCopiedSlice(slice) } });
}
