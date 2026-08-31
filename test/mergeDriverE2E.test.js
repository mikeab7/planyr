/* The ledger merge driver END TO END, against REAL git refs (NEW-1) — modelled directly on
 * test/mintGateE2E.test.js, for the same reason: a mocked `git config` / `git merge` would prove
 * nothing about whether a real merge actually invokes the driver and gets the right answer.
 *
 * WHY THIS EXISTS. MAP.md and BACKLOG_OPEN.md are regenerated on nearly every PR, so on a busy
 * day any PR open more than ~20 minutes conflicts on them by construction — PR #1245 hit it twice
 * in one session. The fix has TWO layers (see scripts/merge-driver-ledgers.mjs's header for why
 * neither alone is both safe and complete):
 *   - `scripts/merge-driver-ledgers.mjs`, wired via `.gitattributes` + local git config, so
 *     MAP.md/BACKLOG_OPEN.md never SHOW a conflict in the common case;
 *   - `scripts/post-merge-regen.mjs`, wired via the `.githooks/post-merge` hook, which corrects
 *     the driver's necessarily-partial mid-merge view once the merge has fully resolved and the
 *     working tree is complete — staging the fix (never amending; see that script's header for
 *     why an amend from inside the hook itself is unsafe) so it is a `git status` away.
 * `test/mergeDriverLedgers.test.js` pins the driver's own decision core against stub generators;
 * this file proves the COMPOSED path — real `.gitattributes`, real local git config, a real
 * `.githooks/post-merge`, a real `git merge`, the REAL `build-map.mjs` / `build-backlog-index.mjs`
 * — actually reaches both layers and leaves the working tree in the state a person merging a real
 * PR would see.
 *
 * HERMETIC ANYWAY. Every repo here is a fresh `git init` in a temp dir; nothing pushes to or reads
 * from this repo's own remote. The generator + driver + hook scripts are copied byte-for-byte from
 * this repo (they are dependency-free — Node fs/path/url/child_process only, per their own house
 * rules — so a plain copy is enough to run the REAL regeneration logic without a real `src/` tree).
 *
 * THE REQUIRED ARMS (the item's list), plus the resilience/vacuity cases:
 *   (1) a genuine MAP.md conflict resolves with BOTH sides' new files present
 *   (2) a genuine BACKLOG_OPEN.md conflict resolves
 *   (3) a hand-authored MAP.md description present on only ONE side SURVIVES (B384432)
 *   (4) a regeneration failure leaves the conflict UNRESOLVED and exits non-zero (LOUD-FAILURE)
 *   (5) `.gitattributes` naming the driver with the local config NOT installed is DETECTED
 *   (6) a KNOWN-GOOD arm whose expected value does not depend on this driver's code at all —
 *       DRIVER-SCROLL-IS-NOT-APP-SCROLL clause 6 / the MUST_BE_PRESENT pattern: a run that
 *       exercises only the unknown arms is vacuous and must not just print a passing score.
 *   (7) the NECESSITY of the backstop hook: with the driver wired but the hook absent, the SAME
 *       merge that arm (1) resolves completely comes back missing a file — proving arm (1) is not
 *       passing by coincidence, and guarding against a future "simplification" that drops the hook.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, chmodSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { installMergeDriver, installHooks, HOOKS_DIR, REQUIRED_HOOKS } from "../scripts/install-hooks.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALL_CLI = join(REPO, "scripts", "install-hooks.mjs");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
/** Same operation, but a conflicted `git merge` exiting non-zero is the expected outcome, not a
 *  test-runner error — swallow it and let the caller inspect the resulting working tree instead. */
const softGit = (cwd, ...args) => { try { return git(cwd, ...args); } catch { return null; } };
const porcelain = (dir) => spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).stdout;

/* The real generator + driver + backstop scripts, copied verbatim into a scratch repo's own
 * scripts/ dir. They are dependency-free by house rule, so this is enough to run the REAL
 * regeneration logic without a real `src/` tree or the rest of this repo. */
const SCRIPT_FILES = ["merge-driver-ledgers.mjs", "post-merge-regen.mjs", "resolve-ledgers.mjs", "next-id.mjs", "idBlocks.mjs", "build-map.mjs", "build-backlog-index.mjs"];

function seedScripts(dir) {
  mkdirSync(join(dir, "scripts"), { recursive: true });
  for (const f of SCRIPT_FILES) copyFileSync(join(REPO, "scripts", f), join(dir, "scripts", f));
}

/** The real `.githooks/post-merge` plus a trivial `pre-push` stub — `installHooks` refuses to wire
 *  `core.hooksPath` at all unless every one of `REQUIRED_HOOKS` is present (B779's own
 *  "missing-hooks" guard), so both must exist even though these tests only care about the former. */
function seedHooks(dir) {
  mkdirSync(join(dir, HOOKS_DIR), { recursive: true });
  for (const h of REQUIRED_HOOKS) {
    if (h === "post-merge") copyFileSync(join(REPO, HOOKS_DIR, h), join(dir, HOOKS_DIR, h));
    else writeFileSync(join(dir, HOOKS_DIR, h), "#!/bin/sh\nexit 0\n");
    chmodSync(join(dir, HOOKS_DIR, h), 0o755);
  }
}

/** A fresh repo with scripts + `.gitattributes` + hooks seeded, and BOTH the merge driver AND the
 *  post-merge backstop wired via the real installers — exactly the state a real `npm install`
 *  leaves a clone in. */
function initRepo(dir, { withHooks = true } = {}) {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "merge-driver-e2e@planyr.test");
  git(dir, "config", "user.name", "Merge Driver E2E");
  seedScripts(dir);
  if (withHooks) seedHooks(dir);
  writeFileSync(join(dir, ".gitattributes"), "MAP.md merge=planyr-ledger\nBACKLOG_OPEN.md merge=planyr-ledger\n");
  writeFileSync(join(dir, ".gitignore"), ".planyr-ledger-merges.log\n"); // matches the real repo's own .gitignore
  return dir;
}

function commitAll(dir, message) {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
}

function writeSrcFile(dir, relPath, content) {
  mkdirSync(dirname(join(dir, relPath)), { recursive: true });
  writeFileSync(join(dir, relPath), content);
}

function generate(dir, script) {
  execFileSync(process.execPath, [join(dir, "scripts", script)], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
}

function insertAfter(dir, file, anchor, insertion) {
  const p = join(dir, file);
  const text = readFileSync(p, "utf8");
  const idx = text.indexOf(anchor);
  if (idx < 0) throw new Error(`fixture bug: anchor not found in ${file}: ${anchor.slice(0, 60)}`);
  const at = idx + anchor.length;
  writeFileSync(p, text.slice(0, at) + insertion + text.slice(at));
}

let ROOT;
beforeAll(() => { ROOT = mkdtempSync(join(tmpdir(), "merge-driver-e2e-")); });
afterAll(() => { if (ROOT) rmSync(ROOT, { recursive: true, force: true }); });

describe("(1)+(3) MAP.md — a genuine conflict, resolved, with the B384432 survival case", () => {
  let dir;
  beforeAll(() => {
    dir = initRepo(join(ROOT, "map-conflict"));
    writeSrcFile(dir, "src/old.js", "export function old() {}\n");
    generate(dir, "build-map.mjs");
    commitAll(dir, "base");
    installHooks(dir);        // the post-merge backstop
    installMergeDriver(dir);  // the merge driver itself — both are the REAL install path

    git(dir, "checkout", "-q", "-b", "adds-b");
    writeSrcFile(dir, "src/b.js", "export function b() {}\n");
    generate(dir, "build-map.mjs");
    // Hand-author b.js's description exactly as a real session does right after regenerating —
    // this is the description that must exist on ONLY this side of the merge.
    writeFileSync(join(dir, "MAP.md"), readFileSync(join(dir, "MAP.md"), "utf8")
      .replace("`src/b.js`** — TODO — describe", "`src/b.js`** — Branch B's own new helper."));
    commitAll(dir, "adds-b: new file, described");

    git(dir, "checkout", "-q", "main");
    git(dir, "checkout", "-q", "-b", "adds-c");
    writeSrcFile(dir, "src/c.js", "export function c() {}\n");
    generate(dir, "build-map.mjs");
    commitAll(dir, "adds-c: new file, left undescribed");

    git(dir, "checkout", "-q", "adds-b");
    softGit(dir, "merge", "-q", "--no-edit", "adds-c");
  });

  it("(1) merges cleanly — MAP.md is not left unmerged, and both sides' new files are present", () => {
    expect(porcelain(dir)).not.toMatch(/^UU MAP\.md$/m);
    const map = readFileSync(join(dir, "MAP.md"), "utf8");
    expect(map).toContain("`src/old.js`");
    expect(map).toContain("`src/b.js`");
    expect(map).toContain("`src/c.js`");
  });

  it("(3) the B384432 case: b.js's hand-authored description SURVIVES the merge", () => {
    const map = readFileSync(join(dir, "MAP.md"), "utf8");
    expect(map).toContain("Branch B's own new helper.");
    expect(map).not.toMatch(/`src\/b\.js`\*\* — TODO — describe/);
  });

  it("the backstop's correction is STAGED, ready to fold in — it cannot amend the merge commit itself " +
     "(git still reports \"in the middle of a merge\" inside the hook; see post-merge-regen.mjs)", () => {
    expect(porcelain(dir)).toMatch(/^M {2}MAP\.md$/m);
  });

  it("folding that staged correction in immediately afterward (an ordinary next step) leaves a fully clean merge", () => {
    // Mirrors what a real session naturally does next: `git merge` has already returned by this
    // point, so the merge-in-progress state is gone and `--amend` — refused from inside the hook
    // itself — now works fine.
    git(dir, "commit", "--amend", "--no-edit", "-q");
    expect(porcelain(dir)).toBe("");
    const map = readFileSync(join(dir, "MAP.md"), "utf8");
    expect(map).toContain("`src/c.js`");
  });

  it("proof the driver actually ran — a log line independent of the file's own text", () => {
    // The vacuity guard for this scenario specifically: without this, a coincidental git auto-
    // merge that happened to produce the right-looking MAP.md would pass the assertions above even
    // if the driver were never invoked at all.
    const log = readFileSync(join(dir, ".planyr-ledger-merges.log"), "utf8");
    expect(log).toMatch(/"outcome":"resolved"/);
    expect(log).toMatch(/"file":"MAP\.md"/);
  });
});

describe("(2) BACKLOG_OPEN.md — a genuine conflict from two independent backlog appends", () => {
  let dir;
  beforeAll(() => {
    dir = initRepo(join(ROOT, "backlog-conflict"));
    writeFileSync(join(dir, "BACKLOG.md"), [
      "# Backlog", "",
      "## 🔲 Open", "",
      "### B1 — base item alpha", "body line 1", "body line 2", "body line 3", "body line 4", "",
      "### B1b — base item beta", "body line 1", "body line 2", "body line 3", "body line 4", "",
      "## Later", "",
    ].join("\n"));
    generate(dir, "build-backlog-index.mjs");
    commitAll(dir, "base");
    installHooks(dir);
    installMergeDriver(dir);

    git(dir, "checkout", "-q", "-b", "backlog-x");
    insertAfter(dir, "BACKLOG.md",
      "### B1 — base item alpha\nbody line 1\nbody line 2\nbody line 3\nbody line 4\n",
      "\n### B2 — X's item\nX body\n");
    generate(dir, "build-backlog-index.mjs");
    commitAll(dir, "backlog-x: new item near the top of Open");

    git(dir, "checkout", "-q", "main");
    git(dir, "checkout", "-q", "-b", "backlog-y");
    insertAfter(dir, "BACKLOG.md",
      "### B1b — base item beta\nbody line 1\nbody line 2\nbody line 3\nbody line 4\n",
      "\n### B3 — Y's item\nY body\n");
    generate(dir, "build-backlog-index.mjs");
    commitAll(dir, "backlog-y: new item near the bottom of Open");

    git(dir, "checkout", "-q", "backlog-x");
    softGit(dir, "merge", "-q", "--no-edit", "backlog-y");
  });

  it("the fixture's own precondition: BACKLOG.md itself merges with NO conflict", () => {
    // The two inserts sit many lines apart (no custom driver on BACKLOG.md — plain git 3-way
    // merge applies there). If this ever conflicted too, the assertion below would be proving
    // something about THAT resolution rather than about the driver + backstop in isolation.
    expect(porcelain(dir)).not.toMatch(/^UU BACKLOG\.md$/m);
  });

  it("resolves the BACKLOG_OPEN.md conflict — both new items present", () => {
    expect(porcelain(dir)).not.toMatch(/^UU BACKLOG_OPEN\.md$/m);
    const idx = readFileSync(join(dir, "BACKLOG_OPEN.md"), "utf8");
    expect(idx).toContain("B2");
    expect(idx).toContain("B3");
  });
});

describe("(4) a regeneration failure leaves the conflict UNRESOLVED and non-zero — LOUD-FAILURE", () => {
  let dir;
  beforeAll(() => {
    dir = initRepo(join(ROOT, "regen-fails"));
    // Break the regenerator deliberately, standing in for any real failure inside build-map.mjs.
    writeFileSync(join(dir, "scripts", "build-map.mjs"), "#!/usr/bin/env node\nprocess.stderr.write('boom\\n');\nprocess.exit(1);\n");
    writeFileSync(join(dir, "MAP.md"), "# MAP.md\n\n## infra\n\n- **`src/old.js`** — old file\n  - _exports_: `old`\n\n");
    commitAll(dir, "base");
    installHooks(dir);
    installMergeDriver(dir);

    git(dir, "checkout", "-q", "-b", "x1");
    writeFileSync(join(dir, "MAP.md"), readFileSync(join(dir, "MAP.md"), "utf8") + "\n<!-- x1 edit -->\n");
    commitAll(dir, "x1 edits MAP.md");

    git(dir, "checkout", "-q", "main");
    git(dir, "checkout", "-q", "-b", "y1");
    writeFileSync(join(dir, "MAP.md"), readFileSync(join(dir, "MAP.md"), "utf8") + "\n<!-- y1 edit -->\n");
    commitAll(dir, "y1 edits MAP.md");

    git(dir, "checkout", "-q", "x1");
  });

  it("git merge fails, and MAP.md is left UNMERGED with ordinary conflict markers", () => {
    const r = spawnSync("git", ["merge", "-q", "--no-edit", "y1"], { cwd: dir, encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(porcelain(dir)).toMatch(/^UU MAP\.md$/m);
    const map = readFileSync(join(dir, "MAP.md"), "utf8");
    expect(map).toMatch(/^<<<<<<< ours$/m);
    expect(map).toMatch(/^=======$/m);
    expect(map).toMatch(/^>>>>>>> theirs$/m);
  });

  it("logs the failure outcome too, distinct from a resolved one", () => {
    const log = readFileSync(join(dir, ".planyr-ledger-merges.log"), "utf8");
    expect(log).toMatch(/"outcome":"failed"/);
    expect(log).toMatch(/"reason":"regenerating MAP\.md/);
  });
});

describe("(5) .gitattributes naming the driver with the local config NOT installed is DETECTED", () => {
  it("`install-hooks.mjs --check` reports the merge driver as NOT ARMED, by name", () => {
    const dir = join(ROOT, "unarmed");
    mkdirSync(dir, { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    writeFileSync(join(dir, ".gitattributes"), "MAP.md merge=planyr-ledger\nBACKLOG_OPEN.md merge=planyr-ledger\n");
    // Deliberately no `installMergeDriver(dir)` call — the local-config half is missing, which is
    // exactly the gap `.gitattributes` alone cannot close (git falls back to an ordinary merge
    // with no error at all when this happens for real).
    const r = spawnSync(process.execPath, [INSTALL_CLI, `--repo=${dir}`, "--check"], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/LEDGER MERGE DRIVER NOT ARMED/);
  });
});

describe("(6) KNOWN-GOOD ARM — an ordinary merge touching NEITHER generated file", () => {
  it("merges cleanly with zero conflicts — true regardless of whether this driver's code is correct", () => {
    // The vacuity guard the item asks for: this scenario's expected answer ("two unrelated new
    // files merge without incident") does not depend on merge-driver-ledgers.mjs at all. If the
    // harness itself were broken (wrong cwd, a bad git init, .gitattributes misapplied to every
    // path) this would fail too, which is what makes the arms above meaningful rather than vacuous.
    const dir = initRepo(join(ROOT, "known-good"));
    writeSrcFile(dir, "src/old.js", "export function old() {}\n");
    generate(dir, "build-map.mjs");
    commitAll(dir, "base");
    installHooks(dir);
    installMergeDriver(dir);

    git(dir, "checkout", "-q", "-b", "p");
    writeFileSync(join(dir, "README.md"), "p was here\n");
    commitAll(dir, "p: unrelated file");

    git(dir, "checkout", "-q", "main");
    git(dir, "checkout", "-q", "-b", "q");
    writeFileSync(join(dir, "NOTES.md"), "q was here\n");
    commitAll(dir, "q: another unrelated file");

    git(dir, "checkout", "-q", "p");
    const r = spawnSync("git", ["merge", "-q", "--no-edit", "q"], { cwd: dir, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(existsSync(join(dir, "README.md"))).toBe(true);
    expect(existsSync(join(dir, "NOTES.md"))).toBe(true);
  });
});

describe("(7) the backstop hook is NECESSARY, not decorative", () => {
  it("with the driver wired but post-merge ABSENT, the identical merge comes back missing a file", () => {
    // Same fixture shape as arm (1), minus the hook — proves arm (1) is not passing by
    // coincidence, and guards against a future change that drops the hook while leaving the
    // driver in place (a regression that would otherwise ship silently: no conflict is shown
    // either way, only the CONTENT differs).
    const dir = initRepo(join(ROOT, "no-backstop"), { withHooks: false });
    writeSrcFile(dir, "src/old.js", "export function old() {}\n");
    generate(dir, "build-map.mjs");
    commitAll(dir, "base");
    installMergeDriver(dir); // the driver only — no installHooks() call

    git(dir, "checkout", "-q", "-b", "adds-b");
    writeSrcFile(dir, "src/b.js", "export function b() {}\n");
    generate(dir, "build-map.mjs");
    commitAll(dir, "adds-b: new file");

    git(dir, "checkout", "-q", "main");
    git(dir, "checkout", "-q", "-b", "adds-c");
    writeSrcFile(dir, "src/c.js", "export function c() {}\n");
    generate(dir, "build-map.mjs");
    commitAll(dir, "adds-c: new file");

    git(dir, "checkout", "-q", "adds-b");
    softGit(dir, "merge", "-q", "--no-edit", "adds-c");

    expect(porcelain(dir)).not.toMatch(/^UU MAP\.md$/m); // still shows no conflict — that's the trap
    const map = readFileSync(join(dir, "MAP.md"), "utf8");
    expect(map).toContain("`src/b.js`");
    expect(map).not.toContain("`src/c.js`"); // "theirs"' file, invisible to the driver's mid-merge view
  });
});
