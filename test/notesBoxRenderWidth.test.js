/* B2078593 ×2 — a box renders at its STORED width on every device. The owner's phone squeezed a stored
 * 873-wide box to 386 because the render fit clamped it to the SCREEN pane's unscaled width (a number
 * unrelated to the page the view then scales). The render must never be handed a host width. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fitAnchorBox } from "../src/workspaces/notes/lib/notesAnchorNode.js";

describe("a box renders at its stored width", () => {
  it("fitAnchorBox with no host width returns the stored width untouched (873 stays 873)", () => {
    expect(fitAnchorBox({ x: 0, w: 873 })).toEqual({ x: 0, w: 873 });
    expect(fitAnchorBox({ x: 220, w: 640 })).toEqual({ x: 220, w: 640 });
  });
  it("…and the function still clamps when a caller DOES hand it a host (its own contract is unchanged)", () => {
    expect(fitAnchorBox({ x: 0, w: 873, hostWidth: 390 }).w).toBe(386);
  });
  it("NoteEditor's layout fit never passes a host width — the screen pane is not the page", () => {
    const src = readFileSync(new URL("../src/workspaces/notes/components/NoteEditor.jsx", import.meta.url), "utf8");
    const calls = [...src.matchAll(/fitAnchorBox\(\{([^}]*)\}\)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) expect(args, `fitAnchorBox({${args}}) must not carry hostWidth`).not.toMatch(/hostWidth/);
  });
});
