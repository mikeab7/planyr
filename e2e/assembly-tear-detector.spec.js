/* NEW-1 / NEW-2 — the bonded-assembly invariant, measured WITHOUT a reload, plus the detector.
 *
 * THE POINT OF THIS SPEC, and the reason it is separate from `assembly-move-integrity.spec.js`:
 * a reload HEALS this bug. The load-time repair has existed since B1097, so every previous
 * verification that reloaded before it measured saw a clean plan and reported "fixed" while the
 * race was fully intact — which is a named cause of eight recurrences ("looks like it just fixed
 * itself somehow again, but it shouldn't happen in the first place").
 *
 * So this spec measures in the SAME SESSION, immediately after the move-and-undo, with nothing
 * reloaded and nothing re-read from disk — and only THEN reloads, to prove the heal separately.
 * The two assertions are deliberately in that order and must stay that way.
 *
 * Test 2 goes the other way: it plants the owner's exact tear (site sms7v3ua7ksy, building
 * e7373vqgilf — every bonded child translated ~267 ft east / ~4 ft north with the host left
 * behind) into the stored plan, opens it, and asserts BOTH halves of the addendum: the geometry
 * self-heals AND the repair is LOUD — a telemetry event naming the ids and the delta, so a silent
 * repair can never again be mistaken for the absence of a bug.
 *
 * Logged out, no external GIS: Claude-doable here, per ATTEMPT-BEFORE-YOU-PARK. The signed-in half
 * (the real cloud round trip on the owner's own site) is the live-verify entry in VERIFICATION.md.
 */
import { test, expect } from "@playwright/test";
import { openModule } from "./helpers.js";
import { assemblyIntegrity } from "../src/workspaces/site-planner/lib/assemblyIntegrity.js";

const SITE_KEY = "planarfit:sites:v1";

// The persisted plan, straight off the device — on-disk truth, not pixels.
function readPlan(page) {
  return page.evaluate((key) => {
    const map = JSON.parse(localStorage.getItem(key) || "{}");
    const id = Object.keys(map)[0];
    return { id, els: (map[id] || {}).els || [] };
  }, SITE_KEY);
}
// Telemetry the app captured this page-load (window.pfTelemetry is the shipped diagnostic handle).
const telemetry = (page) => page.evaluate(() => {
  try { return (window.pfTelemetry && window.pfTelemetry.recent() || []).map((r) => `${r.source} ${r.message}`); } catch { return []; }
});

async function drawAssembly(page, { parking = 1 } = {}) {
  await page.goto("/");
  await openModule(page, "site-planner");
  await page.getByTestId("map-start-blank-menu-btn").first().click();
  await page.getByTestId("map-start-blank-menu-item").first().click();
  const svg = page.getByTestId("planner-canvas");
  await expect(svg).toBeVisible({ timeout: 45000 });
  await page.getByRole("button", { name: /^Building$/ }).first().click();
  const box = await svg.boundingBox();
  const x0 = box.x + box.width * 0.3, y0 = box.y + box.height * 0.38;
  const x1 = box.x + box.width * 0.62, y1 = box.y + box.height * 0.56;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
  await page.mouse.move(x1, y1, { steps: 6 });
  await page.mouse.up();
  // Give it the children that stayed behind in the owner's plan.
  await page.getByRole("button", { name: /^Properties$/ }).click();
  const plus = (label) => page.getByText(label, { exact: true }).first().locator("xpath=..").getByRole("button").last();
  for (const [label, times] of [["Dock zones", 2], ["Car parking", parking], ["Bump-outs", 1]]) {
    for (let i = 0; i < times; i++) { await plus(label).click(); await page.waitForTimeout(300); }
  }
  await page.waitForTimeout(900);
  return { svg, mid: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } };
}

test.describe("bonded assembly: measured before any reload, and healed loudly after one", () => {
  // The planner is a lazy chunk and each case builds a real assembly, moves it, and reloads twice;
  // under the sandbox's TLS-inspecting proxy the first paint alone can take most of the default budget.
  test.setTimeout(120_000);

  test("move then Ctrl+Z leaves every child where its host implies — asserted IN THE SAME SESSION", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    const { mid } = await drawAssembly(page);
    const before = await readPlan(page);
    const host = before.els.find((e) => e.type === "building" && !e.attachedTo);
    expect(host, "the drawn building should be on disk").toBeTruthy();
    const kids = before.els.filter((e) => e.attachedTo === host.id);
    expect(kids.length, "the building should carry a real bonded assembly").toBeGreaterThanOrEqual(4);
    // The starting plan is coherent, so the assertions below measure the MOVE, not the fixture.
    expect(assemblyIntegrity(before.els).tears).toHaveLength(0);

    // Move the building.
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(mid.x - 60, mid.y - 70, { steps: 8 });
    await page.mouse.move(mid.x - 130, mid.y - 150, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(700);
    const moved = await readPlan(page);
    expect(Math.hypot(
      moved.els.find((e) => e.id === host.id).cx - host.cx,
      moved.els.find((e) => e.id === host.id).cy - host.cy,
    ), "the drag should actually have moved the building").toBeGreaterThan(20);
    expect(assemblyIntegrity(moved.els).tears, "the move itself tore the assembly").toHaveLength(0);

    // Ctrl+Z, then measure IMMEDIATELY. No reload, no navigation, nothing re-read from rows —
    // the load-time heal must not be allowed to answer this question.
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(700);
    const undone = await readPlan(page);
    const res = assemblyIntegrity(undone.els);
    expect(res.tears, `after undo, before any reload: ${JSON.stringify(res.tears)}`).toHaveLength(0);
    // Every child is back at its pre-move position, to the foot.
    for (const k of kids) {
      const now = undone.els.find((e) => e.id === k.id);
      expect(now, `bonded child ${k.id} (${k.type}) lost on undo`).toBeTruthy();
      expect(Math.hypot(now.cx - k.cx, now.cy - k.cy), `${k.type} ${k.id} did not return`).toBeLessThan(1);
    }

    // ONLY NOW reload — and prove it stays put rather than being repaired into place.
    await page.reload();
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 45000 });
    await page.waitForTimeout(900);
    const reloaded = await readPlan(page);
    expect(assemblyIntegrity(reloaded.els).tears).toHaveLength(0);
    for (const k of kids) {
      const now = reloaded.els.find((e) => e.id === k.id);
      expect(Math.hypot(now.cx - k.cx, now.cy - k.cy), `${k.id} moved across the reload`).toBeLessThan(1);
    }
    expect(errors, "no page errors during move/undo/reload").toEqual([]);
  });

  test("the owner's tear planted on disk self-heals on open, and the repair is LOUD", async ({ page }) => {
    await drawAssembly(page);
    const before = await readPlan(page);
    const host = before.els.find((e) => e.type === "building" && !e.attachedTo);
    const kidIds = before.els.filter((e) => e.attachedTo === host.id).map((e) => e.id);

    /* Plant the reported displacement — every bonded child translated, the host left behind — as an
     * INIT SCRIPT rather than a plain evaluate. This is not a stylistic choice: writing it into
     * localStorage while the planner is still mounted plants nothing, because the page's own unload
     * flush re-saves the live (coherent) canvas over it on the way out, and the next boot then reads
     * a clean record. Measured, not assumed — the first version of this test failed exactly that
     * way. An init script runs after the old page has gone and before any of the new page's scripts,
     * which is the only window where the stored bytes are ours. */
    await page.addInitScript(({ key, ids }) => {
      try {
        const map = JSON.parse(localStorage.getItem(key) || "{}");
        const id = Object.keys(map)[0];
        if (!map[id] || !Array.isArray(map[id].els)) return;
        map[id].els = map[id].els.map((e) => (ids.includes(e.id) ? { ...e, cx: e.cx + 267.03, cy: e.cy - 4 } : e));
        localStorage.setItem(key, JSON.stringify(map));
        window.__plantedTear = true;
      } catch (_) { /* the assertions below fail loudly if this didn't take */ }
    }, { key: SITE_KEY, ids: kidIds });

    await page.reload();
    await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 45000 });
    // The heal lands on the canvas at once; getting it back onto DISK rides the ordinary autosave,
    // so give that its debounce before reading the stored record.
    await page.waitForTimeout(4000);

    expect(await page.evaluate(() => !!window.__plantedTear), "the tear was never planted").toBe(true);
    /* (a) it self-heals — the owner's plan repairs itself when he opens it, and the repair reaches
     * DISK, not just the screen. Reading the stored record (rather than the canvas) is the point:
     * a heal that lives only in memory is what let a torn plan look right here and stay torn for
     * the next reader.
     *
     * The assertion is the INVARIANT, not "every child is back to the pixel", and that is
     * deliberate: one translation is ACROSS the wall for the children on the east and west faces
     * and ALONG it for the ones on the north and south, and an along-wall slide inside the overlap
     * bound is a legal placement the owner is allowed to make by hand (B1039). So what must be true
     * afterwards is that nothing sits off its host's implied anchor — plus, separately, that the
     * fully-derived members (the wall strips and bump-outs, which have no along-wall freedom at
     * all) are back exactly where they were. */
    const healed = await readPlan(page);
    expect(assemblyIntegrity(healed.els).tears, "the stored plan is still torn after opening it").toHaveLength(0);
    const returned = kidIds.filter((id) => {
      const was = before.els.find((e) => e.id === id);
      const now = healed.els.find((e) => e.id === id);
      return was && now && Math.hypot(now.cx - was.cx, now.cy - was.cy) < 1;
    });
    expect(returned.length, `only ${returned.length}/${kidIds.length} bonded children were re-derived to their exact prior position`)
      .toBeGreaterThanOrEqual(Math.ceil(kidIds.length / 2));
    // (b) …and it SAYS SO. A silent repair is exactly how this shipped as fixed eight times.
    const events = await telemetry(page);
    const tearEvents = events.filter((m) => m.includes("assembly-tear"));
    expect(tearEvents.length, `no assembly-tear telemetry; captured: ${JSON.stringify(events)}`).toBeGreaterThan(0);
    const joined = tearEvents.join(" ");
    expect(joined, "the report must carry the delta it corrected").toMatch(/"dist":\s*-?\d/);
    expect(joined, "the report must name the host").toContain(host.id);
    // …and name the children it repaired (not necessarily all of them — an along-wall slide inside
    // the overlap bound is legal and is deliberately not reported as a tear).
    expect(kidIds.some((id) => joined.includes(id)), `no repaired child id in: ${joined}`).toBe(true);
    // The repair reaching DISK is itself an event, so "it healed but nobody saved it" is visible.
    expect(events.join(" ")).toContain("assembly-tear-persisted");
  });

  /* NEW-2 — THE REPRODUCTION THE OWNER ASKED TO BE ADDED, after "Concept D — Sylvestri Retail"
   * reproduced this AFTER B1340 merged and after a hard reload. B1340 made a child's POSITION
   * derived; it did not make its SIZE derived, so a side-parking field's along-wall run survived a
   * host resize as an invisible sticky value — 205 ft of parking beside a 260 ft sidewalk on the
   * same wall, and 80 ft against 259 on the building next to it, both with perfect perpendicular
   * offsets. Resize a building's DEPTH and assert every bonded child's RUN follows, measured
   * immediately, in-session, before any reload. */
  test("resizing a building's depth drags every bonded child's SPAN with it — measured in-session", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    // Three parking rows, so one of them hugs an END wall — the wall whose length IS the depth,
    // and therefore the only one this resize changes. With parking on the long walls only, the
    // case measures nothing (verified: it passed with the old rule restored).
    await drawAssembly(page, { parking: 3 });
    const before = await readPlan(page);
    const host = before.els.find((e) => e.type === "building" && !e.attachedTo);
    const kids = before.els.filter((e) => e.attachedTo === host.id);
    expect(kids.length).toBeGreaterThanOrEqual(4);
    expect(assemblyIntegrity(before.els).tears).toHaveLength(0);

    /* Resize the DEPTH on the real canvas, by grabbing the real grip: the building is wider than it
     * is deep, so its depth axis is the one the NS handles drive. The grip is found in the shipped
     * always-on-top handle layer by its own cursor, not by guessing at screen coordinates — an
     * earlier version of this case guessed, missed the grip, and skipped itself, which proves
     * nothing. */
    const svg = page.getByTestId("planner-canvas");
    const box = await svg.boundingBox();
    // NOTE: do NOT click the canvas to "select" first — the building is already the selected element
    // (the Properties + buttons above act on it), and a click at a guessed coordinate DESELECTS it,
    // which empties the handle layer. Measured: the grip search returned zero rects that way.
    const grip = await page.evaluate(() => {
      // BOTH planner hosts stay mounted (the map view is hidden with display:none), so there can be
      // two handle layers in the document and only one of them has a selection — search all of them
      // and take the first grip that is actually laid out.
      const seen = [];
      for (const layer of document.querySelectorAll('[data-handle-layer="1"]')) {
        for (const n of layer.querySelectorAll("rect")) {
          const cur = (n.getAttribute("style") || "");
          seen.push(cur);
          if (!cur.includes("ns-resize")) continue;
          const r = n.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
      return { none: true, seen: seen.slice(0, 20) };
    });
    expect(grip && !grip.none, `no depth (ns-resize) grip on the selected building; cursors seen: ${JSON.stringify(grip && grip.seen)}`).toBe(true);
    const dragDepth = async (g, dy) => {
      await page.mouse.move(g.x, g.y);
      await page.mouse.down();
      await page.mouse.move(g.x, g.y + dy / 2, { steps: 8 });
      await page.mouse.move(g.x, g.y + dy, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(900);
    };
    /* TWO drags, and the second one is the one that matters. Shrinking a wall was ALREADY handled
     * before this work — an over-length run gets clamped, so the plan looks right. The failure is a
     * wall that GROWS under a field that stays short: that is the state the owner was looking at
     * (205 ft of parking on a 260 ft wall), and it is the only direction that distinguishes the
     * derived rule from the old "preserve once touched" one. Proven: with the old rule restored,
     * the shrink-only version of this case still passed and the grow-back version goes red. */
    await dragDepth(grip, -70);                       // in…
    const grip2 = await page.evaluate(() => {
      for (const layer of document.querySelectorAll('[data-handle-layer="1"]')) {
        for (const n of layer.querySelectorAll("rect")) {
          if (!(n.getAttribute("style") || "").includes("ns-resize")) continue;
          const r = n.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
      return null;
    });
    expect(grip2, "the depth grip vanished after the first resize").toBeTruthy();
    await dragDepth(grip2, 130);                      // …and back out, past where it started

    const after = await readPlan(page);
    const hostAfter = after.els.find((e) => e.id === host.id);
    // Guard the guard: a case that quietly measured nothing would be worse than no case at all.
    const changed = Math.abs(hostAfter.w - host.w) + Math.abs(hostAfter.h - host.h);
    expect(changed, "the grip drag did not resize the building — nothing was measured").toBeGreaterThan(5);

    // THE ASSERTION, in the same session with nothing reloaded: no bonded child is the wrong
    // length or in the wrong place for the host it now has.
    const res = assemblyIntegrity(after.els);
    expect(res.tears, `after a depth resize, before any reload: ${JSON.stringify(res.tears)}`).toHaveLength(0);
    // …and the wall strips and the parking beside them agree about how long their shared wall is.
    const runOf = (e) => Math.max(e.w, e.h);
    for (const k of after.els.filter((e) => e.attachedTo === host.id && e.sideParkSide)) {
      const strip = after.els.find((e) => e.attachedTo === host.id && e.sidewalkSide === k.sideParkSide);
      if (!strip) continue;
      expect(Math.abs(runOf(k) - runOf(strip)), `${k.id} spans a different wall from its own sidewalk`).toBeLessThan(1);
    }
    // GUARD THE GUARD: at least one parking row must actually have changed length, or this case
    // is measuring a resize that never touched a wall any parking row hugs.
    const runOfId = (els, id) => { const e = els.find((x) => x.id === id); return e ? Math.max(e.w, e.h) : null; };
    const parkIds = before.els.filter((e) => e.attachedTo === host.id && e.sideParkSide).map((e) => e.id);
    expect(parkIds.length, "no side-parking rows to measure").toBeGreaterThan(0);
    expect(parkIds.some((id) => Math.abs(runOfId(after.els, id) - runOfId(before.els, id)) > 1),
      "no parking row changed length — the resize did not touch a wall any of them hugs").toBe(true);
    expect(errors, "no page errors during the resize").toEqual([]);
  });
});
