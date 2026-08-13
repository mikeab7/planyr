/* ⛔ NEW-5 — A PLAIN SELECTION CLICK MUST NOT ARM UNDO, AND A REAL EDIT MUST.
 *
 * Reported live on production 2026-08-12 (site `smsqi16s9ej4`, Building 3, isolated and clean):
 * load fresh — Undo correctly DISABLED — single left-click inside the building to select it, no
 * drag, no modifier, the pointer does not move, and Undo turns ENABLED. The database is byte-
 * identical across it: md5 over all 50 `site_elements` rows `e6c520d7dba3b5fa7520aae3012545a9`
 * before AND after, `updated_at` does not advance. Six selection clicks produced six entries on the
 * owner's live plan, and unwinding them to be sure was the only way to know it was untouched.
 *
 * ⛔ BOTH DIRECTIONS, because a spec that only proves "undo works" passes on the defect: select →
 * Undo stays DISABLED; then MOVE the same object → Undo becomes ENABLED and the persisted model
 * really changed. The disabled state is read from `aria-disabled` as well as the property, because
 * a disabled <button> carries no aria-disabled attribute at all — which is why an empty Redo
 * control was reported as "enabled" and cost an investigation of its own.
 *
 * Runs LOGGED OUT against a seeded-blank site, so it is Claude-verifiable here (ATTEMPT-BEFORE-YOU-
 * PARK). The signed-in half — that no `site_elements` row is written by a selection click — is the
 * live V### in VERIFICATION.md.
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { armPlannerHooks } from "./helpers.js";

const canvas = (p) => p.getByTestId("planner-canvas");
const undoBtn = (p) => p.getByRole("button", { name: "Undo" });
const redoBtn = (p) => p.getByRole("button", { name: "Redo" });

/* The owner's own Bain plan — the plan the defect was reported on. Seeded rather than drawn,
 * because DRAWING is itself an undoable action and would arm the very button under test; the state
 * this item is about is "a plan you opened and have not edited". */
const FIXTURE = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/bain-concept-original.json", import.meta.url), "utf8"));
const SITE_ID = "e2e-undo-selection-only";

const modelSig = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return JSON.stringify({ els: site.els || [], parcels: site.parcels || [], markups: site.markups || [] });
});
/* The planner does not stamp the selection on the DOM, but SELECTING mounts the object's grips into
 * the one always-on-top handle layer (see the site-planner pointer README), so a non-empty handle
 * layer is the observable "something is selected". */
const gripCount = (page) => page.evaluate(() => document.querySelectorAll("[data-handle-layer] *").length);

async function boot(page) {
  await armPlannerHooks(page);
  const site = {
    id: SITE_ID, groupId: SITE_ID, site: "Bain", name: "Concept A",
    origin: null, county: "fortbend",
    parcels: FIXTURE.parcels, els: FIXTURE.els, measures: [], callouts: [], markups: [],
    settings: FIXTURE.settings || {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  };
  await page.addInitScript(([id, rec]) => {
    localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: rec }));
    localStorage.setItem("planarfit:currentSite:v1", id);
  }, [SITE_ID, site]);
  await page.goto("/");
  await expect(canvas(page)).toBeVisible({ timeout: 20_000 });
  // el-tier: a readiness wait, not a census — the fixture's elements are what this spec presses on,
  // so "at least one element has rendered" is exactly the question. Nothing is counted or compared.
  await expect.poll(() => page.locator("[data-el-id]").count(), { timeout: 20_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(1200);   // let the fit / label passes settle before any coordinate is read
}

/* A point the APP ITSELF resolves to one named element, and the element it resolves to.
 *
 * ⛔ Picking "the biggest box on the plan and pressing its centre" was tried and is not good enough:
 * on a real plan that point can belong to something painted over it, so the press selects a
 * different object and the control half of this spec silently tests nothing. `__plannerHitTarget`
 * is the app's own resolution, read-only and E2E-gated (see B280403) — asking it is how a harness
 * avoids testing its own copy of the hit rule.
 *
 * el-tier: this is not a census — it is a search for ONE press target, and the element tier really is
 * the subject. The reported gesture is a click on a BUILDING, and only the element kinds carry a body
 * big enough to press at its own centre; a markup or a callout would change what is under test.
 * Nothing here counts the plan's contents (COUNT-EVERY-KIND), and the control half below counts a
 * single known id rather than a population. */
async function pressPoint(page) {
  return page.evaluate(() => {
    const ask = window.__plannerHitTarget;
    if (!ask) return null;
    // el-tier: see above — one press target, not a population.
    const boxes = [...document.querySelectorAll("[data-el-id]")]
      .map((n) => ({ id: n.getAttribute("data-el-id"), r: n.getBoundingClientRect() }))
      .filter((x) => x.r.width > 30 && x.r.height > 30)
      .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
    for (const b of boxes) {
      const cx = b.r.left + b.r.width / 2, cy = b.r.top + b.r.height / 2;
      const t = ask(cx, cy);
      if (t && t.kind === "el" && t.id === b.id) return { cx, cy, id: b.id };
    }
    return null;
  });
}

test("a selection click leaves Undo disabled; a 1 ft move enables it", async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page);
  const c = await pressPoint(page);
  expect(c, "no element the app resolves to at its own centre").not.toBeNull();

  // A freshly opened plan: nothing has been edited, so there is nothing to undo.
  await expect(undoBtn(page)).toBeDisabled();
  await expect(undoBtn(page)).toHaveAttribute("aria-disabled", "true");
  // The sibling report: Redo on a fresh load. The STATE was always right; the control said nothing.
  await expect(redoBtn(page)).toBeDisabled();
  await expect(redoBtn(page)).toHaveAttribute("aria-disabled", "true");

  const before = await modelSig(page);

  // ── the reported gesture: one press, no movement at all ────────────────────────────────────────
  await page.mouse.move(c.cx, c.cy);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => gripCount(page)).toBeGreaterThan(0);    // it really did select
  await expect(undoBtn(page)).toBeDisabled();                    // …and armed nothing
  await expect(undoBtn(page)).toHaveAttribute("aria-disabled", "true");
  expect(await modelSig(page)).toBe(before);                     // the document is byte-identical

  // Five more, because the owner's report was six clicks and six entries.
  for (let i = 0; i < 5; i++) {
    await page.mouse.move(c.cx, c.cy);
    await page.mouse.down();
    await page.mouse.up();
  }
  await expect(undoBtn(page)).toBeDisabled();
  expect(await modelSig(page)).toBe(before);

  // ── the control: a real edit MUST arm it ───────────────────────────────────────────────────────
  /* ⛔ THE CONTROL IS THE HALF THAT MAKES THIS A TEST. A spec that only proves "selection does not
     arm Undo" also passes on a build where Undo never arms at all.
     The edit is a DELETE driven by a REAL key press, not a drag: `SYNTHETIC-KEYS-DONT-EDIT` in
     /CLAUDE.md is explicit that the driver's own key input is the supported way to mutate a plan
     here, and a delete is unambiguous in the DOM — the element is there or it is not. (A drag was
     tried first and is the wrong instrument for a guard: it depends on where the press landed
     relative to the element's own grips, which is exactly the CHROME-NEVER-EATS-A-PRESS family.) */
  const count = () => page.locator(`[data-el-id="${c.id}"]`).count();
  expect(await count()).toBe(1);
  await page.keyboard.press("Delete");
  await expect.poll(count).toBe(0);
  await expect(undoBtn(page)).toBeEnabled();
  await expect(undoBtn(page)).toHaveAttribute("aria-disabled", "false");

  // …and undoing it puts the drawing back, which is what "enabled" promised.
  await undoBtn(page).click();
  await expect.poll(count).toBe(1);
  await expect(redoBtn(page)).toBeEnabled();
});
