import { describe, it, expect } from "vitest";
import { FOLDER_TEMPLATE, TEMPLATE_VERSION } from "../src/shared/folders/folderTemplate.js";
import { flattenTemplate, countTemplate, buildSeedRows } from "../src/shared/folders/folderTree.js";

const byName = (nodes, name) => (nodes || []).find((n) => n.name === name);

describe("FOLDER_TEMPLATE — canonical default structure v3 (B1262592)", () => {
  it("has exactly the 6 numbered top-level categories in order", () => {
    expect(FOLDER_TEMPLATE.map((n) => n.name)).toEqual([
      "01. Organization",
      "02. Land",
      "03. Entitlements & Approvals",
      "04. Design",
      "05. Construction",
      "06. Close-Out",
    ]);
  });

  it("never names a company anywhere in the tree", () => {
    for (const r of flattenTemplate(FOLDER_TEMPLATE)) {
      expect(r.name.toLowerCase()).not.toMatch(/hillwood/);
    }
  });

  it("has no Sustainability category anywhere (deliberately removed in v3)", () => {
    for (const r of flattenTemplate(FOLDER_TEMPLATE)) {
      expect(r.name.toLowerCase()).not.toMatch(/sustainability/);
    }
  });

  it("01. Organization absorbs Deal, Entity & Legal, Financing, and Marketing & Leasing as its own children", () => {
    const org = byName(FOLDER_TEMPLATE, "01. Organization");
    expect(org.children.map((c) => c.name)).toEqual([
      "01. Deal", "02. Entity & Legal", "03. Financing", "04. Marketing & Leasing",
    ]);
    expect(byName(org.children, "01. Deal").children).toHaveLength(9);
    expect(byName(org.children, "02. Entity & Legal").children.map((c) => c.name)).toEqual([
      "01. Entity Docs - SPE", "02. Joint Venture", "03. Ground Lease",
      "04. CCRs - Park Association", "05. Legal", "06. Insurance",
    ]);
    expect(byName(org.children, "03. Financing").children).toHaveLength(7);
    expect(byName(org.children, "04. Marketing & Leasing").children.map((c) => c.name)).toEqual([
      "01. Marketing", "02. Media", "03. Photos", "04. Tenant Pursuits",
      "05. Leases & LOIs", "06. Broker Agreements & Commissions", "07. Estoppels & SNDAs",
    ]);
  });

  it("Tenant Pursuits and Leases & LOIs are separate folders (a disclosure boundary, not a tidiness split)", () => {
    const leasing = byName(byName(FOLDER_TEMPLATE, "01. Organization").children, "04. Marketing & Leasing");
    expect(byName(leasing.children, "04. Tenant Pursuits")).toBeTruthy();
    expect(byName(leasing.children, "05. Leases & LOIs")).toBeTruthy();
  });

  it("has no Tenant Improvements folder under Marketing & Leasing (TI belongs under Construction)", () => {
    const leasing = byName(byName(FOLDER_TEMPLATE, "01. Organization").children, "04. Marketing & Leasing");
    expect(leasing.children.some((c) => /tenant improvement/i.test(c.name))).toBe(false);
  });

  it("there is no standalone Financing folder at top level", () => {
    expect(byName(FOLDER_TEMPLATE, "Financing") || FOLDER_TEMPLATE.find((n) => /financing/i.test(n.name))).toBeFalsy();
  });

  it("04. Design → 01. Drawings holds 7 disciplines, each with Current + Archive", () => {
    const design = byName(FOLDER_TEMPLATE, "04. Design");
    const drawings = byName(design.children, "01. Drawings");
    expect(drawings.children).toHaveLength(7);
    expect(drawings.children.map((d) => d.name)).toEqual([
      "01. Exhibits", "02. Site Plans", "03. Architectural", "04. Structural",
      "05. Civil", "06. Landscape", "07. MEP",
    ]);
    for (const disc of drawings.children) {
      expect(disc.children.map((c) => c.name)).toEqual(["01. Current", "02. Archive"]);
    }
  });

  it("02. Specifications is a SIBLING of Drawings, not nested inside it", () => {
    const design = byName(FOLDER_TEMPLATE, "04. Design");
    expect(byName(design.children, "02. Specifications")).toBeTruthy();
    const drawings = byName(design.children, "01. Drawings");
    expect(byName(drawings.children, "02. Specifications")).toBeFalsy();
    expect(design.children.map((c) => c.name)).toEqual([
      "01. Drawings", "02. Specifications", "03. Reports & Studies",
      "04. Consultant Contracts", "05. Correspondence", "06. Invoices",
    ]);
  });

  it("Financing appears exactly once (01. Organization/03. Financing) — no duplicate category across the tree", () => {
    const rows = flattenTemplate(FOLDER_TEMPLATE);
    const financing = rows.filter((r) => /financing/i.test(r.name) && !/alternative/i.test(r.name));
    expect(financing).toHaveLength(1);
    expect(financing[0].path).toBe("01. Organization/03. Financing");
  });

  it("bare 'Permits' (the entitlement application folder) appears exactly once, not duplicated the way v1 did", () => {
    // v1 had a literal duplicate: "Permits" under both Governmental (04.02) and Close-Out
    // (11.02). Close-Out's folder is a DIFFERENT, more specific thing — permit/inspection
    // ACCEPTANCE LETTERS filed at project close, not a second copy of the application folder —
    // so it's deliberately not named identically.
    const rows = flattenTemplate(FOLDER_TEMPLATE);
    const barePermits = rows.filter((r) => /^\d{2}\.\s*permits\s*$/i.test(r.name));
    expect(barePermits).toHaveLength(1);
    expect(barePermits[0].path).toBe("03. Entitlements & Approvals/03. Permits");
    expect(byName(byName(FOLDER_TEMPLATE, "06. Close-Out").children, "02. Permits & Acceptance Letters")).toBeTruthy();
  });

  it("every folder name uses the zero-padded 'NN. ' prefix at every level", () => {
    for (const r of flattenTemplate(FOLDER_TEMPLATE)) {
      expect(r.name).toMatch(/^\d{2}\.\s/);
    }
  });

  it("totals 118 folders (6 top-level + 112 subfolders), max depth 4, and exposes version 3", () => {
    expect(countTemplate(FOLDER_TEMPLATE)).toBe(118);
    const rows = flattenTemplate(FOLDER_TEMPLATE);
    expect(rows).toHaveLength(118);
    expect(Math.max(...rows.map((r) => r.depth))).toBe(3); // depth 0..3 = 4 levels deep
    expect(TEMPLATE_VERSION).toBe(3);
  });
});

describe("flattenTemplate — orderable rows for seeding (B650)", () => {
  it("assigns a parentPath, 1-based sibling order, and depth-ascending order", () => {
    const rows = flattenTemplate(FOLDER_TEMPLATE);
    const org = rows.find((r) => r.path === "01. Organization");
    expect(org.parentPath).toBe(null);
    expect(org.order).toBe(1);
    expect(org.depth).toBe(0);

    const deal = rows.find((r) => r.path === "01. Organization/01. Deal");
    expect(deal.parentPath).toBe("01. Organization");
    expect(deal.order).toBe(1);
    expect(deal.depth).toBe(1);

    const civilCurrent = rows.find(
      (r) => r.path === "04. Design/01. Drawings/05. Civil/01. Current",
    );
    expect(civilCurrent).toBeTruthy();
    expect(civilCurrent.parentPath).toBe("04. Design/01. Drawings/05. Civil");
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
    const rows = buildSeedRows(FOLDER_TEMPLATE, { projectId: "grp1", templateVersion: 3, makeId: () => `id${++n}` });
    expect(rows).toHaveLength(118);

    // Top-level categories have a null parent and carry the project id + version.
    const org = rows.find((r) => r.name === "01. Organization");
    expect(org.parent_id).toBe(null);
    expect(org.project_id).toBe("grp1");
    expect(org.template_version).toBe(3);
    expect(org.sort_order).toBe(1);

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
