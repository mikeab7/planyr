/* orgWorkbookOps — what the Organization workbook LIST does with a cloud result (NEW-3).
 *
 * `saveOrgWorkbookCloud` / `renameOrgWorkbookCloud` / `deleteOrgWorkbookCloud` (modelStore.js)
 * never throw — they RESOLVE `{ ok: false, reason, error }` — so ModelApp's old
 * `.catch(() => {})` on each was dead code and the resolved failure was never read: a deleted
 * workbook vanished from the picker and came back on the next visit (the cloud row was still
 * live), a rename held until the next cloud list reverted it, and a create existed on this
 * device only with no "saved on this device only" line. This module is the one decision for all
 * three ops, pure so it is unit-testable (test/orgWorkbookOps.test.js); ModelApp applies it.
 *
 * The content push already has this discipline (modelPushGate.js / the file header's
 * "confident green while the cloud silently failed" class) — this extends it to the INDEX ops. */

export const ORG_NOT_PROVISIONED_NOTICE = "Cloud backup for organization workbooks isn't turned on yet — saved on this device only.";

const VERB = { create: "create", rename: "rename", delete: "delete" };

/** `r` is the store's resolved result. Returns:
 *   applyLocal — may the LOCAL index reflect the op (create/rename always already did — they are
 *                optimistic; for DELETE this is the "remove locally only on confirmed removal" rule,
 *                mirroring deleteSite's tombstone-then-confirm shape);
 *   notice     — a line for the org picker, or null;
 *   status     — a value for the header's save badge (the content push's own surface), or null;
 *   telemetry  — a `reportClientEvent` row, or null. */
export function orgCloudOutcome(op, r, { id } = {}) {
  const verb = VERB[op] || op;
  if (!r || r.ok) return { applyLocal: true, notice: null, status: null, telemetry: null };
  if (r.reason === "not-provisioned") {
    // The table isn't there: the cloud genuinely holds nothing to delete, rename or create, so the
    // local index is the only index — apply locally and say "this device only" (the existing line).
    return { applyLocal: true, notice: ORG_NOT_PROVISIONED_NOTICE, status: "not-provisioned", telemetry: null };
  }
  if (r.reason === "unavailable") {
    // Supabase not configured / no account — same treatment the content push gives it (idle,
    // nothing to report): the local index is all there is.
    return { applyLocal: true, notice: null, status: null, telemetry: null };
  }
  const detail = r.error ? ` (${r.error})` : "";
  const notice = op === "delete"
    ? `Couldn't delete that workbook in the cloud${detail} — it's still here. Check your connection and try again.`
    : op === "rename"
      ? `Couldn't save that rename to the cloud${detail} — the new name is on this device only until it syncs.`
      : `Couldn't back this workbook up to the cloud${detail} — it's saved on this device only. It'll retry on your next edit.`;
  return {
    applyLocal: op !== "delete",
    notice,
    status: "error",
    telemetry: { kind: "cloud-write-failed", message: `org workbook ${verb} failed${r.reason ? ` (${r.reason})` : ""}`, extra: { id, op, reason: r.reason || null } },
  };
}
