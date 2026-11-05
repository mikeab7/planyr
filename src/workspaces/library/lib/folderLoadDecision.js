/* folderLoadDecision — what the folder tree shows after a read (NEW-4, LOUD-FAILURE).
 *
 * `listFolders` (folders.js) used to answer `[]` on a query error (console.warn only), and
 * FolderTree rendered `tree.length === 0` as the template PREVIEW — "Create the standard
 * N-folder structure" + "Nothing's been created yet" — over a project that has a real tree. A
 * transient read failure therefore invited a seed (ensureSeeded re-counts server-side so it
 * won't double-seed, but createStandardFolders → reload → scheduleSync(0) then fired a Drive
 * mirror pass on a tree it had just failed to read). `listFolders` now answers `{ ok, rows,
 * error }`, and this is the ONE reading of it — the same rule FileBrowser's NEW-F5 applies to
 * the file list: a failed read KEEPS the previous rows and says so; only an honest empty success
 * may render the template. Pure; test/folderLoadDecision.test.js. */

export const FOLDER_READ_FAILED_PREFIX = "Couldn't load folders — ";

/** @param prev     the rows currently shown (the previous project's, on a switch — see `fresh`)
 *  @param result   `listFolders`' `{ ok, rows, error }`
 *  @param fresh    true on a project switch / first load: a failed read must NOT keep another
 *                  project's rows, so the tree shows nothing AND is marked failed (never the template)
 *  Returns { rows, failed, error } — `failed` is what gates the template preview. */
export function applyFolderRead(prev, result, { fresh = false } = {}) {
  const prevRows = Array.isArray(prev) ? prev : [];
  if (result && result.ok) return { rows: Array.isArray(result.rows) ? result.rows : [], failed: false, error: "" };
  const why = (result && result.error) || "the cloud didn't answer";
  return { rows: fresh ? [] : prevRows, failed: true, error: `${FOLDER_READ_FAILED_PREFIX}${why}. Showing ${fresh ? "nothing" : "the last loaded tree"} until it loads; your folders are safe.` };
}

/** May the "Create the standard structure" template preview render? Only on an HONEST empty
 *  tree: a successful read that returned no live rows. Never on a failed read, never while loading. */
export function templatePreviewAllowed({ loading, failed, treeLength }) {
  return !loading && !failed && treeLength === 0;
}
