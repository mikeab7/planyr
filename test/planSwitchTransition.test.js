/* planSwitchTransition — NEW-1 / B2225424 round 2. The plan switch was ONE synchronous task: a click ran React's whole render of the new plan, then its commit,
 * ~175–260 ms for Concept A ↔ Bolt-on (owner's own capture: 215 + 219 ms, unchanged by the badge-anchor fix). `goPlan` is the one place every open/switch passes
 * through (chip pick, project pick, route sync, new plan), so it is the one place to hand the render to React as a transition: the old plan stays on screen and the
 * browser can take input between the render's slices, instead of freezing for the whole render. Measured in the signed-in rig (4 runs, 140-plan library): back-switch
 * median 140 → 91 ms, revisit 156 → 114 ms, Richfield → Grand Port 189 → 101 ms; a trace of the switch shows tasks of 42 + 76 ms instead of one ~200 ms task.
 * Source guard only — the behavioural proof is `npm run perf:planopen` (and V1644528). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlannerApp.jsx", import.meta.url), "utf8");

describe("goPlan renders the new plan as a transition", () => {
  it("imports startTransition and wraps all three state writes of goPlan in ONE transition", () => {
    expect(src).toMatch(/import \{[^}]*\bstartTransition\b[^}]*\} from "react"/);
    expect(src).toMatch(/const goPlan = \(id\) => \{ startTransition\(\(\) => \{ setCurrentSiteId\(id\); setActiveSiteId\(id\); setMode\("plan"\); \}\); \};/);
  });
  it("does not split the three writes across urgent and transition updates (the planner would mount against a half-switched state)", () => {
    const body = src.match(/const goPlan = [^\n]*/)[0];
    const outside = body.replace(/startTransition\(\(\) => \{[^}]*\}\)/, "");
    expect(outside).not.toMatch(/setActiveSiteId|setCurrentSiteId|setMode/);
  });
});
