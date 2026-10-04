/* fileTypeTag (B2084481) — the small DOC / DOCX / TXT / PDF tag on a Library card.
 *
 * A `.doc` and the `.docx` saved from it share a title (the title is built from the name WITHOUT its extension),
 * so two rows read identically. The authoritative type is the review's own source filename (`sfile`, or
 * `sourceFile` on a built fact); a review with no source filename is a PDF drawing — the same rule FileBrowser's
 * `isPdfFile` uses, so the two surfaces can never disagree about what a row is.
 */
export function fileTypeTag(doc) {
  const name = String((doc && (doc.sfile || doc.sourceFile)) || "");
  if (!name) return "PDF";
  const base = name.split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1) : "";
  return ext && ext.length <= 5 && /^[A-Za-z0-9]+$/.test(ext) ? ext.toUpperCase() : "FILE";
}
