/* One run of the Library's one-time folder organizer (B663), as a pure-ish function so its outcome — and
 * above all WHEN the done-marker is written — can be asserted without rendering the Library (NEW-1,
 * 2026-11-09). `Library.jsx` `runMigration` is a thin wrapper: it pins the identity, lists the projects, calls
 * this, and shows the returned banner state.
 *
 * Contract: the marker is written exactly when the walk finished with no error AND the same account is still
 * signed in. A sign-in problem returns `signIn: true` (the banner offers "Sign in"); no marker, so the run is
 * repeated — after a refresh-and-retry has already happened inside every API call (shared/auth/apiAuth.js). */
import { migrateAllProjects } from "./folders.js";

export async function runOrganizer({ projects, uid, checkIdentity, onProgress, markDone, migrate = migrateAllProjects }) {
  const r = await migrate(projects, { checkIdentity, onProgress });
  if (r.ok && (await checkIdentity())) {
    markDone(uid);
    return {
      status: "done", signIn: false, result: r,
      text: `All ${r.projects} project${r.projects === 1 ? "" : "s"} organized${r.movedFiles ? ` · ${r.movedFiles} file${r.movedFiles === 1 ? "" : "s"} moved into folders` : ""}.`,
    };
  }
  if (r.ok) return { status: "idle", signIn: false, text: "", result: r }; // account changed right at the end — no marker, no claim
  return { status: "error", signIn: !!r.authExpired, text: r.message || "The one-time folder organization hit a problem.", result: r };
}
