#!/usr/bin/env node
/* locked-primitive-audit.mjs — the CI guard behind NEW-1's "unauthorable" claim (B982400).
 *
 * WHY THIS EXISTS. `src/shared/ui/controls.jsx`'s `Tab` and `MenuTrigger` primitives destructure
 * `style`/`borderRadius`/`height`/`padding`/`fontSize` out of their props and discard them
 * (with a dev-console warning, `warnLockedOverride`) — so a caller CANNOT re-author a locked
 * control's geometry at runtime. But a silently-ignored prop is still a defect a reviewer can
 * miss: the whole point of NEW-1 ("if a caller can pass a number, this item has failed") is that
 * the attempt itself should be visible, before the code ever runs. This is the build-time half —
 * modeled directly on `design-drift-audit.mjs`'s regex-over-source shape, the same style this repo
 * already uses in place of TypeScript for "this API shape may never be used this way."
 *
 * WHAT IT FLAGS: any `<Tab` or `<MenuTrigger` JSX opening tag anywhere in `src/**\/*.{js,jsx}`
 * (excluding `controls.jsx` itself, where they're defined) that carries a `style=`, `borderRadius=`,
 * `height=`, `padding=`, or `fontSize=` prop. Zero tolerance, not a ratchet — these are two brand
 * new primitives with no pre-existing debt to inherit, so any hit is new drift.
 *
 * ⚠ NOT A REAL JSX PARSE, and it took TWO teeth-check failures against this codebase's own real
 * `Tab`/`MenuTrigger` call sites to get the walker right — both worth recording, because both are
 * the exact shape either primitive is meant to hold (an `icon`/`leading` slot carrying a styled
 * child), not an edge case to special-case away:
 *   1. A plain non-greedy "up to the next `>`" regex stopped at a NESTED element's own closing
 *      `>` (e.g. `leading={<span style={avatar(false)}>…}`) before ever reaching the outer tag's
 *      real close, and misread the nested element's `style=` as the outer tag's own.
 *   2. Fixed to find the real end via BRACE DEPTH (below) — then the "real repo" check flagged
 *      `width="13" height="13"` on a nested `<svg icon>` and that same `<svg>`'s own `style={{…}}`,
 *      because a flat regex over the correctly-bounded props span still can't tell "this word
 *      appears somewhere in the tag" from "this is a prop of the OUTER tag" once a nested
 *      element's own attributes are inside that span.
 * So there are two depth-aware passes: `findOpenTagEnd` walks `{...}` BRACE DEPTH from the
 * component name to find the real closing `>`/`/>` (only accepted at depth 0 — a nested
 * element's own `>` sits at depth ≥ 1 and is skipped); `topLevelBannedProp` then re-walks that
 * bounded span and only counts a banned-prop match that ALSO sits at depth 0 — one buried inside
 * a nested element's own attributes (itself inside some prop's `{...}` expression) is depth ≥ 1
 * and is correctly ignored. Still not a full parser: a `{`/`}` inside a plain string attribute
 * (e.g. `title="a{b}"`) would desync the depth count. Neither primitive takes an attribute shaped
 * like that anywhere in this codebase today.
 *
 * USAGE:
 *   node ui-audit/locked-primitive-audit.mjs          → print the report
 *   node ui-audit/locked-primitive-audit.mjs --json    → machine-readable report
 *   node ui-audit/locked-primitive-audit.mjs --check   → CI gate; exit 1 on any violation
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, sep } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const SRC = join(REPO, "src");

// Where the primitives are DEFINED — the only file allowed to reference the banned prop names in
// the same breath as `Tab`/`MenuTrigger` (its own destructuring assignment, not a JSX call site).
const DEFINITION_FILE = "src/shared/ui/controls.jsx";

const LOCKED_COMPONENTS = ["Tab", "MenuTrigger"];
const BANNED_PROPS = ["style", "borderRadius", "height", "padding", "fontSize"];
const OPEN_TAG_START_RE = new RegExp(`<(${LOCKED_COMPONENTS.join("|")})\\b`, "g");
const BANNED_PROP_RE = new RegExp(`\\b(${BANNED_PROPS.join("|")})\\s*=`, "g");

// Find the real end of a JSX opening tag starting at `fromIdx` (just past the component name):
// walk forward tracking `{...}` brace depth, and accept a bare `>` or `/>` only at depth 0 — a
// `>` that closes a NESTED element inside a prop's expression container sits at depth ≥ 1 and is
// skipped. Returns the index just past the terminating `>` (exclusive), or -1 if the tag never
// closes in this file (malformed/truncated source — refuse to guess).
function findOpenTagEnd(text, fromIdx) {
  let depth = 0;
  for (let i = fromIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (depth === 0 && ch === ">") return i + 1;
  }
  return -1;
}

// Within a tag's own props span (component name to its real closing `>`, from findOpenTagEnd),
// find the first banned-prop match that is a TOP-LEVEL prop of THIS tag — i.e. sits at brace
// depth 0, never inside a nested element's own attributes (which live at depth ≥ 1, inside
// whichever prop's `{...}` expression carries that nested element). Returns the prop name or null.
function topLevelBannedProp(span) {
  for (const m of span.matchAll(BANNED_PROP_RE)) {
    let depth = 0;
    for (let i = 0; i < m.index; i++) {
      if (span[i] === "{") depth++;
      else if (span[i] === "}") depth--;
    }
    if (depth === 0) return m[1];
  }
  return null;
}

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

// Scan one file's text for a locked-component call site carrying a banned prop.
export function scanFile(rel, text) {
  if (rel === DEFINITION_FILE) return [];
  const violations = [];
  for (const m of text.matchAll(OPEN_TAG_START_RE)) {
    const component = m[1];
    const nameEnd = m.index + m[0].length;
    const tagEnd = findOpenTagEnd(text, nameEnd);
    if (tagEnd === -1) continue; // malformed/truncated — nothing safe to assert
    const propsSpan = text.slice(nameEnd, tagEnd);
    const prop = topLevelBannedProp(propsSpan);
    if (!prop) continue;
    const lineNo = text.slice(0, m.index).split("\n").length;
    violations.push({ file: rel, line: lineNo, component, prop });
  }
  return violations;
}

export function scanRepo({ root = SRC } = {}) {
  const violations = [];
  walk(root, (absPath) => {
    const rel = relPath(absPath);
    const text = readFileSync(absPath, "utf8");
    violations.push(...scanFile(rel, text));
  });
  return violations;
}

export function auditAll() {
  const violations = scanRepo();
  return { violations, total: violations.length };
}

function printReport(report) {
  console.log(`locked-primitive-audit — ${report.total} violation(s) across scanned src/**/*.{js,jsx}`);
  for (const v of report.violations) {
    console.log(`  · ${v.file}:${v.line} — <${v.component}> carries \`${v.prop}=\`, which is not allowed (see docs/DESIGN.md's shape rule).`);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const report = auditAll();
  if (process.argv.includes("--check")) {
    if (report.total > 0) {
      console.error(`Locked-primitive audit FAILED — ${report.total} violation(s):`);
      for (const v of report.violations) console.error(`  • ${v.file}:${v.line} — <${v.component}> carries \`${v.prop}=\``);
      process.exit(1);
    }
    console.log("Locked-primitive audit passed — no Tab/MenuTrigger call site carries a geometry override.");
  } else if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
}
