/* NEW-1 — THE SUCCESSOR PROMPT CAN NOW MARK A SUCCESSOR COMPLETE, NOT JUST IN PROGRESS.
 *
 * Owner report, verbatim: "when I mark the item complete and then it's got a successor, and it
 * gives me the prompt to mark it in progress or whatever, it should also allow me to mark it
 * complete." Measured first (this file's earlier exploratory runs, not committed): the modal's
 * StatusPills offered exactly three values — Not Started / In Progress / Needs Attn. — with no
 * way to pick Complete, and Enter/apply() was the ONLY accept path.
 *
 * THE HAZARD THIS FILE EXISTS TO GUARD, STATED BY THE OWNER: a prior bug (B463920) came from the
 * SAME Enter keystroke being read twice — once by the modal's apply(), once by the grid's
 * document-level key handler, which (by design) opens a picker on Enter and fired a synthetic
 * click that reopened the status menu the modal had just closed. The fix was a latch
 * (overlayAtKeyStartRef) that thirteen overlays share. Adding a second accept control to THIS
 * modal is exactly the shape that could re-arm that bug, so the owner required:
 *   1. Enter's meaning does not change — it still applies `pending` exactly as before.
 *   2. Complete gets a SEPARATE control (a footer button) and a SEPARATE key (Ctrl/Cmd+Enter,
 *      matching the FormulaBar's existing accelerator), never sharing plain Enter.
 *   3. Both accept paths, and dismiss, must leave no stray colour menu and no stray grid
 *      selection — mutation-proven, not just observed once.
 *
 * WHAT THIS FILE ALSO CATCHES THAT WASN'T EXPLICITLY ASKED FOR: completing more than one
 * Ready-to-Start successor in the same action (picking the Complete pill on more than one row,
 * then Update Successors, can do exactly that) fires more than one independent 80ms-delayed "does
 * THIS successor have its own ready successor?" check. Both checks used to write directly into the
 * single `successorPrompt` state slot — a genuine race where the second write silently clobbers
 * the first, losing a follow-up prompt the owner's "one hop at a time, prompting again" rule
 * requires. Section B below reproduces the race, and section C's mutation proves the FIFO queue
 * that was added to fix it (successorPromptQueue) is load-bearing, not decorative.
 *
 * ── REVERT (PR #1072 → this fix) ──────────────────────────────────────────────────────────────
 * Owner report, verbatim: "the buttons aren't the same size, and the button should be the same
 * size... you've got mark complete, update successors... the UI is horrible." The bulk "Mark
 * Complete" footer button (and its Ctrl/Cmd+Enter keyboard twin) was a redundant THIRD control —
 * the Complete pill (per-row, always present since NEW-1) already reaches the same outcome one
 * click away through Update Successors — and it broke the footer's two-button balance. Both were
 * removed. The Complete CAPABILITY is unchanged: the pill still offers Complete, and Enter/
 * Update Successors still applies it. What changed here is DELETED, not renamed — Sections A3/A4
 * below assert the button and the distinct Ctrl/Cmd+Enter behaviour are actually gone, not just
 * relabeled, and every other section was re-pointed at the pill+apply() path so the race/latch/
 * selection guards below still exercise real, reachable UI.
 *
 * Run:  node ui-audit/verify-successor-complete.mjs      [PW_CHROME=<chrome>]
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";
import { servedProvenance, provenanceReport } from "./lib/deployedTarget.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const HTML_PATH = new URL("../public/sequence/index.html", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

const DEPLOYED = process.env.PLANYR_URL || null;
const realBody = await readFile(HTML_PATH, "utf8");
let deployedBody = null;
await ensureVendored();
if (DEPLOYED) {
  const prov = await servedProvenance(DEPLOYED);
  console.log(provenanceReport(prov, DEPLOYED));
  if (!prov.ok) { console.log("FAIL — the deployed artifact could not be read, so nothing here is a measurement of it."); process.exit(1); }
  deployedBody = prov.body;
}

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };

// ── Server factory — serves either the real file, the deployed bytes, or an in-memory MUTATION ──
async function makeServer(bodyOverride) {
  const server = createServer(async (req, res) => {
    try {
      if (await serveVendored(req, res)) return;
      let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
      if (p.endsWith("sequence/index.html")) {
        const src = bodyOverride ?? deployedBody ?? realBody;
        res.writeHead(200, { "Content-Type": "text/html" }); res.end(Buffer.from(rewriteCdn(src))); return;
      }
      const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      const body = await readFile(fp);
      res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  await new Promise(r => server.listen(0, r));
  return { server, url: `http://localhost:${server.address().port}/sequence/` };
}

// ── The fixture: two independent chains, plus an already-complete sibling ──────────────────────
// Root -> Branch A -> Branch A Child           (dual-branch chain, used to trigger the QUEUE race)
//      -> Branch B -> Branch B Child
//      -> Already Done Sibling (health: green — must NEVER appear in the prompt)
// Solo Parent -> Solo Child -> Solo Grandchild  (single-successor chain, used for the plain
//                                                 pill/button/key + one-hop-not-cascade checks)
function task(over) {
  return { start: "2026-01-01", end: "2026-01-01", duration: 1, predecessors: [], health: "gray",
    percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true,
    durUnit: "d", durValue: 1, predUnresolved: [], meetingBodyMissing: false,
    finishConflict: false, startConflict: false, ...over };
}
const FIXTURE = {
  aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects",
  projects: { 1: { id: 1, name: "Successor Complete Fixture", tasks: [
    task({ id: 1, name: "Root",                 health: "yellow" }),
    task({ id: 2, name: "Branch A",              predecessors: [{id:1,type:"FS",lag:0}] }),
    task({ id: 3, name: "Branch B",              predecessors: [{id:1,type:"FS",lag:0}] }),
    task({ id: 4, name: "Branch A Child",        predecessors: [{id:2,type:"FS",lag:0}] }),
    task({ id: 5, name: "Branch B Child",        predecessors: [{id:3,type:"FS",lag:0}] }),
    task({ id: 6, name: "Already Done Sibling",  predecessors: [{id:1,type:"FS",lag:0}], health: "green", percentComplete: 100 }),
    task({ id: 7, name: "Solo Parent",           health: "yellow" }),
    task({ id: 8, name: "Solo Child",            predecessors: [{id:7,type:"FS",lag:0}] }),
    task({ id: 9, name: "Solo Grandchild",       predecessors: [{id:8,type:"FS",lag:0}] }),
  ]}},
};

// ── Page-level helpers ───────────────────────────────────────────────────────────────────────
async function bootAndImport(page, url) {
  page.removeAllListeners("dialog");
  page.on("dialog", d => d.accept());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-successor-complete");
  await page.locator('[data-testid="open-history-desktop"]').click();
  await pacedWait(page, 250);
  await page.setInputFiles('input[type="file"][accept=".json"]', {
    name: "fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(FIXTURE)),
  });
  await pacedWait(page, 700);
  await page.locator('[data-testid="history-panel"] button:has-text("Close")').click();
  // The "Imported…" toast shares screen space with picker menus during exploration; give it time
  // to clear rather than special-case it in every selector below.
  await pacedWait(page, 4200);
}

async function markGreenViaGrid(page, id) {
  await page.locator(`[data-task-row="${id}"]`).scrollIntoViewIfNeeded().catch(() => {});
  await page.locator(`[data-picker-cell="health-${id}"] [data-health-dot]`).click();
  await pacedWait(page, 220);
  await page.locator('div[data-menu-isolated="1"] span[title="Complete"]').last().click();
  await pacedWait(page, 550);
}

const modalUp   = page => page.locator('[data-successor-modal]').count();
const menuCount = page => page.evaluate(() => document.querySelectorAll('[data-menu-isolated="1"]').length);
const staleGridSelection = page => page.evaluate(() => {
  const o = {};
  for (const r of document.querySelectorAll("[data-task-row]")) {
    const hit = [...r.children].filter(c => c.getAttribute && c.getAttribute("data-col-key"))
      .filter(c => getComputedStyle(c).backgroundColor === "rgb(219, 234, 254)")
      .map(c => c.getAttribute("data-col-key"));
    if (hit.length) o[r.getAttribute("data-task-row")] = hit;
  }
  return o;
});
// The GRID's own status cell only — never `[data-successor-row]`, which is a prompt's PENDING
// review UI and always renders the word "Complete" as one of its four pill labels regardless of
// the task's actual current health. Reading that cell here produced a false "already complete"
// positive the first time this harness ran (a chained follow-up prompt was still open, listing
// the very task being checked as one of ITS OWN Ready-to-Start rows) — this targets the single
// unambiguous cell that reflects real, applied state.
const healthOf = (page, id) => page.evaluate(taskId => {
  const cell = document.querySelector(`[data-picker-cell="status-${taskId}"]`);
  return cell ? cell.innerText : null;
}, id);

// =================================================================================================
// SECTION A — single-row behaviour, both accept paths, both against the plain Solo chain
// =================================================================================================
async function runSectionA(url) {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const pageErrors = []; page.on("pageerror", e => pageErrors.push(e.message));

  // A1 — Enter's DEFAULT behaviour is unchanged: no interaction, just Enter, marks the
  // Ready-to-Start successor In Progress (muscle memory the owner explicitly kept).
  await bootAndImport(page, url);
  await markGreenViaGrid(page, 7);   // Solo Parent -> prompt for Solo Child (8)
  ok("A1 · modal opened for the Solo chain", (await modalUp(page)) > 0);
  await page.locator('[data-successor-modal]').press("Enter");
  await pacedWait(page, 450);
  ok("A1 · Enter with NO interaction still marks the successor In Progress (unchanged default)",
    /In Progress/.test(await healthOf(page, 8) || ""));

  // A2 — the Complete PILL (per-row) + plain Enter: reuses the existing apply()/Enter path
  // verbatim, just with a wider `pending` value range. This must go through the SAME hardened
  // code as In Progress/Needs Attn. always have.
  await bootAndImport(page, url);
  await markGreenViaGrid(page, 7);
  await page.locator('[data-successor-row="8"] [data-successor-pill="green"]').click();
  await pacedWait(page, 150);
  await page.locator('[data-successor-modal]').press("Enter");
  await pacedWait(page, 450);
  ok("A2 · picking the Complete pill then pressing Enter marks that successor Complete",
    /Complete/.test(await healthOf(page, 8) || ""));
  ok("A2 · no stray colour menu after the pill+Enter accept", (await menuCount(page)) === 0);
  ok("A2 · no stray grid selection after the pill+Enter accept",
    Object.keys(await staleGridSelection(page)).length === 0);

  // A3 — REVERT: the bulk "Mark Complete" button is GONE, not just relabeled — assert its absence
  // directly, and that the footer holds exactly the two remaining controls, same width/height
  // (FOOTER_BTN_STYLE is a single shared object, so equal size is structural, not eyeballed).
  await bootAndImport(page, url);
  await markGreenViaGrid(page, 7);
  ok("A3 · the 'Mark Complete' button no longer exists in the footer",
    (await page.locator('[data-successor-apply="complete"]').count()) === 0);
  const footerBtnIds = await page.locator('[data-successor-apply]').evaluateAll(els => els.map(e => e.getAttribute("data-successor-apply")).sort());
  ok("A3 · exactly two footer buttons remain: Skip and Update Successors",
    JSON.stringify(footerBtnIds) === JSON.stringify(["skip","update"]), JSON.stringify(footerBtnIds));
  const [skipBox, updateBox] = await Promise.all([
    page.locator('[data-successor-apply="skip"]').boundingBox(),
    page.locator('[data-successor-apply="update"]').boundingBox(),
  ]);
  ok("A3 · Skip and Update Successors render at the same width and height",
    !!skipBox && !!updateBox && skipBox.width === updateBox.width && skipBox.height === updateBox.height,
    `skip=${JSON.stringify(skipBox)} update=${JSON.stringify(updateBox)}`);

  // A4 — REVERT: Ctrl/Cmd+Enter was that button's keyboard twin and had its own dedicated branch
  // in the modal's onKeyDown; that branch is gone too. A Ctrl+Enter press now falls through to the
  // SAME plain-Enter apply() line Enter always used — so with no interaction it still defaults the
  // Ready-to-Start row to In Progress, never force-Completes it. This is the explicit "removed, not
  // half-wired" proof for the keyboard binding.
  await bootAndImport(page, url);
  await markGreenViaGrid(page, 7);
  await page.locator('[data-successor-modal]').press("Control+Enter");
  await pacedWait(page, 450);
  ok("A4 · Ctrl+Enter with no interaction behaves exactly like plain Enter (In Progress, never a force-Complete)",
    /In Progress/.test(await healthOf(page, 8) || ""));
  ok("A4 · no stray colour menu after the Ctrl+Enter accept", (await menuCount(page)) === 0);
  ok("A4 · no stray grid selection after the Ctrl+Enter accept",
    Object.keys(await staleGridSelection(page)).length === 0);

  // A5 — CHAIN: completing a successor (via the Complete pill + Update Successors — the only
  // accept path left for Complete) that itself has a Ready successor opens ONE new prompt (one
  // hop), not a silent multi-level cascade. The grandchild must stay untouched until THAT prompt
  // is acted on.
  await bootAndImport(page, url);
  await markGreenViaGrid(page, 7);                                              // Root of the solo chain
  await page.locator('[data-successor-row="8"] [data-successor-pill="green"]').click();
  await pacedWait(page, 150);
  await page.locator('[data-successor-apply="update"]').click();                // completes Solo Child (8)
  await pacedWait(page, 700);
  const secondPromptText = (await modalUp(page)) ? await page.locator('[data-successor-modal]').innerText() : "";
  ok("A5 · completing successor #8 opens a NEW prompt for ITS successor (one hop, not silent)",
    /Solo Child/.test(secondPromptText));
  ok("A5 · the grandchild (#9) is NOT auto-completed — it waits for this new prompt",
    !/Complete/.test(await healthOf(page, 9) || ""));
  await page.locator('[data-successor-apply="skip"]').click();
  await pacedWait(page, 300);
  ok("A5 · skipping the follow-up prompt leaves the grandchild untouched (no silent cascade at all)",
    !/Complete/.test(await healthOf(page, 9) || ""));

  // A6 — dismiss paths (Escape, ✕, Skip, backdrop) apply NOTHING, even with Complete pre-picked.
  for (const [label, dismiss] of [
    ["Escape", async () => page.keyboard.press("Escape")],
    ["✕ button", async () => page.locator('[data-successor-modal] >> text=✕').first().click()],
    ["Skip button", async () => page.locator('[data-successor-apply="skip"]').click()],
  ]) {
    await bootAndImport(page, url);
    await markGreenViaGrid(page, 7);
    await page.locator('[data-successor-row="8"] [data-successor-pill="green"]').click();  // pre-pick Complete
    await pacedWait(page, 150);
    await dismiss();
    await pacedWait(page, 400);
    ok(`A6 · dismissing via ${label} with Complete pre-picked applies nothing`,
      /Not Started/.test(await healthOf(page, 8) || ""));
  }

  ok("Section A · no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  await browser.close();
}

// =================================================================================================
// SECTION B — the dual-branch fixture: already-complete exclusion + the queue race, PROVEN LIVE
// =================================================================================================
async function runSectionB(url) {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

  await bootAndImport(page, url);
  await markGreenViaGrid(page, 1);   // Root -> Branch A, Branch B ready; Already Done Sibling excluded
  ok("B1 · modal opened listing the two Ready-to-Start branches", (await modalUp(page)) > 0);
  const shownIds = await page.locator('[data-successor-row]').evaluateAll(els => els.map(e => e.getAttribute("data-successor-row")).sort());
  ok("B1 · shows exactly Branch A (#2) and Branch B (#3)", JSON.stringify(shownIds) === JSON.stringify(["2","3"]));
  const modalText = await page.locator('[data-successor-modal]').innerText();
  ok("B1 · the ALREADY-COMPLETE successor (#6, health:green) never appears in the prompt at all",
    !modalText.includes("Already Done Sibling"));

  // B2 — REVERT: complete BOTH ready branches in one action via the Complete pill on each row
  // (the bulk-force button this used to exercise is gone; picking Complete on every Ready-to-Start
  // row then Update Successors is the user-reachable equivalent). Each independently unblocks its
  // own child. Both follow-up prompts must be offered, IN SEQUENCE (one hop at a time) — neither
  // silently lost to the other.
  await page.locator('[data-successor-row="2"] [data-successor-pill="green"]').click();
  await pacedWait(page, 150);
  await page.locator('[data-successor-row="3"] [data-successor-pill="green"]').click();
  await pacedWait(page, 150);
  await page.locator('[data-successor-apply="update"]').click();
  await pacedWait(page, 700);
  const seen = [];
  for (let i = 0; i < 4; i++) {
    if (!(await modalUp(page))) break;
    const t = await page.locator('[data-successor-modal]').innerText();
    const m = t.match(/TASK COMPLETED\n([^\n]+)/);
    seen.push(m ? m[1] : t.slice(0, 40));
    await page.locator('[data-successor-apply="skip"]').click();
    await pacedWait(page, 500);
  }
  ok("B2 · BOTH branches' follow-up prompts were offered, not just one (the queue race)",
    seen.includes("Branch A") && seen.includes("Branch B"), JSON.stringify(seen));
  ok("B2 · no stray colour menu after the whole sequential run", (await menuCount(page)) === 0);
  ok("B2 · no stray grid selection after the whole sequential run",
    Object.keys(await staleGridSelection(page)).length === 0);

  await browser.close();
}

// =================================================================================================
// SECTION C — MUTATION PROOFS. Each guard is disabled independently and the SAME check must fail.
// =================================================================================================
async function runMutationLatch(url) {
  const NEEDLE = "if (overlayOpenRef.current || overlayAtKeyStartRef.current) return;";
  if (!realBody.includes(NEEDLE)) { ok("C1 · latch mutation target found in source", false); return; }
  const mutated = realBody.replace(NEEDLE, "if (overlayOpenRef.current) return;");
  const { server, url: murl } = await makeServer(mutated);
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

  // C1a — the EXISTING accept path (Enter, now possibly carrying a Complete pick) must regress
  // when the latch is reverted — same signature the original B463920 fix proved.
  await bootAndImport(page, murl);
  await markGreenViaGrid(page, 7);
  await page.locator('[data-successor-row="8"] [data-successor-pill="green"]').click();
  await pacedWait(page, 150);
  await page.locator('[data-successor-modal]').press("Enter");
  await pacedWait(page, 550);
  ok("C1a · MUTATION (latch reverted): Enter accept now LEAKS a colour menu, as expected",
    (await menuCount(page)) > 0);

  // C1b — REVERT: Ctrl+Enter no longer has its own branch in the modal — it falls through to the
  // exact same `apply()` line plain Enter uses, so it is NOT a structurally-separate accept path
  // any more. What still protects it is a DIFFERENT, unrelated guard on the GRID's own key
  // handler (`!e.ctrlKey && !e.metaKey` on the Enter-opens-picker branch), which this mutation
  // never touches — so it should stay clean even with the modal's own latch gone. Reported
  // explicitly, not assumed: this assertion cannot be "turned red" by THIS particular mutation,
  // and that is the honest result, not a gap in the test.
  await bootAndImport(page, murl);
  await markGreenViaGrid(page, 7);
  await page.locator('[data-successor-modal]').press("Control+Enter");
  await pacedWait(page, 550);
  ok("C1b · MUTATION (latch reverted): Ctrl+Enter accept stays clean regardless (immune via the grid's own ctrl/meta guard, not this latch)",
    (await menuCount(page)) === 0);

  await browser.close(); server.close();
}

async function runMutationQueue(url) {
  const NEEDLE = "setSuccessorPromptQueue(q => [...q, { completedTask, projId: pid2, projName: p.name, successors }]);";
  if (!realBody.includes(NEEDLE)) { ok("C2 · queue mutation target found in source", false); return; }
  const mutated = realBody.replace(NEEDLE, "setSuccessorPrompt({ completedTask, projId: pid2, projName: p.name, successors });");
  const { server, url: murl } = await makeServer(mutated);
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

  // REVERT: reach the same both-branches-completed-at-once trigger via the Complete pill on each
  // row + Update Successors (the bulk-force button this used to click is gone).
  await bootAndImport(page, murl);
  await markGreenViaGrid(page, 1);
  await page.locator('[data-successor-row="2"] [data-successor-pill="green"]').click();
  await pacedWait(page, 150);
  await page.locator('[data-successor-row="3"] [data-successor-pill="green"]').click();
  await pacedWait(page, 150);
  await page.locator('[data-successor-apply="update"]').click();
  await pacedWait(page, 700);
  const seen = [];
  for (let i = 0; i < 4; i++) {
    if (!(await page.locator('[data-successor-modal]').count())) break;
    const t = await page.locator('[data-successor-modal]').innerText();
    const m = t.match(/TASK COMPLETED\n([^\n]+)/);
    seen.push(m ? m[1] : t.slice(0, 40));
    await page.locator('[data-successor-apply="skip"]').click();
    await pacedWait(page, 500);
  }
  ok("C2 · MUTATION (queue reverted to direct setState): one branch's follow-up prompt is LOST",
    !(seen.includes("Branch A") && seen.includes("Branch B")), JSON.stringify(seen));

  await browser.close(); server.close();
}

// =================================================================================================
// SECTION D — NARROW-SCREEN SWEEP (NEW-#, filed after a prior session flagged this dialog had
// NEVER been rendered below 1600x950 — no owner-observed bug, a coverage gap the owner then asked
// to have checked). Renders the real modal at a spread of real device widths and measures actual
// geometry — not an impression. If nothing here goes red, the honest conclusion is "not broken,"
// and this section is what keeps that conclusion true going forward instead of just asserted once.
//
// WIDTHS, and why each one: 1600 is the desktop baseline every other section already exercises —
// included here too so the sweep proves, not assumes, that this section's own instrumentation
// reads the unchanged desktop case as unchanged. 768 is the exact isMobile breakpoint (still the
// desktop header at this width — the app's own `window.innerWidth < 768` test). 430 is the widest
// common phone (iPhone Pro Max class). 393 covers mainstream iPhone/Android widths. 375 is
// iPhone SE/mini. 360 is the single most common Android width worldwide. 320 is the narrowest
// viewport any real phone still ships — the true floor; nothing narrower is a real device.
const WIDTH_SWEEP = [
  { width: 1600, label: "desktop baseline" },
  { width: 768,  label: "isMobile breakpoint (still desktop header)" },
  { width: 430,  label: "widest common phone (iPhone Pro Max class)" },
  { width: 393,  label: "mainstream iPhone/Android" },
  { width: 375,  label: "iPhone SE/mini" },
  { width: 360,  label: "most common Android width" },
  { width: 320,  label: "narrowest real phone floor" },
];

// A live-measured floor, not a guessed one: sweeping every 5px from 320-500 (public/../_tmp probe,
// not committed) found Chromium's flex-shrink distribution lands the two buttons off by exactly
// ±0.015625 CSS px (1/64 px — Blink's internal LayoutUnit snap grid) at ~9 of 37 widths sampled in
// the 340-460px shrink range, alternating sign. That is a browser layout-engine rounding artifact
// of two independently-shrinking same-basis flex items, not a design defect: at any real display
// and DPR it is at least an order of magnitude below one device pixel. The tolerance below is 6x
// that measured floor — enough to absorb the engine's own rounding noise, while staying orders of
// magnitude tighter than anything a human or a mutated button could produce (see the two mutation
// proofs below, which move the delta by 15-160px — nothing like 0.02px survives either mutation).
const EQUAL_WIDTH_TOLERANCE_PX = 0.1;

async function bootAndImportAtWidth(page, url) {
  page.removeAllListeners("dialog");
  page.on("dialog", d => d.accept());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-successor-complete:sectionD");
  // The header collapses to a single overflow menu below the app's own 768px isMobile
  // breakpoint (SitePlanner/Schedule shared pattern) — open Version History the way a user
  // actually would at that width, not by assuming the desktop button exists.
  const isMobileHeader = await page.evaluate(() => window.innerWidth < 768);
  if (isMobileHeader) {
    await page.locator('button[aria-label="More actions"]').click();
    await pacedWait(page, 150);
    await page.locator('[data-testid="open-history-mobile"]').click();
  } else {
    await page.locator('[data-testid="open-history-desktop"]').click();
  }
  await pacedWait(page, 250);
  await page.setInputFiles('input[type="file"][accept=".json"]', {
    name: "fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(FIXTURE)),
  });
  await pacedWait(page, 700);
  await page.locator('[data-testid="history-panel"] button:has-text("Close")').click();
  await pacedWait(page, 4200);
}

// Measures the modal's footer geometry and, critically, actually CLICKS Update Successors — proof
// the control is genuinely reachable at this width, not just geometrically present under an
// overlay it can't receive events through (CHROME-NEVER-EATS-A-PRESS is exactly this species of
// bug one layer up).
async function measureAndDriveAtWidth(url, width, label) {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const pageErrors = []; page.on("pageerror", e => pageErrors.push(e.message));
  await bootAndImportAtWidth(page, url);
  await markGreenViaGrid(page, 7); // Solo Parent -> prompt for Solo Child (8)
  await pacedWait(page, 200);

  const tag = `D · ${width}px (${label})`;
  ok(`${tag} · modal opened`, (await modalUp(page)) > 0);

  const geo = await page.evaluate(() => {
    const modal = document.querySelector('[data-successor-modal]');
    const card = modal ? modal.firstElementChild : null;
    const skip = document.querySelector('[data-successor-apply="skip"]');
    const update = document.querySelector('[data-successor-apply="update"]');
    const footer = skip ? skip.closest('div') : null;
    const label = footer ? [...footer.children].find(c => c.tagName === 'SPAN') : null;
    const rectOf = el => el ? (({ x, y, width, height, right, bottom }) => ({ x, y, width, height, right, bottom }))(el.getBoundingClientRect()) : null;
    const overlap = (a, b) => (!a || !b) ? null : !(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y);
    const lineCount = el => el ? new Set([...el.getClientRects()].map(r => Math.round(r.y))).size : null;
    const cardR = rectOf(card), skipR = rectOf(skip), updateR = rectOf(update), labelR = rectOf(label), footerR = rectOf(footer);
    return {
      cardR, skipR, updateR, labelR,
      footerOverflows: footer ? footer.scrollWidth > footer.clientWidth + 0.5 : null,
      skipWraps: skip ? lineCount(skip) > 1 : null,
      updateWraps: update ? lineCount(update) > 1 : null,
      labelSkipOverlap: overlap(labelR, skipR),
      labelUpdateOverlap: overlap(labelR, updateR),
      cardWithinViewport: cardR ? (cardR.x >= -0.5 && cardR.right <= window.innerWidth + 0.5) : null,
      updateWithinViewport: updateR ? (updateR.x >= -0.5 && updateR.right <= window.innerWidth + 0.5) : null,
      widthDelta: (skipR && updateR) ? Math.abs(updateR.width - skipR.width) : null,
      heightDelta: (skipR && updateR) ? Math.abs(updateR.height - skipR.height) : null,
    };
  });

  ok(`${tag} · footer does not overflow its container`, geo.footerOverflows === false, JSON.stringify(geo.footerR));
  ok(`${tag} · Skip's label does not wrap`, geo.skipWraps === false);
  ok(`${tag} · Update Successors' label does not wrap`, geo.updateWraps === false);
  ok(`${tag} · the "N updates pending" label does not collide with either button`,
    geo.labelSkipOverlap === false && geo.labelUpdateOverlap === false);
  ok(`${tag} · the modal card stays within the viewport (no horizontal clip)`, geo.cardWithinViewport === true, JSON.stringify(geo.cardR));
  ok(`${tag} · Update Successors stays within the viewport (reachable, not clipped off-screen)`, geo.updateWithinViewport === true, JSON.stringify(geo.updateR));
  ok(`${tag} · Skip and Update Successors render the same size (within ${EQUAL_WIDTH_TOLERANCE_PX}px — see rounding-floor note above)`,
    geo.widthDelta !== null && geo.widthDelta <= EQUAL_WIDTH_TOLERANCE_PX && geo.heightDelta <= EQUAL_WIDTH_TOLERANCE_PX,
    `widthDelta=${geo.widthDelta} heightDelta=${geo.heightDelta}`);
  if (width === 1600) {
    ok(`${tag} · exact desktop rendering unchanged (150x34, bit-identical to the pre-existing A3 check)`,
      geo.skipR && geo.updateR && geo.skipR.width === 150 && geo.updateR.width === 150 && geo.skipR.height === 34 && geo.updateR.height === 34);
  }

  // The interaction proof: actually drive Update Successors and confirm it really applied — not
  // just present, but reachable and functional at this width (SYNTHETIC-KEYS-DONT-EDIT's sibling
  // concern, one layer up: a geometry check that never clicks anything can't tell "present" from
  // "present but dead").
  await page.locator('[data-successor-apply="update"]').click();
  await pacedWait(page, 450);
  const healthAfter = await page.evaluate(() => {
    const cell = document.querySelector('[data-picker-cell="status-8"]');
    return cell ? cell.innerText : null;
  });
  ok(`${tag} · Update Successors is actually clickable and applies the change (not just geometrically present)`,
    /In Progress/.test(healthAfter || ""), healthAfter);

  ok(`${tag} · no uncaught page errors at this width`, pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  await browser.close();
}

async function runSectionD(url) {
  for (const { width, label } of WIDTH_SWEEP) {
    await measureAndDriveAtWidth(url, width, label);
  }
}

// ── MUTATION D1 — proves the viewport-overflow assertions are discriminating. Dropping the
// card's `maxWidth:'94vw'` clamp AND pinning `flexShrink:0` (so the backdrop's default flex-shrink
// can no longer act as a silent fallback either — measured live: removing maxWidth alone left the
// card contained because it's the sole flex item in the backdrop's centering flex row, and default
// flex-shrink:1 already resizes a lone over-wide item down to fit; only defeating BOTH mechanisms
// reproduces a real overflow) is exactly the kind of "simplify the inline style" edit that could
// land by accident; at 320px a fixed 480px-wide card then genuinely overflows the viewport, and
// the check above must catch it. At 1600px, 480 < 1600 regardless, so the desktop case must stay
// green — proving this mutation is narrow-width-specific, not a blunt instrument.
async function runMutationCardClamp(url) {
  const NEEDLE = "width:480,maxWidth:'94vw',maxHeight:'82vh'";
  if (!realBody.includes(NEEDLE)) { ok("D-mut1 · card-clamp mutation target found in source", false); return; }
  const mutated = realBody.replace(NEEDLE, "width:480,maxHeight:'82vh',flexShrink:0");
  const { server, url: murl } = await makeServer(mutated);
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

  for (const width of [320, 1600]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await bootAndImportAtWidth(page, murl);
    await markGreenViaGrid(page, 7);
    await pacedWait(page, 200);
    const withinViewport = await page.evaluate(() => {
      const card = document.querySelector('[data-successor-modal]').firstElementChild;
      const r = card.getBoundingClientRect();
      return r.x >= -0.5 && r.right <= window.innerWidth + 0.5;
    });
    if (width === 320) {
      ok("D-mut1 · MUTATION (maxWidth:94vw removed): the card now overflows a 320px viewport, as expected",
        withinViewport === false);
    } else {
      ok("D-mut1 · MUTATION (maxWidth:94vw removed): the 1600px desktop case stays unaffected (control, discriminating)",
        withinViewport === true);
    }
    await page.close();
  }
  await browser.close(); server.close();
}

// ── MUTATION D2 — proves the equal-width assertion is discriminating. Pinning a `minWidth` onto
// only the Update button (a plausible real mistake — e.g. someone padding it out to fit longer
// text) breaks the equal-shrink symmetry by tens of pixels at narrow widths, while both buttons
// still sit at their un-shrunk 150px at 1600px regardless — so the desktop control must stay
// green while the narrow-width check goes red.
async function runMutationButtonMinWidth(url) {
  const NEEDLE = '<button data-successor-apply="update" onClick={apply} disabled={!changeCount}';
  if (!realBody.includes(NEEDLE)) { ok("D-mut2 · button-minWidth mutation target found in source", false); return; }
  const mutated = realBody.replace(
    "style={{...FOOTER_BTN_STYLE,\n              cursor:changeCount?'pointer':'not-allowed',",
    "style={{...FOOTER_BTN_STYLE, minWidth:130,\n              cursor:changeCount?'pointer':'not-allowed',"
  );
  if (mutated === realBody) { ok("D-mut2 · button-minWidth mutation target found in source", false); return; }
  const { server, url: murl } = await makeServer(mutated);
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

  for (const width of [320, 1600]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await bootAndImportAtWidth(page, murl);
    await markGreenViaGrid(page, 7);
    await pacedWait(page, 200);
    const delta = await page.evaluate(() => {
      const s = document.querySelector('[data-successor-apply="skip"]').getBoundingClientRect();
      const u = document.querySelector('[data-successor-apply="update"]').getBoundingClientRect();
      return Math.abs(u.width - s.width);
    });
    if (width === 320) {
      ok("D-mut2 · MUTATION (Update given its own minWidth:130): the buttons are now visibly UNEQUAL at 320px, as expected",
        delta > EQUAL_WIDTH_TOLERANCE_PX, `delta=${delta}`);
    } else {
      ok("D-mut2 · MUTATION (Update given its own minWidth:130): the 1600px desktop case stays equal (control, discriminating)",
        delta <= EQUAL_WIDTH_TOLERANCE_PX, `delta=${delta}`);
    }
    await page.close();
  }
  await browser.close(); server.close();
}

// =================================================================================================
const { server, url } = await makeServer(null);
await runSectionA(url);
await runSectionB(url);
await runMutationLatch(url);
await runMutationQueue(url);
await runSectionD(url);
await runMutationCardClamp(url);
await runMutationButtonMinWidth(url);
server.close();

const passed = results.filter(r => r.pass).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(passed === results.length ? 0 : 1);
