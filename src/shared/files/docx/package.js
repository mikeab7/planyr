/* The .docx ZIP container: read it into a { name → bytes } map, write it back. The editor keeps the
 * ORIGINAL map and rewrites only the parts it owns (document.xml, comments…), so styles, themes,
 * numbering, media, headers/footers and anything else Word put in the file travel through untouched. */
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";

export const MAX_UNZIPPED_BYTES = 300 * 1024 * 1024; // a zip bomb must not take the tab down

export function readPackage(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let total = 0;
  let files;
  try {
    files = unzipSync(u8, { filter: (f) => { total += f.originalSize; if (total > MAX_UNZIPPED_BYTES) throw new Error("too-big"); return true; } });
  } catch (e) {
    if (e && e.message === "too-big") throw new Error("This Word file expands to more than the editor can safely open.");
    throw new Error("This isn’t a valid .docx (it couldn’t be unzipped). It may be damaged or password-protected.");
  }
  if (!files["word/document.xml"]) throw new Error("This isn’t a Word document (no word/document.xml inside).");
  return files;
}

export function writePackage(files) {
  const ordered = {};
  if (files["[Content_Types].xml"]) ordered["[Content_Types].xml"] = files["[Content_Types].xml"];
  for (const k of Object.keys(files)) if (k !== "[Content_Types].xml" && files[k]) ordered[k] = files[k];
  return zipSync(ordered, { level: 6 });
}

export const str = (u8) => strFromU8(u8);
export const bytes = (s) => strToU8(s);
