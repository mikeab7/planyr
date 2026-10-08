/*
 * ledgerConcurrentPRs.test.js — acceptance test for NEW-1 (one file per ledger entry).
 *
 * THE CLAIM: two PRs that each file a backlog entry AND a verification entry, and touch no shared code,
 * merge cleanly in EITHER order. "Cleanly" is judged the way GitHub judges `mergeable_state`: with
 * `git merge-tree --write-tree` in a repo that has NO .gitattributes and no merge drivers — the same
 * information GitHub's server-side merge uses. (Measured 2026-10-05: GitHub ignores `merge=union`;
 * two PRs prepending a line to a `merge=union` file both read `dirty`.)
 *
 * RED-PROOF, in the same file: the identical two PRs against the OLD layout (one hand-edited
 * BACKLOG.md + VERIFICATION.md, entries added at the top of the Open / Needs-verification section)
 * DO conflict — so the harness can see a conflict, and a clean verdict on the new layout is real.
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";
import { writeEntry, readLedgerDir, readLedgerAtRef, virtualText, renderView, validateLedger, marker } from "../scripts/lib/ledger.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dirs = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const git = (cwd, ...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
function scratch() {
  const d = mkdtempSync(join(tmpdir(), "ledger-pr-"));
  dirs.push(d);
  git(d, "init", "-q", "-b", "main");
  return d;
}
const commit = (d, msg) => { git(d, "add", "-A"); git(d, "commit", "-q", "-m", msg); };
/** GitHub-equivalent mergeability: merge-tree, no attributes, no drivers. true = clean. */
const mergesCleanly = (d, a, b) => spawnSync("git", ["merge-tree", "--write-tree", "--no-messages", a, b], { cwd: d, encoding: "utf8" }).status === 0;

/* ---- OLD layout fixture: the shape main had before this change ---- */
function oldLayout() {
  const d = scratch();
  writeFileSync(join(d, "BACKLOG.md"), "# Backlog\n\n## 🔲 Open\n### B100 — existing item\nbody\n\n## ⏳ Verify\n### B90 — older\nbody\n");
  writeFileSync(join(d, "VERIFICATION.md"), "# Verification\n\n## 🔲 Needs verification\n\n### V50 — existing\nsteps\n\n## ✅ Done\n");
  commit(d, "base");
  return d;
}
function oldPr(d, branch, b, v) {
  git(d, "checkout", "-q", "-b", branch, "main");
  const bl = readFileSync(join(d, "BACKLOG.md"), "utf8").replace("## 🔲 Open\n", `## 🔲 Open\n### ${b} — new item from ${branch}\nbody\n\n`);
  const vl = readFileSync(join(d, "VERIFICATION.md"), "utf8").replace("## 🔲 Needs verification\n\n", `## 🔲 Needs verification\n\n### ${v} — check from ${branch}\nsteps\n\n`);
  writeFileSync(join(d, "BACKLOG.md"), bl);
  writeFileSync(join(d, "VERIFICATION.md"), vl);
  commit(d, branch);
  git(d, "checkout", "-q", "main");
}

/* ---- NEW layout fixture: the real frames + a few real-shaped entries ---- */
function newLayout() {
  const d = scratch();
  for (const kind of ["backlog", "verification"]) {
    mkdirSync(join(d, "ledger", kind), { recursive: true });
    cpSync(join(REPO, "ledger", kind, "_frame.md"), join(d, "ledger", kind, "_frame.md"));
  }
  writeEntry(d, "backlog", "open", "B100", "### B100 — existing open item `[x]` (task) #infra\n`[ ]` body\n- Verify: sandbox");
  writeEntry(d, "backlog", "open", "B101", "### B101 — another open item `[x]` (task) #infra\n`[ ]` body\n- Verify: sandbox");
  writeEntry(d, "verification", "pending", "V50", "### V50 — existing check\n1. step. **Expect:** x");
  commit(d, "base");
  return d;
}
function newPr(d, branch, b, v, { moveB101 = false } = {}) {
  git(d, "checkout", "-q", "-b", branch, "main");
  writeEntry(d, "backlog", "open", b, `### ${b} — new item from ${branch} \`[x]\` (task) #infra\n\`[ ]\` body\n- Verify: sandbox`);
  writeEntry(d, "verification", "pending", v, `### ${v} — check from ${branch}\n1. step. **Expect:** y`);
  if (moveB101) { mkdirSync(join(d, "ledger/backlog/verify"), { recursive: true }); git(d, "mv", "ledger/backlog/open/B101.md", "ledger/backlog/verify/B101.md"); }
  commit(d, branch);
  git(d, "checkout", "-q", "main");
}

describe("NEW-1 — two concurrent PRs that each file a backlog + verification entry", () => {
  it("RED-PROOF: on the OLD one-big-file layout the two PRs conflict, in either order", () => {
    const d = oldLayout();
    oldPr(d, "prA", "B201", "V201");
    oldPr(d, "prB", "B202", "V202");
    expect(mergesCleanly(d, "prA", "prB")).toBe(false);
    expect(mergesCleanly(d, "prB", "prA")).toBe(false);
  });

  it("new layout: clean in BOTH orders (GitHub-equivalent merge-tree, no drivers)", () => {
    const d = newLayout();
    newPr(d, "prA", "B201", "V201");
    newPr(d, "prB", "B202", "V202");
    expect(mergesCleanly(d, "prA", "prB")).toBe(true);
    expect(mergesCleanly(d, "prB", "prA")).toBe(true);
  });

  it("new layout: still clean when one PR also MOVES a different entry to Verify (the lifecycle move)", () => {
    const d = newLayout();
    newPr(d, "prA", "B201", "V201", { moveB101: true });
    newPr(d, "prB", "B202", "V202");
    expect(mergesCleanly(d, "prA", "prB")).toBe(true);
    expect(mergesCleanly(d, "prB", "prA")).toBe(true);
  });

  it("after merging both, every entry is present exactly once, validates, and the rendered view lists both", () => {
    const d = newLayout();
    newPr(d, "prA", "B201", "V201", { moveB101: true });
    newPr(d, "prB", "B202", "V202");
    git(d, "merge", "-q", "--no-edit", "prA");
    git(d, "merge", "-q", "--no-edit", "prB");
    expect(validateLedger(d)).toEqual([]);
    const l = readLedgerDir(d, "backlog");
    const ids = l.entries.map((e) => `${e.state}/${e.id}`).sort();
    expect(ids).toEqual(["open/B100", "open/B202", "open/B201", "verify/B101"].sort());
    const view = renderView("backlog", l.frame, l.entries);
    for (const id of ["B100", "B101", "B201", "B202"]) expect(view).toContain(`### ${id} —`);
    const v = readLedgerDir(d, "verification");
    expect(v.entries.map((e) => e.id).sort()).toEqual(["V201", "V202", "V50"]);
  });

  it("a git ref carrying ledger/ reads back the same entries (regression: ref reader crashed on main, B2109728)", () => {
    const d = newLayout();
    const l = readLedgerAtRef(d, "main", "backlog");
    expect(l.entries.map((e) => e.id).sort()).toEqual(["B100", "B101"]);
    expect(virtualText(d, "BACKLOG.md", { ref: "main" })).toContain("### B100 —");
    expect(virtualText(d, "docs/archive/BACKLOG-DONE.md", { ref: "main" })).toBe("\n");
  });

  it("the real frames carry a marker for every live state (a view can place every entry)", () => {
    for (const [kind, states] of [["backlog", ["open", "bug-audit", "verify", "later"]], ["verification", ["pending", "checklist"]]]) {
      const frame = readFileSync(join(REPO, "ledger", kind, "_frame.md"), "utf8");
      for (const s of states) expect(frame).toContain(marker(s));
    }
  });
});
