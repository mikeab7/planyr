import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/* Shell.jsx — ORG SCOPE (NEW-1, B1912209), source-guarded (Shell.jsx mounts every lazy
 * workspace chunk + Supabase auth on render, so a full mount here isn't practical — the same
 * shape test/docReviewOpenProjectGuard.test.js already uses for DocReview.jsx). The actual
 * decision logic (ORG_CAPABLE_MODULES membership, reviewOpenTarget's org-vs-project
 * resolution) is pure and fully behavior-tested in test/route.test.js; this file only proves
 * Shell.jsx actually WIRES to that single source of truth rather than a re-implementation that
 * could silently drift from it. */
const SRC = fs.readFileSync(path.join(process.cwd(), "src/app/Shell.jsx"), "utf8");

describe("Shell.jsx — org-capable modules come from route.js, never a re-implemented local set", () => {
  it("imports ORG_CAPABLE_MODULES and reviewOpenTarget from route.js", () => {
    expect(SRC).toMatch(/import\s*\{[^}]*ORG_CAPABLE_MODULES[^}]*\}\s*from\s*["']\.\/route\.js["']/);
    expect(SRC).toMatch(/import\s*\{[^}]*reviewOpenTarget[^}]*\}\s*from\s*["']\.\/route\.js["']/);
  });

  it("switchModule reads the imported set — no second, locally-defined ORG_CAPABLE_MODULES", () => {
    expect(SRC).toMatch(/org && ORG_CAPABLE_MODULES\.has\(id\)/);
    expect(SRC).not.toMatch(/const ORG_CAPABLE_MODULES = new Set/);
  });

  it("openReviewInDocReview resolves org/projectId via reviewOpenTarget, never re-deriving it inline", () => {
    const start = SRC.indexOf("const openReviewInDocReview = (row, { page } = {}) => {");
    const end = SRC.indexOf("\n  };", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = SRC.slice(start, end);
    expect(body).toMatch(/reviewOpenTarget\(row\)/);
    // RED-PROOF: the pre-fix shape read row.project_id/row.projectId directly and hardcoded
    // org:false on every navigate — reintroducing either is the exact regression this closes.
    expect(body).not.toMatch(/org:\s*false/);
  });
});
