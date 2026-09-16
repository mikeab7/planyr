/* verify-notes-list-markers — NESTED LIST MARKERS STEP THROUGH THE OUTLINE CONVENTION (NEW-2).
 *
 * Owner report, from a screenshot of his own note: a first-level "1. Utility Facilities" with
 * a second-level item that ALSO rendered "1.", the two distinguishable only by indentation.
 *
 * `test/notesListIndent.test.js` proves the generated stylesheet TEXT has the right shape
 * (SYNTHETIC-KEYS-DONT-EDIT's layout twin — that suite is node-only, it can prove the rule
 * EXISTS, never that a real browser actually cascades it the way the specificity math
 * intends). This drives a REAL Chromium and reads `getComputedStyle(li).listStyleType`
 * directly, for: a real nested ORDERED list three levels deep, a real nested BULLETED list
 * three levels deep, the FLAT `data-indent` fallback (no real nesting at all), mixed
 * ordered-inside-bulleted nesting, and — the safety case — a checklist, which must keep
 * `none` (a checkbox, not a glyph) at every depth.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const REMOTE = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";

const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--ignore-certificate-errors", ...(REMOTE && PROXY ? [`--proxy-server=${PROXY}`] : [])],
});

const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";
const page = await (await browser.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
await assertMeasurable(page, "verify-notes-list-markers");

const T = (t) => ({ type: "text", text: t });
const P = (t) => ({ type: "paragraph", content: t ? [T(t)] : undefined });
const LI = (text, indent, ...children) => ({
  type: "listItem", attrs: indent ? { indent } : undefined, content: [P(text), ...children],
});
const TI = (text, checked) => ({ type: "taskItem", attrs: { checked: !!checked }, content: [P(text)] });

const doc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [T("Utility Facilities")] },
    // Ordered, real nesting 3 deep.
    {
      type: "orderedList",
      content: [
        LI("Water Authority", 0, {
          type: "orderedList",
          content: [
            LI("Engineer — Pape Dawson", 0, {
              type: "orderedList",
              content: [
                LI("Dustin O'Neal", 0, {
                  type: "orderedList",
                  content: [LI("Deep-4")],
                }),
              ],
            }),
          ],
        }),
      ],
    },
    // Bulleted, real nesting 3 deep.
    {
      type: "bulletList",
      content: [
        LI("Sanitary", 0, {
          type: "bulletList",
          content: [
            LI("Discharge Permit", 0, {
              type: "bulletList",
              content: [LI("Deep-3-bullet")],
            }),
          ],
        }),
      ],
    },
    // Flat data-indent fallback — no real nesting at all.
    {
      type: "orderedList",
      content: [LI("First item, flat indent 1", 1), LI("First item, flat indent 2", 2)],
    },
    {
      type: "bulletList",
      content: [LI("Bullet, flat indent 1", 1), LI("Bullet, flat indent 2", 2)],
    },
    // Mixed: a bulleted list nested inside an ordered one.
    {
      type: "orderedList",
      content: [LI("Outer ordered", 0, { type: "bulletList", content: [LI("Inner bulleted")] })],
    },
    // The checklist — must stay `none` at every depth.
    {
      type: "taskList",
      content: [{
        type: "taskItem",
        attrs: { checked: false },
        content: [P("Top checklist item"), {
          type: "taskList",
          content: [TI("Nested checklist item")],
        }],
      }],
    },
  ],
};

async function seed() {
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 400);
  await page.evaluate(([treeKey, prefix, body]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "List markers", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(prefix + "p1", JSON.stringify(body));
  }, [TREE_KEY, PAGE_PREFIX, doc]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 700);
}

/** Every `<li>` in document order, with its own computed `list-style-type`, its text, and its
 *  real DOM nesting depth (for a human-readable report only — the ASSERTIONS are all against
 *  the actual computed style, never re-derived depth). */
async function readMarkers() {
  return page.evaluate(() => {
    const pm = document.querySelector(".ProseMirror");
    const out = [];
    for (const li of pm.querySelectorAll("li")) {
      const text = (li.querySelector("p")?.textContent || "").trim();
      out.push({
        text,
        listStyleType: getComputedStyle(li).listStyleType,
        indentAttr: li.getAttribute("data-indent"),
        parentTaskList: !!li.closest('ul[data-type="taskList"]'),
      });
    }
    return out;
  });
}

const results = [];
const check = (label, cond, detail) => { results.push({ label, pass: !!cond, detail }); };
const byText = (rows, text) => rows.find((r) => r.text === text);

await seed();
const rows = await readMarkers();

check("real ordered depth 0 — decimal", byText(rows, "Water Authority")?.listStyleType === "decimal", byText(rows, "Water Authority"));
check("real ordered depth 1 — lower-alpha", byText(rows, "Engineer — Pape Dawson")?.listStyleType === "lower-alpha", byText(rows, "Engineer — Pape Dawson"));
check("real ordered depth 2 — lower-roman", byText(rows, "Dustin O'Neal")?.listStyleType === "lower-roman", byText(rows, "Dustin O'Neal"));
check("real ordered depth 3 — cycles back to decimal", byText(rows, "Deep-4")?.listStyleType === "decimal", byText(rows, "Deep-4"));

check("real bulleted depth 0 — disc", byText(rows, "Sanitary")?.listStyleType === "disc", byText(rows, "Sanitary"));
check("real bulleted depth 1 — circle", byText(rows, "Discharge Permit")?.listStyleType === "circle", byText(rows, "Discharge Permit"));
check("real bulleted depth 2 — square", byText(rows, "Deep-3-bullet")?.listStyleType === "square", byText(rows, "Deep-3-bullet"));

check("flat indent 1, ordered — lower-alpha", byText(rows, "First item, flat indent 1")?.listStyleType === "lower-alpha", byText(rows, "First item, flat indent 1"));
check("flat indent 2, ordered — lower-roman", byText(rows, "First item, flat indent 2")?.listStyleType === "lower-roman", byText(rows, "First item, flat indent 2"));
check("flat indent 1, bulleted — circle", byText(rows, "Bullet, flat indent 1")?.listStyleType === "circle", byText(rows, "Bullet, flat indent 1"));
check("flat indent 2, bulleted — square", byText(rows, "Bullet, flat indent 2")?.listStyleType === "square", byText(rows, "Bullet, flat indent 2"));

check("mixed nesting — outer ordered depth 0 decimal", byText(rows, "Outer ordered")?.listStyleType === "decimal", byText(rows, "Outer ordered"));
check("mixed nesting — inner bulleted counts as depth 1 (circle, not disc)", byText(rows, "Inner bulleted")?.listStyleType === "circle", byText(rows, "Inner bulleted"));

check("checklist top item stays none (checkbox only)", byText(rows, "Top checklist item")?.listStyleType === "none", byText(rows, "Top checklist item"));
check("checklist nested item ALSO stays none", byText(rows, "Nested checklist item")?.listStyleType === "none", byText(rows, "Nested checklist item"));

check("no page errors", pageErrors.length === 0, pageErrors);

const failed = results.filter((r) => !r.pass);
for (const r of results) {
  console.log(`${r.pass ? "✅" : "❌"} ${r.label}${r.pass ? "" : `  ${JSON.stringify(r.detail)}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);

await browser.close();
process.exit(failed.length ? 1 : 0);
