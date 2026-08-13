/* NEW-1 — SETTING A LOCATION ON A PLAN THAT WAS DRAWN WITHOUT ONE.
 *
 * ⛔ WHY THIS SPEC EXISTS AND A UNIT TEST CANNOT REPLACE IT.
 *
 * Setting `origin` is the MECHANISM. The payoff is that eight other things — the aerial backdrop,
 * the GIS layer list (FEMA flood, contours), the ground-elevation and cursor lat/lon readouts,
 * county detection and therefore jurisdiction / setbacks / drainage — are all GATED on it and are
 * supposed to come alive without a reload. That is precisely the B1422 shape: a gate, a UI and a
 * set of reasons can all be built correctly while the thing they were built for never actually
 * fires. A green unit test proving `origin` reached React state proves NOTHING about the eight
 * consumers downstream of it.
 *
 * So this drives the real app: draw a parcel on a plan with no location, set the location
 * afterward, and MEASURE what changed on the page — plus the promise the whole design rests on,
 * that the drawn geometry does not move by a single foot.
 *
 * SANDBOX HONESTY: external hosts (Esri tiles, the FEMA services, the TxDOT county boundaries) are
 * egress-blocked here, so this asserts the things the app controls — the backdrop map is CREATED,
 * the basemap source flips off → esri, the layer list replaces the "no location yet" note, the
 * coordinate readout exists — and never that a third-party tile painted. Tile paint and live county
 * detection are the V-numbered live checks in VERIFICATION.md.
 *
 * Mutation-checked: reverting `origin` to the read-only field, or dropping `ensureBasemapOn()`
 * from `applyOriginState`, turns cases here red (see the run log on the item).
 */
import { test, expect } from "@playwright/test";

const SITE_ID = "e2eSetLoc1";
const P1 = "pSetLoc1";
// A plain 600 × 400 ft rectangle, in the planner's own feet frame. Deliberately NOT square, so a
// rotation would be unmistakable, and deliberately at an offset from the frame origin so a shifted
// anchor would move it.
const RING = [{ x: 120, y: 80 }, { x: 720, y: 80 }, { x: 720, y: 480 }, { x: 120, y: 480 }];

/* An UNLOCATED plan: exactly what "Start blank, then draw the boundary because the county service
 * is down" produces — a real parcel and `origin: null`. */
const unlocatedSite = () => ({
  id: SITE_ID, groupId: SITE_ID, site: "Offline draw", name: "Concept A",
  origin: null, county: null,
  parcels: [{ id: P1, points: RING, locked: true }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, updatedAt: Date.now(),
});

const canvas = (page) => page.locator('[data-testid="planner-canvas"]');

async function openUnlocated(page) {
  // Arm the same `window.__PLANYR_E2E` gate the geo-map hook reads (helpers.armPlannerHooks) —
  // `window.__geoMap` is how this spec observes the backdrop map existing at all.
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
  /* ⛔ SEED ONCE, NOT ON EVERY NAVIGATION. `addInitScript` runs again on `page.reload()`, so an
     unguarded seed re-writes the ORIGINAL unlocated record over whatever the app just saved — and
     the "survives a reload" case would then be measuring the harness wiping the anchor, not the app
     failing to persist it. (It read as a real defect for one run; it was this.) */
  await page.addInitScript(([id, rec]) => {
    if (localStorage.getItem("e2e:seeded:" + id)) return;
    localStorage.setItem("e2e:seeded:" + id, "1");
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, unlocatedSite()]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => page.locator(`[data-feature="parcel:${P1}"]`).count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await page.waitForTimeout(600);
}

/* The parcel's geometry as the APP holds it — read out of the saved record rather than off the
 * screen, because the screen also moves when the view re-fits and that would confuse "the drawing
 * moved" with "the camera moved". The promise under test is about the FEET. */
async function ringFromStore(page) {
  return page.evaluate((id) => {
    const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const pc = (all[id]?.parcels || [])[0];
    return pc ? pc.points.map((p) => ({ x: p.x, y: p.y })) : null;
  }, SITE_ID);
}

async function originFromStore(page) {
  return page.evaluate((id) => {
    const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    return all[id]?.origin ?? null;
  }, SITE_ID);
}

/* Open the Parcel panel — the surface that carries the "Set this plan's location" call to action. */
/* The left rail's Parcel tab. `data-rail-tab` is the stable hook the click-contract guard already
 * reads; the tab TOGGLES, so open it only when it is not already pressed. */
async function openParcelPanel(page) {
  const tab = page.locator('[data-rail-tab="parcel"]').first();
  await tab.waitFor({ state: "visible", timeout: 20_000 });
  if ((await tab.getAttribute("aria-pressed")) !== "true") await tab.click();
  await expect(tab).toHaveAttribute("aria-pressed", "true");
}

/* Select the parcel by clicking its rendered body, with the panel ALREADY open — the Parcel
 * record section is gated on there being a selected lot, so opening the panel afterward would
 * race the selection and read as "the panel never rendered". */
async function selectParcelWithPanel(page) {
  await openParcelPanel(page);
  await page.locator(`[data-feature="parcel:${P1}"]`).first().click({ force: true, position: { x: 5, y: 5 } });
  // The record body is lazily loaded (its own chunk) — wait for the real content, not the fallback.
  await expect(page.getByTestId("parcel-provenance")).toBeVisible({ timeout: 20_000 });
}

test.describe("NEW-1 · a plan drawn with the GIS down can be put on the earth afterward", () => {
  test("the plan starts with NO location, and says so rather than pretending", async ({ page }) => {
    await openUnlocated(page);
    expect(await originFromStore(page)).toBeNull();
    // The backdrop Leaflet map is not even created for an unlocated plan — this is the state every
    // geo consumer early-returns on, and the thing the rest of this spec watches change.
    expect(await page.evaluate(() => !!window.__geoMap)).toBe(false);
    await openParcelPanel(page);
    await expect(page.getByTestId("set-location-cta")).toBeVisible();
  });

  test("setting a location brings the gated surfaces alive WITHOUT a reload, and moves nothing", async ({ page }) => {
    await openUnlocated(page);
    const before = await ringFromStore(page);
    expect(before).toHaveLength(4);

    await openParcelPanel(page);
    await page.getByTestId("set-location-cta").click();
    await expect(page.getByTestId("set-location-dialog")).toBeVisible();

    /* A TYPED COORDINATE, on purpose: it is the one of the three inputs that needs no network, so
       this case measures the app rather than the sandbox's egress policy. (Katy, TX.) */
    await page.getByTestId("set-location-search").fill("29.7858, -95.8244");
    await page.getByTestId("set-location-find").click();
    await expect(page.getByTestId("set-location-picked")).toContainText("29.78580");
    await page.getByTestId("set-location-confirm").click();
    await expect(page.getByTestId("set-location-dialog")).toHaveCount(0);

    // ── THE PAYOFF, measured on the live page with no reload in between ───────────────────
    // 1) the anchor is on the record
    await expect.poll(async () => (await originFromStore(page))?.lat, { timeout: 10_000 }).toBeCloseTo(29.7858, 3);
    // 2) the backdrop map now EXISTS — every overlay layer (FEMA flood, contours) hangs off it
    await expect.poll(async () => page.evaluate(() => !!window.__geoMap), { timeout: 15_000 }).toBe(true);
    // 3) …and it is anchored at the location we just gave it
    const centre = await page.evaluate(() => { const c = window.__geoMap.getCenter(); return { lat: c.lat, lng: c.lng }; });
    expect(centre.lat).toBeCloseTo(29.7858, 2);
    expect(centre.lng).toBeCloseTo(-95.8244, 2);
    /* 3b) THE AERIAL IS ACTUALLY ON — an imagery TILE LAYER is mounted on that map.
       ⛔ This assertion exists because the obvious one is not enough: the backdrop map is created
       off `origin` ALONE, so deleting `ensureBasemapOn()` leaves the map (and case 2 above) happily
       green while the owner still stares at blank drafting paper. That mutant SURVIVED the first
       version of this spec, which is the B1422 shape exactly — the mechanism observed instead of the
       payoff. We assert the layer is MOUNTED, never that a tile painted: the imagery host is
       egress-blocked in the sandbox, and the live paint is the V-numbered browser check. */
    const tiles = await page.evaluate(() => {
      const urls = []; window.__geoMap.eachLayer((l) => { if (l && l._url) urls.push(String(l._url)); });
      return urls;
    });
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.some((u) => /arcgisonline|nationalmap/.test(u))).toBe(true);
    // 4) the Layers panel stops saying "once this plan has a location" and offers real layers
    await expect(page.getByTestId("layers-set-location")).toHaveCount(0);
    // 5) the drawn geometry has not moved by a single foot — the whole promise of the design
    const after = await ringFromStore(page);
    expect(after).toEqual(before);
  });

  test("the location survives a reload", async ({ page }) => {
    await openUnlocated(page);
    await openParcelPanel(page);
    await page.getByTestId("set-location-cta").click();
    await page.getByTestId("set-location-search").fill("29.7858, -95.8244");
    await page.getByTestId("set-location-find").click();
    await page.getByTestId("set-location-confirm").click();
    await expect.poll(async () => (await originFromStore(page))?.lat, { timeout: 10_000 }).toBeCloseTo(29.7858, 3);
    const before = await ringFromStore(page);

    await page.reload();
    await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => page.evaluate(() => !!window.__geoMap), { timeout: 20_000 }).toBe(true);
    expect((await originFromStore(page)).lat).toBeCloseTo(29.7858, 3);
    // …and it still hasn't moved.
    expect(await ringFromStore(page)).toEqual(before);
  });

  test("placement: TURN moves the drawing, SLIDE moves only where it sits", async ({ page }) => {
    await openUnlocated(page);
    await openParcelPanel(page);
    await page.getByTestId("set-location-cta").click();
    await page.getByTestId("set-location-search").fill("29.7858, -95.8244");
    await page.getByTestId("set-location-find").click();
    await page.getByTestId("set-location-confirm").click();
    await expect.poll(async () => (await originFromStore(page))?.lat, { timeout: 10_000 }).toBeCloseTo(29.7858, 3);

    // The Placement section only exists once the plan HAS a location.
    await page.getByRole("button", { name: /^Placement/i }).first().click();
    const before = await ringFromStore(page);
    const originBefore = await originFromStore(page);

    // SLIDE — the anchor moves, every drawn coordinate is untouched.
    await page.getByTestId("placement-nudge-e").click();
    await expect.poll(async () => (await originFromStore(page)).lon, { timeout: 10_000 }).toBeGreaterThan(originBefore.lon);
    expect(await ringFromStore(page)).toEqual(before);

    // TURN — the drawing rotates rigidly; side lengths are preserved, the anchor does not move.
    const originAfterSlide = await originFromStore(page);
    await page.getByTestId("placement-rot-cw").click();
    await expect.poll(async () => JSON.stringify(await ringFromStore(page)), { timeout: 10_000 })
      .not.toBe(JSON.stringify(before));
    const turned = await ringFromStore(page);
    const side = (r, i) => Math.hypot(r[(i + 1) % 4].x - r[i].x, r[(i + 1) % 4].y - r[i].y);
    for (let i = 0; i < 4; i++) expect(side(turned, i)).toBeCloseTo(side(before, i), 3);
    const originAfterTurn = await originFromStore(page);
    expect(originAfterTurn.lat).toBeCloseTo(originAfterSlide.lat, 12);
    expect(originAfterTurn.lon).toBeCloseTo(originAfterSlide.lon, 12);

    // Both are ordinary undo frames.
    await page.keyboard.press("Control+z");
    await expect.poll(async () => JSON.stringify(await ringFromStore(page)), { timeout: 10_000 })
      .toBe(JSON.stringify(before));
  });
});

test.describe("NEW-3 · a hand-drawn parcel carries a record, and says where it came from", () => {
  test("the provenance mark RENDERS, and a drawn lot never reads as a county record", async ({ page }) => {
    await openUnlocated(page);
    // Select the parcel so its record panel has a subject.
    await selectParcelWithPanel(page);
    const prov = page.getByTestId("parcel-provenance");
    await expect(prov).toHaveText(/Drawn by hand/i);
    // A drawn lot has no county record — so it must not claim one.
    await expect(prov).not.toHaveText(/County record/i);
  });

  test("typed fields persist across a reload", async ({ page }) => {
    await openUnlocated(page);
    await selectParcelWithPanel(page);
    await expect(page.getByTestId("parcel-field-label")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("parcel-field-label").fill("North tract");
    await page.getByTestId("parcel-field-statedAcres").fill("12.50");
    await page.getByTestId("parcel-field-statedAcres").blur();

    await expect.poll(async () => page.evaluate((id) => {
      const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const pc = (all[id]?.parcels || [])[0];
      return pc ? `${pc.label}|${pc.statedAcres}` : null;
    }, SITE_ID), { timeout: 10_000 }).toBe("North tract|12.5");

    await page.reload();
    await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
    await selectParcelWithPanel(page);
    await expect(page.getByTestId("parcel-field-label")).toHaveValue("North tract", { timeout: 15_000 });
    // Stated and measured are shown APART — a deed-called 12.50 against a drawn ~5.51 is a
    // finding, and the panel must show the gap rather than hide it behind one number.
    await expect(page.getByTestId("parcel-stated-check")).toBeVisible();
  });
});
