/* Word run properties (<w:rPr>) → editor marks. Shared by the .docx reader and by Track Changes (to turn a
 * formatting-change record's OLD properties back into marks when the change is rejected). */
import { find, attr } from "./xml.js";
import { HIGHLIGHT } from "./ooxml.js";

const FONT_SIZE_ATTR = "fontSize"; // the Tiptap text-style attribute name (not a CSS size literal)
const W = (n) => `w:${n}`;
export const on = (n) => n && n.attrs["w:val"] !== "0" && n.attrs["w:val"] !== "false" && n.attrs["w:val"] !== "off";

export function rPrMarks(rPr) {
  const marks = [];
  if (!rPr) return marks;
  const g = (n) => find(rPr, W(n));
  if (on(g("b"))) marks.push({ type: "bold" });
  if (on(g("i"))) marks.push({ type: "italic" });
  const u = g("u"); if (u && u.attrs["w:val"] !== "none") marks.push({ type: "underline" });
  if (on(g("strike")) || on(g("dstrike"))) marks.push({ type: "strike" });
  const va = attr(g("vertAlign"), "w:val");
  if (va === "superscript") marks.push({ type: "superscript" });
  if (va === "subscript") marks.push({ type: "subscript" });
  const ts = {};
  const col = attr(g("color"), "w:val"); if (col && col !== "auto" && /^[0-9a-fA-F]{6}$/.test(col)) ts.color = "#" + col.toUpperCase();
  const sz = attr(g("sz"), "w:val"); if (sz && /^\d+$/.test(sz)) ts[FONT_SIZE_ATTR] = `${Number(sz) / 2}pt`;
  const ff = g("rFonts"); const fam = ff && (ff.attrs["w:ascii"] || ff.attrs["w:hAnsi"]); if (fam) ts.fontFamily = fam;
  if (Object.keys(ts).length) marks.push({ type: "textStyle", attrs: ts });
  const hl = attr(g("highlight"), "w:val"); if (hl && hl !== "none" && HIGHLIGHT[hl]) marks.push({ type: "highlight", attrs: { color: HIGHLIGHT[hl] } });
  return marks;
}

