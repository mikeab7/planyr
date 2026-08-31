/* modelSaveState — the Model workspace's save-status normalizer. See its own header for the
 * live-production finding this guards against: a signed-in user whose cloud table doesn't
 * exist yet (every Model user, until db/model_sheets.sql is applied) used to see the shared
 * badge's GREEN "Synced" checkmark instead of the honest "saved on this device only" glyph.
 */
import { describe, it, expect } from "vitest";
import { modelSaveState } from "../src/workspaces/model/lib/modelSaveState.js";

describe("modelSaveState", () => {
  it("saving is always 'saving', regardless of sign-in", () => {
    expect(modelSaveState("saving", true)).toBe("saving");
    expect(modelSaveState("saving", false)).toBe("saving");
  });

  it("error and conflict both map to the loud 'error' badge (LOUD-FAILURE)", () => {
    expect(modelSaveState("error", true)).toBe("error");
    expect(modelSaveState("conflict", true)).toBe("error");
  });

  // ⛔ THE REGRESSION THIS FILE EXISTS FOR — measured live, the exact wrong answer the app gave.
  it("'not-provisioned' is ALWAYS 'local', never 'synced' — even for a signed-in user", () => {
    expect(modelSaveState("not-provisioned", true)).toBe("local");
    expect(modelSaveState("not-provisioned", false)).toBe("local");
  });

  it("a real save, signed in, reads 'synced'; signed out, reads 'local'", () => {
    expect(modelSaveState("saved", true)).toBe("synced");
    expect(modelSaveState("saved", false)).toBe("local");
    expect(modelSaveState("idle", true)).toBe("synced");
    expect(modelSaveState("idle", false)).toBe("local");
  });
});
