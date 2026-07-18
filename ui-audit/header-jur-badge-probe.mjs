/* Headless probe for NEW-2 (header jurisdiction-badge doubling/overlap). Drives the real
 * AppHeader + JurisdictionBadge for the "0 MUESCHKE RD, TOMBALL" / "Unincorporated · Harris
 * County" case, screenshots the badge, and measures:
 *   (1) the badge's inner text span vs. its outer pill box — does the text overflow the pill
 *       (a hard clip / spill that reads as "doubled" when it collides with a neighbour)?
 *   (2) badge box vs. the left breadcrumb box — any horizontal overlap?
 * Run: npm run dev -- --port 5199 --strictPort (bg); node ui-audit/header-jur-badge-probe.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:5199";
const URL = `${BASE}/ui-audit/header-jur-badge-harness.html`;
const OUT = "ui-audit/out";
mkdirSync(OUT, { recursive: true });

const WIDTHS = [1280, 1100, 1000, 900, 820, 780];
const browser = await chromium.launch({ args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.__READY__ === true, { timeout: 15000 });
  console.log("page errors:", errors.length ? errors.join(" | ") : "none");

  const measure = (scope) =>
    page.evaluate((scope) => {
      const root = document.querySelector(`[data-scope="${scope}"]`);
      const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, top: r.top, bottom: r.bottom }; };
      const badgePill = root.querySelector('[data-testid="jurisdiction-badge"]');
      // the inner text span is the pill's last <span> child holding the label
      const textSpan = badgePill ? Array.from(badgePill.querySelectorAll("span")).find((s) => /County|Unincorporated/.test(s.textContent)) : null;
      const row = root.querySelector("header > div");
      const leftZone = row.children[0];
      return {
        vw: window.innerWidth,
        pill: badgePill ? rect(badgePill) : null,
        text: textSpan ? { ...rect(textSpan), scrollW: textSpan.scrollWidth, clientW: textSpan.clientWidth, content: textSpan.textContent } : null,
        left: rect(leftZone),
      };
    }, scope);

  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 200 });
    await page.waitForTimeout(120);
    for (const scope of ["uninc", "long"]) {
      const m = await measure(scope);
      if (!m.pill) { console.log(`w=${w} ${scope}: NO BADGE`); continue; }
      const overflow = m.text ? m.text.scrollW - m.text.clientW : 0; // >0 → text wider than its box (clipped, no ellipsis room)
      const textSpill = m.text ? Math.max(0, m.text.right - m.pill.right) + Math.max(0, m.pill.left - m.text.left) : 0; // text painting outside the pill
      const lcOverlap = Math.max(0, Math.min(m.left.right, m.pill.right) - Math.max(m.left.left, m.pill.left));
      console.log(
        `w=${w} ${scope}: pill=${m.pill.width.toFixed(0)}px text.scrollW=${m.text?.scrollW ?? "-"} clientW=${m.text?.clientW ?? "-"} overflow=${overflow.toFixed(0)} textSpill=${textSpill.toFixed(1)} leftOverlap=${lcOverlap.toFixed(1)} :: "${m.text?.content ?? ""}"`
      );
    }
    await page.screenshot({ path: `${OUT}/jurbadge-${w}.png` });
  }
} finally {
  await browser.close();
}
