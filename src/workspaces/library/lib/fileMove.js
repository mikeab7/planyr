/* fileMove.js — the pure rules for moving ONE existing file between folders (NEW-1) and for the file-row
 * context menu (NEW-2). No storage, no DOM: FileBrowser performs the move through `fileReviewIntoProject` (the
 * one placement path, B2262880) — this only decides WHAT to do. Unit-tested in test/libraryFileMove.test.js. */
import { DISCIPLINES } from "../../../shared/files/titleBlockParse.js";
import { displayLabel } from "../../../shared/folders/folderTree.js";

/* The in-app drag payload. A custom type, NEVER under "Files" — the OS-upload drop path keys on "Files". */
export const FILE_MOVE_TYPE = "application/x-planyr-file";

const typesOf = (dt) => Array.from((dt && dt.types) || []);
export const isFileMoveDrag = (dt) => typesOf(dt).includes(FILE_MOVE_TYPE);
export const isOsFilesDrag = (dt) => !isFileMoveDrag(dt) && typesOf(dt).includes("Files");
/** The review id carried by an in-app file drag, or null (also null for an OS "Files" drag). */
export const readFileMoveId = (dt) => {
  if (!isFileMoveDrag(dt)) return null;
  try { return dt.getData(FILE_MOVE_TYPE) || null; } catch (_) { return null; }
};

/* What dropping / picking `targetFolderId` should do for a file currently sitting in `currentFolderId`.
 *   refuse — no target (All files / a non-folder row / a folder that no longer exists): nothing is highlighted
 *   noop   — it is already there: silently nothing
 *   move   — go */
export function moveDecision({ targetFolderId, currentFolderId, folderRows = [] }) {
  if (!targetFolderId) return { action: "refuse", reason: "no-target" };
  if (!folderRows.some((r) => r.id === targetFolderId)) return { action: "refuse", reason: "unknown-folder" };
  if (targetFolderId === currentFolderId) return { action: "noop", reason: "same-folder" };
  return { action: "move" };
}

/* The discipline a move records. An already-classified file keeps its own (same rule as the File picker's
 * `doRefile`); an unclassified one takes the target folder's label, case-normalised onto the canonical list
 * (the same normalisation a folder drop uses, so "05. Civil" → "Civil", never "civil"). */
export function disciplineForMove(f, folderRow) {
  const own = String((f && f.discipline) || "").trim();
  if (own && own !== "Other") return own;
  const raw = (folderRow && displayLabel(folderRow.name)) || "Other";
  return DISCIPLINES.find((d) => d.toLowerCase() === raw.toLowerCase()) || raw;
}

/* Optimistic list patch + its undo: returns { next, restore } for a rows array. */
export function applyOptimisticFolder(rows, id, folderId) {
  const prev = rows.find((r) => r.id === id);
  return {
    next: rows.map((r) => (r.id === id ? { ...r, folderId } : r)),
    restore: (cur) => cur.map((r) => (r.id === id && prev ? { ...r, folderId: prev.folderId ?? null } : r)),
  };
}

/* The file row's context-menu items, in order, from the row's own state. Pure: the component maps ids to the
 * handlers the row already has. `{ sep: true }` is a separator. */
export function fileMenuItems({ pdfRow, docRow, spatial, mapped, pinned, canPin, canHistory, canMove }) {
  const out = [{ id: "open", label: "Open" }, { id: "download", label: "Download" }];
  if (canMove) out.push({ id: "move", label: "Move to…" });
  out.push({ id: "rename", label: "Rename…" }, { id: "share", label: "Share link" });
  if (canHistory && (pdfRow || docRow)) out.push({ id: "versions", label: "Versions" });
  if (canPin) out.push({ id: "pin", label: pinned ? "Unpin from Library home" : "Pin to Library home" });
  if (pdfRow && spatial && !mapped) out.push({ id: "place", label: "Place on the map" });
  out.push({ sep: true }, { id: "delete", label: "Delete", danger: true });
  return out;
}
