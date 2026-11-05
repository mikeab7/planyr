/* modelSyncBase — the ONE answer to "this device has a saved copy of the workbook AND the cloud has
 * one: which wins, or does the person have to choose?" (B2450528).
 *
 * ⛔ WHY THIS EXISTS. The load used to be "local always wins, and if the two differ, stop everything
 * and show the red bar". With no record of which cloud version the local copy was BASED ON, or of
 * whether it held unsynced edits, it could not tell "this device is just old" from "this device has
 * unsaved work" — so every difference, including a false one (jsonb re-orders object keys; see
 * `sheetModel.canonicalJson`), froze the cloud push. The owner: "this should have never been
 * presented. It should have always been uploading my changes."
 *
 * The device now keeps a tiny sibling record next to the stored workbook (`modelStore.readSyncMeta`):
 *   { baseVersion, dirty }  — the cloud `version` it was last confirmed against, and whether it has
 * been edited since that was last confirmed. The bar is reserved for the one case where silently
 * picking a side destroys work: BOTH sides changed since their common base.
 *
 * Pure. `local` and `cloud` are already-migrated workbooks (or null); `sameContent` is the
 * key-order-independent compare. Returns { action, ... }:
 *   "adopt-cloud"    show the cloud copy; this device is simply older (or never had anything real)
 *   "in-sync"        identical content; record the base, nothing to do
 *   "push-local"     this device has unsynced edits and the cloud has not moved since — upload them
 *   "no-cloud-copy"  the cloud has nothing yet; `dirty` says whether this device holds real work to upload
 *   "diverged"       dirty AND the cloud moved (or a legacy copy with no record that differs) — ask
 */
import { createWorkbook, sheetsDiverge } from "./sheetModel.js";

/** A workbook nobody has ever typed into, formatted or renamed — byte-for-byte what `createWorkbook()` makes.
 *  The load writes one of these before the cloud answers, so it can be left behind by a tab closed early;
 *  it must never win a fight with the real copy or raise the bar. */
export function isPlaceholderWorkbook(wb) {
  return !!wb && !sheetsDiverge(wb, createWorkbook());
}

export function decideLoadSync({ local, cloud, cloudVersion, meta, sameContent, localIsPlaceholder }) {
  if (!cloud) return { action: "no-cloud-copy", dirty: !!local && !localIsPlaceholder };
  if (!local) return { action: "adopt-cloud" };
  if (sameContent) return { action: "in-sync" };
  // An untouched blank workbook is a placeholder the load itself wrote — it can never hold work, so it
  // never wins and never raises the bar (a tab closed before the cloud answered leaves exactly one).
  if (localIsPlaceholder) return { action: "adopt-cloud" };
  // A legacy copy (saved before this record existed) that differs: nothing says which side is newer.
  if (!meta) return { action: "diverged", reason: "legacy" };
  if (!meta.dirty) return { action: "adopt-cloud" };
  if (meta.baseVersion != null && meta.baseVersion === cloudVersion) return { action: "push-local" };
  return { action: "diverged", reason: "both-changed" };
}
