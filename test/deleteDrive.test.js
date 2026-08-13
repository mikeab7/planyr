/* NEW-3 — a synthetic Delete keystroke does not delete, and a single DOM read is not a check.
 *
 * THE COST. Two cleanup rounds on the owner's LIVE plans: a stray easement left on
 * Bain / "Concept - Original" (2026-08-08) and three pasted markups left on Silvestri
 * (V27088, 2026-08-09). Both times a harness "deleted" the object, reported success, and the object
 * was still on his plan.
 *
 * THE MECHANISM, measured on build 7307342 (see ui-audit/lib/deleteFeature.mjs for the full table):
 * the planner's key handler is bound to `window`, and `new KeyboardEvent("keydown", …)` defaults
 * `bubbles: false`, so a synthetic event dispatched on `document` or `document.body` never reaches
 * it. It fails in total silence — no error, nothing in the console, the object still selected.
 *
 * TWO HALVES. The verdict table is pinned here; the SOURCE SWEEP below stops a synthetic delete
 * coming back. The live positive control — which re-measures the table itself against the real app
 * every run, so the rule cannot become folklore — is `ui-audit/verify-delete-drive.mjs`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { deleteVerdict, findsSyntheticDelete, DELETE_ROUTES, BANNED_ROUTE, DEFAULTS } from "../ui-audit/lib/deleteFeature.mjs";

describe("deleteVerdict — a driver that runs out of ideas must SAY SO, never report a pass", () => {
  it("stops happy the moment the feature is genuinely absent", () => {
    const v = deleteVerdict([{ route: "key", stillPresent: false }]);
    expect(v).toMatchObject({ done: true, ok: true });
    expect(v.why).toContain("key");
  });

  it("escalates to the next route rather than repeating the one that just did nothing", () => {
    const v = deleteVerdict([{ route: "key", stillPresent: true }]);
    expect(v).toMatchObject({ done: false, ok: false, nextRoute: "panel" });
    const v2 = deleteVerdict([{ route: "key", stillPresent: true }, { route: "panel", stillPresent: true }]);
    expect(v2.nextRoute).toBe("menu");
  });

  it("starts on the key route with nothing tried", () => {
    expect(deleteVerdict([]).nextRoute).toBe(DELETE_ROUTES[0]);
    expect(deleteVerdict(null).nextRoute).toBe(DELETE_ROUTES[0]);
  });

  it("⛔ FAILS LOUDLY when every route has been tried and the feature is still there", () => {
    const tried = DELETE_ROUTES.map((route) => ({ route, stillPresent: true }));
    const v = deleteVerdict([...tried, { route: "key", stillPresent: true }], DEFAULTS.maxAttempts);
    expect(v).toMatchObject({ done: true, ok: false });
    expect(v.why).toMatch(/still present after 4/);
    /* THE WHOLE POINT: this is the state the two live cleanups were in, and both reported success. */
  });

  it("a success on the LAST allowed attempt is still a success", () => {
    const attempts = [
      { route: "key", stillPresent: true },
      { route: "panel", stillPresent: true },
      { route: "menu", stillPresent: true },
      { route: "key", stillPresent: false },
    ];
    expect(deleteVerdict(attempts, 4)).toMatchObject({ done: true, ok: true });
  });

  it("never offers the banned route", () => {
    expect(DELETE_ROUTES).not.toContain(BANNED_ROUTE);
    for (let i = 0; i < 6; i++) {
      const v = deleteVerdict(Array.from({ length: i }, () => ({ route: "key", stillPresent: true })), 99);
      expect(v.nextRoute).not.toBe(BANNED_ROUTE);
    }
  });
});

describe("findsSyntheticDelete — the detector, proven both ways", () => {
  it("catches the shape that silently does nothing", () => {
    expect(findsSyntheticDelete(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }))`).hit).toBe(true);
    expect(findsSyntheticDelete(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }))`).hit).toBe(true);
    expect(findsSyntheticDelete(
      `const ev = new KeyboardEvent("keydown", { key: "Delete", bubbles: true });\nwindow.dispatchEvent(ev);`).hit).toBe(true);
  });

  it("leaves the real driver paths alone", () => {
    expect(findsSyntheticDelete(`await page.keyboard.press("Delete");`).hit).toBe(false);
    expect(findsSyntheticDelete(`await page.getByRole("button", { name: /^Delete/ }).click();`).hit).toBe(false);
    // an unrelated synthetic key is not this rule's business
    expect(findsSyntheticDelete(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`).hit).toBe(false);
  });

  it("survives junk without throwing", () => {
    for (const bad of [null, undefined, "", 7, {}]) expect(findsSyntheticDelete(bad).hit).toBe(false);
  });
});

/* ── the source sweep ──────────────────────────────────────────────────────────────────────── */

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".auth" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

const ROOT = new URL("..", import.meta.url).pathname;
const OWN = [join(ROOT, "ui-audit/lib/deleteFeature.mjs"), join(ROOT, "ui-audit/verify-delete-drive.mjs")];

describe("SOURCE SWEEP — nothing that drives a browser deletes with a synthetic keystroke", () => {
  const files = [join(ROOT, "ui-audit"), join(ROOT, "e2e")].flatMap((d) => walk(d)).filter((f) => !OWN.includes(f));

  it("finds files to sweep (a guard that scans nothing is a permanent green)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("has no synthetic Delete / Backspace dispatch left", () => {
    const offenders = [];
    for (const f of files) {
      const { hit, snippets } = findsSyntheticDelete(readFileSync(f, "utf8"));
      if (hit) offenders.push(`${f.replace(ROOT, "")}\n    ${snippets.join("\n    ")}`);
    }
    expect(offenders, `a synthetic Delete does not delete — the app's handler is on \`window\` and a KeyboardEvent defaults to bubbles:false. Use page.keyboard.press("Delete") or deleteFeatureUntilGone() from ui-audit/lib/deleteFeature.mjs:\n\n${offenders.join("\n\n")}`)
      .toEqual([]);
  });

  it("the two files that DO carry the banned shape are the ones documenting it", () => {
    /* The rule's own positive control must contain what it bans, or it could not prove the claim.
     * Asserting that keeps the exemption list honest — it may not quietly grow. */
    expect(OWN.length).toBe(2);
    expect(findsSyntheticDelete(readFileSync(OWN[1], "utf8")).hit).toBe(true);
  });
});
