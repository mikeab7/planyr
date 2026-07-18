// B823 — inline warn notes in the Yield → Stormwater readout are hard-capped at ONE
// line: every warnNote() call whose text is a static string/template literal must be
// ≤110 characters (interpolations counted as 12 chars of budget each). Detail copy
// belongs in the note's ⓘ info argument, never in the visible line — this guard stops
// the readout from re-growing paragraphs (the B803→B823 regression class).
// Scope: the drainage IIFE in SitePlanner.jsx (the readout region between the warnNote
// helper definition and its `return out;`). Variable-first-arg calls (lib-produced
// strings like `req.basis` / `e.short`) are guarded at their source (detentionRules:
// the ETJ short is length-asserted in test/b823CityGate.test.js).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CAP = 110;
const PLACEHOLDER_BUDGET = 12;

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

// Slice the drainage readout region: from the B823 warnNote helper to the IIFE's return.
// B895 — the end anchor used to be the trailing generic disclaimer keyedNote call; that
// caveat now lives once in the panel footer (YieldFooterDisclaimer), so the end anchor
// moved to the last groupFold push (Buildability/FFE, the IIFE's last row-producing call).
const start = src.indexOf("const warnNote = (text, key, info)");
const end = src.indexOf('groupFold("ffe", "Buildability / FFE"', start);
if (start === -1 || end === -1) throw new Error("drainage readout region anchors not found — update this guard with the surface");
const region = src.slice(start, end);

/* Parse the first argument of every warnNote( call that starts with a quote/backtick.
 * Returns { text, staticLen } where staticLen counts literal chars + PLACEHOLDER_BUDGET
 * per ${…} interpolation. */
function extractNotes(code) {
  const out = [];
  const re = /warnNote\(\s*(["`])/g;
  let m;
  while ((m = re.exec(code))) {
    const quote = m[1];
    let i = re.lastIndex;
    let text = "";
    let staticLen = 0;
    while (i < code.length) {
      const ch = code[i];
      if (ch === "\\") { text += code[i + 1]; staticLen++; i += 2; continue; }
      if (quote === "`" && ch === "$" && code[i + 1] === "{") {
        // skip the interpolation (balanced braces)
        let depth = 1; i += 2;
        while (i < code.length && depth > 0) {
          if (code[i] === "{") depth++;
          else if (code[i] === "}") depth--;
          i++;
        }
        text += "…";
        staticLen += PLACEHOLDER_BUDGET;
        continue;
      }
      if (ch === quote) break;
      text += ch; staticLen++; i++;
    }
    out.push({ text, staticLen });
  }
  return out;
}

describe("B823 — one-line cap on the stormwater readout's inline warn notes", () => {
  const notes = extractNotes(region);
  it("finds the readout's literal warn notes (sanity: the region is being scanned)", () => {
    expect(notes.length).toBeGreaterThan(15);
  });
  it(`every literal warn-note line is ≤${CAP} chars (detail belongs in the ⓘ info arg)`, () => {
    const over = notes.filter((n) => n.staticLen > CAP);
    expect(over.map((n) => `${n.staticLen}ch: ${n.text.slice(0, 90)}…`)).toEqual([]);
  });
});
