/* B463922 — THE ROW YOU ARE WORKING ON MUST HOLD ITS PLACE ON SCREEN WHEN THE LIST RE-LAYS OUT.
 *
 * The verdict quantity is RENDERED POSITION — the anchor row's `getBoundingClientRect().top`
 * expressed relative to the scroll container, keyed on the row's IDENTITY, before and after each
 * action. Never `scrollTop`: that number moves on plenty of actions where the picture does not, and
 * holds still on some where it does.
 *
 * ⛔ EVERY CLICK GOES THROUGH `visibleClick`, AND THAT IS THE POINT. The predecessor of this file
 * clicked a collapse toggle that the virtualiser had rendered 75px ABOVE the viewport; Playwright
 * scrolled the container to reach it (through CDP, invisible to a patched scrollTop setter) and the
 * harness reported that scroll as the app throwing the edited row 477px down the screen, with
 * "programmatic writes: 0" as corroboration. Clicking only what a human could actually see is what
 * makes these numbers the product's. `lib/visibleClick.mjs` holds the three measurements that
 * settled it.
 *
 * ⛔ AND EVERY STEP CARRIES TWO WITNESSES, because this file's family of failures is the vacuous
 * green: the MODEL must have changed (the list got shorter or longer), and the SELECTION must still
 * be on the row we think is being edited — a click that lands on a row instead of its 13px toggle
 * silently moves the selection, and then the harness measures a row nobody is editing and reports
 * calm. Both were caught happening while this file was being written.
 *
 * Run:  node ui-audit/verify-grid-row-hold.mjs      [PW_CHROME=<chrome>]
 * Exit 0 = every anchor held. Exit 1 = a real jump, a vacuous step, or a wandering selection.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";
import { visibleClick, installScrollWitness, targetVisibility } from "./lib/visibleClick.mjs";

const TOL = 2;                       // px the anchor row may move on screen
const GRID = '[data-grid-scroll="1"]';
const ROOT = new URL("../public/", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

await ensureVendored();
const server = createServer(async (req, res) => {
  try {
    if (await serveVendored(req, res)) return;
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (p.endsWith("sequence/index.html")) body = Buffer.from(rewriteCdn(body.toString("utf8")));
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
/* A background tab cannot be measured: rAF is suspended, so a view change updates state while the
   picture never repaints and every geometry read describes a view the app already left. */
await assertMeasurable(page, "verify-grid-row-hold");
page.on("pageerror", e => console.log("  [pageerror]", e.message.slice(0, 160)));

const failures = [];
const line = s => console.log(s);

async function boot() {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await installScrollWitness(page, GRID);
  await page.evaluate(sel => {
    const g = document.querySelector(sel); window.__g = g;
    window.__rowTop = id => { const r = document.querySelector(`[data-task-row="${id}"]`); if (!r) return null;
      return Math.round(r.getBoundingClientRect().top - g.getBoundingClientRect().top); };
    // The model witness: the spacer's height tracks how many rows the flat list holds.
    window.__listLen = () => Math.round(g.scrollHeight);
    // The selection witness: the focused row is the one wearing the blue left border.
    window.__selRow = () => { const r = document.querySelector('.drow[style*="var(--blue)"]');
      return r ? r.getAttribute("data-task-row") : null; };
    /* The step witness. It has to watch the SELECTED row, not the top one: indenting changes one
       row's indent, Tab changes only which cell is active, and an undo changes one row's text —
       a witness watching the list length alone is blind to every one of them and reports a
       vacuous pass. */
    window.__witness = () => {
      const r = document.querySelector('.drow[style*="var(--blue)"]');
      const name = r ? r.children[1] : null;
      const active = [...document.querySelectorAll('.drow > div')].findIndex(d => (d.getAttribute("style")||"").includes("inset 0 0 0 2px"));
      return { len: Math.round(g.scrollHeight), row: r ? r.getAttribute("data-task-row") : null,
               text: r ? r.innerText : null, indent: name ? getComputedStyle(name.firstElementChild || name).paddingLeft : null,
               active };
    };
    window.__topRow = () => { const gr = g.getBoundingClientRect();
      for (const r of document.querySelectorAll("[data-task-row]")) { const b = r.getBoundingClientRect();
        if (b.top >= gr.top + 34) return r.getAttribute("data-task-row"); } return null; };
    // Rows carrying an expand/collapse toggle, with where each sits in the container's viewport.
    window.__toggles = title => { const gr = g.getBoundingClientRect();
      return [...document.querySelectorAll(`[data-task-row] span[title="${title}"]`)].map(t => {
        const r = t.getBoundingClientRect();
        return { row: t.closest("[data-task-row]").getAttribute("data-task-row"), top: Math.round(r.top - gr.top),
                 visible: r.top > gr.top + 40 && r.bottom < gr.bottom - 40 };
      }); };
  }, GRID);
  await page.evaluate(() => { window.__g.scrollTop = Math.floor(window.__g.scrollHeight / 2); });
  await pacedWait(page, 450);
}

/** A leaf row comfortably inside the viewport — "the row he is editing". */
const midRow = () => page.evaluate(() => {
  const g = window.__g, gr = g.getBoundingClientRect();
  const rows = [...document.querySelectorAll("[data-task-row]")].filter(r => {
    const b = r.getBoundingClientRect();
    return b.top > gr.top + 200 && b.bottom < gr.bottom - 200 && r.querySelector("[data-health-dot]");
  });
  return rows.length ? rows[Math.floor(rows.length / 2)].getAttribute("data-task-row") : null;
});

async function selectRow(id) {
  await page.locator(`[data-task-row="${id}"] > div`).nth(1).click();
  await pacedWait(page, 300);
  const sel = await page.evaluate(() => window.__selRow());
  if (sel !== String(id)) { failures.push(`could not select row ${id} — the grid says ${sel}`); line(`  ✗ selection did not land on row ${id} (it is on ${sel})`); }
  return sel;
}

/** The closest VISIBLE toggle row sitting above `aboveTop` px in the container's viewport. */
async function pickToggleRow(title, aboveTop) {
  const ts = await page.evaluate(t => window.__toggles(t), title);
  const cand = ts.filter(t => t.visible && (aboveTop === null || t.top < aboveTop - 20));
  return cand.length ? cand[cand.length - 1].row : null;
}

async function clickToggle(rowId, title) {
  if (!rowId) return false;
  const tog = page.locator(`[data-task-row="${rowId}"] span[title="${title}"]`);
  const v = await targetVisibility(page, GRID, tog);
  if (!v.visible) return false;
  await visibleClick(page, GRID, tog, `${title} toggle on row ${rowId}`);
  return true;
}

async function step(label, anchorId, expectSel, act) {
  await page.evaluate(() => { window.__scrollWitness.writes.length = 0; });
  const before = await page.evaluate(i => ({ top: window.__rowTop(i), len: window.__listLen(), sel: window.__selRow() }), anchorId);
  const ok = await act();
  if (ok === false) { failures.push(`${label}: could not drive it (no visible target)`); line(`  ✗ ${label} — no visible target to drive`); return; }
  await pacedWait(page, 600);
  const after = await page.evaluate(i => ({ top: window.__rowTop(i), len: window.__listLen(), sel: window.__selRow() }), anchorId);
  const writes = await page.evaluate(() => window.__scrollWitness.writes.slice());
  if (after.len === before.len) {
    failures.push(`${label}: NOTHING CHANGED — the step did nothing, so its calm proves nothing`);
    line(`  ✗ ${label} — ⚠ the model did not change; a vacuous pass is not a pass`);
    return;
  }
  if (expectSel && after.sel !== String(expectSel)) {
    failures.push(`${label}: the selection moved (${before.sel} → ${after.sel}) — the step drove the wrong thing`);
    line(`  ✗ ${label} — the selection moved to ${after.sel}; this step is measuring a row nobody is editing`);
    return;
  }
  if (after.top === null) {
    failures.push(`${label}: the anchor row left the rendered window entirely`);
    line(`  ✗ ${label} — the anchor row is no longer rendered (the view left it)`);
    return;
  }
  const d = after.top - before.top;
  const pass = Math.abs(d) <= TOL;
  if (!pass) failures.push(`${label}: the anchor row moved ${d}px on screen (budget ±${TOL})`);
  line(`  ${pass ? "✓" : "✗"} ${label}`);
  line(`      anchor row ${anchorId}: ${before.top}px → ${after.top}px  (Δ ${d >= 0 ? "+" : ""}${d}px, budget ±${TOL})` +
       `   list height ${before.len} → ${after.len}   app scroll writes ${writes.length}`);
}

// ───────────────────────────────────────────────────────────────────────────────
line("\nB463922 — does the row you are working on hold its place when the list re-lays out?\n");

// 1. A group ABOVE the edited row collapses, then expands again, then a second one collapses.
await boot();
let ROW = await midRow();
await selectRow(ROW);
let rowTop = await page.evaluate(i => window.__rowTop(i), ROW);
line(`editing row ${ROW}, on screen at ${rowTop}px from the top of the grid`);
const g1 = await pickToggleRow("Collapse", rowTop);
await step(`collapse group ${g1}, ABOVE the row being edited`, ROW, ROW, () => clickToggle(g1, "Collapse"));
await step(`expand group ${g1} again`, ROW, ROW, () => clickToggle(g1, "Expand"));
rowTop = await page.evaluate(i => window.__rowTop(i), ROW);
const g2 = await pickToggleRow("Collapse", rowTop);
await step(`collapse a second group (${g2}) above it`, ROW, ROW, () => clickToggle(g2, "Collapse"));

// 2. Nothing selected: the top of the view is what must hold.
await boot();
const TOP = await page.evaluate(() => window.__topRow());
const g3 = await pickToggleRow("Collapse", null);
line(`\nnothing selected — the row at the top of the view is ${TOP}`);
await step(`collapse group ${g3} with nothing selected`, TOP, null, () => clickToggle(g3, "Collapse"));

// 3. The anchor row itself is collapsed away — the view holds on its surviving parent.
await boot();
ROW = await midRow();
await selectRow(ROW);
const PARENT = await page.evaluate(id => {
  const rows = [...document.querySelectorAll("[data-task-row]")];
  const i = rows.findIndex(r => r.getAttribute("data-task-row") === id);
  for (let k = i - 1; k >= 0; k--) if (rows[k].querySelector('span[title="Collapse"]')) return rows[k].getAttribute("data-task-row");
  return null;
}, ROW);
line(`\nediting row ${ROW}; collapsing its enclosing group ${PARENT} hides the row being edited`);
await step(`collapse the group the edited row lives in (${PARENT})`, PARENT, null, () => clickToggle(PARENT, "Collapse"));

/* 4. THE PATHS THE PREVIOUS SESSION NEVER ACTUALLY DROVE. Its run reported seven of them "steady"
   while its own witness said NOTHING CHANGED — they no-opped because the selection was lost after
   the grid re-rendered and every keystroke went nowhere. Here each one re-selects first, and the
   witness is widened: the list length, the anchor row's TEXT, or the selection itself must move,
   or the step is reported as proving nothing. The invariant asserted is the view's: the row at the
   top of the viewport must not move. */
line("\nthe keyboard paths the earlier run never actually drove:");
await boot();
ROW = await midRow();
await selectRow(ROW);

async function keyStep(label, fn, { expectModel = true } = {}) {
  const sel = await page.evaluate(() => window.__selRow());
  if (sel !== String(ROW)) await selectRow(ROW);           // re-arm, or the keystroke goes nowhere
  const top = await page.evaluate(() => window.__topRow());
  const before = await page.evaluate(i => ({ top: window.__rowTop(i), w: window.__witness() }), top);
  await fn();
  await pacedWait(page, 700);
  const after = await page.evaluate(i => ({ top: window.__rowTop(i), w: window.__witness() }), top);
  const changed = JSON.stringify(before.w) !== JSON.stringify(after.w);
  if (!changed && expectModel) {
    failures.push(`${label}: NOTHING CHANGED — driven, but it did nothing, so its calm proves nothing`);
    line(`  ✗ ${label} — ⚠ nothing changed; this path is still unproven`);
    return;
  }
  if (after.top === null) {
    failures.push(`${label}: the row at the top of the view left the rendered window`);
    line(`  ✗ ${label} — the view left the row it was showing`);
    return;
  }
  const d = after.top - before.top;
  const pass = Math.abs(d) <= TOL;
  if (!pass) failures.push(`${label}: the view moved ${d}px (top row ${top})`);
  line(`  ${pass ? "✓" : "✗"} ${label} — top-of-view row ${top}: Δ ${d >= 0 ? "+" : ""}${d}px (budget ±${TOL})`);
}

await keyStep("insert a row above the selection", () => page.keyboard.press("Insert"));
await keyStep("undo the insert", () => page.keyboard.press("Control+z"));
/* Outdent FIRST, then indent back: a row that is already the first child of its group has no
   previous sibling to become a child of, so an indent there legitimately does nothing — and a
   step that legitimately does nothing can never be told apart from one that is broken. */
await keyStep("outdent the row (Alt+Shift+Left)", () => page.keyboard.press("Alt+Shift+ArrowLeft"));
await keyStep("indent it back (Alt+Shift+Right)", () => page.keyboard.press("Alt+Shift+ArrowRight"));
await keyStep("edit the start date (Enter commits)", async () => {
  await page.locator(`[data-task-row="${ROW}"] > div`).nth(2).click(); await pacedWait(page, 200);
  await page.keyboard.press("Control+a").catch(() => {});
  await page.keyboard.type("1/2/26", { delay: 20 }); await page.keyboard.press("Enter");
});
await keyStep("undo that edit", () => page.keyboard.press("Control+z"));
await keyStep("redo it", () => page.keyboard.press("Control+y"));
await keyStep("Tab across six columns", async () => { for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); await pacedWait(page, 90); } });

/* 5. THE GUARD'S OWN MUTATION PROOF, run every time so it cannot rot green: aim `visibleClick` at
   the exact target the old harness clicked — the first toggle the virtualiser renders, which sits
   ABOVE the viewport — and require it to REFUSE. A guard nobody has seen fail is not a guard. */
await boot();
const buffered = await page.evaluate(() => (window.__toggles("Collapse")[0] || null));
if (!buffered || buffered.visible) {
  failures.push("self-test: the virtualiser rendered no off-screen toggle, so the refusal path went unexercised");
  line(`\n  ✗ self-test — no buffered off-screen toggle to aim at; the refusal path proved nothing`);
} else {
  let threw = null;
  try { await visibleClick(page, GRID, page.locator(`[data-task-row="${buffered.row}"] span[title="Collapse"]`), "buffered toggle"); }
  catch (e) { threw = e.message; }
  if (threw) line(`\n  ✓ self-test — visibleClick REFUSED the off-screen toggle on row ${buffered.row} (${buffered.top}px, above the view)`);
  else { failures.push("self-test: visibleClick clicked an OFF-SCREEN target — the whole file's numbers would be the driver's"); line(`\n  ✗ self-test — visibleClick allowed an off-screen click`); }
}

line("");
if (failures.length) { console.log(`FAIL — ${failures.length} problem(s):`); failures.forEach(f => console.log("  · " + f)); }
else console.log(`PASS — every anchor held its place on screen within ±${TOL}px, every step changed the model, and the selection never wandered.`);
await browser.close(); server.close();
process.exit(failures.length ? 1 : 0);
