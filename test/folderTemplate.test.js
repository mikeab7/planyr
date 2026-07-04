import { describe, it, expect } from "vitest";
import { FOLDER_TEMPLATE, TEMPLATE_VERSION } from "../src/shared/folders/folderTemplate.js";
import { flattenTemplate, countTemplate, buildSeedRows } from "../src/shared/folders/folderTree.js";

const byName = (nodes, name) => (nodes || []).find((n) => n.name === name);

describe("FOLDER_TEMPLATE — canonical default structure (B650)", () => {
  it("has exactly the 12 numbered top-level categories in order", () => {
    expect(FOLDER_TEMPLATE.map((n) => n.name)).toEqual([
      "01. Hillwood",
      "02. Design",
      "03. Sustainability",
      "04. Governmental",
      "05. General Contractor",
      "06. Insurance",
      "07. Financing",
      "08. Land",
      "09. Testing Contractor",
      "10. Utilities",
      "11. Close-Out",
      "12. Bldg Acq",
    ]);
  });

  it("01. Hillwood ships all 20 subfolders (through 20. Financing)", () => {
    const hillwood = byName(FOLDER_TEMPLATE, "01. Hillwood");
    expect(hillwood.children).toHaveLength(20);
    expect(hillwood.children[0].name).toBe("01. Correspondence");
    expect(hillwood.children[19].name).toBe("20. Financing");
  });

  it("02. Design → 01. Drawings holds 9 disciplines, each with Current + Archive", () => {
    const design = byName(FOLDER_TEMPLATE, "02. Design");
    const drawings = byName(design.children, "01. Drawings");
    expect(drawings.children).toHaveLength(9);
    expect(drawings.children.map((d) => d.name)).toEqual([
      "01. Exhibits", "02. Site Plans", "03. Architectural", "04. Structural",
      "05. Civil", "06. Landscape", "07. Mechanical", "08. Electrical", "09. Plumbing",
    ]);
    for (const disc of drawings.children) {
      expect(disc.children.map((c) => c.name)).toEqual(["01. Current", "02. Archive"]);
    }
  });

  it("02. Specifications is a SIBLING of Drawings, not nested inside it", () => {
    const design = byName(FOLDER_TEMPLATE, "02. Design");
    expect(byName(design.children, "02. Specifications")).toBeTruthy();
    const drawings = byName(design.children, "01. Drawings");
    expect(byName(drawings.children, "02. Specifications")).toBeFalsy();
    expect(design.children.map((c) => c.name)).toEqual([
      "01. Drawings", "02. Specifications", "03. Contracts",
      "04. Reports & Studies", "05. Correspondence", "06. Invoices",
    ]);
  });

  it("ships the intentionally-short categories exactly as scoped", () => {
    expect(byName(FOLDER_TEMPLATE, "08. Land").children).toHaveLength(13); // 01–13
    expect(byName(FOLDER_TEMPLATE, "11. Close-Out").children).toHaveLength(10); // 01–10
    const bldg = byName(FOLDER_TEMPLATE, "12. Bldg Acq");
    expect(bldg.children).toBeUndefined(); // empty top-level category
  });

  it("every folder name uses the zero-padded 'NN. ' prefix at every level", () => {
    for (const r of flattenTemplate(FOLDER_TEMPLATE)) {
      expect(r.name).toMatch(/^\d{2}\.\s/);
    }
  });

  it("totals 133 folders (12 top-level + 121 subfolders) and exposes a version", () => {
    expect(countTemplate(FOLDER_TEMPLATE)).toBe(133);
    expect(flattenTemplate(FOLDER_TEMPLATE)).toHaveLength(133);
    expect(TEMPLATE_VERSION).toBe(1);
  });
});

describe("flattenTemplate — orderable rows for seeding (B650)", () => {
  it("assigns a parentPath, 1-based sibling order, and depth-ascending order", () => {
    const rows = flattenTemplate(FOLDER_TEMPLATE);
    const hillwood = rows.find((r) => r.path === "01. Hillwood");
    expect(hillwood.parentPath).toBe(null);
    expect(hillwood.order).toBe(1);
    expect(hillwood.depth).toBe(0);

    const civilCurrent = rows.find(
      (r) => r.path === "02. Design/01. Drawings/05. Civil/01. Current",
    );
    expect(civilCurrent).toBeTruthy();
    expect(civilCurrent.parentPath).toBe("02. Design/01. Drawings/05. Civil");
    expect(civilCurrent.order).toBe(1);
    expect(civilCurrent.depth).toBe(3);
  });

  it("lists every parent before its children (safe insert / create order)", () => {
    const rows = flattenTemplate(FOLDER_TEMPLATE);
    const seen = new Set();
    for (const r of rows) {
      if (r.parentPath) expect(seen.has(r.parentPath)).toBe(true);
      seen.add(r.path);
    }
  });
});

describe("buildSeedRows — insert rows for a new project (B650)", () => {
  it("mints one row per template folder with resolved parent_id + snake_case columns", () => {
    let n = 0;
    const rows = buildSeedRows(FOLDER_TEMPLATE, { projectId: "grp1", templateVersion: 1, makeId: () => `id${++n}` });
    expect(rows).toHaveLength(133);

    // Top-level categories have a null parent and carry the project id + version.
    const hillwood = rows.find((r) => r.name === "01. Hillwood");
    expect(hillwood.parent_id).toBe(null);
    expect(hillwood.project_id).toBe("grp1");
    expect(hillwood.template_version).toBe(1);
    expect(hillwood.sort_order).toBe(1);

    // A deep child resolves to its parent's minted id (not a path).
    const byId = new Map(rows.map((r) => [r.id, r]));
    const civilCurrent = rows.find((r) => r.name === "01. Current" && byId.get(r.parent_id) && byId.get(r.parent_id).name === "05. Civil");
    expect(civilCurrent).toBeTruthy();
    expect(byId.get(civilCurrent.parent_id).name).toBe("05. Civil");
  });

  it("requires an id generator (no accidental undefined ids)", () => {
    expect(() => buildSeedRows(FOLDER_TEMPLATE, { projectId: "x" })).toThrow(/makeId/);
  });
});
