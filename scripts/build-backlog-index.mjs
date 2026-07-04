#!/usr/bin/env node
/*
 * build-backlog-index.mjs — generate (and drift-check) repo-root BACKLOG_OPEN.md (B638).
 *
 * WHY: the flat B# list in BACKLOG.md hides related work (persistence alone spans 7+ items) and
 * a chat session that can't open the 200 KB BACKLOG.md can't see what's already filed. This emits
 * a small, committed, project-knowledge-indexed index — one line per Open/Verify item (B#, title,
 * module, #tags, Verify status), plus a by-tag rollup so a theme's members are visible at a glance.
 * No bodies. It is DERIVED from BACKLOG.md and must never be hand-edited.
 *
 * HOUSE RULES: dependency-free (Node fs + regex). Deterministic (no volatile date) so `--check`
 * can exact-compare. Tolerant of legacy items that predate the tag/Verify conventions — they are
 * emitted untagged / status `—` rather than crashing the parser.
 *
 * MODES:
 *   node scripts/build-backlog-index.mjs           → regenerate BACKLOG_OPEN.md
 *   node scripts/build-backlog-index.mjs --check    → CI drift guard; exit 1 if the committed
 *                                                     BACKLOG_OPEN.md differs from a fresh parse
 *                                                     of BACKLOG.md (i.e. someone edited BACKLOG.md
 *                                                     without regenerating the index).
 *
 * Mirrors ui-audit/*-audit.mjs: exports an audit fn the unit test imports; exits non-zero standalone.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const BACKLOG = join(REPO, "BACKLOG.md");
const INDEX = join(REPO, "BACKLOG_OPEN.md");

// ----------------------------------------------------------------------------------------
// Parse BACKLOG.md → the ordered list of Open + Verify items.
// State machine over `## ` section headers. Sub-headers inside Open (🎨 UI audit pass,
// 🐞 Bug audit …) are NOT boundaries — only Verify / Later-Roadmap / Done switch the mode.
// ----------------------------------------------------------------------------------------
// The legal tag legend — parsed from the "Theme tags (legend)" block in BACKLOG.md. A tag may be
// used on an item only if it appears here (the brief's no-tag-sprawl rule, mechanically enforced).
export function parseLegend(text) {
  const m = text.match(/Theme tags \(legend\)[^\n]*\n([\s\S]*?)(?:\n##|\n---|\n### )/);
  if (!m) return new Set();
  return new Set([...m[1].matchAll(/`(#[a-z][a-z0-9-]*)`/g)].map((x) => x[1]));
}

export function parseBacklog(text) {
  const lines = text.split("\n");
  const items = [];
  let mode = "pre"; // pre → open → (verify) → later/done (ignored)
  let cur = null;
  const push = () => { if (cur) items.push(cur); cur = null; };

  const sectionMode = (header) => {
    const h = header.toLowerCase();
    if (/\bopen\b/.test(h)) return "open";
    if (/\bverify\b/.test(h)) return "verify";
    if (/later|roadmap/.test(h)) return "later";
    if (/\bdone\b/.test(h)) return "done";
    return null; // an audit-pass sub-header etc. — keep current mode
  };

  for (const line of lines) {
    const secM = line.match(/^##\s+(.*)$/);
    if (secM) {
      const next = sectionMode(secM[1]);
      if (next) { push(); mode = next; }
      continue;
    }
    const itemM = line.match(/^###\s+(B\d+)\b\s*[—-]\s*(.*)$/);
    if (itemM && (mode === "open" || mode === "verify")) {
      push();
      cur = { id: itemM[1], section: mode, ...parseHeading(itemM[2]), verifyField: null };
      continue;
    }
    // While inside an item body, look for a `Verify:` field (NEW-1). First one wins.
    if (cur && cur.verifyField === null) {
      const vf = line.match(/(?:^|\s)Verify:\s*`?(sandbox|live)`?/i);
      if (vf) cur.verifyField = vf[1].toLowerCase();
    }
  }
  push();
  return items;
}

// A tag is `#` + a LETTER-led lowercase word — so PR refs like `#320` are never mistaken for tags.
const TAG_RE = /(?:^|\s)(#[a-z][a-z0-9-]*)\b/g;

// Split a heading remainder into { title, module, tags }.
function parseHeading(rest) {
  const moduleM = rest.match(/`(\[[^`\]]*\])`/);
  const module = moduleM ? moduleM[1] : "—";
  const tags = [...rest.matchAll(TAG_RE)].map((m) => m[1]);

  // Title = text up to the first structural marker (module tag, italic note, or first #tag).
  const markers = [];
  if (moduleM) markers.push(rest.indexOf(moduleM[0]));
  const noteIdx = rest.indexOf(" *(");
  if (noteIdx >= 0) markers.push(noteIdx);
  const tagIdx = rest.search(/(?:^|\s)#[a-z]/);
  if (tagIdx >= 0) markers.push(tagIdx);
  const cut = markers.length ? Math.min(...markers) : rest.length;
  let title = rest.slice(0, cut).trim();
  // Drop a trailing type parenthetical like "(feature)" / "(bug) — DATA-LOSS".
  title = title.replace(/\s*\((?:bug|feature|task|enhancement|project|umbrella|UX)[^)]*\)\s*$/i, "").trim();
  title = title.replace(/[—-]\s*$/, "").trim();
  return { title, module, tags };
}

// The Verify-status column shown for an item.
function verifyStatus(item) {
  if (item.section === "verify") return "⏳ live — awaiting";
  if (item.verifyField === "live") return "live";
  if (item.verifyField === "sandbox") return "sandbox";
  return "—"; // legacy / unset
}

// ----------------------------------------------------------------------------------------
// Render BACKLOG_OPEN.md (deterministic — no volatile fields).
// ----------------------------------------------------------------------------------------
function esc(s) { return s.replace(/\|/g, "\\|"); }

export function renderIndex(items) {
  const open = items.filter((i) => i.section === "open");
  const verify = items.filter((i) => i.section === "verify");

  const out = [];
  out.push("# BACKLOG_OPEN.md — open + verify index");
  out.push("");
  out.push("> **Generated from `BACKLOG.md` by `scripts/build-backlog-index.mjs` — do NOT hand-edit.**");
  out.push("> One line per Open / Verify item so project-knowledge sync indexes the live open list and a");
  out.push("> chat session can see what's already filed without opening the 200 KB backlog. Regenerate it");
  out.push("> in the SAME commit as any `BACKLOG.md` edit; CI runs `--check` and fails the build on drift.");
  out.push(`> _${open.length} open · ${verify.length} awaiting live verification._`);
  out.push("");

  const table = (rows) => {
    const t = ["| B# | Title | Module | Tags | Verify |", "|---|---|---|---|---|"];
    for (const i of rows) {
      const tags = i.tags.length ? i.tags.join(" ") : "—";
      t.push(`| ${i.id} | ${esc(i.title)} | ${esc(i.module)} | ${tags} | ${verifyStatus(i)} |`);
    }
    return t;
  };

  out.push("## 🔲 Open");
  out.push("");
  out.push(...(open.length ? table(open) : ["_(none)_"]));
  out.push("");

  out.push("## ⏳ Verify — awaiting live confirmation");
  out.push("");
  out.push(...(verify.length ? table(verify) : ["_(none)_"]));
  out.push("");

  // By-tag rollup: makes a theme's members (e.g. every #persistence item) visible at a glance.
  const byTag = new Map();
  for (const i of [...open, ...verify]) {
    for (const t of i.tags) {
      if (!byTag.has(t)) byTag.set(t, []);
      byTag.get(t).push(i.id);
    }
  }
  out.push("## By tag");
  out.push("");
  if (byTag.size === 0) {
    out.push("_(no tagged items yet)_");
  } else {
    for (const tag of [...byTag.keys()].sort()) {
      out.push(`- **${tag}** — ${byTag.get(tag).join(", ")}`);
    }
  }
  out.push("");
  return out.join("\n");
}

// ----------------------------------------------------------------------------------------
// Audit fn (imported by test) + CLI.
// ----------------------------------------------------------------------------------------
export function auditIndex() {
  const text = readFileSync(BACKLOG, "utf8");
  const items = parseBacklog(text);
  const legend = parseLegend(text);
  const expected = renderIndex(items);
  const problems = [];

  // Tag-sprawl guard: every tag used on an Open/Verify item must be in the legend.
  if (legend.size) {
    const unknown = new Set();
    for (const i of items) for (const t of i.tags) if (!legend.has(t)) unknown.add(`${i.id}:${t}`);
    if (unknown.size) problems.push(`Tags not in the legend (add to the legend, or fix the typo): ${[...unknown].join(", ")}`);
  }

  if (!existsSync(INDEX)) {
    problems.push("BACKLOG_OPEN.md does not exist — run `node scripts/build-backlog-index.mjs`.");
  } else if (readFileSync(INDEX, "utf8") !== expected) {
    problems.push("BACKLOG_OPEN.md is out of date with BACKLOG.md — run `node scripts/build-backlog-index.mjs` and commit it.");
  }
  return { ok: problems.length === 0, problems, expected };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  if (process.argv.includes("--check")) {
    const { ok, problems } = auditIndex();
    if (!ok) { console.error("BACKLOG_OPEN.md drift check FAILED:\n" + problems.map((p) => "  • " + p).join("\n")); process.exit(1); }
    console.log("BACKLOG_OPEN.md drift check passed.");
  } else {
    const items = parseBacklog(readFileSync(BACKLOG, "utf8"));
    writeFileSync(INDEX, renderIndex(items));
    console.log(`BACKLOG_OPEN.md written — ${items.filter((i) => i.section === "open").length} open, ${items.filter((i) => i.section === "verify").length} verify.`);
  }
}
