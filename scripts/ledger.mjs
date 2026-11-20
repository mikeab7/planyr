#!/usr/bin/env node
/*
 * scripts/ledger.mjs — everyday tool for the one-file-per-entry backlog/verification ledger (NEW-1).
 * Layout and rationale: scripts/lib/ledger.mjs. Rules for sessions: CLAUDE.md "LEDGER" section.
 *
 *   node scripts/ledger.mjs check                     validate ledger/ (CI gate)
 *   node scripts/ledger.mjs render [--check]          (re)write BACKLOG.md + VERIFICATION.md views
 *   node scripts/ledger.mjs move <ID> <state>         e.g. move B123 verify · move V9 done (renames the file)
 *   node scripts/ledger.mjs list [state] [--b|--v]    one heading per entry (cheap orientation)
 *   node scripts/ledger.mjs migrate                   ONE-TIME: old 4-file layout → ledger/ (already run)
 *   node scripts/ledger.mjs import-legacy <base> <tip> bring a branch that edited the OLD files forward:
 *                                                     diffs the old files between two refs and replays the
 *                                                     entry changes onto the ledger/ tree in the working dir
 *
 * THE LEDGER LIVES ON ITS OWN BRANCH (`ledger`, NEW-1 2026-11-05) — records need no pull request and no build.
 * A code clone keeps a shallow checkout in `.ledger/`. Every command below fetches it as needed.
 *
 *   READ   list [state] [--b|--v] · show <ID> · status · check · render          (add --fresh to force a fetch)
 *   WRITE  add <backlog|verification> [--state S] (--file F | --stdin) [-m MSG]    mint the id + file the entry, ONE push
 *          mint [--b N] [--v N] [--label L]                                        reserve ids as stub entries
 *          put <ID> --file F          replace an entry's text            move <ID> <state> [--file F]
 *          push [-m MSG]              land hand-edits made inside .ledger/       inbox       file ledger/inbox/*
 *          sync                       fetch the branch into .ledger/
 *   OPS    init-branch · import-delta <base> <tip> · forward-main --base B --tip T · record-check [--range A..B | --since D]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  KINDS, LEDGER_DIR, LEDGER_BRANCH, LEDGER_CHECKOUT, parseLegacy, renderView, renderArchive, readLedgerDir, validateLedger, writeEntry,
  entryFileName, ledgerEnabled, ledgerRoot, byIdDesc, HEADING_RE,
} from "./lib/ledger.mjs";
import {
  LedgerError, git, syncCheckout, checkoutDir, remoteOf, ledgerTx, addEntry, mintIds, moveEntry as moveEntryTx, putEntry,
  pushPending, importDelta, allIds, INBOX_DIR, ensureLedger,
} from "./lib/ledgerBranch.mjs";
import { extractIds, recordVerdict, formatVerdict } from "./lib/recordCheck.mjs";

// PLANYR_LEDGER_REPO: act on another checkout (the end-to-end tests drive this CLI against throwaway clones).
const REPO = process.env.PLANYR_LEDGER_REPO ? resolve(process.env.PLANYR_LEDGER_REPO) : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const die = (m) => { console.error(m); process.exit(1); };
const norm = (t) => t.split("\n").filter((l) => l.trim() !== "" && l.trim() !== "---").join("\n");

/** Write BACKLOG.md / VERIFICATION.md from the ledger. Returns [{file, changed}]. */
export function renderViews(repo, { check = false } = {}) {
  const res = [];
  for (const kind of Object.keys(KINDS)) {
    const l = readLedgerDir(repo, kind);
    const text = renderView(kind, l.frame, l.entries);
    const file = join(ledgerRoot(repo) ?? repo, KINDS[kind].live);
    const before = existsSync(file) ? readFileSync(file, "utf8") : null;
    res.push({ file: KINDS[kind].live, changed: before !== text });
    if (!check && before !== text) writeFileSync(file, text);
  }
  return res;
}

/** Old four-file layout (as texts) → ledger tree. Verifies it lost nothing before writing. */
export function migrate(repo, texts) {
  const report = [];
  for (const kind of Object.keys(KINDS)) {
    const k = KINDS[kind];
    const live = parseLegacy(texts[k.live], kind);
    const arch = parseLegacy(texts[k.archive], kind, { archive: true });
    // ---- losslessness: re-assemble each file in ORIGINAL order from frame + entries
    for (const [name, parsed, src] of [[k.live, live, texts[k.live]], [k.archive, arch, texts[k.archive]]]) {
      const queue = parsed.entries.slice();
      const out = [];
      for (const fl of parsed.frameLines) {
        const m = fl.match(/^<!-- ledger:entries (\S+) -->$/);
        if (!m) { out.push(fl); continue; }
        while (queue.length && queue[0].state === m[1]) out.push(queue.shift().text);
      }
      let want = src.replace(/\n$/, "");
      if (name === k.archive) {
        // the archive's frame is only batch labels ("## Archived 2026-06-21 …"); drop exactly those lines from the source
        out.length = 0;
        for (const e of queue.splice(0)) out.push(e.text);
        const labels = parsed.frameLines.filter((l) => l.trim() && l.trim() !== "---");
        const ls = want.split("\n"); let j = 0;
        want = ls.filter((l) => !(j < labels.length && l === labels[j] && ++j)).join("\n");
      }
      if (queue.length) throw new Error(`${name}: ${queue.length} entries not placed by a marker`);
      if (norm(out.join("\n")) !== norm(want)) {
        const a = norm(out.join("\n")).split("\n"), b = norm(want).split("\n");
        const i = a.findIndex((x, j) => x !== b[j]);
        throw new Error(`${name}: reassembly differs at normalized line ${i}: ${JSON.stringify(a[i])} vs ${JSON.stringify(b[i])}`);
      }
    }
    // ---- write: archive entries first, then live entries; a dup id inside one folder gets .2 .3
    const counts = new Map();
    const all = [...live.entries, ...arch.entries];
    let n = 0;
    for (const e of all) {
      const key = `${e.state}/${e.id}`;
      const dup = (counts.get(key) || 0) + 1;
      counts.set(key, dup);
      writeEntry(repo, kind, e.state, e.id, e.text, dup);
      n++;
    }
    const frame = live.frameLines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
    mkdirSync(join(repo, LEDGER_DIR, kind), { recursive: true });
    writeFileSync(join(repo, LEDGER_DIR, kind, "_frame.md"), frame);
    report.push({ kind, written: n, live: live.entries.length, archived: arch.entries.length });
  }
  return report;
}

function moveEntry(repo, id, state) {
  const kind = id[0] === "B" ? "backlog" : id[0] === "V" ? "verification" : null;
  if (!kind) die(`not an id: ${id}`);
  const k = KINDS[kind];
  if (!k.states.includes(state)) die(`${kind} states: ${k.states.join(", ")}`);
  const l = readLedgerDir(repo, kind);
  const hits = l.entries.filter((e) => e.id === id);
  if (!hits.length) die(`${id} not found in ledger/${kind}`);
  const live = hits.filter((e) => e.state !== state);
  if (hits.length > 1 && live.length !== 1) die(`${id} is ambiguous (${hits.map((h) => h.file).join(", ")}) — move the file by hand`);
  const src = live[0] || hits[0];
  if (src.state === state) return console.log(`${id} already in ${state}`);
  let dup = 1;
  while (existsSync(join(repo, LEDGER_DIR, kind, state, entryFileName(id, dup)))) dup++;
  mkdirSync(join(repo, LEDGER_DIR, kind, state), { recursive: true });
  const dest = join(LEDGER_DIR, kind, state, entryFileName(id, dup));
  try { execFileSync("git", ["mv", src.file, dest], { cwd: repo, stdio: "ignore" }); }
  catch { renameSync(join(repo, src.file), join(repo, dest)); }
  console.log(`${src.file} → ${dest}`);
}

/** Replay the old-file edits made between two refs onto the ledger tree in the working dir. */
function importLegacy(repo, base, tip) {
  const show = (ref, f) => { try { return execFileSync("git", ["show", `${ref}:${f}`], { cwd: repo, encoding: "utf8", maxBuffer: 1 << 29 }); } catch { return null; } };
  const summary = [];
  for (const kind of Object.keys(KINDS)) {
    const k = KINDS[kind];
    const side = (ref) => {
      const m = new Map();
      for (const [f, archive] of [[k.live, false], [k.archive, true]]) {
        const t = show(ref, f);
        if (t == null) continue;
        for (const e of parseLegacy(t, kind, { archive }).entries) {
          const arr = m.get(e.id) || [];
          arr.push(e);
          m.set(e.id, arr);
        }
      }
      return m;
    };
    const A = side(base), B = side(tip);
    const l = readLedgerDir(repo, kind);
    for (const [id, tips] of B) {
      const was = A.get(id) || [];
      const wasText = new Map(was.map((e) => [e.text, e]));
      for (const e of tips) {
        const prev = wasText.get(e.text);
        if (prev && prev.state === e.state) continue; // untouched
        const sameState = l.entries.find((x) => x.id === id && x.state === e.state);
        const elsewhere = l.entries.filter((x) => x.id === id && x.state !== e.state);
        if (!was.length) { // a new entry
          if (sameState || elsewhere.length) { summary.push(`!! ${id}: already exists on main — renumber yours`); continue; }
          summary.push("+ " + writeEntry(repo, kind, e.state, id, e.text));
        } else { // changed text and/or moved
          const old = was.find((w) => w.state !== e.state) && was[0];
          for (const x of elsewhere.concat(sameState ? [sameState] : [])) { if (x.state !== e.state) rmSync(join(repo, x.file)); }
          summary.push("~ " + writeEntry(repo, kind, e.state, id, e.text));
          void old;
        }
      }
    }
  }
  console.log(summary.join("\n") || "no entry changes found");
}

/* ------------------------------------------------------------------------------------------ *
 * Branch-mode plumbing.
 * ------------------------------------------------------------------------------------------ */
const ensureReadable = (repo, o) => ensureLedger(repo, o);

const flag = (rest, name) => { const i = rest.indexOf(name); return i < 0 ? null : rest[i + 1]; };
const readInput = (rest) => {
  if (rest.includes("--stdin")) return readFileSync(0, "utf8");
  const f = flag(rest, "--file");
  if (!f) die("give the entry text with --file <path> or --stdin");
  return readFileSync(resolve(f), "utf8");
};
const retryNote = (e) => console.error(`  ↻ lost a race on the ledger branch (attempt ${e.attempt}) — re-reading the new tip and trying again…`);

/** init-branch: ONE-TIME. Build the `ledger` branch from <ref>'s `ledger/` tree, parented on <ref> so every
 *  entry keeps its full git history (`git log -- ledger/backlog/done/B123.md`), and push it. */
function initBranch(repo, rest) {
  const ref = flag(rest, "--from") || "origin/main";
  const remote = remoteOf(repo, flag(rest, "--remote"));
  const tree = git(repo, ["rev-parse", `${ref}:${LEDGER_DIR}`]).stdout.trim();
  const sha = git(repo, ["rev-parse", ref]).stdout.trim();
  const readme = [
    "# The Planyr ledger branch",
    "",
    "This branch holds the BACKLOG and VERIFICATION records — one file per entry under `ledger/<kind>/<state>/<ID>.md`.",
    "It has **no required checks and no pull requests**: a session commits records straight here.",
    "",
    "- Read:  `npm run ledger -- list open`  (from a code clone of `main`; it checks this branch out into `.ledger/`)",
    "- Write: `npm run ledger -- add|move|put|mint|push …`  — never hand-edit and push; the commands fetch, retry on a lost race, and mint ids atomically.",
    "- Rules: see the LEDGER section of `CLAUDE.md` on `main`.",
    "",
    `Created ${new Date().toISOString().slice(0, 10)} from main@${sha.slice(0, 10)} (history of every entry is preserved: this commit's parent is that main commit).`,
    "",
  ].join("\n");
  const blob = git(repo, ["hash-object", "-w", "--stdin"], { input: readme }).stdout.trim();
  const root = git(repo, ["mktree"], { input: `100644 blob ${blob}\tREADME.md\n040000 tree ${tree}\t${LEDGER_DIR}\n` }).stdout.trim();
  const env = { GIT_AUTHOR_NAME: "planyr-ledger", GIT_AUTHOR_EMAIL: "ledger@planyr.invalid", GIT_COMMITTER_NAME: "planyr-ledger", GIT_COMMITTER_EMAIL: "ledger@planyr.invalid" };
  const commit = git(repo, ["commit-tree", root, "-p", sha, "-m", `ledger: create the ledger branch from ${ref}@${sha.slice(0, 10)} (NEW-1)\n\nOnly ledger/ is kept in the tree; history is main's, so per-entry history is intact.`], { env }).stdout.trim();
  if (rest.includes("--dry")) return console.log(`would push ${commit} (tree ${root}) to ${remote} refs/heads/${LEDGER_BRANCH}`);
  const p = git(repo, ["push", remote, `${commit}:refs/heads/${LEDGER_BRANCH}`], { check: false });
  if (p.status !== 0 && !/new branch/.test(p.stderr || "")) die(`push failed: ${p.stderr || p.stdout}`);
  console.log(`ledger branch created at ${commit.slice(0, 10)} (from ${ref}@${sha.slice(0, 10)})`);
}

function recordCheck(repo, rest) {
  ensureReadable(repo, { fresh: true });
  const range = flag(rest, "--range");
  const since = flag(rest, "--since");
  const args = ["log", "--format=%H%x09%s"];
  if (range) args.push(range); else if (since) args.push(`--since=${since}`, "HEAD"); else args.push("-30", "HEAD");
  const rows = git(repo, args, { check: false }).stdout.split("\n").filter(Boolean).map((l) => { const [sha, ...r] = l.split("\t"); return { sha, subject: r.join("\t") }; });
  const ids = allIds(ledgerRoot(repo));
  const v = recordVerdict(rows, ids);
  const out = formatVerdict(v, { github: !!process.env.GITHUB_ACTIONS });
  console.log(out);
  if (process.env.GITHUB_STEP_SUMMARY) { try { writeFileSync(process.env.GITHUB_STEP_SUMMARY, out + "\n", { flag: "a" }); } catch { /* summary is best-effort */ } }
  if (v.missing.length && rest.includes("--strict")) process.exitCode = 1;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const fresh = rest.includes("--fresh");
  try {
    runCommand(cmd, rest, fresh);
  } catch (e) {
    if (e instanceof LedgerError) die(`ledger: ${e.message}`);
    throw e;
  }
}

function runCommand(cmd, rest, fresh) {
  const inTree = existsSync(join(REPO, LEDGER_DIR, "backlog", "_frame.md"));
  if (cmd === "check") {
    ensureReadable(REPO, { fresh });
    const p = validateLedger(REPO);
    if (p.length) die("ledger check FAILED:\n" + p.map((x) => "  • " + x).join("\n"));
    console.log("ledger check passed.");
  } else if (cmd === "render") {
    ensureReadable(REPO, { fresh });
    const r = renderViews(REPO, { check: rest.includes("--check") });
    if (rest.includes("--check") && r.some((x) => x.changed)) die("views are out of date: " + r.filter((x) => x.changed).map((x) => x.file).join(", "));
    console.log(r.map((x) => `${x.file}: ${x.changed ? "updated" : "unchanged"}`).join("\n"));
  } else if (cmd === "move") {
    const positional = rest.filter((x, i) => !x.startsWith("-") && rest[i - 1] !== "--file" && rest[i - 1] !== "-m");
    if (positional.length !== 2) die("usage: move <ID> <state> [--file entry.md] [-m message]");
    if (inTree) return moveEntry(REPO, positional[0], positional[1]);
    const text = flag(rest, "--file") ? readFileSync(resolve(flag(rest, "--file")), "utf8") : undefined;
    const r = moveEntryTx(REPO, positional[0], positional[1], { text, message: flag(rest, "-m") || undefined, onRetry: retryNote });
    console.log(r.result.unchanged ? `${positional[0]} already in ${positional[1]}` : `${r.result.from} → ${r.result.to}`);
    console.log(r.pushed ? `landed on ${LEDGER_BRANCH}@${r.sha.slice(0, 10)}` : "nothing to push");
  } else if (cmd === "list") {
    ensureReadable(REPO, { fresh });
    const want = rest.find((x) => !x.startsWith("--"));
    for (const kind of Object.keys(KINDS)) {
      if (rest.includes("--b") && kind !== "backlog") continue;
      if (rest.includes("--v") && kind !== "verification") continue;
      const l = readLedgerDir(REPO, kind);
      for (const e of l.entries.filter((x) => !want || x.state === want).sort(byIdDesc)) console.log(`${e.state}\t${e.text.split("\n", 1)[0].slice(0, 160)}`);
    }
  } else if (cmd === "show") {
    ensureReadable(REPO, { fresh });
    const id = rest.find((x) => /^[BV]\d+$/.test(x));
    if (!id) die("usage: show <B123|V45>");
    const kind = id[0] === "B" ? "backlog" : "verification";
    const hits = readLedgerDir(REPO, kind).entries.filter((e) => e.id === id);
    if (!hits.length) die(`${id} not found`);
    for (const h of hits) console.log(`# ${h.file}\n${h.text}\n`);
  } else if (cmd === "status") {
    const co = checkoutDir(REPO);
    if (inTree) return console.log("ledger: in-tree layout (this directory holds ledger/ itself)");
    if (!existsSync(join(co, ".git"))) return console.log("ledger: no checkout yet — run: npm run ledger -- sync");
    const sha = git(co, ["rev-parse", "--short", "HEAD"]).stdout.trim();
    const dirty = git(co, ["status", "--porcelain"]).stdout.trim().split("\n").filter(Boolean);
    console.log(`ledger: ${LEDGER_CHECKOUT}/ at ${LEDGER_BRANCH}@${sha}${dirty.length ? ` · ${dirty.length} unpushed edit(s) — run: npm run ledger -- push` : " · clean"}`);
  } else if (cmd === "sync") {
    const r = syncCheckout(REPO);
    const inbox = existsSync(join(r.dir, INBOX_DIR)) ? readdirSync(join(r.dir, INBOX_DIR)).filter((f) => f.endsWith(".md") && f !== "README.md").length : 0;
    console.log(`ledger synced: ${LEDGER_CHECKOUT}/ at ${LEDGER_BRANCH}@${r.sha.slice(0, 10)}${r.stale ? " (STALE — fetch failed: " + r.error + ")" : ""}${inbox ? ` · ${inbox} inbox file(s) waiting — run: npm run ledger -- inbox` : ""}`);
  } else if (cmd === "add") {
    const kind = rest.find((x) => KINDS[x]);
    if (!kind) die("usage: add <backlog|verification> [--state S] (--file F | --stdin) [-m MSG]");
    const r = addEntry(REPO, { kind, state: flag(rest, "--state") || undefined, text: readInput(rest), message: flag(rest, "-m") || undefined, onRetry: retryNote });
    console.log(`${r.result.id}\t${r.result.file}`);
    console.error(`landed on ${LEDGER_BRANCH}@${r.sha.slice(0, 10)}${r.attempt > 1 ? ` after ${r.attempt} attempts` : ""} — no PR needed.`);
  } else if (cmd === "mint") {
    const b = Number(flag(rest, "--b") || 0), v = Number(flag(rest, "--v") || 0);
    if (!b && !v) die("usage: mint [--b N] [--v N] [--label text]");
    const r = mintIds(REPO, { b, v, label: flag(rest, "--label") || "", onRetry: retryNote });
    console.log([...r.result.B, ...r.result.V].join("\n"));
    console.error(`reserved on ${LEDGER_BRANCH}@${r.sha.slice(0, 10)} — fill each in with: npm run ledger -- put <ID> --file entry.md`);
  } else if (cmd === "put") {
    const id = rest.find((x) => /^[BV]\d+$/.test(x));
    if (!id) die("usage: put <ID> --file F | --stdin");
    const r = putEntry(REPO, id, readInput(rest), { message: flag(rest, "-m") || undefined, onRetry: retryNote });
    console.log(r.pushed ? `${id} updated on ${LEDGER_BRANCH}@${r.sha.slice(0, 10)}` : `${id} unchanged`);
  } else if (cmd === "push") {
    const r = pushPending(REPO, { message: flag(rest, "-m") || "ledger update" });
    console.log(`landed on ${LEDGER_BRANCH}@${r.sha.slice(0, 10)}`);
  } else if (cmd === "inbox") {
    const r = ledgerTx(REPO, (dir, ctx) => ctx.inboxFiled, { message: "ledger: file inbox", onRetry: retryNote });
    console.log(r.result.length ? r.result.map((x) => `${x.from} → ${x.id}`).join("\n") : "inbox empty");
  } else if (cmd === "init-branch") {
    initBranch(REPO, rest);
  } else if (cmd === "import-delta" || cmd === "forward-main") {
    // import-delta <base> <tip>: replay a code branch's ledger/ edits onto the ledger branch.
    const base = cmd === "forward-main" ? flag(rest, "--base") : rest[0];
    const tip = cmd === "forward-main" ? flag(rest, "--tip") : rest[1];
    if (!base || !tip) die(cmd === "forward-main" ? "usage: forward-main --base <sha> --tip <sha>" : "usage: import-delta <base-ref> <tip-ref>");
    let report;
    const r = ledgerTx(REPO, (dir) => (report = importDelta(REPO, base, tip, dir)), { message: `ledger: forward ledger/ edits from ${tip.slice(0, 10)} (${cmd})`, onRetry: retryNote });
    console.log(JSON.stringify(report.added.length + report.modified.length + report.removed.length + report.renumbered.length + report.conflicts.length ? report : { nothing: true, skipped: report.skipped.length }, null, 1));
    console.error(r.pushed ? `landed on ${LEDGER_BRANCH}@${r.sha.slice(0, 10)}` : "nothing to land");
    if (report.conflicts.length) process.exitCode = 3;
  } else if (cmd === "record-check") {
    recordCheck(REPO, rest);
  } else if (cmd === "migrate") {
    if (ledgerEnabled(REPO)) die("ledger/ already exists");
    const texts = {};
    for (const k of Object.values(KINDS)) for (const f of [k.live, k.archive]) texts[f] = readFileSync(join(REPO, f), "utf8");
    console.log(JSON.stringify(migrate(REPO, texts), null, 1));
  } else if (cmd === "import-legacy") {
    if (rest.length !== 2) die("usage: import-legacy <base-ref> <tip-ref>");
    importLegacy(REPO, rest[0], rest[1]);
  } else die("usage: ledger.mjs list|show|status|sync|check|render|add|mint|put|move|push|inbox|record-check|init-branch|import-delta|forward-main  (see the header of scripts/ledger.mjs)");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
void HEADING_RE;
void renderArchive;
