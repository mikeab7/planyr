/* NEW-1 (SCHED-EMPTY-ON-SLOW-LOAD, 2026-10-06) — a slow or failed schedule load must never read as
 * "this project has no schedule", and must never write.
 *
 * Owner report: with Supabase slow, "all my schedules just disappeared" — the Schedule tab said
 * "No schedule for Goose Creek" and offered Create schedule. Nothing was lost (every row was live in the
 * database); the tab treated "the list has not arrived" as "the list is empty". Create on a project that
 * already had a schedule is how Goose Creek (2)/(3)/(4) were minted on 2026-09-08.
 *
 * RED-PROOF: run against the pre-fix build, the delayed/failed tests FAIL (the empty state + Create show);
 * against the fix they pass. The cloud is simulated by intercepting the one read the embedded scheduler
 * makes when signed out (`planar_data` key hs-v1) — held open, failed, or answered with a Goose-Creek-shaped
 * document (three schedules linked to the project). Every request that could WRITE schedule data is counted;
 * the count must stay zero through loading and failure.
 */
import { test, expect } from "@playwright/test";

const GID = "g-goose";
const GID2 = "g-other";
const emptyState = (page) => page.getByRole("region", { name: /No schedule for/i });
const loadState = (page) => page.getByTestId("schedule-load-state");
const createBtn = (page) => page.getByRole("button", { name: /Create schedule/i });

function task(id, name, parentId = null) {
  return {
    id, name, start: "2026-10-12", end: "2026-10-16", duration: 5, predecessors: [], health: "gray",
    percentComplete: 0, parentId, responsibleParty: "", notes: [], isExpanded: true,
  };
}
// A Goose-Creek-shaped document: three schedules, all linked to the routed project.
function gooseDoc(view = "grid") {
  const link = { linkedSiteId: GID, linkedSiteName: "Goose Creek" };
  return {
    __rev: 211, nPid: 31, nTid: { 1: 3, 30: 3, 22: 3 }, aPid: 1, view, section: "projects", editProjId: null,
    healthColStyle: "stoplight", settings: {},
    projects: {
      1: { id: 1, name: "Master Schedule", ...link, tasks: [task(1, "Kick Off"), task(2, "Due Diligence")] },
      30: { id: 30, name: "MUD v PID", ...link, tasks: [task(1, "Compare")] },
      22: { id: 22, name: "TAS Land Sale", ...link, tasks: [task(1, "Close")] },
    },
  };
}
// A real account whose projects belong to someone else — the routed project genuinely has zero schedules.
function zeroForGooseDoc() {
  return {
    __rev: 5, nPid: 2, nTid: { 1: 2 }, aPid: 1, view: "grid", section: "projects", editProjId: null,
    healthColStyle: "stoplight", settings: {},
    projects: { 1: { id: 1, name: "Elsewhere", linkedSiteId: "g-not-this-one", linkedSiteName: "Elsewhere", tasks: [task(1, "x")] } },
  };
}

/* The simulated cloud. `mode` is switched by the test: "hang" (never answers until released), "fail"
 * (HTTP 500), or "ok" (answers with `doc`). Counts every request that could write. */
async function installCloud(page, { doc }) {
  const cloud = { mode: "hang", reads: 0, writes: [], held: [], doc };
  await page.route("**/rest/v1/**", async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      // Telemetry rows are not schedule writes; everything else under /rest/v1 is counted.
      if (!/client_errors|telemetry/.test(url)) cloud.writes.push(`${method} ${url.replace(/^.*\/rest\/v1\//, "")}`);
      return route.continue();
    }
    if (!/\/rest\/v1\/planar_data/.test(url)) return route.continue();
    cloud.reads += 1;
    if (cloud.mode === "hang") { cloud.held.push(route); return; }
    if (cloud.mode === "fail") return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "XX000", message: "upstream slow" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ value: cloud.doc }) });
  });
  cloud.release = async (mode = "ok") => {
    cloud.mode = mode;
    const held = cloud.held.splice(0);
    for (const r of held) {
      if (mode === "fail") await r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "XX000", message: "upstream slow" }) }).catch(() => {});
      else await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ value: cloud.doc }) }).catch(() => {});
    }
  };
  return cloud;
}

function seed(page) {
  return page.addInitScript(([g1, g2]) => {
    const rec = (id, g, s) => ({ id, groupId: g, site: s, name: "Plan 1", origin: null, updatedAt: Date.now(), parcels: [], els: [], measures: [], settings: {} });
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ p1: rec("p1", g1, "Goose Creek"), p2: rec("p2", g2, "Other Site") }));
    localStorage.setItem("planyr.theme", "light");
    window.__noReloadMarker = "still-here";
  }, [GID, GID2]);
}

const gridShown = (page) => page.locator("iframe").first().evaluate((el) => getComputedStyle(el).visibility === "visible");

test.describe("SCHED-EMPTY-ON-SLOW-LOAD — an unloaded list is not an empty one", () => {
  test("slow load: quiet loading → 'cloud is slow', never 'No schedule' / Create, zero writes; then the real schedule opens with no reload", async ({ page }) => {
    await seed(page);
    const cloud = await installCloud(page, { doc: gooseDoc() });
    await page.goto(`/#/project/${GID}/schedule`);

    // Loading: the quiet state, no empty state, no Create anywhere.
    await expect(loadState(page)).toBeVisible({ timeout: 15_000 });
    await expect(emptyState(page)).toHaveCount(0);
    await expect(createBtn(page)).toHaveCount(0);
    // Past a few seconds it says the cloud is slow (still no empty state, still no Create).
    await expect(loadState(page)).toContainText("Still loading your schedules — the cloud is slow right now.", { timeout: 15_000 });
    await expect(emptyState(page)).toHaveCount(0);
    await expect(createBtn(page)).toHaveCount(0);
    await expect(page.getByText("No schedules here yet.")).toHaveCount(0);
    expect(cloud.writes).toEqual([]);

    // The cloud answers: the Goose-Creek-shaped fixture renders on its own — no reload.
    await cloud.release("ok");
    await expect(loadState(page)).toHaveCount(0, { timeout: 20_000 });
    await expect(emptyState(page)).toHaveCount(0);
    await expect.poll(() => gridShown(page), { timeout: 20_000 }).toBe(true);
    await expect(page.getByTestId("schedule-crumb")).toContainText("Master Schedule", { timeout: 20_000 });
    expect(await page.evaluate(() => window.__noReloadMarker)).toBe("still-here");
    expect(cloud.writes).toEqual([]);
  });

  test("hard failure: 'Couldn't reach your schedules. Nothing is lost.' + Retry, never Create, zero writes; Retry then opens the schedule", async ({ page }) => {
    await seed(page);
    const cloud = await installCloud(page, { doc: gooseDoc() });
    cloud.mode = "fail";
    await page.goto(`/#/project/${GID}/schedule`);

    await expect(loadState(page)).toContainText(/Couldn.t reach your schedules\. Nothing is lost\./, { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await expect(emptyState(page)).toHaveCount(0);
    await expect(createBtn(page)).toHaveCount(0);
    expect(cloud.writes).toEqual([]);

    // The cloud recovers; the user presses Retry (the background backoff would also get there).
    cloud.mode = "ok";
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByTestId("schedule-crumb")).toContainText("Master Schedule", { timeout: 20_000 });
    await expect(loadState(page)).toHaveCount(0);
    expect(await page.evaluate(() => window.__noReloadMarker)).toBe("still-here");
    expect(cloud.writes).toEqual([]);
  });

  test("hard failure then NO click: the background retry opens the schedule by itself", async ({ page }) => {
    await seed(page);
    const cloud = await installCloud(page, { doc: gooseDoc() });
    cloud.mode = "fail";
    await page.goto(`/#/project/${GID}/schedule`);
    await expect(loadState(page)).toContainText(/Couldn.t reach your schedules/, { timeout: 20_000 });
    cloud.mode = "ok";
    await expect(page.getByTestId("schedule-crumb")).toContainText("Master Schedule", { timeout: 30_000 });
    await expect(createBtn(page)).toHaveCount(0);
    expect(cloud.writes).toEqual([]);
  });

  test("a project that really has zero schedules still gets 'No schedule' + Create — once the list has LOADED", async ({ page }) => {
    await seed(page);
    const cloud = await installCloud(page, { doc: zeroForGooseDoc() });
    cloud.mode = "ok";
    await page.goto(`/#/project/${GID}/schedule`);
    await expect(emptyState(page)).toBeVisible({ timeout: 25_000 });
    await expect(createBtn(page)).toBeVisible();
    await expect(loadState(page)).toHaveCount(0);
  });

  test("switching projects mid-load stays in the loading state (no Create for either), then resolves per project", async ({ page }) => {
    await seed(page);
    const cloud = await installCloud(page, { doc: gooseDoc() });
    await page.goto(`/#/project/${GID}/schedule`);
    await expect(loadState(page)).toBeVisible({ timeout: 15_000 });
    await page.goto(`/#/project/${GID2}/schedule`);
    await page.waitForTimeout(800);
    await expect(loadState(page)).toBeVisible();
    await expect(emptyState(page)).toHaveCount(0);
    await expect(createBtn(page)).toHaveCount(0);
    await cloud.release("ok");
    // "Other Site" has no linked schedule in the fixture: now that the list LOADED, Create is honest.
    await expect(emptyState(page)).toContainText("Other Site", { timeout: 25_000 });
    await expect(createBtn(page)).toBeVisible();
    expect(cloud.writes).toEqual([]);
    // …and Goose Creek, which has three, opens its grid.
    await page.goto(`/#/project/${GID}/schedule`);
    await expect(page.getByTestId("schedule-crumb")).toContainText("Master Schedule", { timeout: 20_000 });
    await expect(emptyState(page)).toHaveCount(0);
  });

  for (const view of ["grid", "split", "gantt"]) {
    test(`loaded Goose-Creek fixture opens in ${view} view without the empty state`, async ({ page }) => {
      await seed(page);
      const cloud = await installCloud(page, { doc: gooseDoc(view) });
      cloud.mode = "ok";
      await page.goto(`/#/project/${GID}/schedule`);
      await expect(page.getByTestId("schedule-crumb")).toContainText("Master Schedule", { timeout: 25_000 });
      await expect(emptyState(page)).toHaveCount(0);
      await expect.poll(() => gridShown(page), { timeout: 15_000 }).toBe(true);
    });
  }

  test("phone width: the loading and failed states fit, never overflow sideways, never offer Create", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 700 });
    await seed(page);
    const cloud = await installCloud(page, { doc: gooseDoc() });
    cloud.mode = "fail";
    await page.goto(`/#/project/${GID}/schedule`);
    await expect(loadState(page)).toContainText(/Couldn.t reach your schedules/, { timeout: 20_000 });
    await expect(createBtn(page)).toHaveCount(0);
    const fits = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="schedule-load-state"]');
      const r = el.getBoundingClientRect();
      return r.left >= 0 && r.right <= window.innerWidth && document.documentElement.scrollWidth <= window.innerWidth;
    });
    expect(fits).toBe(true);
    cloud.mode = "ok";
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(() => gridShown(page), { timeout: 20_000 }).toBe(true);
    await expect(emptyState(page)).toHaveCount(0);
  });
});
