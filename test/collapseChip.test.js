// FINAL UI SPEC — the two shared primitives Collapse + Chip. DOM-free guards: the pure
// storage-key helper is exercised directly, and the component source is scanned for the
// accessibility + persistence contract (keyboard-toggleable button, aria-expanded, per-
// sectionId localStorage, RowInfo-backed chip popover).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { collapseStorageKey } from "../src/workspaces/site-planner/components/Collapse.jsx";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const collapseSrc = read("../src/workspaces/site-planner/components/Collapse.jsx");
const chipSrc = read("../src/workspaces/site-planner/components/Chip.jsx");

describe("Collapse — per-section persistence + keyboard accessibility", () => {
  it("collapseStorageKey namespaces by section id", () => {
    expect(collapseStorageKey("pond-sizing")).toBe("planyr:collapse:pond-sizing");
    expect(collapseStorageKey("pond-outlet")).not.toBe(collapseStorageKey("pond-sizing"));
  });

  it("the header is a real <button> with aria-expanded (Enter/Space toggle for free)", () => {
    expect(collapseSrc).toMatch(/<button[\s\S]*?aria-expanded=\{open\}/);
    expect(collapseSrc).toContain('type="button"');
  });

  it("open/closed state reads AND writes localStorage under the section key", () => {
    expect(collapseSrc).toContain("localStorage.getItem(collapseStorageKey(sectionId))");
    expect(collapseSrc).toContain("localStorage.setItem(collapseStorageKey(sectionId)");
  });

  it("the one-line summary shows only when closed", () => {
    expect(collapseSrc).toContain("!open && summary");
  });
});

describe("Chip — one-line label + keyboard-openable ⓘ popover (RowInfo), tone not color-only", () => {
  it("carries the full text into a RowInfo popover (the same Basis popover SourceTag uses)", () => {
    expect(chipSrc).toContain('import RowInfo from "./RowInfo.jsx"');
    expect(chipSrc).toContain("<RowInfo");
  });

  it("amber tone adds a ⚠ glyph so color is never the only signal", () => {
    expect(chipSrc).toContain('tone === "amber"');
    expect(chipSrc).toContain("⚠");
  });

  it("uses the warn text token for amber and secondary text for neutral (theme tokens, no raw hex)", () => {
    expect(chipSrc).toContain("var(--warn-text)");
    expect(chipSrc).toContain("var(--text-secondary)");
    expect(chipSrc).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});
