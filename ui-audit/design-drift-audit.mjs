#!/usr/bin/env node
/* design-drift-audit.mjs — the CI guard behind docs/DESIGN.md (NEW-2).
 *
 * WHY THIS EXISTS. The 2026-07-06 design-language convergence pass normalized control radius to
 * 8 app-wide and built src/shared/ui/controls.jsx; it closed with "a full component-swap is
 * optional future polish" — and that deferral is exactly why the owner is now looking at multiple
 * different radii on the main menu again. Tokens and primitives already exist (radius.js,
 * designTokens.js, controls.jsx, moduleAccent.js, statusTokens.js) but nothing PREVENTS a session
 * from hand-rolling `borderRadius: 6` in a new panel, so every new feature adds its own dialect.
 * This is the guard: modeled directly on ui-audit/contrast-audit.mjs (a pure `auditAll()` scanning
 * real source, consumed by a vitest test that's already a required `npm test` step in build.yml).
 *
 * WHAT IT FLAGS, in any `src/**\/*.{js,jsx}` file outside the declared token layer and the declared
 * drawing-surface list (see docs/DESIGN.md — "Canvas/SVG boundary" and "The token layer"):
 *   - hex   — any raw `#rgb`/`#rrggbb`/`#rrggbbaa` color literal, or a raw `rgb()`/`rgba()` literal.
 *             Zero tolerance: a color can never respond to a theme change if it isn't a token, so
 *             there is no "close enough" case the way there is for a numeric scale.
 *   - radius — a raw `borderRadius`/`border-radius` numeric literal that is NOT one of RADIUS's
 *             values (imported from radius.js, never re-typed here). A literal that already equals
 *             a token's pixel value (e.g. `borderRadius: 8`) is not flagged by this check — that is
 *             real but softer debt (docs/DESIGN.md's radius section, exception 3) for NEW-3's
 *             inventory to find and mechanically repoint; this guard targets the VISIBLE drift the
 *             owner actually reported (a genuinely off-scale corner), not the import-vs-literal nit.
 *   - fontSize — a raw `fontSize`/`font-size` numeric literal that is NOT one of FONT_SIZE's values
 *             (imported from designTokens.js).
 *
 * ESCAPE HATCH: an inline `// design-exempt: <reason>` comment on the flagged line. Every exemption
 * — both this per-line kind and the file-level drawing-surface/token-layer kind — is returned in the
 * report and PRINTED by the CLI, so the exempt list stays visible instead of quietly accumulating
 * (the NEW-2 brief's explicit requirement).
 *
 * ⛔ WHY THIS IS A RATCHET, NOT A ZERO-TOLERANCE GATE (mirrors scripts/verification-queue-audit.mjs
 * exactly — same shape, same reason). A sweep at the time this guard was written found 996 raw
 * hex/rgba literals across 81 files outside the drawing-surface list: real, pre-existing chrome
 * debt (dark-themed modals reimplementing a whole palette, hardcoded toast colors, a locally
 * duplicated status palette). Failing the build on all of it on day one would either never land, or
 * land red and train everyone to ignore it — the exact failure CLAUDE.md's own note on this item
 * warns about ("a guard checked in red trains everyone to ignore it"). So `--check` reads a
 * checked-in ceiling (ui-audit/design-drift-ceiling.json) and fails ONLY if a count exceeds it —
 * new drift is blocked from day one, today's debt is inherited honestly, and every fix lowers the
 * ceiling in the same commit via `--write-ceiling`.
 *
 * USAGE:
 *   node ui-audit/design-drift-audit.mjs                → print the report table + every exemption
 *   node ui-audit/design-drift-audit.mjs --json          → machine-readable report
 *   node ui-audit/design-drift-audit.mjs --check         → CI gate; exit 1 if counts exceed the ceiling
 *   node ui-audit/design-drift-audit.mjs --write-ceiling → (re)write the ceiling to the CURRENT counts
 */
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, sep } from "node:path";
import { RADIUS } from "../src/shared/ui/radius.js";
import { FONT_SIZE } from "../src/shared/ui/designTokens.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const SRC = join(REPO, "src");
const CEILING = join(HERE, "design-drift-ceiling.json");

/* ---------------------------------------------------------------------------------------------
 * THE TOKEN LAYER — these files DEFINE the numbers everything else consumes, so a literal in them
 * is the source of truth, not a violation. Kept as an exact-path allowlist (never a glob) so the
 * list stays reviewable — see docs/DESIGN.md "The token layer".
 * ------------------------------------------------------------------------------------------- */
export const TOKEN_LAYER_FILES = [
  "src/shared/ui/moduleAccent.js",
  "src/shared/ui/statusTokens.js",
  "src/shared/brand/tokens.js",
  "src/shared/ui/radius.js",
  "src/shared/ui/designTokens.js",
  "src/shared/theme/palette.js",
  "src/shared/ui/controls.jsx",
];

/* ---------------------------------------------------------------------------------------------
 * THE DRAWING-SURFACE LAYER — plan geometry, map markers, and print/export sheets. Colors here
 * represent DRAWN CONTENT, not app chrome, and are not governed by this scale — see docs/DESIGN.md
 * "Canvas/SVG boundary" for the reasoning behind each entry (incl. the stated, not hidden,
 * limitation on SitePlanner.jsx, which still mixes some chrome into the same file pending the
 * B287058 decomposition). A file NOT on this list is still counted — nothing here is a silent
 * carve-out for "most of it is canvas anyway".
 * ------------------------------------------------------------------------------------------- */
export const DRAWING_SURFACE_FILES = [
  "src/workspaces/site-planner/SitePlanner.jsx",
  "src/workspaces/site-planner/lib/layers.js",
  "src/workspaces/site-planner/lib/vectorLayers.js",
  "src/workspaces/site-planner/lib/planStyle.js",
  "src/workspaces/site-planner/lib/easements.js",
  "src/workspaces/site-planner/lib/mitigationHeatmap.js",
  "src/workspaces/site-planner/lib/jurisdiction.js",
  "src/workspaces/site-planner/lib/printSheet.js",
  "src/workspaces/notes/lib/notesPrint.js",
  "src/workspaces/food/lib/ratingColor.js",
  "src/shared/theme/familyInk.js",
];

const EXEMPT_FILES = new Set([...TOKEN_LAYER_FILES, ...DRAWING_SURFACE_FILES]);

const RADIUS_VALUES = new Set(Object.values(RADIUS));
const FONT_SIZE_VALUES = new Set(Object.values(FONT_SIZE));

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const RGB_RE = /rgba?\([^)]*\)/g;
const RADIUS_PROP_RE = /border-?[Rr]adius\s*:\s*["'`]?(\d+(?:\.\d+)?)(?:px)?\b/g;
const FONT_PROP_RE = /font-?[Ss]ize\s*:\s*["'`]?(\d+(?:\.\d+)?)(?:px)?\b/g;
const EXEMPT_COMMENT_RE = /\/\/\s*design-exempt:\s*(.+?)\s*$/;

function walk(dir, onFile) {
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, onFile);
    else if (/\.(jsx?|tsx?)$/.test(name)) onFile(full);
  }
}

function relPath(absPath) {
  return relative(REPO, absPath).split(sep).join("/");
}

// Scan one file's text for all three kinds. Returns { violations: [...], exemptions: [...] }.
export function scanFile(rel, text) {
  const violations = [];
  const exemptions = [];
  const lines = text.split("\n");

  const record = (kind, lineNo, snippet, detail) => {
    const line = lines[lineNo - 1] || "";
    const exemptMatch = line.match(EXEMPT_COMMENT_RE);
    const entry = { file: rel, line: lineNo, kind, snippet: snippet.trim(), detail };
    if (exemptMatch) exemptions.push({ ...entry, reason: exemptMatch[1].trim() });
    else violations.push(entry);
  };

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    for (const m of line.matchAll(HEX_RE)) record("hex", lineNo, line, m[0]);
    for (const m of line.matchAll(RGB_RE)) record("hex", lineNo, line, m[0]);
    for (const m of line.matchAll(RADIUS_PROP_RE)) {
      const val = parseFloat(m[1]);
      if (!RADIUS_VALUES.has(val)) record("radius", lineNo, line, `${m[0]} (${val} not in RADIUS scale)`);
    }
    for (const m of line.matchAll(FONT_PROP_RE)) {
      const val = parseFloat(m[1]);
      if (!FONT_SIZE_VALUES.has(val)) record("fontSize", lineNo, line, `${m[0]} (${val} not in FONT_SIZE scale)`);
    }
  });

  return { violations, exemptions };
}

export function scanRepo({ root = SRC } = {}) {
  const allViolations = [];
  const allExemptions = [];
  const exemptFiles = new Set();
  walk(root, (absPath) => {
    const rel = relPath(absPath);
    if (EXEMPT_FILES.has(rel)) { exemptFiles.add(rel); return; }
    const text = readFileSync(absPath, "utf8");
    const { violations, exemptions } = scanFile(rel, text);
    allViolations.push(...violations);
    allExemptions.push(...exemptions);
  });
  return { violations: allViolations, exemptions: allExemptions, exemptFiles: [...exemptFiles].sort() };
}

export function auditAll() {
  const { violations, exemptions, exemptFiles } = scanRepo();
  const counts = { hex: 0, radius: 0, fontSize: 0 };
  for (const v of violations) counts[v.kind]++;
  return { violations, exemptions, exemptFiles, counts, total: violations.length };
}

function loadCeiling() {
  if (!existsSync(CEILING)) return null;
  return JSON.parse(readFileSync(CEILING, "utf8"));
}

function writeCeiling(report) {
  const ceiling = {
    hexCeiling: report.counts.hex,
    radiusCeiling: report.counts.radius,
    fontSizeCeiling: report.counts.fontSize,
    writtenAt: new Date().toISOString().slice(0, 10),
    note: "Ratchet ceiling for ui-audit/design-drift-audit.mjs --check (same shape as " +
      "scripts/verification-queue-ceiling.json). Regenerate with " +
      "`node ui-audit/design-drift-audit.mjs --write-ceiling` after a session genuinely lowers a " +
      "count — never raise it to silence a real regression.",
  };
  writeFileSync(CEILING, JSON.stringify(ceiling, null, 2) + "\n");
  return ceiling;
}

export function checkCeiling(report, ceiling) {
  const problems = [];
  if (!ceiling) {
    problems.push("No ui-audit/design-drift-ceiling.json — run --write-ceiling once to establish a baseline.");
    return { ok: false, problems };
  }
  for (const [kind, key] of [["hex", "hexCeiling"], ["radius", "radiusCeiling"], ["fontSize", "fontSizeCeiling"]]) {
    if (report.counts[kind] > ceiling[key]) {
      const offenders = report.violations.filter((v) => v.kind === kind).slice(0, 10)
        .map((v) => `${v.file}:${v.line}`).join(", ");
      problems.push(
        `${kind} drift grew: ${report.counts[kind]} > ceiling ${ceiling[key]}. ` +
        `New/moved offenders (first 10): ${offenders || "(see full report)"}`
      );
    }
  }
  return { ok: problems.length === 0, problems };
}

function printReport(report) {
  console.log(`design-drift-audit — ${report.total} violation(s) across scanned src/**/*.{js,jsx}`);
  console.log(`  raw hex/rgb literals:      ${report.counts.hex}`);
  console.log(`  off-scale borderRadius:    ${report.counts.radius}`);
  console.log(`  off-scale fontSize:        ${report.counts.fontSize}`);
  console.log(`  files exempted (token layer + drawing surface): ${report.exemptFiles.length}`);
  for (const f of report.exemptFiles) console.log(`    · ${f}`);
  console.log(`  inline // design-exempt: comments honored: ${report.exemptions.length}`);
  for (const e of report.exemptions) console.log(`    · ${e.file}:${e.line} [${e.kind}] ${e.snippet} — ${e.reason}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const report = auditAll();
  if (process.argv.includes("--write-ceiling")) {
    const ceiling = writeCeiling(report);
    console.log(`ui-audit/design-drift-ceiling.json written — hex=${ceiling.hexCeiling}, radius=${ceiling.radiusCeiling}, fontSize=${ceiling.fontSizeCeiling}.`);
  } else if (process.argv.includes("--check")) {
    const { ok, problems } = checkCeiling(report, loadCeiling());
    if (!ok) {
      console.error("Design-drift ceiling check FAILED:\n" + problems.map((p) => "  • " + p).join("\n"));
      process.exit(1);
    }
    console.log(`Design-drift ceiling check passed (hex ${report.counts.hex}, radius ${report.counts.radius}, fontSize ${report.counts.fontSize} — all ≤ ceiling).`);
  } else if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
}
