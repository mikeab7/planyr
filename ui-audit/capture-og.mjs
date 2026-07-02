/* Capture the landing hero as the social-preview image (public/landing/og.png, 1200x630).
 * Run with the preview server up:  node ui-audit/capture-og.mjs */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const b = await chromium.launch({
  args: ["--no-sandbox", "--ignore-certificate-errors", "--use-gl=angle",
    "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const ctx = await b.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
await p.goto(BASE.replace(/\/$/, "") + "/landing/", { waitUntil: "load", timeout: 45000 });
await new Promise((r) => setTimeout(r, 2200)); // let the mark assemble + settle
await p.screenshot({ path: new URL("../public/landing/og.png", import.meta.url).pathname });
await b.close();
console.log("og.png written");
