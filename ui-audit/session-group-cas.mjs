#!/usr/bin/env node
/* B1341 STAGE 2 — AN ORDINARY WORKING HOUR, DRIVEN THROUGH THE REAL WRITE ENGINE WITH GROUP CAS ON.
 *
 * ⛔ WHY THIS EXISTS RATHER THAN A BROWSER SESSION, stated plainly so nobody reads it as the wrong
 * kind of evidence. The engine this feature lives in (`lib/elementSync.js`) starts only when a
 * signed-in cloud session exists — `if (!isCloudActive() || !siteId || !supabase) return;` — and
 * this sandbox's egress proxy answers `403 to CONNECT` for the Supabase host, measured, so a
 * browser here cannot sign in and would exercise ZERO group-CAS code. A green browser run would
 * therefore be a fabricated pass: exactly the shape this repo keeps getting bitten by. So the hour
 * is driven where the code actually is — the real engine module, unmodified — against a server
 * model whose group check is EVALUATED OUT OF THE SHIPPED MIGRATION (`test/helpers/sqlDigestParity`
 * reads and runs `assembly_digest`'s projection AND its where clause), not re-implemented here.
 * The same migration, running in production, was separately driven through all ten of its checks by
 * `db/test/commit_elements_group_cas.test.sql` on 2026-08-13 (ALL PASS, self-rolling-back).
 *
 * WHAT IT MEASURES, in the owner's terms: how many times the check refused a save, how many retries
 * that cost, and whether ANY refusal was spurious. A refusal is SPURIOUS if no other writer had
 * touched that assembly since this tab last saw it — i.e. it cost a save that nothing justified.
 * That is the failure that matters; a refusal caused by a real concurrent edit is the feature
 * working. A refusal that never converges is counted separately and is equally fatal.
 *
 * The hour is ordinary on purpose — not a targeted repro. Moves, resizes, child edits, adds,
 * deletes, whole-assembly drags, undo and redo, explicit saves, and idle gaps long enough for the
 * background save to fire on its own, drawn from a seeded mix so the run is reproducible.
 *
 * Run: node ui-audit/session-group-cas.mjs [--seed N] [--minutes N] [--json]
 */
import { createElementSync } from "../src/workspaces/site-planner/lib/elementSync.js";
import { sqlAssemblyDigest, sqlConflictMembers } from "../test/helpers/sqlDigestParity.js";
import { compareIds } from "../src/workspaces/site-planner/lib/assemblyDigest.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SQL = readFileSync(
  fileURLToPath(new URL("../src/workspaces/site-planner/db/commit_elements_group_cas.sql", import.meta.url)),
  "utf8",
);
const digestOf = sqlAssemblyDigest(SQL);
const membersOf = sqlConflictMembers(SQL);

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : dflt;
};
const SEED = arg("seed", 20260813);
const MINUTES = arg("minutes", 60);
const AS_JSON = argv.includes("--json");
// Realtime is best-effort in the field, so it drops rows by default. `--realtime 100` is the CONTROL:
// with every foreign row delivered, any residual canvas/store disagreement can no longer be blamed
// on a missed row and is a finding about the feature itself.
const DELIVERY = arg("realtime", 75) / 100;
/* ⛔ --mutate <kind> — DELIBERATELY BREAK THE SERVER SO THE HARNESS CAN BE WATCHED FAILING.
 * Twenty quiet seeds prove nothing on their own: a driver that cannot go red is a driver that has
 * rotted green, and this repo's signature defect is exactly that. `order` re-introduces the ordering
 * bug NEW-1 found (the server sorts the assembled token instead of the id), which is invisible until
 * an assembly holds a PREFIX PAIR — so the fixture below plants one. `membership` re-introduces
 * B447472 (the server folds in a non-el row sharing the assembly key). Both must produce SPURIOUS
 * refusals; if either comes back QUIET, the harness is broken, not the build. */
const MUTATE = (() => { const i = argv.indexOf("--mutate"); return i >= 0 ? argv[i + 1] : null; })();
if (MUTATE && !["order", "membership"].includes(MUTATE)) throw new Error(`unknown --mutate ${MUTATE}`);
const SITE = "session-hour";

// Reproducible randomness — a run that cannot be repeated cannot be argued about.
let s = SEED >>> 0;
const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;

// ---------------------------------------------------------------------------------------------
// THE SERVER MODEL. Rows as Postgres holds them, including stage 1's GENERATED assembly_id.
// ---------------------------------------------------------------------------------------------
const rows = new Map();                       // "kind:id" -> row
const rowKey = (kind, id) => `${kind}:${id}`;
const asmOf = (data, id) => (data && data.attachedTo != null ? data.attachedTo : id);
const putRow = (kind, id, data, rev, z, who) => {
  rows.set(rowKey(kind, id), {
    site_id: SITE, kind, id, rev, z_index: z, data, deleted_at: null,
    assembly_id: asmOf(data, id), lastWriter: who,
  });
};
const liveRows = () => [...rows.values()].filter((r) => r.deleted_at == null);

/** The deployed `assembly_digest`, executed out of the migration file. */
const serverDigest = (assembly) => {
  if (MUTATE === "order") {
    return digestOf.members(liveRows(), { p_site: SITE, p_assembly: assembly })
      .map((r) => `${r.id}:${r.rev}`).sort().join(",");            // ⬅ the pre-NEW-1 token sort
  }
  if (MUTATE === "membership") {
    // ⬅ the pre-B447472 missing kind filter, and ONLY that: the ordering stays correct, so a red
    // here isolates a MEMBERSHIP disagreement rather than re-testing the ordering one above.
    return liveRows().filter((r) => r.assembly_id === assembly)
      .sort((a, b) => compareIds(a.id, b.id)).map((r) => `${r.id}:${r.rev}`).join(",");
  }
  return digestOf.digest(liveRows(), { p_site: SITE, p_assembly: assembly });
};
const serverMembers = (assembly) =>
  membersOf.rows(liveRows(), { p_site: SITE, v_asm: assembly })
    .map((r) => ({ id: r.id, kind: r.kind, rev: r.rev }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id), "en"));

/** Which assemblies a writer OTHER than this tab has moved, and when — the spurious-refusal oracle. */
const foreignTouch = new Map();               // assembly -> monotonic mark
let mark = 0;

const stats = {
  calls: 0, applied: 0, refusals: 0, retries: 0, spurious: 0, nonConverging: 0,
  rowConflicts: 0, opsWritten: 0, groupsBet: 0, refusalDetail: [],
};

/** `public.commit_elements(p_site, p_ops, p_atomic, p_groups)`, modelled. */
function commit(ops, opts = {}) {
  stats.calls += 1;
  const groups = opts.groups || [];
  if (groups.length) stats.groupsBet += groups.length;

  // The group gate, read-only and BEFORE anything is applied.
  const bad = [];
  for (const g of groups) {
    const actual = serverDigest(g.assembly);
    if (actual !== g.expected) {
      bad.push({ assembly: g.assembly, expected: g.expected, actual, members: serverMembers(g.assembly) });
    }
  }
  groupsPassed = new Set();
  if (bad.length) {
    stats.refusals += 1;
    for (const b of bad) {
      /* ⛔ TWO INDEPENDENT ORACLES FOR "SPURIOUS", because the first one alone has a blind spot that
       * a mutation check found: once an assembly is PERMANENTLY stuck, the foreign-write test keeps
       * answering "a real edit explains this" forever, on the strength of one genuine conflict that
       * happened before the jam. A mutant that breaks the digest outright then reads as 0 spurious.
       *
       * (a) NOTHING EXPLAINS IT — no writer other than this tab has touched the assembly since we
       *     last agreed on it, so the refusal cost a save for no reason at all.
       * (b) THE WORLD DID NOT MOVE AND WE WERE REFUSED AGAIN — the previous refusal on this
       *     assembly reported the SAME `actual`, so the client has had the truth handed to it and
       *     still disagrees. That is the permanent-refusal signature, whatever caused it, and it is
       *     the one the owner actually pays for. */
      const touched = foreignTouch.get(b.assembly);
      const unexplained = touched == null || touched <= (lastAgreed.get(b.assembly) ?? -1);
      const stuck = lastRefusal.get(b.assembly) === b.actual;
      lastRefusal.set(b.assembly, b.actual);
      const spurious = unexplained || stuck;
      if (spurious) stats.spurious += 1;
      stats.refusalDetail.push({
        at: clock, assembly: b.assembly, spurious, why: stuck ? "re-refused an unchanged world" : unexplained ? "nothing else wrote it" : "",
        expected: b.expected, actual: b.actual,
      });
    }
    return { ok: true, sentAtomic: true, applied: false, groupConflict: bad, results: [] };
  }
  for (const g of groups) { lastAgreed.set(g.assembly, mark); groupsPassed.add(g.assembly); }

  // Per-row CAS, then all-or-nothing when the caller asked for atomic.
  const results = [];
  const writes = [];
  for (const op of ops) {
    const k = rowKey(op.kind, op.id);
    const row = rows.get(k);
    if (op.op === "create") {
      if (row && row.deleted_at == null) { results.push({ id: op.id, status: "exists", row }); continue; }
      /* ⛔ OVER A TOMBSTONE A CREATE *IS* A RESTORE, AND IT CONTINUES THE REV — `site_elements.sql`
       * updates `rev = t.rev + 1` rather than inserting at 1. Modelling it as a reset to 1 made this
       * driver report a SPURIOUS REFUSAL on seed 9 that the real server would never produce: the
       * client's shadow held e119 at rev 6, the model answered 1, and the digests disagreed forever.
       * Left here as a comment because it is the exact shape of a harness that convicts working code
       * — a re-created element is ordinary (delete, then undo), so this path is not an edge case. */
      const rev = row ? row.rev + 1 : 1;
      writes.push(() => putRow(op.kind, op.id, op.data, rev, op.z, "me"));
      results.push({ id: op.id, status: "ok", rev });
    } else if (op.op === "restore") {
      writes.push(() => putRow(op.kind, op.id, op.data, (row ? row.rev : 0) + 1, op.z, "me"));
      results.push({ id: op.id, status: "ok", rev: (row ? row.rev : 0) + 1 });
    } else if (op.op === "delete") {
      if (!row) { results.push({ id: op.id, status: "missing" }); continue; }
      if (row.rev !== op.expected) { stats.rowConflicts += 1; results.push({ id: op.id, status: "conflict", row: { ...row } }); continue; }
      writes.push(() => { row.deleted_at = clock; row.rev += 1; row.lastWriter = "me"; });
      results.push({ id: op.id, status: "ok", rev: row.rev + 1 });
    } else {
      if (!row) { results.push({ id: op.id, status: "missing" }); continue; }
      if (row.deleted_at != null) { results.push({ id: op.id, status: "deleted", row: { ...row } }); continue; }
      if (row.rev !== op.expected) { stats.rowConflicts += 1; results.push({ id: op.id, status: "conflict", row: { ...row } }); continue; }
      writes.push(() => { row.data = op.data; row.assembly_id = asmOf(op.data, op.id); row.rev += 1; row.z_index = op.z; row.lastWriter = "me"; });
      results.push({ id: op.id, status: "ok", rev: row.rev + 1 });
    }
  }
  const allOk = results.every((r) => r.status === "ok");
  if (opts.atomic && !allOk) return { ok: true, sentAtomic: true, applied: false, results };
  writes.forEach((w) => w());
  stats.opsWritten += writes.length;
  stats.applied += 1;
  for (const a of groupsPassed) appliedAt.set(a, clock);
  groupsPassed = new Set();
  return { ok: true, sentAtomic: true, applied: true, results };
}
const lastAgreed = new Map();
const lastRefusal = new Map();   // assembly -> the `actual` digest of its previous refusal
const appliedAt = new Map();      // assembly -> clock of the last APPLIED call that bet on it
let groupsPassed = new Set();     // assemblies whose bet passed in the call currently being applied

// ---------------------------------------------------------------------------------------------
// A VIRTUAL CLOCK, so an hour costs milliseconds and idle gaps are real gaps.
// ---------------------------------------------------------------------------------------------
let clock = 1_700_000_000_000;
let timerSeq = 0;
const timers = new Map();
const setTimer = (fn, ms) => { const id = ++timerSeq; timers.set(id, { fn, due: clock + Math.max(0, ms | 0) }); return id; };
const clearTimer = (id) => { timers.delete(id); };
async function advance(ms) {
  const end = clock + ms;
  for (;;) {
    let next = null;
    for (const [id, t] of timers) if (t.due <= end && (!next || t.due < next.t.due)) next = { id, t };
    if (!next) break;
    clock = Math.max(clock, next.t.due);
    timers.delete(next.id);
    try { next.t.fn(); } catch (e) { failures.push(`timer threw: ${e && e.message}`); }
    await drain();
  }
  clock = end;
  await drain();
}
const drain = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); };

// ---------------------------------------------------------------------------------------------
// THE PLAN this hour is spent on: three buildings, each a real bonded assembly.
// ---------------------------------------------------------------------------------------------
let nextId = 100;
const newId = () => `e${nextId++}`;
let els = [];
for (let b = 0; b < 3; b += 1) {
  const host = `b${b}`;
  els.push({ id: host, type: "building", cx: b * 900, cy: 0, w: 600, h: 300 });
  els.push({ id: `${host}-court`, type: "paving", cx: b * 900, cy: 285, w: 600, h: 135, attachedTo: host });
  els.push({ id: `${host}-trailer`, type: "trailer", cx: b * 900, cy: 420, w: 600, h: 50, attachedTo: host });
  els.push({ id: `${host}-walk`, type: "sidewalk", cx: b * 900, cy: -160, w: 600, h: 8, attachedTo: host });
}
/* ⛔ THE FIXTURE CARRIES BOTH TRAPS ON PURPOSE, or the mutation checks pass vacuously.
 * `b1x` is bonded to `b1` and `b1` is a PREFIX of it — the shape the token sort inverts, and the
 * shape the owner's real data does NOT yet contain (0 prefix pairs inside an assembly, 2026-08-13),
 * which is why an hour on a realistic plan alone could never have found NEW-1.
 * `markup:b2` collides with building `b2` across the kind namespace — B447472's shape. */
els.push({ id: "b1x", type: "parking", cx: 900, cy: 700, w: 300, h: 60, attachedTo: "b1" });
els.push({ id: "pond", type: "pond", cx: -700, cy: 300, w: 400, h: 260 });
els.push({ id: "ease", type: "easement", cx: -700, cy: -300, w: 400, h: 40 });
els = els.map((e, i) => ({ ...e, z: i }));
let zTop = els.length;
els.forEach((e, i) => putRow("el", e.id, e, 1, i, "seed"));
putRow("markup", "b2", { id: "b2", type: "line" }, 1, 99, "seed");   // B447472's namespace collision

const failures = [];
const events = [];
const reports = [];
const sync = createElementSync({
  siteId: SITE,
  commit: async (ops, opts) => commit(ops, opts),
  now: () => clock,
  setTimer, clearTimer,
  onEvent: (e) => events.push({ ...e, at: clock }),
  report: (name, msg, payload) => reports.push({ name, msg, payload, at: clock }),
  liveCollections: () => ({ els }),
  groupCas: () => true,                 // ⬅ the switch this run exists to test, forced ON
  backoff: [400, 1200, 3000, 6000, 10000],
});
sync.seed(els.map((e, i) => ({ kind: "el", id: e.id, data: e, rev: 1, z_index: i })));

// ---------------------------------------------------------------------------------------------
// THE OTHER WRITER — the owner's second tab. It writes straight to the store (its own commits are
// not this tab's concern) and its rows arrive here over realtime, with latency, and occasionally
// not at all: realtime is best-effort, and the conflict payload is what has to cover the gap.
// ---------------------------------------------------------------------------------------------
function otherWriterEdits() {
  const live = liveRows().filter((r) => r.kind === "el");
  if (!live.length) return;
  const target = pick(live);
  target.rev += 1;
  target.data = { ...target.data, cy: (target.data.cy || 0) + 5 };
  target.lastWriter = "other";
  foreignTouch.set(target.assembly_id, ++mark);
  if (chance(DELIVERY)) {                // realtime delivers most of the time
    const row = { kind: target.kind, id: target.id, data: target.data, rev: target.rev, z_index: target.z_index, deleted_at: null, updated_by: "other-uid" };
    setTimer(() => sync.applyRemoteRow(row), 200 + Math.floor(rnd() * 500));
  }
}

// ---------------------------------------------------------------------------------------------
// THE HOUR.
// ---------------------------------------------------------------------------------------------
const undoStack = [];
const redoStack = [];
const snapshot = () => els.map((e) => ({ ...e }));
const editStep = (label, fn) => { undoStack.push(snapshot()); redoStack.length = 0; fn(); log.push({ at: clock, label }); };
const log = [];
const hostIds = () => els.filter((e) => e.type === "building").map((e) => e.id);
const kidsOf = (h) => els.filter((e) => e.attachedTo === h);

const ACTIONS = [
  ["drag a whole building assembly", () => {
    const h = pick(hostIds());
    const dx = Math.round((rnd() - 0.5) * 60);
    els = els.map((e) => (e.id === h || e.attachedTo === h ? { ...e, cx: e.cx + dx } : e));
  }],
  ["resize a building (children re-fit)", () => {
    const h = pick(hostIds());
    const dw = Math.round((rnd() - 0.5) * 40);
    els = els.map((e) => (e.id === h || e.attachedTo === h ? { ...e, w: Math.max(60, e.w + dw) } : e));
  }],
  ["nudge one bonded child only", () => {
    const h = pick(hostIds());
    const kid = kidsOf(h)[0];
    if (!kid) return;
    els = els.map((e) => (e.id === kid.id ? { ...e, cy: e.cy + 2 } : e));
  }],
  ["edit a standalone element", () => {
    els = els.map((e) => (e.id === "pond" ? { ...e, w: e.w + 10 } : e));
  }],
  ["add a bonded child", () => {
    const h = pick(hostIds());
    const id = newId();
    els = [...els, { id, type: "parking", cx: 0, cy: 600, w: 200, h: 60, attachedTo: h, z: zTop++ }];
  }],
  ["add a standalone element", () => {
    const id = newId();
    els = [...els, { id, type: "markup-note", cx: rnd() * 900, cy: rnd() * 900, w: 40, h: 40, z: zTop++ }];
  }],
  ["delete an element", () => {
    const victims = els.filter((e) => e.type === "parking" || e.type === "markup-note");
    if (!victims.length) return;
    const v = pick(victims);
    els = els.filter((e) => e.id !== v.id && e.attachedTo !== v.id);
  }],
  ["undo", () => { const prev = undoStack.pop(); if (prev) { redoStack.push(snapshot()); els = prev; } }],
  ["redo", () => { const nxt = redoStack.pop(); if (nxt) { undoStack.push(snapshot()); els = nxt; } }],
];

async function run() {
  const end = clock + MINUTES * 60_000;
  while (clock < end) {
    const [label, fn] = pick(ACTIONS);
    if (label === "undo" || label === "redo") { const prev = label === "undo" ? undoStack.pop() : redoStack.pop(); if (prev) { (label === "undo" ? redoStack : undoStack).push(snapshot()); els = prev; } log.push({ at: clock, label }); }
    else editStep(label, fn);

    sync.reconcile({ els }, {});
    if (chance(0.45)) sync.flushGesture();          // a save the user asked for (mouse-up / Ctrl+S)
    await advance(150 + Math.floor(rnd() * 900));   // thinking time between edits

    if (chance(0.18)) otherWriterEdits();           // the second tab, mid-session

    if (chance(0.10)) {                             // a real idle gap — coffee, a phone call
      await advance(20_000 + Math.floor(rnd() * 90_000));
    }
  }
  // End of the hour: let everything settle, exactly as leaving the tab open would.
  sync.flushGesture();
  await advance(120_000);
}

await run();

// ---------------------------------------------------------------------------------------------
// DID ANYTHING GET LOST? The only end-state that matters: the store agrees with the canvas.
// ---------------------------------------------------------------------------------------------
stats.retries = reports.filter((r) => r.name === "element-group-conflict").length;
/* A refusal CONVERGED if some LATER call named that assembly and was accepted. `appliedAt` is
 * stamped by the commit model at the moment a group bet passes, so this is a real observation of
 * the retry succeeding — not an inference from the absence of a later refusal, which would count a
 * permanently-stuck assembly as converged the instant the user stopped touching it. */
stats.nonConverging = stats.refusalDetail.filter((r) => (appliedAt.get(r.assembly) ?? -1) < r.at).length;

const canvas = new Map(els.map((e) => [e.id, e]));
const stored = new Map(liveRows().filter((r) => r.kind === "el").map((r) => [r.id, r.data]));
const missing = [...canvas.keys()].filter((id) => !stored.has(id));
const extra = [...stored.keys()].filter((id) => !canvas.has(id));
/* ⛔ A KNOWN LIMIT OF THIS HARNESS, stated rather than hidden in a green number. The real app
 * applies an incoming realtime row onto the CANVAS through the planner's own reducer; this driver
 * feeds rows to the sync engine only and keeps a plain array as its canvas. So a row the OTHER tab
 * wrote and this tab never re-wrote legitimately differs here — that is the harness not modelling
 * the canvas, not the feature losing an edit. Split the two apart so the distinction is visible,
 * and fail only on the half that would be a real loss: a row whose last writer was US. */
const divergentAll = [...canvas.keys()].filter((id) => {
  const a = canvas.get(id), b = stored.get(id);
  if (!b) return false;
  return JSON.stringify({ ...a }) !== JSON.stringify({ ...b });
});
const lastWriterOf = (id) => (rows.get(rowKey("el", id)) || {}).lastWriter;
const divergent = divergentAll.filter((id) => lastWriterOf(id) !== "other");
if (sync.pendingCount() > 0) failures.push(`${sync.pendingCount()} edits still unsent after the session settled`);
if (missing.length) failures.push(`${missing.length} element(s) on the canvas never reached the store: ${missing.slice(0, 6).join(", ")}`);
if (divergent.length) failures.push(`${divergent.length} element(s) THIS tab wrote last disagree between canvas and store: ` +
  divergent.slice(0, 3).map((id) => `${id} canvas=${JSON.stringify(canvas.get(id))} store=${JSON.stringify(stored.get(id))}`).join(" | "));
if (stats.spurious > 0) failures.push(`${stats.spurious} SPURIOUS refusal(s) — a save refused with nothing having changed`);
if (stats.nonConverging > 0) failures.push(`${stats.nonConverging} refusal(s) never converged`);

const report = {
  seed: SEED, minutes: MINUTES, edits: log.length, mutation: MUTATE || "none", realtimeDelivery: `${Math.round(DELIVERY * 100)}%`,
  commits: stats.calls, applied: stats.applied, opsWritten: stats.opsWritten,
  assembliesBet: stats.groupsBet,
  refusals: stats.refusals, retries: stats.retries,
  spuriousDetail: stats.refusalDetail.filter((r) => r.spurious).slice(0, 8),
  spuriousRefusals: stats.spurious, nonConvergingRefusals: stats.nonConverging,
  perRowConflicts: stats.rowConflicts,
  reloadBannersShown: events.filter((e) => e.type === "client-stale").length,
  silentRefusals: events.filter((e) => e.type === "assembly-split").length,
  canvasNeverStored: missing.length, storedNotOnCanvas: extra.length, divergentGeometry: divergent.length, divergentFromForeignEdits: divergentAll.length - divergent.length,
  verdict: failures.length ? "FAILED" : "QUIET",
  failures,
};

if (AS_JSON) { console.log(JSON.stringify(report, null, 2)); }
else {
  console.log(`\n=== B1341 stage 2 — an ordinary working hour with group CAS ON (seed ${SEED}) ===\n`);
  for (const [k, v] of Object.entries(report)) {
    if (k === "failures") continue;
    console.log(`  ${k.padEnd(24)} ${Array.isArray(v) ? v.join(", ") : v}`);
  }
  if (failures.length) { console.log("\n  FAILURES:"); failures.forEach((f) => console.log(`    ✗ ${f}`)); }
  else console.log("\n  ✅ quiet — no spurious refusal, nothing left unsent, canvas and store agree.");
  if (stats.refusalDetail.length) {
    console.log("\n  refusals:");
    for (const r of stats.refusalDetail.slice(0, 12)) {
      console.log(`    ${r.spurious ? "SPURIOUS" : "genuine "} ${r.assembly}  expected ${r.expected.slice(0, 48)}…  actual ${r.actual.slice(0, 48)}…`);
    }
  }
  console.log("");
}
process.exit(failures.length ? 1 : 0);
