/* NEW-1 (2026-11-04) — the plan menu (the plan crumb's dropdown) redrawn to the owner-approved mockup, driven through the REAL app.
 *
 * Logged out, no external GIS (so it runs in the sandbox). What a signed-out run cannot do is reach the cloud "Recently deleted" bin, so the
 * bin view is fed by the call-time E2E seam (`window.__planyrE2eBin`, same `__PLANYR_E2E` gate as every other hook; production never sets
 * it) and Restore / Delete forever run the REAL handlers — which, signed out, must refuse LOUDLY. The success round trip (restore a plan,
 * delete one forever, the list and the count updating) is the live signed-in check: ui-audit/verify-plan-menu-live.mjs.
 *
 * Run: PW_CHROME=/opt/pw-browsers/chromium npx playwright test e2e/plan-menu-redesign.spec.js --project=chromium
 */
import { test, expect } from "@playwright/test";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const LONG = "Phase II & III - Two (2) 1.2M";
const VERY_LONG = "An extraordinarily long plan name that has to wrap onto a second line rather than being cut off with an ellipsis anywhere";

function planNames(n) {
  const base = ["Concept A", LONG, "Concept C", "Concept C", "Print version", VERY_LONG, "Alt layout 1", "Alt layout 2", "Alt layout 3", "Truck court test", "Phase I", "Final"];
  return base.slice(0, n);
}

/* Seed `n` plans in ONE site (group g1). The first is current. Extra init script knobs: `bin` (the seeded Recently-deleted bin). */
async function seed(page, n, { bin } = {}) {
  await armPlannerHooks(page);
  await page.addInitScript(({ names, bin }) => {
    const mk = (id, name) => ({ id, groupId: "g1", site: "Menu Test Site", name, origin: null, county: "harris",
      parcels: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [],
      updatedAt: 1785500000000, els: [{ id: "b" + id, type: "building", cx: 0, cy: 0, w: 900, h: 300, rot: 0, dock: "cross", dockSide: "bottom", dockAxis: "x" }] });
    const map = {};
    names.forEach((nm, i) => { const id = i === 0 ? "g1" : "p" + (i + 1); map[id] = mk(id, nm); });
    localStorage.setItem("planarfit:sites:v1", JSON.stringify(map));
    localStorage.setItem("planarfit:currentSite:v1", "g1");
    if (bin) window.__planyrE2eBin = bin;
  }, { names: planNames(n), bin: bin || null });
  await page.goto("/#/project/g1/site", { waitUntil: "domcontentloaded" });   // the app opens on the Dashboard — deep-link into the plan
  await expect(canvas(page)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(600);
}

const open = async (page) => {
  if (!(await page.getByTestId("plan-footer").isVisible().catch(() => false))) await page.getByTestId("plan-crumb").click();
  await expect(page.getByTestId("plan-footer")).toBeVisible();
};
const stored = (page) => page.evaluate(() => {
  const map = JSON.parse((globalThis.__planyrSitesRaw || ((k) => localStorage.getItem(k)))("planarfit:sites:v1") || "{}");
  return Object.values(map).map((s) => ({ id: s.id, name: s.name }));
});
const listNames = (page) => page.getByTestId("plan-list-scroll").locator('[data-testid^="plan-open-"]').allInnerTexts().then((a) => a.map((t) => t.trim()));
const ctxItems = (page, id = "plan-ctx") => page.locator(`[data-testid^="${id}-"]`).allInnerTexts();

test.describe("the plan menu — layout", () => {
  test("12 plans: the current plan is ONE highlighted row on top, the others are the list, a ⋯ on every row, NO ✕, Find is there", async ({ page }) => {
    await seed(page, 12);
    await open(page);
    await expect(page.getByTestId("plan-current-row")).toContainText("Concept A");
    await expect(page.getByTestId("plan-current-row")).toContainText("current");
    const names = await listNames(page);
    expect(names.length).toBe(11);
    expect(names).not.toContain("Concept A");
    // a ⋯ on the current row and on every row in the list — visible without hovering
    await expect(page.locator('[data-testid^="plan-more-"]')).toHaveCount(12);
    for (const m of await page.locator('[data-testid^="plan-more-"]').all()) await expect(m).toBeVisible();
    // no ✕ delete button on any plan row, no old controls, no section headings
    await expect(page.getByRole("button", { name: /^Delete plan /i })).toHaveCount(0);
    await expect(page.getByTestId("plan-name-input")).toHaveCount(0);
    await expect(page.getByTestId("save-now")).toHaveCount(0);
    await expect(page.getByTestId("storage-menu-item")).toHaveCount(0);
    for (const t of ["Plan name", "Plans in this site", "This device", "Save now", "Storage on this device…"]) {
      await expect(page.getByText(t, { exact: true })).toHaveCount(0);
    }
    await expect(page.getByTestId("plan-find")).toBeVisible();
    // the current plan's name is on screen exactly twice: the crumb and the current row
    const n = await page.evaluate(() => {
      const crumb = document.querySelector('[data-testid="plan-crumb"]'), cur = document.querySelector('[data-testid="plan-current-row"]');
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let c = 0, row = 0, extra = 0, node;
      while ((node = walker.nextNode())) {
        if (node.nodeValue.trim() !== "Concept A") continue;
        if (crumb.contains(node)) c++; else if (cur.contains(node)) row++; else extra++;
      }
      return { c, row, extra };
    });
    expect(n).toEqual({ c: 1, row: 1, extra: 0 });
  });

  test("footer order: New plan | Duplicate side by side, then Version history…, and no Recently deleted row when nothing is deleted", async ({ page }) => {
    await seed(page, 3);
    await open(page);
    const [nb, db, vb] = await Promise.all(["plan-new", "plan-duplicate", "plan-version-history"].map((t) => page.getByTestId(t).boundingBox()));
    expect(Math.abs(nb.y - db.y)).toBeLessThan(2);          // side by side
    expect(db.x).toBeGreaterThan(nb.x);
    expect(vb.y).toBeGreaterThan(nb.y + nb.height - 1);     // Version history is the row under them
    await expect(page.getByTestId("plan-bin-toggle")).toHaveCount(0);
  });

  test("Find is absent below 8 plans", async ({ page }) => {
    await seed(page, 7);
    await open(page);
    await expect(page.getByTestId("plan-find")).toHaveCount(0);
  });

  test("Find filters the list, never offers browser autofill, and an empty result reads 'No plan by that name.'", async ({ page }) => {
    await seed(page, 12);
    await open(page);
    const find = page.getByTestId("plan-find");
    expect(await find.getAttribute("autocomplete")).not.toBe("on");
    await find.fill("alt layout");
    expect((await listNames(page)).sort()).toEqual(["Alt layout 1", "Alt layout 2", "Alt layout 3"]);   // the list keeps the site's own order — compared as a set here
    await find.fill("concept c");
    expect((await listNames(page)).length).toBe(2);          // two plans with the same name, both listed
    await find.fill("zzzz");
    await expect(page.getByTestId("plan-find-empty")).toHaveText("No plan by that name.");
    await find.fill("");
    expect((await listNames(page)).length).toBe(11);
  });

  test("a site with ONE plan: the current row only — no list, no Find, and a ⋯ without Delete plan", async ({ page }) => {
    await seed(page, 1);
    await open(page);
    await expect(page.getByTestId("plan-current-row")).toBeVisible();
    await expect(page.getByTestId("plan-list-scroll")).toHaveCount(0);
    await expect(page.getByTestId("plan-find")).toHaveCount(0);
    await page.locator('[data-testid^="plan-more-"]').first().click();
    expect((await ctxItems(page)).map((t) => t.trim())).toEqual(["Rename", "Duplicate"]);
  });

  test("a site with TWO plans: the ⋯ offers Delete plan", async ({ page }) => {
    await seed(page, 2);
    await open(page);
    await page.locator('[data-testid^="plan-more-"]').nth(1).click();
    expect((await ctxItems(page)).map((t) => t.trim())).toEqual(["Rename", "Duplicate", "Delete plan"]);
  });

  test("long names wrap to a second line, are never ellipsised; a real name fits on one line; two same-named plans both show", async ({ page }) => {
    await seed(page, 12);
    await open(page);
    const info = await page.evaluate(({ LONG, VERY_LONG }) => {
      const btns = [...document.querySelectorAll('[data-testid^="plan-open-"]')];
      const by = (t) => btns.find((b) => b.textContent.trim() === t);
      const long = by(LONG), vlong = by(VERY_LONG), plain = by("Concept C");
      const lh = (b) => parseFloat(getComputedStyle(b).lineHeight);
      return {
        longOneLine: long.getBoundingClientRect().height < lh(long) * 1.6 + 16,
        vlongWraps: vlong.getBoundingClientRect().height > lh(plain) * 1.6 + 8,
        noEllipsis: btns.every((b) => getComputedStyle(b).textOverflow !== "ellipsis" && b.scrollWidth <= b.clientWidth + 1),
        sameName: btns.filter((b) => b.textContent.trim() === "Concept C").length,
      };
    }, { LONG, VERY_LONG });
    expect(info.longOneLine, "the owner's real name fits on one line").toBe(true);
    expect(info.vlongWraps).toBe(true);
    expect(info.noEllipsis).toBe(true);
    expect(info.sameName).toBe(2);
  });

  test("a SHORT window: the footer stays in view and only the list scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 440 });
    await seed(page, 12);
    await open(page);
    const scroll = page.getByTestId("plan-list-scroll");
    const m = await scroll.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, oy: getComputedStyle(el).overflowY }));
    expect(m.oy).toBe("auto");
    expect(m.sh, "the list is taller than its box, so it scrolls").toBeGreaterThan(m.ch + 4);
    await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    for (const t of ["plan-new", "plan-duplicate", "plan-version-history"]) {
      const b = await page.getByTestId(t).boundingBox();
      expect(b.y + b.height, `${t} is inside the window`).toBeLessThanOrEqual(440);
      expect(b.y).toBeGreaterThanOrEqual(0);
    }
    // the current row is pinned above the scrolling list
    const cur = await page.getByTestId("plan-current-row").boundingBox();
    expect(cur.y).toBeGreaterThanOrEqual(0);
    // …and the panel itself does not scroll
    const panelScrolls = await page.evaluate(() => { const f = document.querySelector('[data-testid="plan-footer"]'); let p = f.parentElement; return p.scrollHeight > p.clientHeight + 1; });
    expect(panelScrolls).toBe(false);
  });

  test("PHONE width: the menu fits the screen, every ⋯ is visible and a real tap target", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    await seed(page, 12);
    await open(page);
    const panel = await page.evaluate(() => { const f = document.querySelector('[data-testid="plan-footer"]'); let p = f.parentElement; const r = p.getBoundingClientRect(); return { l: r.left, r: r.right }; });
    expect(panel.l).toBeGreaterThanOrEqual(0);
    expect(panel.r).toBeLessThanOrEqual(390);
    const more = page.getByTestId("plan-more-p2");
    await expect(more).toBeVisible();
    expect(await more.evaluate((el) => el.classList.contains("tap-target"))).toBe(true);
    const box = await more.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  });
});

test.describe("the plan menu — the ⋯ menu", () => {
  test("the ⋯ and a right-click open the SAME menu (current row included); every row the same height with the same gap; Delete plan is red, last, no divider", async ({ page }) => {
    await seed(page, 5);
    await open(page);
    // current row: ⋯ then right-click
    await page.getByTestId("plan-more-g1").click();
    const viaMore = await ctxItems(page);
    await page.keyboard.press("Escape");
    await open(page);
    await page.getByTestId("plan-current-row").click({ button: "right" });
    const viaRight = await ctxItems(page);
    expect(viaRight).toEqual(viaMore);
    expect(viaMore.map((t) => t.trim())).toEqual(["Rename", "Duplicate", "Delete plan"]);
    // another row: same list from both doors
    await page.keyboard.press("Escape");
    await open(page);
    await page.getByTestId("plan-more-p2").click();
    const otherMore = await ctxItems(page);
    await page.keyboard.press("Escape");
    await open(page);
    await page.getByTestId("plan-row-p2").click({ button: "right" });
    expect(await ctxItems(page)).toEqual(otherMore);

    // equal rows, equal gaps, no divider
    const geo = await page.evaluate(() => {
      const items = [...document.querySelectorAll('[data-testid^="plan-ctx-"]')].map((e) => e.getBoundingClientRect());
      const panel = document.querySelector('[data-testid="plan-ctx"]');
      const del = document.querySelector('[data-testid="plan-ctx-delete"]');
      return {
        heights: items.map((r) => Math.round(r.height * 10) / 10),
        gaps: items.slice(1).map((r, i) => Math.round((r.top - items[i].bottom) * 10) / 10),
        separators: panel.querySelectorAll('[role="separator"], hr').length,
        delColor: getComputedStyle(del).color,
        okColor: getComputedStyle(document.querySelector('[data-testid="plan-ctx-rename"]')).color,
        inViewport: items.every((r) => r.bottom <= innerHeight && r.right <= innerWidth && r.left >= 0),
      };
    });
    expect(new Set(geo.heights).size).toBe(1);
    expect(new Set(geo.gaps).size).toBe(1);
    expect(geo.separators).toBe(0);
    expect(geo.delColor).not.toBe(geo.okColor);          // red text on Delete plan only
    expect(geo.inViewport).toBe(true);
  });

  test("the ⋯ menu is not clipped by the scrolling list: from the LAST row of a scrolled list it flips/clamps inside the window", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 520 });
    await seed(page, 12);
    await open(page);
    const scroll = page.getByTestId("plan-list-scroll");
    await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(250);   // let the scroll settle, as a user's hand would — an open ⋯ menu closes on a scroll
    await page.locator('[data-testid^="plan-more-"]').last().click();   // the LAST row's ⋯, in view at the bottom of the scrolled list
    const r = await page.getByTestId("plan-ctx").boundingBox();
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.y + r.height).toBeLessThanOrEqual(520);
    await expect(page.getByTestId("plan-ctx-delete")).toBeVisible();
  });

  test("Rename on the CURRENT plan: double-click the name → text field in place; Enter commits (crumb follows); Esc cancels; empty is refused", async ({ page }) => {
    await seed(page, 3);
    await open(page);
    await page.getByTestId("plan-current-name").dblclick();
    const input = page.getByTestId("plan-rename-input");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
    expect(await input.getAttribute("autocomplete")).not.toBe("on");
    // Esc cancels the rename only — the menu stays open and the name is unchanged
    await input.fill("Typed then abandoned");
    await input.press("Escape");
    await expect(page.getByTestId("plan-rename-input")).toHaveCount(0);
    await expect(page.getByTestId("plan-footer")).toBeVisible();
    await expect(page.getByTestId("plan-crumb")).toContainText("Concept A");
    // Enter commits
    await page.getByTestId("plan-current-name").dblclick();
    await page.getByTestId("plan-rename-input").fill("Renamed in place");
    await page.getByTestId("plan-rename-input").press("Enter");
    await expect(page.getByTestId("plan-crumb")).toContainText("Renamed in place", { timeout: 15_000 });
    await expect(page.getByTestId("plan-current-row")).toContainText("Renamed in place");
    expect((await stored(page)).find((s) => s.id === "g1").name).toBe("Renamed in place");
    // blur commits too
    await page.getByTestId("plan-current-name").dblclick();
    await page.getByTestId("plan-rename-input").fill("Renamed by blur");
    await page.getByTestId("plan-footer").click({ position: { x: 4, y: 4 } });
    await expect(page.getByTestId("plan-crumb")).toContainText("Renamed by blur", { timeout: 15_000 });
    // an EMPTY name is refused with the existing notice and the old name stays
    await page.getByTestId("plan-current-name").dblclick();
    await page.getByTestId("plan-rename-input").fill("   ");
    await page.getByTestId("plan-rename-input").press("Enter");
    await expect(page.getByTestId("plan-crumb")).toContainText("Renamed by blur");
    expect((await stored(page)).find((s) => s.id === "g1").name).toBe("Renamed by blur");
    await expect(page.getByText(/name/i).filter({ hasText: /can.?t be empty|empty|enter a|needs a name|blank/i }).first()).toBeVisible({ timeout: 5000 });
  });

  test("Rename another plan from its ⋯ (in place, through the one rename) and Duplicate THAT plan (not the current one)", async ({ page }) => {
    await seed(page, 4);
    await open(page);
    await page.getByTestId("plan-more-p2").click();
    await page.getByTestId("plan-ctx-rename").click();
    const input = page.getByTestId("plan-rename-input");
    await expect(input).toBeVisible();
    await input.fill("Second plan, renamed");
    await input.press("Enter");
    await expect.poll(async () => (await stored(page)).find((s) => s.id === "p2").name, { timeout: 15_000 }).toBe("Second plan, renamed");
    await expect(page.getByTestId("plan-open-p2")).toHaveText("Second plan, renamed");
    // the current plan was not renamed
    expect((await stored(page)).find((s) => s.id === "g1").name).toBe("Concept A");

    // Duplicate p3 ("Concept C") from its ⋯ — the copy is of THAT plan
    await page.getByTestId("plan-more-p3").click();
    await page.getByTestId("plan-ctx-duplicate").click();
    await expect.poll(async () => (await stored(page)).some((s) => s.name === "Concept C (copy)"), { timeout: 20_000 }).toBe(true);
    expect((await stored(page)).some((s) => s.name === "Concept A (copy)")).toBe(false);
  });

  test("Delete plan: inline confirm in the row (its meaning stated), Cancel keeps it, Delete removes it; offered only at 2+ plans", async ({ page }) => {
    await seed(page, 4);
    await open(page);
    await page.getByTestId("plan-more-p2").click();
    await page.getByTestId("plan-ctx-delete").click();
    const confirm = page.getByTestId("plan-delete-confirm-p2");
    await expect(confirm).toContainText("Recently deleted");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("plan-open-p2")).toBeVisible();
    // again, and go through with it
    await page.getByTestId("plan-more-p2").click();
    await page.getByTestId("plan-ctx-delete").click();
    await page.getByTestId("plan-delete-go").click();
    await expect.poll(async () => (await stored(page)).some((s) => s.id === "p2"), { timeout: 15_000 }).toBe(false);
  });
});

test.describe("the plan menu — Recently deleted", () => {
  const T = (d, h, m) => new Date(2026, 9, d, h, m).getTime();   // this year (Oct 2026)
  const BIN = {
    plans: [
      { id: "d1", name: "Goose Creek - Concept A", deletedAt: T(20, 14, 37) },
      { id: "d2", name: "Goose Creek - Concept A", deletedAt: T(22, 9, 5) },
      { id: "d3", name: "Goose Creek - Concept A", deletedAt: T(18, 16, 40) },
      { id: "d4", name: "Goose Creek - Concept A", deletedAt: new Date(2025, 9, 20, 14, 37).getTime() },
    ],
    files: [
      { id: "f1", name: "Master site plan", fileName: "master.pdf", page: 1, deletedAt: T(21, 11, 0) },
      { id: "f2", name: "Old survey", fileName: "survey.pdf" },
    ],
  };

  test("a 'Recently deleted (6)' row with › opens a bin view with '‹ Plans'; newest first; exact times; 'site plan' tag; a file with no time has no line", async ({ page }) => {
    await seed(page, 3, { bin: BIN });
    await open(page);
    const toggle = page.getByTestId("plan-bin-toggle");
    await expect(toggle).toContainText("Recently deleted (6)");
    await toggle.click();
    // the list and the footer are replaced
    await expect(page.getByTestId("plan-footer")).toHaveCount(0);
    await expect(page.getByTestId("plan-current-row")).toHaveCount(0);
    await expect(page.getByTestId("plan-bin-back")).toContainText("Plans");
    // newest first: d2 (Oct 22), f1 (Oct 21), d1 (Oct 20), d3 (Oct 18), then the 2025 one, then the file with no time
    const order = await page.locator('[data-testid="plan-bin-scroll"] [data-deleted-id]').evaluateAll((n) => n.map((e) => e.getAttribute("data-deleted-id")));
    expect(order).toEqual(["d2", "f1", "d1", "d3", "d4", "f2"]);
    const lines = await page.locator('[data-testid="deleted-at"]').allInnerTexts();
    expect(lines.length).toBe(5);                                       // f2 has no date line
    expect(new Set(lines).size).toBe(5);                                // four identically-named plans are told apart
    expect(lines[0]).toMatch(/^Deleted Oct 22, 9:05 AM$/);
    expect(lines[2]).toMatch(/^Deleted Oct 20, 2:37 PM$/);
    expect(lines[4]).toMatch(/^Deleted Oct 20, 2025, 2:37 PM$/);        // a year only when it isn't this year
    // no old "2w ago" text
    await expect(page.getByText(/\d+[mhdw] ago/)).toHaveCount(0);
    // files keep their tag and the same row shape
    const file = page.getByTestId("deleted-site-plan-file").first();
    await expect(file).toContainText("site plan");
    await expect(file.getByRole("button", { name: /Restore/ })).toBeVisible();
    // back returns to the list and footer
    await page.getByTestId("plan-bin-back").click();
    await expect(page.getByTestId("plan-footer")).toBeVisible();
    await expect(page.getByTestId("plan-current-row")).toBeVisible();
  });

  test("names wrap in the bin; Restore fails LOUDLY (signed out); Delete forever is in the ⋯ only, with the inline 'No restore after this.' confirm", async ({ page }) => {
    await seed(page, 3, { bin: { plans: [{ id: "d1", name: "A very long deleted plan name that needs more than one line to be shown in full without any cut", deletedAt: T(20, 14, 37) }], files: [] } });
    await open(page);
    await page.getByTestId("plan-bin-toggle").click();
    const row = page.getByTestId("deleted-plan").first();
    const wraps = await row.evaluate((el) => { const n = el.querySelector("div div"); return { h: n.getBoundingClientRect().height, ell: getComputedStyle(n).textOverflow }; });
    expect(wraps.ell).not.toBe("ellipsis");
    expect(wraps.h).toBeGreaterThan(24);
    // permanent delete does NOT sit next to Restore
    await expect(row.getByRole("button", { name: /forever/i })).toHaveCount(0);
    // Restore: the real handler refuses (not signed in) and SAYS so
    await row.getByRole("button", { name: /Restore plan/ }).click();
    await expect(page.getByText(/couldn.t be restored/)).toBeVisible({ timeout: 10_000 });
    // ⋯ → Delete forever (red)
    await page.getByTestId("deleted-more-d1").click();
    const items = await ctxItems(page, "deleted-ctx");
    expect(items.map((t) => t.trim())).toEqual(["Delete forever"]);
    const red = await page.getByTestId("deleted-ctx-purge").evaluate((el) => getComputedStyle(el).color);
    const ink = await page.getByTestId("plan-bin-back").evaluate((el) => getComputedStyle(el).color);
    expect(red).not.toBe(ink);
    await page.getByTestId("deleted-ctx-purge").click();
    const confirm = page.getByTestId("deleted-purge-confirm-d1");
    await expect(confirm).toContainText("Permanently delete");
    await expect(confirm).toContainText("No restore after this.");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("deleted-plan")).toBeVisible();
    // go through with it: the real purge refuses (signed out) and says so out loud
    await page.getByTestId("deleted-more-d1").click();
    await page.getByTestId("deleted-ctx-purge").click();
    await page.getByTestId("deleted-purge-go").click();
    await expect(page.getByText(/couldn.t be permanently deleted/)).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("plan-bin-back").click();
    await expect(page.getByTestId("plan-footer")).toBeVisible();
  });
});
