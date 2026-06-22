/* B380 regression guard — the embedded Schedule module must render its FULL action
 * toolbar, not just the in-grid Columns button.
 *
 * The Schedule module embeds the standalone sequence app in an iframe. The shell's
 * Row-1 breadcrumb takes over project navigation, so the sequence app hides its own
 * duplicated nav (logo + Dashboard/Projects toggle + project picker) when `.in-iframe`.
 * A regression once hid the ENTIRE `.app-header`, which silently removed every tool
 * (view switch, zoom, export, contacts, automation, settings, version history) and left
 * only the floating Columns button above the grid.
 *
 * This harness drives the real app (vite preview) headless and asserts:
 *   1. the sequence toolbar (.app-header) is VISIBLE inside the iframe;
 *   2. the duplicated nav (logo / mode / project) is HIDDEN (the shell provides it);
 *   3. the action controls render + are visible (Export, Save, History, Contacts,
 *      Automation, Settings, View switcher);
 *   4. they actually WORK, not just render: switching to Gantt reveals the zoom
 *      controls, zoom-in changes the zoom %, and Contacts toggles its panel open;
 *   5. the in-grid Columns button still exists (we didn't break the grid).
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
page.on("console", (m) => { if (m.type() === "error") console.log("  [console.error]", m.text().slice(0, 160)); });

// Find the same-origin sequence iframe + wait for it to become interactive.
const seqFrame = async () => page.frames().find((f) => f.url().includes("/sequence/"));

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[title^="All projects —"]', { timeout: 15000 });

  // ── Switch to the Schedule module ──
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Schedule");
    if (tab) tab.click();
  });

  // Wait for the iframe to mount + its toolbar to render.
  let frame = null;
  for (let i = 0; i < 40; i++) {
    frame = await seqFrame();
    if (frame) {
      const ready = await frame.evaluate(() => !!document.querySelector(".app-header .hdr-actions")).catch(() => false);
      if (ready) break;
    }
    await page.waitForTimeout(500);
  }
  if (!frame) throw new Error("sequence iframe never appeared");
  await frame.evaluate(() => new Promise((r) => setTimeout(r, 400)));

  // Helper run INSIDE the iframe: report visibility of the toolbar + each control.
  const probe = () => frame.evaluate(() => {
    const seen = (el) => {
      if (!el) return false;
      const cs = getComputedStyle(el);
      return cs.display !== "none" && cs.visibility !== "hidden" && el.getClientRects().length > 0;
    };
    const byTitlePrefix = (p) => [...document.querySelectorAll("button[title]")].find((b) => b.getAttribute("title").startsWith(p));
    const header = document.querySelector(".app-header");
    return {
      headerVisible: seen(header),
      // Hidden (shell provides these):
      logoHidden: !seen(document.querySelector(".app-header .hdr-logo")),
      modeHidden: !seen(document.querySelector(".app-header .hdr-mode")),
      projectHidden: !seen(document.querySelector(".app-header .hdr-project")),
      // Visible action controls:
      viewSwitcher: seen(document.querySelector(".app-header .hdr-view")),
      actions: seen(document.querySelector(".app-header .hdr-actions")),
      contacts: seen(document.querySelector('button[title="Contacts"]')),
      automation: seen(document.querySelector('button[title="Automation rules"]')),
      settings: seen(document.querySelector('button[title="Settings"]')),
      history: seen(document.querySelector('[data-testid="open-history-desktop"]')),
      export: seen(byTitlePrefix("Export")),
      // Sanity — the in-grid Columns button (the ONE thing the regression left visible).
      columns: [...document.querySelectorAll("button")].some((b) => /Columns/.test(b.innerText) && seen(b)),
    };
  });

  const p = await probe();
  ok("Sequence toolbar (.app-header) is visible inside the iframe", p.headerVisible);
  ok("Duplicated nav is hidden — logo", p.logoHidden);
  ok("Duplicated nav is hidden — Dashboard/Projects toggle", p.modeHidden);
  ok("Duplicated nav is hidden — project picker", p.projectHidden);
  ok("View switcher (Grid/Split/Gantt) renders", p.viewSwitcher);
  ok("Action group renders", p.actions);
  ok("Contacts control renders", p.contacts);
  ok("Automation control renders", p.automation);
  ok("Settings control renders", p.settings);
  ok("Version History control renders", p.history);
  ok("Export (PDF/print exhibit) control renders", p.export);

  // ── Sanity: the in-grid Columns button (the ONE thing the regression left visible)
  //    only renders in Grid/Split view, so select Grid explicitly first. ──
  await frame.evaluate(() => {
    const v = document.querySelector(".app-header .hdr-view");
    const grid = v && [...v.querySelectorAll("button")].find((b) => b.innerText.trim() === "Grid");
    if (grid) grid.click();
  });
  await page.waitForTimeout(400);
  // NB: the button has text-transform:uppercase, and Chromium's innerText reflects the
  // rendered (uppercased) text — so match case-insensitively.
  const columns = await frame.evaluate(() =>
    [...document.querySelectorAll("button")].some((b) => /columns/i.test(b.innerText)
      && getComputedStyle(b).display !== "none" && b.getClientRects().length > 0));
  ok("In-grid Columns button still present (grid not broken)", columns);

  // ── Functional: switching to Gantt reveals the timeline zoom controls ──
  await frame.evaluate(() => {
    const v = document.querySelector(".app-header .hdr-view");
    const gantt = v && [...v.querySelectorAll("button")].find((b) => b.innerText.trim() === "Gantt");
    if (gantt) gantt.click();
  });
  await page.waitForTimeout(400);
  const zoom = await frame.evaluate(() => {
    const seen = (el) => el && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0;
    const out = document.querySelector('button[title="Zoom out"]');
    const inn = document.querySelector('button[title="Zoom in"]');
    return { out: seen(out), in: seen(inn) };
  });
  ok("Switching to Gantt reveals the timeline zoom controls (handler works)", zoom.out && zoom.in);

  // Zoom-in must actually change the zoom % (not a silent no-op).
  const readPct = () => frame.evaluate(() => {
    const inn = document.querySelector('button[title="Zoom in"]');
    const sib = inn && inn.parentElement && [...inn.parentElement.querySelectorAll("span")].find((s) => /%$/.test(s.innerText));
    return sib ? sib.innerText.trim() : null;
  });
  const before = await readPct();
  await frame.evaluate(() => { const b = document.querySelector('button[title="Zoom in"]'); if (b) b.click(); });
  await page.waitForTimeout(250);
  const after = await readPct();
  ok("Zoom-in changes the zoom % (control is wired, not a no-op)", before && after && before !== after, `${before} -> ${after}`);

  // ── Functional: Contacts toggles its panel open (handler works) ──
  await frame.evaluate(() => { const b = document.querySelector('button[title="Contacts"]'); if (b) b.click(); });
  await page.waitForTimeout(300);
  const contactsOpen = await frame.evaluate(() => {
    const b = document.querySelector('button[title="Contacts"]');
    const active = b && /\bact\b/.test(b.className);
    const panel = /\d+\s+contact/i.test(document.body.innerText) || /No contacts yet/i.test(document.body.innerText);
    return active || panel;
  });
  ok("Contacts opens its panel (handler works, not a no-op)", contactsOpen);
} catch (e) {
  console.log("HARNESS ERROR:", e.message);
} finally {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  await browser.close();
  process.exit(passed === results.length && results.length >= 14 ? 0 : 1);
}
