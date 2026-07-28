/* NEW-5 — PANEL-BREVITY, ENFORCED.
 *
 * Owner rule, 2026-07-28, verbatim: "you keep adding words to the yield panel. So make a rule
 * somewhere in the repo that that's not what we want to do. Less is better. I just want the
 * information literally as brief as it can be."
 *
 * A rule in a markdown file rots. The last three sessions each added CORRECT copy to the yield /
 * pond panels — an honest storage explainer, a five-case berm state, a reconciliation paragraph —
 * and the panel still ended up a wall of text, because nobody consolidated after. So the rule is
 * a BUDGET the build checks, not a paragraph a reviewer has to remember.
 *
 * WHAT THIS MEASURES: the DEFAULT VIEW only — the copy a developer sees without expanding
 * anything. Deliberately EXCLUDED, because these are the escape valves the rule wants used:
 *   • anything inside a <Collapse> (progressive disclosure)
 *   • hover-only detail — title= / basis= / popover= / sections= / info arguments
 *   • keyedNote(...) — the notes groupFold folds into "Assumptions & method ▸" (B862)
 * Consequence, and the whole point: moving a sentence behind a disclosure REDUCES the number,
 * deleting a fact does too — but deleting is separately forbidden by the rule, so the only
 * sanctioned way to get under budget is to COLLAPSE. Brevity is never bought with accuracy.
 *
 * Extends the existing per-note caps (B823's 110-char warnNote cap in test/drainageNoteLength.js,
 * test/pondCopyLint.js) from "no ONE line may be a paragraph" to "no GROUP may accumulate lines".
 *
 * Usage:  node ui-audit/panel-copy-budget.mjs            → print the table
 *         node ui-audit/panel-copy-budget.mjs --check    → exit 1 if any region is over budget
 *         node ui-audit/panel-copy-budget.mjs --json     → machine-readable
 * Pure + Node-only; no DOM, no network. test/panelBrevity.test.js runs the same function. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url));
const BUDGETS = fileURLToPath(new URL("./panel-copy-budget.json", import.meta.url));

/* An interpolation costs this much budget: a rendered number/label is typically ~12 chars, and
 * counting `${f2(x)}` by its SOURCE length would reward obfuscated variable names. Same
 * convention as B823's guard, deliberately, so the two agree. */
export const PLACEHOLDER_BUDGET = 12;

/* The DEFAULT-VIEW regions under budget, by stable source anchors. A moved anchor is a loud
 * failure (throw), never a silently-skipped region — a guard that quietly measures nothing is
 * worse than no guard. */
export const REGIONS = [
  {
    key: "pond-inspector-default",
    label: "Pond inspector · default view",
    from: "{/* v3 UI SPEC B1 — header: subtitle (water area)",
    to: '<Collapse sectionId="pond-section"',
    collector: "jsx",
  },
  {
    key: "yield-detention-detail",
    label: "Yield · Detention detail (inline body)",
    from: "const detVisible = (() => {",
    to: 'out.push(groupFold("det"',
    collector: "jsx",
  },
  {
    key: "yield-stormwater-notes",
    label: "Yield · Stormwater readout (inline warn notes)",
    from: "const warnNote = (text, key, info)",
    to: "return { sw: out, ffeR",
    collector: "jsx",
  },
  // The panel's sentences mostly do NOT live in the JSX — they are built in the pure verdict
  // libs and rendered through `{c.heading}` / `{c.body}` expressions. That is exactly where
  // B1032–B1036 added the storage explainer, the five-case berm naming and the reconciliation
  // copy, so a budget that only watched the JSX would have watched the wrong file.
  {
    key: "lib-pond-verdict",
    label: "lib/pondVerdict.js · visible sentences",
    file: "lib/pondVerdict.js",
    collector: "lib",
  },
  {
    key: "lib-yield-verdicts",
    label: "lib/yieldVerdicts.js · visible sentences",
    file: "lib/yieldVerdicts.js",
    collector: "lib",
  },
];

/* Helpers whose FIRST string argument renders as a visible line in the default view.
 * keyedNote is absent on purpose: those are the method notes B862 folds away. */
const VISIBLE_HELPERS = ["warnNote", "noteLine", "warnLine", "actLine", "actApply", "actionNote"];

/* Attributes that carry HOVER-ONLY or DISCLOSURE-ONLY copy — never counted. */
const HIDDEN_ATTRS = ["title", "basis", "popover", "sections", "placeholder", "aria-label", "summary", "tip", "sourceTip"];

function stripComments(code) {
  let out = "";
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "/" && code[i + 1] === "*") { const e = code.indexOf("*/", i + 2); i = e === -1 ? code.length : e + 1; continue; }
    if (code[i] === "/" && code[i + 1] === "/") { const e = code.indexOf("\n", i); i = e === -1 ? code.length : e; out += "\n"; continue; }
    out += code[i];
  }
  return out;
}

/* Remove every <Collapse …> … </Collapse> body: that is progressive disclosure, which the rule
 * actively wants used, so its copy must not count against the default view. */
function stripCollapsed(code) {
  let out = code;
  for (;;) {
    const open = out.indexOf("<Collapse");
    if (open === -1) break;
    const close = out.indexOf("</Collapse>", open);
    if (close === -1) { out = out.slice(0, open); break; }
    out = out.slice(0, open) + out.slice(close + "</Collapse>".length);
  }
  return out;
}

/* Remove hover-only attribute values (both  attr="…"  and  attr={…}  forms). */
function stripHiddenAttrs(code) {
  let out = code;
  for (const attr of HIDDEN_ATTRS) {
    out = out.replace(new RegExp(`\\b${attr}=(["'\`])(?:\\\\.|(?!\\1)[\\s\\S])*\\1`, "g"), `${attr}=""`);
    // brace form: scan balanced braces so a nested template literal can't end it early
    for (;;) {
      const i = out.indexOf(`${attr}={`);
      if (i === -1) break;
      let j = i + attr.length + 2, depth = 1;
      while (j < out.length && depth > 0) {
        if (out[j] === "{") depth++;
        else if (out[j] === "}") depth--;
        j++;
      }
      out = out.slice(0, i) + `${attr}=""` + out.slice(j);
    }
  }
  return out;
}

/* Blank every argument AFTER the first for the given calls. `warnNote(text, key, info)` puts its
 * full explanation in `info`, which renders only in the note's ⓘ popover — counting it would
 * penalise moving detail out of the visible line, i.e. penalise the exact move this rule exists to
 * encourage. Same for keyedNote and the provenance components' basis/sections props. */
function blankTrailingArgs(code, callers) {
  let out = code;
  for (const caller of callers) {
    const re = new RegExp(`(?<![\\w.])${caller}\\(`, "g");
    let m;
    while ((m = re.exec(out))) {
      let i = m.index + m[0].length;
      let depth = 1, firstArgEnd = -1;
      while (i < out.length && depth > 0) {
        const ch = out[i];
        if (ch === '"' || ch === "'" || ch === "`") { i = readLiteral(out, i).end; continue; }
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") { depth--; if (depth === 0) break; }
        else if (ch === "," && depth === 1 && firstArgEnd === -1) firstArgEnd = i;
        i++;
      }
      if (firstArgEnd === -1 || depth !== 0) continue;
      out = out.slice(0, firstArgEnd) + " ".repeat(i - firstArgEnd) + out.slice(i);
      re.lastIndex = m.index + m[0].length;
    }
  }
  return out;
}

/* Read a string/template literal starting at `i` (which points at the quote). Returns
 * { text, staticLen, end } with each ${…} costing PLACEHOLDER_BUDGET. */
function readLiteral(code, i) {
  const quote = code[i];
  let text = "", staticLen = 0;
  let j = i + 1;
  while (j < code.length) {
    const ch = code[j];
    if (ch === "\\") { text += code[j + 1] ?? ""; staticLen++; j += 2; continue; }
    if (quote === "`" && ch === "$" && code[j + 1] === "{") {
      let depth = 1; j += 2;
      while (j < code.length && depth > 0) {
        if (code[j] === "{") depth++;
        else if (code[j] === "}") depth--;
        j++;
      }
      text += "…"; staticLen += PLACEHOLDER_BUDGET;
      continue;
    }
    if (ch === quote) { j++; break; }
    text += ch; staticLen++; j++;
  }
  return { text, staticLen, end: j };
}

/* Collect the visible copy items of one prepared region. */
function collectCopy(code) {
  const items = [];
  // 1. First string argument of each visible-line helper call.
  for (const helper of VISIBLE_HELPERS) {
    const re = new RegExp(`(?<![\\w.])${helper}\\(\\s*`, "g");
    let m;
    while ((m = re.exec(code))) {
      const i = m.index + m[0].length;
      const ch = code[i];
      if (ch !== '"' && ch !== "'" && ch !== "`") continue; // variable first arg — guarded at its source
      const lit = readLiteral(code, i);
      if (lit.text.trim().length > 1) items.push({ kind: helper, text: lit.text.trim(), len: lit.staticLen });
    }
  }
  // 2. JSX text nodes: `>words<`, where the closing `<` may start a CLOSING tag (`</span>`) or a
  // NESTED element (`<RowInfo …>` — a heading followed by its ⓘ is the panel's commonest shape,
  // and an earlier version of this scan missed every one of them).
  //
  // The hard part is not matching JSX, it is NOT matching JavaScript: `a > b && c < d` looks
  // identical to a text node. Three filters do it — the `>` must close a tag (the character
  // before it is a quote, brace, slash, or word character, never a comparison operand's space or
  // another operator), the text must read like prose (a space and a letter), and it must carry no
  // code punctuation. A false positive here would inflate a budget and hide a real regression.
  const textRe = />([^<>{}]{4,}?)</g;
  let t;
  while ((t = textRe.exec(code))) {
    const prev = code[t.index - 1];
    if (!prev || !/["'`}/\w]/.test(prev)) continue;
    const raw = t[1].replace(/\s+/g, " ").trim();
    if (raw.length > 3 && raw.includes(" ") && /^[A-Za-z]/.test(raw) && !/[=;{}()$&|+*\[\]]/.test(raw)) {
      items.push({ kind: "jsx-text", text: raw, len: raw.length });
    }
  }
  return items;
}

/* Object keys that carry hover-only / method-only copy in the verdict libs — the counterpart of
 * HIDDEN_ATTRS for a module that returns objects instead of JSX. */
const HIDDEN_KEYS = ["title", "basis", "basisNote", "popover", "info", "tip", "help", "sourceTip"];

/* Callers whose string argument is NOT default-view panel copy. keyedNote is the B862 method
 * note (it folds into "Assumptions & method ▸" — using it is how you get UNDER budget);
 * flashWarn is a transient toast; the rest are never user-facing. */
/* Calls whose 2nd..nth arguments carry fold-only / hover-only copy. */
const TRAILING_ARG_CALLS = ["warnNote", "keyedNote", "noteLine", "warnLine", "actLine", "RowInfo", "SourceTag"];

const EXCLUDED_CALLERS = ["keyedNote", "flashWarn", "console.log", "console.warn", "console.error", "Error", "require", "import"];

/* Collect user-facing SENTENCES: string literals of four words or more, minus the ones assigned
 * to a hover-only key or passed to a non-panel caller. Four words is the sentence threshold — it
 * clears enum values, codes, keys and short labels while catching every explanatory clause, which
 * is the thing that actually accumulates.
 *
 * This is what catches copy the JSX collector cannot see: the panel's sentences are mostly BUILT
 * (pushed onto a `terms` array, joined, returned from a verdict lib) and rendered through an
 * expression, so counting only literal text nodes would miss the storage explainer entirely. */
function collectSentences(code) {
  const items = [];
  const hiddenKey = new RegExp(`(?:${HIDDEN_KEYS.join("|")})\\s*:\\s*$`);
  const excludedCall = new RegExp(`(?:${EXCLUDED_CALLERS.join("|")})\\(\\s*$`);
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch !== '"' && ch !== "'" && ch !== "`") continue;
    const before = code.slice(Math.max(0, i - 40), i);
    const lit = readLiteral(code, i);
    i = lit.end - 1;
    const words = lit.text.trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
    if (words.length < 4) continue;
    if (hiddenKey.test(before) || excludedCall.test(before)) continue;
    items.push({ kind: "sentence", text: lit.text.trim(), len: lit.staticLen });
  }
  return items;
}

/* One item per distinct sentence: the same string counted twice would punish a shared constant,
 * which is the opposite of the "state it once, reference it elsewhere" rule. */
function dedupe(items) {
  const seen = new Set(), out = [];
  for (const it of items) {
    const k = it.text.replace(/\s+/g, " ").trim();
    if (seen.has(k)) continue;
    seen.add(k); out.push(it);
  }
  return out;
}

/* Measure every region. Throws on a missing anchor rather than silently reporting zero — a guard
 * that quietly measures nothing is worse than no guard at all. */
export function measurePanels(source = readFileSync(SRC, "utf8")) {
  const out = {};
  for (const r of REGIONS) {
    let prepared, items;
    if (r.collector === "lib") {
      const libSrc = readFileSync(fileURLToPath(new URL(`../src/workspaces/site-planner/${r.file}`, import.meta.url)), "utf8");
      items = dedupe(collectSentences(blankTrailingArgs(stripComments(libSrc), TRAILING_ARG_CALLS)));
    } else {
      const a = source.indexOf(r.from);
      if (a === -1) throw new Error(`panel-copy-budget: region "${r.key}" start anchor not found — the surface moved; update REGIONS in ui-audit/panel-copy-budget.mjs`);
      const b = source.indexOf(r.to, a);
      if (b === -1) throw new Error(`panel-copy-budget: region "${r.key}" end anchor not found — the surface moved; update REGIONS in ui-audit/panel-copy-budget.mjs`);
      prepared = blankTrailingArgs(stripHiddenAttrs(stripCollapsed(stripComments(source.slice(a, b)))), TRAILING_ARG_CALLS);
      items = dedupe([...collectCopy(prepared), ...collectSentences(prepared)]);
    }
    out[r.key] = {
      label: r.label,
      lines: items.length,
      chars: items.reduce((s, it) => s + it.len, 0),
      items,
    };
  }
  return out;
}

export function loadBudgets() {
  return JSON.parse(readFileSync(BUDGETS, "utf8"));
}

/* Compare a measurement against the committed budgets. Returns { ok, rows }. */
export function checkBudgets(measured = measurePanels(), budgets = loadBudgets()) {
  const rows = [];
  for (const r of REGIONS) {
    const m = measured[r.key];
    const b = budgets.regions[r.key];
    if (!b) { rows.push({ key: r.key, label: r.label, ok: false, why: "no budget committed for this region" }); continue; }
    const overLines = m.lines > b.maxLines;
    const overChars = m.chars > b.maxChars;
    rows.push({
      key: r.key, label: r.label,
      lines: m.lines, maxLines: b.maxLines,
      chars: m.chars, maxChars: b.maxChars,
      ok: !overLines && !overChars,
      why: overLines && overChars ? "over on both lines and characters" : overLines ? "too many visible lines" : overChars ? "too much visible copy" : null,
    });
  }
  return { ok: rows.every((r) => r.ok), rows };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith("panel-copy-budget.mjs");
if (isMain) {
  const measured = measurePanels();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(measured, null, 2));
  } else if (process.argv.includes("--check")) {
    const { ok, rows } = checkBudgets(measured);
    for (const r of rows) {
      console.log(`${r.ok ? "✓" : "✗"} ${r.label.padEnd(46)} ${String(r.lines).padStart(3)}/${r.maxLines} lines · ${String(r.chars).padStart(5)}/${r.maxChars} chars${r.ok ? "" : `  ← ${r.why}`}`);
    }
    if (!ok) {
      console.error("\nPANEL-BREVITY budget exceeded (see /CLAUDE.md → PANEL-BREVITY).");
      console.error("New copy REPLACES, it does not ACCUMULATE. Fold the explanation into the group's");
      console.error('"Assumptions & method" disclosure, or name the sentence you removed. Do NOT delete a');
      console.error("fact to get under budget — collapsing is the tool, deleting is not.");
      process.exit(1);
    }
    console.log("\nPANEL-BREVITY: all regions within budget.");
  } else {
    for (const r of REGIONS) {
      const m = measured[r.key];
      console.log(`\n${m.label} — ${m.lines} visible lines, ${m.chars} chars`);
      for (const it of m.items) console.log(`   ${String(it.len).padStart(4)}  [${it.kind}] ${it.text.slice(0, 96)}${it.text.length > 96 ? "…" : ""}`);
    }
  }
}
