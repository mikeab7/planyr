/* NEW-1 — the app-wide cloud-sync badge must be TRUTHFUL and never silent.
 *
 * Two pure functions carry the whole contract, so a future edit can't quietly let a
 * failed save read the same as "all good" (the crash-severity guardrail):
 *   - cloudBadgeView(state)            — normalized state → how the glyph looks
 *   - docSaveState(status, signedIn, idle) — doc-review's raw status → normalized state
 *
 * The invariants we lock:
 *   • a failed/conflicting write is LOUD and VISUALLY DISTINCT from "synced" (the bug this
 *     guards: a failure that looks identical to success, or silently drops to blank);
 *   • the resting "synced" state is calm and never loud;
 *   • "no project loaded" shows nothing (null) — that's legitimately empty, not a hidden error;
 *   • signed-in work reads as synced; signed-out-with-content reads as on-device (never a false alarm).
 */
import { describe, it, expect } from "vitest";
import { cloudBadgeView } from "../src/shared/ui/CloudSyncBadge.jsx";
import { docSaveState } from "../src/workspaces/doc-review/lib/usePersistence.js";

describe("cloudBadgeView — presentation truth-table", () => {
  it("shows NOTHING when there is no project/doc context (null/undefined/unknown)", () => {
    expect(cloudBadgeView(null)).toBeNull();
    expect(cloudBadgeView(undefined)).toBeNull();
    expect(cloudBadgeView("whatever-unrecognized")).toBeNull();
  });

  it("the resting 'synced' state is a calm cloud-check — never loud", () => {
    const v = cloudBadgeView("synced");
    expect(v).not.toBeNull();
    expect(v.variant).toBe("cloud-check");
    expect(v.loud).toBe(false);
    expect(v.actionable).toBe(false);
  });

  it("'saving' is a transient in-flight state — pulsing, not loud", () => {
    const v = cloudBadgeView("saving");
    expect(v.variant).toBe("cloud-up");
    expect(v.pulse).toBe(true);
    expect(v.loud).toBe(false);
  });

  it("'error' is LOUD, distinct, and clickable for detail + retry", () => {
    const v = cloudBadgeView("error");
    expect(v.loud).toBe(true);
    expect(v.actionable).toBe(true);
    expect(v.variant).toBe("cloud-slash");
    expect(v.color).toBe("var(--status-dead)");
  });

  it("a failed save NEVER reads the same as 'all good' (the core guardrail)", () => {
    const ok = cloudBadgeView("synced");
    const bad = cloudBadgeView("error");
    // must differ on every dimension the eye uses: glyph, color, AND loudness
    expect(bad.variant).not.toBe(ok.variant);
    expect(bad.color).not.toBe(ok.color);
    expect(bad.loud).toBe(true);
    expect(ok.loud).toBe(false);
  });

  it("'offline' is a recoverable warning — amber, actionable, but not loud-red", () => {
    const v = cloudBadgeView("offline");
    expect(v.loud).toBe(false);
    expect(v.actionable).toBe(true);
    expect(v.color).toBe("var(--warn-text)");
  });

  it("'local' (signed out) is the quiet on-device glyph", () => {
    const v = cloudBadgeView("local");
    expect(v.variant).toBe("device");
    expect(v.loud).toBe(false);
  });

  it("every state carries a human tip (hover affordance) and a title", () => {
    for (const s of ["synced", "saving", "offline", "error", "local"]) {
      const v = cloudBadgeView(s);
      expect(typeof v.tip).toBe("string");
      expect(v.tip.length).toBeGreaterThan(0);
      expect(typeof v.title).toBe("string");
    }
  });
});

describe("docSaveState — doc-review raw status → normalized state", () => {
  it("idle (nothing loaded) shows nothing, whatever the status/sign-in", () => {
    expect(docSaveState("saved", true, true)).toBeNull();
    expect(docSaveState("local", false, true)).toBeNull();
    expect(docSaveState("saving", true, true)).toBeNull();
  });

  it("a failed write is LOUD: unsaved AND conflict both map to error", () => {
    expect(docSaveState("unsaved", true, false)).toBe("error");
    expect(docSaveState("conflict", true, false)).toBe("error");
    // and 'error' renders loud + distinct (chained through the presentation table)
    expect(cloudBadgeView(docSaveState("unsaved", true, false)).loud).toBe(true);
    expect(cloudBadgeView(docSaveState("conflict", true, false)).loud).toBe(true);
  });

  it("in-flight write is 'saving'", () => {
    expect(docSaveState("saving", true, false)).toBe("saving");
    expect(docSaveState("saving", false, false)).toBe("saving");
  });

  it("signed-in work reads as synced (calm), like the Site Planner", () => {
    expect(docSaveState("saved", true, false)).toBe("synced");
    expect(docSaveState("local", true, false)).toBe("synced"); // opened review, signed in, no fresh edit
  });

  it("signed-out with content is honestly on-device (local), not a false alarm", () => {
    expect(docSaveState("local", false, false)).toBe("local");
    expect(cloudBadgeView(docSaveState("local", false, false)).loud).toBe(false);
  });
});
