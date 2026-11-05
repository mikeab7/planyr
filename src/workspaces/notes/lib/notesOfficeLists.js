/* notesOfficeLists — A WORD / ONENOTE OUTLINE ARRIVES AS A REAL NESTED LIST, WITH ITS TABLE UNDER THE BULLET
 * IT SAT UNDER (NEW-1 / NEW-2, owner report 2026-10-30: a bulleted soft-cost outline with a small table nested
 * in it, pasted into a Notes box — level 2 came in with a literal "o" in front, level 3 a "§", level 4 a "□").
 *
 * ⛔ WHAT WORD ACTUALLY PUTS ON THE CLIPBOARD, which is why the old paste kept the characters: Word has no list
 * element in its clipboard HTML. A bullet is a PARAGRAPH — `<p class=MsoListParagraphCxSpMiddle
 * style='margin-left:1.0in;text-indent:-.25in;mso-list:l0 level2 lfo1'>` — that begins with the bullet drawn as
 * TEXT in a symbol font (`o` in Courier New, `§` in Wingdings, a private-use glyph in Wingdings/Symbol), wrapped
 * in `<span style='mso-list:Ignore'>`. In Word the span is invisible scaffolding; to a browser it is ordinary
 * text, so it pasted as a character. The nesting is the NUMBER in `mso-list: l0 level2`, not any element.
 * ProseMirror's parser knows `<ul>/<ol>/<li>`, never `mso-list`, so no level survived either.
 *
 * WHAT THIS DOES, in three steps over the clipboard's DOM, BEFORE the parse (`transformPastedHTML`):
 *   1. DROP the marker spans (`mso-list:Ignore`) and note what they said — `·`/`o`/`§` means a bullet, `1.`/`a.`/
 *      `iv.` means a numbered list (and `1.` vs `3.` is the start number). Whatever the glyph is, it never reaches
 *      the text.
 *   2. REBUILD each run of `mso-list` paragraphs as nested `<ul>/<ol>` by LEVEL (`planOutline`, pure). A blank
 *      paragraph, or a TABLE, sitting between two items does NOT break the run — the list resumes after it.
 *   3. PLACE A TABLE where it sat. A table whose left edge lines up with a list item's text goes INSIDE that item
 *      (`<li><p>…</p><table>`), the deepest such item; a table at the page margin goes after the list. The schema's
 *      listItem is `paragraph block*`, so a table in a list item is legal, and it is what keeps the table under its
 *      bullet when the outline is moved or the bullet is indented. (Chosen over "directly after the item" because a
 *      sibling table stops following its bullet the moment the bullet moves.)
 *
 * OneNote's own copy already uses real `<ul><li>`, so it needs only the same marker/text-table clean-up; two
 * OneNote/Word shapes that DO draw the bullet as text without `mso-list` are covered by the HANGING-MARKER rule
 * (a negative first-line indent + a leading one-glyph span in Symbol/Wingdings/Courier New).
 *
 * ⛔ AND TAB-ALIGNED ROWS BECOME A TABLE (the same rule the owner set for tab-separated text, 2026-10-06, applied
 * to HTML paragraphs): two or more consecutive paragraphs with the same number (≥ 1) of tab stops between text
 * ("SF<tab>$/SF") read as a table. Word writes the tab as `<span style='mso-tab-count:1'>&nbsp;…</span>`, which a
 * browser flattens to a run of spaces — the "cells run together by spaces" symptom. Only paragraphs that are NOT
 * list items and are not preformatted, so a bulleted list with a tab in each item and pasted code stay as they are.
 *
 * PURE where it can be (the planner, the parsers, the row splitter are unit-tested in node); the DOM glue takes
 * an element, so the real parse is exercised by ui-audit/verify-notes-list-paste.mjs.
 */

const UNIT_IN = { in: 1, pt: 1 / 72, px: 1 / 96, cm: 1 / 2.54, mm: 1 / 25.4 };

/** `margin-left:1.5in` / `text-indent:-.25in` / `mso-table-lspace:.75pt` → inches, or null. */
export function lengthIn(style, prop) {
  const re = new RegExp(`(?:^|;)\\s*${prop.replace(/[-]/g, "\\-")}\\s*:\\s*(-?\\d*\\.?\\d+)\\s*(in|pt|px|cm|mm)?\\b`, "i");
  const m = re.exec(String(style || ""));
  if (!m) return null;
  const n = parseFloat(m[1]) * UNIT_IN[(m[2] || "px").toLowerCase()];
  return Number.isFinite(n) ? n : null;
}

/** The `mso-list` declaration of a style attribute: `{ id, level }` for `l0 level2 lfo1`, `"ignore"` for the
 *  marker span, `null` for none / `mso-list:none`. */
export function parseMsoList(style) {
  const m = /(?:^|;)\s*mso-list\s*:\s*([^;]*)/i.exec(String(style || ""));
  if (!m) return null;
  const v = m[1].trim();
  if (/^ignore\b/i.test(v)) return "ignore";
  const lv = /\b(l\d+)\s+level(\d+)/i.exec(v);
  return lv ? { id: lv[1].toLowerCase(), level: Math.max(1, parseInt(lv[2], 10)) } : null;
}

/** Text with no content: whitespace and non-breaking spaces only. */
export const isBlankText = (t) => /^[\s ​]*$/.test(String(t ?? ""));

const ROMAN = /^[ivxlcdm]+$/i;
/** What a list marker's text says. `1.` `(2)` `ii)` `a.` → ordered (with the start number when it is a plain
 *  number other than 1); anything else (`·` `o` `§` `` …) → bullet. A bare `o` has no `.`, so it is the
 *  Courier-New bullet and never the letter. */
export function classifyMarker(text) {
  const t = String(text ?? "").replace(/[\s ​]+/g, "");
  const dec = /^\(?(\d{1,4})[.)]?$/.exec(t);
  if (dec) return { kind: "ordered", start: parseInt(dec[1], 10) };
  if (/^\(?[a-z][.)]$/i.test(t) || (/^\(?[ivxlcdm]+[.)]$/i.test(t) && ROMAN.test(t.replace(/[().]/g, "")))) return { kind: "ordered", start: null };
  return { kind: "bullet", start: null };
}

/** `@list l0:level2 { mso-level-number-format:bullet; … }` from the clipboard's `<style>` → `{ "l0:2": "bullet" }`.
 *  A level with NO number-format is Word's default, decimal. Used only when an item carries no marker text. */
export function listFormatMap(cssText) {
  const out = {};
  for (const m of String(cssText || "").matchAll(/@list\s+(l\d+)\s*:\s*level(\d+)\s*\{([^}]*)\}/gi)) {
    const f = /mso-level-number-format\s*:\s*([\w-]+)/i.exec(m[3]);
    out[`${m[1].toLowerCase()}:${m[2]}`] = f ? f[1].toLowerCase() : "decimal";
  }
  return out;
}

/* ── the planner ───────────────────────────────────────────────────────────────────────── */

/** Descriptors, in document order:
 *    { t:"item",  id, level, kind:"bullet"|"ordered", start, left }   a list item; `left` = where its text starts (in)
 *    { t:"table", left }                                              `left` = the table's left edge (in), 0 when unknown
 *    { t:"blank" }                                                    an empty paragraph (never closes a list)
 *    { t:"other" }                                                    anything else (closes every list)
 *  → entries, in order: `{ t:"list", ordered, start, items:[{ src, left, kids:[…] }] }` where a kid is a nested
 *  list or `{ t:"table", src }`; and `{ t:"pass", src }` for everything that stays where it was.
 *  `src` is the descriptor's index. Pure. */
export function planOutline(descs, { tolerance = 0.3 } = {}) {
  const out = [];
  let stack = [];                               // open lists, outermost first: { node, level, id, kind, item }
  let pendingBlanks = [];

  const closeAll = () => { stack = []; };
  const flushBlanks = () => { for (const b of pendingBlanks) out.push({ t: "pass", src: b }); pendingBlanks = []; };

  descs.forEach((d, src) => {
    if (d.t === "blank") { pendingBlanks.push(src); return; }
    if (d.t === "other") { closeAll(); flushBlanks(); out.push({ t: "pass", src }); return; }

    if (d.t === "table") {
      /* the deepest open item whose text starts at or left of the table's edge (+ tolerance) owns it */
      let at = -1;
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        const it = stack[i].item;
        if (it && it.left <= (d.left || 0) + tolerance) { at = i; break; }
      }
      if (at < 0) { closeAll(); flushBlanks(); out.push({ t: "pass", src }); return; }
      pendingBlanks = [];
      stack = stack.slice(0, at + 1);
      stack[at].item.kids.push({ t: "table", src });
      return;
    }

    /* a list item: close whatever it is shallower than, or a different list at its own level */
    pendingBlanks = [];
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.level > d.level || (top.level === d.level && (top.id !== d.id || top.kind !== d.kind))) stack.pop();
      else break;
    }
    const top = stack[stack.length - 1];
    if (top && top.level === d.level) {
      const item = { src, left: d.left, kids: [] };
      top.node.items.push(item);
      top.item = item;
      return;
    }
    const item = { src, left: d.left, kids: [] };
    /* a list that was just closed to come back up (level 3 then level 2 under the same bullet) is the SAME visual depth —
     * continue it rather than stacking a second list beside it */
    const prev = top && top.item ? top.item.kids[top.item.kids.length - 1] : null;
    if (prev && prev.t === "list" && prev.ordered === (d.kind === "ordered")) {
      prev.items.push(item);
      stack.push({ node: prev, level: d.level, id: d.id, kind: d.kind, item });
      return;
    }
    const node = { t: "list", ordered: d.kind === "ordered", start: d.kind === "ordered" && d.start > 1 ? d.start : null, items: [] };
    node.items.push(item);
    if (top && top.item) top.item.kids.push(node);
    else out.push(node);
    stack.push({ node, level: d.level, id: d.id, kind: d.kind, item });
  });
  flushBlanks();
  return out;
}

/* ── tab-aligned rows ──────────────────────────────────────────────────────────────────── */

/** "SF<tab>$/SF" → ["SF", "$/SF"]. A row needs ≥ 2 cells, a non-empty first one (a leading tab is an indent, not a
 *  column) and at least two non-empty cells. Returns null otherwise. Pure. */
export function splitTabRow(text) {
  const cells = String(text ?? "").split("\t").map((c) => c.replace(/[\s ]+/g, " ").trim());
  if (cells.length < 2 || !cells[0]) return null;
  return cells.filter((c) => c).length >= 2 ? cells : null;
}

/** Runs of ≥ 2 consecutive rows with the SAME column count → `[{ from, to, cols }]` over `rows` (an array of
 *  `string[]` or null). Pure. */
export function tabRuns(rows) {
  const runs = [];
  let i = 0;
  while (i < rows.length) {
    if (!rows[i]) { i += 1; continue; }
    let j = i;
    while (j + 1 < rows.length && rows[j + 1] && rows[j + 1].length === rows[i].length) j += 1;
    if (j > i) runs.push({ from: i, to: j, cols: rows[i].length });
    i = j + 1;
  }
  return runs;
}

/* ── the DOM glue ──────────────────────────────────────────────────────────────────────── */

const BLOCK_TAGS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6"]);
const MARKER_FONT = /symbol|wingdings|webdings|courier new/i;

const elementsWith = (root, re) => Array.from(root.querySelectorAll("[style]")).filter((e) => re.test(e.getAttribute("style") || ""));

/** Strip the Word list scaffolding (and the paragraph's own margins) from an element's style, keeping fonts,
 *  sizes and colours: the nesting is structural now, a left margin on top of it would indent twice. */
function cleanStyle(el) {
  const kept = String(el.getAttribute("style") || "").split(";").filter((d) => d.trim() && !/^\s*(mso-list|mso-add-space|margin|text-indent|tab-stops)/i.test(d));
  if (kept.length) el.setAttribute("style", kept.join(";")); else el.removeAttribute("style");
  el.removeAttribute("class");
}

const hasContent = (el) => !isBlankText(el.textContent) || !!el.querySelector("img,table,hr");

/** Text of a possible tab-aligned row, with `mso-tab-count` spans (and literal tabs outside preformatted text) as
 *  tab stops. Null when the paragraph has a line break, a picture or a table — it is not a row. */
function rowTextOf(el) {
  if (el.querySelector("br,img,table,ul,ol,pre")) return null;
  let out = "";
  const pre = (n) => /white-space\s*:\s*pre/i.test(n.getAttribute?.("style") || "");
  const walk = (n, inPre) => {
    if (n.nodeType === 3) { out += inPre ? n.nodeValue.replace(/\t/g, " ") : n.nodeValue.replace(/\t/g, "\u0001"); return; }
    if (n.nodeType !== 1) return;
    if (/mso-tab-count/i.test(n.getAttribute("style") || "")) { out += "\u0001"; return; }
    n.childNodes.forEach((c) => walk(c, inPre || pre(n)));
  };
  walk(el, pre(el));
  if (!out.includes("\u0001")) return null;
  return out.replace(/[\s ]+/g, (m) => (m.includes("\u0001") ? m : " ")).replace(/\s*\u0001\s*/g, "\t");
}

function makeTable(doc, rows) {
  const table = doc.createElement("table");
  table.setAttribute("border", "1");
  const body = doc.createElement("tbody");
  for (const r of rows) {
    const tr = doc.createElement("tr");
    for (const c of r) {
      const td = doc.createElement("td");
      const p = doc.createElement("p");
      p.textContent = c;
      td.appendChild(p);
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  table.appendChild(body);
  return table;
}

/** Take the leading marker of a hanging-indent paragraph that draws its bullet as a one-glyph span in a symbol
 *  font and has no `mso-list`. Returns the marker text and removes it (and the spacer span after it). */
function takeHangingMarker(p) {
  if ((lengthIn(p.getAttribute("style"), "text-indent") ?? 0) >= 0) return null;
  const first = Array.from(p.childNodes).find((n) => !(n.nodeType === 3 && isBlankText(n.nodeValue)));
  if (!first || first.nodeType !== 1 || first.tagName !== "SPAN") return null;
  if (!MARKER_FONT.test(first.getAttribute("style") || "")) return null;
  const mark = first.textContent;
  if (isBlankText(mark) || mark.trim().length > 3 || !/[^\w\s]|^o$/i.test(mark.trim())) return null;
  let next = first.nextSibling;
  first.remove();
  while (next && ((next.nodeType === 3 && isBlankText(next.nodeValue)) || (next.nodeType === 1 && next.tagName === "SPAN" && isBlankText(next.textContent) && !next.querySelector("img")))) {
    const n = next.nextSibling; next.remove(); next = n;
  }
  return mark;
}

/** Rewrite the Office list / tab-row markup of a pasted clipboard document in place. `root` is the document body.
 *  Never throws into the paste: the caller keeps the unconverted markup on any error. Returns `{ lists, tables }`
 *  (counts, for tests and telemetry). */
export function convertOfficeLists(root) {
  const doc = root.ownerDocument;
  const stats = { lists: 0, tables: 0, markers: 0 };
  const styleText = Array.from(doc.querySelectorAll("style")).map((s) => s.textContent).join("\n");
  const formats = listFormatMap(styleText);

  /* 1 — the marker spans (`mso-list:Ignore`): note what they said, then remove them and the empty font wrapper */
  const markerOf = new WeakMap();
  for (const span of elementsWith(root, /mso-list\s*:\s*ignore/i)) {
    const owner = span.closest("p,div,h1,h2,h3,h4,h5,h6,li");
    if (owner && !markerOf.has(owner)) markerOf.set(owner, span.textContent);
    let wrap = span.parentElement;
    span.remove();
    stats.markers += 1;
    while (wrap && wrap !== owner && wrap.tagName === "SPAN" && !wrap.childNodes.length) { const up = wrap.parentElement; wrap.remove(); wrap = up; }
  }

  /* 2 — which blocks are list items */
  const info = new WeakMap();
  for (const el of elementsWith(root, /mso-list\s*:/i)) {
    if (!BLOCK_TAGS.has(el.tagName)) continue;
    const m = parseMsoList(el.getAttribute("style"));
    if (!m || m === "ignore") continue;
    const mark = markerOf.has(el) ? classifyMarker(markerOf.get(el)) : null;
    const fmt = formats[`${m.id}:${m.level}`];
    const kind = mark ? mark.kind : (fmt && fmt !== "bullet" && fmt !== "none" ? "ordered" : "bullet");
    const left = lengthIn(el.getAttribute("style"), "margin-left");
    info.set(el, { id: m.id, level: m.level, kind, start: mark ? mark.start : null, left: left ?? 0.5 * m.level });
  }
  for (const p of Array.from(root.querySelectorAll("p"))) {
    if (info.has(p) || p.closest("li,td,th")) continue;
    const mark = takeHangingMarker(p);
    if (mark == null) continue;
    const c = classifyMarker(mark);
    const left = lengthIn(p.getAttribute("style"), "margin-left") ?? 0.5;
    info.set(p, { id: "hang", level: Math.max(1, Math.round(left / 0.5)), kind: c.kind, start: c.start, left });
  }

  /* 3 — group by parent and rebuild */
  const parents = new Set();
  const maybeTabs = /\t|mso-tab-count/i.test(root.innerHTML);
  for (const el of root.querySelectorAll("p,div,h1,h2,h3,h4,h5,h6")) if (info.has(el)) parents.add(el.parentNode);
  if (maybeTabs) for (const p of root.querySelectorAll("p,div")) if (p.parentNode) parents.add(p.parentNode);

  for (const parent of parents) {
    if (!parent.isConnected && parent !== root) continue;
    const kids = Array.from(parent.childNodes);
    const descs = [];
    const nodes = [];
    const rowsText = [];
    for (const n of kids) {
      if (n.nodeType === 8) continue;                                       // a comment (`<![if !supportLists]>` and friends)
      if (n.nodeType === 3) { if (isBlankText(n.nodeValue)) continue; descs.push({ t: "other" }); nodes.push(n); rowsText.push(null); continue; }
      if (n.nodeType !== 1) { descs.push({ t: "other" }); nodes.push(n); rowsText.push(null); continue; }
      const d = info.get(n);
      if (d) {
        if (!hasContent(n)) { descs.push({ t: "blank" }); nodes.push(n); rowsText.push(null); continue; }
        descs.push({ t: "item", ...d }); nodes.push(n); rowsText.push(null); continue;
      }
      if (n.tagName === "TABLE") {
        const st = n.getAttribute("style") || "";
        descs.push({ t: "table", left: lengthIn(st, "margin-left") ?? lengthIn(st, "mso-table-lspace") ?? 0 });
        nodes.push(n); rowsText.push(null); continue;
      }
      if (BLOCK_TAGS.has(n.tagName) && !hasContent(n) && !n.querySelector("br")) { descs.push({ t: "blank" }); nodes.push(n); rowsText.push(null); continue; }
      if (BLOCK_TAGS.has(n.tagName) && n.tagName === "P") {
        const row = maybeTabs ? splitTabRow(rowTextOf(n) || "") : null;
        descs.push({ t: "other", row, left: lengthIn(n.getAttribute("style"), "margin-left") ?? 0 });
        nodes.push(n); rowsText.push(row); continue;
      }
      descs.push({ t: "other" }); nodes.push(n); rowsText.push(null);
    }

    /* tab-aligned runs → table descriptors (replacing the run) */
    const synth = new Map();                                                // index of a run's first row → { table, last }
    for (const run of tabRuns(rowsText)) {
      const grid = rowsText.slice(run.from, run.to + 1);
      synth.set(run.from, { to: run.to, table: makeTable(doc, grid), left: descs[run.from].left });
    }
    const flat = [];
    const flatNodes = [];
    for (let i = 0; i < descs.length; i += 1) {
      if (synth.has(i)) {
        const s = synth.get(i);
        flat.push({ t: "table", left: s.left });
        flatNodes.push(s.table);
        stats.tables += 1;
        i = s.to;
        continue;
      }
      flat.push(descs[i]);
      flatNodes.push(nodes[i]);
    }
    if (!flat.some((d) => d.t === "item" || d.t === "table") || (!flat.some((d) => d.t === "item") && !synth.size)) continue;

    const plan = planOutline(flat);
    const build = (entry) => {
      if (entry.t === "pass") return flatNodes[entry.src];
      const list = doc.createElement(entry.ordered ? "ol" : "ul");
      if (entry.start) list.setAttribute("start", String(entry.start));
      for (const item of entry.items) {
        const li = doc.createElement("li");
        const src = flatNodes[item.src];
        const p = doc.createElement("p");
        cleanStyle(src);
        if (src.getAttribute("style")) p.setAttribute("style", src.getAttribute("style"));
        while (src.firstChild) p.appendChild(src.firstChild);
        li.appendChild(p);
        for (const kid of item.kids) li.appendChild(kid.t === "table" ? flatNodes[kid.src] : build(kid));
        list.appendChild(li);
      }
      stats.lists += 1;
      return list;
    };
    const built = plan.map(build);
    while (parent.firstChild) parent.removeChild(parent.firstChild);
    for (const b of built) parent.appendChild(b);
  }
  return stats;
}
