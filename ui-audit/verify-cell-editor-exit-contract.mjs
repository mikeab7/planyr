/* B1341728 / B1341729 — THE CELL-EDITOR EXIT CONTRACT, measured against the real grid.
 *
 * OWNER REPORT (2026-09-15, measured on his own account on a throwaway duplicate schedule,
 * "Operations (Copy)"): open a task's Owner cell, click one contact from the list so it appears
 * as a TAG, then leave the cell — Escape DISCARDED it, Enter DISCARDED it (and moved the cursor
 * down a row, so the loss was silent), Tab and click-away saved. Owners that were ALREADY saved
 * before the edit survived all four, so this destroyed NEW work only.
 *
 * WHAT THIS HARNESS IS FOR, and why it covers every editor rather than the one that was reported:
 * the Owner cell was not special — it was the first editor in this grid to render part of its
 * value in FINISHED form (a chip with its own remove control) while still holding that value as
 * unsaved component state. Every discard path exploited exactly that gap. So the check is the
 * CONTRACT, asked of every editable cell, not a regression test for one of them.
 *
 * THE CONTRACT (three editor classes — see CLAUDE.md's EDITOR-EXIT-CONTRACT named rule):
 *   text   — the value in flight is text the user is still typing. Enter / Tab / click-away
 *            COMMIT it; Escape abandons it. Nothing is rendered as finished, so nothing is lost.
 *   select — a menu. CHOOSING is the commit; the arrow-key highlight is in-progress, not
 *            finished, so an exit taken without choosing correctly leaves the value alone.
 *   tokens — a chip / token field. Every token is written through the MOMENT it is added,
 *            removed or reordered; every exit merely closes the editor and none can discard.
 * And the one invariant that binds all three: NO EXIT MAY REMOVE ANYTHING THE EDITOR RENDERS IN
 * FINISHED FORM. An editor that renders a chosen value as finished while holding it unsaved is a
 * defect by construction, whichever exit happens to expose it.
 *
 * ⛔ VACUITY GUARD (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): this harness carries KNOWN-GOOD arms whose
 * expected answer does not depend on the code under test — a text cell must commit on Tab, and the
 * harness must be able to SEE a value change at all. If a known-good arm does not report its known
 * value the whole run is declared VOID rather than scored, because a probe that cannot see a
 * working case cannot be believed about a broken one.
 *
 * Run:  node ui-audit/verify-cell-editor-exit-contract.mjs   [--json]  [PW_CHROME=<chrome>]
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const JSON_OUT = process.argv.includes("--json");

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

const rows = [];          // audit table rows: {editor, cls, exit, before, after, expected, pass}
const checks = [];        // named assertions
const ok = (name, cond, extra = "") => {
  checks.push({ name, pass: !!cond, extra });
  if (!JSON_OUT) console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`);
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
/* A background tab cannot be measured — not its clock and not its pixels (FOREGROUND-OR-VOID). */
await assertMeasurable(page, "verify-cell-editor-exit-contract");
const pageErrors = [];
page.on("pageerror", e => pageErrors.push(e.message));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => pageErrors.push("GOTO: " + e.message));
const booted = await page.waitForSelector("[data-task-row]", { timeout: 30000 }).then(() => true).catch(() => false);
ok("scheduler boots", booted);

// Default visible column order (DEFAULT_GRID_COLS):
//  0 id · 1 name · 2 start · 3 end · 4 dur · 5 predecessors · 6 successors · 7 health
//  8 status · 9 responsibleParty · 10 cost · 11 notes
const COL = { name: 1, start: 2, end: 3, duration: 4, predecessors: 5, health: 7, owner: 9, cost: 10 };
const EXITS = ["Escape", "Enter", "Tab", "clickaway"];

const leaves = booted ? await page.evaluate(() => {
  const rs = [...document.querySelectorAll("[data-task-row]")];
  const isParent = d => /[▾▸]/.test((d.children[1]?.innerText) || "");
  return rs.filter(d => !isParent(d)).map(d => +d.getAttribute("data-task-row"));
}) : [];
ok("found leaf rows to drive", leaves.length >= 10, "rows=" + leaves.length);

const cellOf = (rowId, colIdx) => page.locator(`[data-task-row="${rowId}"] > div`).nth(colIdx);
const cellText = async (rowId, colIdx) => (await cellOf(rowId, colIdx).innerText()).trim();
const editorOpen = rowId => page.locator(`[data-task-row="${rowId}"] input`).count();

/* Leaving the cell. `clickaway` lands on a DIFFERENT row's Task cell — the ordinary way a person
 * leaves a cell with the mouse. Never a driver scroll: every target here is already on screen. */
async function leaveBy(exit, parkRow) {
  if (exit === "clickaway") await cellOf(parkRow, COL.name).click();
  else await page.keyboard.press(exit);
  await pacedWait(page, 450);
  // A stray still-open editor would poison the NEXT trial's baseline, so close it explicitly.
  for (let i = 0; i < 3 && (await page.locator("input.ei, [data-contact-dd], [data-hmenu]").count()); i++) {
    await page.keyboard.press("Escape"); await pacedWait(page, 140);
  }
}

/* ── text-class editors ─────────────────────────────────────────────────────────────────── */
async function setText(rowId, colIdx, value) {
  await cellOf(rowId, colIdx).dblclick(); await pacedWait(page, 220);
  await page.keyboard.press("Control+a"); await pacedWait(page, 60);
  await page.keyboard.type(value, { delay: 18 }); await pacedWait(page, 120);
  await page.keyboard.press("Tab"); await pacedWait(page, 450);
}
async function textTrial({ editor, colIdx, row, parkRow, base, edited, exit }) {
  await setText(row, colIdx, base);
  const before = await cellText(row, colIdx);
  await cellOf(row, colIdx).dblclick(); await pacedWait(page, 220);
  await page.keyboard.press("Control+a"); await pacedWait(page, 60);
  await page.keyboard.type(edited, { delay: 18 }); await pacedWait(page, 120);
  await leaveBy(exit, parkRow);
  const after = await cellText(row, colIdx);
  // Contract: Escape abandons the typed text; every other exit commits it.
  const expected = exit === "Escape" ? "unchanged" : "committed";
  const changed = after !== before;
  const pass = expected === "unchanged" ? !changed : changed;
  rows.push({ editor, cls: "text", exit, before, after, expected, pass });
  return { before, after, changed };
}

/* ── select-class editor (the health menu) ──────────────────────────────────────────────── */
/* The health cell paints a coloured dot, not a label, so its innerText is EMPTY — reading it
 * would score every arm "unchanged" whatever happened. Read the dot's own painted colour. */
async function healthDot(row) {
  return page.evaluate(rid => {
    const cell = document.querySelector(`[data-picker-cell="health-${rid}"]`);
    const trig = cell && cell.querySelector("[data-health-dot]");
    // NOT querySelector("span > span"): a relative query still matches against the WHOLE document,
    // so the PILL (a span whose parent is also a span) wins and reads transparent. Walk the children.
    const dot = trig && trig.firstElementChild && trig.firstElementChild.firstElementChild;
    return dot ? getComputedStyle(dot).backgroundColor : "<no dot>";
  }, row);
}
/* Park the row on the FIRST menu option so the trial's own two ArrowDowns always land on a
 * genuinely different option — otherwise an "Enter commits" arm can pass or fail purely on
 * whether the highlight happened to start on the value already set. */
async function healthBaseline(row) {
  await cellOf(row, COL.health).click(); await pacedWait(page, 280);
  await page.keyboard.press("ArrowDown"); await pacedWait(page, 150);
  await page.keyboard.press("Enter"); await pacedWait(page, 450);
}
async function healthTrial({ row, parkRow, exit }) {
  await healthBaseline(row);
  const before = await healthDot(row);
  await cellOf(row, COL.health).click(); await pacedWait(page, 280);    // the dot IS the trigger
  await page.keyboard.press("ArrowDown"); await pacedWait(page, 130);   // move the highlight only…
  await page.keyboard.press("ArrowDown"); await pacedWait(page, 130);   // …onto a different option
  await leaveBy(exit, parkRow);
  const after = await healthDot(row);
  // Choosing IS the commit, so only Enter (which chooses) may change the value.
  const expected = exit === "Enter" ? "committed" : "unchanged";
  const changed = after !== before;
  const pass = expected === "unchanged" ? !changed : changed;
  rows.push({ editor: "health", cls: "select", exit, before, after, expected, pass });
  return { before, after };
}

/* ── tokens-class editor (the Owner cell's ContactPicker) ───────────────────────────────── */
async function seedContact(row, name) {
  await cellOf(row, COL.owner).dblclick(); await pacedWait(page, 250);
  await page.keyboard.type(name, { delay: 22 }); await pacedWait(page, 160);
  await page.keyboard.press("Enter"); await pacedWait(page, 220);   // mints + chips the contact
  await page.keyboard.press("Enter"); await pacedWait(page, 400);   // finishes the edit
}
async function clearOwner(row) {
  if (!(await cellText(row, COL.owner))) return;
  await cellOf(row, COL.owner).dblclick(); await pacedWait(page, 280);
  for (let i = 0; i < 8 && (await page.locator("[data-owner-chip-remove]").count()); i++) {
    await page.locator("[data-owner-chip-remove]").first().click(); await pacedWait(page, 130);
  }
  await page.keyboard.press("Tab"); await pacedWait(page, 420);
}
/* ⛔ TWO WAYS TO PUT A CHIP IN THE EDITOR, AND THEY ARE NOT INTERCHANGEABLE HERE.
 *
 * `pickFromList` CLICKS a row in the contact dropdown. That is the gesture the owner actually
 * reported ("click one contact from the list so it appears as a tag"), so every TRIAL below uses
 * it — swapping it for something more convenient would leave the reported gesture untested, which
 * is the WRONG-CASE mistake in miniature.
 *
 * `seedByComma` types the name followed by a comma; the comma parser commits it as a tag with no
 * click at all. That is used for SETUP ONLY — minting contacts and staging prior owners, where the
 * question is "is this chip on the task", never "does clicking the list work".
 *
 * Why the second one exists at all: Michael's own live pass (V978448, 2026-09-15) reported that
 * coordinate clicks on the dropdown MISSED REPEATEDLY on the real page and that refining the
 * arithmetic did not help, while the comma route worked first time. The dropdown is a fixed-position
 * popup portaled to the body and re-measured every frame by a rAF loop, so its rect is a moving
 * target for anything computing coordinates; a text-locator click is steadier than raw coordinates
 * but is still geometry-dependent. Setup that fails for a reason unrelated to the property under
 * test is a harness that wastes a run, so setup takes the route with no geometry in it. */
async function setOwners(row, names) {
  await clearOwner(row);
  if (!names.length) return;
  await cellOf(row, COL.owner).dblclick(); await pacedWait(page, 280);
  for (const nm of names) { await seedByComma(nm); }
  await page.keyboard.press("Tab"); await pacedWait(page, 420);
}
/* SETUP ONLY — never a trial. Assumes the picker is already open. */
async function seedByComma(name) {
  await page.keyboard.type(name, { delay: 20 }); await pacedWait(page, 140);
  await page.keyboard.press(",");                await pacedWait(page, 220);
}
/* THE REPORTED GESTURE — used by every trial. */
async function pickFromList(name) {
  await page.locator(`[data-contact-dd] >> text="${name}"`).first().click({ force: true });
  await pacedWait(page, 220);
}
/* One owner trial. `prior` is what is already SAVED on the task; `adds` are chosen from the list
 * during the edit (so they are rendered as finished chips); `removeFirstPrior` deletes a saved
 * owner's chip instead. Returns the owner list the task really holds afterwards, read from the
 * model through the app's own hover title (the full list, not the "+N" summary). */
async function ownerList(row) {
  return page.evaluate(rid => {
    const r = document.querySelector(`[data-task-row="${rid}"]`);
    if (!r) return null;
    const cells = [...r.children];
    const cell = cells[9];
    const span = cell && cell.querySelector("span[title]");
    if (span && span.title) return span.title.split(",").map(s => s.trim()).filter(Boolean);
    const txt = (cell?.innerText || "").trim();
    return txt && txt !== "—" ? [txt] : [];
  }, row);
}
async function ownerTrial({ row, parkRow, exit, prior = [], adds = [], removeFirst = false, newName = null, label }) {
  await setOwners(row, prior);
  const before = await ownerList(row);
  await cellOf(row, COL.owner).dblclick(); await pacedWait(page, 300);
  if (removeFirst) { await page.locator("[data-owner-chip-remove]").first().click(); await pacedWait(page, 200); }
  for (const nm of adds) await pickFromList(nm);
  if (newName) {
    await page.keyboard.type(newName, { delay: 22 }); await pacedWait(page, 160);
    await page.keyboard.press("Enter"); await pacedWait(page, 250);   // mints the contact + chips it
  }
  const chipsShown = await page.evaluate(() =>
    [...document.querySelectorAll("[data-owner-chip]")].map(d => d.textContent.replace("×", "").trim()));
  await leaveBy(exit, parkRow);
  const after = await ownerList(row);
  // Contract: a chip is rendered FINISHED, so every exit must keep exactly what the editor showed.
  const pass = JSON.stringify(after) === JSON.stringify(chipsShown);
  rows.push({ editor: "responsibleParty" + (label ? ` (${label})` : ""), cls: "tokens", exit,
    before: before.join(", ") || "—", after: after.join(", ") || "—", expected: chipsShown.join(", ") || "—", pass });
  return { before, after, chipsShown };
}

let VOID = false;
if (booted && leaves.length >= 12) {
  const park = leaves[11];

  /* ── VACUITY GUARD — a known-good arm whose answer does not depend on the code under test.
     A text cell must commit on Tab. If the harness cannot see THAT, it cannot be believed about
     anything below, so the run is VOID rather than scored. */
  const known = await textTrial({ editor: "name", colIdx: COL.name, row: leaves[0], parkRow: park,
    base: "Contract base A", edited: "Contract edit A", exit: "Tab" });
  if (!known.changed) VOID = true;
  ok("VACUITY GUARD — the harness can see a committed text change (known-good arm)", known.changed,
    `before=${JSON.stringify(known.before)} after=${JSON.stringify(known.after)}`);

  if (!VOID) {
    // ── text class ────────────────────────────────────────────────────────────────────────
    const TEXT = [
      { editor: "name",         colIdx: COL.name,         row: leaves[0], base: "Contract base",  edited: "Contract edited" },
      { editor: "start",        colIdx: COL.start,        row: leaves[1], base: "6/1/27",         edited: "6/8/27" },
      { editor: "end",          colIdx: COL.end,          row: leaves[2], base: "9/1/27",         edited: "9/8/27" },
      { editor: "duration",     colIdx: COL.duration,     row: leaves[3], base: "5",              edited: "9" },
      { editor: "predecessors", colIdx: COL.predecessors, row: leaves[4], base: String(leaves[0]), edited: String(leaves[1]) },
      { editor: "cost",         colIdx: COL.cost,         row: leaves[5], base: "1000",           edited: "2500" },
    ];
    for (const spec of TEXT) for (const exit of EXITS) await textTrial({ ...spec, parkRow: park, exit });

    // ── select class ──────────────────────────────────────────────────────────────────────
    for (const exit of EXITS) await healthTrial({ row: leaves[6], parkRow: park, exit });

    // ── tokens class — the reported defect and its adjacent cases ─────────────────────────
    await seedContact(leaves[7], "Alice Adams");
    await seedContact(leaves[8], "Bob Brown");
    await seedContact(leaves[9], "Cara Chen");
    await clearOwner(leaves[7]); await clearOwner(leaves[8]); await clearOwner(leaves[9]);

    for (const exit of EXITS) await ownerTrial({ row: leaves[7], parkRow: park, exit, prior: [], adds: ["Alice Adams"], label: "no prior owner" });
    for (const exit of EXITS) await ownerTrial({ row: leaves[7], parkRow: park, exit, prior: ["Bob Brown"], adds: ["Alice Adams"], label: "one prior owner" });
    for (const exit of EXITS) await ownerTrial({ row: leaves[7], parkRow: park, exit, prior: ["Bob Brown", "Cara Chen"], adds: ["Alice Adams"], label: "two prior owners" });
    for (const exit of EXITS) await ownerTrial({ row: leaves[8], parkRow: park, exit, prior: [], adds: ["Alice Adams", "Bob Brown", "Cara Chen"], label: "three adds" });
    for (const exit of EXITS) await ownerTrial({ row: leaves[8], parkRow: park, exit, prior: ["Alice Adams", "Bob Brown"], removeFirst: true, label: "remove a saved owner" });

    // A BRAND-NEW contact, minted during the edit: the chip must survive every exit, and the
    // contact must never be left created-but-unassigned (the quieter second leak).
    let n = 0;
    for (const exit of EXITS) {
      const nm = `Newbie ${exit}${++n}`;
      const t = await ownerTrial({ row: leaves[9], parkRow: park, exit, prior: [], newName: nm, label: "brand-new contact" });
      ok(`brand-new contact survives ${exit} — created AND assigned, never orphaned`,
        JSON.stringify(t.after) === JSON.stringify(t.chipsShown),
        `chips=${JSON.stringify(t.chipsShown)} saved=${JSON.stringify(t.after)}`);
    }

    // Click-away to a cell in the SAME row (a different landing spot than the trials above).
    await setOwners(leaves[7], []);
    await cellOf(leaves[7], COL.owner).dblclick(); await pacedWait(page, 300);
    await pickFromList("Alice Adams");
    await cellOf(leaves[7], COL.name).click(); await pacedWait(page, 450);
    const sameRow = await ownerList(leaves[7]);
    rows.push({ editor: "responsibleParty (click-away, same row)", cls: "tokens", exit: "clickaway-samerow",
      before: "—", after: sameRow.join(", ") || "—", expected: "Alice Adams", pass: sameRow.join(", ") === "Alice Adams" });
    ok("owner survives a click-away onto another cell in the SAME row",
      sameRow.join(", ") === "Alice Adams", JSON.stringify(sameRow));
  }
}

/* ── verdicts ───────────────────────────────────────────────────────────────────────────── */
const tokenRows = rows.filter(r => r.cls === "tokens");
const textRows  = rows.filter(r => r.cls === "text");
const selRows   = rows.filter(r => r.cls === "select");

ok("TEXT editors honour the contract on all four exits", textRows.length > 0 && textRows.every(r => r.pass),
  textRows.filter(r => !r.pass).map(r => `${r.editor}/${r.exit}`).join(", ") || "all pass");
ok("SELECT editors honour the contract on all four exits", selRows.length > 0 && selRows.every(r => r.pass),
  selRows.filter(r => !r.pass).map(r => `${r.editor}/${r.exit}`).join(", ") || "all pass");
ok("TOKEN editors keep every chip the editor showed, on all four exits", tokenRows.length > 0 && tokenRows.every(r => r.pass),
  tokenRows.filter(r => !r.pass).map(r => `${r.editor}/${r.exit}`).join(", ") || "all pass");
ok("no page errors", pageErrors.length === 0, pageErrors.join(" | "));

if (!JSON_OUT) {
  console.log("\n── AUDIT TABLE — editor × exit gesture ──────────────────────────────────────");
  const w = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`${w("editor", 42)}${w("class", 8)}${w("exit", 18)}${w("before", 22)}${w("after", 22)}${w("expected", 12)}ok`);
  for (const r of rows) console.log(`${w(r.editor, 42)}${w(r.cls, 8)}${w(r.exit, 18)}${w(r.before, 22)}${w(r.after, 22)}${w(r.expected, 12)}${r.pass ? "✅" : "❌"}`);
}

const failed = checks.filter(c => !c.pass);
if (JSON_OUT) console.log(JSON.stringify({ void: VOID, rows, checks }, null, 2));
else {
  console.log(`\n${failed.length ? "❌" : "✅"} ${checks.length - failed.length}/${checks.length} checks passed` + (VOID ? "  ·  RUN VOID (vacuity guard)" : ""));
}
await browser.close(); server.close();
process.exit(VOID || failed.length ? 1 : 0);
