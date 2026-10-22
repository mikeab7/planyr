/* B2380112 / V1808496 — File ▾ carries the Google Earth (KMZ) export; the canvas right-click does not.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-file-menu-kmz-live.mjs [https://planyr.io | a *.planyr.pages.dev preview]
 * Signs in as the test account (shared helper), opens its fixture site in the Site Planner and reads, IN ONE CALL:
 * the served build (/version.json) + loaded chunk hashes, the File ▾ rows, their enabled/disabled state (and reason),
 * a real .kmz download when the plan is located, and the canvas right-click (known-good arm: Zoom to fit + Paste present).
 * Read-only on the fixture (never edits or deletes it). */
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";

const base = (process.argv[2] || "https://planyr.io").replace(/\/+$/, "");
const results = [];
const check = (name, ok, extra = "") => { results.push([name, !!ok]); console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };
const s = await openSignedIn({ base });
const { page } = s;
try {
  await assertMeasurable(page, "verify-file-menu-kmz-live");
  await page.goto(`${base}/#/project/${FIXTURE_SITE_ID}/site`, { waitUntil: "load" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
  await page.waitForTimeout(2500);
  const served = await page.evaluate(async () => ({
    version: await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    scripts: [...document.querySelectorAll("script[src]")].map((x) => x.getAttribute("src")).filter((u) => /assets\//.test(u)).slice(0, 4),
    chunks: performance.getEntriesByType("resource").map((e) => e.name).filter((u) => /SitePlannerApp-|exportSheet-|kmzExport-/.test(u)).map((u) => u.split("/").pop()),
  }));
  console.log("served build:", JSON.stringify(served.version), "| chunks:", served.chunks.join(", ") || "(export chunks load on first File open)", "| signed in as", s.proof.email);

  await page.getByRole("button", { name: /^File/ }).first().click();
  const k = page.getByTestId("file-export-kmz"), k3 = page.getByTestId("file-export-kmz-3d");
  check("File ▾ shows Export PNG", await page.getByRole("button", { name: "Export PNG", exact: true }).isVisible());
  check("File ▾ shows 'Export to Google Earth (KMZ)'", await k.isVisible());
  check("File ▾ shows 'Export with 3D buildings'", await k3.isVisible());
  const hover = await page.getByRole("button", { name: /^File/ }).first().getAttribute("title");
  check("File button title mentions Google Earth", /Google Earth/.test(hover || ""), hover);
  const enabled = await k.isEnabled();
  if (enabled) {
    check("located plan → both rows enabled", enabled && (await k3.isEnabled()));
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), k.click()]);
    const buf = await readFile(await dl.path());
    const method = buf.readUInt16LE(8), comp = buf.readUInt32LE(18), nlen = buf.readUInt16LE(26), elen = buf.readUInt16LE(28);
    const data = buf.slice(30 + nlen + elen, 30 + nlen + elen + comp);
    const kml = (method === 0 ? data : inflateRawSync(data)).toString("utf8");
    check("non-empty .kmz downloaded", /\.kmz$/.test(dl.suggestedFilename()) && buf.length > 200, `${dl.suggestedFilename()} ${buf.length} bytes`);
    check("zip holds doc.kml with coordinates", buf.slice(30, 30 + nlen).toString() === "doc.kml" && /<coordinates>/.test(kml));
  } else {
    check("unlocated plan → both rows disabled", !(await k3.isEnabled()));
    check("disabled reason shown", (await k.getAttribute("title")) === "Place this plan on the map first", await k.getAttribute("title"));
    console.log("NOTE: the fixture plan has no map location, so the real download arm could not run here (covered by the sandbox e2e).");
    await page.keyboard.press("Escape");
  }

  await page.keyboard.press("Escape");
  const box = await page.getByTestId("planner-canvas").boundingBox();
  await page.mouse.click(box.x + 40, box.y + box.height - 40, { button: "right" });
  const menu = page.locator('[role="menu"]').filter({ hasText: /Zoom to fit/ }).first();
  check("canvas right-click menu opens (known-good: Zoom to fit + Paste)", (await menu.isVisible()) && /Paste/.test(await menu.innerText()));
  check("canvas right-click has NO Google Earth / 3D rows", !/Google Earth|3D buildings/.test(await menu.innerText()));
} finally { await s.close(); }
const bad = results.filter(([, ok]) => !ok);
console.log(bad.length ? `FAIL ${bad.length}/${results.length}` : `PASS ${results.length}/${results.length}`);
process.exit(bad.length ? 1 : 0);
