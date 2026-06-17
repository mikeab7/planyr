// Capture what the official USFWS Wetlands Mapper ACTUALLY requests to draw wetlands.
// Loads the mapper, optionally zooms, and logs every image/tile/export response so we can
// see the working service + request that renders crisp (vector) wetlands.
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
const EXEC = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const hits = [];
const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ["--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });

page.on("response", (r) => {
  const u = r.url();
  const ct = r.headers()["content-type"] || "";
  if (/wim\.usgs\.gov|wetland|MapServer|ImageServer|VectorTile|\/tile\//i.test(u)) {
    // record renders (images / tiles / exports / pbf), skip the bulky app JS/CSS
    if (/image\/|application\/x-protobuf|application\/octet-stream|application\/vnd\.mapbox/i.test(ct)
        || /export|exportImage|GetMap|\/tile\/|VectorTile|MapServer\/\d+\/query/i.test(u)) {
      hits.push({ status: r.status(), ct: ct.slice(0, 40), url: u.slice(0, 160) });
    }
  }
});

const MAPPER = "https://fwsprimary.wim.usgs.gov/wetlands/apps/wetlands-mapper/";
await page.goto(MAPPER, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(12000); // let the app boot + draw its default extent

// Try to drive it to Houston + zoom in (best-effort; ignore if the UI differs)
try {
  // many of these mappers expose a search box; type an address and Enter
  const search = await page.$('input[type="text"], input[placeholder*=" search" i], input[aria-label*="search" i]');
  if (search) { await search.fill("Sheldon Lake, Houston, TX"); await page.keyboard.press("Enter"); await page.waitForTimeout(8000); }
} catch (e) {}
// zoom in a few times via keyboard on the map
for (let i = 0; i < 4; i++) { try { await page.keyboard.press("+"); await page.waitForTimeout(2500); } catch (e) {} }
await page.waitForTimeout(4000);

await browser.close();

// De-dup by URL path (strip the bbox/query so we see distinct services), keep a few samples
const byService = {};
for (const h of hits) {
  const svc = h.url.replace(/\?.*$/, "").replace(/\/(export|exportImage|WMSServer|tile|query)\b.*/i, "/$1");
  (byService[svc] ||= []).push(h);
}
console.log("=== distinct wetland-render services the mapper hit ===");
for (const [svc, arr] of Object.entries(byService)) {
  const ok = arr.filter((a) => a.status === 200).length;
  console.log(`\n${svc}\n   hits:${arr.length} ok200:${ok} ct:${arr[0].ct}\n   e.g. ${arr[0].url}`);
}
console.log("\n=== total render hits:", hits.length, "===");
