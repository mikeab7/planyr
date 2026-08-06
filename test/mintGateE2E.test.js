/* The mint gate END TO END, against REAL git refs (NEW-2).
 *
 * WHY THIS EXISTS. As shipped, the gate (B779 second pass, PR #864) had been exercised live
 * exactly ONCE — on its own push — and that item was a DEDUPE-FIRST recurrence, so it minted
 * nothing and there was nothing to block. `test/mintGuard.test.js` pins the pure verdict, and
 * `test/nextId.test.js` pins the git READER's edge cases against this repo, but NO REAL PUSH HAD
 * EVER BEEN REJECTED: the composed path — fetch, peer mirror, merge base, "added ids", verdict,
 * exit code — had never run against a genuine collision. V531 parked that question as "watch the
 * field and see", i.e. wait for an organic collision to find out whether the thing that catches
 * collisions works. This area has now failed twice after being declared fixed, so waiting is the
 * wrong verification strategy.
 *
 * WHAT IS NEW HERE, and nothing else (AUDIT-FIRST): the END-TO-END PATH AGAINST REAL REFS. The
 * verdict table is already covered and is not re-tested; what these cases add is that the real
 * `runGate` REACHES those verdicts from real branches, and that the CLI maps them to the right
 * exit codes and wording.
 *
 * HERMETIC ANYWAY. "The remote" is a bare repo in a temp dir and every fetch is over the local
 * filesystem — no network, no live GitHub, no dependence on this repo's own branch state. So it
 * runs inside the ordinary required build, where a regression fails the PR that caused it.
 *
 * THE FIVE OUTCOMES (the item's list), plus the resilience case:
 *   (a) an id already taken on origin/main          → REJECTED, exit 1, names main
 *   (b) an id held only by an IN-FLIGHT PEER branch → REJECTED, exit 1, names the branch
 *   (c) a clean mint above everyone                  → ALLOWED, exit 0
 *   (d) a RECURRENCE, minting nothing                → ALLOWED, exit 0, untouched
 *   (e) infrastructure failure (dead remote/no ref)  → UNVERIFIABLE: exit 2 locally (strict),
 *                                                      exit 0 + loud warning under `--ci`
 * (e) is the one that must NEVER fail the build: a guard that becomes an outage is worse than the
 * collision it prevents.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runGate } from "../scripts/check-mint.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO, "scripts", "check-mint.mjs");

/* ---- a throwaway world: one bare "origin", plus clones we can branch and push ------------- */

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** The four id files, so a scratch repo has the same shape the gate reads in the real one. */
function writeBacklog(dir, { open = [], done = [], vOpen = [], vDone = [] }) {
  const head = (l, ids) => ids.map((n) => `### ${l}${n} — scratch item\n[ ] a body line\n`).join("\n");
  writeFileSync(join(dir, "BACKLOG.md"), `# Backlog\n\n${head("B", open)}`);
  writeFileSync(join(dir, "BACKLOG-DONE.md"), `# Archive\n\n${head("B", done)}`);
  writeFileSync(join(dir, "VERIFICATION.md"), `# Verify\n\n${head("V", vOpen)}`);
  writeFileSync(join(dir, "VERIFICATION-DONE.md"), `# Verified\n\n${head("V", vDone)}`);
}

function commitAll(dir, message) {
  git(dir, "add", "-A");
  // `--allow-empty`: one case deliberately changes no id file at all, and "nothing to commit" is
  // an error, not a result.
  git(dir, "-c", "user.email=e2e@planyr.test", "-c", "user.name=Mint Gate E2E", "commit", "-q", "--allow-empty", "-m", message);
}

/** Clone `origin` and give the clone an identity, so commits work on a bare CI runner. */
function clone(origin, dest) {
  // stderr piped, not inherited: cloning the still-empty bare origin prints a harmless
  // "you appear to have cloned an empty repository" that would otherwise litter the test run.
  execFileSync("git", ["clone", "-q", origin, dest], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git(dest, "config", "user.email", "e2e@planyr.test");
  git(dest, "config", "user.name", "Mint Gate E2E");
  return dest;
}

let ROOT, ORIGIN;

beforeAll(() => {
  ROOT = mkdtempSync(join(tmpdir(), "mint-gate-e2e-"));
  ORIGIN = join(ROOT, "origin.git");
  mkdirSync(ORIGIN);
  git(ORIGIN, "init", "--bare", "-q", "-b", "main");

  // main at the BASE every branch below forks from: ids up to B100 / V50, plus one ARCHIVED item
  // (B50) for the recurrence case to re-open.
  const seed = clone(ORIGIN, join(ROOT, "seed"));
  writeBacklog(seed, { open: [99, 100], done: [50], vOpen: [50], vDone: [10] });
  commitAll(seed, "base");
  git(seed, "push", "-q", "origin", "main");

  // A PEER session, still in flight (pushed, unmerged): it has claimed B103 / V53. Nothing on main
  // knows those numbers exist — this is the whole window the first pass was blind to.
  git(seed, "checkout", "-q", "-b", "peer-session");
  writeBacklog(seed, { open: [99, 100, 103], done: [50], vOpen: [50, 53], vDone: [10] });
  commitAll(seed, "peer claims B103 / V53");
  git(seed, "push", "-q", "origin", "peer-session");

  // Then main MOVES ON while our branches are in flight: another PR merges, taking B102 / V52.
  // This is the B1140 case — the number was free when we minted it and is not free now.
  git(seed, "checkout", "-q", "main");
  writeBacklog(seed, { open: [99, 100, 102], done: [50], vOpen: [50, 52], vDone: [10] });
  commitAll(seed, "main merges an item taking B102 / V52");
  git(seed, "push", "-q", "origin", "main");
});

afterAll(() => { if (ROOT) rmSync(ROOT, { recursive: true, force: true }); });

/**
 * A work clone branched from the merge base (main BEFORE it took B102), carrying whatever this
 * branch's BACKLOG files say. Branching from the base is what makes the (a) case real: main's new
 * id is invisible from here, exactly as it is to a session that branched an hour ago.
 */
function workBranch(name, files) {
  const dir = clone(ORIGIN, join(ROOT, name));
  git(dir, "checkout", "-q", "-b", name, "origin/main~1"); // the base, before main took B102
  writeBacklog(dir, files);
  commitAll(dir, `${name} work`);
  return dir;
}

/** Run the real CLI against a scratch repo. Returns { code, out, err }. */
function cli(repo, ...flags) {
  const r = spawnSync(process.execPath, [CLI, `--repo=${repo}`, ...flags], { encoding: "utf8" });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

const offendersOf = (res, letter) => res.families.find((f) => f.letter === letter).offenders;
/** HARD failures vs ADVISORY notes are now different lists (B36051) — assert against the right one. */
const warningsOf = (res, letter) => res.families.find((f) => f.letter === letter).warnings || [];

/* ------------------------------------------------------------------------------------------ */

describe("the mint gate BLOCKS a real push (the path that had never once fired)", () => {
  it("(a) REJECTS an id main took while this branch was in flight, and names origin/main", () => {
    // We minted B102 against a main that did not have it. Main has since merged its own B102.
    const repo = workBranch("takes-b102", { open: [99, 100, 102], done: [50], vOpen: [50], vDone: [10] });
    const res = runGate(repo);
    expect(res.unverifiable, res.reason).toBeFalsy();
    expect(res.ok).toBe(false);
    expect(offendersOf(res, "B")).toEqual([{ id: "B102", kind: "taken", where: "origin/main" }]);

    const { code, err } = cli(repo);
    expect(code).toBe(1);
    expect(err).toMatch(/MINT GATE FAILED/);
    expect(err).toMatch(/B102 is ALREADY TAKEN on origin\/main/);
    // The advice now points at THIS BRANCH'S RESERVED BLOCK rather than a shared "next" number
    // (B36051). That is the fix, not a cosmetic change: "start at max+1" is the instruction that
    // ratcheted the mark B3,010 → B200,119 in an hour, because every rejected session followed it.
    // A block is derived from main's max alone, so following this advice cannot move anyone else.
    expect(err).toMatch(/renumber this branch's new B# ids into its reserved block: B\d+–B\d+/);
    expect(err).toMatch(/This is a REAL collision/);
  });

  /* ⛔ THE TWO CASES BELOW USED TO BE REJECTIONS AND ARE NOW WARNINGS (B36051, owner decision
   * 2026-08-06). They are kept, inverted, rather than deleted — the point is not that the gate got
   * quieter, it is that these two were never collisions, and failing them deadlocked the repo:
   * seven PRs open, the claimed mark ratcheting B3,010 → B200,119 in an hour as each rejected
   * session re-minted higher, main not moving once in ninety minutes, and two branches
   * independently landing on B100002 — the very defect the rule exists to prevent. */
  it("WARNS (never fails) on an id held only by an UNMERGED PEER branch — that branch has taken nothing yet", () => {
    // B103 / V53 exist nowhere on main. They sit on another session's pushed branch, which may be
    // renumbered, rebased or abandoned before it ever merges. Whoever merges SECOND renumbers.
    const repo = workBranch("collides-with-peer", { open: [99, 100, 103], done: [50], vOpen: [50, 53], vDone: [10] });
    const res = runGate(repo);
    expect(res.unverifiable, res.reason).toBeFalsy();
    expect(res.ok).toBe(true);
    expect(res.peersScanned).toBeGreaterThanOrEqual(1);
    expect(offendersOf(res, "B")).toEqual([]); // nothing HARD

    const b = warningsOf(res, "B").find((w) => w.id === "B103");
    expect(b.kind).toBe("peer-taken");
    expect(b.where).toMatch(/peer-session$/); // still NAMES the session, because it is worth knowing
    expect(warningsOf(res, "V").some((w) => w.id === "V53")).toBe(true); // both families still checked

    const { code, out } = cli(repo);
    expect(code).toBe(0);
    expect(out).toMatch(/advisory — these do NOT fail the build/);
    expect(out).toMatch(/B103 is also held by .*peer-session/);
  });

  it("WARNS (never fails) on an id that is free today but sits UNDER the claimed high-water mark", () => {
    // B101 is free on main AND on every peer — nobody holds it. The old gate failed it anyway, on a
    // GUESS that it had been minted against a stale view. That guess is what had no convergent
    // strategy under contention, and the id it rejected was demonstrably unique.
    const repo = workBranch("below-the-mark", { open: [99, 100, 101], done: [50], vOpen: [50], vDone: [10] });
    const res = runGate(repo);
    expect(res.ok).toBe(true);
    expect(offendersOf(res, "B")).toEqual([]);
    expect(warningsOf(res, "B")[0]).toMatchObject({ id: "B101", kind: "below" });

    const { code, out } = cli(repo);
    expect(code).toBe(0);
    expect(out).toMatch(/B101 sits at or below the claimed high-water mark B103/);
    expect(out).toMatch(/Free on main, so it ships/);
  });
});

describe("the mint gate LETS THROUGH what it should (a gate that cries wolf gets bypassed)", () => {
  it("(c) ALLOWS a clean mint above main AND above every in-flight peer", () => {
    const repo = workBranch("clean-mint", { open: [99, 100, 104], done: [50], vOpen: [50, 54], vDone: [10] });
    const res = runGate(repo);
    expect(res.unverifiable, res.reason).toBeFalsy();
    expect(res.ok).toBe(true);

    const { code, out } = cli(repo);
    expect(code).toBe(0);
    expect(out).toMatch(/✅ Mint gate: B104, V54 are not taken on origin\/main/);
    expect(out).toMatch(/in-flight branches/);
  });

  it("GAPS ARE FREE — jumping well past the mark is a legal mint, not a violation", () => {
    // B1140 established that leaving a gap beats a second renumber pass. A gate demanding max+1
    // would have rejected the very fix that broke that loop.
    const repo = workBranch("gapped-mint", { open: [99, 100, 150], done: [50], vOpen: [50, 60], vDone: [10] });
    expect(runGate(repo).ok).toBe(true);
  });

  it("(d) ALLOWS a RECURRENCE — re-opening an archived item mints nothing and is untouched", () => {
    // DEDUPE-FIRST: a repeat report re-opens the ORIGINAL id. B50's heading moves from the archive
    // back into the live file. Because "added" is measured over the UNION of the pair, nothing was
    // added — so the correct response to a repeat report never meets gate friction.
    const repo = workBranch("recurrence", { open: [99, 100, 50], done: [], vOpen: [50], vDone: [10] });
    const res = runGate(repo);
    expect(res.unverifiable, res.reason).toBeFalsy();
    expect(res.ok).toBe(true);
    expect(res.families.find((f) => f.letter === "B").added).toEqual([]); // nothing minted

    const { code, out } = cli(repo);
    expect(code).toBe(0);
    expect(out).toMatch(/no new ids/);
  });

  it("a branch that touches no id file at all is clean and cheap", () => {
    const repo = workBranch("code-only", { open: [99, 100], done: [50], vOpen: [50], vDone: [10] });
    writeFileSync(join(repo, "src-ish.txt"), "a code change\n");
    commitAll(repo, "code only");
    expect(runGate(repo).ok).toBe(true);
  });
});

describe("resilience — an infrastructure failure WARNS, it never wedges merges", () => {
  it("(e) reports UNVERIFIABLE rather than a verdict when origin/main cannot be read", () => {
    const repo = workBranch("no-origin-main", { open: [99, 100, 104], done: [50], vOpen: [50], vDone: [10] });
    git(repo, "update-ref", "-d", "refs/remotes/origin/main");
    const res = runGate(repo, { fetch: false }); // no fetch to restore it — the ref is simply gone
    expect(res.unverifiable).toBe(true);
    expect(res.reason).toMatch(/origin\/main/);
    expect(res.ok).toBeFalsy();
  });

  it("(e) an unreachable remote is UNVERIFIABLE — exit 2 strict, exit 0 + a LOUD warning under --ci", () => {
    const repo = workBranch("dead-remote", { open: [99, 100, 104], done: [50], vOpen: [50], vDone: [10] });
    git(repo, "remote", "set-url", "origin", join(ROOT, "definitely-not-a-repo"));

    const strict = cli(repo);
    expect(strict.code).toBe(2); // local push: stop, the gate could not prove anything
    expect(strict.err).toMatch(/⛔ MINT GATE UNVERIFIED/);

    const ci = cli(repo, "--ci");
    expect(ci.code).toBe(0); // CI: a runner hiccup must not block every merge in the repo
    expect(ci.err).toMatch(/⚠ MINT GATE UNVERIFIED/);
    expect(ci.err).toMatch(/UNGUARDED/); // ...but it says so, loudly — B898's rule
  });

  it("a STALE origin/main refuses instead of quietly grading against a week-old ref", () => {
    // The original defect: `--against-main` read the locally cached ref and trusted it. With the
    // freshness limit dialled to zero, a fetch that happened "a moment ago" is already too old —
    // proving the refusal is wired into the gate itself, not just into next-id's banner.
    const repo = workBranch("stale-ref", { open: [99, 100, 104], done: [50], vOpen: [50], vDone: [10] });
    const res = runGate(repo, { fetch: false, maxAgeSeconds: -1 });
    expect(res.unverifiable).toBe(true);
    expect(res.reason).toMatch(/freshness limit|never fetched/);
  });
});

describe("the gate leaves the clone exactly as it found it", () => {
  it("does not repoint HEAD, add remotes, or leave the peer mirror shallow", () => {
    const repo = workBranch("no-side-effects", { open: [99, 100, 104], done: [50], vOpen: [50], vDone: [10] });
    const before = {
      head: git(repo, "rev-parse", "HEAD").trim(),
      branch: git(repo, "rev-parse", "--abbrev-ref", "HEAD").trim(),
      shallow: git(repo, "rev-parse", "--is-shallow-repository").trim(),
      base: git(repo, "merge-base", "refs/remotes/origin/main", "HEAD").trim(),
    };
    runGate(repo);
    expect(git(repo, "rev-parse", "HEAD").trim()).toBe(before.head);
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe(before.branch);
    expect(git(repo, "rev-parse", "--is-shallow-repository").trim()).toBe(before.shallow);
    // the merge base still resolves — the peer mirror must not graft our own tip and sever it
    expect(git(repo, "merge-base", "refs/remotes/origin/main", "HEAD").trim()).toBe(before.base);
  });
});
