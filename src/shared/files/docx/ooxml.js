/* Shared OOXML constants + small tables for the .docx reader/writer. */
export const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
export const CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types";

export const DOC_ROOT_ATTRS = {
  "xmlns:w": NS_W,
  "xmlns:r": NS_R,
  "xmlns:wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  "xmlns:a": "http://schemas.openxmlformats.org/drawingml/2006/main",
  "xmlns:pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
  "xmlns:mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
  "xmlns:w14": "http://schemas.microsoft.com/office/word/2010/wordml",
  "xmlns:w15": "http://schemas.microsoft.com/office/word/2012/wordml",
  "mc:Ignorable": "w14 w15",
};

export const PART = {
  comments: { path: "word/comments.xml", ct: "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml", rel: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" },
  commentsExt: { path: "word/commentsExtended.xml", ct: "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml", rel: "http://schemas.microsoft.com/office/2011/relationships/commentsExtended" },
  commentsIds: { path: "word/commentsIds.xml", ct: "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml", rel: "http://schemas.microsoft.com/office/2016/09/relationships/commentsIds" },
  commentsExtensible: { path: "word/commentsExtensible.xml", ct: "application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtensible+xml", rel: "http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible" },
  numbering: { path: "word/numbering.xml", ct: "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml", rel: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" },
};

// Word's named highlight colours ↔ hex.
export const HIGHLIGHT = { yellow: "#FFFF00", green: "#00FF00", cyan: "#00FFFF", magenta: "#FF00FF", blue: "#0000FF", red: "#FF0000", darkBlue: "#000080", darkCyan: "#008080", darkGreen: "#008000", darkMagenta: "#800080", darkRed: "#800000", darkYellow: "#808000", darkGray: "#808080", lightGray: "#C0C0C0", black: "#000000", white: "#FFFFFF" }; // design-exempt: Word's fixed named highlight palette (file-format data, not UI colour)
export const HIGHLIGHT_NAME = Object.fromEntries(Object.entries(HIGHLIGHT).map(([k, v]) => [v.toLowerCase(), k]));

// Child order inside <w:pPr> / <w:rPr> (Word is strict about this in places).
export const PPR_ORDER = ["pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl", "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens", "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN", "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment", "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange"];
export const RPR_ORDER = ["ins", "del", "moveFrom", "moveTo", "rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath", "rPrChange"];
export const orderBy = (children, order) => children.slice().sort((a, b) => {
  const ia = order.indexOf((a.name || "").replace(/^w:/, "")); const ib = order.indexOf((b.name || "").replace(/^w:/, ""));
  return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
});

export const EMU_PER_PX = 9525;
export const TWIP_PER_PX = 15;
