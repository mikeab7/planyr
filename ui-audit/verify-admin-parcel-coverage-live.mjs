/* verify-admin-parcel-coverage-live — V1696128: the admin parcel-coverage map on the DEPLOYED build.
 *
 * Signs in as the throwaway test account through the deploy's own e2e-session route (the account stays NON-admin),
 * MOCKS the `is_admin` RPC true (and every admin_* RPC to an empty answer) exactly as verify-admin-surfaces.mjs
 * does, opens #/admin/parcel-coverage on the real planyr.io bundle and asserts:
 *   · the served build matches <expected-sha> (read from /version.json IN THIS RUN, with the served chunk names)
 *   · no developer "not drawn" text; the summary reads "…Plus 2 with city-level parcels only."
 *   · a laptop window shows the WHOLE map under the header with no scrolling
 *   · a plain wheel over the map is never preventDefault'ed and scrolls the page down AND back up (short window)
 *   · Ctrl+wheel zooms (prevented); Reset restores the whole US
 *   · hover shows a tooltip at the cursor; a zero-movement click opens the card (Harris known-good arm; Wayne MI
 *     reads "City of Detroit parcels available"); Esc closes; a drag pans and opens nothing
 *
 * Run:  E2E_LOGIN_KEY=… node ui-audit/verify-admin-parcel-coverage-live.mjs https://planyr.io <expected-sha>
 * Nothing is created, so there is nothing to clean up. */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const base = (process.argv[2] || "https://planyr.io").replace(/\/$/, "");
const expected = process.argv[3] || "";
const key = process.env.E2E_LOGIN_KEY;
if (!key) throw new Error("E2E_LOGIN_KEY not set");

const fails = [];
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) fails.push(name); };

const res = await fetch(base + "/api/auth/e2e-session", { method: "POST", headers: { "x-e2e-login-key": key } });
if (res.status !== 200) throw new Error("e2e-session " + res.status);
const tokens = await res.json();

const exe = existsSync(chromium.executablePath()) ? undefined : process.env.PW_CHROME || "/opt/pw-browsers/chromium";
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || exe, args: ["--no-sandbox"] });

async function open(viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.route("**/rest/v1/rpc/*", async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    if (name === "is_admin") return route.fulfill({ status: 200, contentType: "application/json", body: "true" });
    if (name.startsWith("admin_")) return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    return route.continue();
  });
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.pfSupabase, null, { timeout: 30000 });
  const err = await page.evaluate(async (t) => (await window.pfSupabase.auth.setSession({ access_token: t.access_token, refresh_token: t.refresh_token })).error?.message || null, tokens);
  if (err) throw new Error("setSession: " + err);
  await page.waitForTimeout(3500);
  await page.goto(base + "/#/admin/parcel-coverage", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="parcel-coverage-map"] path', { timeout: 60000 });
  await assertMeasurable(page, "verify-admin-parcel-coverage-live");
  return { ctx, page };
}

const mainBox = (page) => page.locator('[data-testid="admin-main"]').boundingBox();
const tf = (page) => page.locator('[data-testid="parcel-coverage-viewport"]').getAttribute("transform");

try {
  // ── laptop window ─────────────────────────────────────────────────────────
  {
    const { ctx, page } = await open({ width: 1440, height: 800 });
    const served = await page.evaluate(async () => ({
      build: (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build,
      chunks: [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src").split("/").pop()).slice(0, 6),
    }));
    console.log(`served build ${served.build}; chunks ${served.chunks.join(", ")}`);
    check(`served build matches ${expected || "(none given)"}`, !expected || served.build === expected.slice(0, served.build.length) || expected.startsWith(served.build), served.build);

    const body = await page.evaluate(() => document.body.innerText);
    check("no developer 'not drawn' text", !/not drawn|wired entries/i.test(body));
    const total = (await page.locator('[data-testid="parcel-coverage-total"]').textContent()).trim();
    check("summary line carries the city-level count", /Plus 2 with city-level parcels only\.$/.test(total), total);
    check("wired counts still sum", (() => { const n = [...total.matchAll(/(\d[\d,]*) (?:on the|on a|unclassified)/g)].map((m) => +m[1].replace(/,/g, "")); const t = +total.match(/^([\d,]+) counties/)[1].replace(/,/g, ""); return n.reduce((a, b) => a + b, 0) === t; })(), total);

    const fb = await page.locator('[data-testid="parcel-coverage-frame"]').boundingBox();
    const mb = await mainBox(page);
    check("the WHOLE map is under the header + legend, no scrolling", fb.y >= mb.y && fb.y + fb.height <= mb.y + mb.height + 1, `map ${Math.round(fb.y)}-${Math.round(fb.y + fb.height)} in main ${Math.round(mb.y)}-${Math.round(mb.y + mb.height)}`);

    // hover + click: Harris (known-good arm), then Wayne MI. Row index = position in the county roster the page itself fetched.
    const roster = await page.evaluate(() => fetch("/geo/county-polygons.json").then((r) => r.json()).then((j) => j.counties.map((c) => [c.state, c.name])));
    const indexOf = (st, nm) => roster.findIndex(([s2, n2]) => s2 === st && n2 === nm);
    const pointIn = async (idx) => {
      for (let attempt = 0; attempt < 16; attempt++) {
        const hit = await page.evaluate((i) => {
          const p = document.querySelector(`path[data-i="${i}"]`);
          const rect = p.getBoundingClientRect();
          if (rect.width < 40 || rect.height < 40) return { center: [rect.x + rect.width / 2, rect.y + rect.height / 2] };
          const b = p.getBBox(), m = p.getScreenCTM(), found = [];
          for (let a = 0; a <= 24; a++) for (let c = 0; c <= 24; c++) {
            const pt = new DOMPoint(b.x + (b.width * a) / 24, b.y + (b.height * c) / 24);
            if (!p.isPointInFill(pt)) continue;
            const sp = pt.matrixTransform(m);
            if (sp.x < 24 || sp.y < 24 || sp.x > innerWidth - 24 || sp.y > innerHeight - 24) continue;
            if (document.elementFromPoint(sp.x, sp.y) === p) found.push([sp.x, sp.y]);
          }
          return found.length ? found[Math.floor(found.length / 2)] : { center: [rect.x + rect.width / 2, rect.y + rect.height / 2] };
        }, idx);
        if (Array.isArray(hit)) return hit;
        await page.mouse.move(hit.center[0], hit.center[1]);
        await page.keyboard.down("Control"); await page.mouse.wheel(0, -350); await page.keyboard.up("Control");
        await page.waitForTimeout(120);
      }
      return null;
    };
    const card = page.locator('[data-testid="parcel-coverage-card"]');
    const probe = async (st, nm) => {
      await page.getByRole("button", { name: "Reset map view" }).click(); await page.waitForTimeout(100);
      const pt = await pointIn(indexOf(st, nm));
      if (!pt) return null;
      await page.mouse.move(pt[0] - 3, pt[1] - 3); await page.mouse.move(pt[0], pt[1], { steps: 3 }); await page.waitForTimeout(120);
      const tip = (await page.locator('[data-testid="parcel-coverage-tooltip"]').textContent().catch(() => "")) || "";
      await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(200); // zero movement
      const text = (await card.textContent().catch(() => "")) || "";
      return { tip, text };
    };
    const h = await probe("TX", "Harris");
    check("hover tooltip names Harris County and its coverage", !!h && /Harris County, TX/.test(h.tip) && /County's own server/.test(h.tip), h && h.tip);
    check("click opens the Harris card (known-good arm)", !!h && /Harris County, TX/.test(h.text) && /County's own server/.test(h.text) && /www\.gis\.hctx\.net/.test(h.text) && /harris/.test(h.text) && /https:\/\//.test(h.text), h && h.text.slice(0, 160));
    if (!h || !/County's own server/.test(h.text)) { console.log("VOID — Harris known-good arm did not hold"); process.exitCode = 2; }
    await page.keyboard.press("Escape");
    check("Esc closes the card", (await card.count()) === 0);
    const w = await probe("MI", "Wayne County");
    check("Wayne County card reads City of Detroit parcels available", !!w && /Wayne County, MI/.test(w.text) && /City of Detroit parcels available/.test(w.text), w && w.text.slice(0, 160));
    await page.keyboard.press("Escape");
    await ctx.close();
  }

  // ── short window: the wheel ───────────────────────────────────────────────
  {
    const { ctx, page } = await open({ width: 1280, height: 450 });
    await page.evaluate(() => {
      window.__w = [];
      document.addEventListener("wheel", (e) => setTimeout(() => window.__w.push({ ctrl: e.ctrlKey, prevented: e.defaultPrevented }), 0), true);
    });
    const main = page.locator('[data-testid="admin-main"]');
    const fb = await page.locator('[data-testid="parcel-coverage-frame"]').boundingBox();
    const mb = await mainBox(page);
    await page.mouse.move(fb.x + fb.width / 2, Math.min(fb.y + fb.height / 2, mb.y + mb.height - 40));
    const t0 = await tf(page);
    await page.mouse.wheel(0, 300); await page.waitForTimeout(200);
    const down = await main.evaluate((m) => m.scrollTop);
    check("hint appears on the first plain wheel", (await page.locator('[data-testid="parcel-coverage-hint"]').count()) === 1);
    check("plain wheel DOWN scrolls the page", down > 0, `scrollTop ${down}`);
    await page.mouse.wheel(0, -300); await page.waitForTimeout(200);
    const up = await main.evaluate((m) => m.scrollTop);
    check("plain wheel UP scrolls the page back (not stuck)", up < down, `${down} -> ${up}`);
    check("plain wheel never zoomed the map", (await tf(page)) === t0);
    const ev = await page.evaluate(() => window.__w);
    check("no plain wheel event was prevented", ev.length > 0 && ev.every((e) => !e.prevented), JSON.stringify(ev));
    await page.evaluate(() => { window.__w = []; });
    await page.keyboard.down("Control"); await page.mouse.wheel(0, -300); await page.keyboard.up("Control"); await page.waitForTimeout(200);
    const ev2 = await page.evaluate(() => window.__w);
    check("Ctrl+wheel zooms and is handled by the map", (await tf(page)) !== t0 && ev2.length > 0 && ev2.every((e) => e.ctrl && e.prevented), JSON.stringify(ev2));
    // drag pans, opens nothing
    const b2 = await page.locator('[data-testid="parcel-coverage-map"]').boundingBox();
    const cx = Math.max(b2.x + 40, Math.min(b2.x + b2.width / 2, mb.x + mb.width - 40)), cy = Math.max(mb.y + 40, Math.min(b2.y + b2.height / 2, mb.y + mb.height - 40));
    const z = await tf(page);
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 60, cy + 30, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(150);
    check("a drag pans the zoomed map", (await tf(page)) !== z);
    check("a drag opens no card", (await page.locator('[data-testid="parcel-coverage-card"]').count()) === 0);
    await page.getByRole("button", { name: "Reset map view" }).click();
    check("Reset restores the whole US", (await tf(page)) === "translate(0 0) scale(1)");
    await ctx.close();
  }
} finally {
  await browser.close();
}
if (process.exitCode === 2) process.exit(2);
console.log(fails.length ? `\nFAILED: ${fails.join("; ")}` : "\nALL PASS");
process.exit(fails.length ? 1 : 0);
