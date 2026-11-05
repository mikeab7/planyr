/*
 * test/ledgerBranch.test.js — the acceptance test for moving the ledger onto its own branch (NEW-1, 2026-11-05).
 *
 * WHAT IT PROVES, against REAL git refs in throwaway repos with a local bare "origin" (hermetic — no network):
 *   1. two parallel writers to the ledger branch BOTH land, each with a UNIQUE id (the headline requirement) —
 *      first with real child processes racing, then with a deterministic LOST RACE (writer B's push is refused
 *      "fetch first" because writer A landed between B's read and B's push; B redoes from the new tip);
 *   2. a verification can be flipped to done on the ledger branch with no PR, and read back from a FRESH clone;
 *   3. a writer with no shell can drop a file in ledger/inbox/ and get a real id from the next writer;
 *   4. a code branch's `ledger/` edits (the cut-over / a straggler PR) are imported without losing an entry.
 *
 * RED ON THE OLD MAIN: `scripts/lib/ledgerBranch.mjs` and the `add`/`mint`/`inbox` commands do not exist there.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { addEntryTo, addEntry, moveEntry, putEntry, mintIds, ledgerTx, syncCheckout, maxIds, allIds, importDelta, LedgerError, git } from "../scripts/lib/ledgerBranch.mjs";
import { readLedgerDir, ledgerRoot } from "../scripts/lib/ledger.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FIXTURE = join(REPO, "test", "fixtures", "ledger-mini");
const noSleep = () => {};
const ID = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

let root, remote;

/** A bare origin whose `ledger` branch holds the fixture ledger (+ a main branch with some code). */
function makeRemote() {
  const bare = join(root, "origin.git");
  const seed = join(root, "seed");
  spawnSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  mkdirSync(seed);
  git(seed, ["init", "-q", "-b", "main"]);
  writeFileSync(join(seed, "code.txt"), "code\n");
  git(seed, ["add", "."]); git(seed, ["commit", "-qm", "code"], { env: ID });
  git(seed, ["checkout", "-q", "-b", "ledger"]);
  git(seed, ["rm", "-rq", "code.txt"]);
  cpSync(join(FIXTURE, "ledger"), join(seed, "ledger"), { recursive: true });
  git(seed, ["add", "-A"]); git(seed, ["commit", "-qm", "ledger"], { env: ID });
  git(seed, ["push", "-q", bare, "main", "ledger"]);
  return bare;
}

/** A "code clone" of origin (what a Claude Code session has): its own .ledger/ will be created on first use. */
function codeClone(name) {
  const dir = join(root, name);
  git(root, ["clone", "-q", "--branch", "main", remote, dir]);
  return dir;
}
const CLI = join(REPO, "scripts", "ledger.mjs");
const cli = (repo, args, input) => spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, ...ID, PLANYR_LEDGER_REPO: repo }, cwd: repo, input, encoding: "utf8" });
const remoteFiles = (p) => git(root, ["ls-tree", "-r", "--name-only", `ledger`, "--", p], { env: { GIT_DIR: remote } }).stdout.split("\n").filter(Boolean);
const ENTRY = (t) => `### B? — ${t}\n- Verify: sandbox\n`;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ledger-branch-")); remote = makeRemote(); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("ledger branch — reads", () => {
  it("a cold clone reads the ledger through ledgerRoot() after one sync", () => {
    const a = codeClone("a");
    expect(ledgerRoot(a)).toBeNull();
    const r = syncCheckout(a);
    expect(r.fetched).toBe(true);
    expect(ledgerRoot(a)).toBe(join(a, ".ledger"));
    expect(readLedgerDir(a, "backlog").entries.map((e) => e.id).sort()).toEqual(["B100", "B80", "B90"]);
    expect(maxIds(r.dir)).toEqual({ B: 100, V: 50 });
  });
});

describe("ledger branch — writers", () => {
  it("add mints the next id and lands with no PR", () => {
    const a = codeClone("a");
    const r = addEntry(a, { kind: "backlog", text: ENTRY("first") , sleep: noSleep });
    expect(r.result.id).toBe("B101");
    expect(r.pushed).toBe(true);
    expect(remoteFiles("ledger/backlog/open")).toContain("ledger/backlog/open/B101.md");
    expect(readFileSync(join(a, ".ledger", r.result.file), "utf8")).toMatch(/^### B101 — first/);
  });

  it("LOST RACE: writer B's push is refused, B redoes from the new tip and gets a DIFFERENT id", () => {
    const a = codeClone("a"), b = codeClone("b");
    syncCheckout(a); syncCheckout(b);
    let aLanded;
    const retries = [];
    const rb = ledgerTx(b, (dir, ctx) => {
      // Between B reading the tip and B pushing, A lands an entry (so B's first push is a non-fast-forward).
      if (ctx.attempt === 1) aLanded = addEntry(a, { kind: "backlog", text: ENTRY("from A"), sleep: noSleep });
      return addEntryInTx(dir);
    }, { message: "b add", sleep: noSleep, onRetry: (e) => retries.push(e) });
    expect(aLanded.result.id).toBe("B101");
    expect(rb.attempt).toBe(2);                       // it lost once and retried
    expect(retries[0].rejected).toBe(true);
    expect(rb.result.id).toBe("B102");                // recomputed against A's entry, not the stale B101
    const files = remoteFiles("ledger/backlog/open");
    expect(files).toEqual(expect.arrayContaining(["ledger/backlog/open/B101.md", "ledger/backlog/open/B102.md", "ledger/backlog/open/B100.md"]));
    // both writers' text survived
    const fresh = codeClone("fresh"); syncCheckout(fresh);
    const texts = readLedgerDir(fresh, "backlog").entries.map((e) => e.text);
    expect(texts.some((t) => t.includes("from A"))).toBe(true);
    expect(texts.some((t) => t.includes("from B"))).toBe(true);
  });

  it("PARALLEL PROCESSES: N concurrent `ledger add` runs on N separate clones all land with unique ids", async () => {
    const N = 6;
    const clones = Array.from({ length: N }, (_, i) => codeClone(`c${i}`));
    const run = (repo, i) => new Promise((res) => {
      const p = spawn(process.execPath, [CLI, "add", "backlog", "--stdin"], { env: { ...process.env, ...ID, PLANYR_LEDGER_REPO: repo }, cwd: repo });
      let out = "", err = "";
      p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d));
      p.on("close", (code) => res({ code, out: out.trim(), err }));
      p.stdin.end(ENTRY(`parallel ${i}`));
    });
    const results = await Promise.all(clones.map(run));
    for (const r of results) expect(r.code, r.err).toBe(0);
    const ids = results.map((r) => r.out.split("\t")[0]);
    expect(new Set(ids).size).toBe(N);                                   // unique
    const onRemote = remoteFiles("ledger/backlog/open").map((f) => f.split("/").pop().replace(".md", ""));
    for (const id of ids) expect(onRemote).toContain(id);                // and every one landed
    expect(Math.min(...ids.map((i) => Number(i.slice(1))))).toBeGreaterThan(100);
  }, 120000);

  it("mint reserves stub ids; put replaces the stub's text", () => {
    const a = codeClone("a");
    const m = mintIds(a, { b: 2, v: 1, label: "test", sleep: noSleep });
    expect(m.result.B).toEqual(["B101", "B102"]);
    expect(m.result.V).toEqual(["V51"]);
    putEntry(a, "B101", "### B101 — now real\n- Verify: sandbox\n", { sleep: noSleep });
    const fresh = codeClone("f"); syncCheckout(fresh);
    expect(readFileSync(join(fresh, ".ledger/ledger/backlog/open/B101.md"), "utf8")).toMatch(/now real/);
  });

  it("E2E: mint → add → flip a verification to done with NO PR → read it back from a fresh clone", () => {
    const a = codeClone("a");
    const add = cli(a, ["add", "verification", "--stdin"], "### V? — live check of the thing\n1. Do X. Expected: Y.\n");
    expect(add.status, add.stderr).toBe(0);
    const vid = add.stdout.split("\t")[0];
    expect(vid).toBe("V51");
    const mv = cli(a, ["move", vid, "done", "--file", writeTmp("### V51 — live check of the thing\nPASSED 2026-11-05 on abc1234.\n")]);
    expect(mv.status, mv.stderr).toBe(0);
    const fresh = codeClone("fresh");
    const ls = cli(fresh, ["list", "done", "--v"]);
    expect(ls.status, ls.stderr).toBe(0);
    expect(ls.stdout).toMatch(/done\t### V51 — live check of the thing/);
    expect(cli(fresh, ["show", "V51"]).stdout).toMatch(/PASSED 2026-11-05/);
    expect(remoteFiles("ledger/verification/pending")).not.toContain("ledger/verification/pending/V51.md");
  });

  it("refuses an invalid entry (heading/file mismatch) and a duplicate real id, and lands nothing", () => {
    const a = codeClone("a");
    expect(() => addEntry(a, { kind: "backlog", text: "no heading here\n", sleep: noSleep })).toThrow(LedgerError);
    expect(() => addEntry(a, { kind: "backlog", text: "### B100 — dup\n", sleep: noSleep })).toThrow(/already exists/);
    expect(() => addEntry(a, { kind: "backlog", text: "### V7 — wrong letter\n", sleep: noSleep })).toThrow(/must start with B/);
    expect(remoteFiles("ledger/backlog/open")).toEqual(["ledger/backlog/open/B100.md"]);
  });

  it("move between states keeps exactly one file for the id", () => {
    const a = codeClone("a");
    moveEntry(a, "B100", "verify", { sleep: noSleep });
    expect(remoteFiles("ledger/backlog/open")).toEqual([]);
    expect(remoteFiles("ledger/backlog/verify")).toEqual(expect.arrayContaining(["ledger/backlog/verify/B100.md"]));
  });
});

describe("ledger branch — inbox (a writer with no shell)", () => {
  it("a file dropped in ledger/inbox/ is given a real id and filed by the next writer", () => {
    // simulate a chat creating the file straight on the branch through a connector
    const chat = join(root, "chat");
    git(root, ["clone", "-q", "--branch", "ledger", remote, chat]);
    mkdirSync(join(chat, "ledger/inbox"), { recursive: true });
    writeFileSync(join(chat, "ledger/inbox/backlog-chat-note.md"), "### B? — filed by a chat with no shell #ui\n- Verify: sandbox\n");
    writeFileSync(join(chat, "ledger/inbox/verification-live-pass.md"), "state: pending\n### V? — chat live pass\n1. step. Expected: ok.\n");
    git(chat, ["add", "-A"]); git(chat, ["commit", "-qm", "chat inbox"], { env: ID }); git(chat, ["push", "-q", "origin", "ledger"]);
    const a = codeClone("a");
    const r = addEntry(a, { kind: "backlog", text: ENTRY("writer"), sleep: noSleep });
    expect(r.result.id).toBe("B102");                      // the inbox backlog note took B101 first
    const fresh = codeClone("f"); syncCheckout(fresh);
    expect([...allIds(join(fresh, ".ledger"))]).toEqual(expect.arrayContaining(["B101", "B102", "V51"]));
    expect(existsSync(join(fresh, ".ledger/ledger/inbox/backlog-chat-note.md"))).toBe(false);
  });
});

describe("ledger branch — importDelta (cut-over and straggler PRs)", () => {
  it("a MOVE of an entry the ledger has since changed is reported, never renumbered; a non-overlapping edit 3-way merges", () => {
    const code = join(root, "code3");
    mkdirSync(code);
    git(code, ["init", "-q", "-b", "main"]);
    cpSync(join(FIXTURE, "ledger"), join(code, "ledger"), { recursive: true });
    writeFileSync(join(code, "ledger/verification/pending/V50.md"), "### V50 — fixture pending check\nline one\nline two\nline three\n");
    git(code, ["add", "-A"]); git(code, ["commit", "-qm", "base"], { env: ID });
    const base = git(code, ["rev-parse", "HEAD"]).stdout.trim();
    // the PR: recurrence (done B80 → verify with new text) and edits line three of V50
    git(code, ["mv", "ledger/backlog/done/B80.md", "ledger/backlog/verify/B80.md"]);
    writeFileSync(join(code, "ledger/backlog/verify/B80.md"), "### B80 (×2) — fixture done item #ui\nrecurrence text from the PR\n");
    writeFileSync(join(code, "ledger/verification/pending/V50.md"), "### V50 — fixture pending check\nline one\nline two\nline three EDITED BY PR\n");
    git(code, ["add", "-A"]); git(code, ["commit", "-qm", "pr"], { env: ID });
    const tip = git(code, ["rev-parse", "HEAD"]).stdout.trim();
    const a = codeClone("a");
    putEntry(a, "B80", "### B80 — fixture done item #ui\nthe ledger already moved on\n", { sleep: noSleep });          // the ledger changed B80 after the PR branched
    // seed V50 on the ledger with the base text, then edit line one there (a different line from the PR's)
    putEntry(a, "V50", "### V50 — fixture pending check\nline one\nline two\nline three\n", { sleep: noSleep });
    putEntry(a, "V50", "### V50 — fixture pending check\nline one EDITED ON LEDGER\nline two\nline three\n", { sleep: noSleep });
    let rep;
    ledgerTx(a, (dir) => (rep = importDelta(code, base, tip, dir)), { sleep: noSleep });
    expect(rep.renumbered).toEqual([]);
    expect(rep.conflicts.join("\n")).toMatch(/B80\.md.*NOT applied/);
    expect(rep.modified.join()).toMatch(/V50\.md.*3-way merged/);
    const fresh = codeClone("f"); syncCheckout(fresh);
    const v50 = readFileSync(join(fresh, ".ledger/ledger/verification/pending/V50.md"), "utf8");
    expect(v50).toMatch(/line one EDITED ON LEDGER/); expect(v50).toMatch(/line three EDITED BY PR/);
    expect(readLedgerDir(fresh, "backlog").entries.filter((e) => e.id === "B80")).toHaveLength(1);
  });

  it("NEVER forwards a bare deletion — deleting ledger/ from main (the cut-over itself) must not erase the ledger", () => {
    const code = join(root, "code2");
    mkdirSync(code);
    git(code, ["init", "-q", "-b", "main"]);
    cpSync(join(FIXTURE, "ledger"), join(code, "ledger"), { recursive: true });
    git(code, ["add", "-A"]); git(code, ["commit", "-qm", "base"], { env: ID });
    const base = git(code, ["rev-parse", "HEAD"]).stdout.trim();
    git(code, ["rm", "-rq", "ledger"]); git(code, ["commit", "-qm", "cut-over: ledger/ leaves main"], { env: ID });
    const tip = git(code, ["rev-parse", "HEAD"]).stdout.trim();
    const a = codeClone("a");
    let rep;
    const r = ledgerTx(a, (dir) => (rep = importDelta(code, base, tip, dir)), { sleep: noSleep });
    expect(r.pushed).toBe(false);                         // nothing changed, nothing committed
    expect(rep.removed).toEqual([]);
    expect(rep.skipped.length).toBeGreaterThan(0);
    const fresh = codeClone("f"); syncCheckout(fresh);
    expect(readLedgerDir(fresh, "backlog").entries).toHaveLength(3);
    expect(readLedgerDir(fresh, "verification").entries).toHaveLength(2);
  });

  function codeRepoWithLedger() {
    const d = join(root, "code");
    mkdirSync(d);
    git(d, ["init", "-q", "-b", "main"]);
    cpSync(join(FIXTURE, "ledger"), join(d, "ledger"), { recursive: true });
    git(d, ["add", "-A"]); git(d, ["commit", "-qm", "base"], { env: ID });
    return d;
  }
  it("applies adds, edits and moves; renumbers a colliding new id; reports a diverged edit instead of overwriting", () => {
    const code = codeRepoWithLedger();
    const base = git(code, ["rev-parse", "HEAD"]).stdout.trim();
    writeFileSync(join(code, "ledger/backlog/open/B500.md"), "### B500 — new from PR\nbody\n");              // new, free id
    writeFileSync(join(code, "ledger/backlog/open/B101.md"), "### B101 — collides with a ledger id\nbody\n");   // new id the ledger will already hold
    git(code, ["mv", "ledger/backlog/verify/B90.md", "ledger/backlog/done/B90.md"]);                            // a move
    writeFileSync(join(code, "ledger/verification/pending/V50.md"), "### V50 — fixture pending check\nEDITED BY PR\n"); // an edit
    git(code, ["add", "-A"]); git(code, ["commit", "-qm", "pr"], { env: ID });
    const tip = git(code, ["rev-parse", "HEAD"]).stdout.trim();

    const a = codeClone("a");
    // the live ledger already took B101 for a different entry, and someone else edited V50
    addEntry(a, { kind: "backlog", text: ENTRY("ledger's own B101"), sleep: noSleep });
    putEntry(a, "V50", "### V50 — fixture pending check\nEDITED ON THE LEDGER\n", { sleep: noSleep });
    let rep;
    ledgerTx(a, (dir) => (rep = importDelta(code, base, tip, dir)), { sleep: noSleep });
    expect(rep.added).toEqual(expect.arrayContaining(["ledger/backlog/open/B500.md", "ledger/backlog/done/B90.md"]));
    expect(rep.removed).toContain("ledger/backlog/verify/B90.md");
    expect(rep.renumbered).toHaveLength(1);
    expect(rep.renumbered[0].from).toBe("B101");
    expect(rep.conflicts.join()).toMatch(/V50\.md.*changed on the ledger since/);
    const fresh = codeClone("f"); syncCheckout(fresh);
    const all = readLedgerDir(fresh, "backlog").entries;
    expect(all.filter((e) => e.id === "B101")).toHaveLength(1);                                         // the ledger's own B101 is untouched
    expect(all.some((e) => e.text.includes("collides with a ledger id"))).toBe(true);                    // and the PR's entry survived under a new number
    expect(readFileSync(join(fresh, ".ledger/ledger/verification/pending/V50.md"), "utf8")).toMatch(/EDITED ON THE LEDGER/);
  });
});

function addEntryInTx(dir) {
  // inline use of the same primitive the CLI uses, so the test drives ledgerTx directly
  return addEntryTo(dir, { kind: "backlog", state: undefined, text: ENTRY("from B") });
}
function writeTmp(text) { const f = join(root, `t-${Math.random().toString(36).slice(2)}.md`); writeFileSync(f, text); return f; }
