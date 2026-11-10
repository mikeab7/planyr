#!/usr/bin/env node
/* capture-chrome-copy — WHAT CHROME REALLY PUTS ON THE CLIPBOARD for text copied off a styled page (NEW-2, 2026-11-10).
 *
 * The Notes paste bank's `browser-block-styles` fixture is the output of this script, not a hand-written guess at it: it selects two
 * paragraphs whose red serif font comes from a STYLESHEET CLASS, presses a real Ctrl+C, and reads the clipboard back. Chrome inlines the
 * computed colour / font-family / font-size onto each <p> itself — never onto a span — which is the shape the paste parser did not read.
 * Re-run it after a Chromium upgrade to see whether the real shape moved: `node ui-audit/capture-chrome-copy.mjs`.
 * `BASE_URL` (default http://127.0.0.1:5199, any secure origin: navigator.clipboard needs one) · `PW_CHROME`. Prints JSON { text/plain, text/html }. */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const browser = await chromium.launch({ ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}), args: ["--no-sandbox"] });
const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
await assertMeasurable(page, "capture-chrome-copy");
await page.goto(`${process.env.BASE_URL || "http://127.0.0.1:5199"}/robots.txt`);
await page.evaluate((h) => { document.documentElement.innerHTML = h; }, `<head><meta charset=utf-8><style>
body{font-family:Arial,sans-serif;color:#222;margin:20px}
.chat{font-family:"Anthropic Serif",Georgia,"Times New Roman",serif;color:#cc0000;font-size:16px;line-height:1.5}
.chat p{margin:0 0 8px} .chat mark{background:#ffff00} .chat a{color:#0000ee}
</style></head><body><div class="chat"><p>Red serif paragraph copied from a chat answer in a browser.</p><p>Then <strong>bold words</strong>, <em>italic words</em>, <u>underlined words</u>, <s>struck words</s>, <mark>highlighted words</mark> and <a href="https://example.com/doc">a link</a>.</p></div></body>`);
await page.evaluate(() => { const s = getSelection(); s.selectAllChildren(document.querySelector(".chat")); });
await page.keyboard.press("Control+c");
await page.waitForTimeout(300);
const out = await page.evaluate(async () => { const items = await navigator.clipboard.read(); const r = {}; for (const it of items) for (const t of it.types) r[t] = await (await it.getType(t)).text(); return r; });
console.log(JSON.stringify(out, null, 1));
await browser.close();
