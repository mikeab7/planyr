/* modelSaveState — the Model workspace's save-status normalizer. See its own header for the
 * two live-production findings this guards against: (1) a signed-in user whose cloud table
 * doesn't exist yet used to see the shared badge's GREEN "Synced" checkmark instead of the
 * honest "saved on this device only" glyph; (2) even after the table existed and worked, ANY
 * signed-in idle status (including before a single cloud round trip ever happened) claimed
 * "Synced" too — this file's `cloudConfirmed` param is the fix for that second one.
 */
import { describe, it, expect } from "vitest";
import { modelSaveState } from "../src/workspaces/model/lib/modelSaveState.js";

describe("modelSaveState", () => {
  it("saving is always 'saving', regardless of sign-in or cloudConfirmed", () => {
    expect(modelSaveState("saving", true, true)).toBe("saving");
    expect(modelSaveState("saving", false, false)).toBe("saving");
  });

  it("error, conflict AND diverged all map to the loud 'error' badge (LOUD-FAILURE)", () => {
    expect(modelSaveState("error", true, true)).toBe("error");
    expect(modelSaveState("conflict", true, true)).toBe("error");
    expect(modelSaveState("diverged", true, true)).toBe("error");
    // A failure is loud regardless of whether a PRIOR round trip happened.
    expect(modelSaveState("error", true, false)).toBe("error");
  });

  // ⛔ THE FIRST REGRESSION THIS FILE EXISTS FOR — measured live, the exact wrong answer the app gave.
  it("'not-provisioned' is ALWAYS 'local', never 'synced' — even for a signed-in user", () => {
    expect(modelSaveState("not-provisioned", true, false)).toBe("local");
    expect(modelSaveState("not-provisioned", false, false)).toBe("local");
  });

  it("signed out is always 'local', whatever the status or cloudConfirmed", () => {
    expect(modelSaveState("saved", false, true)).toBe("local");
    expect(modelSaveState("idle", false, false)).toBe("local");
  });

  // ⛔ THE SECOND REGRESSION THIS FILE EXISTS FOR (B891184-FOLLOWUP-2) — measured live: the
  // table worked, but the badge said "Synced" from the instant the page painted, before any
  // save had ever reached the cloud. `idle` with no confirmed round trip must say nothing.
  it("signed in but NOTHING confirmed yet (idle, no round trip) says nothing — never 'synced'", () => {
    expect(modelSaveState("idle", true, false)).toBe(null);
  });

  it("a real confirmed round trip (a successful load OR a successful save), signed in, reads 'synced'", () => {
    expect(modelSaveState("saved", true, true)).toBe("synced");
    expect(modelSaveState("idle", true, true)).toBe("synced"); // e.g. right after a successful load
  });
});
