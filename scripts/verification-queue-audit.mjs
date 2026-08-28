#!/usr/bin/env node
/*
 * verification-queue-audit.mjs — machine-checked gate on the VERIFICATION.md pending queue (B825233).
 *
 * WHY THIS EXISTS. CLAUDE.md already states the rule: "a V### with no Blocker: wall is a
 * mis-classification, not a to-do" (ATTEMPT-BEFORE-YOU-PARK), and every session is told to drive a
 * headless check itself rather than park one. Nothing ever checked it. A 2026-08-28 audit found 211
 * pending items, 130 of them carrying no `Blocker:` at all, and 60 sitting over 60 days old (one,
 * V220, for 436 days). A rule nobody's build consults is not a guard — this is that guard.
 *
 * WHAT IT MEASURES, over every `### V###` heading in VERIFICATION.md's pending queue:
 *   - noBlocker: the block names no `Blocker: <kind>` tag at all (the mis-classification CLAUDE.md
 *     already names — everything else is Claude-doable here per ATTEMPT-BEFORE-YOU-PARK and should
 *     never sit pending with no wall named).
 *   - stale: the newest ISO date (`YYYY-MM-DD`) mentioned anywhere in the block is more than
 *     STALE_THRESHOLD_DAYS old. That date is a proxy for "last touched" (every item in this file
 *     that's had a real pass at it names the date it did) — an item with NO date at all is reported
 *     separately (`noDate`) rather than silently treated as either fresh or stale, since neither is true.
 *
 * WHY 60 DAYS. The measured distribution has a real break there: of 194 dated pending items, 125
 * cluster in the 31–60 day band (one `improve`-cadence cycle or two), and 60 sit past it — the tail
 * that has survived more than two full monthly cycles unaddressed. A 30-day threshold would flag the
 * entire routine backlog and say nothing useful; 60 days isolates the genuinely neglected set.
 *
 * WHAT THIS IS NOT: a fixer. 130 no-Blocker items and dozens of stale ones exist today: mixing a fix
 * for those into this change would bury it (explicit instruction on the item that created this
 * script). This is a RATCHET, exactly like `perf-ratchet.mjs` / `panel-copy-budget.mjs`: `--check`
 * fails only if the CURRENT count exceeds the recorded ceiling in `scripts/verification-queue-
 * ceiling.json` — so today's debt does not fail every future build, but a NEW no-Blocker item or a
 * newly-stale one, added without anyone lowering the ceiling back down, does. Improving the numbers
 * and re-running `--write-ceiling` is how the ceiling comes down; nothing here fixes the 130 itself.
 *
 * USAGE:
 *   node scripts/verification-queue-audit.mjs                 → print the report table
 *   node scripts/verification-queue-audit.mjs --json           → machine-readable report
 *   node scripts/verification-queue-audit.mjs --check           → CI gate; exit 1 if counts exceed
 *                                                                 the recorded ceiling
 *   node scripts/verification-queue-audit.mjs --write-ceiling   → (re)write the ceiling file to the
 *                                                                 CURRENT counts — run this after a
 *                                                                 session genuinely improves the queue
 *
 * HOUSE RULES (mirrors build-backlog-index.mjs / build-map.mjs): dependency-free (Node fs + regex),
 * deterministic given a `now`, exports the pure fn the unit test imports, runnable standalone.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const VERIFICATION = join(REPO, "VERIFICATION.md");
const CEILING = join(HERE, "verification-queue-ceiling.json");

export const STALE_THRESHOLD_DAYS = 60;

const BLOCKER_RE = /`Blocker:\s*([a-z-]+)`/g;
const DATE_RE = /\b(20\d\d)-(\d\d)-(\d\d)\b/g;
const HEADING_RE = /^### (V\d+)(?:\s*\(×\d+\))?\s*—/;

// ----------------------------------------------------------------------------------------
// Parse VERIFICATION.md's pending queue ("## 🔲 Needs verification" through the next "## ").
// Every V### heading up to the "## ✅ Verified / ❌ Failed — history" boundary is a pending
// (or failed) item — anything fully passed has already moved to VERIFICATION-DONE.md.
// ----------------------------------------------------------------------------------------
export function parseQueue(text) {
  const lines = text.split("\n");
  const items = [];
  let inQueue = false;
  let cur = null;
  const push = () => { if (cur) items.push(cur); cur = null; };

  for (const line of lines) {
    if (/^## /.test(line)) {
      if (/needs verification/i.test(line)) { inQueue = true; push(); continue; }
      if (inQueue) { push(); inQueue = false; }
      continue;
    }
    if (!inQueue) continue;
    const h = line.match(HEADING_RE);
    if (h) {
      push();
      cur = { id: h[1], heading: line, body: line + "\n" };
      continue;
    }
    if (cur) cur.body += line + "\n";
  }
  push();
  return items;
}

// A block is FAILED only if it carries an explicit ❌ marker (a run that's been done and came back
// red — usually already tracked by its own follow-up B#). EVERYTHING ELSE in the pending queue is
// treated as still OPEN, whether or not it happens to use the literal "⏳ pending" phrasing — this
// file spans years of sessions and formats, and a chunk of real, still-owed items (e.g. a "Shipped
// on branch X, already verified HERE and NOT owed: ... still needs a signed-in pass for Y" item)
// never spells the emoji at all. Treating those as resolved would be the wrong direction to err in
// for a queue-health gate; treating them as open costs nothing but a slightly larger open count.
function classify(item) {
  return /❌/.test(item.body) ? "failed" : "open";
}

function blockers(item) {
  const found = new Set();
  for (const m of item.body.matchAll(BLOCKER_RE)) found.add(m[1]);
  return [...found];
}

// The newest ISO date mentioned anywhere in the block, as a "last touched" proxy — every item
// that's had real work done on it names the date it happened. Returns null if none found.
function lastTouched(item) {
  let latest = null;
  for (const m of item.body.matchAll(DATE_RE)) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) continue;
    if (!latest || d > latest) latest = d;
  }
  return latest;
}

export function auditQueue(text, { now = new Date(), staleThresholdDays = STALE_THRESHOLD_DAYS } = {}) {
  const items = parseQueue(text);
  const rows = items.map((item) => {
    const status = classify(item);
    const blockerTags = blockers(item);
    const touched = lastTouched(item);
    const ageDays = touched ? Math.floor((now - touched) / 86400000) : null;
    return {
      id: item.id,
      status,
      blockers: blockerTags,
      noBlocker: status === "open" && blockerTags.length === 0,
      ageDays,
      stale: status === "open" && ageDays !== null && ageDays > staleThresholdDays,
      noDate: status === "open" && ageDays === null,
    };
  });

  const open = rows.filter((r) => r.status === "open");
  const failed = rows.filter((r) => r.status === "failed");
  const noBlocker = rows.filter((r) => r.noBlocker);
  const stale = rows.filter((r) => r.stale);
  const noDate = rows.filter((r) => r.noDate);

  return {
    total: rows.length,
    openCount: open.length,
    failedCount: failed.length,
    noBlockerCount: noBlocker.length,
    staleCount: stale.length,
    noDateCount: noDate.length,
    staleThresholdDays,
    noBlockerIds: noBlocker.map((r) => r.id),
    staleIds: stale.map((r) => r.id),
    rows,
  };
}

function loadCeiling() {
  if (!existsSync(CEILING)) return null;
  return JSON.parse(readFileSync(CEILING, "utf8"));
}

function writeCeiling(report) {
  const ceiling = {
    noBlockerCeiling: report.noBlockerCount,
    staleCeiling: report.staleCount,
    staleThresholdDays: report.staleThresholdDays,
    writtenAt: new Date().toISOString().slice(0, 10),
    note: "Ratchet ceiling for scripts/verification-queue-audit.mjs --check. Regenerate with " +
      "`node scripts/verification-queue-audit.mjs --write-ceiling` after the counts genuinely " +
      "improve — never raise it to silence a real regression.",
  };
  writeFileSync(CEILING, JSON.stringify(ceiling, null, 2) + "\n");
  return ceiling;
}

export function checkCeiling(report, ceiling) {
  const problems = [];
  if (!ceiling) {
    problems.push("No scripts/verification-queue-ceiling.json — run --write-ceiling once to establish a baseline.");
    return { ok: false, problems };
  }
  if (report.noBlockerCount > ceiling.noBlockerCeiling) {
    problems.push(
      `No-Blocker pending V# count grew: ${report.noBlockerCount} > ceiling ${ceiling.noBlockerCeiling}. ` +
      `A V### with no Blocker: wall is a mis-classification (CLAUDE.md, ATTEMPT-BEFORE-YOU-PARK) — either ` +
      `drive the check now, or name the wall it hits. New offenders: ${report.noBlockerIds.join(", ") || "(see report)"}`
    );
  }
  if (report.staleCount > ceiling.staleCeiling) {
    problems.push(
      `Stale (>${ceiling.staleThresholdDays}d) pending V# count grew: ${report.staleCount} > ceiling ${ceiling.staleCeiling}. ` +
      `New offenders: ${report.staleIds.join(", ") || "(see report)"}`
    );
  }
  return { ok: problems.length === 0, problems };
}

function printReport(report) {
  console.log(`VERIFICATION.md queue audit — ${report.total} V# items in the pending queue`);
  console.log(`  open: ${report.openCount}  explicitly ❌ failed: ${report.failedCount}`);
  console.log(`  no Blocker: tag at all: ${report.noBlockerCount}`);
  console.log(`  older than ${report.staleThresholdDays}d (by last date mentioned in the block): ${report.staleCount}`);
  console.log(`  open items with no date mentioned at all (age unknown, reported not guessed): ${report.noDateCount}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const text = readFileSync(VERIFICATION, "utf8");
  const report = auditQueue(text);
  if (process.argv.includes("--write-ceiling")) {
    const ceiling = writeCeiling(report);
    console.log(`scripts/verification-queue-ceiling.json written — noBlockerCeiling=${ceiling.noBlockerCeiling}, staleCeiling=${ceiling.staleCeiling}.`);
  } else if (process.argv.includes("--check")) {
    const { ok, problems } = checkCeiling(report, loadCeiling());
    if (!ok) {
      console.error("Verification-queue ceiling check FAILED:\n" + problems.map((p) => "  • " + p).join("\n"));
      process.exit(1);
    }
    console.log(`Verification-queue ceiling check passed (${report.noBlockerCount} no-Blocker ≤ ceiling, ${report.staleCount} stale ≤ ceiling).`);
  } else if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
}
