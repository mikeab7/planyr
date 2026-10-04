/* B2046224 amendment — "Food on a phone: typing". The per-field proof (every text field on screen, inside the
 * edge, caret following the text, no contact-AutoFill hooks, on iPhone 15 and SE, keyboard up) lives in
 * ui-audit/verify-food-phone.mjs ARM 4 — a real WebKit browser. The `noAutofill` source sweep for every field is
 * test/foodPhone.test.js (#1941). This file guards only what neither covers: the search field asks the phone for a
 * Search key, in both Map and List views (one component), and the harness still covers the fields it should.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

describe("search field keyboard hints (Map view and List view share one input)", () => {
  const sb = read("src/workspaces/food/components/SearchBox.jsx");
  it("asks for a Search key and keeps the contact-AutoFill opt-out", () => {
    expect(sb).toMatch(/enterKeyHint="search"/);
    expect(sb).toMatch(/\{\.\.\.noAutofill\("place-search"\)\}/);
  });
  it("is the ONLY text input behind both views (no second search box to forget)", () => {
    const list = read("src/workspaces/food/components/VisitList.jsx");
    expect(list).not.toMatch(/<input\b/);
  });
});

describe("the per-field harness covers every text field the module has", () => {
  const h = read("ui-audit/verify-food-phone.mjs");
  it("names each field family: search (Map + List), pin name, visit form, edit visit, dish row", () => {
    for (const id of ["search (Map view)", "search / filter (List view)", "pin name (drop a pin)", "visit form — date", "visit form — notes", "edit old visit", "add a dish — name", "add a dish — price", "add a dish — note"]) {
      expect(h, id).toContain(id);
    }
  });
  it("raises the keyboard by shrinking ONLY the visual viewport (the way iOS does), never the window", () => {
    expect(h).toContain("KEYBOARD_STUB");
    expect(h).not.toMatch(/setViewportSize\(\{ width: vp\.width, height: Math\.round\(vp\.height \* 0\.55\)/);
  });
});
