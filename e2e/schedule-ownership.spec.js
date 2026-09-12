/* EVERY SCHEDULE HAS AN OWNER — the two user-visible halves, driven against the real app.
 *
 * The owner's report: he cannot have a Master Schedule and a Land Sale schedule under Goose Creek,
 * and pressing "New schedule" three times silently produced "Goose Creek (2)", "(3)" and "(4)" —
 * three empty duplicates that are on production right now. Two things had to change and both are
 * asserted here against a real browser rather than a source regex:
 *
 *   1. NEW SCHEDULE ASKS. It opens a dialog with the name pre-filled and the owner pre-selected to
 *      the project he is standing on, and it CANNOT create anything without both. The old path
 *      created a schedule outright with no prompt at any point, which is precisely why nothing on
 *      screen said it had happened.
 *   2. A PROJECT'S SCHEDULES ARE LISTED, with the ORGANIZATION as a peer container in the same
 *      list — never an "unassigned" or "no project" pile (owner rule: everything lives under
 *      something).
 *
 * Runs LOGGED OUT, like e2e/schedule-link-panel.spec.js, whose seeding + bridge-driving pattern
 * this follows: a Site Planner project in the legacy local store plus a route pointing at it, and
 * the embedded scheduler's nav-state posted in as the iframe would post it. No cloud, no external
 * GIS, so it is fully self-verifiable in the sandbox.
 *
 * ⛔ THE FIXTURE IS THE OWNER'S OWN SHAPE, NOT A TIDY ONE (WRONG-CASE). Goose Creek carries FIVE
 * schedules including the three empty duplicates, and two schedules (Pursuits, Operations) belong
 * to no project at all — that is production at __rev 4232. A one-schedule fixture passes every
 * assertion below while exercising neither the grouping nor the withheld name suggestion.
 */
import { test, expect } from "@playwright/test";

/* The migration block below calls the scheduler page's OWN module-scope declarations from inside
 * `page.evaluate`, where they are live globals of that document — not imports of this file. Declared
 * for ESLint only; if a future build ever wrapped that script in a closure these identifiers would
 * stop resolving and the test would fail LOUDLY, which is exactly the signal wanted (the module
 * would no longer be reachable in the shipped page). */
/* global normalizeScheduleOwnership, migrateScheduleOwnership, pruneScheduleRefs, ownerOf, validateNewSchedule */

const GOOSE = "g-goose";
const GRAND = "g-grand";
/* A project with no schedule of its own — the empty state, where the list and the dialog live. */
const ORPHAN = "g-orphan";

/* Seed the logged-out site store. Two real projects so the owner picker has something to change TO. */
function seed(page) {
  return page.addInitScript(([goose, grand, orphan]) => {
    const rec = (id, g, s) => ({ id, groupId: g, site: s, name: "Plan 1", origin: null, updatedAt: Date.now(), parcels: [], els: [], measures: [], settings: {} });
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({
      p1: rec("p1", goose, "Goose Creek"),
      p2: rec("p2", grand, "Grand Port"),
      // A project with NO schedule of its own — the empty state, which is where the owner list and
      // the New-schedule dialog both live.
      p3: rec("p3", orphan, "Bayou Bend"),
    }));
    localStorage.setItem("planyr.theme", "light");

    /* Record what the shell POSTS into the iframe, so "did pressing Create actually ask for the
     * right thing" is observable without the embedded app (whose in-browser Babel is CDN-loaded and
     * may not run in the sandbox). Same-origin, so wrapping is allowed. */
    const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentWindow");
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get() {
        const w = desc.get.call(this);
        try {
          if (w && !w.__planyrPosted) {
            const orig = w.postMessage.bind(w);
            w.__planyrPosted = true;
            w.postMessage = (m, o) => { (window.__posted = window.__posted || []).push(m); return orig(m, o); };
          }
        } catch (_) {}
        return w;
      },
    });
  }, [GOOSE, GRAND, ORPHAN]);
}

/* The production schedule set, as the embedded app bridges it up. */
const SCHEDULES = [
  { id: 1,  name: "Goose Creek",      ownerKind: "site", linkedSiteId: GOOSE, linkedSiteName: "Goose Creek", taskCount: 301 },
  { id: 19, name: "Goose Creek (2)",  ownerKind: "site", linkedSiteId: GOOSE, linkedSiteName: "Goose Creek", taskCount: 0 },
  { id: 20, name: "Goose Creek (3)",  ownerKind: "site", linkedSiteId: GOOSE, linkedSiteName: "Goose Creek", taskCount: 0 },
  { id: 21, name: "Goose Creek (4)",  ownerKind: "site", linkedSiteId: GOOSE, linkedSiteName: "Goose Creek", taskCount: 0 },
  { id: 22, name: "TAS Land Sale",    ownerKind: "site", linkedSiteId: GOOSE, linkedSiteName: "Goose Creek", taskCount: 8 },
  { id: 2,  name: "Grand Port",       ownerKind: "site", linkedSiteId: GRAND, linkedSiteName: "Grand Port", taskCount: 278 },
  { id: 5,  name: "Pursuits",         ownerKind: "org", taskCount: 15 },
  { id: 7,  name: "Operations",       ownerKind: "org", taskCount: 7 },
];

const postSeq = (page, msg) =>
  page.evaluate((m) => window.postMessage({ source: "planar-seq", ...m }, window.location.origin), msg);

/* NEW-1 — Rename/Duplicate/Delete moved behind a per-row kebab (`schedule-owner-kebab`); the menu
 * itself portals to document.body (AnchoredMenu), so its items are located from `page`, never from
 * the row locator. Opens the kebab for the row matching `text` and returns nothing — callers then
 * locate `schedule-owner-rename`/`-duplicate`/`-delete` from `page` as before. */
async function openRowMenu(page, text) {
  const row = page.getByTestId("schedule-owner-row").filter({ hasText: text });
  await row.getByTestId("schedule-owner-kebab").click();
}

/* Open a project's Schedule tab carrying `projects` as the bridged schedule list.
 *
 * ⛔ THE RE-POST AFTER SETTLE IS LOad-BEARING, and getting it wrong is how this harness first
 * reported ten false failures against working code. The embedded scheduler BOOTS and posts its own
 * nav-state (seeded from `__PLANAR_DATA__` when signed out), so a list posted before it settles is
 * simply overwritten and every assertion below then measures the seed rather than the fixture.
 * Posting after the app has reported in — and re-asserting on the rows that actually render — is
 * what makes the reading about this feature rather than about the boot race. */
async function openSchedule(page, gid, projects) {
  await seed(page);
  await page.goto(`/#/project/${gid}/schedule`);
  // Wait for the tab to resolve (the empty state appears once the iframe reports in, or on its
  // reveal fallback) BEFORE posting, or the embed's own boot post lands last and wins.
  await expect(page.getByTestId("schedule-owner-list")).toBeVisible({ timeout: 25_000 });
  await postSeq(page, { type: "planar:nav-state", section: "projects", activeId: null, projects });
  await expect(page.getByTestId("schedule-owner-row").first()).toBeVisible({ timeout: 10_000 });
}

/* ── B1482096 — the empty-state owner list must never sit loose in a bottom corner ─────────────
 *
 * Owner report, with a screenshot: on a project with no schedule (the "No schedule for …"
 * empty state), the schedule-owner list rendered as bare, unbounded text spanning the full
 * window width underneath it — the project name and "No schedules here yet." hard against the
 * bottom-LEFT corner, each row's count/pencil/trash hard against the bottom-RIGHT corner. Root
 * cause: Scheduler.jsx's own wrapper stretched `left:0; right:0` with no surface behind it,
 * while ScheduleOwnerList's bare wrapper (padding/gap/font only) has never carried its own
 * background/border — correct for its OTHER caller (ScheduleCrumb.jsx), which supplies the
 * surface via AnchoredMenu, wrong for this one, which supplied none. Fixed by making the
 * empty-state wrapper a centered, width-capped panel carrying the same `menuPanelStyle` surface
 * token the breadcrumb's dropdown gets — never by changing ScheduleOwnerList itself, so the
 * dropdown case (asserted throughout the rest of this file) is provably untouched.
 *
 * ⛔ REGRESSION, caught live on planyr.io and corrected in the same item: that first fix kept the
 * owner-list panel as a SEPARATE `position:absolute, bottom:0` sibling stacked over
 * LinkSchedulePanel's own full-bleed box. Two independently-positioned overlays can't see each
 * other's height, so on a short window (measured: ~465px of content height) the owner-list panel
 * overlapped LinkSchedulePanel's own Create/Link buttons — "Link an existing schedule" became
 * genuinely unclickable, `elementFromPoint` at its centre resolved to the panel, not the button —
 * and the panel itself still ran off the bottom with nothing to reach it. Fixed by merging both
 * into ONE full-bleed `overflow:"auto"` shell (`data-testid="schedule-empty-shell"`) holding a
 * plain flex column: LinkSchedulePanel, then the owner-list panel, true document flow so they
 * stack instead of overlapping at any height, and the shell's own scrolling reaches whatever a
 * short window can't fit. The "short viewport" test below reproduces the owner's exact
 * measurement and is the one that would have caught this before it shipped. */
test.describe("B1482096 — the empty-state schedule list reads as one contained panel, never loose corner text", () => {
  // elementFromPoint at the two corners the owner's screenshot showed populated — must resolve to
  // the plain page background (LinkSchedulePanel's own surface), never into the schedule list.
  async function cornerElements(page) {
    return page.evaluate(() => {
      const describe = (el) => !el ? null : {
        testid: el.closest?.("[data-testid]")?.getAttribute("data-testid") || null,
        text: (el.textContent || "").trim().slice(0, 40),
      };
      const w = window.innerWidth, h = window.innerHeight;
      return {
        bottomLeft: describe(document.elementFromPoint(2, h - 2)),
        bottomRight: describe(document.elementFromPoint(w - 2, h - 2)),
      };
    });
  }

  test("a project with NO schedules of its own: nothing sits in either bottom corner, list is one contained panel", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    const corners = await cornerElements(page);
    expect(corners.bottomLeft?.testid).not.toBe("schedule-owner-list");
    expect(corners.bottomLeft?.testid).not.toBe("schedule-owner-row");
    expect(corners.bottomRight?.testid).not.toBe("schedule-owner-list");
    expect(corners.bottomRight?.testid).not.toBe("schedule-owner-row");

    // The list is a bounded, centered panel — not stretched edge to edge.
    const list = page.getByTestId("schedule-owner-list");
    const box = await list.boundingBox();
    const viewport = page.viewportSize();
    expect(box.x).toBeGreaterThan(8);
    expect(box.x + box.width).toBeLessThan(viewport.width - 8);

    // It carries a real surface (the same token the breadcrumb dropdown uses) — not bare text
    // over the page background.
    const bg = await list.evaluate((el) => getComputedStyle(el.parentElement).backgroundColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(bg).not.toBe("transparent");

    // The empty state's own actions stay reachable and unobstructed by the list beneath them.
    await expect(page.getByRole("button", { name: "Create schedule" })).toBeVisible();
  });

  test("a project with SEVERAL schedules of its own already linked: the grid shows, and no owner list leaks into the corners", async ({ page }) => {
    // Goose Creek owns 5 of the fixture's schedules (linkedSiteId matches it), so routing there
    // with one of them active resolves the link and shows the real grid, not the empty state —
    // the adjacent case this containment fix must not regress: the wrapper this item touches is
    // gated on showEmptyState, and must never render (or leave anything behind) once it's false.
    await openScheduleActive(page, GOOSE, SCHEDULES, 1);
    await expect(page.getByTestId("schedule-owner-list")).toHaveCount(0);
    const corners = await cornerElements(page);
    expect(corners.bottomLeft?.testid).not.toBe("schedule-owner-list");
    expect(corners.bottomLeft?.testid).not.toBe("schedule-owner-row");
    expect(corners.bottomRight?.testid).not.toBe("schedule-owner-list");
    expect(corners.bottomRight?.testid).not.toBe("schedule-owner-row");
  });

  test("narrow window: still contained, no horizontal spill", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await openSchedule(page, ORPHAN, SCHEDULES);
    const corners = await cornerElements(page);
    expect(corners.bottomLeft?.testid).not.toBe("schedule-owner-list");
    expect(corners.bottomRight?.testid).not.toBe("schedule-owner-row");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole("button", { name: "Create schedule" })).toBeVisible();
  });

  test("the schedule breadcrumb's own dropdown (a project that HAS a schedule) is unchanged", async ({ page }) => {
    await openScheduleActive(page, GOOSE, SCHEDULES, 1);
    await page.getByTestId("schedule-crumb").click();
    const list = page.getByTestId("schedule-owner-list");
    await expect(list).toBeVisible({ timeout: 10_000 });
    // Still grouped exactly as the existing suite (below) proves in depth — this is a smoke check
    // that the dropdown's own surface (AnchoredMenu's panel) is what's visible, not a doubled-up
    // border from ScheduleOwnerList itself growing a surface of its own.
    const dropdownBg = await list.evaluate((el) => getComputedStyle(el.parentElement).backgroundColor);
    expect(dropdownBg).not.toBe("rgba(0, 0, 0, 0)");
    await expect(list).toContainText("Goose Creek");
  });

  /* ⛔ REGRESSION REPRODUCTION — the owner's exact measurement: a short window (~465px of content
   * height) with the owner-list panel long enough (8 schedules) to no longer fit beside the empty
   * state's own actions. Before the fix, the panel sat on top of "Link an existing schedule" at
   * this height; this test drives BOTH buttons for real and checks the point each renders at, not
   * just that they exist in the DOM (existence alone passed on the broken build too). */
  test("short viewport (~465px): Create and Link are never overlapped by the owner-list panel, and both stay clickable", async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 465 });
    await openSchedule(page, ORPHAN, SCHEDULES);

    const createBtn = page.getByRole("button", { name: "Create schedule" });
    const linkBtn = page.getByRole("button", { name: "Link an existing schedule" });
    await expect(createBtn).toBeVisible();
    await expect(linkBtn).toBeVisible();

    // The owner's own repro: elementFromPoint at each button's centre must resolve INTO the
    // button itself, never into the schedule-owner-list panel sitting over it.
    const hitsOwnButton = async (locator) => {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
      return page.evaluate(({ cx, cy }) => {
        const el = document.elementFromPoint(cx, cy);
        return !!el?.closest?.("button") && !el.closest('[data-testid="schedule-owner-list"]');
      }, { cx, cy });
    };
    expect(await hitsOwnButton(createBtn)).toBe(true);
    expect(await hitsOwnButton(linkBtn)).toBe(true);

    // Document flow, not overlap: the owner-list panel starts at or below the empty state's own
    // content — never above the bottom edge of the buttons that sit above it. Captured BEFORE the
    // click below, because clicking "Link an existing schedule" replaces that trigger with the
    // picker row (progressive disclosure) — its own locator stops resolving after the click.
    const list = page.getByTestId("schedule-owner-list");
    const listBox = await list.boundingBox();
    const linkBox = await linkBtn.boundingBox();
    expect(listBox.y).toBeGreaterThanOrEqual(linkBox.y + linkBox.height - 1);

    // Genuinely clickable, not merely present: this is the exact action the owner reported dead.
    await linkBtn.click();
    await expect(page.getByLabel("Choose a schedule to link")).toBeVisible();

    // The whole thing is reachable — the shell scrolls rather than running content off the
    // bottom with no way back to it.
    const shell = page.getByTestId("schedule-empty-shell");
    const { scrollHeight, clientHeight } = await shell.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
    expect(scrollHeight).toBeGreaterThan(clientHeight); // this fixture's content genuinely overflows 465px
    await shell.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect(list.getByTestId("schedule-owner-row").last()).toBeInViewport();
  });
});

/* B1435888 — "+ New schedule in <project>" lives in the SCHEDULE crumb's own dropdown (the
 * breadcrumb's second, independent level), not on the page surface and not in the PROJECT
 * crumb's "+ New project" row any more — that row now creates a genuine new SITE project, since
 * the project crumb became an uncontrolled site-project switcher. This is what opens the dialog
 * under test. */
async function pressNew(page) {
  await page.locator('[data-testid="new-schedule-modal"]').waitFor({ state: "detached" }).catch(() => {});
  await page.getByTestId("schedule-crumb").click();
  await page.getByTestId("schedule-owner-create").click();
}

test.describe("a project's schedules are listed, with the organization as a peer container", () => {
  test("groups into this project / Organization / other projects — and never an 'unassigned' pile", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    const list = page.getByTestId("schedule-owner-list");

    // The organization is a real heading in the same list, holding the two cross-project schedules.
    await expect(list).toContainText("Organization");
    await expect(list.getByTestId("schedule-owner-row").filter({ hasText: "Pursuits" })).toHaveCount(1);
    await expect(list.getByTestId("schedule-owner-row").filter({ hasText: "Operations" })).toHaveCount(1);

    // ⛔ The words the owner explicitly rejected must appear nowhere.
    await expect(list).not.toContainText(/unassigned/i);
    await expect(list).not.toContainText(/no project/i);

    // This project owns none yet — said plainly, still under its own heading, never dropped.
    await expect(list).toContainText("Bayou Bend");
    await expect(list).toContainText("No schedules here yet.");

    // Every one of the eight schedules is reachable — nothing is hidden by grouping.
    await expect(list.getByTestId("schedule-owner-row")).toHaveCount(SCHEDULES.length);
  });

  test("all five of Goose Creek's schedules sit together under one heading, contiguously", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    // B1435888 — each row's innerText now carries the task count on a second line (right-aligned
    // beside the name); take just the name's own line so this stays a check on ORDER/GROUPING,
    // not on the count's exact rendered text.
    const rowTexts = await page.getByTestId("schedule-owner-row").allInnerTexts();
    const names = rowTexts.map((t) => t.split("\n")[0]);
    const goose = ["Goose Creek", "Goose Creek (2)", "Goose Creek (3)", "Goose Creek (4)", "TAS Land Sale"];
    for (const n of goose) expect(names).toContain(n);
    // One group, not scattered through the account-wide run — which is what the flat switcher did.
    const idx = goose.map((n) => names.indexOf(n));
    expect(Math.max(...idx) - Math.min(...idx)).toBe(goose.length - 1);
  });
});

test.describe("New schedule ASKS — it can never silently mint another 'Goose Creek (5)'", () => {
  async function openDialog(page, gid = ORPHAN) {
    await openSchedule(page, gid, SCHEDULES);
    await pressNew(page);
    await expect(page.getByTestId("new-schedule-modal")).toBeVisible();
  }

  test("pressing it opens a dialog and creates NOTHING on its own", async ({ page }) => {
    await openDialog(page);
    // The whole defect in one assertion: no create was posted by the press itself.
    const posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-create-linked"));
    expect(posted).toEqual([]);
  });

  test("the owner is PRE-SELECTED to the project he is standing on, and is changeable", async ({ page }) => {
    await openDialog(page);
    const owner = page.getByTestId("new-schedule-owner");
    await expect(owner).toHaveValue(ORPHAN);
    // Every real owner is offered, the organization included — and no "none" option exists.
    const options = await owner.locator("option").allInnerTexts();
    expect(options).toContain("Organization");
    expect(options).toContain("Goose Creek");
    expect(options.join("|")).not.toMatch(/unassigned|no project|none/i);
    await owner.selectOption({ label: "Organization" });
    await expect(owner).toHaveValue("__org__");
  });

  test("a project with no schedule yet has its name PRE-FILLED — editable, not committed", async ({ page }) => {
    await openDialog(page);
    await expect(page.getByTestId("new-schedule-name")).toHaveValue("Bayou Bend");
  });

  test("⛔ a project that ALREADY has schedules gets an EMPTY name, never 'Goose Creek (5)'", async ({ page }) => {
    await openDialog(page);
    await page.getByTestId("new-schedule-owner").selectOption({ label: "Goose Creek" });
    const name = page.getByTestId("new-schedule-name");
    await expect(name).toHaveValue("");
    await expect(name).not.toHaveValue(/\(\d+\)/);
    // ...and with nothing typed, it CANNOT be created. This is the three duplicates' root cause,
    // closed: the old path needed no name at all.
    await expect(page.getByTestId("new-schedule-create")).toBeDisabled();
  });

  test("it warns about a same-owner name collision without blocking a deliberate one", async ({ page }) => {
    await openDialog(page);
    await page.getByTestId("new-schedule-owner").selectOption({ label: "Goose Creek" });
    await page.getByTestId("new-schedule-name").fill("Goose Creek");
    await expect(page.getByTestId("new-schedule-warning")).toBeVisible();
    await expect(page.getByTestId("new-schedule-create")).toBeEnabled();
  });

  test("creating posts ONE create carrying the chosen name AND an explicit owner", async ({ page }) => {
    await openDialog(page);
    await page.getByTestId("new-schedule-owner").selectOption({ label: "Goose Creek" });
    await page.getByTestId("new-schedule-name").fill("Land Sale");
    await page.getByTestId("new-schedule-create").click();
    await expect(page.getByTestId("new-schedule-modal")).toHaveCount(0);
    const posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-create-linked"));
    expect(posted.length).toBe(1);
    expect(posted[0].name).toBe("Land Sale");
    expect(posted[0].ownerKind).toBe("site");
    expect(posted[0].siteId).toBe(GOOSE);
  });

  test("an ORG-owned schedule is created with no site at all, and that is a real owner", async ({ page }) => {
    await openDialog(page);
    await page.getByTestId("new-schedule-owner").selectOption({ label: "Organization" });
    await page.getByTestId("new-schedule-name").fill("2027 Pursuits");
    await page.getByTestId("new-schedule-create").click();
    const posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-create-linked"));
    expect(posted.length).toBe(1);
    expect(posted[0].ownerKind).toBe("org");
    expect(posted[0].siteId).toBeNull();
  });

  test("Cancel and Escape both leave without creating anything", async ({ page }) => {
    await openDialog(page);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("new-schedule-modal")).toHaveCount(0);
    expect(await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-create-linked").length)).toBe(0);
  });

  /* The phone layout is one of the adjacent cases the brief called out: the dialog must stay
   * usable and must not overflow the viewport at phone width. */
  test("phone width: the dialog fits and both decisions stay reachable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await openDialog(page);
    const card = page.getByTestId("new-schedule-modal");
    await expect(page.getByTestId("new-schedule-name")).toBeVisible();
    await expect(page.getByTestId("new-schedule-owner")).toBeVisible();
    await expect(page.getByTestId("new-schedule-create")).toBeVisible();
    const box = await card.boundingBox();
    expect(box.width).toBeLessThanOrEqual(390);
    // The page itself must not scroll sideways.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

/* ── B1435888 — the breadcrumb is TWO INDEPENDENT LEVELS: project, then schedule ────────────────
 *
 * Supersedes B1404352's fix, which merged the active schedule's name INTO the single project
 * crumb ("Goose Creek / TAS Land Sale") so the project would never disappear from a click-test
 * that found the header reading "planyr / Dashboard / TAS Land Sale" with Goose Creek gone
 * entirely. The owner picked a different shape from three mockups ("Option A"): the breadcrumb
 * ALWAYS shows Dashboard / <Project> ▾ / <Schedule> ▾ — two independent switchers, mirroring the
 * Site tab's own Project/Plan pair — never one crumb carrying both names, and never collapsed
 * even when the schedule happens to share its project's name.
 */
async function openScheduleActive(page, gid, projects, activeId) {
  await seed(page);
  await page.goto(`/#/project/${gid}/schedule`);
  // Same settle concern as openSchedule (see that function's own comment): wait for the real
  // embedded app to report its OWN boot state (its default local doc has no schedule linked to
  // this fake test group id, so the empty state — the same readiness proxy openSchedule uses —
  // appears first) before posting the fixture that actually carries a link.
  await expect(page.getByTestId("schedule-owner-list")).toBeVisible({ timeout: 25_000 });
  await postSeq(page, { type: "planar:nav-state", section: "projects", activeId, projects });
}

test.describe("B1435888 — the breadcrumb is two independent levels, project then schedule", () => {
  test("standing on Goose Creek's 'TAS Land Sale' schedule, the PROJECT crumb names only the project", async ({ page }) => {
    await openScheduleActive(page, GOOSE, SCHEDULES, 22);
    const crumb = page.getByTestId("project-crumb");
    await expect(crumb).toContainText("Goose Creek", { timeout: 10_000 });
    await expect(crumb).not.toContainText("TAS Land Sale");
  });

  test("…and the SCHEDULE crumb, right beside it, names only the active schedule", async ({ page }) => {
    await openScheduleActive(page, GOOSE, SCHEDULES, 22);
    const crumb = page.getByTestId("schedule-crumb");
    await expect(crumb).toContainText("TAS Land Sale", { timeout: 10_000 });
    await expect(crumb).not.toContainText("Goose Creek");
  });

  test("⛔ the two levels are NEVER collapsed, even when the schedule shares its project's name", async ({ page }) => {
    // Schedule id 1 is named "Goose Creek" inside project "Goose Creek" — both crumbs must still
    // render as two distinct segments, never merged into one.
    await openScheduleActive(page, GOOSE, SCHEDULES, 1);
    await expect(page.getByTestId("project-crumb")).toContainText("Goose Creek", { timeout: 10_000 });
    await expect(page.getByTestId("schedule-crumb")).toContainText("Goose Creek", { timeout: 10_000 });
    await expect(page.getByTestId("project-crumb")).toHaveCount(1);
    await expect(page.getByTestId("schedule-crumb")).toHaveCount(1);
  });

  test("a project with only ONE linked schedule still reads plainly on each crumb", async ({ page }) => {
    await openScheduleActive(page, GRAND, SCHEDULES, 2);
    await expect(page.getByTestId("project-crumb")).toContainText("Grand Port", { timeout: 10_000 });
    await expect(page.getByTestId("schedule-crumb")).toContainText("Grand Port", { timeout: 10_000 });
  });

  test("the PROJECT crumb's dropdown lists projects only — no schedule rows mixed in", async ({ page }) => {
    await openScheduleActive(page, GOOSE, SCHEDULES, 1);
    await page.getByTestId("project-crumb").click();
    const dropdown = page.getByTestId("project-row-" + GOOSE);
    await expect(dropdown).toBeVisible({ timeout: 10_000 });
    // None of the schedule-only names (Pursuits/Operations/TAS Land Sale) appear as a project row.
    await expect(page.getByTestId("project-row-1")).toHaveCount(0);
    await expect(page.getByTestId("project-row-22")).toHaveCount(0);
  });

  test("the SCHEDULE crumb's dropdown groups this project's schedules, then the Organization, then '+ New schedule in <project>'", async ({ page }) => {
    await openScheduleActive(page, GOOSE, SCHEDULES, 1);
    await page.getByTestId("schedule-crumb").click();
    const list = page.getByTestId("schedule-owner-list");
    await expect(list).toBeVisible({ timeout: 10_000 });

    // Goose Creek's own schedules — all five (the fixture's real shape, incl. its three empty
    // duplicates, see this file's own WRONG-CASE note) — never another project's (Grand Port).
    await expect(list.getByTestId("schedule-owner-row").filter({ hasText: "Goose Creek" })).toHaveCount(4); // Goose Creek + (2)/(3)/(4)
    await expect(list.getByTestId("schedule-owner-row").filter({ hasText: "TAS Land Sale" })).toHaveCount(1);
    await expect(list.getByTestId("schedule-owner-row").filter({ hasText: "Grand Port" })).toHaveCount(0);

    // The Organization group, still reachable from inside this project.
    await expect(list).toContainText("Organization");
    await expect(list.getByTestId("schedule-owner-row").filter({ hasText: "Pursuits" })).toHaveCount(1);
    await expect(list.getByTestId("schedule-owner-row").filter({ hasText: "Operations" })).toHaveCount(1);

    // The create row names the project.
    await expect(list.getByTestId("schedule-owner-create")).toContainText("New schedule in Goose Creek");
  });

  test("switching from Goose Creek's own schedule to its 'TAS Land Sale' schedule actually changes what's open", async ({ page }) => {
    await openScheduleActive(page, GOOSE, SCHEDULES, 1);
    await page.getByTestId("schedule-crumb").click();
    await page.getByTestId("schedule-owner-list").getByTestId("schedule-owner-row").filter({ hasText: "TAS Land Sale" }).click();
    const posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-select"));
    expect(posted).toEqual([{ source: "planar-shell", type: "planar:nav-select", id: 22 }]);
  });
});

/* ── B1341184 — switching the PROJECT crumb must re-drive the SCHEDULE crumb ────────────────────
 *
 * Owner report: picking a project from LEVEL 1 (the plain project switcher) never changed which
 * schedule was open — LEVEL 2 kept naming whatever schedule was last active, regardless of which
 * project the breadcrumb now named. Root cause (navState.js's isPickShowing, see its own header):
 * once a schedule was explicitly picked from the SCHEDULE crumb, the "deliberate pick" flag latched
 * TRUE forever — it never checked whether the ROUTED PROJECT itself had since changed — and that
 * flag gates the self-healing carry-in effect that is supposed to re-drive the embed toward the
 * newly routed project's own schedule. So the very first deliberate schedule pick in a session
 * permanently defeated the "switching projects follows a project's own schedule" mechanism.
 *
 * These tests exercise the SHELL side only (same idiom as the rest of this file — the embedded
 * app's own CDN-loaded Babel doesn't run in this sandbox): assert the shell actually POSTS
 * `planar:nav-select-by-site` for the newly routed project once the PROJECT crumb is switched, and
 * that the SCHEDULE crumb never keeps naming a foreign project's schedule.
 */
test.describe("B1341184 — switching PROJECTS re-drives the SCHEDULE crumb, never leaves it naming a foreign schedule", () => {
  const postedBySite = (page, siteId) => page.evaluate(
    (sid) => (window.__posted || []).some((m) => m && m.type === "planar:nav-select-by-site" && m.siteId === sid),
    siteId,
  );

  test("picking 'TAS Land Sale' under Goose Creek, then switching to Grand Port, re-posts nav-select-by-site for Grand Port", async ({ page }) => {
    // ⛔ THE DEADLOCK ONLY ENGAGES ON A REAL, UI-DRIVEN PICK — seeding activeId directly (as
    // openScheduleActive's other callers do) never sets `explicitPickRef`, so it can't reproduce
    // this. Drive the actual schedule-crumb dropdown, exactly as the owner's own repro did.
    await openScheduleActive(page, GOOSE, SCHEDULES, 1);
    await page.getByTestId("schedule-crumb").click();
    await page.getByTestId("schedule-owner-list").getByTestId("schedule-owner-row").filter({ hasText: "TAS Land Sale" }).click();
    // Simulate the embed confirming the switch — this is what actually arms `pickShowing`.
    await postSeq(page, { type: "planar:nav-state", section: "projects", activeId: 22, projects: SCHEDULES });
    await expect(page.getByTestId("schedule-crumb")).toContainText("TAS Land Sale", { timeout: 10_000 });

    await page.getByTestId("project-crumb").click();
    await page.getByTestId(`project-row-${GRAND}`).click();
    await expect.poll(() => page.url()).toContain(GRAND);

    // ⛔ THE REGRESSION: before the fix, this never posted — `pickShowing` stayed latched true
    // forever once TAS Land Sale was explicitly picked, permanently gating off the carry-in effect
    // regardless of which project the breadcrumb was switched to afterward.
    await expect.poll(() => postedBySite(page, GRAND), { timeout: 10_000 }).toBe(true);

    // Once the embed reports back that it actually switched, the SCHEDULE crumb must read Grand
    // Port's own schedule — never the one it was stuck on.
    await postSeq(page, { type: "planar:nav-state", section: "projects", activeId: 2, projects: SCHEDULES });
    await expect(page.getByTestId("schedule-crumb")).toContainText("Grand Port", { timeout: 10_000 });
    await expect(page.getByTestId("schedule-crumb")).not.toContainText("TAS Land Sale");
  });

  test("switching to a project with NO schedule of its own never leaves the crumb naming another project's schedule", async ({ page }) => {
    await openScheduleActive(page, GOOSE, SCHEDULES, 22);
    await expect(page.getByTestId("schedule-crumb")).toContainText("TAS Land Sale", { timeout: 10_000 });

    await page.getByTestId("project-crumb").click();
    await page.getByTestId(`project-row-${ORPHAN}`).click();
    await expect.poll(() => page.url()).toContain(ORPHAN);

    // Bayou Bend owns no schedule — the empty state takes over, and the crumb must fall back to
    // its own "no schedule selected" label rather than keep naming Goose Creek's TAS Land Sale.
    await expect(page.getByRole("region", { name: /No schedule for/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("schedule-crumb")).not.toContainText("TAS Land Sale");
  });

  test("a deliberately-picked ORGANIZATION schedule (Pursuits) does not stop a later project switch from re-driving the carry-in", async ({ page }) => {
    await openScheduleActive(page, GOOSE, SCHEDULES, 1);
    await page.getByTestId("schedule-crumb").click();
    await page.getByTestId("schedule-owner-list").getByTestId("schedule-owner-row").filter({ hasText: "Pursuits" }).click();
    await postSeq(page, { type: "planar:nav-state", section: "projects", activeId: 5, projects: SCHEDULES });
    await expect(page.getByTestId("schedule-crumb")).toContainText("Pursuits", { timeout: 10_000 });

    // Switching the routed project must not stay blocked by the standing cross-cutting pick.
    await page.getByTestId("project-crumb").click();
    await page.getByTestId(`project-row-${GRAND}`).click();
    await expect.poll(() => page.url()).toContain(GRAND);
    await expect.poll(() => postedBySite(page, GRAND), { timeout: 10_000 }).toBe(true);
  });
});

/* ── B1404352 — a schedule can be RENAMED and DELETED from its own row ───────────────────────────
 *
 * Owner's live click-test on planyr.io: he searched every element on the page for an aria-label
 * or title matching delete/rename/remove and found ZERO. The project breadcrumb's kebab menu
 * (B439/B1358128) only ever reaches the ONE schedule linked to the CURRENT project — every other
 * schedule this list shows (a project's second schedule, anything Organization-owned, anything
 * belonging to another project) had no control at all. These tests drive the real per-row Pencil/
 * Trash icons ScheduleOwnerList now renders and assert the exact bridge messages they post — the
 * same `planar:nav-rename`/`planar:nav-delete` messages the breadcrumb's own kebab already used,
 * so the embedded app's existing rename/delete/prune logic (unchanged by this item) is reused
 * rather than reimplemented.
 *
 * RED-PROOF: every `schedule-owner-rename`/`schedule-owner-delete` testid this file locates is
 * new in this PR — `git stash` on this branch and any test below fails at its very first locator
 * (element not found), which is the owner's own repro ("ZERO matches") reproduced mechanically.
 *
 * ⛔ NEW-1 (2026-09-10) — Rename/Duplicate/Delete moved BEHIND a per-row kebab
 * (`schedule-owner-kebab`); every click below now opens that kebab first (`openRowMenu`, above)
 * instead of clicking a formerly-always-visible icon directly on the row.
 */
test.describe("B1404352 — a schedule can be renamed from its own row", () => {
  test("the pencil opens an inline editor pre-filled with the current name — no dialog box", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    await openRowMenu(page, "TAS Land Sale");
    await page.getByTestId("schedule-owner-rename").click();
    const input = page.getByTestId("schedule-owner-rename-input");
    await expect(input).toBeVisible();
    await expect(input).toHaveValue("TAS Land Sale");
  });

  test("Enter commits and posts planar:nav-rename with the SCHEDULE's own id, not the project's", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    await openRowMenu(page, "TAS Land Sale");
    await page.getByTestId("schedule-owner-rename").click();
    const input = page.getByTestId("schedule-owner-rename-input");
    await input.fill("Land Sale — Phase 2");
    await input.press("Enter");
    await expect(page.getByTestId("schedule-owner-rename-input")).toHaveCount(0);
    const posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-rename"));
    expect(posted).toEqual([{ source: "planar-shell", type: "planar:nav-rename", id: 22, name: "Land Sale — Phase 2" }]);
  });

  test("Escape cancels — nothing is posted and the row reverts to its prior name", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    await openRowMenu(page, "TAS Land Sale");
    await page.getByTestId("schedule-owner-rename").click();
    const input = page.getByTestId("schedule-owner-rename-input");
    await input.fill("Something Else Entirely");
    await input.press("Escape");
    await expect(page.getByTestId("schedule-owner-row").filter({ hasText: "TAS Land Sale" })).toBeVisible();
    const posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-rename"));
    expect(posted).toEqual([]);
  });

  test("renaming to a name already used by a sibling under the SAME owner WARNS but still commits", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    // Goose Creek (2) → "TAS Land Sale", which Goose Creek already has (id 22).
    await openRowMenu(page, "Goose Creek (2)");
    await page.getByTestId("schedule-owner-rename").click();
    const input = page.getByTestId("schedule-owner-rename-input");
    await input.fill("TAS Land Sale");
    await expect(page.getByText(/already a schedule called/i)).toBeVisible();
    await input.press("Enter");
    const posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-rename"));
    expect(posted).toEqual([{ source: "planar-shell", type: "planar:nav-rename", id: 19, name: "TAS Land Sale" }]);
  });

  test("an Organization-owned schedule renames the same way as a project's own", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    await openRowMenu(page, "Pursuits");
    await page.getByTestId("schedule-owner-rename").click();
    await page.getByTestId("schedule-owner-rename-input").fill("2027 Pursuits");
    await page.getByTestId("schedule-owner-rename-input").press("Enter");
    const posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-rename"));
    expect(posted).toEqual([{ source: "planar-shell", type: "planar:nav-rename", id: 5, name: "2027 Pursuits" }]);
  });
});

test.describe("B1404352 — a schedule can be deleted from its own row", () => {
  test("the trash opens an inline confirmation that NAMES the schedule and its task count — no dialog box", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    await openRowMenu(page, "TAS Land Sale");
    await page.getByTestId("schedule-owner-delete").click();
    const confirm = page.getByTestId("schedule-owner-row-confirm");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("TAS Land Sale");
    await expect(confirm).toContainText("8 tasks");
    const posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-delete"));
    expect(posted).toEqual([]); // opening the confirmation deletes nothing by itself
  });

  // B1547280-followup — Michael asked twice (original NEW-1 dispatch, then again as a still-owed
  // item) whether deleting a schedule holding hundreds of tasks asks for confirmation and what
  // becomes of the tasks, and asked for it established on a throwaway, not read from source. The
  // fixture above already carries "Goose Creek" at 301 tasks (this project's real production
  // count at the time B1489696 shipped) — this test deletes THAT specific row, not a small one,
  // and checks the real DOM confirmation text against the real count rather than asserting a
  // rounder, easier number.
  test("deleting a schedule with hundreds of tasks (301) asks first and names the exact count", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    // "Goose Creek" alone, not its "(2)"/"(3)"/"(4)" siblings which also match a plain substring.
    const row = page.getByTestId("schedule-owner-row").filter({ hasText: /Goose Creek(?!\s*\()/ });
    await expect(row).toHaveCount(1);
    await row.getByTestId("schedule-owner-kebab").click();
    await page.getByTestId("schedule-owner-delete").click();
    const confirm = page.getByTestId("schedule-owner-row-confirm");
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("Goose Creek");
    await expect(confirm).toContainText("301 tasks");
    // Nothing is removed until Delete is pressed — confirming, then actually clicking through.
    let posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-delete"));
    expect(posted).toEqual([]);
    await page.getByTestId("schedule-owner-delete-confirm").click();
    posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-delete"));
    // The shell's own job ends at posting the delete for the schedule's real id — the embedded
    // app (public/sequence/index.html, not mocked in this shell-only spec) is what actually
    // removes the project and its tasks on receiving this message; see deleteProject's own
    // `delete newProjects[id]` in that file, which drops the whole record — tasks included,
    // regardless of how many there are — and first writes a labelled pre-delete snapshot to
    // Version History so the removal is recoverable.
    expect(posted).toEqual([{ source: "planar-shell", type: "planar:nav-delete", id: 1 }]);
  });

  test("an EMPTY schedule's confirmation says so, distinctly from a task count of zero", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    await openRowMenu(page, "Goose Creek (2)");
    await page.getByTestId("schedule-owner-delete").click();
    await expect(page.getByTestId("schedule-owner-row-confirm")).toContainText(/no tasks/i);
  });

  test("'Keep it' cancels — nothing is posted and the row is back to normal", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    await openRowMenu(page, "TAS Land Sale");
    await page.getByTestId("schedule-owner-delete").click();
    await page.getByTestId("schedule-owner-delete-cancel").click();
    await expect(page.getByTestId("schedule-owner-row-confirm")).toHaveCount(0);
    await expect(page.getByTestId("schedule-owner-row").filter({ hasText: "TAS Land Sale" })).toBeVisible();
    const posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-delete"));
    expect(posted).toEqual([]);
  });

  test("Delete posts planar:nav-delete with the schedule's own id", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    await openRowMenu(page, "Goose Creek (2)");
    await page.getByTestId("schedule-owner-delete").click();
    await page.getByTestId("schedule-owner-delete-confirm").click();
    const posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-delete"));
    expect(posted).toEqual([{ source: "planar-shell", type: "planar:nav-delete", id: 19 }]);
  });

  test("deleting an Organization-owned schedule posts the same message shape", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    await openRowMenu(page, "Operations");
    await page.getByTestId("schedule-owner-delete").click();
    await page.getByTestId("schedule-owner-delete-confirm").click();
    const posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-delete"));
    expect(posted).toEqual([{ source: "planar-shell", type: "planar:nav-delete", id: 7 }]);
  });

  test("deleting another project's schedule (not the routed one) works the same from 'Other projects'", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    await openRowMenu(page, "Grand Port");
    await page.getByTestId("schedule-owner-delete").click();
    await page.getByTestId("schedule-owner-delete-confirm").click();
    const posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-delete"));
    expect(posted).toEqual([{ source: "planar-shell", type: "planar:nav-delete", id: 2 }]);
  });
});

/* ── NEW-1 — the kebab consolidation itself, and the adjacent cases the dispatch asked to check ── */
test.describe("NEW-1 — schedule row actions collapse into one kebab", () => {
  test("at rest, a row shows exactly one kebab and no separately-exposed Rename/Duplicate/Delete", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    const row = page.getByTestId("schedule-owner-row").filter({ hasText: "TAS Land Sale" });
    await expect(row.getByTestId("schedule-owner-kebab")).toHaveCount(1);
    await expect(row.getByTestId("schedule-owner-rename")).toHaveCount(0);
    await expect(row.getByTestId("schedule-owner-duplicate")).toHaveCount(0);
    await expect(row.getByTestId("schedule-owner-delete")).toHaveCount(0);
  });

  test("many rows: every row gets its own kebab, none bleeds into another's menu", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    await expect(page.getByTestId("schedule-owner-kebab")).toHaveCount(SCHEDULES.length);
    await openRowMenu(page, "Pursuits");
    await expect(page.getByTestId("schedule-owner-delete")).toHaveCount(1);
    // Closing this row's menu and opening a different row's must not leave two menus open at once.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("schedule-owner-delete")).toHaveCount(0);
    await openRowMenu(page, "Operations");
    await expect(page.getByTestId("schedule-owner-delete")).toHaveCount(1);
  });

  test("opening the kebab does not switch the schedule (no planar:nav-select side effect)", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    await openRowMenu(page, "Grand Port");
    await expect(page.getByTestId("schedule-owner-delete")).toBeVisible();
    const posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-select"));
    expect(posted).toEqual([]);
  });

  test("clicking the row (not the kebab) still selects the schedule", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    await page.getByTestId("schedule-owner-row").filter({ hasText: "Grand Port" }).click();
    const posted = await page.evaluate(() => (window.__posted || []).filter((m) => m && m.type === "planar:nav-select"));
    expect(posted).toEqual([{ source: "planar-shell", type: "planar:nav-select", id: 2 }]);
  });

  test("the kebab is reachable and operable by keyboard alone", async ({ page }) => {
    await openSchedule(page, ORPHAN, SCHEDULES);
    const kebab = page.getByTestId("schedule-owner-row").filter({ hasText: "Pursuits" }).getByTestId("schedule-owner-kebab");
    await kebab.focus();
    await expect(kebab).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("schedule-owner-delete")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("schedule-owner-delete")).toHaveCount(0);
  });

  test("the menu flips rather than clipping when the kebab sits near the bottom of the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 420 });
    await openSchedule(page, ORPHAN, SCHEDULES);
    // "Grand Port" is one of the last rows this fixture renders — near the bottom of a short window.
    await openRowMenu(page, "Grand Port");
    const menu = page.getByTestId("schedule-owner-delete");
    await expect(menu).toBeVisible();
    const kebabBox = await page.getByTestId("schedule-owner-row").filter({ hasText: "Grand Port" }).getByTestId("schedule-owner-kebab").boundingBox();
    const menuBox = await menu.boundingBox();
    // A flipped (above-the-anchor) menu sits fully within the viewport; a clipped one would not.
    expect(menuBox.y).toBeGreaterThanOrEqual(0);
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(420);
    expect(kebabBox).not.toBeNull();
  });
});

/* ── The migration, exercised in the SHIPPED bytes ────────────────────────────────────────────────
 *
 * ⛔ EVERY OTHER CHECK ON THE MIGRATION READS THE CANONICAL MODULE IN src/. The embedded scheduler
 * cannot import from src/ — it carries a verbatim INLINED copy — and the production build then
 * pre-compiles its Babel blocks and strips @babel/standalone (see scripts/build-sequence-compiled).
 * So "the module is correct" and "the module is alive in the page the owner loads" are two
 * different claims, and only the second one protects his data. A unit test on src/ would stay green
 * through a broken inline copy, a marker that drifted, or a build step that scoped the block away.
 * This drives the real /sequence/ page and calls the functions that are actually in it.
 *
 * The document is production's shape at __rev 4232: twelve schedules, 813 tasks, two owned by no
 * project, and eight orphaned next-task-id counters. The assertions are the two promises the PR
 * makes about his data — NOTHING LOSES ITS TASKS and NOTHING BECOMES UNREACHABLE. */
test.describe("the ownership migration is live in the shipped scheduler page", () => {
  const DOC = {
    __rev: 4232, nPid: 23, aPid: 1,
    nTid: { 1: 302, 2: 279, 3: 162, 4: 5, 5: 16, 6: 43, 7: 8, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1,
            13: 1, 14: 1, 15: 2, 16: 1, 17: 1, 18: 1, 19: 1, 20: 1, 21: 1, 22: 9 },
    lastActiveBySite: { "smqfy2r7pdec": 2, "smqfy48tlk9j": 22, "smsdrvzr9gzx": 15 },
    projects: {
      1:  { id: 1,  name: "Goose Creek",      n: 301, linkedSiteId: "smqfy48tlk9j" },
      2:  { id: 2,  name: "Grand Port",       n: 278, linkedSiteId: "smqfy2r7pdec" },
      3:  { id: 3,  name: "8 South",          n: 161, linkedSiteId: "smqiljx5fngg" },
      5:  { id: 5,  name: "Pursuits",         n: 15 },
      6:  { id: 6,  name: "Pappadoupolos",    n: 42,  linkedSiteId: "smqgpt12zh5o" },
      7:  { id: 7,  name: "Operations",       n: 7 },
      15: { id: 15, name: "Richfield",        n: 1,   linkedSiteId: "smsdrvzr9gzx" },
      16: { id: 16, name: "ZZ-RENAME-TEST-G", n: 0,   linkedSiteId: "smtjb0lrexb3" },
      19: { id: 19, name: "Goose Creek (2)",  n: 0,   linkedSiteId: "smqfy48tlk9j" },
      20: { id: 20, name: "Goose Creek (3)",  n: 0,   linkedSiteId: "smqfy48tlk9j" },
      21: { id: 21, name: "Goose Creek (4)",  n: 0,   linkedSiteId: "smqfy48tlk9j" },
      22: { id: 22, name: "TAS Land Sale",    n: 8,   linkedSiteId: "smqfy48tlk9j" },
    },
  };

  async function runInPage(page, fnBody) {
    await page.goto("/sequence/index.html");
    // The ownership block is a module-scope declaration in the page's own script, so it is reachable
    // as a bare identifier. Wait for it rather than racing the compiled bundle's evaluation.
    await page.waitForFunction(() => typeof normalizeScheduleOwnership === "function", null, { timeout: 30_000 });
    return page.evaluate(fnBody, DOC);
  }

  test("the inlined module is genuinely present and callable in the built page", async ({ page }) => {
    const kinds = await runInPage(page, () => [
      typeof normalizeScheduleOwnership, typeof migrateScheduleOwnership,
      typeof pruneScheduleRefs, typeof ownerOf, typeof validateNewSchedule,
    ]);
    expect(kinds).toEqual(["function", "function", "function", "function", "function"]);
  });

  test("NOTHING LOSES ITS TASKS and NOTHING BECOMES UNREACHABLE", async ({ page }) => {
    const out = await runInPage(page, (doc) => {
      // Rehydrate the task arrays at their real lengths inside the page.
      const d = { ...doc, projects: {} };
      for (const [pid, p] of Object.entries(doc.projects)) {
        d.projects[pid] = { ...p, tasks: Array.from({ length: p.n }, (_, i) => ({ id: i + 1 })) };
      }
      const before = Object.values(d.projects).reduce((n, p) => n + p.tasks.length, 0);
      const after = normalizeScheduleOwnership(d);
      return {
        before,
        afterTasks: Object.values(after.projects).reduce((n, p) => n + p.tasks.length, 0),
        ids: Object.keys(after.projects).map(Number).sort((a, b) => a - b),
        owners: Object.fromEntries(Object.values(after.projects).map((p) => [p.name, ownerOf(p).kind])),
        nTidKeys: Object.keys(after.nTid).map(Number).sort((a, b) => a - b),
        lastActive: after.lastActiveBySite,
        idempotent: normalizeScheduleOwnership(after) === after,
      };
    });

    expect(out.before).toBe(813);
    expect(out.afterTasks).toBe(813);                       // not one task lost
    expect(out.ids).toEqual([1, 2, 3, 5, 6, 7, 15, 16, 19, 20, 21, 22]); // not one schedule dropped

    // Every schedule now has an explicit owner; only the two genuinely cross-project ones are the
    // organization's. NOT ONE was guessed from a name — see the module header.
    expect(out.owners).toEqual({
      "Goose Creek": "site", "Goose Creek (2)": "site", "Goose Creek (3)": "site",
      "Goose Creek (4)": "site", "TAS Land Sale": "site", "Grand Port": "site",
      "8 South": "site", "Pappadoupolos": "site", "Richfield": "site",
      "ZZ-RENAME-TEST-G": "site", "Pursuits": "org", "Operations": "org",
    });

    // The eight orphaned counters (4, 8–14, 17, 18) are swept; every live one survives.
    expect(out.nTidKeys).toEqual([1, 2, 3, 5, 6, 7, 15, 16, 19, 20, 21, 22]);
    // The last-active pointers all name live schedules, so none is touched.
    expect(out.lastActive).toEqual({ "smqfy2r7pdec": 2, "smqfy48tlk9j": 22, "smsdrvzr9gzx": 15 });
    // A second boot changes nothing — so this never bumps __rev on every tab that opens.
    expect(out.idempotent).toBe(true);
  });

  test("deleting a schedule takes its counter and its pointer with it", async ({ page }) => {
    const out = await runInPage(page, (doc) => {
      const d = { ...doc, projects: {} };
      for (const [pid, p] of Object.entries(doc.projects)) d.projects[pid] = { ...p, tasks: [] };
      const seeded = normalizeScheduleOwnership(d);
      const projects = { ...seeded.projects };
      delete projects[22];                                  // he deletes "TAS Land Sale"
      const after = pruneScheduleRefs({ ...seeded, projects });
      return { nTid22: after.nTid[22] ?? null, goose: after.lastActiveBySite["smqfy48tlk9j"] ?? null,
               grand: after.lastActiveBySite["smqfy2r7pdec"] ?? null };
    });
    expect(out.nTid22).toBeNull();
    expect(out.goose).toBeNull();     // no pointer left aimed at a schedule that is gone
    expect(out.grand).toBe(2);        // live pointers untouched
  });
});
