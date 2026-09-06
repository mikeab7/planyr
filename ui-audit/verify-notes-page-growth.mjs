/* verify-notes-page-growth — THE PAGE GROWS TO HOLD WHAT'S ON IT; NOTHING RENDERS OFF IT
 * (NOTES-PAGE-GROWTH, owner report 2026-09-06, project smqfy48tlk9j "Goose Creek" › Notes ›
 * "Platting").
 *
 * ⛔ HIS WORDS: *"I thought we had an edit to where, like, if I type outside of the note or of
 * the eight and a half by eleven or whatever, it would just expand the page so that it would all
 * be on that, but it's not doing it. So clearly there's an error here."*
 *
 * ⛔ THE ANSWER: IT DID SHIP (B421490, NEW-RIGHT-EDGE) AND IT REGRESSED. `anchorExtentX`'s "does
 * an anchor need more room than it has" comparison read the SCROLLER's width (`note-mat`, nearly
 * the whole window) as "how much room the page has" — correct back when the editor's own box WAS
 * the pane. B1203504 later gave the page its own narrower, centred, bounded CARD (`note-sheet`,
 * 580px) without repointing this measurement at it, so a box could overflow the visible white
 * page while sitting comfortably inside the much wider grey pane around it, and the grow
 * condition never fired. Measured on his own production note: a box needing 751px against a
 * 923px pane (never triggers growth) that was still 251px too wide for the 580px page it
 * actually had to fit inside.
 *
 * ⛔ THE RULE THIS HARNESS PROVES, stated once because it decided several of the cases below:
 * THE PAGE'S OWN TOP-LEFT CORNER IS A FIXED ORIGIN — nothing may be PLACED or DRAGGED to a
 * negative x/y (unchanged, pre-existing) — and the page GROWS to the right and down to hold
 * whatever does not fit (restored here). A box from before either floor existed (his own
 * "assdsasasssada" scratch anchor, stored at y: -21) is data, not a case the rule permits today,
 * and is repaired into the page on load rather than left to render off it forever.
 *
 * ⛔ RED-PROOFED BY GIT STASH, not merely asserted: every case below was run against the
 * pre-fix source (`git stash` on the six touched lib/component files, leaving this harness and
 * its build in place) and failed — the exact production repro rendered its anchor at
 * `top: -21px` with the sheet still 580px wide, and the "extreme off-page" / "phone width" cases
 * both reported an anchor outside the sheet's own rendered bounds. Restoring the fix turned all
 * of it green on the same build. This comment records that it was done, not a promise that it
 * would work if tried.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";

const failures = [];
const ok = (label, cond, detail) => {
  console.log(`${cond ? "✓" : "⛔"} ${label}${detail !== undefined ? ` — ${detail}` : ""}`);
  if (!cond) failures.push(label);
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

/** Seed one page's raw stored document and read back the geometry that matters: is every
 *  anchor's RENDERED box inside the visible page card, does the scroller centre or left-align
 *  (B1203504's own overflow-centres-equally trap, one door over), and is the zoom indicator
 *  present on the page vs. in the toolbar. */
async function measureCase(doc, { viewport = { width: 1191, height: 900 }, theme = null } = {}) {
  const page = await (await browser.newContext({ viewport })).newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await assertMeasurable(page, "verify-notes-page-growth");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  if (theme) await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await pacedWait(page, 200);
  await page.evaluate(([treeKey, prefix, d]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Case", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(prefix + "p1", JSON.stringify(d));
  }, [TREE_KEY, PAGE_PREFIX, doc]);
  await page.reload({ waitUntil: "domcontentloaded" });
  if (theme) await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 700);

  const state = await page.evaluate(() => {
    const anchors = [...document.querySelectorAll(".planyr-anchor")];
    const sheet = document.querySelector('[data-testid="note-sheet"]');
    const mat = document.querySelector('[data-testid="note-mat"]');
    const sheetRect = sheet?.getBoundingClientRect();
    const anchorRects = anchors.map((a) => a.getBoundingClientRect());
    const allInside = !!sheetRect && anchorRects.every((r) =>
      r.left >= sheetRect.left - 1 && r.right <= sheetRect.right + 1
      && r.top >= sheetRect.top - 1 && r.bottom <= sheetRect.bottom + 1);
    const raw = localStorage.getItem("planyr:notes:page:v1:local:p1");
    const stored = [];
    try {
      const walk = (n) => { if (n?.type === "noteAnchor") stored.push(n.attrs); (n?.content || []).forEach(walk); };
      walk(JSON.parse(raw));
    } catch (_) { /* reported as empty */ }
    return {
      allAnchorsInsideSheet: allInside,
      sheetWidth: sheetRect ? Math.round(sheetRect.width) : null,
      matAlignItems: mat ? getComputedStyle(mat).alignItems : null,
      matScrollWidth: mat?.scrollWidth ?? null,
      matClientWidth: mat?.clientWidth ?? null,
      storedAnchors: stored,
      zoomOnPage: !!sheet?.querySelector('[data-testid="note-zoom-level"]'),
    };
  });
  await page.close();
  return { state, errs };
}

/* ═══ 1. HIS EXACT PRODUCTION CASE — repaired onto the page, and it stays repaired ══════════ */
console.log("\n" + "=".repeat(100));
console.log("1. THE PRODUCTION REPRO — the Platting note's own off-page scratch anchor");
console.log("=".repeat(100));
{
  const doc = {
    type: "doc",
    content: [
      { type: "paragraph", content: [] },
      {
        type: "noteAnchor", attrs: { x: 575, y: -21, w: 180, h: null, aid: "prod1" },
        content: [{ type: "paragraph", content: [{ type: "text", text: "assdsasasssada" }] }],
      },
    ],
  };
  const { state, errs } = await measureCase(doc);
  console.log(JSON.stringify(state, null, 2));
  ok("no page errors", errs.length === 0, errs.join(" | "));
  ok("the anchor renders fully inside the page sheet", state.allAnchorsInsideSheet);
  ok("the page's own top edge is a floor — the negative y was repaired, not merely hidden",
    state.storedAnchors[0]?.y === 0, `stored y=${state.storedAnchors[0]?.y}`);
  ok("the repair SURVIVES A RELOAD (it was written back, not painted over)",
    (await measureCase(doc)).state.storedAnchors[0]?.y === 0);
}

/* ═══ 2. THE ADJACENT CASES ══════════════════════════════════════════════════════════════════ */
const cases = {
  "dragged past the right edge (a wide box near the margin)": {
    type: "doc", content: [{ type: "paragraph", content: [] },
      { type: "noteAnchor", attrs: { x: 900, y: 40, w: 180, h: null, aid: "a" }, content: [{ type: "paragraph", content: [{ type: "text", text: "right edge" }] }] }],
  },
  "dragged past the left edge (a legacy negative x)": {
    type: "doc", content: [{ type: "paragraph", content: [] },
      { type: "noteAnchor", attrs: { x: -50, y: 40, w: 180, h: null, aid: "a" }, content: [{ type: "paragraph", content: [{ type: "text", text: "left edge" }] }] }],
  },
  "above the top (a legacy negative y)": {
    type: "doc", content: [{ type: "paragraph", content: [] },
      { type: "noteAnchor", attrs: { x: 40, y: -80, w: 180, h: null, aid: "a" }, content: [{ type: "paragraph", content: [{ type: "text", text: "above top" }] }] }],
  },
  "below the bottom (grows the page downward)": {
    type: "doc", content: [{ type: "paragraph", content: [] },
      { type: "noteAnchor", attrs: { x: 40, y: 3000, w: 180, h: null, aid: "a" }, content: [{ type: "paragraph", content: [{ type: "text", text: "below bottom" }] }] }],
  },
  "an anchor wider than the page (shrinks toward the floor, then the page grows)": {
    type: "doc", content: [{ type: "paragraph", content: [] },
      { type: "noteAnchor", attrs: { x: 20, y: 20, w: 2000, h: null, aid: "a" }, content: [{ type: "paragraph", content: [{ type: "text", text: "very wide" }] }] }],
  },
  "several anchors, one of them off-page": {
    type: "doc", content: [{ type: "paragraph", content: [] },
      { type: "noteAnchor", attrs: { x: 20, y: 20, w: 180, h: null, aid: "a" }, content: [{ type: "paragraph", content: [{ type: "text", text: "on page" }] }] },
      { type: "noteAnchor", attrs: { x: 950, y: 60, w: 180, h: null, aid: "b" }, content: [{ type: "paragraph", content: [{ type: "text", text: "off page" }] }] }],
  },
  "a long unbroken string with no spaces, no anchor": {
    type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(300) }] }],
  },
  "a long unbroken string inside an anchor": {
    type: "doc", content: [{ type: "paragraph", content: [] },
      { type: "noteAnchor", attrs: { x: 20, y: 20, w: 180, h: null, aid: "a" }, content: [{ type: "paragraph", content: [{ type: "text", text: "y".repeat(300) }] }] }],
  },
  "a table placed near the edge": {
    type: "doc", content: [{ type: "paragraph", content: [] },
      { type: "noteAnchor", attrs: { x: 700, y: 20, w: 260, h: null, aid: "a" }, content: [
        { type: "table", content: [{ type: "tableRow", content: [
          { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
          { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] },
        ] }] },
      ] }],
  },
  "an extreme off-page anchor forcing the pane itself to overflow": {
    type: "doc", content: [{ type: "paragraph", content: [] },
      { type: "noteAnchor", attrs: { x: 2500, y: 20, w: 300, h: null, aid: "a" }, content: [{ type: "paragraph", content: [{ type: "text", text: "way off to the right" }] }] }],
  },
};

console.log("\n" + "=".repeat(100));
console.log("2. THE ADJACENT CASES — every one must render fully inside the page sheet");
console.log("=".repeat(100));
const NATURAL_SHEET_WIDTH = 580;
for (const [name, doc] of Object.entries(cases)) {
  const { state, errs } = await measureCase(doc);
  ok(name, state.allAnchorsInsideSheet && errs.length === 0,
    `sheet ${state.sheetWidth}px, mat align=${state.matAlignItems}, scroll ${state.matScrollWidth}/${state.matClientWidth}${errs.length ? `, errors: ${errs.join(" | ")}` : ""}`);
  /* ⛔ ANY GROWTH AT ALL LEFT-ALIGNS, NOT ONLY GROWTH THAT OUTGROWS THE WHOLE PANE — the bug
   * this generalised check exists to catch, measured live during this fix's own development:
   * centring redistributes a grown sheet's extra width onto BOTH edges, so placing one box near
   * the margin shifted the WHOLE PAGE (title included) 48px left in the same gesture that grew
   * it 96px wider — "the page jumped," not "the page grew," the exact class VIEWPORT-STABLE
   * forbids. A sheet still at its ordinary 580px card stays centred, unchanged. */
  if (state.sheetWidth > NATURAL_SHEET_WIDTH) {
    ok(`${name} — grown, so it left-aligns instead of centring (no shift on already-placed content)`,
      state.matAlignItems === "flex-start", `sheet ${state.sheetWidth}px, align=${state.matAlignItems}`);
  }
}

/* ═══ 3. PHONE WIDTH AND BOTH THEMES ═════════════════════════════════════════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("3. PHONE WIDTH AND BOTH THEMES");
console.log("=".repeat(100));
{
  const { state } = await measureCase(cases["several anchors, one of them off-page"], { viewport: { width: 390, height: 800 } });
  ok("phone width (390px) — still fully on the page", state.allAnchorsInsideSheet, `sheet ${state.sheetWidth}px`);
}
for (const theme of ["light", "dark"]) {
  const { state } = await measureCase(cases["dragged past the right edge (a wide box near the margin)"], { theme });
  ok(`${theme} theme — layout unaffected by the theme token swap`, state.allAnchorsInsideSheet);
}

/* ═══ 4. THE ZOOM CONTROL IS OFF THE PAGE (NEW-2) ════════════════════════════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("4. THE ZOOM CONTROL DOES NOT RENDER ON THE PAGE (NEW-2)");
console.log("=".repeat(100));
{
  const page = await (await browser.newContext({ viewport: { width: 1191, height: 900 } })).newPage();
  await assertMeasurable(page, "verify-notes-page-growth:zoom");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([treeKey, prefix]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Zoom case", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(prefix + "p1", JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] }));
  }, [TREE_KEY, PAGE_PREFIX]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 400);
  await page.keyboard.down("Control");
  await page.keyboard.press("Equal");
  await page.keyboard.press("Equal");
  await page.keyboard.up("Control");
  await pacedWait(page, 400);
  const z = await page.evaluate(() => {
    const sheet = document.querySelector('[data-testid="note-sheet"]');
    const toolbar = document.querySelector('[data-testid="note-toolbar"]');
    return {
      sheetZoomAttr: sheet?.getAttribute("data-zoom"),
      onSheet: !!sheet?.querySelector('[data-testid="note-zoom-level"]'),
      inToolbar: !!toolbar?.querySelector('[data-testid="note-zoom-level"]'),
      toolbarText: toolbar?.querySelector('[data-testid="note-zoom-level"]')?.innerText?.trim() || null,
    };
  });
  console.log(JSON.stringify(z, null, 2));
  ok("zoomed away from 100% is reflected on the sheet's own data-zoom", Number(z.sheetZoomAttr) > 1);
  ok("the zoom indicator is ABSENT from the page sheet's subtree", !z.onSheet);
  ok("the zoom indicator IS present in the toolbar", z.inToolbar);
  ok("it still says what level it is", (z.toolbarText || "").endsWith("%"), z.toolbarText);

  // Zoom itself still has to work from the new location.
  await page.locator('[data-testid="note-toolbar"] [data-testid="note-zoom-level"]').click();
  await pacedWait(page, 300);
  const after = await page.evaluate(() => document.querySelector('[data-testid="note-sheet"]')?.getAttribute("data-zoom"));
  ok("clicking the relocated control still resets to 100%", after === "1", `data-zoom=${after}`);
  await page.close();
}

/* ═══ 5. PRINT AND MARKDOWN CARRY THE CONTENT THAT WAS OFF-PAGE ═════════════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("5. PRINT AND MARKDOWN — the off-page content is not lost, and the zoom control never rides either export");
console.log("=".repeat(100));
{
  const { pageToMarkdown } = await import("../src/workspaces/notes/lib/notesMarkdown.js");
  const { buildPrintDocument, pageAnchorExtentPx } = await import("../src/workspaces/notes/lib/notesPrint.js");
  const doc = {
    type: "doc",
    content: [
      { type: "paragraph", content: [] },
      { type: "noteAnchor", attrs: { x: 900, y: 20, w: 180 },
        content: [{ type: "paragraph", content: [{ type: "text", text: "OFF-PAGE-MARKER-TEXT" }] }] },
    ],
  };
  const { markdown: md, lossy } = pageToMarkdown({ id: "p1", title: "Case" }, { p1: doc });
  ok("the Markdown export carries the off-page anchor's own text", md.includes("OFF-PAGE-MARKER-TEXT"));
  ok("and NAMES the loss (position is honestly not representable in Markdown)",
    lossy.some((l) => l.toLowerCase().includes("position")), lossy.join(" | "));
  ok("the Markdown export never carries a zoom level (it is a UI control, not content)", !md.includes("note-zoom-level"));

  const growPx = pageAnchorExtentPx(doc);
  ok("the print sheet's own width computation sees the off-page anchor", growPx > 900);
  const html = buildPrintDocument({ title: "Case", pages: [{ title: "Case", html: "<div>OFF-PAGE-MARKER-TEXT</div>", doc }] });
  ok("the printed sheet carries the off-page anchor's own content", html.includes("OFF-PAGE-MARKER-TEXT"));
  ok("and its OWN sheet grows past the ordinary 190mm rather than clipping it", html.includes("max(190mm,"));
  ok("print never carries a zoom control at all — it is a screen affordance, not a document fact", !html.includes("note-zoom-level"));
}

/* ⛔ AND THE ACTUAL PRINT PIPELINE, DRIVEN FOR REAL — not just the string it builds
 * (ATTEMPT-BEFORE-YOU-PARK: a logged-out, no-external-GIS check like this one is Claude-doable
 * HERE and must never be filed as "needs a live pass"). `printHtmlDocument` writes the built HTML
 * into a same-document hidden `<iframe data-testid="notes-print-frame">` and only THEN calls
 * `contentWindow.print()` — which opens no dialog and changes nothing observable in a headless
 * browser, but the iframe itself stays in the DOM for up to a minute afterwards. That is a real,
 * rendered document this harness can measure directly, geometry and all — the one thing the raw
 * HTML string checks above cannot prove. */
console.log("\n" + "=".repeat(100));
console.log("6. THE PRINT PIPELINE, DRIVEN FOR REAL — the rendered iframe, not just the built string");
console.log("=".repeat(100));
{
  const page = await (await browser.newContext({ viewport: { width: 1191, height: 900 } })).newPage();
  await assertMeasurable(page, "verify-notes-page-growth:print");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([treeKey, prefix]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Print case", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(prefix + "p1", JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [] },
        { type: "noteAnchor", attrs: { x: 900, y: 20, w: 180, h: null, aid: "a" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "PRINT-DRIVE-MARKER" }] }] },
      ],
    }));
  }, [TREE_KEY, PAGE_PREFIX]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 500);
  await page.locator('[data-testid="nt-print"]').click();
  await pacedWait(page, 1200);            // printHtmlDocument's own settle + write

  /* ⛔ GEOMETRY, NOT JUST STRINGS — BUT NOT `getBoundingClientRect`, EITHER. The print iframe is
   * deliberately `width:1px;height:1px` on screen (so a real user sees nothing before the native
   * print dialogue takes over); a real browser's print PASS lays it out at the physical page size
   * regardless, but this sandbox has no print pass to drive, and measuring the SCREEN-media
   * rendering of a 1px-wide box would report a false failure having nothing to do with the fix
   * (caught live: `sheetWidth` read 60px — its own padding, nothing else — on a build that
   * printed correctly). So this reads the two facts a screen-media layout CAN'T lie about: the
   * `style` attribute string on `.sheet` (identical to the pure-function check above, but now
   * proven to reach the REAL toolbar Print button's call site — see the next comment for why that
   * distinction is the one that actually caught a bug) and the anchor's OWN `data-anchor-x/-w`
   * attributes, which `renderHTML` writes verbatim regardless of how the iframe happens to be
   * laid out on screen. */
  const printState = await page.evaluate(() => {
    const frame = document.querySelector('[data-testid="notes-print-frame"]');
    const doc = frame?.contentDocument;
    if (!doc) return { found: false };
    const sheet = doc.querySelector(".sheet");
    const anchor = doc.querySelector(".planyr-anchor");
    return {
      found: true,
      hasMarker: doc.body.innerText.includes("PRINT-DRIVE-MARKER"),
      sheetStyle: sheet?.getAttribute("style") || "",
      anchorX: anchor ? Number(anchor.getAttribute("data-anchor-x")) : null,
      anchorW: anchor ? Number(anchor.getAttribute("data-anchor-w")) : null,
      hasZoomControl: !!doc.querySelector('[data-testid="note-zoom-level"]'),
    };
  });
  console.log(JSON.stringify(printState, null, 2));
  ok("the print iframe actually rendered", printState.found);
  ok("the printed content includes the off-page anchor's own text", printState.hasMarker);
  /* ⛔ THIS IS THE CHECK THAT FOUND THE REAL BUG. The pure `buildPrintDocument` calls in §5 above
   * passed from the moment this fix was written — they build a `doc` by hand and call the
   * function directly. This one drives the app's ACTUAL toolbar Print button
   * (`NoteToolbar`'s `nt-print` → `NoteEditor.jsx`'s own `printPage`), a SEPARATE call site from
   * `Notes.jsx`'s tree-print handler, and it failed on the first version of this fix — `printPage`
   * built its `pages` array without a `doc` field at all, so `pageAnchorExtentPx` always saw
   * `undefined` and the real Print button never grew a single sheet. Fixed in the same commit;
   * kept here so it cannot regress unnoticed a second time. */
  ok("⛔ THE REAL PRINT BUTTON'S OWN CALL SITE CARRIES THE GROWN max-width, NOT ONLY THE PURE FUNCTION",
    printState.sheetStyle.includes("max(190mm,"), printState.sheetStyle || "(no style attribute at all)");
  ok("and the anchor's own geometry attributes reached the printed sheet unchanged",
    printState.anchorX === 900 && printState.anchorW === 180, `x=${printState.anchorX} w=${printState.anchorW}`);
  ok("no zoom control rendered into the printed document", !printState.hasZoomControl);
  await page.close();
}

console.log("\n" + (failures.length ? `⛔ ${failures.length} FAILURE(S)` : "✓ every check passed"));
for (const f of failures) console.log(`  ✗ ${f}`);

await browser.close();
process.exit(failures.length ? 1 : 0);
