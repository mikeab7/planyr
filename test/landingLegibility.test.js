/* LANDING LEGIBILITY — the static half of the guard. (B1384 / NEW-1; page rebuilt B1315632.)
 *
 * The rendered half lives in ui-audit/verify-landing-legibility.mjs, which drives a real
 * browser at several viewport heights and reads computed opacity. That needs Chromium, so
 * it is not a CI step; this file asserts the invariant that made the original bug possible,
 * on every build, with no browser:
 *
 *   THE LANDING PAGE'S COPY MUST NEVER DEPEND ON JAVASCRIPT OR ON AN ANIMATION RUNNING.
 *
 * The 2026-08-03 page shipped with `.reveal { opacity: 0 }` as the RESTING state, so every
 * word on it — headline included — was invisible until a 72 KB vendor animation library
 * downloaded, parsed, and ran. The B1315632 rebuild (2026-09-07) removed that whole
 * mechanism rather than re-gating it: the page is now plain, always-visible HTML with a
 * purely decorative canvas behind it, so the simplest way to hold the invariant is to have
 * NO rule anywhere that hides text pending JS — this file asserts exactly that, plus the
 * cost/pricing-language ban B1315632 added (owner hard rule, 2026-09-06).
 *
 * The cost/pricing ban (below) also covers /privacy/, /terms/ (B1344528, 2026-09-09) and
 * /404.html (B1433761, 2026-09-09) — the standing "the landing page never mentions money"
 * decision applies to every page reachable from it, and a terms-of-service template reaches
 * for a Fees-and-Payment section by reflex. The legibility checks above stay landing-only:
 * the other three pages are static text/markup with no reveal mechanism and no canvas to
 * begin with, so there is nothing there for that half of the guard to catch.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HTML = readFileSync(
  fileURLToPath(new URL("../public/landing/index.html", import.meta.url)),
  "utf8"
);
const PRIVACY_HTML = readFileSync(
  fileURLToPath(new URL("../public/privacy/index.html", import.meta.url)),
  "utf8"
);
const TERMS_HTML = readFileSync(
  fileURLToPath(new URL("../public/terms/index.html", import.meta.url)),
  "utf8"
);
const NOT_FOUND_HTML = readFileSync(
  fileURLToPath(new URL("../public/404.html", import.meta.url)),
  "utf8"
);

/* The page's one <style> block. */
const CSS_RAW = (HTML.match(/<style>([\s\S]*?)<\/style>/) || [, ""])[1];
/* Comments out first — a `/* … *\/` immediately above a rule otherwise gets swept into
 * that rule's selector by the flat parser below. */
const CSS = CSS_RAW.replace(/\/\*[\s\S]*?\*\//g, "");

/* Rules, as { selector, body } pairs. The stylesheet is flat apart from @media blocks,
 * whose inner rules this picks up too — a hidden start state inside a media query hides
 * copy just as effectively as one at the top level. */
function rules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1].trim().replace(/\s+/g, " ");
    if (!sel || sel.startsWith("@")) continue;
    out.push({ sel, body: m[2].trim() });
  }
  return out;
}

const RULES = rules(CSS);

/* Purely decorative, wordless surfaces: the contour canvas and its scrim. */
const DECORATIVE = [/^#bg$/, /^\.scrim$/];

describe("landing page copy is legible without JavaScript (B1384, rebuilt B1315632)", () => {
  it("has a <style> block the parser could read", () => {
    expect(CSS.length).toBeGreaterThan(1000);
    expect(RULES.length).toBeGreaterThan(20);
  });

  it("no rule hides text with opacity: 0 or visibility: hidden/collapse", () => {
    const offenders = RULES.filter(
      (r) =>
        (/(^|;)\s*opacity:\s*0(\.0+)?\s*(;|$)/.test(r.body) ||
          /(^|;)\s*visibility:\s*(hidden|collapse)\s*(;|$)/.test(r.body)) &&
        !DECORATIVE.some((d) => r.sel.split(",").every((s) => d.test(s.trim())))
    );
    expect(
      offenders.map((o) => o.sel),
      "these hide copy before JS runs — the page has no reveal mechanism to scope them behind"
    ).toEqual([]);
  });

  it("the body's real content is plain HTML text, not injected by a script", () => {
    // The hero H1, sub-copy, matrix and CTAs must all be literal text in the document —
    // never built up by JS at runtime, which is exactly what a JS-off / slow-network visitor
    // would never see. Comments stripped first: this file's own <head> comment EXPLAINS the
    // non-blocking pattern in prose containing the literal string "<script>", which would
    // otherwise fool a naive indexOf into slicing an empty range (the same trap
    // bootRenderBlocking.test.js's stripComments exists for).
    const noComments = HTML.replace(/<!--[\s\S]*?-->/g, "");
    const bodyHtml = noComments.slice(noComments.indexOf("<body>"), noComments.lastIndexOf("<script>"));
    expect(bodyHtml).toContain("A workspace built around the site.");
    expect(bodyHtml).toContain("Open Planyr");
    expect(bodyHtml).toContain("Create an account");
  });

  it("fonts load non-blocking (media=print + onload), same pattern B1384 required", () => {
    // The <noscript> fallback is a plain blocking link BY DESIGN — it only applies when
    // scripts are off, where the onload promotion could never fire anyway.
    const offenders = [...HTML.matchAll(/<link\b[^>]*rel\s*=\s*["']stylesheet["'][^>]*>/gi)]
      .map((m) => m[0])
      .filter((tag) => /fonts\.googleapis\.com/.test(tag))
      .filter((tag) => !/media\s*=\s*["']print["']/i.test(tag))
      .filter((tag) => !HTML.includes(`<noscript>${tag}`));
    expect(offenders).toEqual([]);
  });
});

// Whole-word / whole-phrase matches only, so this can't false-positive on an unrelated word
// that merely contains one of these as a substring (e.g. "freeboard", "planyr" itself,
// "error-free" — the hyphen is a word boundary too, so that one genuinely does match "free"
// and has to be written around, not carved out here).
const BANNED_WORDS = /\b(price|prices|priced|pricing|plan|plans|tier|tiers|free|paid|cost|costs|costing|charge|charges|billing|subscription|trial)\b/i;
const BANNED_PHRASES = [/credit card/i, /investment committee/i, /cost estimat/i];

const MONEY_SILENT_PAGES = [
  ["/landing/", HTML],
  ["/privacy/", PRIVACY_HTML],
  ["/terms/", TERMS_HTML],
  ["/404.html", NOT_FOUND_HTML],
];

describe.each(MONEY_SILENT_PAGES)("%s never mentions cost in any direction (owner hard rule, 2026-09-06; extended to /privacy/ and /terms/ B1344528, and /404.html B1433761)", (_path, html) => {
  it("carries none of the banned cost/pricing words or phrases anywhere in the built file", () => {
    const hits = [];
    html.split("\n").forEach((line, i) => {
      if (BANNED_WORDS.test(line)) hits.push(`line ${i + 1} (word): ${line.trim().slice(0, 90)}`);
      for (const p of BANNED_PHRASES) {
        if (p.test(line)) hits.push(`line ${i + 1} (phrase ${p}): ${line.trim().slice(0, 90)}`);
      }
    });
    expect(hits, `cost/pricing language found:\n${hits.join("\n")}`).toEqual([]);
  });

  it("the structured data (JSON-LD), if any, carries no offers/price block", () => {
    const ld = (html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [, ""])[1];
    expect(ld).not.toMatch(/"offers"/);
    expect(ld).not.toMatch(/"price"/i);
  });

  it("avoids the banned marketing words", () => {
    const banned = /\b(instantly|seamless(ly)?|easily|powerful)\b/i;
    const hit = html.split("\n").find((l) => banned.test(l));
    expect(hit, `banned word on: ${hit}`).toBeUndefined();
  });
});

describe("the account fact is stated once, quietly, in the fine print (owner spec, 2026-09-06)", () => {
  it("the fine print under the buttons carries the account sentence, and nothing else does", () => {
    const FINE_PRINT = "Sign up only when you want to keep your work.";
    expect(HTML).toContain(FINE_PRINT);
    const occurrences = HTML.split(FINE_PRINT).length - 1;
    expect(occurrences).toBe(1);
    // Never in the eyebrow, never as a standalone banner.
    const eyebrow = (HTML.match(/<p class="eyebrow">([\s\S]*?)<\/p>/) || [, ""])[1];
    expect(eyebrow).not.toMatch(/sign up|account|sign in/i);
  });
});
