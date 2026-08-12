/* B1341 STAGE 2 — THE GROUP REVISION, and the one decision behind it.
 *
 * Stage 1 gave the database the grouping (`site_elements.assembly_id`, generated from
 * `data->>'attachedTo'`). Stage 2 needs a VALUE both sides can compare: "is this assembly still in
 * the state I based my edit on?" — one number for the whole group, the way `rev` is one number for
 * one row.
 *
 * ⛔ THE DECISION: THE GROUP REVISION IS DERIVED, NOT STORED.
 * The obvious design is a `group_rev` column bumped by a trigger. It was rejected for the reason
 * this entire bug family exists: a stored group revision is a SECOND copy of a fact the row revs
 * already carry, maintained by a different code path, and the failure mode of two copies of one
 * fact is the thing B1340 and B377888/B377890 were all about. A derived digest cannot drift from
 * the revs it summarises, because it IS the revs.
 *
 * ⛔ AND IT IS A PLAIN STRING, NOT A HASH.
 * `id:rev` pairs, sorted by id, joined by `,`. A hash would be shorter and would make a mismatch
 * unreadable — you would know the group moved and nothing about how. This form answers "which
 * member changed, and to what" straight off the wire, in a log line, with no tooling. A twelve
 * member assembly is ~250 characters; that is a rounding error on a payload that carries the
 * elements themselves. If it ever needs to be short, hash THIS string — do not change the ordering
 * or the separators, because the SQL side has to produce the identical text.
 *
 * THE SQL TWIN, which must stay character-for-character equivalent:
 *   string_agg(id || ':' || rev, ',' order by id)   over live rows with this assembly_id
 * Guarded by `test/assemblyGroupCas.test.js` (which reads the migration and re-derives the
 * expression) and proven against a real Postgres by `db/test/commit_elements_group_cas.test.sql`.
 *
 * ⛔ LIVE ROWS ONLY, on both sides. A tombstone is not a member of an assembly (the stage 1 index
 * is partial for the same reason), and including one would make a delete look like a change to
 * every sibling.
 */

// One member's contribution. Exported so a caller can build a digest from any row-like shape
// without re-deriving the separator convention.
export const memberToken = (id, rev) => `${id}:${Number(rev) || 0}`;

/* The group revision for a set of live members.
 * `members` — iterable of { id, rev }. Order does not matter (sorted here).
 * Returns "" for an empty group, which is a legitimate value: an assembly whose members have all
 * been deleted, and a client that believes that is CORRECT if the server agrees. */
export function assemblyDigest(members) {
  const toks = [];
  for (const m of members || []) {
    if (!m || m.id == null) continue;
    toks.push(memberToken(m.id, m.rev));
  }
  // Sort the WHOLE token, matching `order by id` given ids are unique within an assembly.
  toks.sort();
  return toks.join(",");
}

/* Group the members of a shadow-like map by assembly, and digest each.
 * `entries` — iterable of { kind, id, rev, el } (the engine's shadow values).
 * `rootOf`  — (entry) => the assembly id, or null to exclude the entry.
 *
 * ⛔ ONLY `el`-kind rows form assemblies, exactly as `rootIdOf` has it in elementSync — a markup or
 * a measurement has no host, and folding them in would make an assembly's digest depend on objects
 * the database's `assembly_id` never groups with it.
 */
export function digestsByAssembly(entries, rootOf) {
  const groups = new Map();
  for (const e of entries || []) {
    if (!e || e.kind !== "el" || e.id == null) continue;
    const root = rootOf ? rootOf(e) : null;
    if (root == null) continue;
    let list = groups.get(root);
    if (!list) { list = []; groups.set(root, list); }
    list.push({ id: e.id, rev: e.rev });
  }
  const out = new Map();
  for (const [root, members] of groups) out.set(root, assemblyDigest(members));
  return out;
}
