/* ⛔ NEW-6 (B435536) — THE GUARD THE OWNER ASKED FOR, MEASURED IN A REAL BROWSER:
 * "add a guard test asserting the rendered label width never exceeds the rendered length of the
 * feature it labels."
 *
 * The unit suite (`test/featureNameLabel.test.js`) proves the RULE against his measured frame. It
 * cannot prove the RENDER obeys it: the width in the rule is an estimate from a character-count
 * model, and the only thing that settles what Chromium actually paints is Chromium. So this spec
 * seeds his own easement geometry, sweeps the zoom, and at every step reads the REAL rendered
 * `getBBox()` of the label and of the easement polygon out of the live DOM.
 *
 * The reported frame, on 8 South / Concept A (`smqiljx5fngg`, element `e1454917vfjirh`):
 * at ppf 0.04159 the easement rendered 21 x 3 CSS px and its label rendered 199 px wide at
 * font-size 10.5 — and it drew ONLY because the easement was selected, which the old predicate let
 * bypass every gate. So the selected case is the one this spec drives.
 *
 * ⛔ FOREGROUND-OR-VOID: every measurement here is geometry taken after a view change, which is
 * exactly the class of reading a background tab returns a stale, internally-consistent lie for.
 * `assertMeasurable` is called before anything is measured.
 *
 * Runs LOGGED OUT against a seeded site — no network, no GIS, no sign-in — so it is Claude-verifiable
 * here (ATTEMPT-BEFORE-YOU-PARK). The signed-in pass on his real plan is the live V###.
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";
import { assertMeasurable, pacedWait } from "../ui-audit/lib/tabTiming.mjs";

const canvas = (p) => p.getByTestId("planner-canvas");
const SITE_ID = "e2e-easement-label-fit";

/* His production row, verbatim (read back from `public.site_elements` while writing this): a
 * 60 ft centreline easement ~513 ft long, carrying a 30-character `labelOverride`. The label
 * length is the whole point — a short name on this feature was never the bug. */
const EASEMENT = {
  id: "e1454917vfjirh",
  kind: "easement",
  mode: "centerline",
  width: 60,
  easeType: "storm",
  status: "existing",
  exclusive: false,
  restrictsBuildings: true,
  restrictsPaving: false,
  labelOverride: "CONVEYANCE CHANNEL 2 DIVERSION",
  centerline: [{ x: 790.69, y: 902.86 }, { x: 1303.47, y: 889.25 }],
  pts: [
    { x: 791.485967590727, y: 932.8494387342363 },
    { x: 1304.2659675907269, y: 919.2394387342363 },
    { x: 1302.6740324092732, y: 859.2605612657637 },
    { x: 789.8940324092731, y: 872.8705612657637 },
  ],
  z: 10240,
};

/* A parcel large enough that "zoom to fit" lands near his whole-site zoom, so the sweep passes
 * through the reported frame rather than starting past it. */
const PARCEL = {
  id: "p-fit",
  active: true,
  pts: [{ x: 0, y: 0 }, { x: 5200, y: 0 }, { x: 5200, y: 3400 }, { x: 0, y: 3400 }],
};

async function boot(page) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "8 South", name: "Concept A",
    origin: null, county: "harris",
    parcels: [PARCEL], els: [], measures: [], callouts: [], markups: [EASEMENT],
    settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible({ timeout: 20_000 });
  /* ⚠ TWO planner canvases are mounted at once — measured, not assumed: both matches sit under a
   * `[data-testid="planner-canvas"]` svg, at different nesting depths, and both paint the label.
   * Rather than guess which one is "live" (a guess that would silently start measuring the wrong
   * copy the day the hosts change), this spec asserts the invariant on EVERY rendered copy. That is
   * strictly stronger, and it cannot rot into measuring nothing. */
  await expect.poll(() => page.locator(`[data-markup="${EASEMENT.id}"]`).count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await pacedWait(page, 1200);   // let the fit / label passes settle before any coordinate is read
  await assertMeasurable(page, "easement-label-fit");
}

/* The two REAL rendered widths, straight off the painted nodes. The label is identified as the
 * text node inside the markup's own group carrying the override string — never by index, which
 * would silently start measuring the area readout the selected state also mounts. */
function measured(page, id, labelText) {
  return page.evaluate(([mid, txt]) => {
    const ppf = parseFloat(document.querySelector("[data-render-ppf]")?.getAttribute("data-render-ppf") || "0");
    return [...document.querySelectorAll(`[data-markup="${mid}"]`)].map((g) => {
      const poly = g.querySelector("polygon");
      const labels = [...g.querySelectorAll("text")].filter((t) => (t.textContent || "").includes(txt));
      const pb = poly ? poly.getBBox() : null;
      const lb = labels.length ? labels[0].getBBox() : null;
      return {
        featureW: pb ? pb.width : 0,
        featureH: pb ? pb.height : 0,
        labelPresent: labels.length > 0,
        labelW: lb ? lb.width : 0,
        fontPx: labels.length ? parseFloat(getComputedStyle(labels[0]).fontSize) : 0,
        ppf,
      };
    });
  }, [id, labelText]);
}

async function selectEasement(page) {
  const box = await page.locator(`[data-markup="${EASEMENT.id}"] polygon`).boundingBox();
  expect(box, "the easement did not render").not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

test("a feature's name label never renders wider than the feature it names", async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page);

  /* SELECTED — the reported condition, and the one the old code let bypass every gate. */
  await selectEasement(page);
  await pacedWait(page, 400);

  const seen = [];
  /* Each step is a real wheel gesture over the canvas, so the app's own zoom path runs — a
   * synthetic state write would not exercise the render body.
   *
   * ⛔ ZOOM OUT PAST HIS FRAME FIRST. The seeded site is smaller than 8 South, so "zoom to fit"
   * lands ABOVE the reveal and a sweep that only zooms in never observes the hidden state — the
   * spec then passes having proved nothing, which is the permanent-green failure this repo keeps
   * catching. Drive out to at least his reported ppf before measuring anything, and assert that
   * the drive actually got there rather than assuming it did. */
  const c = await canvas(page).boundingBox();
  for (let i = 0; i < 22; i++) {
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await page.mouse.wheel(0, 240);
    await pacedWait(page, 120);
  }
  await pacedWait(page, 400);
  const startPpf = await page.evaluate(() => parseFloat(document.querySelector("[data-render-ppf]")?.getAttribute("data-render-ppf") || "0"));
  expect(startPpf, "could not reach whole-site zoom — the sweep would prove nothing").toBeLessThan(0.06);
  for (let step = 0; step < 26; step++) {
    await assertMeasurable(page, "easement-label-fit:sweep");
    for (const m of await measured(page, EASEMENT.id, "CONVEYANCE")) {
      if (!(m.ppf > 0)) continue;
      seen.push(m);
      if (!m.labelPresent) continue;
      const featureLen = Math.max(m.featureW, m.featureH);
      expect(
        m.labelW,
        `label ${m.labelW.toFixed(1)}px vs feature ${featureLen.toFixed(1)}px at ppf ${m.ppf} — a name may never be wider than the feature it names`,
      ).toBeLessThanOrEqual(featureLen);
    }
    await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
    await page.mouse.wheel(0, -240);
    await pacedWait(page, 220);
  }

  /* The sweep has to have covered BOTH states, or a spec that never rendered the label at all would
   * pass while proving nothing — the permanent-green failure mode. */
  expect(seen.length, "no frame was measured").toBeGreaterThan(8);
  expect(seen.some((m) => !m.labelPresent), "the label was never hidden — the sweep started too far in").toBe(true);
  expect(seen.some((m) => m.labelPresent), "the label never appeared at any zoom — it must reveal, not vanish").toBe(true);

  /* The reported frame specifically: at his whole-site zoom, hidden. */
  const wide = seen.filter((m) => m.ppf < 0.1);
  expect(wide.length, "the sweep never passed through whole-site zoom").toBeGreaterThan(0);
  for (const m of wide) expect(m.labelPresent, `label drew at ppf ${m.ppf}, the reported frame`).toBe(false);

  /* And the font is no longer a constant — the owner's explicit instruction was that shrinking it
   * to a smaller constant is NOT the fix, because the defect is that the size is constant. */
  const fonts = [...new Set(seen.filter((m) => m.labelPresent).map((m) => Math.round(m.fontPx * 100) / 100))];
  expect(fonts.length, `font never changed across the zoom sweep (${fonts.join(", ")}) — it is still a constant`).toBeGreaterThan(1);
});
