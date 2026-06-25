/* B461 + B462 — Site-plan overlay right-click menu + "Align to base edge", driven headless.
 *
 * Boots the planner logged-out (this-device mode) with a seeded site that has a parcel rotated
 * ~30° (so an "align to base" produces an observable, non-zero rotation), drops a PNG to create
 * a real overlay, then exercises the new context menu + align gesture:
 *   1. right-click the overlay row → the menu appears with Copy / Duplicate / Paste / Bring to
 *      front / Send to back / Lock / Align to base edge… / Delete;
 *   2. Duplicate → a second overlay row appears (count +1);
 *   3. Lock → the row's lock chip flips to locked (🔒);
 *   4. Delete → the overlay row count drops, no "Delete didn't take" warning;
 *   5. Align to base edge… → arm, click the overlay → the overlay's Rotate value snaps off 0 to
 *      the parcel-edge angle (~30°), proving the building→parcel align primitive drives overlays.
 *
 * Run: npm run dev &  then  node ui-audit/verify-b461-b462-overlay-menu.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:5173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

// A rectangle rotated 30° about the origin → every edge sits at 30°/120°, so aligning to ANY
// edge snaps the overlay (starting at 0°) to 30° (the nearest 90°-equivalent of either edge).
const rot = (x, y, deg) => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return { x: x * c - y * s, y: x * s + y * c }; };
const parcel = { id: "pc1", locked: false, points: [[-700, -450], [700, -450], [700, 450], [-700, 450]].map(([x, y]) => rot(x, y, 30)) };
const DEMO_ID = "verify-overlay-menu";
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify Overlay Menu", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els: [], measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [], sheetOverlays: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

let fail = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`); if (!cond) fail++; };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
let pageErrors = 0;
page.on("pageerror", (e) => { pageErrors++; console.log("  [pageerror]", String(e).slice(0, 160)); });

// Open the menu by dispatching a real contextmenu event at the overlay row (right-click).
const rightClick = (selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
  el.dispatchEvent(ev);
  return true;
}, selector);

// Read the visible overlay context-menu items (the portalled .menu with our entries).
const menuItems = () => page.evaluate(() => {
  const menus = [...document.querySelectorAll("div.menu")];
  const m = menus.find((d) => /Align to base edge/i.test(d.textContent || ""));
  if (!m) return null;
  return [...m.querySelectorAll("button")].map((b) => ({ text: (b.textContent || "").trim(), disabled: b.disabled }));
});
const clickMenuItem = (re) => page.evaluate((src) => {
  const rx = new RegExp(src, "i");
  const menus = [...document.querySelectorAll("div.menu")];
  const m = menus.find((d) => /Align to base edge/i.test(d.textContent || ""));
  if (!m) return false;
  const btn = [...m.querySelectorAll("button")].find((b) => rx.test(b.textContent || "") && !b.disabled);
  if (!btn) return false;
  btn.click();
  return true;
}, re.source);
const overlayRows = () => page.evaluate(() => [...document.querySelectorAll('button[title*="plan.png"]')].length);
const rotationVal = () => page.evaluate(() => { const i = document.querySelector('[data-testid="overlay-rotation"]'); return i ? i.value : null; });

try {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  // Open the Overlay panel.
  try { await page.locator('[title="Overlay"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("overlay-tab warn", e.message); }
  await page.waitForTimeout(400);

  // Drop a real PNG onto the panel dropzone → one overlay.
  await page.evaluate(() => {
    const target = [...document.querySelectorAll("button")].find((b) => /Add site plan/i.test(b.textContent || ""))?.parentElement
      || document.querySelector('svg[aria-label="Site plan canvas"]')?.parentElement;
    const dt = new DataTransfer();
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    dt.items.add(new File([arr], "plan.png", { type: "image/png" }));
    const ev = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "dataTransfer", { value: dt });
    target.dispatchEvent(ev);
  });
  await page.waitForTimeout(2200); // rasterize
  const rows0 = await overlayRows();
  check("dropping a PNG created one overlay", rows0 === 1, `rows=${rows0}`);

  // 1) Right-click the overlay row → menu with all entries.
  await rightClick('button[title*="plan.png"]');
  await page.waitForTimeout(250);
  const items = await menuItems();
  const has = (re) => !!(items || []).find((it) => re.test(it.text));
  check("right-click opens the overlay menu", !!items, items ? `${items.length} items` : "no menu");
  check("menu has Copy / Duplicate / Paste", has(/Copy/) && has(/Duplicate/) && has(/Paste/));
  check("menu has Bring to front / Send to back", has(/Bring to front/) && has(/Send to back/));
  check("menu has Lock + Align to base edge + Delete", has(/Lock/) && has(/Align to base edge/) && has(/Delete/));
  // Single overlay → Send to back AND Bring to front are both no-ops (disabled).
  const back0 = (items || []).find((it) => /Send to back/.test(it.text));
  check("z-order disabled for a lone overlay", !!back0 && back0.disabled);
  // Paste disabled before anything is copied.
  const paste0 = (items || []).find((it) => /Paste/.test(it.text));
  check("Paste disabled with an empty clipboard", !!paste0 && paste0.disabled);

  // 2) Duplicate → +1 row.
  await clickMenuItem(/Duplicate/);
  await page.waitForTimeout(400);
  const rows1 = await overlayRows();
  check("Duplicate adds a second overlay", rows1 === rows0 + 1, `rows ${rows0}→${rows1}`);

  // 3) Lock the (now-selected) duplicate via the menu → its row lock chip shows locked.
  await rightClick('button[title*="plan.png"]'); // first row; selection is the dup but either works for the assertion
  await page.waitForTimeout(200);
  const lockedBefore = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent === "🔒"));
  await clickMenuItem(/^Lock$|Lock/);
  await page.waitForTimeout(300);
  const lockedAfter = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent === "🔒"));
  check("Lock flips a row to the locked chip (🔒)", !lockedBefore && lockedAfter, `before=${lockedBefore} after=${lockedAfter}`);

  // 5) Align to base edge: read rotation, arm, click the overlay, expect a non-zero snapped angle.
  // (Use the FIRST, unlocked overlay row to avoid the locked-refusal path.)
  // First make sure the selected/edited overlay is unlocked: select row 1 and unlock if needed.
  await rightClick('button[title*="plan.png"]');
  await page.waitForTimeout(200);
  // ensure unlocked: if the menu shows "Unlock", click it
  if (await page.evaluate(() => { const m = [...document.querySelectorAll("div.menu")].find((d) => /Align to base edge/i.test(d.textContent || "")); return m && [...m.querySelectorAll("button")].some((b) => /Unlock/.test(b.textContent || "")); })) {
    await clickMenuItem(/Unlock/);
    await page.waitForTimeout(250);
    await rightClick('button[title*="plan.png"]');
    await page.waitForTimeout(200);
  }
  const rotBefore = await rotationVal();
  await clickMenuItem(/Align to base edge/);
  await page.waitForTimeout(300);
  // Dispatch a real pointerdown on the overlay image (the codebase's harnesses drive React's
  // onPointerDown via dispatched events; synthetic page.mouse on the SVG is flaky). The armed
  // overlay's ovAlignBase guard resolves the align against the nearest parcel edge.
  const fired = await page.evaluate(() => {
    const img = document.querySelector('image[data-overlay-image="1"]');
    if (!img) return "no-image";
    const r = img.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0, pointerId: 1, isPrimary: true, pointerType: "mouse" };
    img.dispatchEvent(new PointerEvent("pointerdown", opts));
    img.dispatchEvent(new PointerEvent("pointerup", opts));
    return { cx: Math.round(cx), cy: Math.round(cy) };
  });
  if (fired === "no-image") console.log("  [warn] overlay image not found for align click");
  await page.waitForTimeout(400);
  const rotAfter = await rotationVal();
  const changed = rotBefore != null && rotAfter != null && Math.abs(Number(rotAfter) - Number(rotBefore)) > 1;
  check("Align to base snaps the overlay to the parcel-edge angle (rotation changed off 0)", changed, `rot ${rotBefore}→${rotAfter}`);

  // 4) Delete the overlay → row count drops; no "didn't take" warning.
  const rowsBeforeDel = await overlayRows();
  await rightClick('button[title*="plan.png"]');
  await page.waitForTimeout(200);
  await clickMenuItem(/Delete/);
  await page.waitForTimeout(400);
  const rowsAfterDel = await overlayRows();
  const delWarn = await page.evaluate(() => [...document.querySelectorAll("body *")].some((el) => el.children.length === 0 && /Delete didn.?t take/i.test(el.textContent || "")));
  check("Delete removes an overlay (count drops)", rowsAfterDel === rowsBeforeDel - 1, `rows ${rowsBeforeDel}→${rowsAfterDel}`);
  check("no 'delete didn't take' warning (count-verified)", !delWarn);

  check("no uncaught page errors", pageErrors === 0, `pageErrors=${pageErrors}`);
} catch (e) {
  console.log("HARNESS ERROR:", e.message);
  fail++;
} finally {
  await ctx.close();
  await browser.close();
}

console.log(fail === 0 ? "\n✓ ALL B461/B462 CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
