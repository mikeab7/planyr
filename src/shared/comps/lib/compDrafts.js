/* compDrafts — pure row<->model mapping for `public.comp_import_drafts` (B849233/NEW-2). Mirrors
 * comps.js's rowToComp/compToRow shape. The `proposed` field is JSON already shaped like a
 * comps.js draft (compParse.js and kmlImport.js both build it that way), so the review UI can
 * feed it straight into `draftToComp`/`validateComp` — never a second, drifting conversion.
 */

export function rowToImportDraft(r) {
  return {
    id: r.id,
    userId: r.user_id,
    source: r.source,
    sourceFile: r.source_file || null,
    rawName: r.raw_name || null,
    rawDescription: r.raw_description || null,
    rawGeometry: r.raw_geometry || null,
    proposed: r.proposed || {},
    status: r.status,
    promotedCompId: r.promoted_comp_id || null,
    promoteError: r.promote_error || null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// NEVER includes user_id — server-stamped (auth.uid() default), same rule as comps.js compToRow.
export function importDraftToInsertRow(row) {
  return {
    source: row.source || "kml",
    source_file: row.source_file ?? row.sourceFile ?? null,
    raw_name: row.raw_name ?? row.rawName ?? null,
    raw_description: row.raw_description ?? row.rawDescription ?? null,
    raw_geometry: row.raw_geometry ?? row.rawGeometry ?? null,
    proposed: row.proposed ?? {},
    status: row.status || "pending",
  };
}

/** NEW-6 — what "Dismiss" on an import draft says when `deleteDraft` reports a failure.
 *  `deleteDraft` (compDraftsStore.js) answers `{ error }` — `"Not deleted"` on a 0-count delete
 *  (RLS / already gone) or the network/Postgres error — and the panel used to discard it: the
 *  refetch left the card on screen with no reason shown. Pure: result → notice string or null. */
export function dismissDraftNotice(r) {
  if (!r || !r.error) return null;
  const msg = r.error.message || (typeof r.error === "string" ? r.error : "");
  return `Couldn't dismiss that draft — ${msg || "the cloud didn't answer"}. It's still here; try again.`;
}
