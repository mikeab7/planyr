/* Which Review files open in the DOCUMENT editor instead of the drawing canvas. Tiny and dependency-free
 * on purpose: DocReview imports it eagerly, the editor itself is a lazy chunk. */
export const docKindOf = (name = "") => {
  const m = /\.(docx|doc|txt)$/i.exec(String(name));
  return m ? m[1].toLowerCase() : null;
};
export const isEditableDocName = (name) => docKindOf(name) !== null;
export const stripDocExt = (name = "") => String(name).replace(/\.(docx|doc|txt)$/i, "");
export const asDocxName = (name = "") => `${stripDocExt(name) || "Document"}.docx`;
export const DOC_ACCEPT = ".docx,.doc,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,text/plain";
