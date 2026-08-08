/* B276576 — the app entry must not boot behind a cross-origin render-blocking resource.
 *
 * THE DEFECT. index.html carried a plain <link rel="stylesheet"> to fonts.googleapis.com. A
 * stylesheet is render-blocking, and a script cannot EXECUTE until every preceding stylesheet
 * resolves — so the entry module, i.e. the whole app, waited on a third-party round trip on
 * every load, and that host's latency passed through one-for-one. The landing page fixed the
 * same defect in B1384; the app entry was never carried across, and nothing in the repo noticed
 * for months. Worse, two instruments RECORDED it and responded by MUTING the metrics it spoiled
 * (ui-audit/perf-harness.mjs, docs/PERF-BUDGETS.md) rather than by failing.
 *
 * WHY A SOURCE-LEVEL TEST AS WELL AS THE HARNESS. ui-audit/verify-font-blocking.mjs proves the
 * property in a real browser and proves the check can fail (its control arm is the pre-fix
 * build). It needs Chromium, so it cannot be the required CI gate. This is the cheap half: it
 * asserts the STATIC property in `npm test`, where a reintroduced <link> gets caught in seconds.
 * The two are deliberately different in kind — one measures, one forbids.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/* Strip comments first: index.html EXPLAINS the removed tag in prose, and a naive scan would
 * match the explanation and fail on a file that is correct. */
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

const isCrossOrigin = (url) => /^(https?:)?\/\//i.test(url);

/** Every <link rel=stylesheet> in the document, with the attributes that decide if it blocks. */
function stylesheetLinks(html) {
  const out = [];
  for (const tag of stripComments(html).match(/<link\b[^>]*>/gi) || []) {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;
    const href = (tag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
    const media = (tag.match(/media\s*=\s*["']([^"']+)["']/i) || [])[1] || "";
    out.push({ tag, href, media, blocking: media.trim().toLowerCase() !== "print" });
  }
  return out;
}

/** Synchronous <script src> — blocks the parser and everything after it. */
function syncScripts(html) {
  const out = [];
  for (const tag of stripComments(html).match(/<script\b[^>]*>/gi) || []) {
    const src = (tag.match(/src\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!src) continue;
    if (/\b(defer|async)\b/i.test(tag) || /type\s*=\s*["']module["']/i.test(tag)) continue;
    out.push({ tag, src });
  }
  return out;
}

describe("the app entry (index.html) boots with no cross-origin render-blocking resource", () => {
  const html = read("index.html");

  it("has no render-blocking cross-origin stylesheet", () => {
    const offenders = stylesheetLinks(html).filter((l) => l.blocking && isCrossOrigin(l.href));
    expect(offenders.map((o) => o.href)).toEqual([]);
  });

  it("has no synchronous cross-origin script", () => {
    const offenders = syncScripts(html).filter((s) => isCrossOrigin(s.src));
    expect(offenders.map((o) => o.src)).toEqual([]);
  });

  it("does not reference a third-party font host at all — Inter is self-hosted", () => {
    // Deliberately stricter than "not render-blocking": the whole point of self-hosting is that
    // there is no second origin left to be slow, blocked, or filtered. A preconnect to a host we
    // no longer use is also dead weight, and this catches that too.
    expect(stripComments(html)).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  it("preloads the latin subset it actually needs, with crossorigin", () => {
    const preload = (stripComments(html).match(/<link\b[^>]*rel\s*=\s*["']preload["'][^>]*>/gi) || [])
      .find((t) => /as\s*=\s*["']font["']/i.test(t));
    expect(preload, "expected a font preload for the self-hosted face").toBeTruthy();
    // Fonts are fetched in CORS mode even same-origin; without crossorigin the preload is
    // discarded and the file is fetched a SECOND time — a silent regression that still "works".
    expect(preload).toMatch(/\bcrossorigin\b/i);
    expect(preload).toMatch(/inter-latin\.woff2/);
    // latin-ext must NOT be preloaded: its unicode-range means it is only fetched if such a
    // character appears, and preloading it would spend 83 KB on a UI that never shows one.
    expect(preload).not.toMatch(/latin-ext/);
  });
});

describe("the self-hosted Inter files exist and are declared correctly", () => {
  const css = read("src/index.css");

  it("declares @font-face for both shipped subsets", () => {
    expect(css).toMatch(/@font-face/);
    for (const f of ["/fonts/inter-latin.woff2", "/fonts/inter-latin-ext.woff2"]) {
      expect(css, `index.css should reference ${f}`).toContain(f);
    }
  });

  it("every url() the stylesheet declares resolves to a real file", () => {
    const urls = [...css.matchAll(/url\(["']?(\/fonts\/[^"')]+)["']?\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(existsSync(join(ROOT, "public", u)), `missing font file: public${u}`).toBe(true);
    }
  });

  it("ships valid WOFF2 (a truncated or HTML-error-page download would still 'exist')", () => {
    for (const f of ["inter-latin.woff2", "inter-latin-ext.woff2"]) {
      const buf = readFileSync(join(ROOT, "public/fonts", f));
      expect(buf.subarray(0, 4).toString("latin1"), `${f} is not WOFF2`).toBe("wOF2");
      // WOFF2 records its own total length at byte 8; a short read fails here rather than at
      // runtime as an invisible fallback to system-ui.
      expect(buf.readUInt32BE(8), `${f} is truncated`).toBe(buf.length);
    }
  });

  it("uses font-display: swap, so text is never invisible while the face loads", () => {
    const faces = css.match(/@font-face\s*\{[^}]*\}/g) || [];
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) expect(face).toMatch(/font-display:\s*swap/);
  });
});

describe("the landing page keeps the non-blocking pattern B1384 gave it", () => {
  const html = read("public/landing/index.html");

  it("loads any cross-origin stylesheet non-blocking (media=print + onload promotion)", () => {
    const offenders = stylesheetLinks(html).filter((l) => l.blocking && isCrossOrigin(l.href));
    // The <noscript> fallback is a plain blocking link BY DESIGN — it only applies when scripts
    // are off, where the onload promotion could never fire. Exclude it, don't weaken the rule.
    const real = offenders.filter((o) => !html.includes(`<noscript><link href="${o.href}"`));
    expect(real.map((o) => o.href)).toEqual([]);
  });
});

describe("the sequence page no longer depends on a third-party font host", () => {
  const html = read("public/sequence/index.html");
  const head = stripComments(html).split(/<\/head>/i)[0];

  it("does not load its UI font from fonts.googleapis.com", () => {
    const fontLinks = stylesheetLinks(head).filter((l) => /fonts\.googleapis\.com/.test(l.href));
    expect(fontLinks.map((l) => l.href)).toEqual([]);
  });

  /* HONEST EXCEPTION, recorded rather than hidden. This page still pulls two OTHER render-blocking
   * third-party resources: the jsdelivr icon webfont stylesheet and a synchronous supabase-js
   * script. They are a functional-dependency question, not a font question, and were deliberately
   * left alone by B276576 — but they are ASSERTED here so the file's real state is visible and a
   * future reader is not misled into thinking this page is third-party-free the way index.html is.
   * If someone fixes them, this test fails and should be tightened, not deleted. */
  it("has exactly the two known non-font third-party blockers, and no more", () => {
    const blockers = [
      ...stylesheetLinks(head).filter((l) => l.blocking && isCrossOrigin(l.href)).map((l) => l.href),
      ...syncScripts(head).filter((s) => isCrossOrigin(s.src)).map((s) => s.src),
    ];
    expect(blockers.every((b) => /jsdelivr\.net/.test(b)), `unexpected third-party blocker: ${blockers}`).toBe(true);
    expect(blockers.length).toBe(2);
  });
});
