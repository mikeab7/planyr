#!/usr/bin/env node
/* audit-hidden-content-reads — WHO READS THE RAW ELEMENT LIST, AND IS THAT RIGHT?
 *
 * ⛔ THE QUESTION B3296 RAISED AND DID NOT ANSWER. The dissolved road network painted hidden roads
 * because it read `els` — the whole model — where the drawing wanted the VISIBLE subset. One filter
 * fixed it. The obvious next question is how many other reads are in the same position, and the only
 * honest way to answer "none" is with a search that has been shown to find the one we know about.
 *
 * ── WHAT THIS IS, AND WHAT IT IS NOT ────────────────────────────────────────────────────────────
 * It is an ENUMERATOR with a REQUIRED DECLARATION, not a bug detector. Every top-level binding in
 * the planner (and in the export path) whose body reads a raw collection must appear in
 * `lib/hiddenContentReads.js` with one of two verdicts and a reason:
 *
 *   "must-filter"       — it produces a PICTURE, or an artefact a person reads as truth: drawn
 *                         geometry, a merged surface, the printed sheet, a click target, a snap
 *                         magnet, an extent the view or the paper is framed to. Reading the whole
 *                         model here is WRONG, and the body must ask the visibility predicate.
 *   "correct-unfiltered" — it is a COUNT, a SAVE, an UNDO frame, a REGULATORY inference or an
 *                         engineering ledger. Hiding is a view state and must never move these.
 *                         **Filtering one of these would be a worse bug than the one B3296 fixed**,
 *                         so the declaration exists to stop a future session "tidying" a filter in.
 *
 * An undeclared read is REPORTED, never assumed benign — the whole failure mode here is a call site
 * nobody had enumerated.
 *
 * ── ⛔ THE TEETH PROOF, WHICH RUNS BEFORE ANY RESULT IS TRUSTED ─────────────────────────────────
 * `--teeth <gitref>` re-runs the whole sweep against a checked-out older tree and requires it to
 * FAIL on the known defect. Pointed at the commit before B3296, it must report `roadNet` as an
 * unfiltered must-filter read. A null from an untested search is not evidence; this repo has paid
 * for that lesson repeatedly, and once in front of the owner.
 *
 *   node ui-audit/audit-hidden-content-reads.mjs [--json] [--teeth <ref>]
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { DECLARATIONS, RAW_COLLECTIONS, VERDICT } from "../src/workspaces/site-planner/lib/hiddenContentReads.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DECLARED_NAMES = new Set(DECLARATIONS.map((d) => d.name));

/** The files a drawn/printed artefact can be produced from. */
export const SWEPT_FILES = [
  "src/workspaces/site-planner/SitePlanner.jsx",
  "src/workspaces/site-planner/lib/exportSheet.js",
];

/* A binding is `const <name> = …` at the top level of a function body (two-space indent in this
 * file's house style) or at module scope. We take the source from the binding to the next binding at
 * the same indent, which is coarse but never SPLITS a body — and a body read too WIDE can only ever
 * produce a false POSITIVE (an extra thing to declare), never a false negative. That asymmetry is
 * the point: this search may cost a declaration it did not need, but it cannot miss a read. */
const BINDING = /^(\s*)(?:export\s+)?(?:const|let|function)\s+([A-Za-z_$][\w$]*)\s*[=(]/;

/* ⛔ ONLY TOP-LEVEL BINDINGS, and the reason is the first version of this file.
 *
 * Matching every `const` at any depth reported 282 "undeclared reads" — one per `const el = …`
 * inside a loop — while MISSING `roadNet`, `drawEls` and `fit` entirely, because slicing a body at
 * the next `const` of any depth cut each memo off at its own first inner line, before the `els` read
 * it exists for. A search that drowns you in noise AND misses the thing you already know is broken
 * is worse than no search: it produces a long output that reads like diligence.
 *
 * So bindings are taken at module scope (indent 0) and at component-body scope (indent 2) only, and
 * a body runs to the next binding at the SAME OR SHALLOWER indent — which swallows every inner
 * `const`, and therefore attributes an inner read to the enclosing thing that has a name worth
 * declaring. Reading a body too WIDE can only ever cost an extra declaration; it cannot miss a read.
 */
const TOP_LEVEL_INDENTS = new Set([0, 2]);

export function bindingsIn(src) {
  const lines = src.split("\n");
  const starts = [];
  lines.forEach((l, i) => {
    const m = l.match(BINDING);
    if (m && TOP_LEVEL_INDENTS.has(m[1].length)) starts.push({ name: m[2], indent: m[1].length, line: i });
  });
  return starts.map((s, k) => {
    let end = lines.length;
    for (let j = k + 1; j < starts.length; j++) { if (starts[j].indent <= s.indent) { end = starts[j].line; break; } }
    return { name: s.name, line: s.line + 1, body: lines.slice(s.line, end).join("\n") };
  });
}

/** Which raw collections does this body read? Assignments and comments do not count. */
export function rawReadsOf(body) {
  const code = body
    .replace(/\/\*[\s\S]*?\*\//g, "")           // block comments
    .replace(/^\s*\/\/.*$/gm, "")               // line comments
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");       // template literals (prose in JSX titles)
  const hits = [];
  for (const c of RAW_COLLECTIONS) {
    /* The identifier ALONE — `els`, not `drawEls`, `gsEls`, `setEls` or `el.els`. A read through the
     * already-filtered draw set is not a raw read and must not be reported as one. */
    const re = new RegExp(`(?<![\\w$.])${c}(?![\\w$])`, "g");
    if (re.test(code)) hits.push(c);
  }
  return hits;
}

/** Does this body ask the visibility predicate at all? */
export const asksPredicate = (body) => /elHidden\s*\(|isHidden\s*\(|hiddenGroups|visibleEls|drawEls/.test(body);

/* ⛔ THE NARROWING, AND WHY IT IS PRINCIPLED RATHER THAN CONVENIENT.
 *
 * "Reads a raw collection" matched 243 bindings — nearly every handler, menu builder and selector in
 * the planner. A 243-row table is not an audit; it is a place for the one row that matters to hide,
 * and nobody would ever re-read it. But narrowing has to be defended, because the temptation is to
 * narrow until the answer is clean.
 *
 * So the filter is the OWNER'S OWN LIST, not a convenience: a read matters here when the binding also
 * does one of the six things that turn a model read into something a person looks at and believes.
 * Everything else — a click handler that mutates, a menu that lists, a selector that finds one
 * element by id — reads the whole model because it SHOULD: you can still address a hidden object
 * from the panel that is editing it, and nothing it produces claims to depict the drawing.
 *
 * The narrowing is REPORTED with its count on every run, so the size of what was set aside is
 * visible rather than implied, and `--all` prints the set-aside list in full.
 */
export const ARTEFACT_MARKERS = Object.freeze({
  merged: /dissolveRings|regionPathD|clipperUnion|dissolvedParcel|paintHeatmap|buildProposedSurface/,
  screen: /\bf2p\s*\(|worldToScreen|regionPathD|pathD\s*\(/,
  extent: /setView\s*\(|Infinity[\s\S]{0,400}?Math\.(?:min|max)|feetExtent|BBox|bbox/,
  snap: /edgeSnapCenter|findRoadConnect|snapTo|snapCandidates/,
  hit: /elementsFromPoint|elementFromPoint|hitFeature|pickInMarquee|identifyOverlaysAt/,
  export: /buildExportSvg|siteToFeatures|exportFeetExtent|toDataURL|toBlob/,
});

/** Which artefact categories does this body produce? Empty ⇒ set aside, with the reason recorded. */
export function artefactsOf(body) {
  return Object.entries(ARTEFACT_MARKERS).filter(([, re]) => re.test(body)).map(([k]) => k);
}

export function sweep(root = ROOT) {
  const found = [];
  const setAside = [];
  for (const rel of SWEPT_FILES) {
    const path = join(root, rel);
    if (!existsSync(path)) continue;
    for (const b of bindingsIn(readFileSync(path, "utf8"))) {
      const reads = rawReadsOf(b.body);
      if (!reads.length) continue;
      const artefacts = artefactsOf(b.body);
      const row = { file: rel, name: b.name, line: b.line, reads, artefacts, filtered: asksPredicate(b.body) };
      /* ⛔ A DECLARED NAME IS ALWAYS SWEPT, markers or not. `connectableRoads` is one line —
       * `els.filter(…).map(…)` — and carries no marker at all, because what makes it a SNAP MAGNET
       * happens at its call site (`findRoadConnect`). Markers decide what gets surfaced for a human
       * to judge; once judged, the table is the authority and the row can never fall out of the
       * sweep because its body got shorter. */
      if (artefacts.length || DECLARED_NAMES.has(b.name)) found.push(row); else setAside.push(row);
    }
  }
  found.setAside = setAside;
  return found;
}

/** Compare the sweep against the declarations. */
export function reconcile(found) {
  const undeclared = [];
  const unfiltered = [];
  const declared = new Map(DECLARATIONS.map((d) => [d.name, d]));
  const seen = new Set();
  for (const f of found) {
    const d = declared.get(f.name);
    if (!d) { undeclared.push(f); continue; }
    seen.add(f.name);
    if (d.verdict === VERDICT.MUST_FILTER && !f.filtered) unfiltered.push({ ...f, why: d.why });
  }
  /* A declaration whose binding no longer exists is reported too: a table that outlives its code
   * rots green, which is the failure mode VIEW-INDEPENDENT-ONCE §6 names. */
  const stale = DECLARATIONS.filter((d) => !seen.has(d.name)).map((d) => d.name);
  return { undeclared, unfiltered, stale };
}

/* ---------------------------------------------------------------- CLI */
if (import.meta.url === `file://${process.argv[1]}`) {
  const teethRef = process.argv.includes("--teeth") ? process.argv[process.argv.indexOf("--teeth") + 1] : null;

  if (teethRef) {
    /* ⛔ PROVE THE SEARCH FINDS THE ONE WE KNOW ABOUT, before any clean result is reported. */
    const tmp = execFileSync("mktemp", ["-d"], { encoding: "utf8" }).trim();
    execFileSync("git", ["--work-tree", tmp, "checkout", teethRef, "--", ...SWEPT_FILES], { cwd: ROOT });
    const teeth = reconcile(sweep(tmp));
    const caught = teeth.unfiltered.find((u) => u.name === "roadNet");
    console.log(`\nTEETH CHECK against ${teethRef}:`);
    if (caught) {
      console.log(`  ✓ the sweep FINDS the known defect — roadNet (${caught.file}:${caught.line}) reads ${caught.reads.join(", ")} and never asks the predicate`);
    } else {
      console.log("  ✗ the sweep did NOT find roadNet on a tree where it is known to be broken.");
      console.log("    Every clean result from this instrument is worthless until that is fixed.");
      process.exit(2);
    }
  }

  const found = sweep();
  const { undeclared, unfiltered, stale } = reconcile(found);
  console.log(`\nSet aside: ${found.setAside.length} binding(s) read a raw collection but produce none of the six artefact kinds (handlers, menus, id lookups). ${process.argv.includes("--all") ? "" : "--all lists them."}`);
  if (process.argv.includes("--all")) for (const f of found.setAside) console.log(`    – ${f.name.padEnd(26)} ${f.file.split("/").pop()}:${f.line}`);
  const byVerdict = { [VERDICT.MUST_FILTER]: [], [VERDICT.CORRECT_UNFILTERED]: [] };
  const declared = new Map(DECLARATIONS.map((d) => [d.name, d]));
  for (const f of found) { const d = declared.get(f.name); if (d) byVerdict[d.verdict].push(f); }

  console.log(`\nSwept ${SWEPT_FILES.length} files · ${found.length} bindings read a raw collection.\n`);
  console.log(`  ${byVerdict[VERDICT.MUST_FILTER].length} declared MUST-FILTER (they produce a picture or an artefact read as truth)`);
  for (const f of byVerdict[VERDICT.MUST_FILTER]) {
    console.log(`    ${f.filtered ? "✓" : "✗"} ${f.name.padEnd(26)} ${f.file.split("/").pop()}:${String(f.line).padEnd(6)} reads ${f.reads.join(", ")}`);
  }
  console.log(`\n  ${byVerdict[VERDICT.CORRECT_UNFILTERED].length} declared CORRECT-UNFILTERED (a count, a save, an undo frame, a ledger, a rule)`);
  for (const f of byVerdict[VERDICT.CORRECT_UNFILTERED]) {
    console.log(`    · ${f.name.padEnd(26)} ${f.file.split("/").pop()}:${String(f.line).padEnd(6)} ${declared.get(f.name).why}`);
  }
  if (undeclared.length) {
    console.log(`\n⛔ ${undeclared.length} UNDECLARED read(s) — each must be judged and added to lib/hiddenContentReads.js:`);
    for (const f of undeclared) console.log(`    ? ${f.name.padEnd(26)} ${f.file.split("/").pop()}:${String(f.line).padEnd(6)} [${f.artefacts.join("+")}] reads ${f.reads.join(", ")}${f.filtered ? " (asks the predicate)" : ""}`);
  }
  if (stale.length) console.log(`\n⚠ ${stale.length} declaration(s) name a binding that no longer exists: ${stale.join(", ")}`);
  if (unfiltered.length) {
    console.log(`\n⛔ ${unfiltered.length} MUST-FILTER read(s) do NOT ask the predicate:`);
    for (const f of unfiltered) console.log(`    ✗ ${f.name} (${f.file}:${f.line}) — ${f.why}`);
  }
  const bad = undeclared.length + unfiltered.length + stale.length;
  console.log(bad ? `\n✗ ${bad} thing(s) to resolve.` : "\n✓ Every raw-collection read is declared, and every must-filter read asks the predicate.");
  process.exitCode = bad ? 1 : 0;
}
