/* verify-cursors-schedule.mjs — NEW-5 (B2426786) cursor convention, Schedule slice (docs/DESIGN.md "Cursor convention").
 * Reads getComputedStyle(elementFromPoint(x, y)).cursor — the cursor the browser would paint — at named states of the
 * scheduler page (public/sequence/index.html): idle · hover object · mid-gesture (mouse button HELD, pointer outside the grip)
 * · after release · disabled · busy.
 *
 *   node ui-audit/verify-cursors-schedule.mjs                     the working tree's public/sequence/index.html
 *   node ui-audit/verify-cursors-schedule.mjs https://planyr.io   the DEPLOYED bytes of that page (fetched + served locally —
 *                                                                 the sandbox browser cannot reach the edge, so the artifact is
 *                                                                 proven byte-for-byte, see lib/deployedTarget.mjs), then, when
 *                                                                 E2E_LOGIN_KEY is set, the same page INSIDE the signed-in app
 *                                                                 shell (iframe) on the deployed build, /version.json read in the
 *                                                                 same call.
 *
 * ⛔ A MID-DRAG READ IS TAKEN WITH THE BUTTON STILL DOWN (a reading after mouseup measures nothing about the drag), and at a
 * point OUTSIDE the grip that started it — the whole defect class is "the cursor flips back the moment the pointer leaves it".
 * ⛔ KNOWN-GOOD ARMS (expected independently of the code under test): a real <a href> reads pointer and plain text reads auto.
 * If either is wrong the run is VOID, not scored (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6). FOREGROUND-OR-VOID: assertMeasurable first.
 * Real mouse input only (SYNTHETIC-KEYS-DONT-EDIT): page.mouse / page.keyboard, never a dispatched event. */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { bootSchedule } from "./lib/scheduleStandalone.mjs";

const arg = process.argv[2] || "";
const BASE = /^https?:\/\//.test(arg) ? arg.replace(/\/$/, "") : null;
const DEPLOYED = BASE ? `${BASE}/sequence/` : null;

const results = [];
const check = (name, got, want) => {
  const ok = Array.isArray(want) ? want.includes(got) : got === want;
  results.push({ name, got, want, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  → ${got} (want ${Array.isArray(want) ? want.join(" | ") : want})`);
};

/** One scene = a Playwright Frame + the offset of that frame inside the page the mouse is on. */
async function runScene(label, page, frame, off = { x: 0, y: 0 }) {
  console.log(`\n── ${label} ──`);
  const cursorAt = (x, y) => frame.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? getComputedStyle(e).cursor : "NOHIT"; }, [x, y]);
  const tagAt = (x, y) => frame.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e ? e.tagName + (e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : "") : "NOHIT"; }, [x, y]);
  const mv = (x, y, o = {}) => page.mouse.move(x + off.x, y + off.y, o);
  const pinned = () => frame.evaluate(() => { const s = document.head.querySelector("style[data-pinned-cursor]"); return s ? s.getAttribute("data-pinned-cursor") : null; });
  const centre = (sel, nth = 0) => frame.evaluate(([sel, nth]) => {
    const el = document.querySelectorAll(sel)[nth]; if (!el) return null;
    el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, [sel, nth]);
  /** A point on the nth Gantt task row, INSIDE the visible pane (a row is wider than the viewport — its centre is off screen). */
  const ganttPt = (nth, dx = 160) => frame.evaluate(([nth, dx]) => {
    const pane = document.querySelector("[data-gantt-scroll]").getBoundingClientRect();
    const row = document.querySelectorAll("[data-gantt-row]")[nth]; if (!row) return null;
    const r = row.getBoundingClientRect(); return { x: pane.left + dx, y: r.top + r.height / 2 };
  }, [nth, dx]);
  const tasks = () => frame.evaluate(() => [...document.querySelectorAll("[data-task-row]")].map((r) => r.getAttribute("data-task-row")).join(","));

  // ── known-good arms ──
  await frame.evaluate(() => {
    const box = document.createElement("div"); box.id = "cur-arms";
    box.style.cssText = "position:fixed;left:4px;bottom:4px;z-index:2147483647;display:flex;gap:8px;background:#fff;padding:4px";
    box.innerHTML = '<a id="arm-link" href="#arm" style="display:inline-block;width:50px;height:20px">link</a><span id="arm-text" style="display:inline-block;width:50px;height:20px">text</span>'
      + '<button id="arm-dis" disabled style="cursor:pointer;width:50px;height:20px">dis</button>'
      + '<button id="arm-busy" disabled aria-busy="true" style="cursor:pointer;width:50px;height:20px">busy</button>'
      + '<button id="arm-on" style="cursor:pointer;width:50px;height:20px">on</button>'
      + '<input id="arm-check" type="checkbox" style="width:18px;height:18px"><input id="arm-check-dis" type="checkbox" disabled style="width:18px;height:18px">'
      + '<select id="arm-select" style="width:50px;height:20px"><option>a</option></select><input id="arm-range" type="range" style="width:70px;height:18px">';
    document.body.appendChild(box);
  });
  const armAt = async (id) => { const c = await centre(id); return c ? cursorAt(c.x, c.y) : "MISSING"; };
  const link = await armAt("#arm-link"), text = await armAt("#arm-text");
  if (link !== "pointer" || text !== "auto") { console.error(`VOID: known-good arms disagree (link=${link}, text=${text}) — this instrument cannot see cursors`); process.exit(2); }
  check("known-good: a real link", link, "pointer");
  check("known-good: plain text", text, "auto");

  // ── the page's own stylesheet half ──
  check("a DISABLED button with an inline `cursor: pointer` shows the arrow", await armAt("#arm-dis"), "default");
  check("a disabled + aria-busy button shows progress", await armAt("#arm-busy"), "progress");
  check("an enabled button keeps its pointer", await armAt("#arm-on"), "pointer");
  check("native checkbox → pointer", await armAt("#arm-check"), "pointer");
  check("native checkbox, disabled → default", await armAt("#arm-check-dis"), "default");
  check("native select → pointer", await armAt("#arm-select"), "pointer");
  check("native range → pointer", await armAt("#arm-range"), "pointer");
  await frame.evaluate(() => { document.getElementById("cur-arms").style.display = "none"; });

  // ── idle ──
  const nameCell = await centre('[data-task-row] [data-col-key="name"]', 3);
  check("idle: a grid cell rests on the arrow", await cursorAt(nameCell.x, nameCell.y), "default");
  const grip0 = await centre(".rowgrip", 3);
  check("idle: the row grip is a hand (grab)", await cursorAt(grip0.x, grip0.y), "grab");
  const hdr = await centre("[data-hdr-col]", 1);
  const hdrRs = await frame.evaluate(() => { const h = document.querySelectorAll("[data-hdr-col]")[1]; const r = h.getBoundingClientRect(); return { x: r.right - 2, y: r.top + r.height / 2, left: r.left, y2: r.top + r.height / 2 }; });
  check("idle: a column-resize edge is col-resize", await cursorAt(hdrRs.x, hdrRs.y), "col-resize");
  const gRow = await ganttPt(6);
  check("idle: a Gantt task row is the pan hand (grab)", await cursorAt(gRow.x, gRow.y), "grab");

  // ── row reorder: the grip, then over cells / the header / the Gantt — all grabbing, button still down ──
  const before = await tasks();
  await mv(grip0.x, grip0.y); await page.mouse.down();
  await mv(grip0.x + 3, grip0.y + 6, { steps: 3 });
  const cellT = await centre('[data-task-row] [data-col-key="name"]', 7);
  await mv(cellT.x, cellT.y, { steps: 5 });
  check("row drag: over another row's cell → grabbing", await cursorAt(cellT.x, cellT.y), "grabbing");
  check("row drag: the pin is on the page root", await pinned(), "grabbing");
  await mv(hdr.x, hdr.y, { steps: 4 });
  check("row drag: over the column-header row → grabbing", await cursorAt(hdr.x, hdr.y), "grabbing");
  const gRow2 = await ganttPt(8);
  await mv(gRow2.x, gRow2.y, { steps: 5 });
  check("row drag: over a Gantt row → grabbing", await cursorAt(gRow2.x, gRow2.y), "grabbing");
  await mv(grip0.x, grip0.y, { steps: 6 }); // back over its own row = a no-op drop
  await page.mouse.up(); await pacedWait(page, 150);
  check("row drag: released → the pin is gone", await pinned(), null);
  check("row drag: released → a cell is back on the arrow", await cursorAt(cellT.x, cellT.y), "default");
  // Escape mid-drag cancels the drop and releases
  await mv(grip0.x, grip0.y); await page.mouse.down(); await mv(cellT.x, cellT.y, { steps: 5 });
  check("row drag (Escape arm): pinned while held", await pinned(), "grabbing");
  await page.keyboard.press("Escape"); await pacedWait(page, 100);
  check("row drag: Escape releases the pin", await pinned(), null);
  await page.mouse.up(); await pacedWait(page, 200);
  check("row drag: nothing moved on a cancelled / no-op drag", await tasks(), before);

  // ── Gantt pan ──
  const gp = await ganttPt(10, 260);
  await mv(gp.x, gp.y); await page.mouse.down(); await mv(gp.x - 40, gp.y, { steps: 4 });
  check("Gantt pan: over a task row → grabbing", await cursorAt(gp.x - 40, gp.y), "grabbing");
  await page.mouse.up(); await pacedWait(page, 100);
  check("Gantt pan: released → the hand is open again (grab)", await cursorAt(gp.x - 40, gp.y), "grab");

  // ── cell drag-select (the UNVERIFIED claim, measured: crosshair stuck after mouseup on the pre-fix tree) ──
  const c1 = await centre('[data-task-row] [data-col-key="name"]', 4), c2 = await centre('[data-task-row] [data-col-key="name"]', 6);
  await mv(c1.x, c1.y); await page.mouse.down(); await mv(c2.x, c2.y, { steps: 5 });
  check("cell drag-select: mid-drag shows `cell` (range select), never crosshair", await cursorAt(c2.x, c2.y), "cell");
  await page.mouse.up(); await pacedWait(page, 100);
  check("cell drag-select: after mouseup the cursor is back on the arrow", await cursorAt(c2.x, c2.y), "default");
  await mv(c2.x + 6, c2.y);
  check("cell drag-select: …and stays there after the pointer moves", await cursorAt(c2.x + 6, c2.y), "default");
  await mv(c1.x, c1.y); await page.mouse.down(); await page.mouse.up(); await pacedWait(page, 80);
  check("plain click on a cell never leaves a drag cursor behind", await cursorAt(c1.x, c1.y), "default");

  // ── project-grid column resize: held outside the 6-wide edge ──
  const edge = await frame.evaluate(() => { const h = document.querySelectorAll("[data-hdr-col]")[2]; const r = h.getBoundingClientRect(); return { x: r.right - 3, y: r.top + r.height / 2 }; });
  await mv(edge.x, edge.y); await page.mouse.down(); await mv(edge.x + 60, edge.y + 120, { steps: 6 });
  check("column resize: pointer well outside the edge, over a body cell → col-resize", await cursorAt(edge.x + 60, edge.y + 120), "col-resize");
  await page.mouse.up(); await pacedWait(page, 100);
  check("column resize: released → arrow over a cell", await cursorAt(edge.x + 60, edge.y + 120), ["default", "grab"]);

  // ── desktop split divider (Snap mode jumps the divider away from the pointer) ──
  const div = await frame.evaluate(() => {
    const g = document.querySelector("[data-grid-scroll]"); const gr = g.getBoundingClientRect();
    return { x: gr.right + 1, y: gr.top + gr.height / 2, gantt: document.querySelector("[data-gantt-scroll]").getBoundingClientRect() };
  });
  check("idle: the split divider is col-resize", await cursorAt(div.x, div.y), "col-resize");
  await mv(div.x, div.y); await page.mouse.down(); await mv(div.x + 220, div.y, { steps: 8 });
  const cellUnder = await centre('[data-task-row] [data-col-key="name"]', 5);
  check("split divider drag: pointer away from the divider (over a grid cell) → col-resize", await cursorAt(cellUnder.x, cellUnder.y), "col-resize");
  check("split divider drag: pointer over the Gantt → col-resize", await cursorAt(div.x + 300, div.y), "col-resize");
  await page.mouse.up(); await pacedWait(page, 150);
  check("split divider: released → pin gone", await pinned(), null);

  // ── MasterView (the Dashboard section) ──
  await page.getByRole("button", { name: "Dashboard", exact: true }).first().click({ position: { x: 4, y: 4 }, trial: false }).catch(() => {});
  await pacedWait(page, 700);
  const hasMaster = await frame.evaluate(() => document.querySelectorAll("th").length > 3);
  if (!hasMaster) { console.log("  (Dashboard section not reachable here — MasterView arms skipped)"); } else {
    const th = (txt) => frame.evaluate((t) => { const h = [...document.querySelectorAll("th")].find((x) => x.textContent.trim().startsWith(t)); if (!h) return null; const r = h.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; }, txt);
    const sortable = await th("Task"), plain = await th("Parent Task");
    check("MasterView: a sortable header (click sorts) → pointer", await cursorAt(sortable.x, sortable.y), "pointer");
    check("MasterView: a reorder-only header → grab", await cursorAt(plain.x, plain.y), "grab");
    const td = (col) => frame.evaluate((c) => { const hs = [...document.querySelectorAll("th")]; const i = hs.findIndex((x) => x.textContent.trim().startsWith(c)); const row = document.querySelector("tbody tr:nth-child(3)"); const t = row && row.children[i]; if (!t) return null; const r = t.getBoundingClientRect(); return { x: r.left + 6, y: r.top + r.height / 2 }; }, col);
    for (const [col, want] of [["Task", "default"], ["Dur", "default"], ["Owner", "default"]]) {
      const p = await td(col); if (p) check(`MasterView: the ${col} cell at rest (Project grid parity) → arrow`, await cursorAt(p.x, p.y), want);
    }
    const rs = await frame.evaluate(() => { const h = [...document.querySelectorAll("th")].find((x) => x.textContent.trim().startsWith("Task")); const r = h.getBoundingClientRect(); return { x: r.right - 2, y: r.top + r.height / 2 }; });
    await mv(rs.x, rs.y); await page.mouse.down(); await mv(rs.x + 50, rs.y + 150, { steps: 6 });
    check("MasterView column resize: pointer outside the edge → col-resize", await cursorAt(rs.x + 50, rs.y + 150), "col-resize");
    await page.mouse.up(); await pacedWait(page, 100);
    check("MasterView column resize: released → pin gone", await pinned(), null);
  }
}

/** The React side: the boot overlay (ModuleLoader over the iframe) shows `progress` while the embedded scheduler is still loading.
 *  The iframe request is held for a few seconds so the overlay is on screen when it is read. */
async function runShellBoot(label, page, base) {
  console.log(`\n── ${label} ──`);
  await page.route("**/sequence/**", async (route) => { if (route.request().resourceType() === "document") await new Promise((r) => setTimeout(r, 6000)); await route.continue(); });
  await page.goto(`${base}/#/schedule`, { waitUntil: "load" });
  await page.waitForSelector('iframe[title="Sequence Planyr"]', { timeout: 40000 });
  await assertMeasurable(page, "verify-cursors-schedule (shell boot)");
  const at = await page.evaluate(() => { const e = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return e ? { cursor: getComputedStyle(e).cursor, tag: e.tagName } : null; });
  check("boot overlay (Sequence Planyr still assembling) → progress", at && at.cursor, "progress");
  await page.unroute("**/sequence/**");
}

if (DEPLOYED) {
  console.log(`target: ${DEPLOYED}`);
  try { const v = await (await fetch(`${BASE}/version.json`)).json(); console.log(`/version.json: ${JSON.stringify(v)}`); } catch (e) { console.log("(version.json unreadable: " + e.message + ")"); }
}
let fatal = null;
const s = await bootSchedule({ deployed: DEPLOYED });
try {
  await s.page.goto(s.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await s.page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(s.page, "verify-cursors-schedule");
  await pacedWait(s.page, 600);
  await runScene("standalone page", s.page, s.page);
} catch (e) { fatal = e; console.error("ERROR", e.stack || e.message); results.push({ ok: false, name: "run" }); }
await s.close();

const SHELL = process.env.SCHED_SHELL_URL || null;   // a locally served build of the whole app, e.g. `vite preview` — the React-side half
if (SHELL && !fatal) {
  const { chromium } = await import("playwright");
  const { existsSync } = await import("node:fs");
  const exec = process.env.PW_CHROME || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium-1248/chrome-linux64/chrome"].find(existsSync);
  const b = await chromium.launch({ executablePath: exec, args: ["--no-sandbox"] });
  try { await runShellBoot("local app shell", await b.newPage({ viewport: { width: 1400, height: 900 } }), SHELL.replace(/\/$/, "")); }
  catch (e) { console.error("ERROR (shell scene)", e.stack || e.message); results.push({ ok: false, name: "shell scene" }); }
  await b.close();
}

if (BASE && process.env.E2E_LOGIN_KEY && !fatal) {
  const { openSignedIn } = await import("./lib/signedInSession.mjs");
  const si = await openSignedIn({ base: BASE });
  try {
    const bootPage = await si.page.context().newPage();
    try { await runShellBoot("signed-in app shell, boot overlay", bootPage, BASE); } finally { await bootPage.close(); }
    await si.page.goto(`${BASE}/#/schedule`, { waitUntil: "load" });
    const handle = await si.page.waitForSelector('iframe[title="Sequence Planyr"]', { timeout: 40000 });
    const frame = await handle.contentFrame();
    await frame.waitForSelector("[data-task-row]", { timeout: 60000 }).catch(() => {});
    if (await frame.$("[data-task-row]")) {
      await assertMeasurable(si.page, "verify-cursors-schedule (signed in)");
      const box = await handle.boundingBox();
      const buildNow = await si.page.evaluate(() => fetch("/version.json").then((r) => r.json()).catch(() => null));
      console.log(`signed-in shell build (read in the same call): ${JSON.stringify(buildNow)}`);
      await runScene("signed-in app shell, schedule iframe", si.page, frame, { x: box.x, y: box.y });
    } else console.log("  (signed-in schedule has no rows on the fixture — shell scene skipped, standalone scene stands)");
  } catch (e) { console.error("ERROR (signed-in scene)", e.stack || e.message); results.push({ ok: false, name: "signed-in scene" }); }
  await si.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${failed ? `FAIL ${failed}` : "PASS"} (${results.length} checks)`);
process.exit(failed ? 1 : 0);
