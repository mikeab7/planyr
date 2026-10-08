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
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  KINDS, LEDGER_DIR, parseLegacy, renderView, renderArchive, readLedgerDir, validateLedger, writeEntry,
  entryFileName, ledgerEnabled, byIdDesc, HEADING_RE,
} from "./lib/ledger.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const die = (m) => { console.error(m); process.exit(1); };
const norm = (t) => t.split("\n").filter((l) => l.trim() !== "" && l.trim() !== "---").join("\n");

/** Write BACKLOG.md / VERIFICATION.md from the ledger. Returns [{file, changed}]. */
export function renderViews(repo, { check = false } = {}) {
  const res = [];
  for (const kind of Object.keys(KINDS)) {
    const l = readLedgerDir(repo, kind);
    const text = renderView(kind, l.frame, l.entries);
    const file = join(repo, KINDS[kind].live);
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

function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === "check") {
    const p = validateLedger(REPO);
    if (p.length) die("ledger check FAILED:\n" + p.map((x) => "  • " + x).join("\n"));
    console.log("ledger check passed.");
  } else if (cmd === "render") {
    const r = renderViews(REPO, { check: rest.includes("--check") });
    if (rest.includes("--check") && r.some((x) => x.changed)) die("views are out of date: " + r.filter((x) => x.changed).map((x) => x.file).join(", "));
    console.log(r.map((x) => `${x.file}: ${x.changed ? "updated" : "unchanged"}`).join("\n"));
  } else if (cmd === "move") {
    if (rest.length !== 2) die("usage: move <ID> <state>");
    moveEntry(REPO, rest[0], rest[1]);
  } else if (cmd === "list") {
    const want = rest.find((x) => !x.startsWith("--"));
    for (const kind of Object.keys(KINDS)) {
      if (rest.includes("--b") && kind !== "backlog") continue;
      if (rest.includes("--v") && kind !== "verification") continue;
      const l = readLedgerDir(REPO, kind);
      for (const e of l.entries.filter((x) => !want || x.state === want).sort(byIdDesc)) console.log(`${e.state}\t${e.text.split("\n", 1)[0].slice(0, 160)}`);
    }
  } else if (cmd === "migrate") {
    if (ledgerEnabled(REPO)) die("ledger/ already exists");
    const texts = {};
    for (const k of Object.values(KINDS)) for (const f of [k.live, k.archive]) texts[f] = readFileSync(join(REPO, f), "utf8");
    console.log(JSON.stringify(migrate(REPO, texts), null, 1));
  } else if (cmd === "import-legacy") {
    if (rest.length !== 2) die("usage: import-legacy <base-ref> <tip-ref>");
    importLegacy(REPO, rest[0], rest[1]);
  } else die("usage: ledger.mjs check | render [--check] | move <ID> <state> | list [state] | import-legacy <base> <tip>");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main(process.argv.slice(2));
void HEADING_RE;
void renderArchive;
