/* verify-notes-project-integrity — A COPY NEVER CHANGES PROJECT, AND THE APP SAYS SO.
 *
 * ⛔ WHAT THIS IS FOR. One note — Grand Port's "Coordination" — turned up with a
 * near-identical twin filed under an unrelated Colorado pursuit. Nobody was told when it
 * happened; it was found by hand six days later, under a "from a project you deleted"
 * heading, because the pursuit had since been binned. Three things were missing and all
 * three are driven here, in a real browser, against the real build:
 *
 *   1. THE NOTE NEVER SAID WHICH PROJECT IT BELONGED TO while it was open (NEW-2).
 *   2. NOTHING LOOKED for one note living in two projects (NEW-4).
 *   3. A NOTE WHOSE TREE NODE WAS LOST was swept off this device every time the tab opened
 *      and downloaded again on the next sync, reachable from nowhere, in silence (NEW-4).
 *
 * ⛔ AND EVERY ROW ASSERTS THE RESULTING STORE, NOT THAT A HANDLER RAN. The banner's own
 * counts are read from its data attributes, but the recovery is checked by reading the TREE
 * back out of localStorage — a banner that says the right thing over a store that did not
 * change is exactly the shape this whole item exists to stop.
 *
 * ⛔ MUTATION ARM INCLUDED (arm 5): the same two documents, moved into the SAME project, must
 * make the banner DISAPPEAR. A detector nobody has seen go quiet is a detector that will fire
 * on everything.
 *
 * Run:
 *   npx vite preview --port 4173 &
 *   node ui-audit/verify-notes-project-integrity.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const checks = [];
const ok = (name, cond, extra = "") => {
  checks.push({ name, pass: !!cond });
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const REMOTE = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--ignore-certificate-errors", ...(REMOTE && PROXY ? [`--proxy-server=${PROXY}`] : [])],
});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();

/* ⛔ FOREGROUND-OR-VOID. A hidden tab clamps setTimeout and suspends rAF, so both the clock
 * and the geometry of every measurement below would be void — and internally consistent
 * while being void, which is the dangerous half. */
await assertMeasurable(page, "verify-notes-project-integrity");

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";
const tb = (id) => page.locator(`[data-testid="${id}"]`);
const readTree = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), TREE_KEY);

/* The owner's own note, and his own divergence: the two copies differed by ONE WORD in about
 * forty. Kept at full length on purpose — a short fixture makes the near-duplicate question
 * trivially easy and proves nothing about the real one. */
const LINES = [
  "Civil", "PLAT", "Resubmitted to Baytown 7/13", "CP Grant To Others",
  "Civil working to include irrigation line", "Sanitary Line Extension",
  "Can we get this reimbursed?", "Water / Sanitary Additional Reservation",
  "Working to schedule payment", "LONOs", "Last email to DOW was 7/13, they responded on 7/16",
  "Truck Turn Exhibit", "Quiddity looking into expanding areas, WB-67", "Permitting",
];
const doc = (plat) => ({
  type: "doc",
  content: LINES.map((l) => ({ type: "paragraph", content: [{ type: "text", text: l === "PLAT" ? plat : l }] })),
});
const ORPHAN = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Channel improvements were needed to slow down conveyance. Willow Point MUD to provide water and sanitary." }] }],
};

/* ⛔ HIS REAL PAGE ID, deliberately: the id encodes the moment the page was made
   (`Date.now()` in base 36), which is the one fact that survives a lost node — so a made-up
   id would skip the very path that recovers the date. */
const LOST_ID = "pg_msgaajbf1o61rit";
const GRAND_PORT = "smqfy2r7pdec";
const COLORADO = "sms7v3ua7ksy";

/** Seed the device exactly as it would be after the defect: the same note in two projects,
 *  plus a body whose tree node has gone. `sameProject` is the mutation arm. */
async function seed({ sameProject = false } = {}) {
  await page.evaluate(([treeKey, prefix, tree, bodies]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify(tree));
    for (const [id, body] of Object.entries(bodies)) localStorage.setItem(prefix + id, JSON.stringify(body));
  }, [
    TREE_KEY,
    PAGE_PREFIX,
    {
      v: 3,
      pages: [
        { id: "gp_coord", title: "Coordination", createdAt: 1, updatedAt: 1, pages: [], projectId: GRAND_PORT },
        { id: "co_page1", title: "Page 1", createdAt: 1, updatedAt: 1, pages: [], projectId: sameProject ? GRAND_PORT : COLORADO },
      ],
      trash: [],
    },
    { gp_coord: doc("RPlat"), co_page1: doc("Plat"), [LOST_ID]: ORPHAN },
  ]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });
  /* Read the tree IMMEDIATELY — auto-adoption is deliberately late but it is not slow, and by
     the time the banner is on screen the recovery has already happened. That is the feature;
     capturing "before" after waiting for the banner would be measuring the wrong moment. */
  return readTree();
}

/* The integrity scan is deliberately LATE (it reads every body, so it waits for the tree to
 * settle). Wait for the banner on its own terms rather than assuming a number. */
const waitForBanner = async (ms = 12000) => {
  try { await tb("notes-integrity-banner").waitFor({ state: "visible", timeout: ms }); return true; }
  catch (_) { return false; }
};

await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });

/* ════ 1. THE SAME NOTE IN TWO PROJECTS IS NAMED, UNPROMPTED ═══════════════════════════ */
console.log("\n1 · One note, two projects — said out loud (NEW-4)");
const seeded = await seed();
ok("⛔ THE BANNER APPEARS WITH NOBODY ASKING FOR IT", await waitForBanner());

const banner = tb("notes-integrity-banner");
const dupCount = await banner.getAttribute("data-duplicates");
const lostCount = await banner.getAttribute("data-unreachable");
ok("…and it found exactly ONE duplicated note", dupCount === "1", `data-duplicates=${dupCount}`);
const recoveredCount = await banner.getAttribute("data-recovered");
ok("…and the note that was filed nowhere is reported as RECOVERED, not as still lost",
  recoveredCount === "1" && lostCount === "0", `data-recovered=${recoveredCount} data-unreachable=${lostCount}`);

const text = (await banner.innerText()).replace(/\s+/g, " ");
ok("it names the note by TITLE, not by id", /Coordination/.test(text) && /Page 1/.test(text), text.slice(0, 150));
ok("…and says how many projects it is in", /2 different projects/.test(text));
ok("…and names the second finding in plain words", /has been put back/.test(text), text.slice(-140));

/* ════ 2. THE LOST NOTE IS ALREADY BACK, AND THE BAR SAYS SO ══════════════════════════
 *
 * ⛔ SUPERSEDED BY NEW-1's SECOND ROUND, AND THE CHANGE IS THE POINT. The first version of
 * this bar said "One note is filed in no project and reachable from nowhere" and offered a
 * "Put it back" button. The owner's verdict: a correct finding, rendered useless — it named
 * no note, opened nothing, and left a real note sitting lost while a banner talked about it.
 * Recovery is now done BY THE TIME the bar is read. */
console.log("\n2 · A note filed nowhere is already back, and the bar names it (NEW-1)");
const before = seeded;
const beforeIds = (before.pages || []).map((p) => p.id);
ok("before: the lost note is in NO tree — that is why nothing could reach it", !beforeIds.includes(LOST_ID), beforeIds.join(", "));

// The scan is deliberately late; wait for the recovery on its own terms.
await tb("notes-recovered-summary").waitFor({ state: "visible", timeout: 15000 });
const summary = (await tb("notes-recovered-summary").innerText()).replace(/\s+/g, " ");
ok("⛔ THE BAR REPORTS WHAT ALREADY HAPPENED, not what could", /has been put back/.test(summary), summary.slice(0, 120));
ok("…and says WHY it has no name, rather than inventing one", /name lived on the entry that went missing/.test(summary));
ok("…and is plural-correct for one", /^One note had lost its place/.test(summary));

const lostRow = tb(`notes-recovered-${LOST_ID}`);
ok("⛔ IT NAMES THE NOTE — by its own first line, which is all that survived", await lostRow.count() > 0);
const rowText = (await lostRow.innerText()).replace(/\s+/g, " ");
ok("…with the words the person actually wrote", /Channel improvements/i.test(rowText), rowText.slice(0, 90));
ok("…how much of it there is", /\d+ characters/.test(rowText), (rowText.match(/\d+ characters/) || [""])[0]);
ok("…and when it was written, recovered from the id itself", /written /.test(rowText), (rowText.match(/written [^·]*/) || [""])[0].trim());

const after = await readTree();
const recovered = (after.pages || []).find((p) => p.id === LOST_ID);
ok("⛔ AND THE STORED TREE HOLDS IT — not just the banner", !!recovered, (after.pages || []).map((p) => p.id).join(", "));
ok("…in the named no-project home, with NOTHING guessed", recovered && (recovered.projectId ?? null) === null, `projectId=${JSON.stringify(recovered?.projectId ?? null)}`);
ok("…it kept its own id, so its existing body is what it re-attached to", recovered?.id === LOST_ID);
ok("…and its name says it is a recovery rather than pretending to be the original",
  String(recovered?.title || "").startsWith("Recovered — "), JSON.stringify(recovered?.title));
ok("…the exact page count went up by ONE and nothing else moved", (after.pages || []).length === (before.pages || []).length + 1);
ok("…and every pre-existing page still answers with the project it had",
  beforeIds.every((id) => {
    const b = (before.pages || []).find((p) => p.id === id);
    const a = (after.pages || []).find((p) => p.id === id);
    return (a?.projectId ?? null) === (b?.projectId ?? null);
  }));

/* …and the ways out are in the bar itself, which is the half that was missing. */
ok("it offers to file it under a project, inline", await tb(`notes-recovered-file-${LOST_ID}`).count() > 0);
ok("…and to bin it, for the honest answer that they did not want it", await tb(`notes-recovered-bin-${LOST_ID}`).count() > 0);

/* ════ 3. THE OPEN NOTE SAYS WHICH PROJECT IT IS IN ════════════════════════════════════ */
console.log("\n3 · The note says where it is filed, while you are reading it (NEW-2)");
await tb("notes-integrity-open").click().catch(() => {});
await pacedWait(page, 600);

const badge = tb("note-project-badge");
ok("⛔ THE OPEN NOTE WEARS ITS PROJECT — the thing that was invisible before", await badge.count() > 0);
if (await badge.count()) {
  const pid = await badge.getAttribute("data-project-id");
  const label = (await badge.innerText()).trim();
  const title = await tb("note-title").inputValue();
  const node = (await readTree()).pages.find((p) => p.title === title);
  ok("…and the project it names is the one the TREE says, not one the viewer supplied",
    pid === String(node?.projectId ?? ""), `badge=${pid} tree=${node?.projectId ?? null}`);
  ok("…an id with no project behind it is NAMED as such, never captioned as 'no project'",
    (await badge.getAttribute("data-resolved")) === "0" && /no longer exists|couldn/i.test(label), label);
}

/* …and the recovered note, which genuinely belongs nowhere, says exactly that instead.
 * "Show me" navigated INTO Grand Port (that is the point — the copy is usually somewhere
 * else), and inside a project the rail shows that project and nothing else, so the way back
 * to a no-project note is the all-notes view. */
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });
await tb(`notes-row-${LOST_ID}`).click();
await pacedWait(page, 600);
const lostLabel = (await tb("note-project-badge").innerText()).trim();
ok("a note that genuinely belongs to no project says so, in words", /Not in a project/.test(lostLabel), lostLabel);
ok("…and that is a RESOLVED answer, not a failed lookup wearing the same words",
  (await tb("note-project-badge").getAttribute("data-resolved")) === "1");

/* ════ 4. IT SURVIVES A RELOAD — the recovery reached storage, not just React ══════════ */
console.log("\n4 · The recovery is in storage, not in a render");
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });
const reloaded = await readTree();
ok("⛔ THE RECOVERED NOTE IS STILL THERE AFTER A RELOAD", (reloaded.pages || []).some((p) => p.id === LOST_ID));
ok("…and its body was never destroyed by the orphan sweep on the way through",
  await page.evaluate((k) => !!localStorage.getItem(k), `${PAGE_PREFIX}${LOST_ID}`));
ok("…and the banner no longer claims a lost note, because there isn't one",
  (await waitForBanner(9000)) ? (await tb("notes-integrity-banner").getAttribute("data-unreachable")) === "0" : true);

/* ════ 5. MUTATION ARM — the same two notes in ONE project must go QUIET ═══════════════ */
console.log("\n5 · MUTATION — same words, SAME project: the banner must go quiet");
await seed({ sameProject: true });
const stillThere = await waitForBanner(9000);
if (stillThere) {
  const dup = await tb("notes-integrity-banner").getAttribute("data-duplicates");
  ok("⛔ COPYING A NOTE INSIDE ITS OWN PROJECT IS NOT A FINDING", dup === "0", `data-duplicates=${dup}`);
} else {
  ok("⛔ COPYING A NOTE INSIDE ITS OWN PROJECT IS NOT A FINDING", true, "banner absent entirely");
}

/* ════ 6. DELETING A PROJECT SAYS WHAT IT IS ABOUT TO ORPHAN (NEW-3) ═══════════════════
 *
 * The delete confirmation for a NOTE already does this well — "Delete 2?" and then "Deleted
 * DEV COORDINATION and its 2 pages. It is in the bin for 30 days." Project deletion said
 * nothing at all, which is how two notes ended up under a "from a project you deleted"
 * heading with the owner none the wiser. */
console.log("\n6 · Deleting a project names its notes, and offers to take them along (NEW-3)");
/* ⛔ RELOAD BEFORE SEEDING, NOT AFTER. The workspace flushes its in-memory tree on `unload`
   (deliberately — a pending tree write must survive a closed tab), so seeding and THEN
   reloading lets the outgoing page write its own tree straight back over the fixture. The
   first version of this arm did exactly that and spent a check reporting the previous arm's
   data. Reload first, so nothing is holding a tree, then seed, then load. */
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });
await page.evaluate(([sitesKey, treeKey, gp]) => {
  localStorage.clear();
  localStorage.setItem(sitesKey, JSON.stringify({
    [`${gp}_a`]: { id: `${gp}_a`, groupId: gp, site: "Grand Port", name: "Concept A", updatedAt: Date.now(), schemaVersion: 9 },
  }));
  localStorage.setItem(treeKey, JSON.stringify({
    v: 3,
    pages: [
      { id: "gp_a", title: "Coordination", createdAt: 1, updatedAt: 1, projectId: gp, pages: [{ id: "gp_a_sub", title: "Bonding", createdAt: 1, updatedAt: 1, pages: [] }] },
      { id: "gp_b", title: "Load Study", createdAt: 1, updatedAt: 1, projectId: gp, pages: [] },
      { id: "loose", title: "Loose note", createdAt: 1, updatedAt: 1, projectId: null, pages: [] },
    ],
    trash: [],
  }));
}, ["planarfit:sites:v1", TREE_KEY, GRAND_PORT]);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });

await tb("project-crumb").click();
await pacedWait(page, 500);
/* The per-row ⋯ only mounts for the row under the cursor, so the reliable way in is the
 * right-click the same handler answers. */
const row = tb(`project-row-${GRAND_PORT}`);
ok("the project is listed in the switcher", await row.count() > 0);
if (await row.count()) {
  await row.click({ button: "right" });
  await tb("project-manage-menu").waitFor({ state: "visible", timeout: 10000 });
  await pacedWait(page, 300);
  await tb("project-delete").click();
  await tb("project-delete-notes").waitFor({ state: "visible", timeout: 10000 }).catch(() => {});

  const line = tb("project-delete-notes");
  const shown = await line.count() > 0;
  ok("⛔ THE CONFIRMATION SAYS HOW MANY NOTES ARE FILED HERE", shown);
  if (shown) {
    const n = await line.getAttribute("data-note-count");
    const words = (await line.innerText()).replace(/\s+/g, " ");
    ok("…and the number is the NOTES, not the loose one and not the pages", n === "2", `data-note-count=${n}`);
    ok("…and it counts the subpages separately, in words", /3 pages/.test(words), words);
  ok("…and the fixture really is the tree under test — the seed was not flushed away",
    JSON.stringify(await readTree()).includes("gp_a_sub"));
    ok("…and it says they survive either way, so the choice is not a threat", /stay in Notes/.test(words));
  }
  ok("…and it offers to take them along", await tb("project-delete-move-notes").count() > 0);

  await tb("project-delete-move-notes").click();
  await pacedWait(page, 1200);
  const moved = await readTree();
  const gpLeft = (moved.pages || []).filter((p) => (p.projectId ?? null) === GRAND_PORT);
  ok("⛔ AFTER: THE STORED TREE HAS NO NOTE LEFT UNDER THE DELETED PROJECT", gpLeft.length === 0, `${gpLeft.length} left`);
  ok("…and not one note was lost getting there", (moved.pages || []).length === 3, `${(moved.pages || []).length} roots`);
  ok("…they are in the named no-project home, never guessed into another project",
    (moved.pages || []).every((p) => (p.projectId ?? null) === null));
  ok("…and the tree is marked as owing the cloud a push, so a sync cannot undo the move",
    await page.evaluate(() => JSON.parse(localStorage.getItem("planyr:notes:sync:v1:local") || "{}").treeDirty === true));
}

ok("no uncaught page errors across the whole run", pageErrors.length === 0, pageErrors.join(" | ") || "clean");

const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
await browser.close();
if (passed !== checks.length) process.exit(1);
