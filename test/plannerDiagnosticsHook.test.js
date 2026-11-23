// AUDIT BATCH G4 — the planner's window.__planner* diagnostic hooks live in ONE hook, and version history is its own hook.
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { plannerSource, plannerParts } from "./helpers/plannerSource.js";
import { useVersionHistory } from "../src/workspaces/site-planner/lib/useVersionHistory.js";

const part = (file) => plannerParts().find((x) => x.file === file).text;
const diag = part("lib/usePlannerDiagnostics.js");
const main = part("SitePlanner.jsx");

describe("usePlannerDiagnostics", () => {
  const HOOKS = ["__plannerViewChanges", "__plannerView", "__plannerLayers", "__plannerHitTarget", "__plannerHitWhy", "__plannerForeign", "__plannerGradeReadout", "__plannerGradeDrive", "__plannerPerf", "__plannerFit", "__plannerIdentifyResult", "__plannerParcelOutlines", "__plannerRoadNet", "__plannerExportSvg", "__plannerExportComposed", "__plannerExportF2p"];
  it("installs every diagnostic hook, each with its cleanup", () => {
    for (const h of HOOKS) {
      expect(diag).toContain(`window.${h} = `);
      expect(diag).toMatch(new RegExp(`window\\.${h} === \\w+\\) window\\.${h} = null`));
    }
  });
  it("is called exactly once from the component, and the component no longer assigns any of them", () => {
    expect(main.match(/usePlannerDiagnostics\(\{/g)).toHaveLength(1);
    expect(main).not.toMatch(/window\.__planner\w+ = /);
  });
  it("is read-only and gated at CALL time (no top-level write, every install behind a gate)", () => {
    expect(diag).toMatch(/__PLANYR_E2E|isDiagArmed|latchDiagArm/);
    expect(diag).not.toMatch(/localStorage\.setItem|setEls\(|saveSite\(/);
  });
  it("source guards that read the planner still see the hooks (plannerSource includes the hook file)", () => {
    expect(plannerSource()).toContain("window.__plannerExportComposed = composedHook");
  });
});

describe("useVersionHistory", () => {
  function probe() {
    let out;
    function C() { out = useVersionHistory({ closeHdrMenus() {}, flashWarn() {}, flushSite() {}, nameResolverRef: { current: null }, pushHistory() {}, readOnly: false, replacePlanContents() {}, setMulti() {}, setSel() {}, siteId: null }); return null; }
    renderToStaticMarkup(createElement(C));
    return out;
  }
  it("starts closed on the versions tab with nothing loaded", () => {
    const h = probe();
    expect(h.versionsOpen).toBe(false);
    expect(h.versionList).toEqual([]);
    expect(h.activityTab).toBe("versions");
    expect(h.activityRows).toBeNull();
    expect(h.activityLoading).toBe(false);
    expect(h.activityErr).toBe("");
  });
  it("hands the dialog its handlers", () => {
    const h = probe();
    for (const k of ["openVersionHistory", "openActivityTab", "restoreVersion", "setVersionsOpen", "setActivityTab"]) expect(typeof h[k]).toBe("function");
  });
  it("is wired from the component and no longer defined there", () => {
    expect(main).toMatch(/= useVersionHistory\(\{/);
    expect(main).not.toMatch(/const restoreVersion = async/);
    expect(main).not.toMatch(/const \[versionList, setVersionList\]/);
  });
});
