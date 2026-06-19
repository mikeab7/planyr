/* B177: during a pan shortly after load, a lingering frozen snapshot would sit on
 * top of the live basemap and lag behind the drawn layers. Verify no stale
 * snapshot overlay persists while panning. The basemap clip box should hold just
 * the live map (1 child) during an active pan — extra children = frozen ghosts. */
import { chromium } from "playwright";
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const site = {
  id: "flash-demo", groupId: "flash-demo", site: "Flash Demo", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] }],
  els: [{ id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [site.id]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
// throttle so detail tiles are still loading during the pan (reproduces "while loading")
const client = await ctx.newCDPSession(page);
await client.send("Network.emulateNetworkConditions", { offline: false, latency: 80, downloadThroughput: (1.2 * 1024 * 1024) / 8, uploadThroughput: (512 * 1024) / 8 });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector("svg[role=application]");
await page.waitForFunction(() => document.querySelectorAll(".leaflet-tile").length > 0);

// Count snapshot clones in the PLANNER basemap clip box specifically. The live
// geoWrap is the .leaflet-container whose parent has overflow:hidden (the clip
// box); snapshots are extra children of that same clip box. Excludes the hidden
// Map Finder's own container.
const clipChildren = () => page.evaluate(() => {
  const conts = [...document.querySelectorAll(".leaflet-container")];
  const live = conts.find((c) => c.parentElement && getComputedStyle(c.parentElement).overflow === "hidden");
  if (!live) return -1;
  return live.parentElement.children.length; // 1 = just live map; >1 = snapshot(s) present
});

// pan immediately + repeatedly (the "grab and move the screen during load" case)
await page.keyboard.press("h");
const box = await page.locator("svg[role=application]").boundingBox();
console.log("baseline clip-box children (idle):", await clipChildren());
let maxChildren = 0, samples = 0, lingered = 0;
for (let burst = 0; burst < 4; burst++) {
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down();
  for (let i = 0; i < 10; i++) {
    await page.mouse.move(cx - i * 30, cy - i * 18);
    await page.waitForTimeout(25);
    const c = await clipChildren();
    samples++;
    if (c > maxChildren) maxChildren = c;
    if (c > 1) lingered++;
  }
  await page.mouse.up();
  await page.waitForTimeout(120);
}
console.log(`samples=${samples}  maxContainers=${maxChildren}  framesWithSnapshot=${lingered} (${((lingered / samples) * 100).toFixed(0)}%)`);
console.log(lingered === 0 ? "OK — no snapshot ever on top while panning" : lingered <= 2 ? "OK-ish — only a transient 1-frame blip" : "DECOUPLE RISK — snapshot persisted across multiple pan frames");
await browser.close();
