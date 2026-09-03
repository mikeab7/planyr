/* narrowWidthAudit.mjs — the cheap, baseline-image-free structural gate behind the phone-width
 * visual-regression pass (NEW-2, 2026-09-03).
 *
 * WHY THIS EXISTS. The owner's own screenshot (iPhone, planyr.io, 2026-09-03) showed the update
 * banner ("A newer version of Planyr is available…") rendered as a tall column, roughly one or
 * two words per line, with the Reload/Dismiss buttons squeezed beside it. `visual-regression.mjs`
 * had NEVER rendered anything narrower than 1440px, so nothing could have caught it — and a pixel
 * baseline diff alone wouldn't be a good SECOND line of defence either, because it needs a human
 * to already know what "wrong" looks like for THIS surface before approving the first baseline.
 * This module is the opposite kind of check: a generic, geometry-only rule that names the defect
 * CLASS ("a real sentence squeezed into a sliver of a column") and fails on it regardless of which
 * surface or which future component reproduces it — no baseline required.
 *
 * ⛔ NEVER TRUST THE REQUESTED VIEWPORT — READ IT BACK (per this repo's own recorded trap: a
 * `resize_window` tool once reported success and did nothing, asked for 1200×800 and stayed at
 * 3201×930; `outerWidth`/`outerHeight` read 0 the whole time). `assertRenderedViewport` below is
 * the mandatory precondition every phone-width check in this file's caller runs FIRST — a phone
 * check that silently ran at desktop width is worse than no phone check, because it reports green.
 *
 * ---------------------------------------------------------------------------------------------
 * THE THRESHOLD, MEASURED, NOT ASSUMED (same discipline `visualBaseline.mjs`'s own tolerance
 * section uses). Method: build the app with `src/app/Shell.jsx`'s `UpdateBanner` at its ORIGINAL,
 * broken geometry (`git show HEAD:src/app/Shell.jsx` before this change), serve it, trigger the
 * "newer version available" banner, measure the message `<span>`'s rendered content-box width at
 * a 390×844 phone viewport — then repeat with the fix applied, and again at the existing 1440×900
 * desktop viewport (which the defect never touched) as a control:
 *
 *   BROKEN,  phone (390 CSS px):   message box width  56.9px  — wraps to 12 lines (the reported
 *                                  "roughly one or two words per line" defect, reproduced exactly)
 *   FIXED,   phone (390 CSS px):   message box width 344px    — wraps to  2 lines
 *   (control) desktop (1440 CSS px), either version:  message box width 299px — wraps to 2 lines
 *
 * `PHONE_MIN_CONTENT_WIDTH = 120` sits with real margin on both sides of that gap: >2x the
 * measured broken width (56.9px) and comfortably under BOTH correct renderings (299/344px) — so
 * it flags the defect class without needing to sit exactly at either measured number, which would
 * make the gate brittle to a few px of legitimate future redesign. 120px at this app's own UI font
 * sizes (11.5–14px, `docs/DESIGN.md`'s type scale) comfortably fits 2-3 short words, which is
 * enough room that a real sentence never degenerates into a single-word column — the exact shape
 * of the reported defect.
 *
 * `SENTENCE_MIN_CHARS = 20` is the companion gate that keeps this from flagging legitimately
 * narrow UI text — a nav tab label, a button, a status chip — which this app's own copy never
 * reaches (the shortest RESEMBLING a full phrase, e.g. "Zoom to fit"/"Select parcels", stays under
 * 20 characters; the shortest real banner/notice sentence in this app is 40+). Only text whose
 * OWN, un-wrapped length reads as a phrase/sentence is a candidate — a single word being narrow is
 * not a defect, a full sentence being narrow enough to look like one is.
 *
 * Elements that never wrap in the first place (`white-space: nowrap`/`pre` — the sanctioned
 * single-line-ellipsis truncation pattern this app already uses, e.g. `MiddleTruncate.jsx`) are
 * excluded outright: a narrow box holding a TRUNCATED string is a different, intentional UI
 * pattern, not the "forced onto a ladder of wrapped lines" defect this gate targets.
 * ------------------------------------------------------------------------------------------- */

export const PHONE_MIN_CONTENT_WIDTH = 120;
export const SENTENCE_MIN_CHARS = 20;
// verify-phone-layout.mjs's own existing horizontal-overflow tolerance (check #2 there) — reused
// verbatim rather than picking a second number for the same question.
export const OVERFLOW_EPSILON_PX = 2;

/** Pure verdict, separated from the browser call so it can be unit-tested without one (same split
 *  `tabTiming.mjs` uses for `visibilityVerdict`/`rafVerdict`). `actual` is whatever
 *  `{ innerWidth, innerHeight }` the page reported. */
export function viewportVerdict(actual, expected, harness = "narrowWidthAudit") {
  if (actual.innerWidth === expected.width) return { ok: true };
  return {
    ok: false,
    message:
      `⛔ ${harness}: requested a ${expected.width}px-wide viewport but the page reports ` +
      `window.innerWidth=${actual.innerWidth}. Never trust a viewport SETTING — this repo has already ` +
      "hit a driver that reported success while silently staying at its old size (resize_window: asked " +
      "for 1200x800, stayed 3201x930). Read the rendered width back before measuring anything else.",
  };
}

/** ⛔ THE MANDATORY FIRST CALL for any phone-width check — never trust the requested viewport
 *  option, read back what the page itself reports. Throws (LOUD-FAILURE) on any mismatch, naming
 *  both the requested and the actual numbers, so a silently-ignored viewport request fails the
 *  run instead of quietly reporting a desktop capture as a phone pass. */
export async function assertRenderedViewport(page, expected, harness = "narrowWidthAudit") {
  const actual = await page.evaluate(() => ({
    innerWidth: window.innerWidth, innerHeight: window.innerHeight,
  }));
  const v = viewportVerdict(actual, expected, harness);
  if (!v.ok) throw new Error(v.message);
  return actual;
}

/** Every visible element whose OWN (direct, not-from-descendants) text reads as a sentence/phrase
 *  (`>= minChars`) but whose rendered content box is narrower than `minContentWidth` — the
 *  structural signature of "a real sentence squeezed into a column of wrapped single words."
 *  Elements that never wrap (`white-space: nowrap`/`pre`) are excluded — see file header. Returns
 *  `[]` when clean. Cheap: one pass over `body *`, one `getComputedStyle`/`getBoundingClientRect`
 *  pair per element, no baseline image involved. */
export async function findSqueezedText(page, { minContentWidth = PHONE_MIN_CONTENT_WIDTH, minChars = SENTENCE_MIN_CHARS } = {}) {
  return page.evaluate(({ minContentWidth, minChars }) => {
    const hits = [];
    const all = document.querySelectorAll("body *");
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
      if (cs.whiteSpace === "nowrap" || cs.whiteSpace === "pre") continue;
      let ownText = "";
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) ownText += node.textContent;
      }
      const trimmed = ownText.trim().replace(/\s+/g, " ");
      if (trimmed.length < minChars) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.width < minContentWidth) {
        const testId = el.getAttribute("data-testid") || el.closest("[data-testid]")?.getAttribute("data-testid") || null;
        hits.push({
          tag: el.tagName.toLowerCase(),
          testId,
          text: trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed,
          width: Math.round(rect.width * 100) / 100,
        });
      }
    }
    return hits;
  }, { minContentWidth, minChars });
}

/** Whole-page horizontal overflow — the same check `verify-phone-layout.mjs` already proved
 *  (`scrollWidth <= innerWidth + epsilon`), reused rather than a second implementation. Returns
 *  `null` when clean, or `{ scrollWidth, innerWidth }` naming the overflow. */
export async function findHorizontalOverflow(page, { epsilon = OVERFLOW_EPSILON_PX } = {}) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
  }));
  if (scrollWidth > innerWidth + epsilon) return { scrollWidth, innerWidth };
  return null;
}

/** Pure verdict-formatting, separated from the two browser calls so it can be unit-tested without
 *  one. `squeezed` is `findSqueezedText`'s array, `overflow` is `findHorizontalOverflow`'s result
 *  (or `null`). Returns `{ pass, squeezed, overflow, detail }`. */
export function narrowWidthVerdict(squeezed, overflow, { label, minContentWidth = PHONE_MIN_CONTENT_WIDTH } = {}) {
  const pass = squeezed.length === 0 && !overflow;
  const parts = [];
  if (squeezed.length) {
    parts.push(
      `${squeezed.length} squeezed text block(s) under ${minContentWidth}px wide: ` +
      squeezed.map((h) => `<${h.tag}${h.testId ? ` data-testid="${h.testId}"` : ""}> "${h.text}" @ ${h.width}px`).join("; "),
    );
  }
  if (overflow) parts.push(`horizontal overflow: scrollWidth=${overflow.scrollWidth} > innerWidth=${overflow.innerWidth}`);
  return { pass, squeezed, overflow, detail: pass ? "clean" : `${label ? `${label}: ` : ""}${parts.join(" | ")}` };
}

/** Run both structural checks and return a combined, human-readable verdict —
 *  `{ pass, squeezed, overflow, detail }`. `label` (e.g. `"map-landing (phone/light)"`) is folded
 *  into `detail` so a failure names exactly which capture produced it. */
export async function auditNarrowWidth(page, { viewport, label, minContentWidth, minChars } = {}) {
  if (viewport) await assertRenderedViewport(page, viewport, label || "auditNarrowWidth");
  const [squeezed, overflow] = await Promise.all([
    findSqueezedText(page, { minContentWidth, minChars }),
    findHorizontalOverflow(page),
  ]);
  return narrowWidthVerdict(squeezed, overflow, { label, minContentWidth: minContentWidth ?? PHONE_MIN_CONTENT_WIDTH });
}
