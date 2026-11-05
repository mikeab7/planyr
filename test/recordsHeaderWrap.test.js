// B2450464 — the Records tab header row (label + Paste comps / Import / Site plan) must be able to wrap inside
// the narrowest rail. Source guard for the CI-runnable half; the real layout check is ui-audit/verify-records-header-row.mjs
// (Chromium at the rail's min / mid / max width + WebKit phone), red on the previous no-wrap row.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/shared/comps/components/CompsPanel.jsx", import.meta.url), "utf8");
const at = src.indexOf("data-records-header");
const block = src.slice(at, src.indexOf("drafts.length > 0", at));

describe("Records header row wraps (B2450464)", () => {
  it("is marked for the layout harness", () => expect(at).toBeGreaterThan(0));
  it("the header row wraps instead of overflowing the rail", () => {
    expect(block.slice(0, 400)).toMatch(/flexWrap: "wrap"/);
  });
  it("the button group wraps and may shrink (no flex: none)", () => {
    expect(block).toMatch(/<span style=\{\{ display: "flex", flexWrap: "wrap", gap: 6, minWidth: 0 \}\}>/);
    expect(block).not.toMatch(/flex: "none" \}\}>\s*<button/);
  });
  it("every action keeps its label on one line and its own text size", () => {
    expect((block.match(/whiteSpace: "nowrap"/g) || []).length).toBe(3);
    expect((block.match(/fontSize: 10\.5/g) || []).length).toBe(4); // label + three buttons: one size
  });
});
