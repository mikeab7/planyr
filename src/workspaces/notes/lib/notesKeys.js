/* notesKeys — the device storage KEY FORMAT, written down once.
 *
 * ⛔ THIS IS NOT A SECOND STORAGE SEAM. `lib/notesStore.js` is still the one place the Notes
 * module reads and writes; this file holds nothing but the three key strings and the scope
 * rule, so that the ONE other module allowed to touch these keys — `lib/notesProjectLink.js`,
 * which answers "what is this project holding?" from OUTSIDE the Notes route — cannot drift
 * from the store's idea of where a tree lives.
 *
 * It exists for a measured bundle reason, not a stylistic one. The project-delete
 * confirmation lives in the shared header breadcrumb, which is chrome on EVERY route, so it
 * reaches the notes data by a dynamic import. Pointing that import at `notesStore.js` made
 * the bundler split the whole storage tier — the image database, the version history, the
 * task rollup, the Markdown exporter — into a shared chunk and cost the Notes route 12 KB.
 * Pointing it at a leaf that depends only on the pure model costs a fraction of that.
 */

export const TREE_KEY_BASE = "planyr:notes:tree:v1";
export const PAGE_KEY_BASE = "planyr:notes:page:v1";
export const SYNC_KEY_BASE = "planyr:notes:sync:v1";
/** Findings the person has said "keep both, stop telling me" about (NEW-4). */
export const IGNORED_DUPES_KEY_BASE = "planyr:notes:dupes-ignored:v1";

/** Signed in, a user's notes live under their id; signed out, under `local`. Two accounts on
 *  one machine therefore never read each other's notes. */
export const LOCAL_SCOPE = "local";

/** The storage scope for an account id. */
export const scopeFor = (userId) => (userId ? String(userId) : LOCAL_SCOPE);
