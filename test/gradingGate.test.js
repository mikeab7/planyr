// The owner-only gate (2026-10-16): the grading layer renders ONLY for a confirmed is_admin(), through ONE
// selector, with no second mechanism — and the code behind it is never statically reachable by other accounts.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gradingEnabled } from "../src/workspaces/site-planner/lib/gradingGate.js";
import { adminStatusStore } from "../src/workspaces/admin/lib/adminStatus.js";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const LIB = "../src/workspaces/site-planner/lib/";
const COMP = "../src/workspaces/site-planner/components/";
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const client = (answer) => ({ rpc: async () => (answer instanceof Error ? { data: null, error: { message: "boom" } } : { data: answer, error: null }) });

describe("gradingEnabled() — fails CLOSED", () => {
  beforeEach(() => adminStatusStore.reset());
  it("is off before any answer, signed out, for a plain user, and on an RPC error", async () => {
    expect(gradingEnabled("u1")).toBe(false);
    expect(gradingEnabled(null)).toBe(false);
    await adminStatusStore.get(client(false), "u1");
    expect(gradingEnabled("u1")).toBe(false);
    adminStatusStore.reset();
    await adminStatusStore.get(client(new Error("x")), "u1");
    expect(gradingEnabled("u1")).toBe(false);
  });
  it("is on ONLY for a confirmed admin, and only for THAT user id", async () => {
    await adminStatusStore.get(client(true), "owner");
    expect(gradingEnabled("owner")).toBe(true);
    expect(gradingEnabled("someone-else")).toBe(false);
  });
  it("an account switch never inherits the previous account's admin answer", async () => {
    await adminStatusStore.get(client(true), "owner");
    await adminStatusStore.get(client(false), "other");
    expect(gradingEnabled("owner")).toBe(false);
  });
});

describe("no second gate mechanism", () => {
  const files = [
    ...readdirSync(fileURLToPath(new URL(LIB, import.meta.url))).filter((f) => /^(grading|buildable|buildingGrade)/.test(f)).map((f) => LIB + f),
    COMP + "GradingController.jsx", COMP + "GradingPanels.jsx",
  ];
  it("found the grading modules", () => { expect(files.length).toBeGreaterThanOrEqual(8); });
  for (const f of files) {
    it(`${f.split("/").pop()} reads no URL flag, env var or localStorage switch`, () => {
      const src = code(read(f));
      expect(src).not.toMatch(/import\.meta\.env/);
      expect(src).not.toMatch(/localStorage|sessionStorage/);
      expect(src).not.toMatch(/URLSearchParams|location\.(search|hash)/);
      expect(src).not.toMatch(/process\.env/);
    });
  }
  it("the gate wraps the existing admin store and nothing else", () => {
    const g = code(read(LIB + "gradingGate.js"));
    expect(g).toMatch(/adminStatusStore\.peek/);
    expect(g).toMatch(/useIsAdmin/);
    expect(g).not.toMatch(/admin_users|INSERT INTO/i);
  });
});

describe("SitePlanner reaches the grading layer only through the gate, and lazily", () => {
  const sp = read("../src/workspaces/site-planner/SitePlanner.jsx");
  it("the heavy grading modules are lazy imports, never static", () => {
    for (const m of ["GradingController", "GradingPanels"]) {
      expect(sp).toMatch(new RegExp(`lazy\\(\\(\\) => import\\("\\./components/${m}\\.jsx"\\)`));
      expect(sp).not.toMatch(new RegExp(`^import .*components/${m}\\.jsx`, "m"));
    }
    for (const m of ["buildingGrade", "buildableGround", "buildableClient", "gradingPaint"]) {
      expect(sp).not.toMatch(new RegExp(`^import .*lib/${m}\\.js`, "m"));
    }
  });
  it("only the gate and the small glue are static", () => {
    expect(sp).toMatch(/import \{ useGradingEnabled \} from "\.\/lib\/gradingGate\.js"/);
    expect(sp).toMatch(/import \{ useGradingBase, hostIdMap \} from "\.\/lib\/gradingBase\.js"/);
  });
  it("every render site is behind grOn (the gate)", () => {
    expect(sp).toMatch(/\{grOn && grInput && \(\s*<Suspense fallback=\{null\}><GradingController/);
    expect(sp).toMatch(/grOn && grModel && \(grModel\.buildable \|\| grModel\.cutfill \|\| grModel\.contours \|\| grLimitEdit\)/);
    expect(sp).toMatch(/gradingRows=\{grOn && grModel \?/);
    // NEW-1 (amends B2315856): grading is its own dock panel, rendered only behind the gate; Site Analysis carries none of it
    expect(sp).toMatch(/_pid === "grading" && gradingOn && \(/);
    expect(sp).toMatch(/<GradingPanel planOn=\{grOn\}[\s\S]{0,260}model=\{grOn \? \(grModel \|\| null\) : null\}/);
    expect(sp).not.toMatch(/groundSlot/);
    expect(sp).not.toMatch(/<GradingGroup|<GroundSection/);
    expect(read("../src/workspaces/site-planner/components/SiteAnalysis.jsx")).not.toMatch(/groundSlot|Grading|GroundSection/);
  });
  it("the dock item is added by the gate's answer alone", () => {
    expect(sp).toMatch(/import \{ withGradingTab, panelIdAllowed \} from "\.\/lib\/gradingDock\.js"/);
    expect(sp).toMatch(/\], gradingOn\); \/\/ owner-only Grading item/);
  });
  it("grading has its own dock panel — no second tab inside Analysis, no Building tab, no chips", () => {
    expect(sp).not.toMatch(/GradingTabs|BuildingGradeTab|grTab|setGrTab/);
    const panels = read("../src/workspaces/site-planner/components/GradingPanels.jsx");
    expect(code(panels)).not.toMatch(/export function (GradingTabs|BuildingTab)|data-ffe-basis|aria-pressed=\{b\.basis/);
  });
  it("the proposed-surface inputs only change under the gate (every other account keeps its exact engine inputs)", () => {
    expect(sp).toMatch(/\.\.\.\(grOn && grBase\.pack \? \{ grading: grBase\.pack \} : \{\}\)/);
    expect(sp).toMatch(/\.\.\.\(grOn && e\.type !== "building" \? \{ hostId:/);
    expect(sp).toMatch(/\.\.\.\(grOn \? \[`gr:\$\{grBase\.sig\}`/);
    // the build condition (moved into the useGradeSurface call, problem report 6cea9895) — and the off-render build is the GATE's
    expect(sp).toMatch(/enabled: \(fmEffectivePadFt != null \|\| grAnyFfe\) && gsEls\.length > 0,\s*offRender: grOn,/);
  });
  it("nobody was added to admin_users by this work", () => {
    for (const dir of [LIB, COMP]) for (const f of readdirSync(fileURLToPath(new URL(dir, import.meta.url)))) {
      if (!/rading|uildable/.test(f)) continue;
      expect(code(read(dir + f))).not.toMatch(/admin_users/);
    }
  });
});
