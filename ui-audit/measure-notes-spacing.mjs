/* measure-notes-spacing — HOW TALL A ROW ACTUALLY IS (NEW-SPACING).
 *
 * ⛔ HIS REPORT: *"you see how I made some text smaller? I was hoping to just make the spacing
 * smaller so I can save space and see more information on screen. I put this on single line
 * spacing. It gets this default single line spacing. So I'm not really sure. Is this a line
 * spacing issue?"*
 *
 * ⛔ AND HIS INSTRUCTION: *"Verify with a measurement, not by eye."* So this file measures
 * RENDERED ROW HEIGHTS and prints them. Nothing here asserts a preference; it reports numbers,
 * before and after, so a change to spacing can be judged rather than admired.
 *
 * THE TWO QUESTIONS IT ANSWERS, which are different and were being conflated:
 *   1. **WHAT IS "SINGLE"?** — the ratio of a paragraph's line box to its font size, with no
 *      spacing set at all. He measured 15px text in a 24.75px box: a ratio of 1.65, where Word
 *      and OneNote call roughly 1.15 "single". A control whose DEFAULT option is the loosest
 *      setting in its own list reads as inert, which is exactly what he experienced.
 *   2. **DOES SMALLER TEXT MAKE A SHORTER ROW?** — set a paragraph smaller and measure whether
 *      the row height drops in proportion. This is the thing he was actually trying to do.
 *
 * ⛔ AND IT MEASURES BOTH WAYS OF MAKING TEXT SMALLER, because they are different mechanisms and
 * only one of them was ever in question: a size on the WHOLE paragraph, and a size on a RUN
 * inside it. A row that shrinks for one and not the other is a specific, fixable fact; "smaller
 * text does not tighten the row" is not.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await assertMeasurable(page, "measure-notes-spacing");
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });

const T = (t, marks) => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });
const P = (...c) => ({ type: "paragraph", content: c });
const LI = (...c) => ({ type: "listItem", content: c });
const size = (px) => [{ type: "textStyle", attrs: { fontSize: `${px}px` } }];

/** A page whose every row is a labelled, single-line case, so a row height means one thing. */
const DOC = {
  type: "doc",
  content: [
    P(T("BASE one line of ordinary text")),
    P(T("WHOLE-SMALLER one line of ordinary text", size(11))),
    P(T("RUN-SMALLER ", size(11)), T("rest at the normal size")),
    P(T("MIXED tall ", size(22)), T("and short", size(9))),
    { type: "heading", attrs: { level: 2 }, content: [T("HEADING two")] },
    { type: "bulletList", content: [
      LI(P(T("LIST base item"))),
      LI(P(T("LIST small item", size(11)))),
    ] },
    { type: "noteAnchor", attrs: { x: 700, y: 40, w: 200 }, content: [P(T("BOX base line"))] },
  ],
};

async function seed(doc = DOC) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="notes-tree"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await pacedWait(page, 200);
  await page.evaluate(([treeKey, prefix, d]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Spacing", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(prefix + "p1", JSON.stringify(d));
  }, [TREE_KEY, PAGE_PREFIX, doc]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
}

/** Every labelled row: its rendered height, its own font size, and the ratio between them.
 *
 *  ⛔ THE HEIGHT IS THE BLOCK'S BOUNDING BOX, not its computed `line-height`. Those are the same
 *  number only when nothing else is in play, and the whole question here is what else is in
 *  play — a strut from the block's own font, a margin, a taller run on the same line. Measuring
 *  the computed property would answer a question nobody asked. */
const rows = () => page.evaluate(() => {
  const pm = document.querySelector(".ProseMirror");
  const out = [];
  for (const el of pm.querySelectorAll("p, h1, h2, h3, li")) {
    const text = (el.innerText || "").trim();
    const tag = el.tagName.toLowerCase();
    if (tag === "li" && el.querySelector("p")) continue;         // the p inside carries the line
    const label = text.split(" ")[0] || "(empty)";
    if (!/^[A-Z-]{3,}$/.test(label)) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    out.push({
      label,
      height: Math.round(r.height * 100) / 100,
      fontPx: Math.round(parseFloat(cs.fontSize) * 100) / 100,
      lineHeightPx: Math.round(parseFloat(cs.lineHeight) * 100) / 100,
      marginTop: Math.round(parseFloat(cs.marginTop) * 100) / 100,
      marginBottom: Math.round(parseFloat(cs.marginBottom) * 100) / 100,
    });
  }
  return out;
});

/** The whole document's height — the number that answers "do I see more on screen". */
const docHeight = () => page.evaluate(() => {
  const pm = document.querySelector(".ProseMirror");
  return Math.round(pm.getBoundingClientRect().height * 100) / 100;
});

function table(label, list) {
  console.log("\n" + "=".repeat(96));
  console.log(label);
  console.log("=".repeat(96));
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("row", 18) + pad("height", 10) + pad("font", 8) + pad("line-height", 14) + pad("ratio h/font", 14) + "margins");
  console.log("-".repeat(96));
  for (const r of list) {
    console.log(
      pad(r.label, 18) + pad(r.height, 10) + pad(r.fontPx, 8) + pad(r.lineHeightPx, 14)
      + pad(Math.round((r.height / r.fontPx) * 1000) / 1000, 14)
      + `${r.marginTop} / ${r.marginBottom}`,
    );
  }
}

await seed();
const base = await rows();
table("AS SHIPPED — every row, measured", base);
console.log(`\n  whole document height: ${await docHeight()}px`);

/* ⛔ THE TWO QUESTIONS, ANSWERED IN NUMBERS RATHER THAN PROSE. */
const by = (l) => base.find((r) => r.label === l);
const baseRow = by("BASE"); const WHOLE = by("WHOLE-SMALLER"); const RUN = by("RUN-SMALLER");
console.log("\nANSWERS");
if (baseRow) {
  console.log(`  1. "SINGLE" IS ${Math.round((baseRow.lineHeightPx / baseRow.fontPx) * 1000) / 1000}× the font size `
    + `(${baseRow.fontPx}px text in a ${baseRow.lineHeightPx}px line box). Word/OneNote single is ~1.15.`);
}
for (const [name, r] of [["a WHOLE paragraph set smaller", WHOLE], ["a RUN inside a paragraph set smaller", RUN]]) {
  if (!r || !baseRow) continue;
  const dropped = baseRow.height - r.height;
  const proportional = Math.round((baseRow.height * (r.fontPx / baseRow.fontPx)) * 100) / 100;
  console.log(`  2. ${name}: font ${baseRow.fontPx} → ${r.fontPx}, row ${baseRow.height} → ${r.height} `
    + `(${dropped > 0.5 ? `SHORTER by ${Math.round(dropped * 100) / 100}px` : "⛔ NO SHORTER"}; `
    + `in proportion it would be ${proportional}px)`);
}

console.log(`\npage errors: ${errs.length ? errs.slice(0, 3).join(" | ") : "clean"}`);
await browser.close();
