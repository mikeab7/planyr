/* notesFileMeta — how an attached file is DESCRIBED, decided once (NEW-5).
 *
 * PURE, and deliberately dependency-free, because four surfaces need the same words and
 * they must not drift: the chip in the editor, the Markdown export, the printed sheet, and
 * the refusal message when a file is too big. A size written one way on screen and another
 * way on paper is the small kind of wrong that makes a document look untrustworthy.
 *
 * ⛔ IT LIVES OUTSIDE lib/notesAttachNode.js ON PURPOSE. That file imports the editor
 * engine; lib/notesMarkdown.js is on the Notes route's STATIC path and may not. One tiny
 * shared module is what lets the exporter name a file without dragging ~460 KB onto the
 * rail's first paint.
 */

/** A file size a person can read. Deliberately coarse — nobody attaching a survey needs
 *  three decimal places, and "1.4 MB" reads instantly where "1,468,006 bytes" does not. */
export function fileSizeLabel(bytes) {
  // An UNKNOWN size renders as nothing, never as "0 B" — the same rule notesTime.js follows
  // for an unknown timestamp. A chip that claims a file is empty when we simply do not know
  // is a small, confident lie, and those are the ones people act on.
  if (bytes == null || bytes === "") return "";
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** The extension, upper-cased, for the chip's type badge. Taken from the NAME rather than
 *  the mime type on purpose: browsers report `application/octet-stream` for a .dwg, for a
 *  .rvt and for half of everything else a consultant sends, so the mime type is the less
 *  informative of the two. */
export function fileExtLabel(name, mime = "") {
  const base = String(name || "").split(/[\\/]/).pop() || "";
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1) : "";
  if (ext && ext.length <= 5 && /^[A-Za-z0-9]+$/.test(ext)) return ext.toUpperCase();
  const sub = String(mime || "").split("/")[1] || "";
  return sub ? sub.slice(0, 5).toUpperCase() : "FILE";
}

/** A file name safe to hand a download, with the original extension kept. */
export function safeAttachmentName(name) {
  const base = String(name || "").split(/[\\/]/).pop() || "attachment";
  const cleaned = base.replace(/[^\w.\- ()]+/g, "_").replace(/\s+/g, " ").trim();
  return cleaned || "attachment";
}

/** One line describing an attachment — `Site survey.pdf · PDF · 2.4 MB`. The export and the
 *  print sheet both write exactly this, so a file named on paper matches the chip on screen. */
export function attachmentLabel({ name, mime = "", size = 0 } = {}) {
  const parts = [safeAttachmentName(name), fileExtLabel(name, mime)];
  const size$ = fileSizeLabel(size);
  if (size$) parts.push(size$);
  return parts.join(" · ");
}
