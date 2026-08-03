/* LANDING LEGIBILITY — the static half of the guard. (B1384 / NEW-1.)
 *
 * The rendered half lives in ui-audit/verify-landing-legibility.mjs, which drives a real
 * browser at several viewport heights and reads computed opacity. That needs Chromium, so
 * it is not a CI step; this file asserts the invariant that made the bug possible in the
 * first place, on every build, with no browser:
 *
 *   THE LANDING PAGE'S COPY MUST NEVER DEPEND ON JAVASCRIPT OR ON AN ANIMATION RUNNING.
 *
 * The live page shipped for four weeks with `.reveal { opacity: 0 }` as the RESTING state,
 * so every word on it — headline included — was invisible until a 72 KB vendor animation
 * library downloaded, parsed, and ran. A slow connection, a blocked file, a JS error or
 * JS-off made the page permanently wordless, and nothing caught it because the existing
 * checks asserted a readiness FLAG rather than a rendered PIXEL.
 *
 * So: any start state that hides copy must be scoped to `html.anim`, the class the <head>
 * gate adds and then releases the moment the animation is either running or not coming.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HTML = readFileSync(
  fileURLToPath(new URL("../public/landing/index.html", import.meta.url)),
  "utf8"
);

/* The page's one <style> block. */
const CSS_RAW = (HTML.match(/<style>([\s\S]*?)<\/style>/) || [, ""])[1];
/* Comments out first — a `/* … *\/` immediately above a rule otherwise gets swept into
 * that rule's selector by the flat parser below. */
const CSS = CSS_RAW.replace(/\/\*[\s\S]*?\*\//g, "");

/* Rules, as { selector, body } pairs. The stylesheet is flat apart from @media blocks,
 * whose inner rules this picks up too — which is what we want, since a hidden start state
 * inside a media query hides copy just as effectively. */
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

/* Purely decorative surfaces that carry no words: the WebGL fallback mark and the
 * self-measuring viewport dimension line. Hiding these hides nothing a reader needs. */
const DECORATIVE = [/^#bg-fallback$/, /^#vp-dim(\.hide)?$/];

/* Selectors that are the animation's own opt-in state. */
const isGated = (sel) => sel.split(",").every((s) => s.trim().startsWith("html.anim"));

describe("landing page copy is legible without JavaScript (B1384 / NEW-1)", () => {
  it("has a <style> block the parser could read", () => {
    expect(CSS.length).toBeGreaterThan(1000);
    expect(RULES.length).toBeGreaterThan(50);
  });

  it("the .reveal resting state is fully opaque, not hidden", () => {
    const base = RULES.filter((r) => /(^|,)\s*\.reveal\s*$/.test(r.sel));
    expect(base.length, "expected a bare `.reveal` rule").toBeGreaterThan(0);
    for (const r of base) {
      expect(r.body, `\`${r.sel}\` must not hide copy`).not.toMatch(/opacity:\s*0\s*(;|$)/);
      expect(r.body).toMatch(/opacity:\s*1/);
    }
  });

  it("no un-gated rule hides text with opacity: 0", () => {
    const offenders = RULES.filter(
      (r) =>
        /(^|;)\s*opacity:\s*0(\.0+)?\s*(;|$)/.test(r.body) &&
        !isGated(r.sel) &&
        !DECORATIVE.some((d) => r.sel.split(",").every((s) => d.test(s.trim())))
    );
    expect(
      offenders.map((o) => o.sel),
      "these hide copy before JS runs — scope them to `html.anim` instead"
    ).toEqual([]);
  });

  it("the reveal gate is installed in <head>, ahead of the body", () => {
    const head = HTML.slice(0, HTML.indexOf("</head>"));
    expect(head).toContain("__landingArmAnim");
    expect(head).toMatch(/classList\.remove\("anim"\)/);
    // A watchdog, so a vendor script that never arrives cannot hold the words hostage.
    expect(head).toMatch(/setTimeout\(function \(\) \{ release\("watchdog"\); \}, \d+\)/);
    // …and a reduced-motion path that never arms the gate at all.
    expect(head).toMatch(/prefers-reduced-motion: reduce/);
    expect(head).toMatch(/if \(reduce\) return;/);
  });

  it("build() refuses to animate copy the gate has already put on screen", () => {
    expect(HTML).toMatch(/var ANIM =[\s\S]{0,120}__landingArmAnim/);
    expect(HTML).toMatch(/if \(REDUCE \|\| !ANIM\)/);
  });

  it("the reduced-motion stylesheet still forces every reveal visible", () => {
    const rm = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(rm).toMatch(/\.reveal \{ opacity: 1 !important/);
  });
});

describe("landing page advertises only what is built (B1385 / NEW-2)", () => {
  it("carries no Cost Estimating claim anywhere, including meta and structured data", () => {
    expect(HTML).not.toMatch(/cost estimat/i);
    expect(HTML).not.toMatch(/investment committee/i);
  });

  it("avoids the banned marketing words", () => {
    const banned = /\b(instantly|seamless(ly)?|easily|powerful)\b/i;
    const hit = HTML.split("\n").find((l) => banned.test(l));
    expect(hit, `banned word on: ${hit}`).toBeUndefined();
  });

  it("does not repeat the hero badges verbatim in the feature list", () => {
    const proof = (HTML.match(/<div class="proof-row reveal">([\s\S]*?)<\/div>/) || [, ""])[1];
    const badges = [...proof.matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1].trim());
    expect(badges.length).toBeGreaterThan(0);
    const spec = HTML.slice(HTML.indexOf('<div class="spec-table"'));
    for (const b of badges) {
      expect(spec, `hero badge "${b}" is already a numbered feature`).not.toContain(b);
    }
  });
});
