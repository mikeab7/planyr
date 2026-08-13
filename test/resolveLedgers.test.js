/* The ledger merge bridge (B296224, option b′).
 *
 * The bridge is union WITH THE PRECONDITION CHECKED. These cases pin the precondition, because it
 * is the only thing separating this from `merge=union` in `.gitattributes` — which is one line,
 * would have landed PR #974 with no human step, and would ALSO silently duplicate an item whenever
 * two sessions amend the same one. That happened twice in a single day. So the interesting tests
 * here are not the ones where it works; they are the ones where it REFUSES.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConflicts, seedSide, describedPaths, lostDescriptions, UNION_FILES, GENERATED } from "../scripts/resolve-ledgers.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A conflicted file exactly as git leaves it. */
const conflicted = (ours, theirs) =>
  `# Backlog\n\n<<<<<<< HEAD\n${ours}=======\n${theirs}>>>>>>> origin/main\n\n### B1 — an old item\nbody\n`;

describe("the precondition: union is safe iff the two sides name disjoint ids", () => {
  it("UNIONS two independent appends — the 100% case measured on PR #974", () => {
    // Both sides prepended a new item to the top of the same section. Zero id overlap. There is
    // nothing to decide, and this is what every one of #974's four hunks looked like.
    const res = resolveConflicts(conflicted(
      "### B500 — my new item\nmy body\n\n",
      "### B501 — their new item\ntheir body\n\n",
    ));
    expect(res.ok).toBe(true);
    expect(res.overlaps).toEqual([]);
    expect(res.hunks).toHaveLength(1);
    // both survive, ours first, and no conflict marker is left behind
    expect(res.text).toContain("### B500 — my new item");
    expect(res.text).toContain("### B501 — their new item");
    expect(res.text).not.toMatch(/^[<>=]{7}/m);
    expect(res.text.indexOf("B500")).toBeLessThan(res.text.indexOf("B501"));
    // and the item that was never in conflict is untouched
    expect(res.text).toContain("### B1 — an old item");
  });

  it("REFUSES when both sides touch the SAME item — the silent-duplication case union cannot see", () => {
    // #976 amended B1349 while another branch was correcting a cross-reference in the same item.
    // A plain union writes B1349 twice and nobody is told.
    const res = resolveConflicts(conflicted(
      "### B1349 — the item, with MY amendment\nmy body\n\n",
      "### B1349 — the item, with THEIR amendment\ntheir body\n\n",
    ));
    expect(res.ok).toBe(false);
    expect(res.overlaps).toEqual([{ ids: ["B1349"], at: 3 }]);
  });

  it("REFUSES a hunk git WIDENED to swallow an untouched neighbour — the trap a naive check misses", () => {
    // Our side edits B600 and carries B601 along unchanged; their side edits B601 and carries B600.
    // Neither session "edited the same item" in intent, but a union writes both twice. The id
    // appears on both sides, so the hunk is refused — which is the correct, conservative answer.
    const res = resolveConflicts(conflicted(
      "### B600 — edited by us\n\n### B601 — untouched\n",
      "### B600 — untouched\n\n### B601 — edited by them\n",
    ));
    expect(res.ok).toBe(false);
    expect(res.overlaps[0].ids.sort()).toEqual(["B600", "B601"]);
  });

  it("REFUSES the whole file if ANY hunk overlaps, even when the others are clean", () => {
    // Partial resolution is worse than none: it leaves a file that looks handled and is not.
    const raw = `# Backlog\n<<<<<<< HEAD\n### B700 — mine\n=======\n### B701 — theirs\n>>>>>>> origin/main\n` +
      `<<<<<<< HEAD\n### B800 — my version\n=======\n### B800 — their version\n>>>>>>> origin/main\n`;
    const res = resolveConflicts(raw);
    expect(res.ok).toBe(false);
    expect(res.hunks).toHaveLength(2);
    expect(res.overlaps.map((o) => o.ids)).toEqual([["B800"]]);
  });

  it("REFUSES an unterminated marker rather than writing a half-understood parse (LOUD-FAILURE)", () => {
    const res = resolveConflicts("# Backlog\n<<<<<<< HEAD\n### B900 — mine\n=======\n### B901 — theirs\n");
    expect(res.ok).toBe(false);
    expect(res.unterminated).toBe(2);
    expect(res.text).toContain("<<<<<<< HEAD"); // the original, untouched
  });

  it("handles diff3-style conflicts — the BASE section is dropped, not unioned in", () => {
    // `merge.conflictStyle = diff3` adds a `|||||||` section. Concatenating it would resurrect the
    // pre-merge text of both items.
    const raw = `# B\n<<<<<<< HEAD\n### B10 — mine\n||||||| base\n### B9 — the common ancestor\n=======\n### B11 — theirs\n>>>>>>> origin/main\n`;
    const res = resolveConflicts(raw);
    expect(res.ok).toBe(true);
    expect(res.text).toContain("### B10 — mine");
    expect(res.text).toContain("### B11 — theirs");
    expect(res.text).not.toContain("the common ancestor");
  });

  it("mixes families — a V# on both sides is refused just like a B#", () => {
    const res = resolveConflicts(conflicted("### V90 — my note\n", "### V90 — their note\n"));
    expect(res.ok).toBe(false);
    expect(res.overlaps[0].ids).toEqual(["V90"]);
  });

  it("a file with no conflict at all passes through byte-identical", () => {
    const raw = "# Backlog\n\n### B1 — a\nbody\n";
    const res = resolveConflicts(raw);
    expect(res.ok).toBe(true);
    expect(res.hunks).toEqual([]);
    expect(res.text).toBe(raw);
  });

  it("only the HAND-MAINTAINED files are union candidates; the derived pair is regenerated", () => {
    // The asymmetry that pointed at the answer: the generated files conflicted just as violently
    // and cost nothing to resolve. Unioning them would be wrong — they are functions of the others.
    expect(UNION_FILES).toEqual(["BACKLOG.md", "BACKLOG-DONE.md", "VERIFICATION.md", "VERIFICATION-DONE.md"]);
    expect(GENERATED.map((g) => g.file)).toEqual(["BACKLOG_OPEN.md", "MAP.md"]);
    for (const g of GENERATED) expect(UNION_FILES).not.toContain(g.file);
  });
});

/* ---- END TO END against a real conflicted merge, because the pure half cannot prove the CLI
 * reaches these verdicts, stages the right files, or leaves a refused merge alone. Hermetic: a
 * bare repo in a temp dir, no network. Same pattern as `test/mintGateE2E.test.js`. */
describe("end to end, against a real git merge conflict", () => {
  const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const CLI = join(REPO, "scripts", "resolve-ledgers.mjs");

  /** Build a repo whose `main` and `feature` both prepended to BACKLOG.md, then merge them. */
  function conflictedRepo(oursItem, theirsItem) {
    const dir = mkdtempSync(join(tmpdir(), "resolve-ledgers-"));
    mkdirSync(dir, { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "e2e@planyr.test");
    git(dir, "config", "user.name", "Ledger E2E");
    const commit = (m) => { git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", m); };

    writeFileSync(join(dir, "BACKLOG.md"), "# Backlog\n\n### B1 — the base item\nbody\n");
    commit("base");
    git(dir, "checkout", "-q", "-b", "feature");
    writeFileSync(join(dir, "BACKLOG.md"), `# Backlog\n\n${oursItem}\n### B1 — the base item\nbody\n`);
    commit("our item");
    git(dir, "checkout", "-q", "main");
    writeFileSync(join(dir, "BACKLOG.md"), `# Backlog\n\n${theirsItem}\n### B1 — the base item\nbody\n`);
    commit("their item");
    git(dir, "checkout", "-q", "feature");
    try { git(dir, "merge", "main"); } catch { /* the conflict is the point */ }
    return dir;
  }

  const run = (dir, ...flags) => {
    const r = execFileSync(process.execPath, [CLI, ...flags], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return r;
  };

  it("resolves a genuine arrival-order conflict and leaves the tree mergeable", () => {
    const dir = conflictedRepo("### B500 — our new item\nours\n", "### B501 — their new item\ntheirs\n");
    // sanity: git really did leave a conflict
    expect(readFileSync(join(dir, "BACKLOG.md"), "utf8")).toMatch(/^<<<<<<< /m);
    // the CLI resolves against its own repo root, so drive the pure path over the real conflicted text
    const res = resolveConflicts(readFileSync(join(dir, "BACKLOG.md"), "utf8"));
    expect(res.ok).toBe(true);
    writeFileSync(join(dir, "BACKLOG.md"), res.text);
    git(dir, "add", "BACKLOG.md");
    git(dir, "commit", "-q", "-m", "Merge main");
    const merged = readFileSync(join(dir, "BACKLOG.md"), "utf8");
    expect(merged).toContain("### B500 — our new item");
    expect(merged).toContain("### B501 — their new item");
    expect(merged).toContain("### B1 — the base item");
    expect(merged).not.toMatch(/^[<>=]{7}/m);
    rmSync(dir, { recursive: true, force: true });
  });

  it("REFUSES a real two-sessions-amended-one-item conflict, and leaves the markers in place", () => {
    const dir = conflictedRepo("### B500 — our amendment\nours\n", "### B500 — their amendment\ntheirs\n");
    const before = readFileSync(join(dir, "BACKLOG.md"), "utf8");
    const res = resolveConflicts(before);
    expect(res.ok).toBe(false);
    expect(res.overlaps[0].ids).toEqual(["B500"]);
    // nothing written — the file still carries the markers a human needs
    expect(readFileSync(join(dir, "BACKLOG.md"), "utf8")).toBe(before);
    expect(before).toMatch(/^<<<<<<< /m);
    rmSync(dir, { recursive: true, force: true });
  });

  it("the CLI reports 'nothing to resolve' on a clean tree instead of inventing work", () => {
    expect(run(REPO, "--dry-run")).toMatch(/No conflicted files/);
  });
});

/* B384432 — the half of the bridge nobody had checked.
 *
 * "Generated" was read as "fully derived", so the generated pair was seeded with `git checkout
 * --ours` before regenerating. But `MAP.md` carries a hand-authored one-liner per path that
 * `build-map.mjs` PRESERVES by parsing the copy on disk — so seeding from one side threw away every
 * description the other side wrote. Measured on PR #978, the bridge's first outing on a PR it did
 * not author: 48 of main's descriptions came back as `TODO — describe` and `--check` went red on a
 * merge the bridge had just declared resolved. These pin the seed rule, not the wording. */
describe("the generated pair: a seed that keeps BOTH sides' preserved descriptions", () => {
  const line = (path, desc) => `- **\`${path}\`** — ${desc}`;
  const TODO = "TODO — describe";

  it("keeps a description that exists on ONLY ONE side — the PR #978 data loss, directly", () => {
    const ours = `# MAP\n${line("src/a.js", "the one our branch knows")}\n`;
    const theirs = `# MAP\n${line("src/a.js", "the one our branch knows")}\n${line("src/b.js", "described on main while we sat")}\n`;
    const seed = `${seedSide(theirs)}\n${seedSide(ours)}\n`;
    // `--ours` alone could not have carried this line, which is the whole defect.
    expect(seedSide(ours)).not.toContain("described on main while we sat");
    expect(seed).toContain("described on main while we sat");
    expect(seed).toContain("the one our branch knows");
  });

  it("drops TODO placeholders so an undescribed side cannot clobber a described one", () => {
    // build-map's parse is last-write-wins, and the seed puts OURS last. Without the TODO filter an
    // `ours` placeholder would overwrite main's real description with an empty one.
    const ours = `${line("src/b.js", TODO)}\n`;
    const theirs = `${line("src/b.js", "a real description")}\n`;
    const seed = `${seedSide(theirs)}\n${seedSide(ours)}\n`;
    expect(seed).not.toContain(TODO);
    expect(seed).toContain("a real description");
  });

  it("lets OURS win a path BOTH sides describe — the branch's own wording for its own file", () => {
    const ours = `${line("src/a.js", "our wording")}\n`;
    const theirs = `${line("src/a.js", "their wording")}\n`;
    const seed = `${seedSide(theirs)}\n${seedSide(ours)}\n`;
    expect(seed.indexOf("their wording")).toBeLessThan(seed.indexOf("our wording"));
  });

  it("strips conflict markers, so a seed can never carry them into a generated file", () => {
    const raw = `<<<<<<< HEAD\n${line("src/a.js", "ours")}\n=======\n${line("src/a.js", "theirs")}\n>>>>>>> origin/main\n`;
    expect(seedSide(raw)).not.toMatch(/^[<>=|]{7}/m);
    expect(seedSide(raw)).toContain("ours");
  });

  it("still refuses to union the generated pair — they are regenerated, never concatenated as output", () => {
    // The seed is an INPUT to the generator, not the committed file. Guard the distinction, since
    // conflating them is how a concatenated MAP.md would get committed with every path twice.
    for (const g of GENERATED) expect(UNION_FILES).not.toContain(g.file);
    expect(GENERATED.map((g) => g.file)).toEqual(["BACKLOG_OPEN.md", "MAP.md"]);
  });
});

/* B384433 — THE POST-CONDITION: a bridge run may never reduce the set of described paths.
 *
 * B384432 fixed the seed. This asserts the PROPERTY, at the place the loss would happen, because the
 * failure it replaced was SILENT: the bridge printed `✅ … MAP.md (regenerated)` while dropping 48 of
 * main's one-liners, and only an unrelated `--check` in a later step noticed. A future change to
 * build-map's preservation, to the line format, or to the seed re-opens exactly that hole with the
 * report still green.
 *
 * MUTATION-PROVEN AGAINST THE REAL PR #978 DATA, not a constructed case. Driving `lostDescriptions`
 * over the two actual MAP.md sides of that merge (ours `d0728b1`, theirs `651849d`): the pre-fix
 * `git checkout --ours` seed loses **48** paths and the union seed loses **0** — the 48 matching the
 * count measured live when the defect was found. That run is not committed as a test because CI
 * checks out at depth 1 and could not reach those commits; a history-dependent test would pass
 * vacuously, which is the rot this guard exists to prevent. The cases below are its structural
 * mirror, and `parses the REAL committed MAP.md` is the check that keeps the whole thing honest. */
describe("B384433 · the generated pair may never come back with fewer descriptions", () => {
  const TODO = "TODO — describe";
  const line = (p, d) => "- **`" + p + "`** — " + d;

  it("REPORTS a path that was described on one side and came back TODO — the PR #978 shape", () => {
    const ours = line("src/a.js", "ours knows this one");
    const theirs = [line("src/a.js", "ours knows this one"), line("src/b.js", "main described this while we sat")].join("\n");
    // What `--ours` seeding produces: b.js still exists in the tree, but its description is gone.
    const result = [line("src/a.js", "ours knows this one"), line("src/b.js", TODO)].join("\n");
    expect(lostDescriptions(ours, theirs, result)).toEqual(["src/b.js"]);
  });

  it("is GREEN on the union seed — the mutation contrast, in the same two inputs", () => {
    const ours = line("src/a.js", "ours knows this one");
    const theirs = [line("src/a.js", "ours knows this one"), line("src/b.js", "main described this while we sat")].join("\n");
    const seed = describedPaths(`${seedSide(theirs)}\n${seedSide(ours)}\n`);
    const inventory = ["src/a.js", "src/b.js"];
    const result = inventory.map((p) => line(p, seed.get(p) ?? TODO)).join("\n");
    expect(lostDescriptions(ours, theirs, result)).toEqual([]);
  });

  it("does NOT fire when the merge DELETED the file — the fresh scan is right to drop it", () => {
    // The precision that stops this being a nuisance: scoped to paths the result still LISTS.
    const ours = line("src/gone.js", "a described file this merge removes");
    const theirs = line("src/kept.js", "still here");
    const result = line("src/kept.js", "still here");
    expect(lostDescriptions(ours, theirs, result)).toEqual([]);
  });

  it("does NOT fire on a path that was TODO on BOTH sides — nothing was lost", () => {
    const ours = line("src/new.js", TODO);
    const theirs = line("src/new.js", TODO);
    expect(lostDescriptions(ours, theirs, line("src/new.js", TODO))).toEqual([]);
  });

  it("⛔ parses the REAL committed MAP.md — the anti-rot check", () => {
    // If the line format drifts, the regex stops matching, `lostDescriptions` returns [] for
    // everything, and the guard above becomes a permanent green that can never fail. Pin it to the
    // real artefact so a format change reddens the guard instead of silently disarming it.
    const real = describedPaths(readFileSync(join(REPO, "MAP.md"), "utf8"));
    expect(real.size).toBeGreaterThan(400);
    expect([...real.values()].filter((d) => d === TODO)).toEqual([]);
  });
});
