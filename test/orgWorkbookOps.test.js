/* NEW-3 — Organization workbooks: create / rename / delete read the cloud result instead of
 * swallowing it. The three decision paths, against a mocked store result. */
import { describe, it, expect } from "vitest";
import { orgCloudOutcome, ORG_NOT_PROVISIONED_NOTICE } from "../src/workspaces/model/lib/orgWorkbookOps.js";

describe("orgCloudOutcome — the three ops × the store's result shapes", () => {
  it("ok → apply locally, say nothing", () => {
    for (const op of ["create", "rename", "delete"]) {
      expect(orgCloudOutcome(op, { ok: true }, { id: "w1" })).toEqual({ applyLocal: true, notice: null, status: null, telemetry: null });
    }
  });
  it("not-provisioned → apply locally + the existing 'saved on this device only' line, no telemetry", () => {
    for (const op of ["create", "rename", "delete"]) {
      const o = orgCloudOutcome(op, { ok: false, reason: "not-provisioned" }, { id: "w1" });
      expect(o.applyLocal).toBe(true);
      expect(o.notice).toBe(ORG_NOT_PROVISIONED_NOTICE);
      expect(o.status).toBe("not-provisioned");
      expect(o.telemetry).toBeNull();
    }
  });
  it("unavailable (no config / no account) → apply locally, silent — the content push's own treatment", () => {
    expect(orgCloudOutcome("delete", { ok: false, reason: "unavailable" }, { id: "w1" })).toEqual({ applyLocal: true, notice: null, status: null, telemetry: null });
  });
  it("DELETE on a real failure keeps the local row (never drop the index entry before the cloud confirms)", () => {
    const o = orgCloudOutcome("delete", { ok: false, reason: "error", error: "RLS refused" }, { id: "w1" });
    expect(o.applyLocal).toBe(false);
    expect(o.notice).toMatch(/Couldn't delete that workbook in the cloud \(RLS refused\)/);
    expect(o.status).toBe("error");
    expect(o.telemetry).toEqual({ kind: "cloud-write-failed", message: "org workbook delete failed (error)", extra: { id: "w1", op: "delete", reason: "error" } });
  });
  it("RENAME on a real failure keeps the optimistic local name but says it is this-device-only", () => {
    const o = orgCloudOutcome("rename", { ok: false, reason: "error", error: "offline" }, { id: "w2" });
    expect(o.applyLocal).toBe(true);
    expect(o.notice).toMatch(/Couldn't save that rename to the cloud \(offline\)/);
    expect(o.telemetry.message).toBe("org workbook rename failed (error)");
  });
  it("CREATE on a real failure (incl. a CAS conflict) says the workbook is on this device only", () => {
    const o = orgCloudOutcome("create", { ok: false, reason: "conflict" }, { id: "w3" });
    expect(o.applyLocal).toBe(true);
    expect(o.notice).toMatch(/saved on this device only/);
    expect(o.status).toBe("error");
    expect(o.telemetry.message).toBe("org workbook create failed (conflict)");
  });
  it("a missing result reads as ok (an op that was never attempted, e.g. signed out)", () => {
    expect(orgCloudOutcome("delete", undefined, { id: "w1" }).applyLocal).toBe(true);
  });
});
