/* Design-drift ceiling guard (NEW-2, docs/DESIGN.md). Mirrors test/verificationQueueAudit.test.js's
 * pattern: pure-logic unit cases against small fixtures (so the scan/exemption rules are pinned
 * regardless of how the real tree happens to read today), plus a live check that the real repo
 * currently passes its own recorded ceiling. A failure here means NEW drift was introduced, not
 * that this test is stale — regenerate the ceiling with
 * `node ui-audit/design-drift-audit.mjs --write-ceiling` only after a session genuinely LOWERS a
 * count. */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import {
  scanFile, scanRepo, auditAll, checkCeiling,
  TOKEN_LAYER_FILES, DRAWING_SURFACE_FILES,
} from "../ui-audit/design-drift-audit.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("design-drift-audit — pure scan rules", () => {
  it("flags a raw hex literal and a raw rgba() literal", () => {
    const { violations } = scanFile("src/fixture.jsx", `const s = { background: "#ff00aa", border: "rgba(10, 20, 30, .5)" };\n`);
    expect(violations.map((v) => v.kind)).toEqual(["hex", "hex"]);
  });

  it("flags an off-scale borderRadius but not one that matches a RADIUS value", () => {
    const { violations } = scanFile("src/fixture.jsx", `const a = { borderRadius: 7 };\nconst b = { borderRadius: 8 };\n`);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(1);
    expect(violations[0].kind).toBe("radius");
  });

  it("flags a CSS-string border-radius (e.g. inside a template literal) the same way", () => {
    const { violations } = scanFile("src/fixture.jsx", "const svg = `<rect style=\"border-radius:9px\"/>`;\n");
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("radius");
  });

  it("flags an off-scale fontSize but not one that matches a FONT_SIZE value", () => {
    const { violations } = scanFile("src/fixture.jsx", `const a = { fontSize: 13.5 };\nconst b = { fontSize: 12 };\n`);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("fontSize");
  });

  it("never flags a var(--token) reference or a dynamic template expression", () => {
    const { violations } = scanFile("src/fixture.jsx", [
      `const a = { background: "var(--accent)", borderRadius: RADIUS.md };`,
      "const b = `${TB_R}px 0 0 ${TB_R}px`;",
      "",
    ].join("\n"));
    expect(violations).toEqual([]);
  });

  it("honors an inline // design-exempt: comment as an exemption, not a violation", () => {
    const { violations, exemptions } = scanFile("src/fixture.jsx", `const a = { background: "#ff00aa" }; // design-exempt: locked brand swatch\n`);
    expect(violations).toEqual([]);
    expect(exemptions).toHaveLength(1);
    expect(exemptions[0].reason).toBe("locked brand swatch");
  });

  it("does not flag an SVG geometry radius attribute (rx/ry) — that is drawn content, not chrome", () => {
    const { violations } = scanFile("src/fixture.jsx", `const svg = <rect rx={4} ry={4} />;\n`);
    expect(violations).toEqual([]);
  });
});

describe("design-drift-audit — file-level exemptions", () => {
  it("every declared token-layer and drawing-surface file actually exists in the repo", () => {
    for (const rel of [...TOKEN_LAYER_FILES, ...DRAWING_SURFACE_FILES]) {
      expect(existsSync(join(REPO, rel)), `${rel} is declared exempt but does not exist`).toBe(true);
    }
  });

  it("scanRepo never scans a declared token-layer or drawing-surface file", () => {
    const { exemptFiles } = scanRepo();
    for (const rel of [...TOKEN_LAYER_FILES, ...DRAWING_SURFACE_FILES]) {
      expect(exemptFiles).toContain(rel);
    }
  });
});

describe("design-drift-audit — ceiling ratchet", () => {
  it("fails when a count exceeds the ceiling, and names the offenders", () => {
    const ceiling = { hexCeiling: 0, radiusCeiling: 5, fontSizeCeiling: 5 };
    const report = { counts: { hex: 1, radius: 0, fontSize: 0 }, violations: [{ file: "a.jsx", line: 1, kind: "hex" }] };
    const { ok, problems } = checkCeiling(report, ceiling);
    expect(ok).toBe(false);
    expect(problems[0]).toMatch(/hex drift grew: 1 > ceiling 0/);
    expect(problems[0]).toMatch(/a\.jsx:1/);
  });

  it("passes when every count is at or under the ceiling", () => {
    const ceiling = { hexCeiling: 3, radiusCeiling: 3, fontSizeCeiling: 3 };
    const report = { counts: { hex: 3, radius: 0, fontSize: 3 }, violations: [] };
    expect(checkCeiling(report, ceiling).ok).toBe(true);
  });

  it("fails loudly when no ceiling file exists yet", () => {
    const { ok, problems } = checkCeiling({ counts: { hex: 0, radius: 0, fontSize: 0 } }, null);
    expect(ok).toBe(false);
    expect(problems[0]).toMatch(/--write-ceiling/);
  });
});

describe("design-drift-audit — the real repo, right now", () => {
  it("does not exceed its own recorded ceiling", () => {
    const ceilingPath = join(REPO, "ui-audit", "design-drift-ceiling.json");
    expect(existsSync(ceilingPath), "no ui-audit/design-drift-ceiling.json — run --write-ceiling once").toBe(true);
    const ceiling = JSON.parse(readFileSync(ceilingPath, "utf8"));
    const report = auditAll();
    const { ok, problems } = checkCeiling(report, ceiling);
    expect(ok, problems.join("\n")).toBe(true);
  });
});
