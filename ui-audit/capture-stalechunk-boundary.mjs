/* Capture the B228 stale-chunk "A new version of Planyr is ready" screen for review. */
import { chromium } from "playwright";
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
await page.route("**/Scheduler-*.js", (r) => r.fulfill({ status: 404, body: "gone" }));
await page.goto(BASE, { waitUntil: "load" });
await page.evaluate((k) => sessionStorage.setItem(k, String(Date.now())), "planyr:chunkReloadAt"); // suppress auto-reload so the screen shows
await page.getByRole("button", { name: "Schedule" }).click();
await page.waitForSelector("text=A new version of Planyr is ready", { timeout: 8000 });
await page.waitForTimeout(400);
await page.screenshot({ path: new URL("./screens/stalechunk-update-screen.png", import.meta.url).pathname });
console.log("captured screens/stalechunk-update-screen.png");
await browser.close();
