#!/usr/bin/env node
/*
 * mark-shared-ids.mjs — the REPAIR half of B308704. Idempotent, additive, and re-runnable.
 *
 * 31 ids inherited from before the reserved-block fix name two different items inside a single
 * ledger file (24 B in docs/archive/BACKLOG-DONE.md, 7 V in docs/archive/VERIFICATION-DONE.md, every one below B6864). This
 * script stamps each colliding heading with a `> ⚠ SHARED ID` line naming its twin.
 *
 * ⛔ WHY MARK IN PLACE RATHER THAN RENUMBER, which was a real fork in the road and not a shrug.
 * Prose across this repo says "see B239". For a colliding id NOBODY CAN KNOW which twin a given
 * reference meant — that information was lost the day the second item took the number. Renumbering
 * the later twin would silently repoint every such reference at the survivor, converting an
 * ambiguity a reader can SEE into a wrong answer they cannot; and it would rewrite closed history
 * to do it. Marking in place changes what NO reference resolves to. It only makes the ambiguity
 * visible at the destination, which is the one place a reader is guaranteed to arrive.
 *
 * The guarantee this script must never break, and `test/ledgerDuplicateIds.test.js` enforces:
 * it INSERTS lines and alters nothing. No heading text changes, no id changes, no line is removed.
 *
 *   node scripts/mark-shared-ids.mjs            → write the markers
 *   node scripts/mark-shared-ids.mjs --check    → exit 1 if any colliding heading is unmarked
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { sameFileDuplicates, B_FILES, V_FILES } from "./next-id.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MARKER = "> ⚠ **SHARED ID";

/** The human-readable part of a heading: `### B127 — Measure-type dropdown …` → `Measure-type …` */
export function titleOf(headingLine, cap = 88) {
  let t = (headingLine || "").replace(/^###\s+[BV]\d+(?:[–—-][BV]?\d+)?\s*[—–-]?\s*/, "").trim();
  t = t.replace(/\s*\*\(filed.*$/s, "").replace(/`\[[^\]]*\]`/g, "").replace(/\s+/g, " ").trim();
  return t.length > cap ? `${t.slice(0, cap - 1)}…` : t;
}

/**
 * Insert a marker under every heading of every colliding id. PURE over the file text so the test
 * can drive it without touching disk. Returns { text, added }.
 */
export function markSharedIds(text, letter, dupIds) {
  const lines = text.split("\n");
  // Pass 1: locate every heading of every colliding id, and read its title.
  const found = new Map(); // id -> [{ index, title }]
  lines.forEach((line, index) => {
    const m = line.match(new RegExp(`^###\\s+${letter}(\\d+)\\b`));
    if (!m) return;
    const id = `${letter}${m[1]}`;
    if (!dupIds.has(id)) return;
    if (!found.has(id)) found.set(id, []);
    found.get(id).push({ index, title: titleOf(line) });
  });

  // Pass 2: build the insertions, bottom-up so earlier indices stay valid.
  const inserts = [];
  for (const [id, hits] of found) {
    hits.forEach((hit, i) => {
      // already marked? (idempotent re-run)
      if ((lines[hit.index + 1] || "").startsWith(MARKER)) return;
      // ⚠ The twin titles are the ONLY curly-quoted spans on this line — `test/ledgerDuplicateIds`
      // extracts them to re-check the marker's claim against the file, so no other prose here may
      // use “ ”. (It did in the first pass, and the check caught it.)
      const others = hits.filter((_, j) => j !== i).map((o) => `“${o.title}”`).join(" · ");
      inserts.push({
        at: hit.index + 1,
        line: `${MARKER} — ${id} also names ${hits.length - 1 > 1 ? `${hits.length - 1} other items` : "another item"} in this file:** ${others}. ` +
          `Nothing was renumbered (B308704): a renumber would silently repoint every existing *see ${id}* at one twin. Read a cross-reference to ${id} against all of them.`,
      });
    });
  }
  inserts.sort((a, b) => b.at - a.at);
  for (const ins of inserts) lines.splice(ins.at, 0, ins.line);
  return { text: lines.join("\n"), added: inserts.length };
}

function main(argv) {
  const check = argv.includes("--check");
  let missing = 0, added = 0;
  for (const [letter, files] of [["B", B_FILES], ["V", V_FILES]]) {
    const dupIds = new Map();
    for (const d of sameFileDuplicates(REPO, files, letter)) {
      if (!dupIds.has(d.file)) dupIds.set(d.file, new Set());
      dupIds.get(d.file).add(d.id);
    }
    for (const [file, ids] of dupIds) {
      const path = join(REPO, file);
      const before = readFileSync(path, "utf8");
      const res = markSharedIds(before, letter, ids);
      if (res.added === 0) continue;
      if (check) { missing += res.added; process.stderr.write(`⛔ ${file}: ${res.added} colliding ${letter}# heading(s) carry no SHARED ID marker\n`); continue; }
      writeFileSync(path, res.text);
      added += res.added;
      process.stdout.write(`✔ ${file}: marked ${res.added} heading(s) across ${ids.size} shared ${letter}# id(s)\n`);
    }
  }
  if (check) {
    if (missing) { process.stderr.write(`   → run: node scripts/mark-shared-ids.mjs\n`); return 1; }
    process.stdout.write("✅ every colliding heading carries its SHARED ID marker\n");
    return 0;
  }
  if (!added) process.stdout.write("✅ nothing to do — every colliding heading is already marked\n");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2));
}
