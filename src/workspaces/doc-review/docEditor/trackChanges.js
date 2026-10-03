/* Track Changes for the document editor — pure ProseMirror, no DOM.
 *
 * Model: an insertion is text carrying a `trackIns` mark, a deletion is text that is STILL IN THE DOC
 * carrying a `trackDel` mark (struck through), each with {id, author, date}. A paragraph break that was
 * added/removed is `attrs.pMark = {type:'ins'|'del', id, author, date}` on the paragraph.
 *
 *   fixupTracked(tr, state, {author})   — called on every user transaction while Track Changes is ON:
 *       lets the edit apply, then RE-INSERTS what it deleted (marked deleted) and marks what it inserted.
 *       Your own un-accepted insertions are really removed (typing then deleting leaves no trace).
 *   listChanges / acceptChange / rejectChange / acceptAll / rejectAll — the review actions. */
import { ReplaceStep } from "@tiptap/pm/transform";
import { Fragment, Slice } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

export const BYPASS = "trackBypass";
const isoNow = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
let seq = 0;
export const newChangeId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

const isInline = (n) => n.isInline;
const markOf = (n, type) => n.marks.find((m) => m.type === type) || null;

/* ---------- the fix-up ---------- */
function filterOwnInserts(fragment, schema, author) {
  const ins = schema.marks.trackIns;
  let kept = false;
  const walk = (frag) => {
    const out = [];
    frag.forEach((n) => {
      if (n.isInline) {
        const m = markOf(n, ins);
        if (m && m.attrs.author === author) return;      // own insertion → really gone
        kept = true; out.push(n);
      } else if (n.content.size || n.type.isTextblock) out.push(n.copy(walk(n.content)));
      else { kept = true; out.push(n); }
    });
    return Fragment.from(out);
  };
  const f = walk(fragment);
  return kept ? f : null;
}

function markInline(fragment, schema, id, author, date) {
  const del = schema.marks.trackDel;
  const walk = (frag) => {
    const out = [];
    frag.forEach((n) => {
      if (n.isInline) out.push(markOf(n, del) ? n : n.mark(del.create({ id, author, date }).addToSet(n.marks)));
      else out.push(n.copy(walk(n.content)));
    });
    return Fragment.from(out);
  };
  return walk(fragment);
}

function flattenInline(fragment) {
  const out = [];
  const walk = (frag) => frag.forEach((n) => (n.isInline ? out.push(n) : walk(n.content)));
  walk(fragment);
  return Fragment.from(out);
}

export function fixupTracked(tr, state, { author = "Reviewer" } = {}) {
  const schema = state.schema;
  const ins = schema.marks.trackIns, del = schema.marks.trackDel;
  if (!ins || !del || !tr.docChanged) return tr;
  const date = isoNow();
  const nSteps = tr.steps.length;
  const selBefore = tr.selection;
  const inserts = []; // {from,to}
  const dels = [];    // {pos, slice}
  for (let i = 0; i < nSteps; i++) {
    const step = tr.steps[i];
    if (!(step instanceof ReplaceStep)) continue;
    const later = tr.mapping.slice(i + 1);
    step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
      if (newEnd > newStart) { const f = later.map(newStart, 1), t = later.map(newEnd, -1); if (t > f) inserts.push({ from: f, to: t }); }
      if (oldEnd > oldStart) dels.push({ pos: later.map(newStart, -1), slice: tr.docs[i].slice(oldStart, oldEnd) });
    });
  }
  if (!inserts.length && !dels.length) return tr;

  // 1) mark what was inserted (positions don't move)
  const ownId = (pos) => { // keep typing in one change: reuse an adjacent own insertion's id
    const $p = tr.doc.resolve(Math.min(pos, tr.doc.content.size));
    for (const n of [$p.nodeBefore, $p.nodeAfter]) { const m = n && markOf(n, ins); if (m && m.attrs.author === author) return m.attrs.id; }
    return null;
  };
  for (const r of inserts) {
    if (r.to > tr.doc.content.size) continue;
    const id = ownId(r.from) || ownId(r.to) || newChangeId();
    tr.removeMark(r.from, r.to, del);
    tr.addMark(r.from, r.to, ins.create({ id, author, date }));
    tr.doc.nodesBetween(r.from, r.to, (n, pos) => { // a paragraph break typed in: the left paragraph's mark is "inserted"
      if (n.isTextblock && pos + n.nodeSize - 1 >= r.from && pos + n.nodeSize - 1 < r.to && !(n.attrs.pMark && n.attrs.pMark.type)) tr.setNodeMarkup(pos, undefined, { ...n.attrs, pMark: { type: "ins", id, author, date } });
      return true;
    });
  }

  // 2) re-insert what was deleted, marked deleted — right-to-left so earlier positions stay valid
  dels.sort((a, b) => b.pos - a.pos);
  const noInsertion = !inserts.length;
  let headAfter = null;
  for (const d of dels) {
    let slice = d.slice;
    const first = slice.content.firstChild;
    const leftOwnMark = slice.content.childCount > 1 && first && first.attrs && first.attrs.pMark && first.attrs.pMark.type === "ins" && first.attrs.pMark.author === author;
    let frag = filterOwnInserts(slice.content, schema, author);
    if (leftOwnMark) { // backspacing over your own Enter: a real join, not a "deleted paragraph mark"
      const $at = tr.doc.resolve(Math.min(d.pos, tr.doc.content.size));
      const para = $at.parent;
      if (para.isTextblock && para.attrs.pMark && para.attrs.pMark.type === "ins") tr.setNodeMarkup($at.before(), undefined, { ...para.attrs, pMark: null });
      frag = frag ? flattenInline(frag) : null;
      slice = frag && new Slice(frag, 0, 0);
    } else if (frag) slice = new Slice(frag, Math.min(slice.openStart, frag.childCount ? slice.openStart : 0), slice.openEnd);
    if (!frag || !slice || !slice.content.size) continue;
    const id = newChangeId();
    const marked = new Slice(markInline(slice.content, schema, id, author, date), slice.openStart, slice.openEnd);
    const pos = Math.min(d.pos, tr.doc.content.size);
    const sizeBefore = tr.doc.content.size;
    try { tr.replace(pos, pos, marked); } catch { continue; }
    const added = tr.doc.content.size - sizeBefore;
    if (headAfter == null) headAfter = pos;
    tr.doc.nodesBetween(pos, pos + added, (n, p) => { // paragraph marks that fell inside the re-inserted range are "deleted"
      if (n.isTextblock && p + n.nodeSize - 1 >= pos && p + n.nodeSize - 1 < pos + added && !leftOwnMark && marked.content.childCount > 1) tr.setNodeMarkup(p, undefined, { ...n.attrs, pMark: n.attrs.pMark && n.attrs.pMark.type ? n.attrs.pMark : { type: "del", id, author, date } });
      return true;
    });
  }
  // Backspace / Delete leave the caret BEFORE the struck-through text, like Word.
  if (noInsertion && headAfter != null && selBefore.empty) {
    try { tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(headAfter, tr.doc.content.size)), -1)); } catch { /* keep default */ }
  }
  return tr;
}

/* ---------- reading + resolving changes ---------- */
export function listChanges(doc) {
  const map = new Map();
  const order = [];
  doc.descendants((n, pos) => {
    if (n.isInline) {
      for (const [kind, type] of [["ins", "trackIns"], ["del", "trackDel"]]) {
        const m = n.marks.find((x) => x.type.name === type);
        if (!m) continue;
        const key = `${kind}:${m.attrs.id}`;
        let c = map.get(key);
        if (!c) { c = { key, kind, id: m.attrs.id, author: m.attrs.author, date: m.attrs.date, text: "", ranges: [], para: false }; map.set(key, c); order.push(c); }
        c.text += n.isText ? n.text : "￼";
        const last = c.ranges[c.ranges.length - 1];
        if (last && last.to === pos) last.to = pos + n.nodeSize; else c.ranges.push({ from: pos, to: pos + n.nodeSize });
      }
    } else if (n.isTextblock && n.attrs.pMark && n.attrs.pMark.type) {
      const pm = n.attrs.pMark;
      const key = `${pm.type}:${pm.id}:p${pos}`;
      const c = { key, kind: pm.type, id: pm.id, author: pm.author, date: pm.date, text: "¶", ranges: [], para: true, pos };
      map.set(key, c); order.push(c);
    }
    return true;
  });
  return order;
}

const keep = (tr) => tr.setMeta(BYPASS, true);

function resolveOne(tr, change, accept) {
  const schema = tr.doc.type.schema;
  const kind = change.kind;
  if (change.para) {
    const pos = change.pos;
    const n = tr.doc.nodeAt(pos);
    if (!n || !n.isTextblock) return;
    const joins = (kind === "ins") !== accept ? false : false;
    const removeMark = (kind === "ins" && accept) || (kind === "del" && !accept);
    if (removeMark) { tr.setNodeMarkup(pos, undefined, { ...n.attrs, pMark: null }); return; }
    // accept a deleted mark / reject an inserted one → the paragraph merges into the next
    const end = pos + n.nodeSize;
    const next = tr.doc.nodeAt(end);
    if (!n.content.size) { tr.delete(pos, end); return; }
    if (next && next.isTextblock) { try { tr.join(end); } catch { tr.setNodeMarkup(pos, undefined, { ...n.attrs, pMark: null }); } } else tr.setNodeMarkup(pos, undefined, { ...n.attrs, pMark: null });
    return;
  }
  const drop = (kind === "ins" && !accept) || (kind === "del" && accept); // remove the text itself
  const markType = schema.marks[kind === "ins" ? "trackIns" : "trackDel"];
  // current positions: re-find this change's ranges in the live doc
  const ranges = [];
  tr.doc.descendants((n, pos) => { if (n.isInline) { const m = n.marks.find((x) => x.type === markType && x.attrs.id === change.id); if (m) { const l = ranges[ranges.length - 1]; if (l && l.to === pos) l.to = pos + n.nodeSize; else ranges.push({ from: pos, to: pos + n.nodeSize }); } } return true; });
  for (const r of ranges.reverse()) { if (drop) tr.delete(r.from, r.to); else tr.removeMark(r.from, r.to, markType); }
}

function sweepEmptyDeletedParas(tr) { // a paragraph whose text was all accepted-deleted and whose mark was deleted too
  const kill = [];
  tr.doc.descendants((n, pos) => { if (n.isTextblock && !n.content.size && n.attrs.pMark && n.attrs.pMark.type === "del") kill.push([pos, pos + n.nodeSize]); return true; });
  for (const [a, b] of kill.reverse()) tr.delete(a, b);
}

export function acceptChange(state, key) { return resolve(state, (c) => c.key === key, true); }
export function rejectChange(state, key) { return resolve(state, (c) => c.key === key, false); }
export const acceptAll = (state) => resolve(state, () => true, true);
export const rejectAll = (state) => resolve(state, () => true, false);

function resolve(state, pick, accept) {
  const tr = keep(state.tr);
  const changes = listChanges(state.doc).filter(pick);
  // text first (right-to-left by doc position), paragraph marks after, so positions stay valid
  const text = changes.filter((c) => !c.para), paras = changes.filter((c) => c.para);
  for (const c of text) resolveOne(tr, c, accept);
  const live = listChanges(tr.doc).filter((c) => c.para && paras.some((p) => p.id === c.id && p.kind === c.kind));
  for (const c of live.sort((a, b) => b.pos - a.pos)) resolveOne(tr, c, accept);
  if (accept) sweepEmptyDeletedParas(tr);
  return tr;
}

/* ---------- comments on the document ---------- */
export function commentRanges(doc, id) {
  const out = [];
  doc.descendants((n, pos) => { if (n.isInline && n.marks.some((m) => m.type.name === "comment" && m.attrs.id === id)) { const l = out[out.length - 1]; if (l && l.to === pos) l.to = pos + n.nodeSize; else out.push({ from: pos, to: pos + n.nodeSize }); } return true; });
  return out;
}
export function removeCommentMarks(state, ids) {
  const tr = keep(state.tr);
  const type = state.schema.marks.comment;
  for (const id of ids) for (const r of commentRanges(tr.doc, id)) tr.removeMark(r.from, r.to, type.create({ id }));
  return tr;
}
