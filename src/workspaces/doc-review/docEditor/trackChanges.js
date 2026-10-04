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
import { FORMAT_MARKS, oldRunMarks, runLabel, paraLabel, restorePprx, ATTR_SCOPES, attrChangeInfo, resolveAttrChange, gridChangeInfo, oldGridCols } from "../../../shared/files/docx/fmtChange.js";

export const BYPASS = "trackBypass";
const isoNow = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
let seq = 0;
export const newChangeId = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

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
const inListAt = (doc, pos) => { const $p = doc.resolve(pos); for (let d = $p.depth; d > 0; d--) if ($p.node(d).type.name === "listItem") return true; return false; };
const snippet = (n) => String(n.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);

/** Every change in the document, in reading order. `kind` is "ins" | "del" | "fmt". A "fmt" change carries `ids`
 * (the Word change ids it covers, scope-prefixed) so it can be found again after earlier edits move positions. */
export function listChanges(doc) {
  const map = new Map();
  const order = [];
  let run = null; // the contiguous run-formatting group being built
  const push = (c) => { order.push(c); return c; };
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
      const fm = n.marks.find((x) => x.type.name === "trackFmt");
      if (fm) {
        const a = fm.attrs;
        if (run && run.to === pos && run.author === a.author && run.date === a.date && run.old === a.old) {
          run.to = pos + n.nodeSize; run.text += n.isText ? n.text : "￼";
          if (!run.ids.includes(`run:${a.id}`)) run.ids.push(`run:${a.id}`);
        } else run = push({ key: `fmt:run:${a.id}`, kind: "fmt", scope: "run", id: a.id, ids: [`run:${a.id}`], author: a.author, date: a.date, old: a.old, text: n.isText ? n.text : "￼", from: pos, to: pos + n.nodeSize, label: runLabel(a.old, n.marks), para: false });
      } else run = null;
    } else if (n.isTextblock || n.type.name === "table" || n.type.name === "tableRow" || n.type.name === "tableCell" || n.type.name === "tableHeader") {
      run = null;
      if (n.isTextblock && n.attrs.pMark && n.attrs.pMark.type) {
        const pm = n.attrs.pMark;
        const key = `${pm.type}:${pm.id}:p${pos}`;
        const c = { key, kind: pm.type, id: pm.id, author: pm.author, date: pm.date, text: "¶", ranges: [], para: true, pos };
        map.set(key, c); order.push(c);
      }
      if (n.isTextblock && n.attrs.pFmt && n.attrs.pFmt.old) {
        const f = n.attrs.pFmt;
        const inList = inListAt(doc, pos);
        push({ key: `fmt:para:${f.id}`, kind: "fmt", scope: "para", id: f.id, ids: [`para:${f.id}`], author: f.author, date: f.date, text: snippet(n), pos, label: paraLabel(f.old, { level: n.type.name === "heading" ? n.attrs.level : null, pStyle: n.attrs.pStyle, textAlign: n.attrs.textAlign, pprx: n.attrs.pprx }, inList), para: false });
      }
      for (const [scope, def] of Object.entries(ATTR_SCOPES)) {
        if (!def.nodes.includes(n.type.name)) continue;
        const info = attrChangeInfo(scope, n.attrs[def.attr]);
        if (info) push({ key: `fmt:${scope}:${info.id}`, kind: "fmt", scope, ...info, ids: [`${scope}:${info.id}`], text: snippet(n), pos, label: def.label, para: false });
      }
      if (n.type.name === "table") {
        const info = gridChangeInfo(n.attrs.gridChange);
        if (info) push({ key: `fmt:grid:${info.id}`, kind: "fmt", scope: "grid", ...info, ids: [`grid:${info.id}`], text: snippet(n), pos, label: "Formatted: Table column widths", para: false });
      }
    } else run = null;
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

/* Formatting changes. ACCEPT drops the record and keeps the current look. REJECT puts the OLD properties back. */
function resolveRunFmt(tr, c, accept) {
  const schema = tr.doc.type.schema;
  tr.removeMark(c.from, c.to, schema.marks.trackFmt);
  if (accept) return;
  for (const t of FORMAT_MARKS) if (schema.marks[t]) tr.removeMark(c.from, c.to, schema.marks[t]);
  for (const m of oldRunMarks(c.old)) if (schema.marks[m.type]) tr.addMark(c.from, c.to, schema.marks[m.type].create(m.attrs));
}
function resolveNodeFmt(tr, c, accept) {
  const n = tr.doc.nodeAt(c.pos);
  if (!n) return;
  const schema = tr.doc.type.schema;
  if (c.scope === "para") {
    if (accept) { tr.setNodeMarkup(c.pos, undefined, { ...n.attrs, pFmt: null }); return; }
    const old = n.attrs.pFmt.old;
    const type = old.level ? schema.nodes.heading : schema.nodes.paragraph;
    tr.setNodeMarkup(c.pos, type, { ...n.attrs, pStyle: old.pStyle || null, textAlign: old.textAlign || "left", pprx: restorePprx(old.pprx, n.attrs.pprx), pFmt: null, ...(old.level ? { level: old.level } : {}) });
    if (!!old.num !== inListAt(tr.doc, c.pos)) tr.setMeta("fmtPartial", "bullets / numbering"); // list structure is left as it is
    return;
  }
  if (c.scope === "grid") {
    const cols = accept ? null : oldGridCols(n.attrs.gridChange);
    tr.setNodeMarkup(c.pos, undefined, { ...n.attrs, gridChange: "", ...(cols && cols.length === (n.attrs.gridCols || []).length ? { gridCols: cols } : {}) });
    return;
  }
  const def = ATTR_SCOPES[c.scope];
  tr.setNodeMarkup(c.pos, undefined, { ...n.attrs, [def.attr]: resolveAttrChange(c.scope, n.attrs[def.attr], accept) });
}

function resolve(state, pick, accept) {
  const tr = keep(state.tr);
  const changes = listChanges(state.doc).filter(pick);
  // text first (right-to-left by doc position), then formatting, paragraph marks, and node-attribute formatting, re-listing
  // against the live document each time so positions stay valid
  const text = changes.filter((c) => !c.para && c.kind !== "fmt"), paras = changes.filter((c) => c.para), fmts = changes.filter((c) => c.kind === "fmt");
  for (const c of text) resolveOne(tr, c, accept);
  const fmtIds = new Set(fmts.flatMap((c) => c.ids));
  const liveFmt = () => listChanges(tr.doc).filter((c) => c.kind === "fmt" && c.ids.some((i) => fmtIds.has(i)));
  for (const c of liveFmt().filter((x) => x.scope === "run").sort((a, b) => b.from - a.from)) resolveRunFmt(tr, c, accept);
  const live = listChanges(tr.doc).filter((c) => c.para && paras.some((p) => p.id === c.id && p.kind === c.kind));
  for (const c of live.sort((a, b) => b.pos - a.pos)) resolveOne(tr, c, accept);
  for (const c of liveFmt().filter((x) => x.scope !== "run").sort((a, b) => b.pos - a.pos)) resolveNodeFmt(tr, c, accept);
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
