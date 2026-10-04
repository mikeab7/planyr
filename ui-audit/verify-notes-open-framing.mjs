/* verify-notes-open-framing — NEW-4 (iPhone review 2026-09-29): a note opens with the page's TOP near
 * the top of the canvas, and on a phone the whole page WIDTH is on screen. A view the person already
 * left on the page (planyr:notes:view:v1:local:<id>) still wins, unchanged.
 *
 * ⛔ THE FIRST LAYOUT PASS MEASURES THE SHEET SHORT, and a vertically-CENTRED framing against that number
 * lands the page mid-screen (253 px down on 1280x800 — the reported figure — 330 px on a 390x664 phone).
 * Whether it recovers is a RACE (the full-height pin lands ~140 ms later), so an unthrottled run can pass
 * on unfixed code by luck. Arm B therefore also runs under a 6x CPU throttle (Chromium, CDP
 * Emulation.setCPUThrottlingRate) to push the latch onto the short measurement: that arm is RED on
 * untouched main and is the red-proof. Engines: WebKit (hasTouch+isMobile for phones) and Chromium. */
import { chromium, webkit } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const failures = [];
const ok = (l, c, d) => { console.log(`${c ? "✓" : "⛔"} ${l}${d !== undefined ? ` — ${d}` : ""}`); if (!c) failures.push(l); };
const VIEWS = [
  ["390x664", { width: 390, height: 664 }, true], ["390x844", { width: 390, height: 844 }, true],
  ["430x932", { width: 430, height: 932 }, true], ["1280x800", { width: 1280, height: 800 }, false],
  ["390x330 (keyboard-up proxy)", { width: 390, height: 330 }, true],
];
const DOCS = {
  empty: { type: "doc", content: [{ type: "paragraph" }] },
  box: { type: "doc", content: [{ type: "noteAnchor", attrs: { x: 20, y: 40, w: 160, h: null, aid: "ba" }, content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] }, { type: "paragraph" }] },
  long: { type: "doc", content: Array.from({ length: 60 }, (_, i) => ({ type: "paragraph", content: [{ type: "text", text: `line ${i}` }] })) },
};

async function open(browser, engine, size, touch, doc, { throttle = 1, view = null } = {}) {
  const ctx = await browser.newContext({ viewport: size, ...(touch ? { hasTouch: true, isMobile: true, deviceScaleFactor: 3 } : {}) });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("   PAGEERROR", String(e.message).slice(0, 160)));
  await assertMeasurable(page, "verify-notes-open-framing");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 250);
  await page.evaluate(([d, v]) => {
    localStorage.clear();
    localStorage.setItem("planyr:notes:tree:v1:local", JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "T", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem("planyr:notes:page:v1:local:p1", JSON.stringify(d));
    if (v) localStorage.setItem("planyr:notes:view:v1:local:p1", JSON.stringify(v));
  }, [doc, view]);
  if (throttle > 1 && engine === "chromium") { const c = await ctx.newCDPSession(page); await c.send("Emulation.setCPUThrottlingRate", { rate: throttle }); }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 30000 });
  await pacedWait(page, 2500);
  const m = await page.evaluate(() => {
    const mat = document.querySelector('[data-testid="note-mat"]').getBoundingClientRect();
    const s = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect();
    const t = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(document.querySelector('[data-testid="note-workspace"]').style.transform || "");
    const body = document.querySelector('[data-testid="note-body"]');
    return { top: Math.round(s.top - mat.top), left: Math.round(s.left - mat.left), right: Math.round(s.right - mat.left), matW: Math.round(mat.width), matH: Math.round(mat.height),
      view: t ? { x: parseFloat(t[1]) * -1, y: parseFloat(t[2]) * -1, z: parseFloat(t[3]) } : null, fontPx: parseFloat(getComputedStyle(body).fontSize) };
  });
  await ctx.close();
  return m;
}
const MAXTOP = 48;     // "a small margin": the 4%-of-short-side margin is 13–32 px
for (const engine of ["webkit", "chromium"]) {
  const browser = engine === "webkit" ? await webkit.launch({}) : await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const tag = engine === "webkit" ? "WebKit" : "Chromium";
  for (const [name, size, touch] of VIEWS) {
    for (const [dn, doc] of Object.entries(DOCS)) {
      const m = await open(browser, engine, size, touch, doc);
      ok(`[${tag}] ${name} ${dn}: page top within a small margin of the canvas top`, m.top >= 0 && m.top <= MAXTOP, `top ${m.top}px of a ${m.matH}px canvas`);
      if (touch) ok(`[${tag}] ${name} ${dn}: BOTH page edges are on screen`, m.left >= 0 && m.right <= m.matW, `${m.left}…${m.right} of ${m.matW}`);
      if (touch && dn === "empty" && size.height === 844) console.log(`   (body text ${m.fontPx}px × zoom ${m.view?.z.toFixed(2)} = ${(m.fontPx * (m.view?.z || 1)).toFixed(1)}px on screen)`);
    }
  }
  if (engine === "chromium") {
    for (const [name, size, touch] of VIEWS.slice(0, 4)) {
      const m = await open(browser, engine, size, touch, DOCS.empty, { throttle: 6 });
      ok(`[${tag}] ${name} empty UNDER 6x CPU THROTTLE (forces the early latch): page top within a small margin`, m.top >= 0 && m.top <= MAXTOP, `top ${m.top}px of a ${m.matH}px canvas`);
    }
  }
  // a stored view still wins, untouched
  const saved = { x: 123, y: 77, z: 1.5 };
  const m = await open(browser, engine, { width: 1280, height: 800 }, false, DOCS.box, { view: saved });
  ok(`[${tag}] a saved per-page view is restored unchanged`, m.view && Math.abs(m.view.x - 123) < 1 && Math.abs(m.view.y - 77) < 1 && Math.abs(m.view.z - 1.5) < 0.01, JSON.stringify(m.view));
  const mp = await open(browser, engine, { width: 390, height: 844 }, true, DOCS.box, { view: saved });
  ok(`[${tag}] …and on a phone too (no fit-width override of a saved view)`, mp.view && Math.abs(mp.view.x - 123) < 1 && Math.abs(mp.view.z - 1.5) < 0.01, JSON.stringify(mp.view));
  await browser.close();
}
console.log(failures.length ? `\n⛔ ${failures.length} failed` : "\n✓ all opening-framing arms pass");
process.exit(failures.length ? 1 : 0);
