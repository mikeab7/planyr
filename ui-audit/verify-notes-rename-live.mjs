/* verify-notes-rename-live — A RENAME IS VISIBLE IMMEDIATELY, AND IT IS ON DISK IMMEDIATELY.
 *
 * ⛔ THE REPORT: *"rename a loose page from 'Untitled page' to 'PROBE13 TITLE'. The stored tree
 * updated immediately and correctly, but the sidebar list under NOT IN A PROJECT no longer
 * showed the note at all — it listed only 'Recovered — ...'. After a reload the renamed note
 * was back in the list in the right place."*
 *
 * ⛔ AND HIS CAVEAT, WHICH IS THE REASON THIS HARNESS USES `page.keyboard`: he drove the rename
 * with a synthetic `input` event on a controlled React input, which may not take the same
 * re-render path a real keystroke does. Every rename below is typed with the real keyboard.
 *
 * ⛔ WHAT IT MEASURES, and why the second half is the one that matters. The rail is fed from
 * React state and the SYNC is fed from localStorage — two readers of one tree. The workspace
 * wrote the tree on a 400 ms debounce, so for that window the two disagreed, and every reader
 * of the disk copy (the sync's seed, its push, another window) saw a tree with the rename
 * missing. A reader that then writes what it read — which is exactly what adopting the
 * account's tree does — destroys the edit and takes the row off the rail with it.
 *
 * So: the row must be right at once (what he SEES), and the disk must be right at once (what
 * every other reader of that tree gets). The second is the invariant; the first is the symptom.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const checks = [];
const ok = (name, cond, extra = "") => {
  checks.push({ name, pass: !!cond });
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const REMOTE = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--ignore-certificate-errors", ...(REMOTE && PROXY ? [`--proxy-server=${PROXY}`] : [])],
});

const TREE_KEY = "planyr:notes:tree:v1:local";
const pageErrors = [];

/** The titles the RAIL is showing, in order — what he was looking at. */
const railTitles = (page) => page.evaluate(() =>
  [...document.querySelectorAll('[data-testid^="notes-row-"]')]
    .map((el) => el.innerText.replace(/\s+/g, " ").trim())
    .filter(Boolean));

/** The titles ON DISK — what the sync, the push, and every other window read. */
const storedTitles = (page) => page.evaluate((k) => {
  const t = JSON.parse(localStorage.getItem(k) || "null");
  return (t?.pages || []).map((p) => String(p.title ?? ""));
}, TREE_KEY);

/** ⛔ HIS PAGE: two loose notes, one of them the "Recovered — …" that was the only survivor. */
async function seedTwo(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="notes-tree"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await pacedWait(page, 200);
  await page.evaluate((k) => {
    localStorage.clear();
    localStorage.setItem(k, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [
        { id: "p_probe", title: "Untitled page", createdAt: 1, updatedAt: 1, projectId: null, pages: [] },
        { id: "p_rec", title: "Recovered — 3 blocks", createdAt: 2, updatedAt: 2, projectId: null, pages: [] },
      ],
    }));
  }, TREE_KEY);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-title"]', { timeout: 20000 });
  await pacedWait(page, 500);
}

async function run(label, { width, height }) {
  console.log(`\n${label}`);
  const ctx = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${label}: ${e.message}`));
  await assertMeasurable(page, "verify-notes-rename-live");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await seedTwo(page);

  /* The precondition, asserted rather than assumed — a check that passes because the fixture
   * was wrong has already happened twice in this module. */
  const before = await railTitles(page);
  ok(`${label} · the fixture really is two loose notes on the rail`,
    before.length === 2 && before.some((t) => t.includes("Untitled")) && before.some((t) => t.includes("Recovered")),
    JSON.stringify(before));

  await page.locator('[data-testid="notes-row-p_probe"]').first().click();
  await pacedWait(page, 300);

  /* ---- 1. A REAL KEYSTROKE RENAME ------------------------------------------------------ */
  const field = page.locator('[data-testid="note-title"]');
  await field.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Delete");
  await page.keyboard.type("PROBE13 TITLE", { delay: 25 });

  /* ⛔ READ WITHIN THE WINDOW. The old write was on a 400 ms debounce, so a reading taken a
   * second later would find the disk caught up and report a pass it did not earn. One frame
   * is what a sync tick, a sibling window, or a push actually gets. */
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const diskNow = await storedTitles(page);
  const railNow = await railTitles(page);

  ok(`${label} · the RAIL shows the new name at once, and still shows BOTH notes`,
    railNow.length === 2 && railNow.some((t) => t.includes("PROBE13")) && railNow.some((t) => t.includes("Recovered")),
    JSON.stringify(railNow));

  ok(`${label} · ⛔ THE DISK HAS THE RENAME WITHIN A FRAME — no window in which a reader gets a stale tree`,
    diskNow.includes("PROBE13 TITLE"),
    JSON.stringify(diskNow));

  ok(`${label} · …and the other note is still on disk beside it`,
    diskNow.some((t) => t.startsWith("Recovered")), JSON.stringify(diskNow));

  /* ---- 2. THE READER'S VIEW IS THE ONE THE SCREEN SHOWS -------------------------------- */
  /* This is the invariant the vanish came out of: a reader that re-reads the disk copy and
   * hands it back to the workspace must not be able to take anything off the rail. Modelled
   * exactly as the sync does it — read the tree, put it straight back. */
  await page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    localStorage.setItem(k, raw);          // a byte-identical round trip through the seam
  }, TREE_KEY);
  await pacedWait(page, 300);
  const railAfter = await railTitles(page);
  ok(`${label} · ⛔ A RE-READ OF THE STORED TREE STILL DESCRIBES WHAT IS ON SCREEN`,
    railAfter.length === 2 && railAfter.some((t) => t.includes("PROBE13")),
    JSON.stringify(railAfter));

  /* ---- 3. THE SAME FOR A NEW PAGE, WHICH IS THE COSTLIER LOSS -------------------------- */
  await page.locator('[data-testid="notes-new-page"]').first().click().catch(() => {});
  await pacedWait(page, 250);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const diskAdd = await storedTitles(page);
  const railAdd = await railTitles(page);
  ok(`${label} · ⛔ A NEW PAGE IS ON DISK WITHIN A FRAME TOO`,
    diskAdd.length === railAdd.length && diskAdd.length === 3,
    `disk ${diskAdd.length} · rail ${railAdd.length}`);

  /* ---- 4. AND A DELETE, THE OTHER DIRECTION -------------------------------------------- */
  const railTitlesNow = await railTitles(page);
  ok(`${label} · nothing was lost across the whole sequence`,
    railTitlesNow.some((t) => t.includes("PROBE13")) && railTitlesNow.some((t) => t.includes("Recovered")),
    JSON.stringify(railTitlesNow));

  await ctx.close();
}

await run("A · a full window", { width: 1500, height: 950 });
await run("B · a SHORT window, which is his", { width: 1280, height: 520 });

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || "clean");

const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
await browser.close();
if (passed !== checks.length) process.exit(1);
