/* B548066 — A LIVE CHECK MUST STATE A CLOSURE CONDITION SOMEONE OTHER THAN THE OWNER CAN MEET.
 *
 * ⛔ THE ONE SENTENCE THIS EXISTS FOR. V91632 carried *"only he knows which objects he tried."* That
 * is not a blocker; it is a check with no closure condition anyone but the owner could satisfy. Four
 * consecutive sessions therefore verified the case they could think of — markup against markup,
 * which already worked — recorded an honest pass, and left the report standing for six reports and
 * four correct-but-wrong-case fixes.
 *
 * A named `Blocker:` is the LEGITIMATE version of "I cannot finish this here": it says WHICH
 * configuration is out of reach (`auth`, `real-data`, `live-GIS`) and leaves the steps runnable by
 * anyone who has it. Deferring to what is in the owner's head is the illegitimate version, because
 * no configuration unlocks it.
 *
 * The sweep is proven on the real sentence rather than on a synthetic one — a guard nobody has seen
 * fire is a guard that rots green.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const VERIFICATION = readFileSync(new URL("../VERIFICATION.md", import.meta.url), "utf8");

/* Phrasings that hand a check's closure to the owner's memory. Deliberately narrow: this is about
 * "we cannot know what he meant", never about the ordinary "he should look at it on his machine",
 * which is what a `Blocker:` already covers honestly. */
const DEFERS_TO_OWNER = [
  /only (he|michael|the owner) knows/i,
  /only (he|michael|the owner) can (say|tell|remember)/i,
  /(he|michael)'ll have to tell us/i,
  /we don't know (what|which) (he|michael)/i,
  /until (he|michael) (says|tells us|remembers)/i,
];

/* Split VERIFICATION.md into its `### V###` blocks. Only ACTIVE items are swept — the archive is a
 * historical record and is deliberately not rewritten (see the write-only-archives rule). */
function activeBlocks(md) {
  const out = [];
  const lines = md.split("\n");
  let cur = null;
  for (const line of lines) {
    const m = /^### (V\d+)\b/.exec(line);
    if (m) { cur = { id: m[1], head: line, body: [] }; out.push(cur); continue; }
    if (/^## /.test(line)) cur = null;
    else if (cur) cur.body.push(line);
  }
  return out.map((b) => ({ ...b, text: [b.head, ...b.body].join("\n") }));
}

describe("VERIFICATION.md — every live check is closeable by someone other than the owner", () => {
  const blocks = activeBlocks(VERIFICATION);

  it("finds the active verification items at all (a vacuous sweep must not pass as a clean one)", () => {
    expect(blocks.length).toBeGreaterThan(5);
  });

  it("no active item defers its closure to what the owner remembers", () => {
    const bad = blocks.filter((b) => DEFERS_TO_OWNER.some((re) => re.test(b.text)));
    expect(
      bad.map((b) => `${b.id} — ${b.head.slice(0, 110)}`),
      "\nA live check may name a Blocker (auth / real-data / live-GIS) — a configuration someone can\n" +
      "obtain. It may NOT defer to a fact only the owner holds: that is a check with no closure\n" +
      "condition, and it is what let 'send to back never works' survive four correct fixes (B548066).\n" +
      "Rewrite the item with the concrete case and a named expected result.\n",
    ).toEqual([]);
  });

  /* ⛔ THE TEETH, on the REAL sentence. If the patterns ever stop matching what V91632 actually
   * said, this guard has quietly become decorative. */
  it("MUTATION CHECK — the sweep flags V91632's own wording, verbatim", () => {
    const real = "### V91632 — B293073: on ONE OF HIS OWN PLANS, do two overlapping objects actually swap what's on top? `Blocker: real-data`\n" +
      "- the fixes are proven on a fixture built to be the failing plan; only he knows which objects he tried.";
    expect(DEFERS_TO_OWNER.some((re) => re.test(real))).toBe(true);
  });

  it("MUTATION CHECK — an honest `Blocker:` item is NOT flagged (the guard must not ban the legitimate case)", () => {
    const honest = "### V302432 — B548064: Send to Back on a markup over a BUILDING `Blocker: auth`\n" +
      "1. Draw a markup over a building, right-click → Send to Back. Expected: the building is drawn on top.\n" +
      "2. Reload. Expected: still behind the building.";
    expect(DEFERS_TO_OWNER.some((re) => re.test(honest))).toBe(false);
  });

  it("the two items this rule was written alongside state a named expected result per step", () => {
    for (const id of ["V302432", "V302433"]) {
      const b = blocks.find((x) => x.id === id);
      expect(b, `${id} should be an active verification item`).toBeTruthy();
      expect(b.text).toMatch(/Expected:/);
      expect((b.text.match(/Expected:/g) || []).length).toBeGreaterThanOrEqual(4);
    }
  });
});
