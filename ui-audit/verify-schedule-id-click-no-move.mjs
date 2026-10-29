/* NEW-1 (B-mint pending) — "I'll just click a row by the left cell that selects the whole row, and it'll just
 * automatically jump to move it, which shouldn't happen." (Michael, 2026-10-28, Grid view, Grand Port.)
 *
 * WHAT IS ASSERTED (real pointer input in real Chromium — mouse, pen and touch — against the owner's real
 * 365-row structure, ui-audit/lib/grandPortScheduleStructure.mjs). A press on a row's ID cell / grip is
 * a CLICK until the pointer has travelled past a clear threshold while held:
 *   HOLD     press + a long still hold          → the drag is never ARMED (no dimmed/dashed rows, no pinned
 *                                                 grabbing cursor), nothing moves, nothing is written.
 *   WOBBLE   press + jitter below the threshold → same. The touch amplitude is chosen to reach the CENTRE
 *                                                 (nest) zone of the row just below the selection at the 125%
 *                                                 grid zoom this runs at — the old code's 4 px "moved" flag
 *                                                 would have nested the selection under it.
 *   DRAG     a deliberate drag past the threshold → still nests (the #2544 behaviour), one Ctrl+Z restores.
 *   RETURN   a drag that starts, wanders, and is released back at its press point → nothing is written.
 *   GRIP     a plain click on the grip → nothing moves, nothing is written.
 *   CTRL     ctrl-click on a selected ID cell → no pick-up.
 *   DBLCLICK double-click on an ID cell → nothing moves, nothing is written.
 * "Written" = a localStorage / window.storage.set write (the autosave + sync path) — a no-op move must produce none.
 *
 *   node ui-audit/verify-schedule-id-click-no-move.mjs                  # the working tree (must pass)
 *   node ui-audit/verify-schedule-id-click-no-move.mjs --source 5fad7c5 # pre-fix main (must FAIL)
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { execFileSync } from "node:child_process";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";
import { grandPortFixture } from "./lib/grandPortScheduleStructure.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const REPO_ROOT = new URL("../", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const srcArg = process.argv.indexOf("--source");
const SOURCE_REF = srcArg > 0 ? process.argv[srcArg + 1] : null;
const body = SOURCE_REF
  ? execFileSync("git", ["show", `${SOURCE_REF}:public/sequence/index.html`], { cwd: REPO_ROOT, maxBuffer: 1 << 26 }).toString("utf8")
  : await readFile(join(ROOT, "sequence/index.html"), "utf8");
console.log(`source: ${SOURCE_REF ? `git ${SOURCE_REF}` : "working tree"}`);

await ensureVendored();
const server = createServer(async (req, res) => {
  try {
    if (await serveVendored(req, res)) return;
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    if (p.endsWith("sequence/index.html")) { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(Buffer.from(rewriteCdn(body))); }
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    const b = await readFile(fp); res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(b);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;

const WRITE_SETTLE_MS = 2500;   // the autosave is debounced; a release is only 'clean' once it has had time to write
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const browser = await chromium.launch({ executablePath: EXEC });

const ZOOM = 1.25;   // rows are 25 visual px tall, so the centre (nest) band of the row below the selection is 10.6–14.4 px past its edge
async function boot() {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, hasTouch: true });
  const pg = await ctx.newPage();
  await pg.addInitScript(z => {
    try { localStorage.setItem("planar:viewPrefs:v1", JSON.stringify({ gridZoom: z })); } catch {}
    window.__lsWrites = [];
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { try { window.__lsWrites.push(String(k)); } catch {} return orig.call(this, k, v); };
  }, ZOOM);
  pg.on("dialog", d => d.accept());
  await pg.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await pg.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(pg, "verify-schedule-id-click-no-move");
  await pg.locator('[data-testid="open-history-desktop"]').click();
  await pacedWait(pg, 250);
  const fx = grandPortFixture({ rowHeight: 20 }); fx.view = "grid";
  await pg.setInputFiles('input[type="file"][accept=".json"]', { name: "fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fx)) });
  await pacedWait(pg, 900);
  await pg.locator('[data-testid="history-panel"] button:has-text("Close")').click();
  await pacedWait(pg, 600);
  // The write path: every schedule save goes through window.storage.set (autosave, sync, history). Count them.
  await pg.evaluate(() => { const o = window.storage.set; window.__stWrites = []; window.storage.set = function (...a) { try { window.__stWrites.push(String(a[0])); } catch {} return o.apply(this, a); }; });
  return { ctx, pg };
}

const rows = (pg) => pg.evaluate(() => [...document.querySelectorAll("[data-grid-scroll] [data-task-row]")]
  .map(r => {
    const nameCell = r.querySelector('[data-col-key="name"]');
    const raw = nameCell?.innerText || "";
    const span = nameCell?.querySelector("span");
    const pl = span ? parseFloat(getComputedStyle(span).paddingLeft) : 0;
    return { id: Number(r.dataset.taskRow), top: parseFloat(r.style.top), name: raw.replace(/^[▾▸]\s*/, "").trim(), level: Math.round((pl - 4) / 14), expanded: raw.startsWith("▾") ? true : raw.startsWith("▸") ? false : null };
  }).sort((a, b) => a.top - b.top));
const rowByName = async (pg, name) => (await rows(pg)).find(r => r.name === name) || null;
async function scrollTo(pg, name) {
  for (let i = 0; i < 40; i++) {
    const r = await rowByName(pg, name);
    if (r) {
      await pg.evaluate(top => { const el = document.querySelector("[data-grid-scroll]"); el.scrollTop = Math.max(0, top - el.clientHeight / 3); }, r.top);
      await pacedWait(pg, 250);
      if (await rowByName(pg, name)) return;
    }
    await pg.evaluate(() => { const el = document.querySelector("[data-grid-scroll]"); el.scrollTop += el.clientHeight * 0.8; });
    await pacedWait(pg, 120);
  }
  throw new Error(`row "${name}" never came into view`);
}
const idCell = (pg, id) => pg.locator(`[data-grid-scroll] [data-task-row="${id}"] [data-col-key="id"]`).first();
async function selectById(pg, firstName, lastName) {
  const a = await rowByName(pg, firstName), b = await rowByName(pg, lastName);
  const ab = await idCell(pg, a.id).boundingBox(), bb = await idCell(pg, b.id).boundingBox();
  await pg.mouse.click(ab.x + ab.width * 0.7, ab.y + ab.height / 2);
  await pacedWait(pg, 150);
  await pg.keyboard.down("Shift");
  await pg.mouse.click(bb.x + bb.width * 0.7, bb.y + bb.height / 2);
  await pg.keyboard.up("Shift");
  await pacedWait(pg, 200);
}
const sig = (rs, from, to) => { const i = rs.findIndex(r => r.name === from), j = rs.findIndex(r => r.name === to); return rs.slice(i, j + 1).map(r => `${r.name}:${r.level}:${r.expanded}`).join(" | "); };
const SPAN = ["Pipeline Coordination & LONOs", "CenterPoint GTO"];
const HIS_SELECT = ["Kinder Morgan", "Set up meeting once we have pipeline depths"];
const childrenOf = (rs, parentName) => {
  const i = rs.findIndex(r => r.name === parentName); if (i < 0) return null;
  const L = rs[i].level, out = [];
  for (let k = i + 1; k < rs.length && rs[k].level > L; k++) if (rs[k].level === L + 1) out.push(rs[k].name);
  return out;
};

// What an ARMED drag looks like to a person: the picked-up rows go dim with a dashed outline, and the whole page's
// cursor is pinned to "grabbing". Neither may appear until the pointer has really been dragged.
const armed = (pg) => pg.evaluate(() => ({
  dashed: [...document.querySelectorAll("[data-grid-scroll] [data-task-row]")].filter(r => r.style.outline.includes("dashed") || r.style.opacity === "0.45").length,
  pinned: !!document.querySelector("style[data-pinned-cursor]"),
}));

// ── pointer drivers: the same gesture through the three input types ──────────────────────────────────────────
function driver(pg, ctx, mode, cdp) {
  const touchPt = (x, y) => [{ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, id: 1, radiusX: 8, radiusY: 8, force: 0.5 }];
  const mouseEv = (type, x, y, extra = {}) => cdp.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && !extra.down ? "none" : "left", buttons: extra.down || type === "mousePressed" ? 1 : 0, clickCount: type === "mouseMoved" ? 0 : 1, pointerType: "pen", ...(extra.mods ? { modifiers: extra.mods } : {}) });
  let down = false;
  return {
    async move(x, y) {
      if (mode === "mouse") return pg.mouse.move(x, y);
      if (mode === "pen") return mouseEv("mouseMoved", x, y, { down });
      if (down) return cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touchPt(x, y) });
    },
    async down(x, y) {
      down = true;
      if (mode === "mouse") { await pg.mouse.move(x, y); return pg.mouse.down(); }
      if (mode === "pen") { await mouseEv("mouseMoved", x, y); return mouseEv("mousePressed", x, y); }
      return cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touchPt(x, y) });
    },
    async up(x, y) {
      down = false;
      if (mode === "mouse") return pg.mouse.up();
      if (mode === "pen") return mouseEv("mouseReleased", x, y);
      return cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    },
  };
}

// threshold-safe jitter per input type: BELOW what the app must treat as a click (mouse/pen/touch drag thresholds are 6/10/16 CSS px)
const WOBBLE = { mouse: 5, pen: 9, touch: 15 };

async function fresh(label, fn) {
  let env;
  try {
    env = await boot();
    const cdp = await env.ctx.newCDPSession(env.pg);
    await scrollTo(env.pg, "Kinder Morgan");
    const before = sig(await rows(env.pg), ...SPAN);
    await selectById(env.pg, ...HIS_SELECT);
    await fn(env.pg, env.ctx, cdp, before);
  } catch (e) { ok(`${label} · ran`, false, e.message.split("\n")[0]); }
  finally { if (env) await env.ctx.close(); }
}
const writes = (pg) => pg.evaluate(() => window.__lsWrites.length + window.__stWrites.length);

for (const mode of ["mouse", "pen", "touch"]) {
  // HOLD ─ press an ID cell inside the selection and hold still
  await fresh(`${mode} HOLD`, async (pg, ctx, cdp, before) => {
    const ex = await rowByName(pg, "Exxon"), b = await idCell(pg, ex.id).boundingBox();
    const at = { x: b.x + b.width * 0.7, y: b.y + b.height / 2 };
    const d = driver(pg, ctx, mode, cdp);
    const w0 = await writes(pg);
    await d.down(at.x, at.y);
    await pacedWait(pg, 900);
    const mid = await armed(pg);
    ok(`${mode} · a still HOLD on an ID cell does not arm a move (no dimmed/dashed rows, no pinned grabbing cursor)`, mid.dashed === 0 && !mid.pinned, JSON.stringify(mid));
    await d.up(at.x, at.y);
    await pacedWait(pg, WRITE_SETTLE_MS);
    const after = sig(await rows(pg), ...SPAN);
    ok(`${mode} · …and releasing it moves nothing and writes nothing`, after === before && (await writes(pg)) === w0, `writes ${w0}→${await writes(pg)}`);
  });

  // WOBBLE ─ press at the selection's bottom edge, jitter toward the row below it (Plan A), release there
  await fresh(`${mode} WOBBLE`, async (pg, ctx, cdp, before) => {
    const last = await rowByName(pg, HIS_SELECT[1]), b = await idCell(pg, last.id).boundingBox();
    const at = { x: b.x + b.width * 0.7, y: b.y + b.height - 2 };
    const amp = WOBBLE[mode];
    const d = driver(pg, ctx, mode, cdp);
    const w0 = await writes(pg);
    await d.down(at.x, at.y);
    await pacedWait(pg, 120);
    for (const f of [0.3, 0.6, 1, 0.8, 1]) { await d.move(at.x, at.y + amp * f); await pacedWait(pg, 40); }
    const mid = await armed(pg);
    ok(`${mode} · ${amp}px of jitter on an ID press does not arm a move`, mid.dashed === 0 && !mid.pinned, JSON.stringify(mid));
    await d.up(at.x, at.y + amp);
    await pacedWait(pg, WRITE_SETTLE_MS);
    const after = sig(await rows(pg), ...SPAN);
    ok(`${mode} · …and releasing it (pointer now over the row below) moves/nests nothing and writes nothing`, after === before && (await writes(pg)) === w0, `writes ${w0}→${await writes(pg)}`);
  });
}

for (const mode of ["mouse", "pen"]) {
  // DRAG ─ a deliberate drag still nests (the #2544 behaviour), one Ctrl+Z restores it
  await fresh(`${mode} DRAG`, async (pg, ctx, cdp, before) => {
    const km = await rowByName(pg, "Kinder Morgan"), b = await idCell(pg, km.id).boundingBox();
    const from = { x: b.x + b.width * 0.7, y: b.y + b.height / 2 };
    const plan = await rowByName(pg, "Plan A");
    const tb = await pg.locator(`[data-grid-scroll] [data-task-row="${plan.id}"]`).first().boundingBox();
    const to = { x: tb.x + 300, y: tb.y + tb.height / 2 };
    const d = driver(pg, ctx, mode, cdp);
    const w0 = await writes(pg);
    await d.down(from.x, from.y);
    const steps = Math.max(12, Math.round(Math.abs(to.y - from.y) / 6));
    for (let i = 1; i <= steps; i++) { await d.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps); await pacedWait(pg, 12); }
    await pacedWait(pg, 250);
    const live = await pg.evaluate(() => { const n = document.querySelector("[data-grid-scroll] [data-drag-nest]"); return n && getComputedStyle(n).display !== "none" ? n.getAttribute("data-drag-nest-kind") : null; });
    ok(`${mode} · a deliberate drag from the ID shows the "Nest inside" box on Plan A`, live === "into", `kind=${live}`);
    await d.up(to.x, to.y);
    await pacedWait(pg, WRITE_SETTLE_MS);
    await scrollTo(pg, "Plan A");
    const kids = childrenOf(await rows(pg), "Plan A");
    ok(`${mode} · (control) the write counter DOES see a real move`, (await writes(pg)) > w0, `writes ${w0}→${await writes(pg)}`);
    ok(`${mode} · …and the drop nests the selection under Plan A`, JSON.stringify(kids) === JSON.stringify(["Kinder Morgan", "Enterprise", "Exxon", "Air Liquide"]), JSON.stringify(kids));
    await pg.keyboard.press("Control+z");
    await pacedWait(pg, 600);
    await scrollTo(pg, "Kinder Morgan");
    ok(`${mode} · …and one Ctrl+Z restores the original structure`, sig(await rows(pg), ...SPAN) === before);
  });

  // RETURN ─ a drag that really starts but is released back where it began writes nothing
  await fresh(`${mode} RETURN`, async (pg, ctx, cdp, before) => {
    const ex = await rowByName(pg, "Exxon"), b = await idCell(pg, ex.id).boundingBox();
    const from = { x: b.x + b.width * 0.7, y: b.y + b.height / 2 };
    const d = driver(pg, ctx, mode, cdp);
    const w0 = await writes(pg);
    await d.down(from.x, from.y);
    for (let i = 1; i <= 10; i++) { await d.move(from.x + 4 * i, from.y + 8 * i); await pacedWait(pg, 15); }
    const mid = await armed(pg);
    ok(`${mode} · (control) 80px into a drag the move IS armed — the harness can see it`, mid.dashed > 0 || SOURCE_REF !== null, JSON.stringify(mid));
    for (let i = 9; i >= 0; i--) { await d.move(from.x + 4 * i, from.y + 8 * i); await pacedWait(pg, 15); }
    await d.up(from.x, from.y);
    await pacedWait(pg, WRITE_SETTLE_MS);
    ok(`${mode} · a drag released back at its press point moves nothing and writes nothing`, sig(await rows(pg), ...SPAN) === before && (await writes(pg)) === w0, `writes ${w0}→${await writes(pg)}`);
  });
}

// EDGE ─ THE PRIMARY CASE (Michael, 2026-10-28 7:21 PM: "I've barely moved or maybe not even moved by the time I've
// clicked, and it still moves it"). Press-and-release with ZERO pointer movement on a row near the bottom edge of
// the grid, with and without a multi-row selection, on the grip and on the ID cell. The old code armed the drag at
// press and its per-frame loop auto-scrolled the grid whenever the pointer sat within ~36px of the edge — with a
// motionless mouse — so rows slid under the pointer and (grip: no click path) the release committed the drop there.
const visibleStructure = (pg) => pg.evaluate(() => [...document.querySelectorAll("[data-grid-scroll] [data-task-row]")]
  .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
  .map(r => { const n = r.querySelector('[data-col-key="name"]'); const sp = n?.querySelector("span"); return (n?.innerText || "").replace(/^[▾▸]\s*/, "").trim() + "@" + (sp ? getComputedStyle(sp).paddingLeft : ""); }).join("|"));
for (const target of ["grip", "id"]) for (const sel of ["none", "multi"]) for (const holdMs of [0, 150, 400]) {
  await fresh(`edge ${target} ${sel} ${holdMs}`, async (pg, ctx, cdp, before) => {
    await pg.keyboard.press("Escape");
    await pg.evaluate(() => { document.querySelector("[data-grid-scroll]").scrollTop = 3000; });
    await pacedWait(pg, 300);
    const sr = await pg.evaluate(() => { const r = document.querySelector("[data-grid-scroll]").getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
    const rs = await pg.evaluate(() => [...document.querySelectorAll("[data-grid-scroll] [data-task-row]")].map(r => { const b = r.querySelector('[data-col-key="id"]').getBoundingClientRect(); return { id: Number(r.dataset.taskRow), cy: b.top + b.height / 2 }; }));
    const band = rs.filter(r => r.cy > sr.bottom - 34 && r.cy < sr.bottom - 4);
    const r = band[band.length >> 1];
    if (!r) throw new Error("no row in the bottom-edge band");
    if (sel === "multi") {
      const prev = rs.filter(x => x.cy < r.cy).sort((a, b) => b.cy - a.cy)[0];
      for (const q of [prev, r]) {
        const b = await idCell(pg, q.id).boundingBox();
        if (q === r) await pg.keyboard.down("Shift");
        await pg.mouse.click(b.x + b.width * 0.7, b.y + b.height / 2);
        if (q === r) await pg.keyboard.up("Shift");
        await pacedWait(pg, 100);
      }
    }
    const b = await (target === "grip" ? pg.locator(`[data-grid-scroll] [data-row-drag-handle="${r.id}"]`).first() : idCell(pg, r.id)).boundingBox();
    const x = target === "grip" ? b.x + b.width / 2 : b.x + b.width * 0.7, y = b.y + b.height / 2;
    const s0 = await visibleStructure(pg), st0 = await pg.evaluate(() => document.querySelector("[data-grid-scroll]").scrollTop), w0 = await writes(pg);
    await pg.mouse.move(x, y); await pg.mouse.down();
    if (holdMs) await pacedWait(pg, holdMs);
    const mid = await armed(pg);
    await pg.mouse.up(); await pacedWait(pg, WRITE_SETTLE_MS);
    const st1 = await pg.evaluate(() => document.querySelector("[data-grid-scroll]").scrollTop);
    // compare the SAME window of the list: put the scroll back first, so a scroll alone can't read as a move
    await pg.evaluate(t => { document.querySelector("[data-grid-scroll]").scrollTop = t; }, st0); await pacedWait(pg, 300);
    const s1 = await visibleStructure(pg), w1 = await writes(pg);
    ok(`EDGE · ${target} · ${sel === "multi" ? "inside a multi-row selection" : "single row"} · zero-movement click held ${holdMs}ms near the bottom edge: nothing armed, grid does not auto-scroll, nothing moves, nothing written`,
      mid.dashed === 0 && !mid.pinned && Math.abs(st1 - st0) <= 30 && s1 === s0 && w1 === w0,   // ≤ 30px = the app's own one-time 'bring the clicked row fully into view'; the old held-edge autoscroll ran 54–126px
      `armed=${JSON.stringify(mid)} scroll ${st0.toFixed(0)}→${st1.toFixed(0)} moved=${s1 !== s0} writes ${w0}→${w1}`);
  });
}

// GRIP / CTRL / DBLCLICK ─ mouse
await fresh("grip click", async (pg, ctx, cdp, before) => {
  const ex = await rowByName(pg, "Exxon");
  const g = await pg.locator(`[data-grid-scroll] [data-row-drag-handle="${ex.id}"]`).first().boundingBox();
  const w0 = await writes(pg);
  await pg.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await pg.mouse.down(); await pacedWait(pg, 500);
  const mid = await armed(pg);
  ok("grip · a press-and-hold on the grip does not arm a move", mid.dashed === 0 && !mid.pinned, JSON.stringify(mid));
  await pg.mouse.up(); await pacedWait(pg, WRITE_SETTLE_MS);
  ok("grip · a plain click on the grip moves nothing and writes nothing", sig(await rows(pg), ...SPAN) === before && (await writes(pg)) === w0, `writes ${w0}→${await writes(pg)}`);
});
await fresh("ctrl-click", async (pg, ctx, cdp, before) => {
  const ex = await rowByName(pg, "Exxon"), b = await idCell(pg, ex.id).boundingBox();
  await pg.keyboard.down("Control");
  await pg.mouse.move(b.x + b.width * 0.7, b.y + b.height / 2); await pg.mouse.down(); await pacedWait(pg, 300);
  const mid = await armed(pg);
  ok("ctrl-click · ctrl+press on a selected ID cell does not pick the selection up", mid.dashed === 0 && !mid.pinned, JSON.stringify(mid));
  await pg.mouse.up(); await pg.keyboard.up("Control"); await pacedWait(pg, 300);
  ok("ctrl-click · …and moves nothing", sig(await rows(pg), ...SPAN) === before);
});
await fresh("double-click", async (pg, ctx, cdp, before) => {
  const ex = await rowByName(pg, "Exxon"), b = await idCell(pg, ex.id).boundingBox();
  const w0 = await writes(pg);
  await pg.mouse.dblclick(b.x + b.width * 0.7, b.y + b.height / 2);
  await pacedWait(pg, WRITE_SETTLE_MS);
  const st = await armed(pg);
  ok("double-click · a double-click on an ID cell moves nothing, writes nothing, and leaves nothing armed", sig(await rows(pg), ...SPAN) === before && (await writes(pg)) === w0 && st.dashed === 0 && !st.pinned, `writes ${w0}→${await writes(pg)} ${JSON.stringify(st)}`);
});

await browser.close(); server.close();
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
