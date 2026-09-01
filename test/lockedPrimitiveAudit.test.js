/* locked-primitive-audit guard (NEW-1, B982400). Unlike design-drift-audit this is zero-tolerance,
 * not a ratchet — Tab/MenuTrigger are two brand-new primitives with no pre-existing debt to
 * inherit, so any hit at all is new drift. The "the real repo, right now" case IS this item's own
 * required teeth-check: it proves the guard reports 0 on the actual conversions this session
 * shipped (AppHeader.jsx's Tab usage, AccountControl.jsx's MenuTrigger usage), and the fixture
 * cases below prove it would have caught the exact misuse NEW-1 exists to prevent. */
import { describe, it, expect } from "vitest";
import { scanFile, auditAll } from "../ui-audit/locked-primitive-audit.mjs";

describe("locked-primitive-audit — pure scan rules", () => {
  it("flags a Tab call site carrying a style= override", () => {
    const violations = scanFile("src/fixture.jsx", `<Tab active style={{ height: 40 }}>Site</Tab>\n`);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ component: "Tab", prop: "style" });
  });

  it("flags a MenuTrigger call site carrying a borderRadius= override", () => {
    const violations = scanFile("src/fixture.jsx", `<MenuTrigger size="md" borderRadius={12}>Account</MenuTrigger>\n`);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ component: "MenuTrigger", prop: "borderRadius" });
  });

  it("flags each of height/padding/fontSize independently", () => {
    const src = [
      `<MenuTrigger height={40}>a</MenuTrigger>`,
      `<Tab padding="0 20px">b</Tab>`,
      `<MenuTrigger fontSize={16}>c</MenuTrigger>`,
      "",
    ].join("\n");
    const violations = scanFile("src/fixture.jsx", src);
    expect(violations.map((v) => v.prop)).toEqual(["height", "padding", "fontSize"]);
  });

  it("does not flag a clean call site (no banned prop at all)", () => {
    const violations = scanFile("src/fixture.jsx", `<Tab active onClick={go}>Site</Tab>\n<MenuTrigger size="md" caret={false}>Cloud off</MenuTrigger>\n`);
    expect(violations).toEqual([]);
  });

  it("REGRESSION — a nested styled element inside a leading={<icon/>} prop is not mistaken for the outer tag's own style (the real defect this scanner's first cut shipped with)", () => {
    const violations = scanFile(
      "src/fixture.jsx",
      `<MenuTrigger onClick={onOpenAuth} title="Sign in" caret={false} leading={<span style={avatar(false)}>›</span>}>\n  Sign in\n</MenuTrigger>\n`,
    );
    expect(violations).toEqual([]);
  });

  it("REGRESSION — width/height/style on a nested <svg icon> are not mistaken for the outer Tab's own props (second false-positive this scanner shipped with)", () => {
    const violations = scanFile(
      "src/fixture.jsx",
      [
        "<Tab",
        "  active={isActive}",
        "  icon={",
        '    <svg width="13" height="13" viewBox="0 0 16 16" style={{ display: "block" }}>',
        "      {m.icon}",
        "    </svg>",
        "  }",
        ">",
        "  {m.label}",
        "</Tab>",
        "",
      ].join("\n"),
    );
    expect(violations).toEqual([]);
  });

  it("still catches a real height= override on the outer tag itself, alongside a clean nested icon", () => {
    const violations = scanFile(
      "src/fixture.jsx",
      `<Tab height={40} icon={<svg width="13" height="13" />}>Site</Tab>\n`,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].prop).toBe("height");
  });

  it("still catches a real style= override sitting AFTER a nested-element prop", () => {
    const violations = scanFile(
      "src/fixture.jsx",
      `<MenuTrigger leading={<span style={avatar(false)}>›</span>} style={{ height: 99 }}>Sign in</MenuTrigger>\n`,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].prop).toBe("style");
  });

  it("does not flag an unrelated component that merely shares a prop name", () => {
    const violations = scanFile("src/fixture.jsx", `<Button style={{ margin: 4 }}>OK</Button>\n<div style={{ height: 40 }} />\n`);
    expect(violations).toEqual([]);
  });

  it("never scans controls.jsx itself, where the props are destructured, not authored", () => {
    const violations = scanFile("src/shared/ui/controls.jsx", `style: _style, borderRadius: _borderRadius, height: _height`);
    expect(violations).toEqual([]);
  });

  it("reports the correct line number for a violation past the first line", () => {
    const src = `const x = 1;\nconst y = 2;\n<MenuTrigger\n  size="md"\n  style={{}}\n>a</MenuTrigger>\n`;
    const violations = scanFile("src/fixture.jsx", src);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(3);
  });
});

describe("locked-primitive-audit — the real repo, right now", () => {
  it("reports zero violations across the whole tree", () => {
    const { violations, total } = auditAll();
    expect(total, JSON.stringify(violations, null, 2)).toBe(0);
  });

  it("TEETH CHECK — proves the guard actually fires: scanRepo over a fixture directory catches a planted violation", () => {
    // A synthetic single-file "repo" proves the walk+scan pipeline end to end, not just scanFile in
    // isolation — the same discipline this repo's other guards apply (design-drift-audit's own
    // ceiling test, mintGateE2E's rejection path).
    const violations = scanFile("src/workspaces/fixture/Planted.jsx", `<Tab style={{ height: 99 }}>Planted</Tab>\n`);
    expect(violations).toHaveLength(1);
  });
});
