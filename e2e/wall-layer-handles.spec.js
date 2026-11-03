/* NEW-1 (2026-11-03, owner: "we're not going to ever shorten it from there. It should be shortened by the handles") — THE GATE
 * for removing Length / Align / Full length from the Docks & walls edit box: EVERY layer kind on EVERY wall role can be shortened by
 * dragging the handle at its end along the wall, the dragged end moves and the other end STAYS. This is the permanent replacement for
 * the typed-length cases of wall-extent-rear-end / trailer-row-repeat (those typed a number; the number gave no say over which side moved).
 *
 * Driven for real: add the layer through the new control, select it on the map, press the edge grip at its end along the wall
 * (`rect[data-handle="edge"]`), drag inward, release. Measured on the saved model in the HOST's frame (rotation-proof). Logged out.
 * Run: BASE_URL=http://127.0.0.1:4173 npx playwright test e2e/wall-layer-handles.spec.js --project=chromium --no-deps */
import { test, expect } from "@playwright/test";
import { armPlannerHooks, addWallLayer, alongOf as along, dragWallLayerEnd as dragEnd } from "./helpers.js";
import { canvas, startBlank } from "./drawKinds.js";

const plan = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return site.els || [];
});
const hostOf = async (page) => (await plan(page)).find((e) => e.type === "building" && !e.dogEar);
async function drawBldg(page, x1, y1, x2, y2) {
  await page.getByRole("button", { name: "Building", exact: true }).click();
  const box = await canvas(page).boundingBox();
  await page.mouse.move(box.x + x1, box.y + y1); await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 12 }); await page.mouse.up();
}
async function openProps(page, id) {
  const pt = await page.evaluate((elId) => { const r = document.querySelector(`[data-el-id="${elId}"]`).querySelector("rect, path").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, id);
  await page.mouse.dblclick(pt.x, pt.y);
  await expect(page.getByTestId("building-header")).toBeVisible();
}
const rotate = async (page, deg) => { const f = page.getByLabel("Rotation in degrees"); await f.fill(String(deg)); await f.press("Enter"); };
const rowByRole = (page, role) => page.locator(`[data-testid="wall-row"][data-role="${role}"]`);
async function boot(page, deg) {
  await startBlank(page);
  await drawBldg(page, 200, 260, 620, 400);
  await expect.poll(async () => !!(await hostOf(page))).toBe(true);
  const b = await hostOf(page);
  await openProps(page, b.id);
  if (deg) { await rotate(page, deg); await expect.poll(async () => Math.round((await hostOf(page)).rot)).toBe(deg); }
  return b;
}
const sideOf = (h, e) => {
  const r = (h.rot * Math.PI) / 180, dx = e.cx - h.cx, dy = e.cy - h.cy, lx = dx * Math.cos(r) + dy * Math.sin(r), ly = -dx * Math.sin(r) + dy * Math.cos(r);
  const ox = Math.abs(lx) - h.w / 2, oy = Math.abs(ly) - h.h / 2;
  return oy >= ox ? (ly >= 0 ? "bottom" : "top") : (lx >= 0 ? "right" : "left");
};
const KIND_TEST = {
  court: (e) => !!e.truckCourt,
  trailer: (e) => e.type === "trailer",
  buffer: (e) => e.type === "landscape" && !e.sidewalkSide,
  sidewalk: (e) => e.type === "sidewalk" || (e.type === "landscape" && !!e.sidewalkSide),
  parking: (e) => e.type === "parking" && !!e.sideParkSide,
  road: (e) => e.type === "road",
};
const layerEl = async (page, hostId, side, kind, nth = 0) => {
  const h = await hostOf(page);
  return (await plan(page)).filter((e) => e.attachedTo === hostId && !e.dogEar && KIND_TEST[kind](e) && sideOf(h, e) === side)[nth];
};

test.beforeEach(async ({ page }) => { await armPlannerHooks(page); });

// role → [wall locator role, layers added outward in order]
const MATRIX = [
  { role: "dock", chain: ["court", "trailer", "buffer", "sidewalk", "road"] },
  { role: "rear", chain: ["sidewalk", "parking", "trailer", "buffer", "road"] },
  { role: "ends", chain: ["sidewalk", "parking", "trailer", "buffer", "road"] },
];

for (const deg of [0, 315]) for (const { role, chain } of MATRIX) {
  test(`rot ${deg} · ${role} wall: every layer (${chain.join(" · ")}) shortens by dragging its end handle — the dragged end moves, the other stays`, async ({ page }) => {
    test.setTimeout(150_000);
    const b = await boot(page, deg);
    const row = rowByRole(page, role).first();
    const side = await row.getAttribute("data-sides");
    for (const k of chain) await addWallLayer(row, k);
    await expect(row.getByTestId("wall-piece")).toHaveCount(chain.length);
    await page.keyboard.press("Escape");
    const rows = [];
    for (const kind of chain) for (const end of ["plus", "minus"]) {
      const host = await hostOf(page);
      const el = await layerEl(page, b.id, side, kind);
      if (!el) { rows.push(`${kind}/${end}: NO ELEMENT`); continue; }
      const before = along(host, side, el);
      const lo0 = before.centre - before.len / 2, hi0 = before.centre + before.len / 2;
      try { await dragEnd(page, host, side, el, end, Math.min(40, Math.round(before.len * 0.25))); } catch (e) { rows.push(`${kind}/${end}: NO HANDLE (${String(e.message).split("\n")[0].slice(0, 60)})`); await page.keyboard.press("Escape"); continue; }
      await page.waitForTimeout(250);
      const h2 = await hostOf(page), e2 = await layerEl(page, b.id, side, kind);
      if (!e2) { rows.push(`${kind}/${end}: ELEMENT GONE`); continue; }
      const a2 = along(h2, side, e2), lo1 = a2.centre - a2.len / 2, hi1 = a2.centre + a2.len / 2;
      const movedIn = end === "plus" ? hi0 - hi1 : lo1 - lo0, held = end === "plus" ? Math.abs(lo1 - lo0) : Math.abs(hi1 - hi0);
      const ok = movedIn > 3 && held < 2;
      rows.push(`${ok ? "ok  " : "FAIL"}  ${kind}/${end}: len ${Math.round(before.len)}→${Math.round(a2.len)}  ends [${lo0.toFixed(0)},${hi0.toFixed(0)}]→[${lo1.toFixed(0)},${hi1.toFixed(0)}]${ok ? "" : `  keys ${[e2.alongLen, e2.alongAnchor, e2.alongOff, e2.sidewalkSide, e2.type].join("|")}`}`);
      await page.keyboard.press("Escape");
    }
    console.log(`\n== rot ${deg} · ${role} (${side})\n` + rows.join("\n"));
    expect(rows.filter((r) => !r.startsWith("ok")), "every layer kind shortens by its handle").toEqual([]);
  });
}
