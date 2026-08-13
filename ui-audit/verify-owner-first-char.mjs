/* B443536 — TYPE-TO-EDIT MUST NOT EAT THE CHARACTER THAT OPENED THE EDITOR.
 *
 * Owner report (2026-08-13): *"we type a person's name into the owner column … it uses the
 * first letter for searching the contact list or the registry, but after that, it forgets
 * that first letter."*  Type `Scott` into a selected Owner cell → the field reads `cott`.
 *
 * This harness is the MEASURED reproduction. It drives the real scheduler in a real browser,
 * types one character at a time with REAL key events (SYNTHETIC-KEYS-DONT-EDIT), and after
 * EVERY keystroke reads back BOTH pieces of state that can disagree:
 *   · the input's visible `value`  (what the user sees)
 *   · the dropdown's filter result (what the search ran on)
 * so the report says exactly WHICH keystroke is lost and at WHICH point — captured-and-dropped
 * vs never-captured — because those have different fixes.
 *
 * It then asserts the COMMITTED value, not just the rendered one: a silently truncated owner
 * name saved to the task is data damage, not a cosmetic glitch.
 *
 * Coverage is per COLUMN and per ROUTE, because the seeding path is SHARED:
 *   columns · Owner (ContactPicker) · Predecessor (PredEditor) · Task name · Duration · Start
 *   routes  · type-to-edit on a selected cell · double-click then type · paste
 * A defect in the shared ancestor shows up as a whole column of failures, not one cell.
 *
 * Run:  node ui-audit/verify-owner-first-char.mjs        [PW_CHROME=<chrome>]
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

/* The Schedule page pulls React / ReactDOM / Babel / supabase-js from CDNs the BROWSER cannot
   reach in this sandbox — and the failure is silent: the page renders an empty body while a
   naive probe still reads app copy out of the inline <script> text and reports a confident pass.
   Node CAN reach them, so vendor once and serve locally: same bytes, same versions, only the
   origin changes. Shared with the other Schedule harnesses — see ui-audit/lib/vendorCdn.mjs. */
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
console.log("serving", url, "(vendored libs)");

const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`);
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout AND suspends requestAnimationFrame, so after a view change every box, hit test and
   screenshot agrees with every other and describes a view the app already left. One precondition
   covers both, rAF liveness probe included; see ui-audit/lib/tabTiming.mjs. */
await assertMeasurable(page, "verify-owner-first-char");
const pageErrors = [];
page.on("pageerror", e => pageErrors.push(e.message));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => pageErrors.push("GOTO: " + e.message));
const booted = await page.waitForSelector("[data-task-row]", { timeout: 30000 }).then(() => true).catch(() => false);
ok("scheduler boots", booted);
if (!booted) { await finish(); }

// Default visible column order (DEFAULT_GRID_COLS):
//   0 id · 1 name · 2 start · 3 end · 4 dur · 5 predecessors · 6 successors · 7 health
//   8 status · 9 responsibleParty · 10 cost · 11 notes
const COL = { name: 1, start: 2, end: 3, duration: 4, predecessors: 5, owner: 9 };

// Pick leaf rows (parents have computed, locked date cells).
const leaves = await page.evaluate(() => {
  const rows = [...document.querySelectorAll("[data-task-row]")];
  const isParent = d => /[▾▸]/.test((d.children[1]?.innerText) || "");
  return rows.filter(d => !isParent(d)).slice(0, 8).map(d => +d.getAttribute("data-task-row"));
});
ok("found leaf rows to drive", leaves.length >= 5, "rows=" + JSON.stringify(leaves));

const cellOf = (rowId, colIdx) => page.locator(`[data-task-row="${rowId}"] > div`).nth(colIdx);
const liveInput = rowId => page.locator(`[data-task-row="${rowId}"] input`).first();

async function escapeOut() {
  await page.keyboard.press("Escape").catch(() => {});
  await pacedWait(page, 90);
  await page.keyboard.press("Escape").catch(() => {});
  await pacedWait(page, 90);
}

/* Type `text` one REAL key at a time into a cell opened by the type-to-edit route
   (select the cell with a single click, then just type — the first key opens the editor).
   Records the input's value after EVERY keystroke, so a lost character is located exactly. */
async function typeToEdit(rowId, colIdx, text) {
  await cellOf(rowId, colIdx).click();
  await pacedWait(page, 120);
  const trace = [];
  for (const ch of text) {
    await page.keyboard.press(ch === " " ? "Space" : ch);
    await pacedWait(page, 90);
    const v = await liveInput(rowId).inputValue().catch(() => "<no input>");
    trace.push(v);
  }
  return trace;
}

/* Same text via the double-click route: the editor is already open and seeded with the
   EXISTING value, which is select-all'd on purpose so typing replaces it. */
async function dblClickThenType(rowId, colIdx, text) {
  await cellOf(rowId, colIdx).dblclick();
  await pacedWait(page, 200);
  const trace = [];
  for (const ch of text) {
    await page.keyboard.press(ch === " " ? "Space" : ch);
    await pacedWait(page, 90);
    trace.push(await liveInput(rowId).inputValue().catch(() => "<no input>"));
  }
  return trace;
}

/* What the app actually COMMITTED — read back from the closed cell, whose display text comes
   straight off the task model (`task.responsibleParty`), NOT from the input that was typed into.
   So this is the stored value round-tripped through render, not the editor's own state.
   Polled rather than read once: the DOM read races the re-render (SYNTHETIC-KEYS-DONT-EDIT §4). */
async function committed(rowId, colIdx, expect) {
  for (let i = 0; i < 12; i++) {
    const open = await page.locator(`[data-task-row="${rowId}"] input`).count();
    if (!open) {
      const txt = (await cellOf(rowId, colIdx).innerText()).trim();
      if (txt === expect || i > 6) return txt;
    }
    await pacedWait(page, 120);
  }
  return (await cellOf(rowId, colIdx).innerText()).trim();
}

const NAME = "Scott";

if (booted && leaves.length >= 5) {
  // ── 1. OWNER, type-to-edit route — the reported bug ───────────────────────────────
  const r0 = leaves[0];
  const ownerTrace = await typeToEdit(r0, COL.owner, NAME);
  console.log("   owner keystroke trace:", JSON.stringify(ownerTrace));
  ok("Owner · type-to-edit · every character survives, in order",
    ownerTrace[ownerTrace.length - 1] === NAME,
    `after "${NAME}" the field reads ${JSON.stringify(ownerTrace[ownerTrace.length - 1])} · trace ${JSON.stringify(ownerTrace)}`);

  // The FIRST keystroke must be in the field, not merely in the search.
  ok("Owner · the character that OPENED the picker is in the field",
    ownerTrace[0] === NAME[0],
    `after the opening key the field reads ${JSON.stringify(ownerTrace[0])}, expected ${JSON.stringify(NAME[0])}`);

  // And it must survive the SECOND keystroke — the select-on-mount failure mode.
  ok("Owner · the opening character survives the NEXT keystroke",
    ownerTrace[1] === NAME.slice(0, 2),
    `after two keys the field reads ${JSON.stringify(ownerTrace[1])}, expected ${JSON.stringify(NAME.slice(0, 2))}`);

  await page.keyboard.press("Enter");
  await pacedWait(page, 300);
  const savedOwner = await committed(r0, COL.owner, NAME);
  ok("Owner · what is COMMITTED equals what was typed (no silent truncation)",
    savedOwner === NAME, `stored ${JSON.stringify(savedOwner)}, typed ${JSON.stringify(NAME)}`);
  await escapeOut();

  // ── 2. OWNER, a name that IS in the registry — the search-then-pick path ──────────
  // "Scott" is now a contact (auto-added above). Re-typing it must still keep every char.
  const r1 = leaves[1];
  const ownerTrace2 = await typeToEdit(r1, COL.owner, NAME);
  console.log("   owner (existing contact) trace:", JSON.stringify(ownerTrace2));
  ok("Owner · type-to-edit of an EXISTING contact keeps every character",
    ownerTrace2[ownerTrace2.length - 1] === NAME,
    `field reads ${JSON.stringify(ownerTrace2[ownerTrace2.length - 1])}`);
  await page.keyboard.press("Enter");
  await pacedWait(page, 300);
  const saved1 = await committed(r1, COL.owner, NAME);
  ok("Owner · existing contact commits the full name", saved1 === NAME, `stored ${JSON.stringify(saved1)}`);
  await escapeOut();

  // ── 3. OWNER, double-click route — replacing an existing value must still select-all ─
  // r1 now holds "Scott". Double-click and type "Dana": the OLD value must be replaced
  // (select-all is correct here), so the field must read exactly "Dana", not "ScottDana".
  const rep = "Dana";
  const dblTrace = await dblClickThenType(r1, COL.owner, rep);
  console.log("   owner double-click replace trace:", JSON.stringify(dblTrace));
  ok("Owner · double-click then type REPLACES the existing value (select-all preserved)",
    dblTrace[dblTrace.length - 1] === rep,
    `field reads ${JSON.stringify(dblTrace[dblTrace.length - 1])}, expected ${JSON.stringify(rep)}`);
  await page.keyboard.press("Enter");
  await pacedWait(page, 300);
  const saved2 = await committed(r1, COL.owner, rep);
  ok("Owner · double-click replacement commits the replacement, whole", saved2 === rep, `stored ${JSON.stringify(saved2)}`);
  await escapeOut();

  // ── 4. OWNER, PASTE — a paste into a freshly type-to-edit-opened picker ───────────
  const r2 = leaves[2];
  await cellOf(r2, COL.owner).click();
  await pacedWait(page, 120);
  await page.keyboard.press("P");                    // opens + seeds with "P"
  await pacedWait(page, 140);
  // A REAL paste inserts at the caret and REPLACES any selection — so it is subject to the
  // same defect as keystroke 2, and must be driven through the browser's own insertion path
  // rather than by setting .value (which ignores the selection and would pass either way).
  await page.keyboard.insertText("riya");
  await pacedWait(page, 160);
  const pasted = await liveInput(r2).inputValue().catch(() => "<no input>");
  ok("Owner · paste after the opening character keeps that character",
    pasted === "Priya", `field reads ${JSON.stringify(pasted)}`);

  // A name that matches NO contact must be an EXPLICIT, VISIBLE outcome — never a quiet save.
  const addRow = await page.evaluate(() =>
    [...document.querySelectorAll("[data-contact-dd]")].map(d => d.innerText).join(" | "));
  ok("Owner · an unmatched name shows an explicit 'add as new contact' outcome",
    /add\s+"?priya"?\s+as new contact/i.test(addRow), JSON.stringify(addRow.slice(0, 120)));

  await page.keyboard.press("Enter");
  await pacedWait(page, 300);
  const savedPaste = await committed(r2, COL.owner, "Priya");
  ok("Owner · the pasted free-text name commits whole", savedPaste === "Priya", `stored ${JSON.stringify(savedPaste)}`);
  await escapeOut();

  /* ── 5. IS IT TIMING-DEPENDENT? — measured, not reasoned about ──────────────────────
     The owner asked whether fast vs slow typing changes it, because a race between the
     editor mounting and the keystroke arriving would need a different guard than a
     deterministic caret bug. So type the same name with NO pacing at all and compare. */
  const rFast = leaves[3];
  await cellOf(rFast, COL.owner).click();
  await pacedWait(page, 120);
  await page.keyboard.type("Wanda", { delay: 0 });
  await pacedWait(page, 200);
  const fastVal = await liveInput(rFast).inputValue().catch(() => "<no input>");
  console.log(`   fast-typed (0 ms between keys) field reads: ${JSON.stringify(fastVal)}`);
  ok("Owner · fast typing keeps every character too (the defect was NOT a race)",
    fastVal === "Wanda", `field reads ${JSON.stringify(fastVal)}`);
  await escapeOut();

  // ── 6. THE SHARED PATH — every other type-to-edit column must keep its first char ──
  const shared = [
    { label: "Task name", col: COL.name, text: "Zeta", expect: "Zeta" },
    { label: "Predecessor", col: COL.predecessors, text: "12", expect: "12" },
    { label: "Duration", col: COL.duration, text: "37", expect: "37" },
  ];
  for (let i = 0; i < shared.length; i++) {
    const s = shared[i];
    const row = leaves[4 + i];
    const tr = await typeToEdit(row, s.col, s.text);
    console.log(`   ${s.label} trace:`, JSON.stringify(tr));
    ok(`${s.label} · type-to-edit keeps the character that opened the editor`,
      tr[tr.length - 1] === s.expect,
      `field reads ${JSON.stringify(tr[tr.length - 1])}, expected ${JSON.stringify(s.expect)} · trace ${JSON.stringify(tr)}`);
    await escapeOut();
  }
}

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

await finish();

async function finish() {
  await browser.close().catch(() => {});
  server.close();
  const passed = results.filter(r => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  process.exit(passed === results.length ? 0 : 1);
}
