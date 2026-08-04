/* projectName.js — THE authority for what a project (site group) is called.
 *
 * ⛔ NEW-1 — A PROJECT'S NAME HAS ONE AUTHORITATIVE VALUE PER GROUP. Every `site` field on
 * every plan row is a DERIVED MIRROR of it, never an independent source of truth.
 *
 * Why this module exists (the owner's 2026-08-04 report, proven in the production DB):
 * a project's name is stored DENORMALIZED — copied onto the `site` field of every plan in the
 * group — so a project with five plans held five independent copies of one name and nothing kept
 * them in agreement. `renameSiteGroup` wrote the new name by iterating the LOCAL store, so any
 * plan not hydrated in that browser at rename time was never written; it kept the old name in the
 * cloud and RE-PUBLISHED it the next time it saved for any reason. Group smrp1wrgg6u5 sat split
 * "Silvestri" (4 plans) / "Sylvestri" (1 plan, saved seventeen minutes AFTER the rename) for four
 * days and showed up as two separate entries in the map list.
 *
 * The invariant, and the three halves that hold it up:
 *   1. WRITE — a rename is ONE write at the source of truth (`storage.renameSiteGroup` →
 *      `cloudSync.cloudRenameGroup`, a single `update … where group = …` statement), so it reaches
 *      every plan in the group including ones this browser has never loaded, and cannot half-land.
 *   2. STAMP — that write records `siteRenamedAt` (epoch ms) alongside the name, which is what
 *      makes "which copy is authoritative" a FACT rather than a guess. Without it the only
 *      tiebreak is "most recently updated", and on the owner's real data that answer is wrong
 *      whenever the stale plan happens to be the one saved last.
 *   3. READ — every read path resolves the group's authority and mirrors it onto each plan
 *      (`applyGroupNameAuthority` in storage.js). A stale plan hydrating later therefore READS the
 *      project name instead of re-publishing its own copy over it — the exact move that undid the
 *      owner's rename.
 *
 * This module is PURE (no storage, no network, no DOM) so the decision is unit-testable on its own.
 */

// The group a plan belongs to. Mirrors storage.groupOf — kept local so this module imports nothing.
export const groupKeyOf = (m) => (m && (m.groupId || m.id)) || null;

// The project name a plan CLAIMS. Deliberately reads `site` only — never the plan's own `name`
// (that is the concept label, "Concept A", and differs per plan by design, so folding it in here
// would make every healthy multi-plan group look split).
const claimOf = (m) => {
  const s = m && m.site;
  return typeof s === "string" && s.trim() ? s : null;
};

const stampOf = (m) => {
  const t = m && m.siteRenamedAt;
  return typeof t === "number" && isFinite(t) && t > 0 ? t : null;
};

const updatedOf = (m) => {
  const t = m && m.updatedAt;
  if (typeof t === "number" && isFinite(t)) return t;
  const p = Date.parse(t || "");
  return isFinite(p) ? p : 0;
};

/* The authoritative name for ONE group, given its plans.
 *
 * Returns { name, at, basis, plans, ambiguous }:
 *   basis "stamp"     — at least one plan carries a `siteRenamedAt`: the name on the plan with the
 *                       NEWEST stamp wins, full stop. This is the only basis that can ever apply to
 *                       a rename made after this ships, and it is unconditional — once stamped, a
 *                       group always has an answer, so a split can never persist.
 *   basis "majority"  — LEGACY ONLY (no plan carries a stamp): the name held by a strict majority
 *                       of plans wins. This is the shape the bug actually produces — the rename
 *                       loop writes N−1 copies of the new name and the straggler keeps the old one
 *                       — so it recovers the owner's Silvestri/Sylvestri group (4 vs 1) correctly.
 *   basis "ambiguous" — legacy, no stamp, and NO strict majority (e.g. a 1-vs-1 split). There is no
 *                       honest winner, so we refuse to guess and change NOTHING; the caller reports
 *                       it (LOUD-FAILURE) rather than silently renaming half a project. A single
 *                       real rename resolves it permanently by stamping the group.
 *
 * A tie WITHIN the stamped tier (two different names sharing the same newest stamp — effectively
 * impossible, since one rename writes one name at one instant) breaks deterministically on count
 * then on updatedAt, never into "ambiguous": once a group is stamped it must always resolve. */
export function nameAuthority(plans) {
  const list = (plans || []).filter(Boolean);
  if (!list.length) return { name: null, at: null, basis: "empty", plans: 0, ambiguous: false };

  // Tally per distinct claimed name: newest stamp, plan count, newest updatedAt.
  const byName = new Map();
  for (const m of list) {
    const claim = claimOf(m);
    if (claim == null) continue; // no opinion — a record with no `site` never votes
    const cur = byName.get(claim) || { name: claim, at: null, count: 0, updatedAt: 0 };
    const st = stampOf(m);
    if (st != null && (cur.at == null || st > cur.at)) cur.at = st;
    cur.count += 1;
    cur.updatedAt = Math.max(cur.updatedAt, updatedOf(m));
    byName.set(claim, cur);
  }
  const cands = [...byName.values()];
  if (!cands.length) return { name: null, at: null, basis: "empty", plans: list.length, ambiguous: false };
  if (cands.length === 1) {
    const only = cands[0];
    return { name: only.name, at: only.at, basis: only.at != null ? "stamp" : "majority", plans: list.length, ambiguous: false };
  }

  const stamped = cands.filter((c) => c.at != null);
  if (stamped.length) {
    stamped.sort((a, b) => (b.at - a.at) || (b.count - a.count) || (b.updatedAt - a.updatedAt) || String(a.name).localeCompare(String(b.name)));
    const win = stamped[0];
    return { name: win.name, at: win.at, basis: "stamp", plans: list.length, ambiguous: false };
  }

  // Legacy tier — a strict majority, or nothing.
  const sorted = cands.slice().sort((a, b) => (b.count - a.count) || (b.updatedAt - a.updatedAt));
  if (sorted[0].count > sorted[1].count) {
    return { name: sorted[0].name, at: null, basis: "majority", plans: list.length, ambiguous: false };
  }
  return { name: null, at: null, basis: "ambiguous", plans: list.length, ambiguous: true, names: sorted.map((c) => c.name) };
}

/* The newest rename stamp already present in a group, or 0.
 *
 * `renameSiteGroup` uses this to make the stamp STRICTLY MONOTONIC — `max(now, previous + 1)` —
 * rather than trusting the wall clock. Two reasons, one of which is not theoretical:
 *   • Two renames inside the same millisecond would otherwise share a stamp, and a same-stamp tie
 *     is broken on count/updatedAt, so the SECOND rename could lose to the first. (Caught by the
 *     "a genuine rename still wins" test — it failed before this existed.)
 *   • Clocks disagree across devices. A laptop running a few seconds slow would stamp a genuinely
 *     later rename with an earlier number, and every reader would then prefer the older name. */
export function maxStampOf(plans) {
  let max = 0;
  for (const m of plans || []) {
    const st = stampOf(m);
    if (st != null && st > max) max = st;
  }
  return max;
}

// Group an array of plan models by their group key. Returns a Map<groupKey, model[]>.
export function byGroup(models) {
  const out = new Map();
  for (const m of models || []) {
    const g = groupKeyOf(m);
    if (!g) continue;
    const list = out.get(g);
    if (list) list.push(m);
    else out.set(g, [m]);
  }
  return out;
}

/* NEW-3 — converge every split group onto its authoritative name.
 *
 * Pure and IDEMPOTENT by construction: a coherent group produces no candidates to change, so the
 * models array comes back with every object's IDENTITY preserved (only a genuinely-corrected plan
 * is a new object). Running it twice changes nothing the second time — the contract the other
 * repair passes in this repo hold to.
 *
 * Returns { models, changes, ambiguous }:
 *   changes   — [{ id, groupId, from, to, at, basis }] for every plan whose `site` was corrected.
 *   ambiguous — [{ groupId, names, plans }] for every group with no honest winner (reported, never
 *               guessed at).                                                                     */
export function reconcileGroupNames(models) {
  const list = models || [];
  const groups = byGroup(list);
  const authority = new Map();   // groupKey → { name, at, basis }
  const ambiguous = [];
  for (const [g, plans] of groups) {
    const a = nameAuthority(plans);
    if (a.ambiguous) { ambiguous.push({ groupId: g, names: a.names || [], plans: a.plans }); continue; }
    if (a.name != null) authority.set(g, a);
  }
  const changes = [];
  const out = list.map((m) => {
    const g = groupKeyOf(m);
    const a = g != null ? authority.get(g) : null;
    if (!a) return m;
    const sameName = claimOf(m) === a.name;
    // Mirror the stamp too, so the whole group agrees on WHEN it was last renamed — otherwise the
    // corrected plan carries no stamp, and the next legacy-tier read has to re-derive the majority.
    const sameStamp = a.at == null || stampOf(m) === a.at;
    if (sameName && sameStamp) return m;
    if (!sameName) changes.push({ id: m.id, groupId: g, from: claimOf(m), to: a.name, at: a.at, basis: a.basis });
    return a.at == null ? { ...m, site: a.name } : { ...m, site: a.name, siteRenamedAt: a.at };
  });
  return { models: out, changes, ambiguous };
}

/* The single-record form of the same rule, for the write path.
 *
 * Given the record being written and every OTHER record in the store, return the `site` /
 * `siteRenamedAt` the record must carry. `saveSite` funnels every local write through this, which
 * is what makes "no plan row may ever contradict its own project's name" true at the STORE rather
 * than only at the reader: a stale in-memory model can no longer be written back with the old
 * name, so it can never be pushed to the cloud with it either.
 *
 * The record being written participates as a candidate, so a genuine rename (which stamps
 * `siteRenamedAt: Date.now()`, the newest stamp in the group) still wins and still applies. */
export function resolveNameFor(record, siblings) {
  const a = nameAuthority([record, ...(siblings || [])]);
  if (a.ambiguous || a.name == null) return null;    // no honest answer → leave the record alone
  const sameName = claimOf(record) === a.name;
  const sameStamp = a.at == null || stampOf(record) === a.at;
  if (sameName && sameStamp) return null;            // already correct → no write, no churn
  return a.at == null ? { site: a.name } : { site: a.name, siteRenamedAt: a.at };
}
