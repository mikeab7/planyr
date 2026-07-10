#!/usr/bin/env node
/*
 * next-id.mjs — print the next free backlog B# and verification V#, instantly, from the shell (B755).
 *
 * WHY THIS EXISTS: minting a new B# means "highest B# across BOTH BACKLOG.md (464 KB) and the
 * write-only BACKLOG-DONE.md (1.4 MB) + 1", and a new V# the same across VERIFICATION*.md. Every
 * session was doing that by reading those giant files INTO MODEL CONTEXT to eyeball the max — the
 * single biggest avoidable token burn in this repo, and the recurring "which number do we ship/merge
 * with?" tax. BACKLOG_OPEN.md didn't fix it: it lists only Open + Verify items, so the true max —
 * which routinely sits on a *Done* item in the archive — isn't even in it, and it's grouped by theme,
 * not sorted by number. This script computes the answer on disk with ZERO model tokens: one command,
 * one line of output.
 *
 *   node scripts/next-id.mjs           → human-friendly:  "Next free → B755 · V268"
 *   node scripts/next-id.mjs --json     → { "nextB": 755, "nextV": 268, "maxB": 754, "maxV": 267 }
 *   node scripts/next-id.mjs --b         → just "B755"   (paste-ready label to mint from)
 *   node scripts/next-id.mjs --v         → just "V268"
 *
 * HOUSE RULES (mirrors build-backlog-index.mjs): dependency-free (Node fs + regex), deterministic
 * (no volatile date/random), exports the pure fns the unit test imports; runnable standalone.
 *
 * WHY THIS PARSE IS SAFE: we take the max only over the two CURATED, authoritative forms an assigned
 * id ever appears in — a `### B123` heading (every real item has exactly one) and a `**B123**` bold
 * mint — including range forms (`### B300–B302`, `**B378–B379**`). We deliberately do NOT scan every
 * inline "B12" prose mention: those are only *re-mentions* of already-counted items, so ignoring them
 * can never UNDER-count (reuse a live number, the one dangerous error), while it makes us immune to a
 * stray prose typo like "B99999" permanently inflating every future id.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

// The files each id family lives across. Open + write-only Done archive both hold `### <letter>###`
// headings for every id ever assigned, so the union's max is the true max.
export const B_FILES = ["BACKLOG.md", "BACKLOG-DONE.md"];
export const V_FILES = ["VERIFICATION.md", "VERIFICATION-DONE.md"];

/**
 * Highest assigned id of a family (`letter` = "B" or "V") in `text`.
 * Scans `### <L>123` headings and `**<L>123**` bold mints, both with optional range ends
 * (`123–125` / `123-B125`). Returns 0 when none present.
 */
export function maxId(text, letter) {
  let max = 0;
  const consider = (s) => {
    const n = parseInt(s, 10);
    if (Number.isFinite(n) && n > max) max = n;
  };
  const patterns = [
    // heading:  ^### B123   or   ^### B300–B302 / ^### B300-302
    new RegExp(`^###\\s+${letter}(\\d+)(?:\\s*[–—-]\\s*${letter}?(\\d+))?`, "gm"),
    // bold mint: **B123**   or   **B378–B379**
    new RegExp(`\\*\\*${letter}(\\d+)(?:\\s*[–—-]\\s*${letter}?(\\d+))?\\*\\*`, "g"),
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      consider(m[1]);
      if (m[2]) consider(m[2]);
    }
  }
  return max;
}

/** Max id of a family across several repo-relative files (missing files are skipped). */
export function maxAcross(repo, files, letter) {
  let max = 0;
  for (const f of files) {
    const p = join(repo, f);
    if (!existsSync(p)) continue;
    const m = maxId(readFileSync(p, "utf8"), letter);
    if (m > max) max = m;
  }
  return max;
}

/** The whole answer: current maxes + the next free number for each family. */
export function computeNextIds(repo = REPO) {
  const maxB = maxAcross(repo, B_FILES, "B");
  const maxV = maxAcross(repo, V_FILES, "V");
  return { maxB, maxV, nextB: maxB + 1, nextV: maxV + 1 };
}

// ---- CLI -------------------------------------------------------------------------------
function main(argv) {
  const { nextB, nextV, maxB, maxV } = computeNextIds();
  if (argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ nextB, nextV, maxB, maxV }) + "\n");
    return;
  }
  if (argv.includes("--b")) return void process.stdout.write(`B${nextB}\n`);
  if (argv.includes("--v")) return void process.stdout.write(`V${nextV}\n`);
  process.stdout.write(
    `Next free → B${nextB} · V${nextV}   (highest assigned: B${maxB} / V${maxV})\n` +
      `Mint from here. Multi-mint runs consecutively (e.g. B${nextB}, B${nextB + 1}). ` +
      `Don't grep the archives — this is the whole answer.\n`,
  );
}

// Run only as a script, not when imported by the test.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
