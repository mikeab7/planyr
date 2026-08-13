#!/usr/bin/env node
/*
 * resolve-ledgers.mjs — the BRIDGE of B296224 (option b′).
 *
 * THE PROBLEM IT ENDS. Every PR appends to the same five bookkeeping files, so the conflict rate is
 * a function of ELAPSED TIME rather than of disagreement. PR #974 was pushed green, five PRs merged
 * while it sat, and it went `dirty` — 4 conflict hunks across 3 files, 2 more files to regenerate,
 * and **every hunk was "both sides prepended a new item to the top of the same section, with zero
 * id overlap."** There was nothing to decide. Twice in one session.
 *
 * ⛔ WHY NOT JUST `merge=union` IN .gitattributes, which is one line and would have landed #974
 * with no human step. Because union CANNOT TELL AN APPEND FROM AN EDIT. Two sessions amending the
 * SAME item — which happened twice in one day (#976 amended B1349; another branch corrected its own
 * B287057 cross-reference because of #976) — would be silently DUPLICATED rather than stopping
 * anyone. In the file that is the single source of truth for what is open, a silent duplicate is a
 * correctness failure. This script is union WITH THE PRECONDITION CHECKED instead of assumed.
 *
 * THE PRECONDITION, and it is exactly the property that makes union safe:
 *
 *     within a conflict hunk, NO B#/V# heading may appear on BOTH sides.
 *
 * Two sides that name disjoint ids are two independent appends and concatenating them loses
 * nothing. Two sides that name the same id are two edits of one item, or an edit racing a move —
 * a genuine disagreement, and the script REFUSES, names the id, and leaves the conflict markers in
 * place for a human. It never guesses. That covers the adjacent-hunk trap too: when git widens a
 * hunk to include an untouched neighbour, the neighbour's id shows up on both sides and the whole
 * hunk is refused rather than silently double-written.
 *
 * AND A POST-CONDITION, because a precondition that is subtly wrong should not be able to write a
 * broken ledger: after unioning, the result is re-checked with the SAME duplicate detectors CI runs
 * (B308704 same-file + B780 cross-file). Any new duplicate → the whole resolution is rolled back
 * and nothing is written. Two independent chances to catch the one failure mode that matters.
 *
 * THE GENERATED PAIR IS NOT UNIONED AT ALL. `BACKLOG_OPEN.md` and `MAP.md` are functions of other
 * files; their conflicts cost nothing and require no judgement. They are regenerated from the
 * merged inputs, which is the only correct answer and cannot be got wrong by concatenation.
 *
 * ⛔ BUT "GENERATED" DID NOT MEAN "FULLY DERIVED", AND THAT COST 48 DESCRIPTIONS (B384432). This
 * step used to `git checkout --ours` before regenerating. `MAP.md` carries a hand-authored one-liner
 * per path which `build-map.mjs` preserves by parsing the copy on disk — so seeding that parse from
 * ONE side silently threw away every description the other side had written. See `seedGenerated`.
 *
 * ⛔ NOT A MIGRATION. This is the bridge, deliberately: it is also the INSTRUMENT that decides
 * whether option (c) — entries as data the generator assembles — is worth its ~1,400-item cost. If
 * the "ids overlap on both sides" branch never fires in a month of merges, the conflicts really are
 * 100% arrival-order and (c) is justified by data rather than by argument. Every run appends a line
 * to `.planyr-ledger-merges.log` (gitignored) so that question has an answer.
 *
 *   node scripts/resolve-ledgers.mjs            → resolve, regenerate, `git add` what it fixed
 *   node scripts/resolve-ledgers.mjs --dry-run  → say what it would do, write nothing
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { newSameFileDuplicates, newCrossFileCollisions, B_FILES, V_FILES } from "./next-id.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

/** Hand-maintained append targets — the ones a union is even a candidate for. */
export const UNION_FILES = ["BACKLOG.md", "BACKLOG-DONE.md", "VERIFICATION.md", "VERIFICATION-DONE.md"];
/** Derived files: never unioned, always regenerated from their inputs. */
export const GENERATED = [
  { file: "BACKLOG_OPEN.md", build: ["scripts/build-backlog-index.mjs"] },
  { file: "MAP.md", build: ["scripts/build-map.mjs"] },
];

const ID_RE = /^###\s+([BV]\d+)\b/gm;
const idsIn = (text) => new Set([...(text || "").matchAll(ID_RE)].map((m) => m[1]));

/**
 * Split a conflicted file into hunks. PURE. Returns
 * `{ ok, hunks:[{ ours, theirs, oursIds, theirsIds, overlap }], text, overlaps:[{ids, at}] }`.
 * `text` is the unioned result and is only meaningful when `ok`.
 */
export function resolveConflicts(raw) {
  const lines = raw.split("\n");
  const out = [];
  const hunks = [];
  const overlaps = [];
  let i = 0;
  while (i < lines.length) {
    if (!/^<<<<<<< /.test(lines[i])) { out.push(lines[i]); i += 1; continue; }
    const startLine = i + 1;
    const ours = [], theirs = [];
    let side = "ours";
    i += 1;
    let closed = false;
    for (; i < lines.length; i += 1) {
      if (/^\|\|\|\|\|\|\| /.test(lines[i])) { side = "base"; continue; }   // diff3 style
      if (/^=======$/.test(lines[i])) { side = "theirs"; continue; }
      if (/^>>>>>>> /.test(lines[i])) { closed = true; i += 1; break; }
      if (side === "ours") ours.push(lines[i]);
      else if (side === "theirs") theirs.push(lines[i]);
    }
    // An unterminated marker means the file is not what we think it is. Refuse the whole file
    // rather than write a half-understood parse over the single source of truth (LOUD-FAILURE).
    if (!closed) return { ok: false, hunks, overlaps, unterminated: startLine, text: raw };

    const oursIds = idsIn(ours.join("\n"));
    const theirsIds = idsIn(theirs.join("\n"));
    const overlap = [...oursIds].filter((id) => theirsIds.has(id));
    hunks.push({ ours, theirs, oursIds: [...oursIds], theirsIds: [...theirsIds], overlap });
    if (overlap.length) overlaps.push({ ids: overlap, at: startLine });
    // Union: ours then theirs, in that order. Both sides prepend to the top of a section, so this
    // reproduces exactly the hand resolution — "keep both sides", newest-first, nothing renumbered.
    out.push(...ours, ...theirs);
  }
  return { ok: overlaps.length === 0, hunks, overlaps, text: out.join("\n") };
}

const git = (...args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 });

/** The placeholder `build-map.mjs` writes for a file nobody has described yet. */
const TODO_DESC = "TODO — describe";

/**
 * Strip the conflict markers and the `TODO — describe` lines out of one side of a generated file.
 * PURE, so the rule is unit-testable without a git repo. A TODO line carries no information and the
 * generator re-defaults to TODO on its own, so dropping it stops an empty placeholder on one side
 * from overwriting a real description on the other.
 */
export function seedSide(text) {
  return (text || "")
    .split("\n")
    .filter((l) => !/^(<{7} |={7}$|>{7} |\|{7} )/.test(l) && !l.includes(TODO_DESC))
    .join("\n");
}

/**
 * Build the seed a GENERATED file is regenerated FROM, as both sides concatenated.
 *
 * ⛔ NOT `git checkout --ours`, which is what this did until B384432 and which LOSES DATA. A file
 * being generated does not mean all of its content is derived: `MAP.md` carries a hand-authored
 * one-line responsibility per path, and `build-map.mjs` PRESERVES those by parsing the copy already
 * on disk. Seeding that parse from one side therefore discards every description the other side
 * wrote. Measured on PR #978 (2026-08-13, the bridge's first outing on a PR it did not author):
 * `--ours` regenerated `MAP.md` with **48 descriptions from `main` replaced by `TODO — describe`**,
 * and `build-map.mjs --check` went red on a merge the bridge had just reported as resolved. Silently
 * dropping another session's work is the one failure this script exists to be incapable of, and the
 * generated pair was the half of it nobody had checked.
 *
 * Both sides concatenated is the correct seed because the generator rebuilds the file from a FRESH
 * SCAN and reads the seed only for its preserved-content map, keyed by path — so a path appearing
 * twice costs nothing. Order is theirs-then-ours because the map is last-write-wins: a path both
 * sides describe keeps OURS, the branch's own wording for its own file.
 *
 * Returns false when the file has no conflict stages (already resolved) — then the copy on disk is
 * left exactly as it is and only the regeneration runs, which is the pre-existing behaviour.
 */
function seedGenerated(file) {
  const stage = (n) => { try { return git("show", `:${n}:${file}`); } catch { return ""; } };
  let ours = stage(2), theirs = stage(3);
  if (!ours && !theirs) {
    // Staged already (or resolved by hand): recover the two sides from the merge parents instead,
    // so a re-run is still correct rather than quietly seeding from a half-written file.
    try { ours = git("show", `HEAD:${file}`); } catch { ours = ""; }
    try { theirs = git("show", `MERGE_HEAD:${file}`); } catch { theirs = ""; }
  }
  if (!ours && !theirs) return false;
  writeFileSync(join(REPO, file), `${seedSide(theirs)}\n${seedSide(ours)}\n`);
  return true;
}

/** Files git currently reports as unmerged. */
function conflictedFiles() {
  try {
    return git("diff", "--name-only", "--diff-filter=U").split("\n").map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}

/** Any NEW duplicate id, by either detector, across both families. The post-condition. */
function newDuplicates() {
  const out = [];
  for (const [letter, files] of [["B", B_FILES], ["V", V_FILES]]) {
    for (const d of newSameFileDuplicates(REPO, files, letter)) out.push(`${d.key} ×${d.count} (same file)`);
    for (const d of newCrossFileCollisions(REPO, files, letter)) out.push(`${d.id} ×${d.count} (across the pair)`);
  }
  return out;
}

function main(argv) {
  const dry = argv.includes("--dry-run");
  const conflicted = conflictedFiles();
  if (!conflicted.length) { process.stdout.write("✅ No conflicted files — nothing to resolve.\n"); return 0; }

  const mine = conflicted.filter((f) => UNION_FILES.includes(f) || GENERATED.some((g) => g.file === f));
  const others = conflicted.filter((f) => !mine.includes(f));
  if (others.length) {
    // Source conflicts are real disagreements. This script has no opinion about them and must not
    // create the impression the merge is finished.
    process.stderr.write(`\nℹ ${others.length} NON-ledger conflict(s) left untouched — resolve these yourself:\n` +
      others.map((f) => `     ${f}\n`).join(""));
  }
  if (!mine.length) { process.stderr.write("\n⛔ No ledger conflicts to resolve.\n"); return others.length ? 1 : 0; }

  // ---- 1. the precondition, checked across EVERY hunk of EVERY file before anything is written
  const plan = [];
  const refusals = [];
  for (const file of mine.filter((f) => UNION_FILES.includes(f))) {
    const raw = readFileSync(join(REPO, file), "utf8");
    const res = resolveConflicts(raw);
    if (res.unterminated) { refusals.push({ file, reason: `unterminated conflict marker at line ${res.unterminated}` }); continue; }
    if (!res.ok) {
      for (const o of res.overlaps) refusals.push({ file, reason: `${o.ids.join(", ")} appears on BOTH sides of the hunk at line ${o.at}` });
      continue;
    }
    plan.push({ file, text: res.text, hunks: res.hunks.length });
  }

  if (refusals.length) {
    process.stderr.write(
      `\n⛔ REFUSING TO AUTO-RESOLVE — this is a real disagreement, not an arrival-order collision.\n\n` +
      refusals.map((r) => `   ${r.file}: ${r.reason}\n`).join("") +
      `\n   The same id on both sides means two sessions EDITED THE SAME ITEM (or an edit raced a\n` +
      `   lifecycle move). A union would keep both copies and silently duplicate the item, which in\n` +
      `   the single source of truth for what is open is a correctness failure, not untidiness.\n` +
      `   Merge those hunks by hand; the conflict markers are untouched. Nothing was written.\n\n`);
    logRun({ outcome: "refused", files: mine.length, refusals: refusals.length });
    return 1;
  }

  if (dry) {
    for (const p of plan) process.stdout.write(`would union ${p.hunks} hunk(s) in ${p.file} — no id on both sides of any of them\n`);
    for (const g of GENERATED) if (mine.includes(g.file)) process.stdout.write(`would regenerate ${g.file}\n`);
    return 0;
  }

  // ---- 2. write the unions, then re-check with CI's own detectors before declaring success
  const backup = plan.map((p) => ({ file: p.file, raw: readFileSync(join(REPO, p.file), "utf8") }));
  for (const p of plan) writeFileSync(join(REPO, p.file), p.text);

  const dupes = newDuplicates();
  if (dupes.length) {
    for (const b of backup) writeFileSync(join(REPO, b.file), b.raw);
    process.stderr.write(
      `\n⛔ ROLLED BACK — the union would have introduced a duplicate id, which the hunk check did\n` +
      `   not predict. That is exactly the failure this script exists to be incapable of, so the\n` +
      `   conflict markers are restored and nothing was written.\n\n` +
      dupes.map((d) => `     ${d}\n`).join("") + `\n   Resolve by hand, and put the case on B296224 — the precondition needs widening.\n\n`);
    logRun({ outcome: "rolled-back", files: mine.length, dupes: dupes.length });
    return 1;
  }

  // ---- 3. the generated pair: regenerate rather than union, then stage everything we fixed
  for (const g of GENERATED) {
    if (!mine.includes(g.file)) continue;
    seedGenerated(g.file);
    execFileSync(process.execPath, [join(REPO, ...g.build[0].split("/"))], { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
  }
  for (const f of mine) { try { git("add", "--", f); } catch { /* reported below by status */ } }

  process.stdout.write(
    `✅ Resolved ${plan.length} ledger file(s) — ${plan.reduce((n, p) => n + p.hunks, 0)} hunk(s), no id on both sides of any of them.\n` +
    plan.map((p) => `     ${p.file} (${p.hunks} hunk${p.hunks === 1 ? "" : "s"})\n`).join("") +
    GENERATED.filter((g) => mine.includes(g.file)).map((g) => `     ${g.file} (regenerated)\n`).join("") +
    (others.length ? `\n   ⚠ ${others.length} non-ledger conflict(s) still need you.\n` : `\n   Staged. Finish the merge with: git commit\n`));
  logRun({ outcome: "resolved", files: plan.length, hunks: plan.reduce((n, p) => n + p.hunks, 0) });
  return others.length ? 1 : 0;
}

/* The evidence trail that turns "should we do option (c)?" into a measurement. Best-effort: a
 * logging failure must never break a merge resolution. */
function logRun(row) {
  try {
    appendFileSync(join(REPO, ".planyr-ledger-merges.log"), `${new Date().toISOString()} ${JSON.stringify(row)}\n`);
  } catch { /* never fatal */ }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
