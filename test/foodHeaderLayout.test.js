/* B1022961 (2026-09-01 owner report, "fix the formatting at the top") — the Row-2 two-zone
 * layout (tabs | toolbar, used by every workspace EXCEPT the Scheduler's toolbarCenter branch —
 * see foodHeaderLayout's sibling scheduleHeaderLayout.test.js for that one) right-justifies its
 * toolbar zone (`justify-content: flex-end`) so the toolbar reads as flush against the tabs zone
 * beside it. `/food` is the one caller that renders NO tabs at all (`showModuleTabs={false}`,
 * B651873), so that same rule had nothing to be flush against and instead flung the whole
 * Map/List/Drop-a-pin/search toolbar to the row's far-right edge — measured live on
 * planyr.io/#/food at a 3201px viewport: the strip sat at x=2761 of 3201, with ~2918px of empty
 * bar to its left and nothing else in the row.
 *
 * ⛔ THE REAL PROOF IS A REAL BROWSER — headless-verified this session (Playwright, dev build,
 * signed out) at 1280/1440/1600/1920px: the toolbar zone now measures `justify-content:
 * flex-start` with its content flush against the LEFT edge (a 6px inset) at every width, with no
 * regression to the tabs-present branch (scheduleHeaderLayout.test.js's own suite, and the
 * Site/Review/Library/Notes/Scheduler routes, are all unaffected — `showModuleTabs` still
 * defaults to `true` for every one of them). CI cannot run a browser, so this suite guards the
 * one thing it CAN check without one: the two-zone toolbar zone's justification is conditioned on
 * `showModuleTabs`, not a bare `flex-end` regardless of whether anything anchors the row's left
 * edge.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const header = readFileSync(join(ROOT, "src/shared/ui/AppHeader.jsx"), "utf8");

// Isolate the 2-zone (no toolbarCenter) branch of Row 2 — the ") : (" that closes the 3-zone
// branch scheduleHeaderLayout.test.js already isolates, up through the end of that JSX block.
const threeZoneStart = header.indexOf("{toolbarCenter ? (");
const twoZoneStart = header.indexOf(") : (", threeZoneStart);
const twoZoneEnd = header.indexOf("</header>", twoZoneStart);
if (threeZoneStart < 0 || twoZoneStart < 0 || twoZoneEnd < 0) {
  throw new Error("Row 2's toolbarCenter branch moved or was removed — update this test's slice markers.");
}
const twoZone = header.slice(twoZoneStart, twoZoneEnd);

describe("Food header Row 2 — the toolbar zone anchors LEFT when there are no module tabs to sit flush against", () => {
  it("the toolbar zone's justify-content is conditioned on showModuleTabs, not a bare flex-end", () => {
    expect(twoZone).toMatch(/justifyContent:\s*showModuleTabs\s*\?\s*"flex-end"\s*:\s*"flex-start"/);
  });

  it("padding follows the same side the content is anchored to (no dead inset on the empty side)", () => {
    expect(twoZone).toMatch(/paddingLeft:\s*showModuleTabs\s*\?\s*0\s*:\s*6/);
    expect(twoZone).toMatch(/paddingRight:\s*showModuleTabs\s*\?\s*6\s*:\s*0/);
  });

  it("the narrow (phone) branch is untouched — still rides the row scroll at its natural width", () => {
    expect(twoZone).toMatch(/flex:\s*narrow\s*\?\s*"1 0 auto"\s*:\s*1,/);
  });
});
