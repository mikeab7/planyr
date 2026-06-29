/* B562 — the Schedule workspace replaces its floppy-disk "Save" button with the shared,
 * app-wide cloud sync badge (same component + Row-1 top-right slot as the Site Planner).
 * scheduleSaveState() maps the embedded Gantt app's reported toolbar.saveStatus onto the
 * badge's normalized vocabulary. The crash-severity invariant we lock here: a failed cloud
 * write reads as a LOUD error and NEVER falls through to a false-green "synced" — and an
 * un-reported (not-ready) toolbar shows NOTHING rather than a fake "all good".
 */
import { describe, it, expect } from "vitest";
import { scheduleSaveState } from "../src/workspaces/scheduler/lib/saveState.js";
import { cloudBadgeView } from "../src/shared/ui/CloudSyncBadge.jsx";

describe("scheduleSaveState — embedded scheduler status → shared badge state", () => {
  it("shows NOTHING until the iframe has reported its toolbar (no context, not an error)", () => {
    expect(scheduleSaveState(null)).toBeNull();
    expect(scheduleSaveState(undefined)).toBeNull();
    expect(scheduleSaveState({ ready: false })).toBeNull();
    expect(scheduleSaveState({ ready: false, saveStatus: "saved" })).toBeNull();
  });

  it("a write in flight is 'saving' (transient, pulsing)", () => {
    expect(scheduleSaveState({ ready: true, saveStatus: "saving" })).toBe("saving");
    expect(cloudBadgeView(scheduleSaveState({ ready: true, saveStatus: "saving" })).pulse).toBe(true);
  });

  it("a failed cloud write is LOUD 'error' — never a false-green", () => {
    const state = scheduleSaveState({ ready: true, saveStatus: "error" });
    expect(state).toBe("error");
    const v = cloudBadgeView(state);
    expect(v.loud).toBe(true);
    expect(v.actionable).toBe(true);          // → popover with "Retry now"
    expect(v.color).toBe("var(--danger)");    // red reserved for genuine failure (B433)
    // The core guardrail: error must NOT look like the resting saved state on any axis.
    const ok = cloudBadgeView(scheduleSaveState({ ready: true, saveStatus: "saved" }));
    expect(v.variant).not.toBe(ok.variant);
    expect(v.color).not.toBe(ok.color);
    expect(v.loud).not.toBe(ok.loud);
  });

  it("the resting saved state is a calm 'synced' cloud-check", () => {
    const state = scheduleSaveState({ ready: true, saveStatus: "saved" });
    expect(state).toBe("synced");
    const v = cloudBadgeView(state);
    expect(v.variant).toBe("cloud-check");
    expect(v.loud).toBe(false);
  });

  it("offline fallback (failed cloud READ) is honest amber 'offline', NEVER a false-green synced", () => {
    // The embedded app reads saveStatus="saved" on first load even when the cloud read failed
    // (no write attempted yet) — the bug would be mapping that to green 'synced' while the app
    // is on its offline copy. It must map to the amber, non-green 'offline' state instead.
    const state = scheduleSaveState({ ready: true, saveStatus: "saved", offlineFallback: true });
    expect(state).toBe("offline");
    const v = cloudBadgeView(state);
    expect(v.variant).toBe("cloud-pause");
    expect(v.color).toBe("var(--warn-text)"); // amber attention color, never the green save-badge
    expect(v.loud).toBe(false);
    // The core guardrail: cloud-unreachable must NOT look like the resting synced state.
    const ok = cloudBadgeView("synced");
    expect(v.variant).not.toBe(ok.variant);
    expect(v.color).not.toBe(ok.color);
  });

  it("an active write still wins over the offline flag (saving/error are more specific)", () => {
    // A write in flight or a failed write describes the live state more precisely than the
    // stale read-failed flag, so they take precedence.
    expect(scheduleSaveState({ ready: true, saveStatus: "saving", offlineFallback: true })).toBe("saving");
    expect(scheduleSaveState({ ready: true, saveStatus: "error", offlineFallback: true })).toBe("error");
  });

  it("an unexpected/missing status (ready but unknown) shows NOTHING, never a fabricated green", () => {
    expect(scheduleSaveState({ ready: true })).toBeNull();
    expect(scheduleSaveState({ ready: true, saveStatus: "weird-unrecognized" })).toBeNull();
    // and null chains through to "render nothing", not to a silent success
    expect(cloudBadgeView(scheduleSaveState({ ready: true, saveStatus: "weird-unrecognized" }))).toBeNull();
  });
});
