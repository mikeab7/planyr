/* NEW-1 — CREATING A PERSON IS A DECISION, SO IT IS ASKED.
 *
 * The Owner field used to auto-add any unrecognised text as a contact, silently. A typo became a
 * person that then looked exactly as real as one meant on purpose — the registry really has held
 * `Can give up trailer parlking` and a bare email address this way. And it is the case that matters:
 * the B443536 sweep showed a name NOT already in the registry is precisely the one that saved mangled.
 *
 * This harness drives the real scheduler in a real browser and asserts BOTH halves of every route —
 * what the field shows AND what is committed to the task — because a prompt that leaks a commit is
 * worse than no prompt.
 *
 * The shape being defended, in one line: only genuinely-new text asks; declining returns the typed
 * text UNHARMED; and nothing is written until the question is answered.
 *
 * Run:  node ui-audit/verify-contact-confirm.mjs        [PW_CHROME=<chrome>]
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

/* The Schedule page pulls React / ReactDOM / Babel / supabase-js from CDNs the BROWSER cannot reach
   in this sandbox, and the failure is silent — the page renders an empty body while a naive probe
   still reads app copy out of the inline <script> text and reports a confident pass. Node CAN reach
   them, so vendor once and serve locally: same bytes, same versions, only the origin changes. */
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
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. One precondition
   covers both, rAF liveness probe included; see ui-audit/lib/tabTiming.mjs. */
await assertMeasurable(page, "verify-contact-confirm");
const pageErrors = [];
page.on("pageerror", e => pageErrors.push(e.message));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => pageErrors.push("GOTO: " + e.message));
const booted = await page.waitForSelector("[data-task-row]", { timeout: 30000 }).then(() => true).catch(() => false);
ok("scheduler boots", booted);
if (!booted) await finish();

const OWNER = 9;   // DEFAULT_GRID_COLS index of responsibleParty
const cellOf = (r) => page.locator(`[data-task-row="${r}"] > div`).nth(OWNER);
const liveInput = (r) => page.locator(`[data-task-row="${r}"] input`).first();
const confirmBox = () => page.locator("[data-contact-confirm]");

const leaves = await page.evaluate(() => [...document.querySelectorAll("[data-task-row]")]
  .filter(d => !/[▾▸]/.test(d.children[1]?.innerText || "")).slice(0, 9).map(d => +d.getAttribute("data-task-row")));
ok("found leaf rows to drive", leaves.length >= 7, "rows=" + JSON.stringify(leaves));

async function escapeOut() {
  for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape").catch(()=>{}); await pacedWait(page, 80); }
}
// Committed value: read off the CLOSED cell, which renders from the task model — not the input.
async function committed(r, expect) {
  for (let i = 0; i < 12; i++) {
    if (!(await page.locator(`[data-task-row="${r}"] input`).count())) {
      const t = (await cellOf(r).innerText()).trim();
      if (t === expect || i > 6) return t;
    }
    await pacedWait(page, 120);
  }
  return (await cellOf(r).innerText()).trim();
}
async function typeInto(r, text) {
  await cellOf(r).click(); await pacedWait(page, 130);
  for (const ch of text) { await page.keyboard.press(ch === " " ? "Space" : ch); await pacedWait(page, 70); }
}

if (booted && leaves.length >= 7) {
  // ── 1. A brand-new name ASKS, and writes NOTHING until answered ──────────────────
  const r0 = leaves[0];
  const before0 = (await cellOf(r0).innerText()).trim();
  await typeInto(r0, "Jason Bercaw");
  await page.keyboard.press("Enter");
  await pacedWait(page, 300);
  const asked = await confirmBox().count();
  ok("a genuinely-new name ASKS before creating a contact", asked === 1,
    asked ? JSON.stringify((await confirmBox().innerText()).replace(/\n/g, " / ")) : "no prompt appeared");
  ok("the question reads as one plain sentence naming the person",
    /No match — add "Jason Bercaw" as a new contact\?/.test((await confirmBox().innerText().catch(()=>""))),
    JSON.stringify((await confirmBox().innerText().catch(()=>"")).replace(/\n/g," / ")));
  ok("NOTHING is committed while the question is unanswered",
    (await cellOf(r0).innerText()).trim().includes(before0) || (await liveInput(r0).count()) === 1,
    "editor still open, cell unchanged");

  // ── 2. DECLINE returns the typed text INTACT (the class of bug just fixed here) ──
  await page.keyboard.press("Escape");
  await pacedWait(page, 250);
  const backText = await liveInput(r0).inputValue().catch(() => "<editor closed>");
  ok("declining returns to the field with the typed text UNHARMED",
    backText === "Jason Bercaw", `field reads ${JSON.stringify(backText)}`);
  ok("declining dismisses the question", (await confirmBox().count()) === 0);

  // …and the text is genuinely editable, so a typo can be corrected rather than retyped.
  await page.keyboard.press("Backspace"); await pacedWait(page, 120);
  const edited = await liveInput(r0).inputValue().catch(() => "");
  ok("after declining, the text is editable in place (caret at the end)",
    edited === "Jason Berca", `field reads ${JSON.stringify(edited)}`);
  await escapeOut();
  ok("a declined name is never written to the task",
    !(await cellOf(r0).innerText()).includes("Jason"), JSON.stringify((await cellOf(r0).innerText()).trim()));

  // ── 3. CONFIRM creates and assigns, whole ────────────────────────────────────────
  const r1 = leaves[1];
  await typeInto(r1, "Jason Bercaw");
  await page.keyboard.press("Enter"); await pacedWait(page, 250);
  await page.locator("[data-contact-confirm-yes]").click();
  await pacedWait(page, 350);
  ok("confirming commits the new owner, whole",
    (await committed(r1, "Jason Bercaw")) === "Jason Bercaw",
    `stored ${JSON.stringify(await committed(r1, "Jason Bercaw"))}`);
  await escapeOut();

  // ── 4. AN EXACT MATCH MUST NOT ASK (the nag test — this is what gets it turned off) ─
  const r2 = leaves[2];
  await typeInto(r2, "Jason Bercaw");
  await page.keyboard.press("Enter"); await pacedWait(page, 300);
  ok("an EXACT match to an existing contact does NOT ask", (await confirmBox().count()) === 0);
  ok("an exact match commits straight through",
    (await committed(r2, "Jason Bercaw")) === "Jason Bercaw",
    `stored ${JSON.stringify(await committed(r2, "Jason Bercaw"))}`);
  await escapeOut();

  // ── 5. PICKING FROM THE FILTERED LIST MUST NOT ASK ──────────────────────────────
  const r3 = leaves[3];
  await typeInto(r3, "Jas");
  await pacedWait(page, 200);
  const row = page.locator('[data-contact-dd] div', { hasText: "Jason Bercaw" }).first();
  ok("the filtered list still offers the match while typing", (await row.count()) > 0);
  if (await row.count()) await row.click();
  await pacedWait(page, 350);
  ok("picking from the list does NOT ask", (await confirmBox().count()) === 0);
  ok("picking from the list commits the contact's FULL name",
    (await committed(r3, "Jason Bercaw")) === "Jason Bercaw",
    `stored ${JSON.stringify(await committed(r3, "Jason Bercaw"))}`);
  await escapeOut();

  // ── 6. THE EXPLICIT "+ Add … as new contact" ROW MUST NOT DOUBLE-ASK ────────────
  const r4 = leaves[4];
  await typeInto(r4, "Priya Nair");
  await pacedWait(page, 200);
  const addRow = page.locator('[data-contact-dd] div', { hasText: "as new contact" }).first();
  if (await addRow.count()) await addRow.click();
  await pacedWait(page, 350);
  ok("the explicit '+ Add as new contact' row creates WITHOUT a second question",
    (await confirmBox().count()) === 0 && (await committed(r4, "Priya Nair")) === "Priya Nair",
    `stored ${JSON.stringify(await committed(r4, "Priya Nair"))}`);
  await escapeOut();

  // ── 7. BLUR / CLICK-AWAY must not silently create ───────────────────────────────
  const r5 = leaves[5];
  await typeInto(r5, "Wanda Zephyr");
  await page.mouse.click(1400, 700);          // click far away, outside the editor
  await pacedWait(page, 350);
  ok("clicking away with unrecognised text ASKS instead of creating silently",
    (await confirmBox().count()) === 1);
  ok("clicking away commits NOTHING until answered",
    !(await cellOf(r5).innerText()).includes("Wanda"), JSON.stringify((await cellOf(r5).innerText()).trim()));
  await page.locator("[data-contact-confirm-no]").click();
  await pacedWait(page, 250);
  ok("the 'Keep editing' button returns the text unharmed",
    (await liveInput(r5).inputValue().catch(()=> "")) === "Wanda Zephyr",
    `field reads ${JSON.stringify(await liveInput(r5).inputValue().catch(()=>""))}`);
  await escapeOut();

  // ── 8. CLEARING an owner is not a creation — it must not ask ────────────────────
  const r6 = leaves[6];
  await cellOf(r6).dblclick(); await pacedWait(page, 220);
  await page.keyboard.press("Control+a"); await page.keyboard.press("Delete");
  await pacedWait(page, 130);
  await page.keyboard.press("Enter"); await pacedWait(page, 300);
  ok("clearing the field does NOT ask", (await confirmBox().count()) === 0);
  await escapeOut();
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
