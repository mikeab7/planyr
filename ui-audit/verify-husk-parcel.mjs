// Husk-parcel crash verification (the 2026-07-06 incognito outage).
// Seeds the logged-out store with a poisoned site — a null entry + a {z}-husk + one healthy
// parcel — then boots the app. Against the LIVE production build this exact shape crashed the
// Site Planner ("Cannot read properties of undefined (reading 'length')" from siteAcres);
// against the fixed build the list must render, show the site, and read the healthy parcel's
// acreage. Usage: node ui-audit/verify-husk-parcel.mjs <url> <expect: crash|healthy>
import { chromium } from "playwright";

const TARGET = process.argv[2] || "http://localhost:4173/";
const EXPECT = process.argv[3] || "healthy";
const EXEC = "/opt/pw-browsers/chromium";
const isLive = /^https:/.test(TARGET);

// One healthy 100x100ft parcel (~0.23 ac) + a null entry + a {z:0} husk (the crash shape).
const pts = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }]; // 1000ft sq ≈ 22.96 ac
const site = {
  id: "shusktest0001",
  name: "Husk Repro",
  site: "Husk Repro Site",
  status: "active", // top-level — statusOf(site) reads site.status (see docs/REFERENCE.md)
  updatedAt: Date.now(),
  schemaVersion: 11,
  parcels: [null, { z: 0 }, { id: "pgood", points: pts }],
  els: [], markups: [], measures: [], callouts: [], deletedIds: [],
  origin: { lat: 29.78, lon: -95.36 },
};

const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--ignore-certificate-errors"],
});
const ctx = await browser.newContext();
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (err) => errors.push(err.message));

if (isLive) {
  // Chromium's own TLS through the sandbox proxy fails — fetch via Node instead.
  await page.route("**/*", async (route) => {
    const req = route.request();
    try {
      const resp = await fetch(req.url(), {
        method: req.method(),
        headers: { ...req.headers(), host: undefined },
        body: req.postDataBuffer() ?? undefined,
        redirect: "manual",
      });
      const body = Buffer.from(await resp.arrayBuffer());
      const headers = {};
      resp.headers.forEach((v, k) => {
        if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(k)) headers[k] = v;
      });
      await route.fulfill({ status: resp.status, headers, body });
    } catch (e) {
      await route.abort("connectionfailed").catch(() => {});
    }
  });
}

// Seed BEFORE the app boots.
await page.addInitScript((s) => {
  try {
    if (!localStorage.getItem("planarfit:sites:v1"))
      localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [s.id]: s }));
  } catch (e) {}
}, site);

await page.goto(TARGET, { waitUntil: "load", timeout: 45000 }).catch((e) => errors.push("goto: " + e.message));
await page.waitForTimeout(9000);

const body = await page.evaluate(() => document.body.innerText).catch(() => "");
const crashed = body.includes("hit an error and couldn't load");
const lengthErr = errors.some((m) => m.includes("reading 'length'")) || body.includes("reading 'length'");
const siteListed = body.includes("Husk Repro");
const acreage = (body.match(/([\d.]+)\s*ac\b/) || [])[1] || null;

console.log(`target=${TARGET}`);
console.log(`crash-boundary=${crashed} length-error=${lengthErr} site-listed=${siteListed} acreage=${acreage}`);
console.log(`pageerrors: ${errors.length ? errors.join(" | ").slice(0, 300) : "(none)"}`);

let pass;
if (EXPECT === "crash") {
  pass = crashed && lengthErr;
  console.log(pass ? "PASS — live build crashes on the poisoned seed (repro confirmed)" : "FAIL — expected the live build to crash");
} else {
  pass = !crashed && !lengthErr && siteListed;
  console.log(pass ? "PASS — fixed build renders the poisoned site cleanly" : "FAIL — expected a healthy render");
}
await page.screenshot({ path: `ui-audit/verify-husk-${EXPECT}.png` });
await browser.close();
process.exit(pass ? 0 : 1);
