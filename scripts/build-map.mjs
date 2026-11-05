#!/usr/bin/env node
/*
 * build-map.mjs — generate (and drift-check) the committed repo-root MAP.md (B637).
 *
 * WHY: every design session cold-searches the repo to reconfirm the same paths and symbols.
 * MAP.md is the always-committed, project-knowledge-indexed answer: for each source file it
 * records its path, module owner, exported symbols, and a one-line human responsibility.
 *
 * HOUSE RULES honoured:
 *   • Dependency-free — Node fs + regex only, no new packages (mirrors build-parcel-snapshot.mjs).
 *   • Descriptions are the human-value column and are PRESERVED across regenerations, keyed by
 *     path (parsed back out of the committed MAP.md). A brand-new file gets a description DERIVED
 *     from its own header comment (`deriveDescription`), never a placeholder (NEW-1, 2026-11-05).
 *   • Deterministic — NO volatile date/commit-hash stamp in the header (NEW-1, B<PENDING>,
 *     2026-09-08). A stamp that changes every run made this file (and its `--check` drift guard)
 *     look dirty on every regeneration even with zero real content change — a commit whose entire
 *     diff was "Refresh MAP.md's generated-at stamp" was observed shipping for exactly that reason.
 *     `--check` already only compares the file/export INVENTORY (see `inventorySignature` below),
 *     never the header text, so dropping the stamp changes nothing it enforces.
 *
 * MODES:
 *   node scripts/build-map.mjs            → regenerate MAP.md (preserving descriptions)
 *   node scripts/build-map.mjs --check    → CI drift guard. Fails (exit 1) if the committed
 *                                           MAP.md's file/export inventory has drifted from a
 *                                           fresh scan, OR if any `TODO — describe` remains.
 *                                           Descriptions themselves are preserved, not diffed.
 *
 * The `--check` failure is what the "regenerate MAP.md in the same commit as any file add/
 * remove/rename or primary-export change" rule (CLAUDE.md) is enforced by. Mirrors the
 * ui-audit/*-audit.mjs pattern (export an audit fn the unit test imports; exit non-zero standalone).
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, basename } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const MAP_PATH = join(REPO, "MAP.md");

const CODE_EXT = /\.(?:js|jsx|mjs|ts|tsx)$/;
const TODO = "TODO — describe";

// ----------------------------------------------------------------------------------------
// Roots we scan. The brief names src/, lib/, public/sequence/ — there is no top-level lib/
// in this repo (lib code lives under src/workspaces/*/lib, already covered by walking src/),
// and public/sequence/index.html is the Scheduler ("Schedule") iframe carrying an inline app.
// /server is listed as folder structure only — never its contents or env values.
// ----------------------------------------------------------------------------------------
const SCAN_DIRS = ["src"];
const SCAN_FILES = ["public/sequence/index.html"];

// Module-owner classification, most-specific path prefix first.
const OWNERS = [
  ["public/sequence/", "Schedule"],
  ["src/workspaces/site-planner/", "Site Planner"],
  ["src/workspaces/scheduler/", "Schedule"],
  ["src/workspaces/doc-review/", "Doc Review"],
  ["src/workspaces/library/", "Library"],
  ["src/shared/", "shared lib"],
  ["src/app/", "infra"],
];
// Fixed display order for module sections.
const OWNER_ORDER = ["infra", "shared lib", "Site Planner", "Schedule", "Doc Review", "Library", "server"];

function ownerFor(relPath) {
  for (const [prefix, owner] of OWNERS) if (relPath.startsWith(prefix)) return owner;
  return "infra"; // src/main.jsx, src/index.css, and any un-prefixed root file
}

function walk(dir, onFile) {
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, onFile);
    else onFile(full);
  }
}

// ----------------------------------------------------------------------------------------
// Export parsing (ES modules). Returns the sorted, de-duplicated list of exported names.
// ----------------------------------------------------------------------------------------
function parseExports(src) {
  const names = new Set();
  const add = (n) => { if (n) names.add(n.trim()); };

  // export default function/class NAME | export default <anything-else>
  for (const m of src.matchAll(/^export\s+default\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) add(`default (${m[1]})`);
  for (const m of src.matchAll(/^export\s+default\s+class\s+([A-Za-z_$][\w$]*)/gm)) add(`default (${m[1]})`);
  if (/^export\s+default\s+(?!function|class)/m.test(src)) add("default");

  // export [async] function NAME  |  export function* NAME
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) add(m[1]);
  // export class NAME
  for (const m of src.matchAll(/^export\s+class\s+([A-Za-z_$][\w$]*)/gm)) add(m[1]);
  // export const/let/var NAME
  for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) add(m[1]);

  // export { a, b as c, ... }  (possibly multi-line, possibly `... from "x"`)
  for (const m of src.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const t = part.trim();
      if (!t) continue;
      const asMatch = t.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
      add(asMatch ? asMatch[1] : t.split(/\s+/)[0]);
    }
  }
  // export * from "x" | export * as ns from "x"
  for (const m of src.matchAll(/^export\s+\*(?:\s+as\s+([A-Za-z_$][\w$]*))?\s+from\s+["']([^"']+)["']/gm)) {
    add(m[1] ? `* as ${m[1]} (${m[2]})` : `* (${m[2]})`);
  }

  return [...names].sort((a, b) => a.localeCompare(b));
}

// The Schedule iframe is one big inline <script> (no ES exports). Its public surface is the
// set of TOP-LEVEL (column-0) function-like declarations — GanttView, buildGanttSVG, the
// embedded formula engine, etc. — which is what the brief asks us to list for it.
function parseInlineTopLevel(src) {
  const names = new Set();
  const add = (n) => names.add(n);
  for (const m of src.matchAll(/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) add(m[1]);
  for (const m of src.matchAll(/^class\s+([A-Za-z_$][\w$]*)/gm)) add(m[1]);
  // top-level const/let assigned an arrow or function expression
  for (const m of src.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\*?\s*\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/gm)) add(m[1]);
  return [...names].sort((a, b) => a.localeCompare(b));
}

// ----------------------------------------------------------------------------------------
// Scan the tree → the authoritative inventory [{ path, owner, exports }].
// ----------------------------------------------------------------------------------------
export function scanRepo() {
  const files = [];
  for (const d of SCAN_DIRS) {
    const abs = join(REPO, d);
    if (existsSync(abs)) walk(abs, (f) => {
      const rel = relative(REPO, f).split("\\").join("/");
      if (!CODE_EXT.test(rel)) return;
      if (/\.(test|spec)\./.test(rel)) return; // tests live in /test, but guard anyway
      files.push(rel);
    });
  }
  for (const f of SCAN_FILES) if (existsSync(join(REPO, f))) files.push(f);

  const inv = [];
  for (const rel of files) {
    const src = readFileSync(join(REPO, rel), "utf8");
    const exports = rel.endsWith(".html") ? parseInlineTopLevel(src) : parseExports(src);
    inv.push({ path: rel, owner: ownerFor(rel), exports });
  }
  inv.sort((a, b) => a.path.localeCompare(b.path));
  return inv;
}

// ----------------------------------------------------------------------------------------
// Derive a real one-line description for a file that has none yet (NEW-1, 2026-11-05).
//
// WHY: a brand-new file used to arrive as `TODO — describe`. The nightly regen job commits whatever
// this script writes, and `--check` / test/resolveLedgers.test.js both forbid a placeholder — so
// when the job sat unmergeable for weeks (it cannot open its own PR), the first regen after the gap
// wrote ~586 placeholders and turned main's required `build` red. A generator whose default output
// fails its own guard can never run unattended. So the default is now a genuine description taken
// from the file itself: the first sentence of its leading comment (every file here carries one),
// else a factual line built from its exports. A description a human wrote is still preserved, keyed
// by path, and always wins.
// ----------------------------------------------------------------------------------------
const MAX_DESC = 190;
const PRAGMA = /^(?:eslint|@ts-|prettier-ignore|istanbul|c8 |vitest-environment|@vitest|global |jshint)/i;

/** Pull the leading comment blocks out of a source string as cleaned plain-text paragraphs. */
function leadingComments(src) {
  const out = [];
  let rest = src.replace(/^﻿/, "").replace(/^#!.*\n/, "");
  for (let guard = 0; guard < 8; guard++) {
    rest = rest.replace(/^\s+/, "");
    rest = rest.replace(/^(["'])use (?:strict|client)\1;?/, "").replace(/^\s+/, "");
    // Some files import first and put their header comment after the imports — step over them.
    for (let i = 0; i < 40 && /^import\b/.test(rest); i++) {
      const m = rest.match(/^import\s+(?:[^"';]*?\sfrom\s*)?(["'])[^"']+\1[^\n;]*;?[ \t]*/);
      if (!m) break;
      rest = rest.slice(m[0].length).replace(/^[ \t]*\/\/[^\n]*/, "").replace(/^\s+/, ""); // + same-line `// note`
    }
    let text = null;
    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      if (end < 0) break;
      text = rest.slice(2, end).replace(/^\*+/, "")
        .split("\n").map((l) => l.replace(/^\s*\*+ ?/, "")).join(" ");
      rest = rest.slice(end + 2);
    } else if (rest.startsWith("//")) {
      const lines = [];
      const re = /^\/\/+ ?(.*)(?:\n|$)/;
      let m;
      while ((m = rest.match(re))) { lines.push(m[1]); rest = rest.slice(m[0].length); }
      text = lines.join(" ");
    } else break;
    text = text.replace(/\s+/g, " ").trim();
    if (text && !PRAGMA.test(text)) out.push(text);
  }
  return out;
}

/** First sentence of a comment, minus a leading "file.js —" self-reference, capped in length. */
function firstSentence(text, relPath) {
  const base = basename(relPath);
  const self = new RegExp("^(?:" + [relPath, base, base.replace(/\.[^.]+$/, "")]
    .map((s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|") + ")\\s*(?:[—–:-]+)\\s*", "i");
  let t = text.replace(self, "").trim();
  // "Name (history, ticket refs) — rest" → "rest"
  const stem = base.replace(/\.[^.]+$/, "").replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  t = t.replace(new RegExp("^" + stem + "\\s*\\([^)]*\\)\\s*[—–:-]+\\s*", "i"), "").trim();
  // Drop a leading ticket label ("B2092656 ×3 — ", "NEW-1 (Silvestri zoom freeze) — ") when real text follows.
  const ticket = t.replace(/^(?:B-NEW-\d+|B\d+|NEW-\d+)(?:\s*[×x]\d+)?(?:\s*\([^)]*\))?(?:\s*\/\s*(?:B\d+|NEW-\d+))*\s*[—–:-]+\s*/, "");
  if (ticket.length >= 24) t = ticket;
  // A sentence ends at ". " / "? " / "! " unless it is a known abbreviation ("e.g. ", "i.e. ", "vs. ").
  // Keep adding sentences until the line carries some substance (a lone "Building panel v3 (NEW-2)." does not).
  const re = /[.?!](?=\s)/g;
  let m, cut = -1;
  while ((m = re.exec(t))) {
    if (/(?:\be\.g|\bi\.e|\bvs|\betc|\bcf|\bno|\bapprox|\bB\d+|\bNEW-\d+)$/i.test(t.slice(0, m.index + 1).slice(-8))) continue;
    if (m.index < 24) continue; // "B123." / "Note." — too short to stand alone, keep going
    cut = m.index + 1;
    if (cut >= 60 || cut >= MAX_DESC) break;
  }
  if (cut > 0) t = t.slice(0, cut);
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > MAX_DESC) {
    const sp = t.lastIndexOf(" ", MAX_DESC - 1);
    t = t.slice(0, sp > 60 ? sp : MAX_DESC).replace(/[\s,;:—–(-]+$/, "") + "…";
  }
  if (/^[a-z]+(?=[\s,;:—–])/.test(t)) t = t[0].toUpperCase() + t.slice(1); // "a compact chip…" → "A compact chip…"
  return t;
}

export function deriveDescription(relPath, src, exports = []) {
  for (const c of leadingComments(src)) {
    const s = firstSentence(c, relPath);
    if (s.length >= 12) return s;
  }
  // No usable header comment: a factual line from the file's own exports — never a placeholder.
  const shown = exports.slice(0, 4).map((e) => e.replace(/^default \((.+)\)$/, "$1").replace(/^default$/, "default export"));
  if (shown.length) {
    const more = exports.length > shown.length ? ` (+${exports.length - shown.length} more)` : "";
    return `Module exporting ${shown.join(", ")}${more}.`;
  }
  return `Side-effect module (${basename(relPath)}), no exports.`;
}

// ----------------------------------------------------------------------------------------
// Parse an existing MAP.md → { descriptions: Map(path→desc), inventory: [{path, exports}] }.
// Used to (a) preserve descriptions on regen and (b) drift-compare in --check.
// Line format authored by render(): `- **\`path\`** — description` then `  - _exports_: ...`.
// ----------------------------------------------------------------------------------------
function parseMap(text) {
  const descriptions = new Map();
  const committed = []; // [{path, exports}]
  const lines = text.split("\n");
  let pending = null;
  const flush = () => { if (pending) committed.push(pending); pending = null; };
  for (const line of lines) {
    const fileM = line.match(/^- \*\*`(.+?)`\*\* — (.*)$/);
    if (fileM) {
      flush();
      const path = fileM[1];
      const desc = fileM[2].replace(/\\\|/g, "|").trim();
      descriptions.set(path, desc);
      pending = { path, exports: [] };
      continue;
    }
    const expM = line.match(/^ {2}- _exports_: (.*)$/);
    if (expM && pending) {
      const raw = expM[1].trim();
      pending.exports = raw === "_(none)_"
        ? []
        : [...raw.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    }
  }
  flush();
  committed.sort((a, b) => a.path.localeCompare(b.path));
  return { descriptions, committed };
}

// A stable, description-free signature for drift comparison.
function inventorySignature(inv) {
  return JSON.stringify(
    inv.map((f) => ({ p: f.path, e: f.exports })).sort((a, b) => a.p.localeCompare(b.p)),
  );
}

// ----------------------------------------------------------------------------------------
// Render MAP.md from the scanned inventory + a description store.
// ----------------------------------------------------------------------------------------
export function render(inv, descriptions) {
  const byOwner = new Map();
  for (const f of inv) {
    if (!byOwner.has(f.owner)) byOwner.set(f.owner, []);
    byOwner.get(f.owner).push(f);
  }
  const owners = [...byOwner.keys()].sort((a, b) => {
    const ia = OWNER_ORDER.indexOf(a), ib = OWNER_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

  const out = [];
  out.push("# MAP.md — Planyr codebase map");
  out.push("");
  out.push("> **Generated by `scripts/build-map.mjs` — do not hand-edit the inventory.**");
  out.push("> This file is committed so project-knowledge sync indexes it and a session can orient without");
  out.push("> cold-searching the repo. Each entry: **path** — one-line responsibility, then its exported symbols.");
  out.push(">");
  out.push("> **Regenerate it in the SAME commit whenever you add/remove/rename a file or change a primary");
  out.push("> export** (`node scripts/build-map.mjs`); CI runs `--check` and fails the build on drift. The");
  out.push("> one-line responsibilities are the human-value column — the script **preserves** them across");
  out.push("> regenerations (keyed by path); a new file arrives described from its own header comment (edit the line");
  out.push("> here to improve it and the edit sticks). Only the inventory (paths + exports) is drift-checked.");
  out.push(">");
  out.push("> Module owners: **infra** (shell/entry), **shared lib** (`src/shared/*`), **Site Planner**");
  out.push("> (incl. Cost/yield takeoff), **Schedule** (`src/workspaces/scheduler` + the `public/sequence`");
  out.push("> iframe), **Doc Review**, **Library**. `/server` is listed as folder structure only (below) —");
  out.push("> never its contents or secrets.");
  out.push("");
  out.push(`_${inv.length} source files mapped._`);
  out.push("");

  for (const owner of owners) {
    const files = byOwner.get(owner).sort((a, b) => a.path.localeCompare(b.path));
    out.push(`## ${owner}`);
    out.push("");
    for (const f of files) {
      const desc = (descriptions.get(f.path) || TODO).replace(/\|/g, "\\|");
      out.push(`- **\`${f.path}\`** — ${desc}`);
      const exp = f.exports.length ? f.exports.map((e) => `\`${e}\``).join(", ") : "_(none)_";
      out.push(`  - _exports_: ${exp}`);
    }
    out.push("");
  }

  // /server: folder structure only — never contents or env values.
  out.push("## server (structure only — contents & secrets deliberately not mapped)");
  out.push("");
  out.push("```");
  out.push(serverTree());
  out.push("```");
  out.push("");
  return out.join("\n");
}

function serverTree() {
  const root = join(REPO, "server");
  if (!existsSync(root)) return "server/  (absent)";
  const lines = [];
  const walkDirs = (dir, prefix) => {
    const entries = readdirSync(dir).sort();
    const dirs = entries.filter((e) => {
      try { return statSync(join(dir, e)).isDirectory(); } catch { return false; }
    });
    for (const d of dirs) {
      lines.push(`${prefix}${d}/`);
      walkDirs(join(dir, d), prefix + "  ");
    }
  };
  lines.push("server/");
  walkDirs(root, "  ");
  return lines.join("\n");
}

// ----------------------------------------------------------------------------------------
// Public audit fn (imported by test/mapDrift.test.js) + CLI.
// ----------------------------------------------------------------------------------------
export function auditMap() {
  const inv = scanRepo();
  if (!existsSync(MAP_PATH)) {
    return { ok: false, problems: ["MAP.md does not exist — run `node scripts/build-map.mjs`."], todos: [], drift: null };
  }
  const text = readFileSync(MAP_PATH, "utf8");
  const { descriptions, committed } = parseMap(text);

  const problems = [];
  const freshSig = inventorySignature(inv);
  const committedSig = inventorySignature(committed);
  let drift = null;
  if (freshSig !== committedSig) {
    const freshPaths = new Set(inv.map((f) => f.path));
    const commPaths = new Set(committed.map((f) => f.path));
    const added = [...freshPaths].filter((p) => !commPaths.has(p));
    const removed = [...commPaths].filter((p) => !freshPaths.has(p));
    const commByPath = new Map(committed.map((f) => [f.path, f.exports]));
    const changed = inv
      .filter((f) => commByPath.has(f.path) && JSON.stringify(commByPath.get(f.path)) !== JSON.stringify(f.exports))
      .map((f) => f.path);
    drift = { added, removed, changed };
    if (added.length) problems.push(`MAP.md is stale — new files not mapped: ${added.join(", ")}`);
    if (removed.length) problems.push(`MAP.md is stale — mapped files no longer exist: ${removed.join(", ")}`);
    if (changed.length) problems.push(`MAP.md is stale — exports changed: ${changed.join(", ")}`);
    problems.push("Run `node scripts/build-map.mjs` and commit MAP.md.");
  }

  const todos = [...descriptions.entries()].filter(([, d]) => d.startsWith(TODO)).map(([p]) => p);
  if (todos.length) problems.push(`MAP.md has undescribed files (fill in the one-liner): ${todos.join(", ")}`);

  return { ok: problems.length === 0, problems, todos, drift };
}

function generate() {
  const inv = scanRepo();
  let descriptions = new Map();
  if (existsSync(MAP_PATH)) descriptions = parseMap(readFileSync(MAP_PATH, "utf8")).descriptions;
  // A file with no (or a placeholder) description gets one derived from the file itself.
  let derived = 0;
  for (const f of inv) {
    const have = descriptions.get(f.path);
    if (have && !have.startsWith(TODO)) continue;
    descriptions.set(f.path, deriveDescription(f.path, readFileSync(join(REPO, f.path), "utf8"), f.exports));
    derived++;
  }
  writeFileSync(MAP_PATH, render(inv, descriptions));
  const todo = inv.filter((f) => !descriptions.get(f.path) || descriptions.get(f.path).startsWith(TODO)).length;
  console.log(`MAP.md written — ${inv.length} files, ${derived} newly described from their own header, ${todo} awaiting a description.`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  if (process.argv.includes("--check")) {
    const { ok, problems } = auditMap();
    if (!ok) { console.error("MAP.md drift check FAILED:\n" + problems.map((p) => "  • " + p).join("\n")); process.exit(1); }
    console.log("MAP.md drift check passed.");
  } else {
    generate();
  }
}
