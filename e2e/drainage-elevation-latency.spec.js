/* NEW-1 / NEW-2 / NEW-3 — THE FLOOD/DRAINAGE CHECK NO LONGER WAITS ON USGS.
 *
 * Measured live on the owner's own Bain plan, signed in, production build: the re-check cost
 * 3.6–8.5 s and ONE leg — a USGS 3DEP transect for BARE-EARTH GROUND ELEVATION, with a
 * byte-identical geometry parameter every run — was 68–90% of it, at 997 / 5,761 / 7,702 ms. The
 * five county water-surface samplers answered in ~146 ms and did not START until it returned.
 *
 * ⛔ WHY THIS SPEC EXISTS RATHER THAN ONLY UNIT TESTS. `test/groundElevation.test.js` proves the
 * leg's own contract against an injected sampler; it cannot prove the thing that was actually
 * broken, which is the ORDER the real check issues its requests in and whether the panel is GATED
 * on the slowest one. That only exists in the wiring, so it is asserted here — against the real
 * planner, driving the real ↻, with every external host stubbed at the network boundary and the
 * 3DEP host DELIBERATELY HELD so the defect has somewhere to hide.
 *
 * ⛔ AND THE NEGATIVE CONTROL IS THE POINT. A stubbed run where every host answers instantly
 * passes on the BROKEN build too — the serialisation costs nothing when nothing is slow. So 3DEP
 * is HELD for `SLOW_MS`, and the assertions are that the rest of the pull was issued alongside it
 * and that the panel PUBLISHED long before it answered. On the pre-fix build the publish cannot
 * happen until 3DEP settles, because the context that gates it awaited the transect.
 *
 * ⛔ ROUTE ORDER IS LOAD-BEARING and cost a debugging round: 3DEP's getSamples URL is itself an
 * ArcGIS ImageServer path (`elevation.nationalmap.gov/arcgis/rest/…`), so a `**arcgis**` catch-all
 * registered LATER silently swallows it — Playwright matches routes newest-first. The elevation
 * route is therefore registered LAST, and the run that got this wrong reported a perfectly
 * plausible "void" instead of a held call.
 *
 * ⛔ MUTATION-PROVEN, both directions, because a guard nobody has seen fail is a guard that rots
 * green (/CLAUDE.md → DANGEROUS-MEANS-UNOBSERVABLE): restoring the gate (publish budget → 60 s, so
 * the panel waits for the transect again) turns "publishes while the elevation is still in flight"
 * RED and leaves the other three green; removing the cache (`cache: null`) turns "serves the HELD
 * elevation" RED and leaves the other three green. Each arm fails for its own reason, alone.
 *
 * Runs LOGGED OUT on a seeded, georeferenced plan, with no live GIS: the sandbox's egress proxy
 * blocks the agency hosts anyway, and a spec that depends on a federal service's mood is a flaky
 * spec. NOT PROVABLE HERE, and stated rather than hidden — this is what the paired V### live check
 * covers: (a) the ORDERING OF THE FIVE FORT BEND COUNTY WSE SAMPLERS specifically, because that
 * branch only fires once the jurisdiction identify has resolved the county to Fort Bend, which
 * needs the live agency service; (b) the real latency on the owner's own Bain plan; (c) the cache
 * surviving a real reload against IndexedDB in a signed-in session.
 */
import { test, expect } from "@playwright/test";

const LAT = 29.769820, LON = -95.850035; // the Bain reach (Willow Fork) — Fort Bend, so the county WSE path fires
const SITE = {
  schemaVersion: 12, id: "new1-elev-latency", groupId: "new1-elev-latency",
  site: "Elevation Latency Guard", name: "Elevation Latency Guard",
  updatedAt: 1783000000000, teamId: null, ownerId: null,
  scheduleProjectId: null, scheduleProjectName: null,
  origin: { lat: LAT, lon: LON }, county: "fortbend", status: "active",
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 1320, y: 0 }, { x: 1320, y: 1320 }, { x: 0, y: 1320 }], active: true, z: 0 }],
  underlay: null, sheetOverlays: [], parcelDrawings: [], settings: {}, els: [],
};

/** How long 3DEP is held. Well past the publish budget, well under the check's 30 s outer race. */
const SLOW_MS = 5000;

const ELEV_HOST = "**elevation.nationalmap.gov/**";
const jsonBody = (o) => ({ status: 200, contentType: "application/json", body: JSON.stringify(o) });

/* Stub every external host the check touches. Each answers plausibly and EMPTY where empty is a
 * legitimate answer — the point is the ordering, not the numbers. Returns a live log of which
 * hosts were asked and when (ms since the log was armed). */
async function stubTheWorld(page, { elevDelayMs = 0, elevStatus = 200 } = {}) {
  const log = { t0: Date.now(), hits: [], delayMs: elevDelayMs };
  const note = (kind) => log.hits.push({ kind, at: Date.now() - log.t0 });

  await page.route("**/*.{jpg,jpeg,png,webp}", (route) => route.abort());
  // The Fort Bend watershed-study rasters — the "answered in ~146 ms" group.
  await page.route("**gisportal.fortbendcountytx.gov/**", (route) => { note("wse"); route.fulfill(jsonBody({ samples: [{ value: "" }] })); });
  await page.route("**hazards.fema.gov/**", (route) => { note("gis"); route.fulfill(jsonBody({ features: [] })); });
  await page.route("**arcgis**/**", (route) => { note("gis"); route.fulfill(jsonBody({ features: [] })); });
  /* The 3DEP host serves TWO different things this check needs, and only one of them is the
   * subject: `getSamples` is the transect (the leg measured at 997 / 5,761 / 7,702 ms), while
   * `exportImage` is the B808 site DEM raster. Holding BOTH would gate the publish on the DEM and
   * quietly prove nothing about the transect — which an earlier run of this spec did. */
  await page.route(ELEV_HOST, (route) => { note("dem"); route.fulfill(jsonBody({})); });
  // ⛔ LAST — see the header. Newest route wins, and this URL is also an `**arcgis**` match.
  await page.route("**elevation.nationalmap.gov/**getSamples**", async (route) => {
    note("elev");
    if (log.delayMs) await new Promise((r) => setTimeout(r, log.delayMs));
    if (elevStatus !== 200) return route.fulfill({ status: elevStatus, contentType: "application/json", body: "{}" });
    // Nine stations of a flat 30 m bench → a median the app converts with the survey foot.
    route.fulfill(jsonBody({ samples: Array.from({ length: 9 }, () => ({ value: "30.0" })) }));
  });
  return log;
}

async function openSeededPlan(page) {
  await page.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", s); } catch (_) {} }, JSON.stringify({ [SITE.id]: SITE }));
  await page.goto("/#/site-planner", { waitUntil: "load" });
  await page.getByText("Elevation Latency Guard", { exact: false }).first().click();
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(900); // fit-on-load + first commit settle
}

/* The Yield panel lives behind the left rail's "Yield" tab, and its freshness element (the ↻ and
 * the ground-elevation state) only renders once the panel body is OPEN — so both have to be driven
 * rather than assumed. `openYield` is idempotent. */
async function openYield(page) {
  const panel = page.getByTestId("yield-panel").first();
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Yield", exact: true }).first().click();
    await expect(panel).toBeVisible({ timeout: 15000 });
  }
  const btn = page.getByRole("button", { name: /Re-check flood data/i }).first();
  if (!(await btn.isVisible().catch(() => false))) {
    await panel.getByText("Site Yield", { exact: false }).first().click();
    await expect(btn).toBeVisible({ timeout: 10000 });
  }
  return btn;
}

async function recheck(page) {
  const btn = await openYield(page);
  await btn.click();
}

test.describe("the drainage check's elevation leg (NEW-1/NEW-2/NEW-3)", () => {
  test("the transect is issued ALONGSIDE the rest of the pull, not in front of it", async ({ page }) => {
    test.setTimeout(90_000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const log = await stubTheWorld(page, { elevDelayMs: SLOW_MS });
    await openSeededPlan(page);

    log.hits.length = 0; log.t0 = Date.now();
    await recheck(page);
    await expect.poll(() => log.hits.some((h) => h.kind === "elev"), { timeout: 20_000 }).toBe(true);

    const firstElev = log.hits.find((h) => h.kind === "elev");
    const firstGis = log.hits.find((h) => h.kind === "gis");
    expect(firstGis, "the GIS batch was never issued").toBeTruthy();
    // NEW-2(a): started together, within one turn of the event loop's worth of slack — NOT one
    // after the other, and specifically not with the whole batch queued behind the transect.
    expect(Math.abs(firstElev.at - firstGis.at)).toBeLessThan(1000);
    // Exactly ONE transect per check: the cache key is the request, so a check that asked twice
    // would mean the key had drifted from the URL it is supposed to describe.
    expect(log.hits.filter((h) => h.kind === "elev").length).toBe(1);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("the panel publishes while the elevation is still in flight, and says so", async ({ page }) => {
    test.setTimeout(90_000);
    await stubTheWorld(page, { elevDelayMs: SLOW_MS });
    await openSeededPlan(page);
    await recheck(page);

    /* NEW-2(b) — the freshness light going green IS the publish, and an outstanding elevation is a
     * NAMED state beside it rather than a spinner over everything or a zero. Both must be true
     * well before the held call could possibly have landed; on the pre-fix build neither can be. */
    const dot = page.locator('[data-drain-freshness]').first();
    await expect(dot).toBeVisible({ timeout: SLOW_MS - 1200 });
    const pending = page.locator('[data-ground-elev="pending"]').first();
    await expect(pending).toBeVisible({ timeout: SLOW_MS - 1200 });
    await expect(pending).toHaveAttribute("title", /still loading/i);

    // …and when it lands the state resolves on its own, with no second press.
    await expect(page.locator('[data-ground-elev="pending"]')).toHaveCount(0, { timeout: 30_000 });
  });

  test("a second check serves the HELD elevation instead of waiting for a fresh one", async ({ page }) => {
    test.setTimeout(120_000);
    const log = await stubTheWorld(page, { elevDelayMs: 0 });
    await openSeededPlan(page);

    await recheck(page);
    await expect.poll(() => log.hits.filter((h) => h.kind === "elev").length, { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(page.locator('[data-ground-elev="pending"]')).toHaveCount(0, { timeout: 30_000 });

    /* ⛔ THE SECOND PRESS IS A FORCE REFRESH BY DESIGN — the owner's rule, so a wrong cached value
     * is one press from being corrected — so it DOES ask USGS again. What must be true is that it
     * did not WAIT for the answer: the check publishes the HELD value the moment it runs, which is
     * what turns an up-to-eight-second press into a fast one. `data-ground-cached` is the
     * observable difference between the two behaviours. */
    const before = log.hits.filter((h) => h.kind === "elev").length;
    // Hold the forced re-read from here on, so the HELD value has a window in which to be
    // observable. With an instant refresh the cached state is correct for only a few ms and the
    // assertion would be a race — which is a property of the test, not of the app.
    log.delayMs = SLOW_MS;
    await page.waitForTimeout(400);
    const t0 = Date.now();
    await recheck(page);
    await expect(page.locator('[data-ground-cached="1"]').first()).toBeVisible({ timeout: SLOW_MS - 1200 });
    expect(Date.now() - t0, "the press waited for USGS instead of serving the held value").toBeLessThan(SLOW_MS);
    expect(log.hits.filter((h) => h.kind === "elev").length).toBeGreaterThan(before);
    // …and when the forced answer lands it REPLACES the held one, so a wrong cached value really
    // is one press from being corrected.
    await expect(page.locator('[data-ground-cached="1"]')).toHaveCount(0, { timeout: 30_000 });
  });

  test("a dead elevation service is a NAMED failure, never a fabricated ground surface", async ({ page }) => {
    test.setTimeout(90_000);
    await stubTheWorld(page, { elevStatus: 503 });
    await openSeededPlan(page);
    await recheck(page);

    const bad = page.locator('[data-ground-elev="unavailable"]').first();
    await expect(bad).toBeVisible({ timeout: 30_000 });
    // NEW-3 — it NAMES the service, so a slow federal host is distinguishable from a broken app…
    await expect(bad).toHaveAttribute("title", /3DEP/i);
    // …and it states outright that nothing was assumed in its place.
    await expect(bad).toHaveAttribute("title", /[Nn]othing was assumed/);
  });
});
