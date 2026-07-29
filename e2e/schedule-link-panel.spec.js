/* NEW-1 / NEW-2 — the Schedule tab's empty state for a project with no linked schedule.
 *
 * The owner's report: on Tsakiris, opening Schedule showed no create/link surface AT ALL, leaving
 * the project with no way to get a schedule (on Sylvestri it appeared normally). Cause: the X /
 * Escape dismissal that B1050 added was per-project component state in a KEPT-ALIVE workspace, so
 * one dismissal removed the only entry point for that project for the rest of the session.
 *
 * NEW-2's fix is structural: this is no longer a modal over the embedded Gantt, it is the tab's
 * EMPTY STATE rendered instead of it. Nothing is covered, so there is nothing to dismiss — the
 * strand is impossible by construction — and pressing Dashboard (which clears the routed project)
 * is the single, always-available way out.
 *
 * Runs LOGGED OUT: this needs only a Site Planner project in the local store (the legacy
 * `planarfit:sites:v1` store the app reads when signed out) plus a route pointing at it. No cloud,
 * no external GIS, so it is fully self-verifiable in the sandbox. Screenshots land in
 * test-results/schedule-empty-*.png for the V### sign-off (light + dark, desktop + narrow, and the
 * three content states).
 */
import { test, expect } from "@playwright/test";

const GID = "g-tsakiris";
const GID2 = "g-sylvestri";
// A deliberately long name — the content column is capped, so a long project name is the copy's
// worst case ("no clipped or overflowing text").
const LONG_NAME = "Tsakiris Business Park — Phase II Redevelopment";

/* Seed the logged-out site store + the theme BEFORE any app script runs. */
function seed(page, { theme = "light", name = LONG_NAME } = {}) {
  return page.addInitScript(([gid, gid2, siteName, mode]) => {
    const rec = (id, g, s) => ({ id, groupId: g, site: s, name: "Plan 1", origin: null, updatedAt: Date.now(), parcels: [], els: [], measures: [], settings: {} });
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({
      p1: rec("p1", gid, siteName),
      p2: rec("p2", gid2, "Sylvestri"),
    }));
    localStorage.setItem("planyr.theme", mode);
  }, [GID, GID2, name, theme]);
}

const emptyState = (page) => page.getByRole("region", { name: /No schedule for/i });

/* Post a bridge message AS the embedded scheduler would (same-origin ⇒ passes the origin guard),
 * so the schedule list / suggested match / iframe section can be driven without its cloud. */
const postSeq = (page, msg) =>
  page.evaluate((m) => window.postMessage({ source: "planar-seq", ...m }, window.location.origin), msg);
const navState = (projects, activeId = null, section = "projects") =>
  ({ type: "planar:nav-state", section, activeId, projects });

async function openUnlinkedSchedule(page, opts = {}) {
  await seed(page, opts);
  await page.goto(`/#/project/${opts.gid || GID}/schedule`);
  // The empty state waits on the iframe reporting in (or the ~2.5 s reveal fallback).
  await expect(emptyState(page)).toBeVisible({ timeout: 25_000 });
}

test.describe("NEW-1 — the project can never be stranded without a create/link surface", () => {
  test("there is nothing to dismiss: Escape does not remove it", async ({ page }) => {
    await openUnlinkedSchedule(page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    await expect(emptyState(page)).toBeVisible();
    // No close affordance survives anywhere on the surface.
    await expect(emptyState(page).getByRole("button", { name: /^close$/i })).toHaveCount(0);
    await expect(emptyState(page)).not.toContainText("✕");
  });

  test("Dashboard clears the route — then routing BACK brings the empty state straight back", async ({ page }) => {
    await openUnlinkedSchedule(page);
    await page.getByRole("button", { name: "Dashboard", exact: true }).first().click();
    // The outer route must follow the iframe, and the empty state must unmount with it.
    await expect.poll(() => page.url(), { timeout: 10_000 }).not.toContain("/project/");
    await expect(emptyState(page)).toHaveCount(0);
    // …and it must STAY gone (the carry-out effect must not re-adopt the site we just cleared).
    await page.waitForTimeout(2000);
    await expect(emptyState(page)).toHaveCount(0);
    // THE REGRESSION: come back to the very same project. It must be there again.
    await page.goto(`/#/project/${GID}/schedule`);
    await expect(emptyState(page)).toBeVisible({ timeout: 25_000 });
  });

  test("leaving to another tab and returning keeps it (the kept-alive workspace)", async ({ page }) => {
    await openUnlinkedSchedule(page);
    await page.goto(`/#/project/${GID}/site`);
    await expect(emptyState(page)).toHaveCount(0);
    await page.goto(`/#/project/${GID}/schedule`);
    await expect(emptyState(page)).toBeVisible({ timeout: 25_000 });
  });

  test("the iframe's own dashboard section does not suppress it", async ({ page }) => {
    await openUnlinkedSchedule(page);
    // The embed reports it is on reports — where an unlinked site leaves it, since its
    // nav-select-by-site handler has no link to resolve and returns state unchanged.
    await postSeq(page, navState([{ id: 1, name: "Some other schedule" }], null, "reports"));
    await page.waitForTimeout(1500);
    await expect(emptyState(page)).toBeVisible();
  });
});

test.describe("NEW-2 — it is the tab's empty state, not a modal over the grid", () => {
  test("no dialog role, no scrim, and the iframe is hidden rather than covered", async ({ page }) => {
    await openUnlinkedSchedule(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const iframeHidden = await page.locator("iframe").first().evaluate(
      (el) => getComputedStyle(el).visibility === "hidden");
    expect(iframeHidden).toBe(true);
    // The surface sits on the page surface — an opaque background, never a translucent dim.
    const bg = await emptyState(page).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toMatch(/rgba\([^)]*,\s*0?\.\d+\s*\)/); // no alpha ⇒ no scrim
    // …and no raised card: no shadow, no border on the surface.
    const box = await emptyState(page).evaluate((el) => ({
      shadow: getComputedStyle(el).boxShadow, border: getComputedStyle(el).borderTopWidth,
    }));
    expect(box.shadow).toBe("none");
    expect(box.border).toBe("0px");
    // Pressing Dashboard reveals the real dashboard, unobstructed.
    await page.getByRole("button", { name: "Dashboard", exact: true }).first().click();
    await expect(emptyState(page)).toHaveCount(0);
    const iframeShown = await page.locator("iframe").first().evaluate(
      (el) => getComputedStyle(el).visibility === "visible");
    expect(iframeShown).toBe(true);
  });

  test("the primary action is sized to its content, not a full-bleed slab", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await openUnlinkedSchedule(page);
    const create = emptyState(page).getByRole("button", { name: "Create schedule", exact: true });
    await expect(create).toBeVisible();
    const w = await create.evaluate((el) => el.getBoundingClientRect().width);
    expect(w).toBeLessThan(220); // content-sized; the old slab spanned the whole card
  });

  test("no dead controls on first run — the picker is revealed on request", async ({ page }) => {
    await openUnlinkedSchedule(page);
    await postSeq(page, navState([{ id: 1, name: "Goose Creek" }, { id: 2, name: "Grand Port" }], null));
    await page.waitForTimeout(800);
    // Nothing to pick from and nothing disabled until the user asks for it.
    await expect(emptyState(page).locator("select")).toHaveCount(0);
    await expect(emptyState(page).getByRole("button", { name: "Link", exact: true })).toHaveCount(0);
    await emptyState(page).getByRole("button", { name: "Link an existing schedule", exact: true }).click();
    const select = emptyState(page).getByRole("combobox", { name: /choose a schedule/i });
    await expect(select).toBeVisible();
    // Focus follows the disclosure, so the keyboard path continues into the picker.
    await expect(select).toBeFocused();
    await select.selectOption("2");
    await expect(emptyState(page).getByRole("button", { name: "Link", exact: true })).toBeEnabled();
  });

  test("a same-named schedule is promoted to the secondary action, generic link demoted", async ({ page }) => {
    await openUnlinkedSchedule(page, { name: "Sylvestri Tract" });
    await postSeq(page, navState([{ id: 7, name: "Sylvestri Tract" }, { id: 8, name: "Grand Port" }], null));
    await page.waitForTimeout(800);
    const promoted = emptyState(page).getByRole("button", { name: 'Link “Sylvestri Tract”' });
    await expect(promoted).toBeVisible();
    const generic = emptyState(page).getByRole("button", { name: "Link an existing schedule", exact: true });
    await expect(generic).toBeVisible();
    // Demoted: smaller than the promoted match, and below it in the reading + tab order.
    const sizes = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")];
      const p = btns.find((b) => /^Link “/.test(b.textContent || ""));
      const g = btns.find((b) => (b.textContent || "").trim() === "Link an existing schedule");
      return {
        pSize: parseFloat(getComputedStyle(p).fontSize), gSize: parseFloat(getComputedStyle(g).fontSize),
        order: p.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING ? "after" : "before",
      };
    });
    expect(sizes.gSize).toBeLessThan(sizes.pSize);
    expect(sizes.order).toBe("after");
    // No "looks like a match" eyebrow, no emoji anywhere on the surface.
    await expect(emptyState(page)).not.toContainText(/looks like a match/i);
    const text = await emptyState(page).innerText();
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}]/u);
  });

  test("keyboard order is Create → Link an existing schedule → picker → Link", async ({ page }) => {
    await openUnlinkedSchedule(page);
    await postSeq(page, navState([{ id: 1, name: "Goose Creek" }], null));
    await page.waitForTimeout(800);
    const order = await page.evaluate(() => {
      const root = document.querySelector('[role="region"][aria-label^="No schedule for"]');
      return [...root.querySelectorAll("button, select")].map((el) => (el.textContent || el.tagName).trim());
    });
    expect(order[0]).toBe("Create schedule");
    expect(order[1]).toBe("Link an existing schedule");
    await emptyState(page).getByRole("button", { name: "Link an existing schedule", exact: true }).click();
    const after = await page.evaluate(() => {
      const root = document.querySelector('[role="region"][aria-label^="No schedule for"]');
      return [...root.querySelectorAll("button, select")].map((el) => el.tagName === "SELECT" ? "SELECT" : (el.textContent || "").trim());
    });
    expect(after).toEqual(["Create schedule", "SELECT", "Link"]);
  });
});

test.describe("NEW-2 — copy + layout hold in both themes and widths", () => {
  for (const theme of ["light", "dark"]) {
    for (const [size, viewport] of [["desktop", { width: 1280, height: 820 }], ["narrow", { width: 420, height: 780 }]]) {
      test(`${theme} / ${size}: no clipped or overflowing text`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await openUnlinkedSchedule(page, { theme });
        const col = emptyState(page).locator("> div");
        const overflow = await col.evaluate((el) => ({
          x: el.scrollWidth - el.clientWidth,
          y: el.scrollHeight - el.clientHeight,
          inViewport: el.getBoundingClientRect().left >= -1 && el.getBoundingClientRect().right <= window.innerWidth + 1,
        }));
        expect(overflow.x).toBeLessThanOrEqual(1);
        expect(overflow.y).toBeLessThanOrEqual(1);
        expect(overflow.inViewport).toBe(true);
        // The rewritten copy, verbatim — note the trailing "yet" is gone.
        await expect(emptyState(page)).toContainText(`No schedule for “${LONG_NAME}”`);
        await expect(emptyState(page)).not.toContainText("yet");
        await expect(emptyState(page)).toContainText("A linked schedule follows this project across tabs.");
        await expect(emptyState(page).getByRole("button", { name: "Create schedule", exact: true })).toBeVisible();
        // The old copy is gone.
        await expect(emptyState(page)).not.toContainText("Link one and it stays with this project across tabs.");
        await page.screenshot({ path: `test-results/schedule-empty-${theme}-${size}.png`, fullPage: false });
      });
    }
  }

  for (const theme of ["light", "dark"]) {
    test(`${theme}: the three content states render (plain, suggested match, picker revealed)`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 820 });
      await openUnlinkedSchedule(page, { theme, name: "Sylvestri Tract" });
      await page.screenshot({ path: `test-results/schedule-empty-${theme}-plain.png` });
      await postSeq(page, navState([{ id: 7, name: "Sylvestri Tract" }, { id: 8, name: "Grand Port" }], null));
      await page.waitForTimeout(800);
      await expect(emptyState(page).getByRole("button", { name: 'Link “Sylvestri Tract”' })).toBeVisible();
      await page.screenshot({ path: `test-results/schedule-empty-${theme}-suggested.png` });
      await emptyState(page).getByRole("button", { name: "Link an existing schedule", exact: true }).click();
      await expect(emptyState(page).getByRole("combobox", { name: /choose a schedule/i })).toBeVisible();
      await page.screenshot({ path: `test-results/schedule-empty-${theme}-picker.png` });
    });
  }
});
