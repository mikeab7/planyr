/* verify-notes-touch-pan — NEW-2 (iPhone review 2026-09-29): ONE FINGER PANS A NOTE; TWO FINGERS
 * PINCH AND FOLLOW THEIR MIDPOINT; A STRAY NATIVE SCROLL IS FOLDED BACK INTO THE VIEW.
 *
 * WHICH ENGINE PROVES WHAT (said plainly, per PHONE-TESTING.md — WebKit has no real touch-drag
 * primitive in Playwright):
 *   • CHROMIUM (touch emulation) — drives the REAL touch pipeline through CDP
 *     `Input.dispatchTouchEvent`; this is what proves the pan survives a genuine touchstart/move/end.
 *   • WEBKIT (hasTouch + isMobile) — dispatches PointerEvents (pointerType "touch") at the mat; this
 *     proves the same handlers run on WebKit's engine, NOT that a real finger on glass produces them.
 * Judged on the workspace transform (the one view ref's own output), never on a rect alone.
 * Known-good arm: a MOUSE drag on the same bare paper still pans via the desktop path, so the
 * transform reader provably sees a pan. Finger is held still before lift so inertia cannot add to
 * the measured travel (inertia has its own arm). */
import { chromium, webkit, devices } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";
const failures = [];
const ok = (l, c, d) => { console.log(`${c ? "✓" : "⛔"} ${l}${d !== undefined ? ` — ${d}` : ""}`); if (!c) failures.push(l); };

const box = (aid, x, y, text) => ({ type: "noteAnchor", attrs: { x, y, w: 160, h: null, aid },
  content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const DOC = { type: "doc", content: [box("ba", 20, 40, "alpha text here"), { type: "paragraph", content: [] }] };

async function open(browser, { touch, engine }) {
  const ctx = await browser.newContext(touch ? { ...devices["iPhone 13"] } : { viewport: { width: 900, height: 700 } });
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("   PAGEERROR", String(e.message).slice(0, 160)));
  await assertMeasurable(page, "verify-notes-touch-pan");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 250);
  await page.evaluate(([tk, pk, d]) => {
    localStorage.clear();
    localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "T", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem(pk, JSON.stringify(d));
  }, [TREE_KEY, PAGE_KEY, DOC]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
  let cdp = null;
  if (engine === "chromium" && touch) cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp, engine };
}

const readView = (page) => page.evaluate(() => {
  const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/.exec(document.querySelector('[data-testid="note-workspace"]').style.transform || "");
  return m ? { x: -parseFloat(m[1]), y: -parseFloat(m[2]), z: parseFloat(m[3]) } : null;
});
const matRect = (page) => page.evaluate(() => { const r = document.querySelector('[data-testid="note-mat"]').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });

/* One driver, two backends. `fingers` = array of {x,y}; steps move all fingers by (dx_i,dy_i). */
async function touchDrive(env, starts, ends, { steps = 8, holdMs = 140 } = {}) {
  const { page, cdp, engine } = env;
  const at = (k) => starts.map((s, i) => ({ x: s.x + (ends[i].x - s.x) * k, y: s.y + (ends[i].y - s.y) * k }));
  if (cdp) {
    const send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
    await send("touchStart", at(0));
    for (let s = 1; s <= steps; s += 1) { await pacedWait(page, 20); await send("touchMove", at(s / steps)); }
    await pacedWait(page, holdMs);
    await send("touchEnd", []);
  } else {
    await page.evaluate(([pts]) => {
      window.__tp = pts.map((p, i) => ({ id: 100 + i, target: document.elementFromPoint(p.x, p.y) }));
      pts.forEach((p, i) => window.__tp[i].target.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 100 + i, pointerType: "touch", isPrimary: i === 0, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, composed: true })));
    }, [at(0)]);
    for (let s = 1; s <= steps; s += 1) {
      await pacedWait(page, 20);
      await page.evaluate(([pts]) => pts.forEach((p, i) => window.__tp[i].target.dispatchEvent(new PointerEvent("pointermove", { pointerId: 100 + i, pointerType: "touch", isPrimary: i === 0, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, composed: true }))), [at(s / steps)]);
    }
    await pacedWait(page, holdMs);
    await page.evaluate(([pts]) => pts.forEach((p, i) => window.__tp[i].target.dispatchEvent(new PointerEvent("pointerup", { pointerId: 100 + i, pointerType: "touch", isPrimary: i === 0, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, composed: true }))), [at(1)]);
  }
  await pacedWait(page, 250);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

for (const engine of ["chromium", "webkit"]) {
  const browser = engine === "chromium"
    ? await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] })
    : await webkit.launch({});
  const tag = `[${engine === "webkit" ? "WebKit" : "Chromium"}]`;

  // 1. bare paper, one finger, up-left
  {
    const env = await open(browser, { touch: true, engine });
    const r = await matRect(env.page);
    const p = { x: r.l + r.w * 0.5, y: r.t + r.h * 0.55 };
    const v0 = await readView(env.page);
    await touchDrive(env, [p], [{ x: p.x - 60, y: p.y - 150 }]);
    const v1 = await readView(env.page);
    ok(`${tag} one finger on bare paper pans by the finger's travel (60 left, 150 up)`, v0 && v1 && near(v1.x - v0.x, 60, 3) && near(v1.y - v0.y, 150, 3), `Δview ${(v1.x - v0.x).toFixed(1)},${(v1.y - v0.y).toFixed(1)}`);
    ok(`${tag} …zoom untouched`, v1.z === v0.z);
    await env.ctx.close();
  }
  // 2. on the grey outside the sheet (fresh page: the earlier pan moved the sheet)
  {
    const env = await open(browser, { touch: true, engine });
    const r = await matRect(env.page);
    const g = await env.page.evaluate(([l, t, w, h]) => {
      for (let x = l + 2; x < l + w * 0.5; x += 3) {
        const el = document.elementFromPoint(x, t + h * 0.5);
        if (el && !el.closest('[data-testid="note-sheet"]') && el.closest('[data-testid="note-mat"]')) return { x, y: t + h * 0.5 };
      }
      return null;
    }, [r.l, r.t, r.w, r.h]);
    if (!g) console.log(`- ${tag} no grey strip beside the sheet at this width — grey arm not exercisable, NOT scored`);
    else {
      const v2 = await readView(env.page);
      await touchDrive(env, [g], [{ x: g.x + 40, y: g.y + 80 }]);
      const v3 = await readView(env.page);
      ok(`${tag} one finger on the grey pans too`, near(v2.x - v3.x, 40, 3) && near(v2.y - v3.y, 80, 3), `Δ ${(v2.x - v3.x).toFixed(1)},${(v2.y - v3.y).toFixed(1)}`);
    }
    await env.ctx.close();
  }
  {
    const env = await open(browser, { touch: true, engine });
    const r = await matRect(env.page);
    // 3. starting on the text of an UNSELECTED box pans
    const bx = await env.page.evaluate(() => { const b = document.querySelector(".planyr-anchor"); const r = b.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.6, sel: b.getAttribute("data-selected") }; });
    const v4 = await readView(env.page);
    await touchDrive(env, [bx], [{ x: bx.x - 30, y: bx.y + 50 }]);
    const v5 = await readView(env.page);
    ok(`${tag} a drag starting on an unselected box's text pans`, !bx.sel && near(v5.x - v4.x, 30, 3) && near(v5.y - v4.y, -50, 3), `Δ ${(v5.x - v4.x).toFixed(1)},${(v5.y - v4.y).toFixed(1)}`);
    // 4. a wobble inside the slop is a tap, not a pan
    const q = { x: r.l + r.w * 0.5, y: r.t + r.h * 0.7 };
    const v6 = await readView(env.page);
    await touchDrive(env, [q], [{ x: q.x + 4, y: q.y + 3 }], { steps: 2, holdMs: 40 });
    const v7 = await readView(env.page);
    ok(`${tag} a wobble inside the slop does not pan`, v6.x === v7.x && v6.y === v7.y);
    await env.ctx.close();
  }

  // 5. pinch with a moving midpoint zooms AND follows
  {
    const env = await open(browser, { touch: true, engine });
    const r = await matRect(env.page);
    const c = { x: r.l + r.w * 0.5, y: r.t + r.h * 0.5 };
    const v0 = await readView(env.page);
    const s = [{ x: c.x - 40, y: c.y }, { x: c.x + 40, y: c.y }];
    const e = [{ x: c.x - 80 + 50, y: c.y - 20 }, { x: c.x + 80 + 50, y: c.y - 20 }];   // spread x2, midpoint +50,-20
    await touchDrive(env, s, e, { steps: 10 });
    const v1 = await readView(env.page);
    const mid0 = { x: c.x - r.l, y: c.y - r.t };
    const mid1 = { x: c.x + 50 - r.l, y: c.y - 20 - r.t };
    const w0 = { x: (mid0.x + v0.x) / v0.z, y: (mid0.y + v0.y) / v0.z };
    const back = { x: w0.x * v1.z - v1.x, y: w0.y * v1.z - v1.y };
    ok(`${tag} pinch zooms by the spread (about x2)`, near(v1.z / v0.z, 2, 0.15), `z ${v0.z.toFixed(2)} → ${v1.z.toFixed(2)}`);
    ok(`${tag} …and the point under the starting midpoint follows the moving midpoint`, near(back.x, mid1.x, 3) && near(back.y, mid1.y, 3), `want ${mid1.x.toFixed(0)},${mid1.y.toFixed(0)} got ${back.x.toFixed(0)},${back.y.toFixed(0)}`);
    await env.ctx.close();
  }

  // 6. a selected box's drag is NOT turned into a pan
  {
    const env = await open(browser, { touch: true, engine });
    await env.page.evaluate(() => { const b = document.querySelector(".planyr-anchor"); b.setAttribute("data-selected", "1"); });
    const bx = await env.page.evaluate(() => { const r = document.querySelector(".planyr-anchor").getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.6 }; });
    const v0 = await readView(env.page);
    await touchDrive(env, [bx], [{ x: bx.x - 40, y: bx.y + 60 }]);
    const v1 = await readView(env.page);
    ok(`${tag} a drag starting on a SELECTED box does not pan the page`, v0.x === v1.x && v0.y === v1.y);
    await env.ctx.close();
  }

  // 7. a stray native scroll is folded into the view and reset (visual position unchanged)
  {
    const env = await open(browser, { touch: true, engine });
    for (let i = 0; i < 6; i += 1) { await env.page.keyboard.press("Control+Equal"); await pacedWait(env.page, 60); }
    await pacedWait(env.page, 300);
    const out = await env.page.evaluate(async () => {
      const mat = document.querySelector('[data-testid="note-mat"]');
      const ws = document.querySelector('[data-testid="note-workspace"]');
      const sheet = document.querySelector('[data-testid="note-sheet"]');
      const tr = () => { const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(ws.style.transform); return { x: -parseFloat(m[1]), y: -parseFloat(m[2]) }; };
      const before = { v: tr(), left: sheet.getBoundingClientRect().left };
      mat.scrollLeft = 33; mat.scrollTop = 20;
      const got = { l: mat.scrollLeft, t: mat.scrollTop };
      const shifted = sheet.getBoundingClientRect().left;
      await new Promise((r) => setTimeout(r, 120));
      return { before, got, shifted, after: { v: tr(), sl: mat.scrollLeft, st: mat.scrollTop, left: sheet.getBoundingClientRect().left } };
    });
    if (out.got.l === 0 && out.got.t === 0) {
      console.log(`- ${tag} the mat cannot be scrolled programmatically here (no overflow) — fold arm not exercisable, NOT scored`);
    } else {
      ok(`${tag} a stray mat scroll is reset to 0`, out.after.sl === 0 && out.after.st === 0, JSON.stringify(out.after));
      ok(`${tag} …and folded into the view (the page does not jump back)`, near(out.after.v.x - out.before.v.x, out.got.l, 1) && near(out.after.left, out.shifted, 1), JSON.stringify(out));
    }
    await env.ctx.close();
  }

  // 8. inertia: a flick (no hold) carries on beyond the finger's own travel, then stops
  {
    const env = await open(browser, { touch: true, engine });
    const r = await matRect(env.page);
    const p = { x: r.l + r.w * 0.5, y: r.t + r.h * 0.55 };
    const v0 = await readView(env.page);
    await touchDrive(env, [p], [{ x: p.x, y: p.y - 120 }], { steps: 6, holdMs: 0 });
    const v1 = await readView(env.page);
    await pacedWait(env.page, 1800);
    const v2 = await readView(env.page);
    await pacedWait(env.page, 500);
    const v3 = await readView(env.page);
    ok(`${tag} a flick keeps going a little after lift, then stops`, (v2.y - v0.y) > (v1.y - v0.y) + 4 && v3.y === v2.y, `at lift ${(v1.y - v0.y).toFixed(0)} → settled ${(v2.y - v0.y).toFixed(0)}`);
    await env.ctx.close();
  }

  // known-good: the desktop mouse path still pans (so the reader sees a pan at all)
  if (engine === "chromium") {
    const env = await open(browser, { touch: false, engine });
    const r = await matRect(env.page);
    const p = { x: r.l + r.w * 0.5, y: r.t + r.h * 0.6 };
    const v0 = await readView(env.page);
    await env.page.mouse.move(p.x, p.y); await env.page.mouse.down();
    await env.page.mouse.move(p.x - 50, p.y - 90, { steps: 8 }); await env.page.mouse.up();
    await pacedWait(env.page, 200);
    const v1 = await readView(env.page);
    ok(`KNOWN-GOOD: a MOUSE drag on bare paper still pans (desktop path unchanged)`, near(v1.x - v0.x, 50, 3) && near(v1.y - v0.y, 90, 3), `Δ ${(v1.x - v0.x).toFixed(1)},${(v1.y - v0.y).toFixed(1)}`);
    await env.ctx.close();
  }
  await browser.close();
}

console.log(failures.length ? `\n⛔ ${failures.length} failed` : "\n✓ all touch pan arms pass");
process.exit(failures.length ? 1 : 0);
