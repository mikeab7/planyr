import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* NEW-0 ROUND 7 (owner rule, 2026-08-23) — "as long as fifty call sites each re-derive this
 * question, round eight is already scheduled." Six prior rounds on the B673 same-account-echo
 * family (B757, B759/V301, B811, B812, B846/B847, B1116/B377888) each closed ONE detection site and
 * left the notice-emitting sites free to grow a new ungated one — which is exactly how the delete
 * path (this round's actual bug) went seven rounds unnoticed: nothing forced a new `onEvent(...)`
 * call carrying a `remote` row to prove it had asked "could this be my own account's write" before
 * telling the user about it.
 *
 * `foreignAuthor(row)` is the one authoritative, account-level answer to that question (see its
 * definition and the NEW-0 comment beside it in elementSync.js) — it now gates every self-
 * attributable emit in the B673 matrix. This sweep is the guard: it reads the REAL source (never a
 * paraphrase), finds every `onEvent({ type: "…"` call, and requires each one to be either on a
 * documented EXEMPT list (an event with no per-account attribution to get wrong — see the reasons
 * below) or textually guarded by `foreignAuthor(` nearby. A new onEvent call that is neither is
 * exactly the shape that produced this bug, and this test fails LOUDLY rather than waiting for an
 * eighth round.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SRC_PATH = HERE + "../src/workspaces/site-planner/lib/elementSync.js";

// Event types that are deliberately NEVER gated on authorship, each for a stated reason:
const EXEMPT = {
  "atomic-request-lost": "telemetry only — toastForSyncEvent has no case for it (falls to the default null); never reaches the user.",
  "client-stale": "no self concept — this tab's own write path has stalled, which is true regardless of who else is on the plan.",
  "assembly-split": "telemetry only — no toastForSyncEvent case; the retry/backoff machinery, not a user-facing notice.",
  "delete-vs-create-dropped": "a canvas-surprise notice, not an attribution notice — the deleter's own op was dropped and the object is visibly back on the plan; silence there would read as a ghost regardless of who created it.",
  "restore-conflict": "an explicit user action (clicking Restore) racing someone — rare and always worth telling the user their own click didn't land as they clicked it, whoever got there first.",
  "delete-reapplied": "toastForSyncEvent's default case — always null, never a notice.",
};

function extractOnEventSites(src) {
  const lines = src.split("\n");
  const sites = [];
  const re = /onEvent\(\{\s*type:\s*"([a-zA-Z0-9-]+)"/;
  lines.forEach((line, i) => {
    const m = line.match(re);
    if (m) sites.push({ line: i + 1, type: m[1], text: line.trim() });
  });
  return sites;
}

/* ⛔ CODE ONLY — a naive text sweep matches a comment as readily as a real guard, and this file's own
 * NEW-0 comments say "foreignAuthor(row)" in prose right beside several of these calls. A sweep that
 * doesn't strip comments first would pass on the very mutation it exists to catch (measured: removing
 * the real `&& foreignAuthor(row)` from the ~1548 remote-upsert condition left this test GREEN,
 * because the doc comment two lines above it still contains the string "foreignAuthor(row)"). Block
 * and line comments are blanked to spaces — never deleted — so line numbers stay aligned with the
 * original file for both the site extraction above and the lookback window below. */
function stripComments(src) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  out = out.replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, " "));
  return out;
}

// Best-effort backward scan: within this many lines above the onEvent call, is there a
// `foreignAuthor(` reference IN CODE (comments stripped)? The branches in this file are short and
// visually separated (each is its own `if`/`else if` arm), so a window this size reliably lands on
// the guard that actually controls the call without also picking up an unrelated sibling branch's
// reference — verified against the real file below (every non-exempt site currently resolves within
// 12 lines of CODE-only distance).
const LOOKBACK = 20;

describe("elementSync.js — every self-attributable B673 notice is gated on foreignAuthor()", () => {
  const src = readFileSync(SRC_PATH, "utf8");
  const sites = extractOnEventSites(src);
  const codeLines = stripComments(src).split("\n");

  it("found onEvent(...) call sites to check (sweep is not vacuous)", () => {
    expect(sites.length).toBeGreaterThan(10); // sanity: the sweep is reading the real file
  });

  it("every EXEMPT entry actually names a type that appears in the file (no stale allowlist)", () => {
    const seen = new Set(sites.map((s) => s.type));
    for (const type of Object.keys(EXEMPT)) expect(seen.has(type)).toBe(true);
  });

  for (const site of sites) {
    const label = `${site.type} @ elementSync.js:${site.line}`;
    if (EXEMPT[site.type]) {
      it(`${label} — EXEMPT (${EXEMPT[site.type]})`, () => {
        expect(EXEMPT[site.type]).toBeTruthy(); // documents the exemption; nothing to assert further
      });
      continue;
    }
    it(`${label} — must be gated on foreignAuthor(...) within ${LOOKBACK} lines above it`, () => {
      const start = Math.max(0, site.line - 1 - LOOKBACK);
      const window = codeLines.slice(start, site.line).join("\n"); // comments stripped — code only
      const gated = /foreignAuthor\(/.test(window);
      if (!gated) {
        throw new Error(
          `${label} carries a per-account attribution ("${site.text}") with no foreignAuthor(...) ` +
          `check found in the ${LOOKBACK} lines above it. Either the call is missing the gate (the ` +
          `NEW-0 round-7 bug), or this event type genuinely never needs one — in which case add it ` +
          `to the EXEMPT table in this test with a stated reason, not a silent skip.`
        );
      }
      expect(gated).toBe(true);
    });
  }
});
