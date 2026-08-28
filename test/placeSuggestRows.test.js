import { describe, it, expect } from "vitest";
import { buildPlaceRows, resolvePlaceEnter, resolvePlaceRowCommit } from "../src/workspaces/site-planner/lib/placeSuggestRows.js";

describe("placeSuggestRows (B831779/NEW-4) — the pure combobox decision layer", () => {
  describe("buildPlaceRows", () => {
    it("idle/empty text → no rows, no note", () => {
      expect(buildPlaceRows("idle", [], "")).toEqual({ rows: [], noMatchNote: null });
    });

    it("results present → one row per result, then the raw-search row", () => {
      const results = [{ label: "123 Main St", lat: 1, lon: 2 }];
      const { rows, noMatchNote } = buildPlaceRows("ready", results, "123 Main");
      expect(noMatchNote).toBeNull();
      expect(rows).toEqual([
        { kind: "result", hit: results[0] },
        { kind: "raw", text: "123 Main" },
      ]);
    });

    it("(a) loading with text typed still carries the raw-search row — Enter has something to land on before any suggestion arrives", () => {
      const { rows } = buildPlaceRows("loading", [], "123 Main");
      expect(rows).toEqual([{ kind: "raw", text: "123 Main" }]);
    });

    it("(d) LOUD-FAILURE: a genuine no-match offers search-anyway + drop-a-pin, never a bare empty list", () => {
      const { rows, noMatchNote } = buildPlaceRows("nomatch", [], "zzzznotaplace");
      expect(noMatchNote).toBe('No matches for "zzzznotaplace".');
      expect(rows).toEqual([
        { kind: "searchAnyway", text: "zzzznotaplace" },
        { kind: "dropPin" },
      ]);
    });

    it("a no-match never also shows the raw-search row (one honest action, not two overlapping ones)", () => {
      const { rows } = buildPlaceRows("nomatch", [], "x");
      expect(rows.some((r) => r.kind === "raw")).toBe(false);
    });
  });

  describe("resolvePlaceEnter — (a) ENTER MUST ALWAYS WORK", () => {
    it("an explicitly highlighted suggestion wins", () => {
      const hit = { label: "123 Main St", lat: 1, lon: 2 };
      const rows = [{ kind: "result", hit }, { kind: "raw", text: "123" }];
      expect(resolvePlaceEnter(rows, 0, "123")).toEqual({ type: "result", hit });
    });

    it("nothing highlighted, suggestions never arrived (rows empty) → still falls through to raw search", () => {
      expect(resolvePlaceEnter([], -1, "123 Main")).toEqual({ type: "raw", text: "123 Main" });
    });

    it("nothing highlighted, suggestions present but ignored → still falls through to raw search, not the top suggestion", () => {
      const rows = [{ kind: "result", hit: { label: "x", lat: 1, lon: 2 } }, { kind: "raw", text: "123" }];
      expect(resolvePlaceEnter(rows, -1, "123")).toEqual({ type: "raw", text: "123" });
    });

    it("no-match state, nothing highlighted → falls through to the search-anyway action", () => {
      const rows = [{ kind: "searchAnyway", text: "zzz" }, { kind: "dropPin" }];
      expect(resolvePlaceEnter(rows, -1, "zzz")).toEqual({ type: "raw", text: "zzz" });
    });

    it("empty text, nothing highlighted → correctly a no-op (nothing to search)", () => {
      expect(resolvePlaceEnter([], -1, "")).toBeNull();
    });

    it("highlighted drop-pin row commits as dropPin", () => {
      const rows = [{ kind: "searchAnyway", text: "zzz" }, { kind: "dropPin" }];
      expect(resolvePlaceEnter(rows, 1, "zzz")).toEqual({ type: "dropPin" });
    });
  });

  describe("resolvePlaceRowCommit — the mouse-click path agrees with the keyboard path", () => {
    it("every row kind resolves to the same action shape Enter would produce", () => {
      const hit = { label: "x", lat: 1, lon: 2 };
      expect(resolvePlaceRowCommit({ kind: "result", hit })).toEqual({ type: "result", hit });
      expect(resolvePlaceRowCommit({ kind: "raw", text: "abc" })).toEqual({ type: "raw", text: "abc" });
      expect(resolvePlaceRowCommit({ kind: "searchAnyway", text: "abc" })).toEqual({ type: "raw", text: "abc" });
      expect(resolvePlaceRowCommit({ kind: "dropPin" })).toEqual({ type: "dropPin" });
    });
  });
});
