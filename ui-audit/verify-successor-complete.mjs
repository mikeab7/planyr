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
const { server, url } = await makeServer(null);
await runSectionA(url);
await runSectionB(url);
await runMutationLatch(url);
await runMutationQueue(url);
server.close();

const passed = results.filter(r => r.pass).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(passed === results.length ? 0 : 1);
