/*
 * test/ledgerBranchMode.test.js — the tools that used to gate ledger edits INSIDE a PR stand down once the ledger lives
 * on its own branch (NEW-1, 2026-11-05), and the light replacement check works. All against throwaway repos.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { git } from "../scripts/lib/ledgerBranch.mjs";
import { isBranchMode, BRANCH_MARKER, ledgerRoot } from "../scripts/lib/ledger.mjs";
import { extractIds, recordVerdict, formatVerdict } from "../scripts/lib/recordCheck.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FIXTURE = join(REPO, "test", "fixtures", "ledger-mini");
const ID = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ledger-mode-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** origin with a `ledger` branch + a code clone that carries the branch-mode marker (like post-move main). */
function world() {
  const bare = join(root, "origin.git");
  spawnSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  const seed = join(root, "seed");
  mkdirSync(seed);
  git(seed, ["init", "-q", "-b", "main"]);
  mkdirSync(join(seed, ".github"));
  writeFileSync(join(seed, BRANCH_MARKER), '{"branch":"ledger"}\n');
  git(seed, ["add", "-A"]); git(seed, ["commit", "-qm", "code"], { env: ID });
  git(seed, ["checkout", "-q", "-b", "ledger"]);
  git(seed, ["rm", "-rq", "."]);
  cpSync(join(FIXTURE, "ledger"), join(seed, "ledger"), { recursive: true });
  git(seed, ["add", "-A"]); git(seed, ["commit", "-qm", "ledger"], { env: ID });
  git(seed, ["push", "-q", bare, "main", "ledger"]);
  const code = join(root, "code");
  git(root, ["clone", "-q", "--branch", "main", bare, code]);
  return { bare, code };
}

describe("branch mode", () => {
  it("is switched on by the marker file, and only by it", () => {
    const { code } = world();
    expect(isBranchMode(code)).toBe(true);
    expect(isBranchMode(join(root, "nowhere"))).toBe(false);
    expect(ledgerRoot(code)).toBeNull(); // nothing synced yet — the readers say so rather than guess
  });

  it("next-id reads the ledger branch's tip (not the code tree) and points at `ledger add`", async () => {
    const { code } = world();
    const { main } = await import("../scripts/next-id.mjs");
    const cap = () => { let t = ""; return { write: (x) => { t += x; }, get text() { return t; } }; };
    const out = cap(), err = cap();
    expect(main(["--json"], { out, err }, code)).toBe(0);
    const j = JSON.parse(out.text);
    expect(j).toMatchObject({ ok: true, nextB: 101, nextV: 51, maxB: 100, maxV: 50, block: null });
    const o2 = cap();
    expect(main([], { out: o2, err: cap() }, code)).toBe(0);
    expect(o2.text).toMatch(/Next free → B101 · V51/);
    expect(o2.text).toMatch(/npm run ledger -- add backlog/);
  });

  it("check-mint stands down in branch mode (exit 0, says why) and still runs for a legacy repo", () => {
    const { code } = world();
    const run = (repo) => spawnSync(process.execPath, [join(REPO, "scripts", "check-mint.mjs"), `--repo=${repo}`, "--ci"], { encoding: "utf8" });
    const a = run(code);
    expect(a.status).toBe(0);
    expect(a.stdout).toMatch(/retired.*ledger.*branch/i);
    const legacy = join(root, "legacy");
    mkdirSync(legacy);
    git(legacy, ["init", "-q", "-b", "main"]);
    writeFileSync(join(legacy, "BACKLOG.md"), "# B\n\n### B1 — x\n");
    git(legacy, ["add", "-A"]); git(legacy, ["commit", "-qm", "x"], { env: ID });
    const b = run(legacy);
    expect(b.stdout + b.stderr).not.toMatch(/retired/i);   // the legacy gate still engages (no origin → it reports unverifiable)
  });
});

describe("record check — the light replacement for 'a fix and its record merge together'", () => {
  it("extracts only real ids (4+ digits), once each", () => {
    expect(extractIds("B2586592 — Trailer parking (#2868)")).toEqual(["B2586592"]);
    expect(extractIds("V2115856 PASSED live on 44486b2; B2671184/B2671185/B2671186 → Done")).toEqual(["V2115856", "B2671184", "B2671185", "B2671186"]);
    expect(extractIds("fix B2B and V8 and NEW-1, B12")).toEqual([]);
  });

  it("flags a cited id with no ledger record, and never a merge commit or a nudge", () => {
    const rows = [
      { sha: "a".repeat(40), subject: "B5000001 — shipped thing (#2870)" },
      { sha: "b".repeat(40), subject: "B5000002 — has a record (#2871)" },
      { sha: "c".repeat(40), subject: "Merge branch 'main' into x — B5000003" },
      { sha: "d".repeat(40), subject: "Nudge CI B5000004" },
    ];
    const v = recordVerdict(rows, new Set(["B5000002"]));
    expect(v.missing.map((m) => m.id)).toEqual(["B5000001"]);
    expect(formatVerdict(v, { github: true })).toMatch(/::warning title=Missing ledger record B5000001::/);
    expect(formatVerdict(recordVerdict(rows.slice(1, 2), new Set(["B5000002"])))).toMatch(/^✅/);
  });

  it("the CLI exits 0 even when records are missing (never a merge gate) and 1 only with --strict", () => {
    const { code } = world();
    git(code, ["commit", "--allow-empty", "-qm", "B5000009 — cited but never filed"], { env: ID });
    const run = (extra) => spawnSync(process.execPath, [join(REPO, "scripts", "ledger.mjs"), "record-check", "--range", "HEAD~1..HEAD", ...extra], { env: { ...process.env, ...ID, PLANYR_LEDGER_REPO: code }, cwd: code, encoding: "utf8" });
    const soft = run([]);
    expect(soft.status, soft.stderr).toBe(0);
    expect(soft.stdout).toMatch(/B5000009 is cited by/);
    expect(run(["--strict"]).status).toBe(1);
  });
});

describe("touch guard — a straggler PR that still edits ledger/ is told, never failed", () => {
  it("passes, and lists the ledger files as stragglers (so they can be forwarded, not stranded)", async () => {
    const { code } = world();
    git(code, ["checkout", "-q", "-b", "claude/straggler"]);
    mkdirSync(join(code, "ledger/backlog/open"), { recursive: true });
    writeFileSync(join(code, "ledger/backlog/open/B9999999.md"), "### B9999999 — straggler\n");
    writeFileSync(join(code, "src.txt"), "code\n");
    git(code, ["add", "-A"]); git(code, ["commit", "-qm", "straggler"], { env: ID });
    const { runGate } = await import("../scripts/generated-doc-touch-guard.mjs");
    const r = runGate(code);
    expect(r.ok).toBe(true);
    expect(r.stragglers).toEqual(["ledger/backlog/open/B9999999.md"]);
  });
});

describe("touch guard — the cut-over PR itself is not blocked by the rule it introduces", () => {
  it("origin/main still has the in-tree ledger + views; the branch deletes them and adds the marker → passes", async () => {
    const bare = join(root, "origin2.git");
    spawnSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
    const seed = join(root, "seed2");
    mkdirSync(seed);
    git(seed, ["init", "-q", "-b", "main"]);
    cpSync(join(FIXTURE, "ledger"), join(seed, "ledger"), { recursive: true });
    writeFileSync(join(seed, "BACKLOG.md"), "# view\n");
    writeFileSync(join(seed, "VERIFICATION.md"), "# view\n");
    git(seed, ["add", "-A"]); git(seed, ["commit", "-qm", "main with in-tree ledger"], { env: ID });
    git(seed, ["push", "-q", bare, "main"]);
    const code = join(root, "code2");
    git(root, ["clone", "-q", "--branch", "main", bare, code]);
    git(code, ["checkout", "-q", "-b", "claude/cutover"]);
    git(code, ["rm", "-rq", "ledger", "BACKLOG.md", "VERIFICATION.md"]);
    mkdirSync(join(code, ".github"), { recursive: true });
    writeFileSync(join(code, BRANCH_MARKER), '{"branch":"ledger"}\n');
    git(code, ["add", "-A"]); git(code, ["commit", "-qm", "cut over"], { env: ID });
    const { runGate } = await import("../scripts/generated-doc-touch-guard.mjs");
    const r = runGate(code);
    expect(r.ok).toBe(true);
    expect(r.stragglers).toEqual([]);   // deletions are the cut-over itself, not stragglers
  });
});
