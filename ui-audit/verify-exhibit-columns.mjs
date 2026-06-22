/* B390 / B391 / B392 — PDF / Print Exhibit table-layout fixes, verified end-to-end in a
 * real headless browser against the live Scheduler.
 *
 * The Schedule module embeds the sequence app in an iframe; its "Export" header action
 * opens the PDF/Print Exhibit modal, whose WYSIWYG preview is itself a (blob:) iframe —
 * so this drives page → sequence iframe → preview iframe and asserts, on the REAL rendered
 * exhibit:
 *   B390  the Start / End / Duration cells are NOT truncated (full value visible, no
 *         ellipsis clip) and the Task-Name column no longer hogs a giant dead gap — the
 *         Gantt keeps a real share of the width;
 *   B391  the Gantt timeline draws year-boundary divider lines (multi-year seed data);
 *   B392  dragging a column's header handle resizes it live, and the new width round-trips
 *         through the parent (persists into a re-rendered preview).
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("  [console.error]", m.text().slice(0, 160)); });

const seqFrame = () => page.frames().find((f) => f.url().includes("/sequence/"));
const blobFrames = () => page.frames().filter((f) => f.url().startsWith("blob:"));

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[title^="All projects —"]', { timeout: 20000 });

  // ── Open the Schedule module ──
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Schedule");
    if (tab) tab.click();
  });
  // Wait for the iframe to mount AND the lifted toolbar to render in the SHELL header. B388
  // lifted the Schedule action toolbar (incl. Export) up into the shell's Row-2 header and
  // hides the embedded app's own toolbar, so the Export control now lives in the parent page.
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
  if (!frame) throw new Error("sequence iframe never became interactive");
  await page.waitForTimeout(500);

  // ── Open the PDF / Print Exhibit modal: shell Export action → dropdown → menu item. The
  //    dropdown is shell-side now; the chosen item posts planar:export to the iframe, which
  //    opens the modal whose preview is the blob: iframe probed below. ──
  const menuOpened = await page.evaluate(() => {
    const h = document.querySelector("header");
    const b = h && [...h.querySelectorAll("button[title]")].find((x) => x.getAttribute("title").startsWith("Export"));
    if (b) { b.click(); return true; }
    return false;
  });
  await page.waitForTimeout(300);
  const opened = menuOpened && await page.evaluate(() => {
    const item = [...document.querySelectorAll("div,span,button")].find((e) => e.textContent.trim() === "PDF / Print Exhibit" && e.getClientRects().length > 0);
    const click = item && (item.closest("[role='menuitem'],[style*='cursor'],button") || item.parentElement || item);
    if (click) { click.click(); return true; }
    return false;
  });
  ok("Export → PDF / Print Exhibit opens the exhibit modal", opened);

  // ── Wait for the preview (blob:) iframe to render its split exhibit ──
  let blob = null;
  for (let i = 0; i < 50; i++) {
    blob = blobFrames()[0];
    if (blob && await blob.evaluate(() => !!document.querySelector(".split-table thead th[data-k]")).catch(() => false)) break;
    await page.waitForTimeout(300);
  }
  if (!blob) throw new Error("exhibit preview iframe never rendered the split table");
  // Let pagination + fonts settle so widths are final.
  await page.waitForTimeout(900);
  blob = blobFrames()[0];

  // ── Probe the rendered exhibit ──
  const probe = () => blob.evaluate(() => {
    const ths = [...document.querySelectorAll(".split-table thead th[data-k]")];
    const thW = (k) => { const t = ths.find((x) => x.getAttribute("data-k") === k); return t ? Math.round(t.getBoundingClientRect().width) : 0; };
    // A cell is visually clipped (ellipsis) when its content overflows its box.
    const cells = (sel) => [...document.querySelectorAll(sel)].map((c) => ({ txt: c.textContent.trim(), trunc: c.scrollWidth > c.clientWidth + 1 }));
    const st = document.querySelector(".split-table");
    const sg = document.querySelector(".split-gantt");
    const svg = document.querySelector(".split-gantt svg");
    return {
      cols: ths.map((t) => t.getAttribute("data-k")),
      starts: cells(".split-table td.c-start"),
      ends: cells(".split-table td.c-end"),
      durs: cells(".split-table td.c-duration"),
      nameW: thW("name"), startW: thW("start"),
      tableW: st ? Math.round(st.getBoundingClientRect().width) : 0,
      ganttW: sg ? Math.round(sg.getBoundingClientRect().width) : 0,
      yearLine: svg ? /stroke="#7b8290"/.test(svg.innerHTML) : false,
      handle: !!document.querySelector('.split-table thead th[data-k="start"] .col-rs'),
    };
  });
  const p = await probe();
  console.log(`  columns: [${p.cols.join(", ")}]  name=${p.nameW}px start=${p.startW}px table=${p.tableW}px gantt=${p.ganttW}px  (${p.starts.length} date rows)`);

  // B390 — dates / durations are not clipped, and full MM/DD/YY is shown.
  const dateOk = (arr) => arr.length > 0 && arr.every((c) => !c.trunc) && arr.some((c) => /^\d\d\/\d\d\/\d\d$/.test(c.txt));
  ok("B390 — Start dates render in full, no ellipsis clip", dateOk(p.starts), p.starts.slice(0, 3).map((c) => `${c.txt}${c.trunc ? "✂" : ""}`).join(" "));
  ok("B390 — End dates render in full, no ellipsis clip", dateOk(p.ends), p.ends.slice(0, 3).map((c) => `${c.txt}${c.trunc ? "✂" : ""}`).join(" "));
  ok("B390 — Duration cells render in full, no ellipsis clip", p.durs.length > 0 && p.durs.every((c) => !c.trunc), p.durs.slice(0, 4).map((c) => `${c.txt}${c.trunc ? "✂" : ""}`).join(" "));
  // B390 — no giant Task-Name gap: the name column is content-capped (≤ ~285) and the
  // Gantt still gets a meaningful share of the page (not crushed by a runaway table).
  ok("B390 — Task-Name column is content-capped (no runaway gap)", p.nameW > 0 && p.nameW <= 286, `name=${p.nameW}px`);
  ok("B390 — Gantt keeps a real share of the width (table not hogging)", p.ganttW >= 235, `gantt=${p.ganttW}px`);

  // B391 — year-boundary dividers present (seed schedule spans 2026→2027).
  ok("B391 — Gantt draws year-boundary divider lines", p.yearLine);

  // B392 — a resize handle exists, drags live, and the new width round-trips/persists.
  ok("B392 — column resize handles are present in the preview", p.handle);
  const baselineStart = p.startW;
  const drag = await blob.evaluate(() => {
    const th = () => document.querySelector('.split-table thead th[data-k="start"]');
    const handle = th() && th().querySelector(".col-rs");
    if (!handle) return { ok: false };
    const fire = (type, x, target) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 28 }));
    const before = Math.round(th().getBoundingClientRect().width);
    const x0 = Math.round(th().getBoundingClientRect().right);
    fire("mousedown", x0, handle);
    fire("mousemove", x0 + 34, document);
    fire("mousemove", x0 + 34, document);
    const mid = Math.round(th().getBoundingClientRect().width);
    fire("mouseup", x0 + 34, document);
    return { ok: true, before, mid };
  });
  ok("B392 — dragging the handle widens the column live", drag.ok && drag.mid > drag.before + 10, `${drag.before}px → ${drag.mid}px`);

  // Persistence round-trip: the parent receives the new width and re-renders the preview
  // with the override baked in (Start clearly wider than its original auto-fit baseline).
  let persisted = false, seenW = 0;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(300);
    for (const bf of blobFrames()) {
      const w = await bf.evaluate(() => {
        const t = document.querySelector('.split-table thead th[data-k="start"]');
        return t ? Math.round(t.getBoundingClientRect().width) : 0;
      }).catch(() => 0);
      if (w >= baselineStart + 12) { persisted = true; seenW = w; break; }
    }
    if (persisted) break;
  }
  ok("B392 — the dragged width round-trips through the parent (persisted)", persisted, `baseline=${baselineStart}px → re-rendered=${seenW}px`);
} catch (e) {
  console.log("HARNESS ERROR:", e.message);
} finally {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  await browser.close();
  process.exit(passed === results.length && results.length >= 9 ? 0 : 1);
}
