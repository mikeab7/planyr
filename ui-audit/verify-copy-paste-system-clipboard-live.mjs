/* verify-copy-paste-system-clipboard-live — V1810656 / B2382272: Ctrl+C / Ctrl+V of map elements beats a stale
 * clipboard image, signed in on the real deploy. Throwaway project on the e2e test account only; every row it
 * creates is deleted AND verified gone at the end (owner rule 15). EXPECT_SHA=<merge sha> is matched to /version.json
 * in the same call as the assertions. Usage: BASE_URL=https://planyr.io EXPECT_SHA=<sha> node ui-audit/verify-copy-paste-system-clipboard-live.mjs */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { countFeatures } from "./lib/featureCensus.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const results = [];
const ok = (n, c, x = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"} — ${n}${x ? " :: " + x : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const S = await openSignedIn({ base: BASE, contextOptions: { permissions: ["clipboard-read", "clipboard-write"] } });
const page = S.page;
await assertMeasurable(page, "verify-copy-paste-system-clipboard-live");
const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
console.log("served build", JSON.stringify(build), "expect", process.env.EXPECT_SHA || "(unset)");
if (process.env.EXPECT_SHA) ok("deploy serves the merge commit", process.env.EXPECT_SHA.startsWith(build.build) || build.build.startsWith(process.env.EXPECT_SHA.slice(0, 7)));

const before = await page.evaluate(async () => (await window.pfSupabase.from("sites").select("id")).data.map((r) => r.id)); // every id that exists now (live or already trashed)
const canvas = page.getByTestId("planner-canvas");
const cnt = () => countFeatures(page, -1);
const selectTool = async () => { const b = page.getByRole("button", { name: /^Select V$/ }); await b.click(); };
const imageOnClipboard = () => page.evaluate(async () => {
  const c = document.createElement("canvas"); c.width = 40; c.height = 40; c.getContext("2d").fillRect(0, 0, 40, 40);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
});
const featBox = async (kind) => (await page.locator(`[data-feature^="${kind}:"]`).first().boundingBox());
const clickKind = async (kind, opts = {}) => {
  await selectTool();
  const bb = await featBox(kind);
  await page.mouse.click(bb.x + bb.width / 2, opts.edge ? bb.y + 1 : bb.y + bb.height / 2, opts.shift ? { modifiers: ["Shift"] } : {});
  await sleep(250);
};

try {
  await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click();
  await page.getByTestId("map-toolbar-draw").first().click();
  await canvas.waitFor({ state: "visible", timeout: 30000 });
  const box = await canvas.boundingBox();
  // draw: building, polygon markup, length measure, callout, parcel (the real tools)
  await page.getByRole("button", { name: /^Building$/ }).first().click();
  const x0 = box.x + box.width * 0.58, y0 = box.y + box.height * 0.28, x1 = box.x + box.width * 0.76, y1 = box.y + box.height * 0.44;
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 }); await page.mouse.move(x1, y1, { steps: 6 }); await page.mouse.up();
  await selectTool();
  await page.keyboard.press("Shift+P");
  for (const [fx, fy] of [[0.30, 0.30], [0.46, 0.30], [0.46, 0.46]]) { await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy); await sleep(90); }
  await page.mouse.dblclick(box.x + box.width * 0.30, box.y + box.height * 0.46); await selectTool();
  await page.getByRole("button", { name: /^Measure mode:/ }).click(); await page.getByRole("button", { name: "Length", exact: true }).click();
  const my = box.y + box.height * 0.62;
  await page.mouse.click(box.x + box.width * 0.30, my); await page.mouse.click(box.x + box.width * 0.46, my); await selectTool();
  await page.keyboard.press("q");
  await page.mouse.click(box.x + box.width * 0.60, box.y + box.height * 0.62); await page.mouse.click(box.x + box.width * 0.72, box.y + box.height * 0.70);
  await page.keyboard.type("Copy me"); await page.keyboard.press("Escape"); await selectTool();
  await sleep(1500);
  const seeded = await cnt();
  ok("known-good arm: building, markup, measure, callout drawn", seeded >= 4, `features=${seeded}`);
  if (seeded < 4) throw new Error("VOID: seed incomplete");

  for (const [label, kind, edge] of [["building", "el", false], ["polygon markup", "markup", true], ["length measure", "measure", false], ["callout", "callout", false]]) {
    await clickKind(kind, { edge });
    await imageOnClipboard();                              // the owner's exact sequence: a stale image is on the clipboard first
    await clickKind(kind, { edge });
    const n0 = await cnt();
    await page.keyboard.press("Control+c");
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.80);
    await page.keyboard.press("Control+v");
    await sleep(1200);
    const n1 = await cnt();
    ok(`${label}: image on clipboard, Ctrl+C, Ctrl+V → a duplicate, not the image`, n1 > n0, `${n0} → ${n1}`);
    ok(`${label}: no pasted image overlay`, (await page.getByText("Pasted image").count()) === 0);
  }
  // multi-select (shift) → both duplicated
  await selectTool(); const eb = await featBox("el"); await page.mouse.click(eb.x + eb.width / 2, eb.y + eb.height / 2);
  const mb = await featBox("markup"); await page.keyboard.down("Shift"); await page.mouse.click(mb.x + mb.width / 2, mb.y + 1); await page.keyboard.up("Shift"); await sleep(250);
  await imageOnClipboard();
  const m0 = await cnt();
  await page.keyboard.press("Control+c"); await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.85); await page.keyboard.press("Control+v"); await sleep(1200);
  const m1 = await cnt();
  ok("multi-select copy-paste duplicates the whole set", m1 - m0 >= 2, `${m0} → ${m1}`);

  // second plan
  await clickKind("callout"); await page.keyboard.press("Control+c"); await sleep(300);
  await page.getByTestId("plan-crumb").click();
  await page.getByRole("button", { name: /New plan/ }).click();
  await page.getByTestId("plan-crumb").filter({ hasText: /Concept B/ }).waitFor({ timeout: 20000 });
  await canvas.waitFor({ state: "visible" }); await sleep(800);
  const b0 = await cnt();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5); // focus the canvas of the fresh mount
  await page.keyboard.press("Control+v"); await sleep(1500);
  const b1 = await cnt();
  ok("paste into a second plan of the project", b1 > b0, `${b0} → ${b1}`);
  await sleep(4000); // let the cloud write settle
  await page.reload({ waitUntil: "domcontentloaded" });
  await canvas.waitFor({ state: "visible", timeout: 40000 }); await sleep(3000);
  const b2 = await cnt();
  ok("cache-busted reload: the pasted element persisted on the second plan", b2 >= b1 && b2 > 0, `${b1} → ${b2}`);
} catch (e) { ok("harness ran to completion", false, String(e && e.message || e)); }
finally {
  // cleanup: every row created by this run, verified gone
  const gone = await page.evaluate(async (keep) => {
    const c = window.pfSupabase;
    const live = async () => (await c.from("sites").select("id").is("deleted_at", null)).data.map((r) => r.id).filter((id) => !keep.includes(id));
    const mine = await live();
    // the product's own delete is a soft delete (deleted_at) — same as every other live harness here
    if (mine.length) await c.from("sites").update({ deleted_at: new Date().toISOString() }).in("id", mine);
    return { removed: mine.length, left: (await live()).length };
  }, before);
  ok("test artifacts cleared and verified gone", gone.left === 0, JSON.stringify(gone));
  await S.close();
  const pass = results.filter(Boolean).length;
  console.log(`\n${pass}/${results.length} passed`);
  process.exit(pass === results.length ? 0 : 1);
}
