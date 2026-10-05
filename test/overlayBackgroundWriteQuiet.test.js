import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { classifyOverlayWriteFailure } from "../src/shared/sitePlans/lib/overlayErrors.js";

const fk = Object.assign(new Error('insert or update on table "site_plan_overlays" violates foreign key constraint "site_plan_overlays_project_id_fkey"'), { code: "23503" });

describe("classifyOverlayWriteFailure", () => {
  it("a background (auto-attach on open) FK failure shows NO banner, only telemetry", () => {
    const v = classifyOverlayWriteFailure({ error: fk, background: true });
    expect(v.banner).toBeNull();
    expect(v.telemetry.event).toBe("overlay-background-write-failed");
  });
  it("a background conflict is quiet too", () => {
    const v = classifyOverlayWriteFailure({ conflict: true, background: true });
    expect(v.banner).toBeNull();
    expect(v.telemetry).toBeTruthy();
  });
  it("a user-initiated failure stays LOUD", () => {
    const v = classifyOverlayWriteFailure({ error: fk, background: false });
    expect(v.banner).toMatch(/Couldn't save/);
    expect(v.telemetry).toBeNull();
    expect(classifyOverlayWriteFailure({ conflict: true }).banner).toMatch(/Someone else/);
  });
  it("success yields nothing", () => {
    expect(classifyOverlayWriteFailure({ background: true })).toEqual({ banner: null, telemetry: null });
  });
});

describe("SitePlansSection wiring", () => {
  const src = fs.readFileSync("src/shared/sitePlans/components/SitePlansSection.jsx", "utf8");
  it("the reload sweep's auto-attach is marked background", () => {
    expect(src).toMatch(/patchAndReload\(o, \{ projectId: groupId \}, \{ background: true \}\)/);
  });
  it("patchAndReload routes failures through the classifier, not a direct banner", () => {
    expect(src).toMatch(/classifyOverlayWriteFailure\(\{ error, conflict, background \}\)/);
    expect(src).not.toMatch(/console\.error\("\[sitePlanOverlays\] update failed:", error\); setPanelError/);
  });
});
