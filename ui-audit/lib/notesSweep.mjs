/* notesSweep — remove the throwaway Notes pages a LIVE signed-in check leaves behind, and PROVE they are gone from the page list AND the Bin
 * (owner rule 15: test artifacts are always cleared, never asked about; delete-must-verify). A phone hides the page list behind a Back
 * button, so a phone run's own cleanup cannot always reach it — this opens a DESKTOP-width session of its own (one signed-in browser at a
 * time: call it after the phone session is closed) and deletes by TITLE.
 *
 * What counts as ours: titles starting "ZZ throwaway" (what the harnesses name their pages) and "Recovered — W" (the page the app itself
 * salvages when a placement test's lone typed "W" outlives its page). Everything else in the Bin belongs to someone else and is never touched.
 * Returns { pagesLeft, binLeft } — both must be 0. */
import { openSignedIn } from "./signedInSession.mjs";

export const MINE = /^(ZZ throwaway|Recovered — W$)/;

export async function sweepNotesThrowaways({ base = "https://planyr.io", log = console.log } = {}) {
  let s = null;
  for (let i = 0; i < 12 && !s; i++) {
    try { s = await openSignedIn({ base, viewport: { width: 1400, height: 900 } }); }
    catch (e) { if (!/answered 5\d\d|Failed to fetch/.test(String(e))) throw e; await new Promise((r) => setTimeout(r, 20000)); }
  }
  if (!s) throw new Error("notesSweep: could not sign in");
  const p = s.page;
  try {
    await p.goto(`${base}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
    await p.waitForSelector('[data-testid="notes-view-bin"]', { timeout: 45000 });
    await p.waitForTimeout(2500);
    const rowTitles = () => p.evaluate(() => [...document.querySelectorAll('[data-testid^="notes-row-"]')].map((r) => r.innerText.split("\n")[0].trim()));
    for (let guard = 0; guard < 30; guard++) {
      const idx = (await rowTitles()).findIndex((t) => MINE.test(t));
      if (idx < 0) break;
      const row = p.locator('[data-testid^="notes-row-"]').nth(idx);
      await row.click({ button: "right" }); await p.waitForTimeout(300);
      await p.locator('[data-testid^="notes-menu-"]', { hasText: /^Delete/ }).first().click(); await p.waitForTimeout(800);
      const yes = p.locator('button[aria-label*="Confirm" i], button:has-text("✓")').first();
      if (await yes.count()) { await yes.click(); await p.waitForTimeout(1200); }
    }
    const pagesLeft = (await rowTitles()).filter((t) => MINE.test(t)).length;
    await p.locator('[data-testid="notes-view-bin"]').click(); await p.waitForTimeout(1500);
    const binTitles = () => p.evaluate(() => [...document.querySelectorAll('[data-testid^="notes-bin-tr_"]')].map((e) => ({ id: e.dataset.testid.replace("notes-bin-", ""), t: e.innerText.split("\n")[0].trim() })));
    for (let guard = 0; guard < 40; guard++) {
      const m = (await binTitles()).find((r) => MINE.test(r.t));
      if (!m) break;
      await p.locator(`[data-testid="notes-bin-purge-${m.id}"]`).click(); await p.waitForTimeout(500);
      const yes = p.locator('button[aria-label*="Confirm" i], button:has-text("✓"), button:has-text("Delete forever")').last();
      if (await p.locator(`[data-testid="notes-bin-purge-${m.id}"]`).count() && await yes.count()) await yes.click().catch(() => {});
      await p.waitForTimeout(900);
    }
    const binLeft = (await binTitles()).filter((r) => MINE.test(r.t)).length;
    log(`notesSweep: throwaway pages left in the list ${pagesLeft}, in the Bin ${binLeft}`);
    return { pagesLeft, binLeft };
  } finally { await s.close(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = (process.argv.find((a, i) => i > 1 && a.startsWith("http")) || "https://planyr.io").replace(/\/$/, "");
  const r = await sweepNotesThrowaways({ base });
  process.exit(r.pagesLeft === 0 && r.binLeft === 0 ? 0 : 1);
}
