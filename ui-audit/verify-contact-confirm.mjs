/* NEW-1/NEW-5 — CREATING A PERSON IS STILL A DECISION, BUT NOW ONE STEP, NOT TWO.
 *
 * The Owner field used to auto-add any unrecognised text as a contact, silently. A typo became a
 * person that then looked exactly as real as one meant on purpose — the registry really has held
 * `Can give up trailer parlking` and a bare email address this way. The FIRST fix for that (a
 * separate "Add contact?" confirm popup) traded that risk for a different complaint: Michael,
 * verbatim, "it says add contact, and then I have to click add contact or something similar
 * again" — the popup was a SECOND confirmation on top of an already-deliberate action (typing a
 * full name and pressing Enter, or clicking the dropdown's own "+ Add" row), and that redundancy
 * is what this harness now defends against reintroducing.
 *
 * NEW-1 also made Owner a LIST: several people, ordered, the first accountable. This harness
 * covers both changes together because they share one component (ContactPicker) and one failure
 * mode — a silent, undeliberate write to the task or the contact registry.
 *
 * This harness drives the real scheduler in a real browser and asserts BOTH halves of every route
 * — what the field shows AND what is committed to the task — because a UI that looks right but
 * commits the wrong thing is worse than a UI that looks wrong.
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
const warnBox = () => page.locator("[data-owner-warn]");
const addNewRow = () => page.locator("[data-owner-add-new]");

const leaves = await page.evaluate(() => [...document.querySelectorAll("[data-task-row]")]
  .filter(d => !/[▾▸]/.test(d.children[1]?.innerText || "")).slice(0, 11).map(d => +d.getAttribute("data-task-row")));
ok("found leaf rows to drive", leaves.length >= 9, "rows=" + JSON.stringify(leaves));

async function escapeOut() {
  for (let i = 0; i < 4; i++) { await page.keyboard.press("Escape").catch(()=>{}); await pacedWait(page, 80); }
}
/* Close the Owner editor, pressing Enter exactly as many times as the CURRENT state needs — never
   a fixed count. Enter ADDS a chip and keeps editing open; a SECOND Enter, on the now-empty input,
   closes. Over-pressing lands a stray Enter on a CLOSED cell, which can re-open it (this app treats
   Enter-on-a-selected-cell as "start editing") — that reopened, still-blank editor is exactly what
   silently produced the "stored ''" false failures while this harness was being written. */
async function closeOwnerEditor(r) {
  const val = await liveInput(r).inputValue().catch(() => "");
  if (val.trim()) { await page.keyboard.press("Enter"); await pacedWait(page, 200); }
  await page.keyboard.press("Enter");
  await pacedWait(page, 200);
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

if (booted && leaves.length >= 9) {
  // ── 1. A brand-new name creates in ONE action — Enter alone, no second confirm ─────
  const r0 = leaves[0];
  await typeInto(r0, "Jason Bercaw");
  await page.keyboard.press("Enter");                 // ONE action: adds the chip + creates the contact
  await pacedWait(page, 300);
  ok("Enter creates the contact immediately — no confirm popup appears",
    (await page.locator("[data-contact-confirm]").count()) === 0, "the old two-step popup must not exist at all");
  await closeOwnerEditor(r0);                            // input is now empty — one more Enter closes
  ok("the new owner is committed, whole", (await committed(r0, "Jason Bercaw")) === "Jason Bercaw",
    `stored ${JSON.stringify(await committed(r0, "Jason Bercaw"))}`);
  await escapeOut();

  // ── 2. THE EXPLICIT "+ Add … as new contact" DROPDOWN ROW is the SAME one action ──
  const r1 = leaves[1];
  await typeInto(r1, "Priya Nair");
  await pacedWait(page, 200);
  ok("the dropdown offers the explicit add row", (await addNewRow().count()) > 0);
  if (await addNewRow().count()) await addNewRow().click();
  await pacedWait(page, 300);
  ok("clicking it creates WITHOUT any further question", (await page.locator("[data-contact-confirm]").count()) === 0);
  await closeOwnerEditor(r1);
  ok("committed via the dropdown row, whole", (await committed(r1, "Priya Nair")) === "Priya Nair",
    `stored ${JSON.stringify(await committed(r1, "Priya Nair"))}`);
  await escapeOut();

  // ── 3. AN EXACT MATCH MUST NOT ASK, and MUST NOT re-open the create guard either ──
  const r2 = leaves[2];
  await typeInto(r2, "Jason Bercaw");
  await closeOwnerEditor(r2);
  ok("an EXACT match to an existing contact does NOT ask anything", (await warnBox().count()) === 0);
  ok("an exact match commits straight through", (await committed(r2, "Jason Bercaw")) === "Jason Bercaw",
    `stored ${JSON.stringify(await committed(r2, "Jason Bercaw"))}`);
  await escapeOut();

  // ── 4. PICKING FROM THE FILTERED LIST MUST NOT ASK ───────────────────────────────
  const r3 = leaves[3];
  await typeInto(r3, "Jas");
  await pacedWait(page, 200);
  const row = page.locator('[data-contact-dd] div', { hasText: "Jason Bercaw" }).first();
  ok("the filtered list still offers the match while typing", (await row.count()) > 0);
  if (await row.count()) await row.click();
  await pacedWait(page, 250);
  await closeOwnerEditor(r3);
  ok("picking from the list does NOT ask", (await warnBox().count()) === 0);
  ok("picking from the list commits the contact's FULL name", (await committed(r3, "Jason Bercaw")) === "Jason Bercaw",
    `stored ${JSON.stringify(await committed(r3, "Jason Bercaw"))}`);
  await escapeOut();

  // ── 5. BLUR / CLICK-AWAY still never silently creates a contact (the ORIGINAL protection kept in full) ─
  const r4 = leaves[4];
  await typeInto(r4, "Wanda Zephyr");
  await pacedWait(page, 150);
  await page.mouse.click(1400, 700);          // click far away, outside the editor
  await pacedWait(page, 350);
  ok("clicking away with an unconfirmed new name commits NOTHING",
    !(await cellOf(r4).innerText()).includes("Wanda"), JSON.stringify((await cellOf(r4).innerText()).trim()));

  // ── 6. NEW-2 — a comma in the proposed name REFUSES to create it ────────────────
  const r5 = leaves[5];
  await cellOf(r5).click(); await pacedWait(page, 130);
  // A real keystroke opens the editor first (a click alone only SELECTS the cell — insertText
  // has nothing focused to insert into yet). The REST is driven as a real insertion (a paste),
  // not literal comma keystrokes — the comma KEY is a chip delimiter and is intercepted before it
  // ever reaches the text, by design, so only a paste can land a comma in `query` at all.
  await page.keyboard.press("M");
  await pacedWait(page, 140);
  await page.keyboard.insertText("att LeBlanc, Dallas");
  await pacedWait(page, 200);
  await page.keyboard.press("Enter");
  await pacedWait(page, 250);
  ok("a comma in the name is refused with a visible message, not silently split or created",
    (await warnBox().count()) === 1 && /comma/i.test(await warnBox().innerText()),
    (await warnBox().count()) ? await warnBox().innerText() : "no warning shown");
  ok("nothing was committed for the comma-containing text",
    !(await cellOf(r5).innerText()).includes("LeBlanc"), JSON.stringify((await cellOf(r5).innerText()).trim()));
  await escapeOut();

  // ── 7. NEW-2 — a name that is a PREFIX of an existing contact warns, then lets a second click through ─
  // NOTE: Enter does NOT reach this guard here — "Jason Berc" is also a GHOST match (the inline
  // autocomplete for "Jason Bercaw"), and Enter deliberately prefers accepting that ghost (the
  // existing, pre-NEW-1 behavior for "you typed most of a real name"). The prefix guard exists for
  // the OTHER route into creation: explicitly clicking "+ Add … as new contact", which means "no,
  // I really want a new, distinct entry" and is where a likely near-duplicate needs to be caught.
  const r6 = leaves[6];
  await typeInto(r6, "Jason Berc");            // "Jason Bercaw" already exists (added in step 1)
  await pacedWait(page, 150);
  ok("the dropdown still offers the explicit add row despite the ghost match", (await addNewRow().count()) > 0);
  await addNewRow().click();
  await pacedWait(page, 250);
  ok("a prefix-of-an-existing-name warns instead of silently creating a near-duplicate",
    (await warnBox().count()) === 1 && /already exists/i.test(await warnBox().innerText()),
    (await warnBox().count()) ? await warnBox().innerText() : "no warning shown");
  ok("nothing committed on the FIRST attempt", !(await cellOf(r6).innerText()).includes("Jason Berc"));
  ok("the dropdown row is still there for a second, confirming click", (await addNewRow().count()) > 0);
  await addNewRow().click();                   // the SAME name again — now it goes through
  await pacedWait(page, 250);
  await closeOwnerEditor(r6);
  ok("a SECOND confirming click on the same name creates it anyway (friction for a likely mistake, not a block)",
    (await committed(r6, "Jason Berc")) === "Jason Berc", `stored ${JSON.stringify(await committed(r6, "Jason Berc"))}`);
  await escapeOut();

  // ── 8. NEW-1 — several names on ONE task: the first stays first, none replace the others ─
  const r7 = leaves[7];
  await typeInto(r7, "Juan Macias");
  await page.keyboard.press("Enter"); await pacedWait(page, 250);      // adds chip #1, stays open
  await page.keyboard.type("Matt LeBlanc");
  await page.keyboard.press("Enter"); await pacedWait(page, 250);      // adds chip #2, stays open
  await closeOwnerEditor(r7);
  ok("a second owner ADDS rather than replacing the first",
    (await committed(r7, "Juan Macias +1")) === "Juan Macias +1",
    `stored ${JSON.stringify(await committed(r7, "Juan Macias +1"))}`);
  const title7 = await page.evaluate((rid) => {
    const row = document.querySelector(`[data-task-row="${rid}"]`);
    const span = row && [...row.querySelectorAll("span")].find(s => s.title && s.title.includes("Juan"));
    return span ? span.title : null;
  }, r7);
  ok("both names are on hover, in order (first = accountable)", title7 === "Juan Macias, Matt LeBlanc", JSON.stringify(title7));
  await escapeOut();

  // ── 9. NEW-1 — the cap is enforced with a message, never a silent drop ───────────
  const r8 = leaves[8];
  await cellOf(r8).click(); await pacedWait(page, 130);
  const names = ["Alice One", "Bob Two", "Cara Three", "Dan Four", "Eve Five", "Finn Six", "Gale Seven"];
  for (let i = 0; i < names.length; i++) {
    await page.keyboard.type(names[i]);
    await page.keyboard.press("Enter");
    await pacedWait(page, 180);
  }
  ok("the 7th owner is refused with a visible cap message",
    (await warnBox().count()) === 1 && /capped at 6/i.test(await warnBox().innerText()),
    (await warnBox().count()) ? await warnBox().innerText() : "no warning shown");
  // Tab discards the refused, still-typed "Gale Seven" (never committed) and keeps the 6 that
  // already made it in — the SAME "finish, don't try to resolve pending text" gesture Tab always is.
  await page.keyboard.press("Tab");
  await pacedWait(page, 250);
  const capText = await cellOf(r8).innerText();
  ok("exactly 6 owners were kept (the 7th never silently landed)", capText.includes("+5"), JSON.stringify(capText.trim()));
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
