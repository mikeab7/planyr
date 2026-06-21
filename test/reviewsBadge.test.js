/* B356 — the Document Review save chip must be TRUTHFUL. The old badge cried wolf:
 * it showed "Not saved" on an empty review with nothing to save, so the eye learned to
 * ignore the one state that matters. This locks the contract for `chipFor`:
 *   - idle (nothing to save) → no chip at all (null), regardless of signed-in/status;
 *   - a real save state is never silent and never a false alarm;
 *   - a signed-in user's work reads as cloud-saved; signed-out is honestly "on this device";
 *   - a failed/conflicting write is LOUD (its own distinct state). */
import { describe, it, expect } from "vitest";
import { chipFor } from "../src/workspaces/doc-review/components/ReviewsBar.jsx";

describe("save chip is truthful (no cry-wolf) — chipFor", () => {
  it("shows NOTHING when there's nothing to save (idle), whatever the status", () => {
    expect(chipFor("local", false, true)).toBeNull();
    expect(chipFor("local", true, true)).toBeNull();
    expect(chipFor("saved", true, true)).toBeNull();
    // the exact bug: signed-out + empty must NOT render a "Not saved"-style chip
    expect(chipFor("local", false, true)).toBeNull();
  });

  it("never says the dishonest 'Not saved' in any non-idle state", () => {
    for (const status of ["local", "saving", "saved", "unsaved", "conflict"]) {
      for (const signedIn of [true, false]) {
        const chip = chipFor(status, signedIn, false);
        if (chip) expect(chip.text.toLowerCase()).not.toBe("not saved");
      }
    }
  });

  it("signed-in work reads as cloud-saved (calm), like the Site Planner's Synced", () => {
    const chip = chipFor("local", true, false); // opened review, signed in, no fresh edit
    expect(chip).not.toBeNull();
    expect(chip.variant).toBe("cloud-check");
    expect(chip.text).toBe("Saved");
  });

  it("signed-out with content is honestly 'On this device', not a false alarm", () => {
    const chip = chipFor("local", false, false);
    expect(chip.variant).toBe("device");
    expect(chip.text).toBe("On this device");
  });

  it("a save in flight is shown as Saving…", () => {
    const chip = chipFor("saving", true, false);
    expect(chip.text).toBe("Saving…");
    expect(chip.pulse).toBe(true);
  });

  it("a failed/conflicting write is LOUD and distinct — never silent", () => {
    const unsaved = chipFor("unsaved", true, false);
    expect(unsaved.variant).toBe("cloud-up");
    expect(unsaved.text).toBe("Unsaved");
    const conflict = chipFor("conflict", true, false);
    expect(conflict.variant).toBe("cloud-x");
    expect(conflict.text).toBe("Sync conflict");
    // conflict is its own state, not folded into "saved"
    expect(conflict.text).not.toBe("Saved");
  });

  it("an explicit successful save reads Saved even before sign-in resolves", () => {
    const chip = chipFor("saved", false, false);
    expect(chip.variant).toBe("cloud-check");
    expect(chip.text).toBe("Saved");
  });
});
