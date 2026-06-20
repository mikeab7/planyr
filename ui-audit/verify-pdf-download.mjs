// Live end-to-end test of NEW-1: drives the REAL built app (not a synthetic sheet) —
// seeds a site, opens the planner, File ▾ → Download PDF / pick frame… → Download PDF —
// and captures the ACTUAL downloaded file, proving the button wiring produces a real PDF
// (no browser print dialog / pop-up window). Validates the download with pdfjs.
// Logged-out (no auth needed); origin:null so there's no cross-origin basemap to inline.
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const DEMO_ID = "pdf-dl-verify-1";
const els = [
  { id: "b1", type: "building", cx: -300, cy: 0, w: 500, h: 500, rot: 0, dock: "cross" },
  { id: "b2", type: "building", cx: 360, cy: 0, w: 380, h: 250, rot: 0, dock: "single" },
];
const parcel = { id: "p1", points: [{ x: -700, y: -500 }, { x: 700, y: -500 }, { x: 700, y: 500 }, { x: -700, y: 500 }] };
const demoSite = { id: DEMO_ID, groupId: DEMO_ID, site: "Mesa Logistics", name: "Plan 1", origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() };

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });
// Fail loudly if any pop-up window is opened — the OLD path did window.open("_blank");
// the NEW path must NOT (the whole point: no blank print window).
let popups = 0;
ctx.on("page", () => { popups++; });

await page.addInitScript(({ id, site }) => {
  localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [id]: site }));
  localStorage.setItem("planarfit:currentSite:v1", JSON.stringify(id));
}, { id: DEMO_ID, site: demoSite });

mkdirSync("ui-audit/screens", { recursive: true });
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1200);
await page.locator("text=Mesa Logistics").first().click({ timeout: 8000 }).catch((e) => errors.push("open site: " + e.message));
await page.waitForTimeout(1200);

// File ▾ → Download PDF / pick frame…
await page.locator('button:has-text("File ▾")').first().click({ timeout: 8000 }).catch((e) => errors.push("File menu: " + e.message));
await page.waitForTimeout(300);
await page.locator('button:has-text("Download PDF / pick frame")').first().click({ timeout: 8000 }).catch((e) => errors.push("menu item: " + e.message));
await page.waitForTimeout(500);
const toolbar = await page.locator("text=Print frame").count();
await page.screenshot({ path: "ui-audit/screens/pdf-download-frame.png" });

// Click "Download PDF" and capture the actual file.
const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
await page.locator('button:has-text("Download PDF")').last().click({ timeout: 8000 }).catch((e) => errors.push("download btn: " + e.message));
let savedPath = null, suggested = null;
try {
  const dl = await downloadPromise;
  suggested = dl.suggestedFilename();
  savedPath = "ui-audit/screens/" + suggested;
  await dl.saveAs(savedPath);
} catch (e) { errors.push("download capture: " + e.message); }
await page.waitForTimeout(300);

// Validate the captured PDF.
let pdfOk = false, pageDims = null, numPages = null, isPdf = false;
if (savedPath) {
  const bytes = readFileSync(savedPath);
  isPdf = bytes.slice(0, 5).toString("latin1") === "%PDF-";
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  numPages = doc.numPages;
  const view = (await doc.getPage(1)).view;
  pageDims = [Math.round(view[2]), Math.round(view[3])];
  // default paper = letter landscape = 792 x 612 pt
  pdfOk = isPdf && numPages === 1 && pageDims[0] === 792 && pageDims[1] === 612;
}

await browser.close();
const filenameOk = !!suggested && /\.pdf$/i.test(suggested) && /Mesa Logistics/.test(suggested) && /Plan 1/.test(suggested);
const pass = toolbar > 0 && pdfOk && filenameOk && popups === 0 && errors.length === 0;
console.log("toolbar(Print frame present):", toolbar);
console.log("popup windows opened (must be 0):", popups);
console.log("download filename:", suggested, "| .pdf+named OK:", filenameOk);
console.log("isPDF:", isPdf, "| numPages:", numPages, "| pageDims(pt):", JSON.stringify(pageDims), "(want [792,612])");
console.log("errors (" + errors.length + "):", JSON.stringify(errors.slice(0, 10), null, 2));
console.log("\n" + (pass ? "PASS ✅ — real app downloaded a valid Letter-landscape PDF, no print dialog/pop-up" : "FAIL ❌"));
process.exit(pass ? 0 : 1);
