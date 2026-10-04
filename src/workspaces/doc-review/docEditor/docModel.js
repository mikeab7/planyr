/* Pure open/save for the document editor — no React, no DOM, no network, so Node can test it.
 * `loadModel(file)` turns stored bytes into an editable model; `buildSave(...)` turns the edited
 * document back into the exact bytes to store. Neither downloads anything: the caller (DocReview) writes
 * the bytes to the Library. */
import { readDocx } from "../../../shared/files/docx/docxRead.js";
import { writeDocx, blankPackage } from "../../../shared/files/docx/docxWrite.js";
import { decodeText, txtToDoc, docToText, encodeText } from "./txtModel.js";
import { asDocxName } from "./docKind.js";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const emptyAttrs = { pStyle: null, textAlign: "left", pprx: "", pMark: null };

export async function loadModel(file) {
  const buf = await file.blob.arrayBuffer();
  if (file.kind === "docx") { const r = readDocx(new Uint8Array(buf)); return { mode: "docx", ...r }; }
  if (file.kind === "doc") {
    const { docToText: legacyText } = await import("../../../shared/files/docText.js");
    const text = await legacyText(buf); // throws a friendly, specific error for unsupported .doc variants
    const { doc } = txtToDoc(text);
    doc.content = doc.content.map((p) => ({ ...p, attrs: { ...emptyAttrs } }));
    return { mode: "docx", doc, comments: [], meta: { warnings: [] }, files: blankPackage(), converted: true };
  }
  const { text, encoding, eol } = decodeText(new Uint8Array(buf));
  const { doc, trailing } = txtToDoc(text);
  return { mode: "plain", doc, txt: { encoding, eol, trailing } };
}

/* → { bytes, mime, name, mode: "replace" | "new", note } */
export function buildSave({ model, file, json, comments = [], author = "Reviewer", asNew = false, files }) {
  if (model.mode === "plain") {
    if (asNew) {
      const doc = { type: "doc", content: (json.content || []).map((p) => ({ ...p, attrs: { ...emptyAttrs } })) };
      const name = asDocxName(file.name);
      return { bytes: writeDocx({ doc, comments: [], meta: { author }, files: blankPackage() }), mime: DOCX_MIME, name, mode: "new", note: `Saved a Word copy, “${name}”. The .txt is unchanged.` };
    }
    const text = docToText(json, { eol: model.txt.eol, trailing: model.txt.trailing });
    return { bytes: encodeText(text, model.txt.encoding), mime: "text/plain", name: file.name, mode: "replace", note: model.txt.encoding === "windows-1252" ? "Saved as UTF-8 (the original used an older Windows text encoding)." : "" };
  }
  const bytes = writeDocx({ doc: json, comments, meta: { ...model.meta, author }, files: files || model.files });
  if (model.converted) { const name = asDocxName(file.name); return { bytes, mime: DOCX_MIME, name, mode: "new", note: `Saved as a new Word file, “${name}”. The original .doc is kept.` }; }
  return { bytes, mime: DOCX_MIME, name: file.name, mode: "replace", note: "" };
}
