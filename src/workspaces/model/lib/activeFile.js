/* Which Library file the Spreadsheet is showing, per place (NEW-1, "open an uploaded Excel in Spreadsheet").
 *
 * A Library spreadsheet file is opened INTO the Spreadsheet tab of the project (or the Organization)
 * it is filed under. This remembers that choice per place so a reload — or leaving and coming back —
 * lands on the same file instead of the project's own workbook; "Close file" clears it. The Shell
 * writes it when a Library row is clicked (before it navigates), the Spreadsheet reads it and listens.
 *
 * A pointer only — never content. The file's content lives in the Library (lib/fileWorkbook.js); this
 * is a per-device view choice, the same tier as the sheet zoom (lib/sheetZoom.js): losing it just means
 * the project's own workbook shows and the file is one click away in the Library.
 */
const KEY = "planyr:model:activeFile:v1";

/** The place a file opens in: "org", "p:<projectId>", or "none" (an unfiled file). */
export function scopeKeyFor({ projectId = null, org = false } = {}) {
  if (org) return "org";
  return projectId ? `p:${projectId}` : "none";
}

function readAll() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch (_) { return {}; }
}

export function readActiveFile(scopeKey) {
  const id = readAll()[scopeKey];
  return typeof id === "string" && id ? id : null;
}

const listeners = new Set();
export function onActiveFileChanged(cb) { listeners.add(cb); return () => listeners.delete(cb); }

/** Set (or, with null, clear) the open file for a place and tell every listener. Never throws. */
export function setActiveFile(scopeKey, fileId) {
  try {
    const all = readAll();
    if (fileId) all[scopeKey] = fileId; else delete all[scopeKey];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (_) { /* storage blocked: the listeners below still switch this session */ }
  listeners.forEach((cb) => { try { cb(scopeKey, fileId || null); } catch (_) { /* a listener must not break the others */ } });
}
