/* NEW-1 / NEW-2 — PINCH-ZOOM AND A ROAD CONTROL-POINT DRAG MAY NOT PUMP A RENDER LOOP.
 *
 * ⛔ WHAT THIS ASSERTS, AND WHY IT IS NOT "DID IT CRASH".
 *
 * The owner's 2026-09-19 iPhone session threw React #185 ("Maximum update depth exceeded") twice in
 * 58 seconds on build 27671fa, while pinch-zooming and dragging a road's control points on a located
 * plan. De-minifying the deployed chunks at the reported offsets named both throw sites exactly: the
 * `setGeoZoom` dispatch inside the geo-registration layout effect's `commit` (SitePlannerApp chunk)
 * and the `setCrumbCompact` dispatch inside ProjectBreadcrumb's crumb-fit layout effect (AppHeader
 * chunk).
 *
 * #185 is a CIRCUIT BREAKER: it fires once ~50 commits have nested, and whether a given device gets
 * there depends on how slow it is and how much other work is already pending — which is exactly why
 * this reaches the owner's phone and not this sandbox. Measured here: the defect produced 78 runs of
 * one layout effect per second but never more than 3 inside a single animation frame, against the
 * ~50 the breaker needs. **So an assertion on the crash would be green on the defect** — the same
 * trap VIEW-INDEPENDENT-ONCE §2 names, where every visual test in this repo passes on the bug.
 *
 * This asserts the LOOP instead, which is deterministic and is the thing actually being fixed: an
 * effect may not re-run because a dependency was REPLACED BY A VALUE-IDENTICAL OBJECT.
 * `src/app/renderLoopProbe.js` classifies every dependency change as `value` (a real change — the
 * effect SHOULD re-run) or `identity-only` (a fresh object holding the same thing — pure waste, and
 * sync-lane work raised from inside a commit, which is the fuel the breaker counts). A healthy
 * gesture shows `value`. The defect shows `identity-only` at a rate no gesture can explain.
 *
 * PROVEN RED before it was accepted. With `renderLoopProbe` in place and the two fixes reverted,
 * this run reports:
 *     app-header:breadcrumb-fit — 78 runs/s, planSlot identity-only 67, value 0
 * and the assertion below fails on it. With the fixes in, the site drops out of the hot list
 * entirely and no instrumented dependency reports identity-only churn at all. The crash-shaped
 * assertions are kept as a second, weaker arm — they cannot go red here, and they are not what
 * makes this spec meaningful.
 *
 * The device scope is deliberate and is backed by the telemetry rather than assumed: of the 37
 * `source=react` #185 rows in `public.client_errors`, 27 are Windows desktop Chrome and 10 are
 * iPhone WebKit. This is NOT a touch-device bug, so the spec drives the gesture at phone width with
 * real touch events (where it was caught) and the unit guards cover the shape at any width.
 */
import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const SITE_ID = "e2eLoop1";
const P1 = "pLoop1";

/* A LOCATED plan. On an unlocated one the geo-registration effect returns at its own `!origin`
 * guard and half the case under test does not exist. */
const locatedSite = () => ({
  id: SITE_ID, groupId: SITE_ID, site: "Render loop repro", name: "Phase II - TAS R1",
  origin: { lat: 29.7869, lon: -95.8244 },
  county: "harris",
  parcels: [{ id: P1, points: [{ x: 120, y: 80 }, { x: 1320, y: 80 }, { x: 1320, y: 880 }, { x: 120, y: 880 }], locked: true }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, updatedAt: Date.now(),
});

const canvas = (p) => p.getByTestId("planner-canvas");

/* Two fingers, through CDP — the only way to produce a real multi-touch TouchList. The planner reads
 * `e.touches` off NATIVE touch events (B555: pointer events are unreliable for multi-touch on iOS),
 * so a synthesised pointer pair would exercise nothing at all. */
async function pinch(cdp, cx, cy, fromGap, toGap, steps = 12) {
  const send = (type, gap) => cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: type === "touchEnd" ? [] : [
      { x: cx - gap / 2, y: cy, id: 1 },
      { x: cx + gap / 2, y: cy, id: 2 },
    ],
  });
  await send("touchStart", fromGap);
  for (let i = 1; i <= steps; i++) await send("touchMove", fromGap + ((toGap - fromGap) * i) / steps);
  await send("touchEnd", toGap);
}

async function touchDrag(cdp, from, to, steps = 10) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, id: 1 }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test.describe("NEW-1/NEW-2 — a touch gesture on a located plan may not pump a render loop", () => {
  test("pinch-zoom + a road control-point drag re-run no effect on identity-only dependency churn", async ({ page, context }) => {
    const crashes = [];
    page.on("pageerror", (e) => crashes.push(String((e && e.message) || e)));
    page.on("console", (m) => { if (m.type() === "error" && /update depth|React error #185/i.test(m.text())) crashes.push(m.text()); });

    await page.addInitScript(() => { window.__PLANYR_E2E = true; });
    await page.addInitScript(([id, rec]) => {
      if (localStorage.getItem("e2e:seeded:" + id)) return;
      localStorage.setItem("e2e:seeded:" + id, "1");
      localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
      localStorage.setItem("planarfit:currentSite:v1", id);
    }, [SITE_ID, locatedSite()]);

    // Draw the road at desktop width, where the toolbar is not collapsed — a hand-seeded road
    // element would be a guess at `vtx`/`travelW`/`curb`/bbox, and the control points the drag has
    // to find are the whole point of the case. Then narrow to the phone, which is how the owner
    // was holding it: a plan drawn on a desktop, opened on a phone.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const tab = page.getByTestId("module-tab-site-planner").filter({ visible: true });
    await tab.waitFor({ state: "visible", timeout: 30_000 });
    await tab.click();
    await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1200);

    const box = await canvas(page).boundingBox();
    await page.getByRole("button", { name: "Road", exact: true }).click();
    await page.getByRole("button", { name: "Road presets" }).click();
    await page.getByRole("button", { name: /^\d+′$/ }).first().click();
    await page.mouse.click(box.x + 300, box.y + 420);
    await page.mouse.click(box.x + 620, box.y + 420);
    await page.mouse.click(box.x + 900, box.y + 250);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");

    // PRECONDITION — a run without a real road is VOID, not green (DRIVER-SCROLL §6's known-good
    // arm, in its refusal form: prove the scene under test exists before scoring anything).
    const roads = await page.evaluate(() => {
      const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const s = m[Object.keys(m)[0]] || {};
      return (s.els || []).filter((e) => e.type === "road").length;
    });
    expect(roads, "no road was drawn — this run cannot see the case under test, so it is VOID rather than green").toBeGreaterThanOrEqual(1);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(900);
    await expect(canvas(page)).toBeVisible();

    // FOREGROUND-OR-VOID: a background tab suspends rAF, and a pinch driven against a suspended
    // frame loop measures a gesture that never happened.
    const measurable = await page.evaluate(() => document.visibilityState);
    expect(measurable, "the tab is not visible — no geometry or timing reading from it is valid").toBe("visible");

    const phoneBox = await canvas(page).boundingBox();
    const cdp = await context.newCDPSession(page);
    const cx = phoneBox.x + phoneBox.width / 2;
    const cy = phoneBox.y + phoneBox.height / 2;

    await page.evaluate(() => window.__planyrLoopProbeReset && window.__planyrLoopProbeReset());

    const churn = [];
    for (let round = 0; round < 5; round++) {
      await pinch(cdp, cx, cy, 120, 300);
      churn.push(await page.evaluate(() => (window.__planyrLoopProbe && window.__planyrLoopProbe({ limit: 8 })) || []));
      await pinch(cdp, cx, cy, 300, 120);
      churn.push(await page.evaluate(() => (window.__planyrLoopProbe && window.__planyrLoopProbe({ limit: 8 })) || []));

      const roadNode = await page.locator('[data-feature^="el:"]').first().boundingBox().catch(() => null);
      if (roadNode) {
        const at = { x: roadNode.x + roadNode.width / 2, y: roadNode.y + roadNode.height / 2 };
        await touchDrag(cdp, at, { x: at.x + 3, y: at.y + 3 }, 3);   // select
        await page.waitForTimeout(120);
        const grip = await page.evaluate(() => {
          const h = document.querySelector('[data-handle-layer="1"] rect, [data-handle-layer="1"] circle');
          if (!h) return null;
          const r = h.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        });
        if (grip) { await touchDrag(cdp, grip, { x: grip.x + 26, y: grip.y - 18 }); await page.waitForTimeout(150); }
      }
      churn.push(await page.evaluate(() => (window.__planyrLoopProbe && window.__planyrLoopProbe({ limit: 8 })) || []));
    }

    // THE ASSERTION. Not "a gesture is cheap" — a real pinch legitimately re-runs the
    // geo-registration effect once per frame, because the view really did move. The invariant is
    // that no effect re-runs for a dependency whose VALUE did not change.
    const identityOnly = [];
    for (const rows of churn) {
      for (const r of rows) {
        for (const d of r.deps) {
          if (d.identityOnly > 0) identityOnly.push(`${r.site}: \`${d.dep}\` changed identity-only ${d.identityOnly}× across ${r.runs} runs in ${r.windowMs} ms (value changes: ${d.value})`);
        }
      }
    }
    expect(
      [...new Set(identityOnly)],
      "an effect re-ran because a dependency was replaced by a value-identical object — that is a render-loop pump (see src/app/renderLoopProbe.js)",
    ).toEqual([]);

    // The weaker, crash-shaped arm. It cannot go red in this sandbox (see the header) and is here
    // so a regression that DOES trip the breaker is still caught rather than merely counted.
    await expect(page.getByTestId("boundary-error")).toHaveCount(0);
    await expect(canvas(page)).toBeVisible();
    expect(crashes.filter((c) => /update depth|React error #185/i.test(c)), crashes.join("\n")).toEqual([]);
  });
});
