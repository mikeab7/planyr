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
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

// The files each id family lives across. Open + write-only Done archive both hold `### <letter>###`
// headings for every id ever assigned, so the union's max is the true max.
export const B_FILES = ["BACKLOG.md", "BACKLOG-DONE.md"];
export const V_FILES = ["VERIFICATION.md", "VERIFICATION-DONE.md"];
// The LIVE (active) surfaces — where a fresh concurrent-mint collision between two currently-worked
// items shows up, and where the uniqueness guard is enforced. The write-only *-DONE.md archives are
// excluded on purpose: they carry ~50 historical cross-file collisions (e.g. B755, V275) + benign
// same-item re-listings that predate this guard and can't be safely renumbered in-place; `--against-main`
// prevents minting OVER an archived id in the first place, and the full-pair audit stays available via
// findDuplicateIds(REPO, B_FILES, "B") for a future archive cleanup. (B779.)
export const LIVE_B_FILES = ["BACKLOG.md"];
export const LIVE_V_FILES = ["VERIFICATION.md"];

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

/* --- Collision guard (B779): every assigned id has EXACTLY ONE `### <L>###` heading across its
 * file pair. A second heading for the same id = a concurrent-mint collision that slipped through
 * (two branches minted it before either merged). Count each heading's PRIMARY id (its first number,
 * so range headings like `### B300–B302` count once, at 300) and flag any id seen more than once.
 * Pure over the given text set → the CI uniqueness test imports it. Returns [{id, count}] sorted. */
export function findDuplicateIdsIn(texts, letter) {
  const counts = new Map();
  const re = new RegExp(`^###\\s+${letter}(\\d+)\\b`, "gm");
  for (const text of texts) {
    for (const m of (text || "").matchAll(re)) {
      const id = `${letter}${m[1]}`;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, n]) => n > 1)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

/** findDuplicateIdsIn over the on-disk file pair for a family (missing files skipped). */
export function findDuplicateIds(repo, files, letter) {
  const texts = files.map((f) => join(repo, f)).filter(existsSync).map((p) => readFileSync(p, "utf8"));
  return findDuplicateIdsIn(texts, letter);
}

/* Known-legacy collision baseline (B780, audited 2026-07-11): every id below is ALREADY assigned to
 * two (B445/V45: three) DIFFERENT features across the live+archive pair — historical concurrent-mint
 * collisions that merged silently before the uniqueness guard existed. They are GRANDFATHERED, not
 * approved: renumbering them now would break scattered cross-references in the write-only archives,
 * `--against-main` prevents minting over them, and the ids never drive runtime behavior (comments/
 * provenance only). The cross-file guard (test/idUniqueness.test.js) allows AT MOST these, at AT MOST
 * these counts — any id newly collided, or any listed id collided one more time, fails the build.
 * Shrinking is welcome (fix a legacy dup → delete its row here in the same commit). */
export const KNOWN_LEGACY_ID_COLLISIONS = {
  B: { B127: 2, B128: 2, B131: 2, B147: 2, B151: 2, B180: 2, B181: 2, B182: 2, B183: 2, B239: 2, B316: 2, B341: 2, B343: 2, B348: 2, B350: 2, B360: 2, B364: 2, B417: 2, B418: 2, B445: 3, B471: 2, B485: 2, B489: 2, B495: 2, B562: 2, B566: 2, B568: 2, B569: 2, B590: 2, B594: 2, B597: 2, B664: 2, B682: 2, B717: 2, B737: 2, B755: 2, B757: 2 },
  V: { V24: 2, V25: 2, V39: 2, V40: 2, V45: 3, V92: 2, V99: 2, V100: 2, V119: 2, V120: 2, V122: 2, V123: 2, V130: 2, V131: 2, V132: 2, V136: 2, V137: 2, V152: 2, V154: 2, V173: 2, V275: 2 },
};

/* Cross-file collision check for a family: duplicates across the FULL live+archive pair that are NOT
 * covered by the grandfathered baseline (unknown id, or a known id at a higher count). This is the
 * detector for the race the live-only guard can't see — session A ships + ARCHIVES its item while
 * session B's same-numbered item stays open, so the two headings land in different files. Pure. */
export function newCrossFileCollisions(repo, files, letter, baseline = KNOWN_LEGACY_ID_COLLISIONS[letter] || {}) {
  return findDuplicateIds(repo, files, letter).filter(({ id, count }) => count > (baseline[id] || 1));
}

/* Read a file as it exists on origin/main (not the local branch) — so `--against-main` sees ids
 * that other sessions merged AFTER we branched (the concurrent-mint case next-id can't otherwise
 * see). Never throws: no git / no origin/main / missing file → null, and the caller falls back to
 * the local-only max. `git show` only, read-only.
 *
 * maxBuffer is set well above BACKLOG-DONE.md's size (1.4 MB and growing) — the default 1 MB
 * execSync buffer throws ENOBUFS on that file, which this function's catch then swallowed
 * SILENTLY, degrading `--against-main` to a stale local-only max with no indication anything
 * was wrong (a real collision from this: two sessions both minted B896 on 2026-07-18, one for
 * this redesign, one already shipped on main for an unrelated feature). LOUD-FAILURE: a genuine
 * read failure (as opposed to "no origin/main configured") now prints a visible warning instead
 * of failing open unnoticed. */
export function readOriginMain(repo, file) {
  try {
    return execSync(`git show origin/main:${file}`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    if (e && e.code !== "ENOENT" && !/unknown revision|not a git repository/i.test(String(e.stderr || e.message || ""))) {
      process.stderr.write(`⚠ next-id: couldn't read origin/main:${file} (${e.code || e.message}) — --against-main is degraded to the local-only max for this file.\n`);
    }
    return null;
  }
}

/** Max id across BOTH the local files AND their origin/main versions. */
export function maxAgainstMain(repo, files, letter) {
  let max = maxAcross(repo, files, letter);
  for (const f of files) {
    const t = readOriginMain(repo, f);
    if (t != null) { const m = maxId(t, letter); if (m > max) max = m; }
  }
  return max;
}

/** Like computeNextIds but folding in origin/main (for the late-bind / ship-time mint). */
export function computeNextIdsAgainstMain(repo = REPO) {
  const maxB = maxAgainstMain(repo, B_FILES, "B");
  const maxV = maxAgainstMain(repo, V_FILES, "V");
  return { maxB, maxV, nextB: maxB + 1, nextV: maxV + 1 };
}

// ---- CLI -------------------------------------------------------------------------------
function main(argv) {
  // `--against-main` (B779): fold in the numbers on origin/main, so a LATE mint (assign the id as
  // the last step before push, `git fetch origin main` first) steps around ids another session
  // merged after we branched — the concurrent-collision fix. Default stays local-only (unchanged).
  const againstMain = argv.includes("--against-main");
  const { nextB, nextV, maxB, maxV } = againstMain ? computeNextIdsAgainstMain() : computeNextIds();
  if (argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ nextB, nextV, maxB, maxV }) + "\n");
    return;
  }
  if (argv.includes("--b")) return void process.stdout.write(`B${nextB}\n`);
  if (argv.includes("--v")) return void process.stdout.write(`V${nextV}\n`);
  process.stdout.write(
    `Next free → B${nextB} · V${nextV}   (highest assigned: B${maxB} / V${maxV})${againstMain ? "  [incl. origin/main]" : ""}\n` +
      `Mint from here. Multi-mint runs consecutively (e.g. B${nextB}, B${nextB + 1}). ` +
      `Don't grep the archives — this is the whole answer.\n`,
  );
  // Loud heads-up if two ACTIVE items share an id (a fresh concurrent-mint collision) — the CI
  // uniqueness guard (test/idUniqueness.test.js) enforces the same on the live files. Scoped to the
  // live surfaces so it's actionable, not drowned by the historical archive collisions.
  const dupB = findDuplicateIds(REPO, LIVE_B_FILES, "B");
  const dupV = findDuplicateIds(REPO, LIVE_V_FILES, "V");
  if (dupB.length || dupV.length) {
    const fmt = (d) => d.map((x) => `${x.id}×${x.count}`).join(", ");
    process.stderr.write(`⚠ DUPLICATE ACTIVE ids — renumber before shipping: ${fmt([...dupB, ...dupV])}\n`);
  }
}

// Run only as a script, not when imported by the test.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2));
}
