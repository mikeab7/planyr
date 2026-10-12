/* trackedSites — NEW-2 (record-only sites) + the "this row cannot open" state. Pure.
 *
 * A "record-only" site is a site whose `role` is "tracked" (market intel: a comp, an asking price, a flyer — no
 * plan work). `shared/projects/projects.js listProjects()` leaves tracked sites OUT of every "pick a project"
 * surface on purpose (they are not pipeline projects) — but documents can be filed to one (a flyer attached to
 * a comp lands in `doc_reviews.project_id = <that site's group id>`), and the Library's only way into a
 * project's files is the project cards. So those files had no route in the UI at all.
 *
 * `trackedSitesWithFiles` is the missing list: tracked sites that actually hold files, newest first, each with
 * its file count. Opening one uses the SAME project route/folder tree/delete control as any project. */

/** @param {Array<{id:string,name?:string,updatedAt?:number}>} tracked  groupProjects() entries of role "tracked"
 *  @param {Array<{id:string,project_id?:string|null,projectId?:string|null}>} reviews live (non-deleted) doc_reviews rows */
export function trackedSitesWithFiles(tracked = [], reviews = []) {
  const count = new Map();
  for (const r of reviews || []) {
    const pid = r && (r.project_id || r.projectId);
    if (pid && !r.orgScope) count.set(pid, (count.get(pid) || 0) + 1);
  }
  return (tracked || [])
    .filter((t) => t && t.id && count.has(t.id))
    .map((t) => ({ id: t.id, name: t.name || "Untitled site", updatedAt: t.updatedAt || 0, count: count.get(t.id) }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Does the row have a file behind it? `sfile` is `data->>sourceFile`; a row with none has markups/metadata only.
 *  Returns null when fine, else the plain-language reason shown on the row (it stays clickable — Review still
 *  opens whatever the record holds — but it no longer looks identical to a working one). */
export function rowFileProblem(doc) {
  if (!doc) return null;
  if (doc.kind === "stitch") return null;               // a stitched set has no single source file by design
  if (doc.sfile) return null;
  return "No file is attached to this entry";
}
