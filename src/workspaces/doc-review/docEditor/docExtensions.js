/* The Tiptap extension set for the Review document editor. Reuses the packages the Notes editor already
 * ships (so they're shared in the bundle), plus the Word-specific nodes/marks the .docx layer needs:
 * paragraph attributes, raw pass-through atoms, tracked-change marks and comment marks. */
import StarterKit from "@tiptap/starter-kit";
import { Node, Mark, Extension, mergeAttributes } from "@tiptap/core";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Superscript from "@tiptap/extension-superscript";
import Subscript from "@tiptap/extension-subscript";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { Highlight } from "@tiptap/extension-highlight";
import { TextAlign } from "@tiptap/extension-text-align";

const attr = (def, extra = {}) => ({ default: def, rendered: false, ...extra });

// Word paragraph facts the editor doesn't edit but must hand back untouched on save.
const ParagraphFacts = Extension.create({
  name: "docParagraphFacts",
  addGlobalAttributes() {
    return [
      { types: ["paragraph", "heading"], attributes: {
        pStyle: { default: null, rendered: true, parseHTML: (el) => el.getAttribute("data-pstyle"), renderHTML: (a) => (a.pStyle ? { "data-pstyle": a.pStyle } : {}) },
        pprx: attr(""), pMark: attr(null),
      } },
      { types: ["bulletList", "orderedList"], attributes: { numId: attr(null) } },
    ];
  },
});

const DocImage = Node.create({
  name: "docImage", group: "inline", inline: true, atom: true, selectable: true, draggable: false,
  addAttributes() { return { xml: attr(""), src: { default: "", rendered: false }, width: attr(null), height: attr(null), alt: attr("") }; },
  parseHTML() { return [{ tag: "img[data-doc-image]" }]; },
  renderHTML({ node }) { const a = node.attrs; return ["img", mergeAttributes({ "data-doc-image": "1", src: a.src, alt: a.alt || "", style: `${a.width ? `width:${a.width}px;` : ""}max-width:100%;height:auto;` })]; },
});
const DocRaw = Node.create({
  name: "docRaw", group: "inline", inline: true, atom: true, selectable: true,
  addAttributes() { return { xml: attr(""), label: attr("") }; },
  parseHTML() { return [{ tag: "span[data-doc-raw]" }]; },
  renderHTML({ node }) { return ["span", { "data-doc-raw": "1", class: "dre-raw", title: "Word content kept exactly as it was", contenteditable: "false" }, node.attrs.label || "​"]; },
});
const DocRawBlock = Node.create({
  name: "docRawBlock", group: "block", atom: true, selectable: true,
  addAttributes() { return { xml: attr(""), label: attr("") }; },
  parseHTML() { return [{ tag: "div[data-doc-raw-block]" }]; },
  renderHTML({ node }) { return ["div", { "data-doc-raw-block": "1", class: "dre-raw-block", contenteditable: "false" }, `Word content kept as-is (${String(node.attrs.label || "").replace(/^\w+:/, "")})`]; },
});

const trackAttrs = () => ({ id: { default: "" }, author: { default: "" }, date: { default: "" } });
const TrackIns = Mark.create({
  name: "trackIns", inclusive: true,
  addAttributes: trackAttrs,
  parseHTML() { return [{ tag: "ins[data-track]" }]; },
  renderHTML({ mark }) { const a = mark.attrs; return ["ins", { "data-track": a.id, class: "dre-ins", title: `Inserted by ${a.author || "someone"}${a.date ? " · " + new Date(a.date).toLocaleString() : ""}` }, 0]; },
});
const TrackDel = Mark.create({
  name: "trackDel", inclusive: false,
  addAttributes: trackAttrs,
  parseHTML() { return [{ tag: "del[data-track]" }]; },
  renderHTML({ mark }) { const a = mark.attrs; return ["del", { "data-track": a.id, class: "dre-del", title: `Deleted by ${a.author || "someone"}${a.date ? " · " + new Date(a.date).toLocaleString() : ""}` }, 0]; },
});
const CommentMark = Mark.create({
  name: "comment", inclusive: false, excludes: "",
  addAttributes() { return { id: { default: "" } }; },
  parseHTML() { return [{ tag: "span[data-comment]" }]; },
  renderHTML({ mark }) { return ["span", { "data-comment": mark.attrs.id, class: "dre-comment" }, 0]; },
});

const withAttrs = (Base, attrs) => Base.extend({ addAttributes() { return { ...(this.parent?.() || {}), ...attrs }; } });

export function docExtensions({ plain = false } = {}) {
  if (plain) {
    // .txt: paragraphs only (one paragraph per line) + undo/redo. Nothing here can carry formatting.
    return [StarterKit.configure({ bold: false, italic: false, strike: false, underline: false, link: false, code: false, codeBlock: false, blockquote: false, heading: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false, horizontalRule: false, hardBreak: false })];
  }
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, code: false, blockquote: false, horizontalRule: false, link: { openOnClick: false, autolink: false } }),
    TextStyleKit.configure({ backgroundColor: false, lineHeight: false }),
    Highlight.configure({ multicolor: true }), Superscript, Subscript,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Table.configure({ resizable: false }).extend({ addAttributes() { return { ...(this.parent?.() || {}), tblpr: attr(""), gridCols: attr([]) }; } }),
    withAttrs(TableRow, { trpr: attr("") }),
    withAttrs(TableCell, { tcpr: attr("") }),
    withAttrs(TableHeader, { tcpr: attr("") }),
    ParagraphFacts, DocImage, DocRaw, DocRawBlock, TrackIns, TrackDel, CommentMark,
  ];
}
