import { describe, it, expect } from "vitest";
import { resolveLoaderTheme, LOADER_SKINS, SHOW_DELAY_MS } from "../src/shared/ui/moduleLoaderTheme.js";
import { MODULE_ACCENT } from "../src/shared/ui/moduleAccent.js";

describe("moduleLoaderTheme — reusable per-module loader theming (B222)", () => {
  it("themes Schedule as the Gantt skin in the Schedule accent #7F77DD", () => {
    const t = resolveLoaderTheme("scheduler");
    expect(t.kind).toBe("gantt");
    expect(t.accent).toBe("#7F77DD");
    expect(t.accent).toBe(MODULE_ACCENT["scheduler"]);
    expect(t.label).toMatch(/schedule/i);
  });

  it("themes Site Planner as the footprint skin in the Site accent #1D9E75", () => {
    const t = resolveLoaderTheme("site-planner");
    expect(t.kind).toBe("site");
    expect(t.accent).toBe("#1D9E75");
    expect(t.accent).toBe(MODULE_ACCENT["site-planner"]);
  });

  it("pulls the accent from the shared MODULE_ACCENT for every known skin (no drift)", () => {
    Object.keys(LOADER_SKINS).forEach((id) => {
      expect(resolveLoaderTheme(id).accent).toBe(MODULE_ACCENT[id]);
    });
  });

  it("falls back to a generic gantt skin + default accent for an unknown module (never blank)", () => {
    const t = resolveLoaderTheme("does-not-exist");
    expect(t.kind).toBe("gantt");
    expect(t.accent).toBe("#e8590c");
    expect(typeof t.label).toBe("string");
    expect(t.label.length).toBeGreaterThan(0);
  });

  it("only reveals after a perceptible threshold so fast loads don't flash", () => {
    expect(SHOW_DELAY_MS).toBeGreaterThanOrEqual(200);
    expect(SHOW_DELAY_MS).toBeLessThanOrEqual(300);
  });
});
