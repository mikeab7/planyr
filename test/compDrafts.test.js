import { describe, it, expect } from "vitest";
import { rowToImportDraft, importDraftToInsertRow } from "../src/shared/comps/lib/compDrafts.js";

describe("compDrafts: row <-> model", () => {
  it("maps a DB row to the camelCase model", () => {
    const row = {
      id: "d1", user_id: "u1", source: "kml", source_file: "jordan.kml",
      raw_name: "Tract A", raw_description: "3.2 AC, $850k", raw_geometry: { kind: "point", lat: 29.8, lon: -95.8 },
      proposed: { compType: "land" }, status: "pending", promoted_comp_id: null, promote_error: null,
      created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
    };
    const d = rowToImportDraft(row);
    expect(d.sourceFile).toBe("jordan.kml");
    expect(d.rawName).toBe("Tract A");
    expect(d.rawGeometry).toEqual({ kind: "point", lat: 29.8, lon: -95.8 });
    expect(d.proposed).toEqual({ compType: "land" });
    expect(d.status).toBe("pending");
  });

  it("defaults proposed to {} when the row carries none", () => {
    const d = rowToImportDraft({ id: "d1", user_id: "u1", source: "kml", status: "pending" });
    expect(d.proposed).toEqual({});
  });

  it("importDraftToInsertRow never includes user_id — server-stamped", () => {
    const row = importDraftToInsertRow({ source: "kml", source_file: "x.kml", raw_name: "n", proposed: { a: 1 } });
    expect(row.user_id).toBeUndefined();
    expect(row.source_file).toBe("x.kml");
    expect(row.status).toBe("pending"); // default
  });
});
