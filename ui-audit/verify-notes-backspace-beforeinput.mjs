/* THE `beforeinput` SAFETY NET, PROVEN INDEPENDENTLY OF `keydown` (B1260000).
 *
 * ⛔ WHY THIS IS A SEPARATE FILE. `verify-notes-backspace.mjs` drives every row with a REAL
 * `page.keyboard.press("Backspace")` — which, in Chromium, always fires a `keydown` first. That
 * proves the DECISION TABLE is right; it cannot prove that `notesBlockKeys.js`'s
 * `addProseMirrorPlugins()` `beforeinput` handler is what a real press exercises, because
 * Chromium's own `keydown`-based path already gets there first and `preventDefault()`s the
 * browser's default action before `beforeinput` for it is ever dispatched. A harness that only
 * presses real keys can therefore never fail if the `beforeinput` handler were deleted entirely
 * — which is exactly the gap the owner's iPhone report lives in: his platform is documented to
 * deliver a `beforeinput` (`inputType: "deleteContentBackward"`) for its software keyboard's
 * delete key WITHOUT a `keydown` a keymap can intercept, so on his device the `keydown` path
 * this repo already had never ran at all.
 *
 * So this harness dispatches a SYNTHETIC `beforeinput` directly on the editor's DOM node via
 * `window.__noteEditor.dispatchBeforeInput()` — untrusted, so Chromium performs no native edit
 * of its own for it, and the ONLY thing that can produce a resulting transaction is the plugin's
 * own `handleDOMEvents.beforeinput`. That gives a genuine, mechanism-specific red/green proof
 * that does not exist anywhere else in this repo:
 *   · fix present  → the document changes exactly the way the keydown table says it should
 *   · fix ABSENT   → nothing happens at all (no native edit, no plugin, no transaction)
 * which is a much sharper signal than "did the row pass" — a harness that only checked the
 * final tree could not tell "the beforeinput handler ran" from "nothing ran and the seed just
 * happened to already look right".
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node ui-audit/verify-notes-backspace-beforeinput.mjs            # assert
 *   node ui-audit/verify-notes-backspace-beforeinput.mjs --report   # print every before/after
 *
 * MUTATION CHECK: comment out `addProseMirrorPlugins()` in notesBlockKeys.js (or make its
 * `beforeinput` handler always `return false`), rebuild, run again — every row here goes RED
 * (the document comes back byte-identical to `before`, because nothing intercepted the
 * synthetic event and nothing else could have acted on it). Restore the handler and they go
 * green again.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const REPORT = process.argv.includes("--report");

const checks = [];
const ok = (name, cond, extra = "") => {
  checks.push({ name, pass: !!cond });
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const P = (t) => ({ type: "paragraph", ...(t ? { content: [{ type: "text", text: t }] } : {}) });
const LI = (t, sub) => ({ type: "listItem", content: [P(t), ...(sub ? [sub] : [])] });
const UL = (...items) => ({ type: "bulletList", content: items });
const OL = (...items) => ({ type: "orderedList", content: items });
const TI = (t, sub) => ({ type: "taskItem", attrs: { checked: false }, content: [P(t), ...(sub ? [sub] : [])] });
const TL = (...items) => ({ type: "taskList", content: items });
const doc = (...content) => ({ type: "doc", content });

/** ⛔ NORMALISE AWAY THE TRAILING NODE — same reasoning as verify-notes-backspace.mjs: StarterKit's
 *  `TrailingNode` adds one empty paragraph at the end of a doc whose last block is not a
 *  textblock, on SEEDING — before anything under test runs. Both sides lose it here too. */
const normalise = (d) => {
  if (!d || !Array.isArray(d.content)) return d;
  const content = [...d.content];
  const last = content[content.length - 1];
  if (last && last.type === "paragraph" && !last.content) content.pop();
  return { ...d, content };
};
const SHOWN_ATTRS = new Set(["level", "textAlign", "checked"]);
const shape = (n, d = 0) => {
  if (!n || typeof n !== "object") return "";
  const pad = "  ".repeat(d);
  const attrs = Object.entries(n.attrs || {})
    .filter(([k, v]) => SHOWN_ATTRS.has(k) && v !== null && v !== false && v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${v}`);
  const head = `${pad}${n.type}${attrs.length ? `[${attrs.join(" ")}]` : ""}${n.type === "text" ? ` ${JSON.stringify(n.text)}` : ""}`;
  return [head, ...(n.content || []).map((c) => shape(c, d + 1))].filter(Boolean).join("\n");
};
const indent = (s) => s.split("\n").map((l) => "      " + l).join("\n");

/* ── the cases: the owner's exact repro plus a representative slice of the same table
 * verify-notes-backspace.mjs drives — enough to prove the backstop reproduces the SAME
 * decisions as keydown, not a different or partial set of them. ────────────────────────────── */
const CASES = [
  {
    id: "B1260000 OWNER REPRO via beforeinput — empty top-level bullet WITH a nested child",
    before: doc(P("Tell Talbert I'll be the main POC"), UL(LI("", UL(LI("9/21 for striping of Bass Blvd.")))), P("Figure out who Talbert sent the email to")),
    at: [1, 0, 0],
    after: doc(P("Tell Talbert I'll be the main POC"), P(""), UL(LI("9/21 for striping of Bass Blvd.")), P("Figure out who Talbert sent the email to")),
  },
  {
    id: "REPRO A via beforeinput — nested list item outdents",
    before: doc(P("para one"), UL(LI("bullet one", UL(LI("bullet two"))))),
    at: [1, 0, 1, 0, 0],
    after: doc(P("para one"), UL(LI("bullet one"), LI("bullet two"))),
  },
  {
    id: "REPRO B via beforeinput — top-level list item becomes a paragraph",
    before: doc(P("para one"), UL(LI("bullet one", UL(LI("bullet two"))))),
    at: [1, 0, 0],
    after: doc(P("para one"), P("bullet one"), UL(LI("bullet two"))),
  },
  {
    id: "numbered list via beforeinput",
    before: doc(P("x"), OL(LI("one"), LI("two"))),
    at: [1, 0, 0],
    after: doc(P("x"), P("one"), OL(LI("two"))),
  },
  {
    id: "checklist via beforeinput",
    before: doc(P("x"), TL(TI("one", TL(TI("two"))))),
    at: [1, 0, 1, 0, 0],
    after: doc(P("x"), TL(TI("one"), TI("two"))),
  },
  {
    id: "plain paragraph join via beforeinput (the ordinary case, unchanged)",
    before: doc(P("one"), P("two")),
    at: [1],
    after: doc(P("onetwo")),
  },
];

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-notes-backspace-beforeinput");
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

console.log("The beforeinput safety net — proven independently of keydown (B1260000)\n");

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1200);
await page.locator('[data-testid="module-tab-notes"]:visible').first().click();
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });
await page.locator('[data-testid="notes-new-page"]').click();
await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
await page.waitForTimeout(1200);
await page.waitForFunction(() => !!window.__noteEditor, null, { timeout: 20000 });
await page.waitForFunction(() => typeof window.__noteEditor.dispatchBeforeInput === "function", null, { timeout: 20000 });

for (const c of CASES) {
  await page.evaluate(([d, path]) => {
    window.__noteEditor.setDoc(d);
    window.__noteEditor.caretAt(window.__noteEditor.startOf(path));
  }, [c.before, c.at]);

  await page.evaluate(() => window.__noteEditor.dispatchBeforeInput("deleteContentBackward"));
  await page.waitForTimeout(150);

  const got = await page.evaluate(() => window.__noteEditor.json());
  const want = shape(normalise(c.after));
  const have = shape(normalise(got));
  const pass = want === have;
  ok(c.id, pass);
  if (REPORT || !pass) {
    console.log("    before:\n" + indent(shape(normalise(c.before))));
    console.log("    expected:\n" + indent(want));
    console.log("    got:\n" + indent(have));
  }
}

/* ⛔ THE NEGATIVE CONTROL — a different inputType must NOT be intercepted, so the plugin cannot
 * be accused of eating every beforeinput indiscriminately. */
{
  const before = doc(P("para one"), UL(LI("bullet one")));
  await page.evaluate(([d, path]) => {
    window.__noteEditor.setDoc(d);
    window.__noteEditor.caretAt(window.__noteEditor.startOf(path));
  }, [before, [1, 0, 0]]);
  await page.evaluate(() => window.__noteEditor.dispatchBeforeInput("insertText"));
  await page.waitForTimeout(100);
  const got = await page.evaluate(() => window.__noteEditor.json());
  ok("a non-backward inputType is left completely alone", shape(normalise(got)) === shape(normalise(before)));
}

ok("no page errors during the run", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
await browser.close();
process.exit(passed === checks.length ? 0 : 1);
