#!/usr/bin/env node
/* notification-position-audit.mjs — the CI guard behind docs/DESIGN.md's "Floating notifications"
 * rule (NEW-1/NEW-3, B1000400, 2026-09-01).
 *
 * WHY THIS EXISTS. The owner reported the "+ Select parcels" guidance box sitting oversized at
 * the top-left of the map, covering the aerial and the +/- zoom controls, with an explicit
 * instruction to make a rule that every notification banner is bottom-centered and apply it
 * everywhere. Three surfaces had each invented their own fixed position for the same job before
 * this — nothing PREVENTED a new banner from doing it again. This is the guard.
 *
 * WHAT IT CHECKS: a small, explicit REGISTRY of known floating, app-level notification surfaces
 * (by `data-testid`, so it survives line-number drift as the surrounding file changes — see
 * CLAUDE.md's own note on why every guard in this repo prefers a stable marker over a line
 * number). For each registered surface it:
 *   1. Finds `data-testid="<id>"` in the named file. Missing entirely is ITSELF a failure (a
 *      renamed/removed testid must never silently stop being checked — LOUD-FAILURE).
 *   2. Confirms the surface is a descendant of `<FloatingNotice` — the ONE shared primitive that
 *      owns bottom-center position (`src/shared/ui/FloatingNotice.jsx`). This is the whole
 *      architectural point of that primitive: "is this wrapped in FloatingNotice" and "is this
 *      bottom-centered" are the same question by construction, because nothing outside that one
 *      file may declare the position of a floating notice.
 *   3. If NOT wrapped, scans the surrounding text for whatever raw position/top/zIndex literal
 *      was reintroduced and reports it as the offending value — so a regression names the exact
 *      bad line, not just "broken".
 *
 * ⛔ MANDATORY RED-PROOF (per the item this shipped under): this guard is only real if it has been
 * SEEN to fail on the exact defect it exists to catch. Before trusting a green run, revert one
 * migrated banner (AppHeader.jsx's fullscreen-refused notice is the cleanest) back to its old
 * `top: 84` fixed div with no FloatingNotice wrapper, run `--check`, and confirm a non-zero exit
 * naming that file — then restore it. See BACKLOG.md B1000402 for the recorded run.
 *
 * USAGE:
 *   node ui-audit/notification-position-audit.mjs          → print the report
 *   node ui-audit/notification-position-audit.mjs --json    → machine-readable report
 *   node ui-audit/notification-position-audit.mjs --check   → CI gate; exit 1 on any violation
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");

/* ---------------------------------------------------------------------------------------------
 * THE REGISTRY — every known floating, app-level notification surface in the app. A new one
 * belongs here the same PR it's added; docs/DESIGN.md's "Floating notifications" rule + this
 * file's own header explain what qualifies (floating + app-level, not an inline panel message).
 * ------------------------------------------------------------------------------------------- */
export const NOTIFICATION_SURFACES = [
  { file: "src/shared/ui/Toast.jsx", testId: "sync-toast-host", label: "Toast stack (sync/status toasts)" },
  { file: "src/shared/ui/AppHeader.jsx", testId: "fullscreen-refused", label: "Fullscreen-refused notice" },
  { file: "src/shared/ui/AppHeader.jsx", testId: "cross-tab-conflict", label: "Cross-tab conflict notice" },
  { file: "src/shared/ui/ProjectBreadcrumb.jsx", testId: "project-at-risk-toast", label: "At-risk project-switch toast (B193)" },
  { file: "src/app/Shell.jsx", testId: "app-update-banner", label: "App-update banner (B1373)" },
  { file: "src/workspaces/site-planner/MapFinder.jsx", testId: "select-parcels-tip", label: "Select-parcels guidance tip" },
  { file: "src/workspaces/site-planner/MapFinder.jsx", testId: "parcel-backup-notice", label: "Statewide-backup parcel-source notice" },
  { file: "src/workspaces/site-planner/MapFinder.jsx", testId: "parcel-cached-notice", label: "Cached-snapshot parcel-source notice" },
];

const BACK_WINDOW = 1200;  // how far back a `<FloatingNotice` opening tag may sit from the testid
const LOCAL_WINDOW = 500;  // how far to look for an offending raw position literal when unwrapped

const POSITION_LITERAL_RE = /position\s*:\s*["'`]fixed["'`][^}]{0,200}/;
const TOP_LITERAL_RE = /\btop\s*:\s*["'`]?(-?\d+(?:\.\d+)?)/;
const ZINDEX_LITERAL_RE = /\bzIndex\s*:\s*["'`]?(\d+)/;

function fileText(relPath) {
  const abs = join(REPO, relPath);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, "utf8");
}

function findAllIndexes(text, needle) {
  const out = [];
  let i = text.indexOf(needle);
  while (i !== -1) { out.push(i); i = text.indexOf(needle, i + needle.length); }
  return out;
}

// Is the testid occurrence at `idx` inside a <FloatingNotice>...</FloatingNotice> span? Looks
// backward for the nearest of the two tags — an opening tag closer than any closing tag means
// wrapped; anything else (a closing tag first, or neither found in range) means NOT wrapped.
function isWrappedInFloatingNotice(text, idx) {
  const windowStart = Math.max(0, idx - BACK_WINDOW);
  const before = text.slice(windowStart, idx);
  const lastOpen = before.lastIndexOf("<FloatingNotice");
  const lastClose = before.lastIndexOf("</FloatingNotice>");
  return lastOpen !== -1 && lastOpen > lastClose;
}

// When NOT wrapped, name the actual offending value nearby, so a violation is actionable rather
// than just "broken" — mirrors design-drift-audit.mjs's "New/moved offenders" style.
function describeOffendingValue(text, idx) {
  const start = Math.max(0, idx - LOCAL_WINDOW);
  const end = Math.min(text.length, idx + LOCAL_WINDOW);
  const local = text.slice(start, end);
  const posM = local.match(POSITION_LITERAL_RE);
  if (posM) {
    const topM = posM[0].match(TOP_LITERAL_RE);
    const zM = posM[0].match(ZINDEX_LITERAL_RE);
    const parts = [`position:"fixed"`];
    if (topM) parts.push(`top:${topM[1]}`);
    if (zM) parts.push(`zIndex:${zM[1]}`);
    return parts.join(", ");
  }
  return "not wrapped in <FloatingNotice> and no inline position literal found nearby";
}

// Pure: check already-in-memory source text for one testid. Split out from auditSurface (which
// reads the real file from disk) so unit tests can pin the scan rule against small fixtures,
// exactly like design-drift-audit.mjs's scanFile/scanRepo split.
//
// A registered surface's identifier appears one of two ways in source: `data-testid="X"` on the
// content itself (the common case — the content already carried a testid before migration, e.g.
// AppHeader's fullscreen-refused notice), or `testId="X"` on the `<FloatingNotice>` call site
// directly (when the wrapper is what carries the identifier — ProjectBreadcrumb's at-risk toast,
// the MapFinder backup/cached notices, Toast's ToastHost). The second form only ever appears
// literally inside `<FloatingNotice testId="X" …>`, so finding it at all IS the wrapping proof —
// no backward scan needed. The first form still needs the backward scan, because a `data-testid`
// can exist on plenty of things that are NOT floating notices.
export function checkText(text, testId) {
  const dataHits = findAllIndexes(text, `data-testid="${testId}"`);
  const propHits = findAllIndexes(text, `testId="${testId}"`);
  if (dataHits.length === 0 && propHits.length === 0) {
    return { ok: false, reason: `testid "${testId}" not found — surface renamed, removed, or never shipped` };
  }
  for (const idx of propHits) {
    // Confirm this is really the FloatingNotice component's own prop, not some other component's
    // `testId="X"` that happens to match — the opening `<FloatingNotice` must be the nearest tag
    // start before this attribute (i.e. no other tag opened in between).
    const before = text.slice(Math.max(0, idx - 200), idx);
    const lastTagOpen = before.lastIndexOf("<FloatingNotice");
    const lastAnyTag = before.lastIndexOf("<");
    if (lastTagOpen === -1 || lastAnyTag !== lastTagOpen) {
      return { ok: false, reason: `"testId=\\"${testId}\\"" found but not on a <FloatingNotice> tag` };
    }
  }
  for (const idx of dataHits) {
    if (!isWrappedInFloatingNotice(text, idx)) {
      const offending = describeOffendingValue(text, idx);
      return { ok: false, reason: `not bottom-centered via FloatingNotice — ${offending}` };
    }
  }
  return { ok: true };
}

export function auditSurface({ file, testId, label }) {
  const text = fileText(file);
  if (text == null) {
    return { file, testId, label, ok: false, reason: `file not found: ${file}` };
  }
  return { file, testId, label, ...checkText(text, testId) };
}

export function auditAll(registry = NOTIFICATION_SURFACES) {
  const results = registry.map(auditSurface);
  const violations = results.filter((r) => !r.ok);
  return { results, violations, total: violations.length };
}

function printReport(report) {
  console.log(`notification-position-audit — ${report.results.length} registered surface(s), ${report.total} violation(s)`);
  for (const r of report.results) {
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.file} [${r.testId}] — ${r.label}${r.ok ? "" : `\n      ${r.reason}`}`);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const report = auditAll();
  if (process.argv.includes("--check")) {
    if (report.total > 0) {
      console.error("Notification-position check FAILED:\n" + report.violations.map((v) =>
        `  • ${v.file} [${v.testId}] (${v.label}): ${v.reason}`).join("\n"));
      process.exit(1);
    }
    console.log(`Notification-position check passed (${report.results.length} surfaces, all bottom-centered via FloatingNotice).`);
  } else if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
}
