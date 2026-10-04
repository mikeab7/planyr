/* openedFileMeta.js — the filing facts of a file just picked/dropped into Review (NEW-1, 2026-10-04).
 *
 * A Word/text/PDF file opened from disk is its OWN review: its Library row must be named after IT, never after
 * whatever the Review root last held (a previously open drawing's item/title) and never the "Untitled"
 * fallback `composeTitle` produces when `item` is empty. So the opened file's `meta` is derived from its
 * name — the same convention `fileNewReview` uses (`item = stripFileExt(name)`, discipline "Other",
 * date-first title composed from them) — and only the FILING (project / org scope) carries over.
 * PURE: no state, no storage.
 */
import { stripFileExt } from "./reviewStore.js";

export function metaForOpenedFile(name, filing = {}, docDate = "") {
  return {
    title: "", // empty = auto-composed from project + item + date (follows a project rename)
    projectId: filing.orgScope === true ? null : (filing.projectId || null),
    project: filing.orgScope === true ? "" : (filing.project || ""),
    orgScope: filing.orgScope === true,
    discipline: "Other",
    item: stripFileExt(name || "") || "Document",
    revision: "", docDate,
    folderId: null, sourceFile: name || "",
  };
}

/* Status messages belong to the tab that produced them (NEW-2). `rec` is `{ tab, msg }`. */
export const noticeForTab = (rec, tabId) => (rec && tabId != null && rec.tab === tabId ? rec.msg || "" : "");
