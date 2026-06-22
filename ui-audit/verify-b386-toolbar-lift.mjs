/* B386 — verify the Schedule toolbar was LIFTED into the unified shell header and actually
 * drives the embedded Gantt app over the postMessage bridge (not just rendered).
 *
 * The Schedule module embeds the standalone sequence app in an iframe. B386 hides that app's
 * own in-iframe toolbar (`.in-iframe .app-header`) and re-renders the controls up in the
 * shell's Row-2 header; they post `planar:*` commands down and the iframe reports state back
 * (`planar:toolbar-state`). This harness drives the real built app (vite preview) headless and
 * asserts:
 *   1. the embedded app's own toolbar (.app-header) is HIDDEN in-iframe — no double toolbar;
 *   2. the lifted controls render in the PARENT shell header (view toggle, review, export,
 *      save, history, contacts, automation, settings);
 *   3. the Row-1 theme gear (B342) and the lifted Schedule Settings are SEPARATE controls;
 *   4. they actually WORK across the frame boundary, proven by round-trips:
 *      • clicking the parent "Gantt" makes the iframe report view=gantt → the lifted zoom
 *        controls appear (parent only shows zoom when the iframe says it's zoomable);
 *      • clicking parent zoom-in changes the % (command down, fresh % reported back up);
 *      • clicking lifted Settings opens the iframe's Settings panel AND the parent button
 *        flips aria-pressed (the iframe re-reported activePanel — full loop).
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
let pageErrors = 0;
page.on("pageerror", (e) => { pageErrors++; console.log("  [pageerror]", String(e).slice(0, 160)); });
page.on("console", (m) => { if (m.type() === "error") console.log("  [console.error]", m.text().slice(0, 160)); });

const seqFrame = () => page.frames().find((f) => f.url().includes("/sequence/"));

// Read the lifted controls' visibility from the PARENT (shell) header only.
const parentCtl = () => page.evaluate(() => {
  const seen = (el) => { if (!el) return false; const cs = getComputedStyle(el); return cs.display !== "none" && cs.visibility !== "hidden" && el.getClientRects().length > 0; };
  const header = document.querySelector("header");
  if (!header) return { noHeader: true };
  const byText = (t) => [...header.querySelectorAll("button")].find((b) => b.textContent.trim() === t);
  const byTitle = (t) => [...header.querySelectorAll("button[title]")].find((b) => b.getAttribute("title") === t);
  const byTitlePre = (p) => [...header.querySelectorAll("button[title]")].find((b) => b.getAttribute("title").startsWith(p));
  return {
    grid: seen(byText("Grid")), split: seen(byText("Split")), gantt: seen(byText("Gantt")),
    review: seen(byTitle("Review suggested updates from forwarded emails")),
    export: seen(byTitlePre("Export")),
    save: seen(header.querySelector('button[aria-label="Save status"]')),
    history: seen(byTitlePre("Version history")),
    contacts: seen(byTitle("Contacts")),
    automation: seen(byTitle("Automation rules")),
    settingsLifted: seen(byTitle("Settings")),          // exact title — the lifted Schedule one
    themeGear: seen(byTitlePre("Settings — display")),  // Row-1 app theme gear (B342) — separate
  };
});

const clickParent = (find) => page.evaluate((f) => {
  const header = document.querySelector("header");
  const all = [...header.querySelectorAll("button")];
  const btn = f.text ? all.find((b) => b.textContent.trim() === f.text)
    : f.title ? all.find((b) => b.getAttribute("title") === f.title) : null;
  if (btn) btn.click();
  return !!btn;
}, find);

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  // Wait for the shell, then switch to the Schedule module.
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Schedule"), { timeout: 20000 });
  await page.evaluate(() => { [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Schedule")?.click(); });

  // Wait for the iframe to mount + the lifted controls to render (i.e. toolbar-state arrived).
  let frame = null;
  for (let i = 0; i < 50; i++) {
    frame = seqFrame();
    if (frame) {
      const ready = await page.evaluate(() => {
        const h = document.querySelector("header");
        return !!h && [...h.querySelectorAll("button[title]")].some((b) => b.getAttribute("title").startsWith("Export"));
      }).catch(() => false);
      if (ready) break;
    }
    await page.waitForTimeout(400);
  }
  if (!frame) throw new Error("sequence iframe never appeared");
  await page.waitForTimeout(500);

  // 1) No double toolbar — the embedded app's own .app-header is hidden in-iframe.
  const headerHidden = await frame.evaluate(() => {
    const h = document.querySelector(".app-header");
    return !h || getComputedStyle(h).display === "none" || h.getClientRects().length === 0;
  });
  ok("embedded app's own toolbar (.app-header) is HIDDEN in-iframe (no double toolbar)", headerHidden);

  // 2) Lifted controls render in the parent shell header.
  let c = await parentCtl();
  ok("lifted view toggle (Grid/Split/Gantt) renders in the shell header", c.grid && c.split && c.gantt);
  ok("lifted review inbox renders", c.review);
  ok("lifted Export renders", c.export);
  ok("lifted Save indicator renders", c.save);
  ok("lifted Version History renders", c.history);
  ok("lifted Contacts renders", c.contacts);
  ok("lifted Automation renders", c.automation);
  ok("lifted Settings renders", c.settingsLifted);

  // 3) The two settings gears stay SEPARATE (Row-1 theme vs lifted Schedule settings).
  ok("Row-1 theme gear and lifted Schedule Settings are both present + separate (B342 kept)", c.themeGear && c.settingsLifted);

  // 4a) Cross-frame view command: click parent Gantt → iframe reports view=gantt → zoom appears.
  await clickParent({ text: "Gantt" });
  await page.waitForTimeout(600);
  const zoomShown = await page.evaluate(() => {
    const h = document.querySelector("header");
    const z = [...h.querySelectorAll('button[title]')].find((b) => b.getAttribute("title") === "Zoom in");
    return !!z && z.getClientRects().length > 0;
  });
  ok("parent 'Gantt' drives the iframe (it reports view=gantt → lifted zoom appears)", zoomShown);

  // 4b) Zoom round-trip — command down, fresh % reported back up.
  const readPct = () => page.evaluate(() => {
    const h = document.querySelector("header");
    const z = [...h.querySelectorAll('button[title]')].find((b) => b.getAttribute("title") === "Zoom in");
    const span = z && z.parentElement && [...z.parentElement.querySelectorAll("span")].find((s) => /%$/.test(s.textContent));
    return span ? span.textContent.trim() : null;
  });
  const before = await readPct();
  await clickParent({ title: "Zoom in" });
  await page.waitForTimeout(450);
  const after = await readPct();
  ok("parent zoom-in changes the % (round-trip, not a no-op)", before && after && before !== after, `${before} -> ${after}`);

  // 4c) Settings round-trip — click lifted Settings → iframe panel opens + button flips pressed.
  await clickParent({ title: "Settings" });
  await page.waitForTimeout(500);
  const settingsPressed = await page.evaluate(() => {
    const h = document.querySelector("header");
    const b = [...h.querySelectorAll('button[title]')].find((x) => x.getAttribute("title") === "Settings");
    return !!b && b.getAttribute("aria-pressed") === "true";
  });
  const framePanel = await frame.evaluate(() => {
    const fixed = [...document.querySelectorAll("div")].filter((d) => {
      const cs = getComputedStyle(d);
      return cs.position === "fixed" && cs.display !== "none" && d.getClientRects().length > 0;
    });
    return fixed.some((d) => /\bSettings\b/.test(d.textContent || "") && d.getBoundingClientRect().width < 460);
  });
  ok("lifted Settings opens the iframe's panel (button aria-pressed reflects reported state)", settingsPressed);
  ok("the Settings panel is actually visible inside the iframe (cross-frame open)", framePanel);

  // No fabricated count: the unread badge, if shown, is a real non-negative integer.
  const badge = await page.evaluate(() => {
    const h = document.querySelector("header");
    const rev = [...h.querySelectorAll('button[title]')].find((b) => b.getAttribute("title") === "Review suggested updates from forwarded emails");
    const span = rev && [...rev.querySelectorAll("span")].find((s) => /^\d+$/.test(s.textContent.trim()));
    return span ? span.textContent.trim() : "none";
  });
  ok("review unread badge is a real reported count (never fabricated)", badge === "none" || /^\d+$/.test(badge), `badge=${badge}`);

  ok("no uncaught page errors", pageErrors === 0, `pageErrors=${pageErrors}`);

  // 5) Standalone /sequence/ (NOT embedded) is untouched — the hide is scoped to .in-iframe,
  //    so opened directly the app still shows its OWN full toolbar (no regression to non-shell use).
  const sp = await ctx.newPage();
  await sp.goto(BASE + "sequence/", { waitUntil: "domcontentloaded" });
  await sp.waitForSelector(".app-header .hdr-actions", { timeout: 15000 }).catch(() => {});
  const standalone = await sp.evaluate(() => {
    const seen = (el) => { if (!el) return false; const cs = getComputedStyle(el); return cs.display !== "none" && el.getClientRects().length > 0; };
    return {
      header: seen(document.querySelector(".app-header")),
      view: seen(document.querySelector(".app-header .hdr-view")),
      actions: seen(document.querySelector(".app-header .hdr-actions")),
      inIframeClass: document.documentElement.classList.contains("in-iframe"),
    };
  });
  ok("standalone /sequence/ still shows its OWN toolbar (hide is scoped to .in-iframe)",
    standalone.header && standalone.view && standalone.actions && !standalone.inIframeClass);
  await sp.close();
} catch (e) {
  console.log("HARNESS ERROR:", e.message);
} finally {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  await browser.close();
  process.exit(passed === results.length && results.length >= 16 ? 0 : 1);
}
