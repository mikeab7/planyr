/* B1574432 — the reveal ceiling's deadline must SURVIVE A REMOUNT.
 *
 * This is incident requirement #2 from docs/incidents/B1594320-CANVAS-VISIBILITY-OUTAGE.md, and the
 * one that #1686's branch is explicitly recorded as NOT meeting. B1574432's watchdog was a
 * `setTimeout` scoped to one mount's lifetime, so "1.5 seconds" really meant "1.5 seconds since the
 * most recent remount" — and a signed-in boot remounts the planner by construction, twice if the
 * supabase auth-event race fires. A repeating remount could therefore postpone the reveal
 * indefinitely, which is a permanently blank canvas.
 *
 * The browser proof is `ui-audit/verify-boot-framing-auth.mjs`'s ceiling arm (which drives real
 * remounts and was proven RED against a deliberately per-mount build). This pins the pure mechanism
 * it rests on, where a mutation is cheap and the clock is injectable.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BOOT_FRAMING_CEILING_MS,
  bootFramingDeadlineAt,
  bootFramingRemainingMs,
  resetBootFramingDeadlines,
} from "../src/workspaces/site-planner/lib/bootFramingDeadline.js";

beforeEach(() => resetBootFramingDeadlines());

describe("bootFramingDeadlineAt", () => {
  it("stamps on the first ask and returns that same deadline for every later ask", () => {
    const first = bootFramingDeadlineAt("plan-a", 1000);
    expect(first).toBe(1000 + BOOT_FRAMING_CEILING_MS);
    // A remount asks again, later. The answer must not move.
    expect(bootFramingDeadlineAt("plan-a", 1400)).toBe(first);
    expect(bootFramingDeadlineAt("plan-a", 2000)).toBe(first);
  });

  /* ⛔ THE ASSERTION THE WHOLE ITEM RESTS ON, stated as the failure it prevents. With a per-mount
   * deadline each of these asks would return `now + CEILING`, so remounts arriving faster than the
   * ceiling push it out forever — the reveal never happens and the canvas stays blank. */
  it("cannot be postponed by remounts arriving faster than the ceiling", () => {
    const deadline = bootFramingDeadlineAt("plan-a", 0);
    let now = 0;
    for (let i = 0; i < 50; i++) {
      now += Math.floor(BOOT_FRAMING_CEILING_MS / 3);   // a remount every third of a ceiling
      expect(bootFramingDeadlineAt("plan-a", now)).toBe(deadline);
    }
    expect(now).toBeGreaterThan(BOOT_FRAMING_CEILING_MS * 10);
    expect(bootFramingRemainingMs("plan-a", now)).toBe(0);  // long past due — fires immediately
  });

  it("gives a remount the time REMAINING, never a fresh full window", () => {
    bootFramingDeadlineAt("plan-a", 0);
    expect(bootFramingRemainingMs("plan-a", 0)).toBe(BOOT_FRAMING_CEILING_MS);
    expect(bootFramingRemainingMs("plan-a", 1000)).toBe(BOOT_FRAMING_CEILING_MS - 1000);
    // Past the deadline the remaining time floors at 0 rather than going negative, so a mount that
    // arrives late arms a zero-length timer and reveals at once instead of never.
    expect(bootFramingRemainingMs("plan-a", BOOT_FRAMING_CEILING_MS + 5000)).toBe(0);
  });

  /* Per-PLAN, deliberately: opening a DIFFERENT project is a new thing being loaded and deserves
   * its own window. Coming BACK to one does not — which is what stops alternating between two plans
   * postponing either one's reveal. */
  it("keeps a separate deadline per plan, and coming back to a plan does not reset its own", () => {
    const a = bootFramingDeadlineAt("plan-a", 0);
    const b = bootFramingDeadlineAt("plan-b", 700);
    expect(b).toBe(700 + BOOT_FRAMING_CEILING_MS);
    expect(b).not.toBe(a);
    // Alternate A → B → A → B, faster than the ceiling. Neither deadline may move.
    expect(bootFramingDeadlineAt("plan-a", 1400)).toBe(a);
    expect(bootFramingDeadlineAt("plan-b", 2100)).toBe(b);
    expect(bootFramingDeadlineAt("plan-a", 2800)).toBe(a);
    expect(bootFramingDeadlineAt("plan-b", 3500)).toBe(b);
  });

  it("treats a null/absent plan id as one shared slot rather than throwing or minting per call", () => {
    const d = bootFramingDeadlineAt(null, 0);
    expect(bootFramingDeadlineAt(undefined, 900)).toBe(d);
    expect(bootFramingDeadlineAt("", 1800)).toBe(d);
    // …and it must not collide with a real plan's slot.
    expect(bootFramingDeadlineAt("plan-a", 2700)).not.toBe(d);
  });

  /* The ceiling is a rescue deadline, not a delay budget: it has to be comfortably shorter than the
   * framing RETRY bound (BOOT_FRAMING_RETRY_MS, 10 s) or a pathological boot sits on a blank canvas
   * for the whole retry window — which is the failure this family exists to prevent. */
  it("is a sane rescue deadline: positive, and far shorter than the framing retry bound", () => {
    expect(BOOT_FRAMING_CEILING_MS).toBeGreaterThan(0);
    expect(BOOT_FRAMING_CEILING_MS).toBeLessThan(10000 / 2);
  });
});

/* ⛔ THE MECHANISM MUST OUTLIVE THE COMPONENT, AND MUST NOT OUTLIVE THE PAGE LOAD. Module scope is
 * both, which is why it was chosen over the `sessionStorage` option the incident doc also offers:
 * sessionStorage survives a RELOAD, so a genuine second cold load in the same tab would read a stamp
 * minutes old, compute an already-expired deadline, reveal instantly, and the gate would silently
 * stop working after the first load of a tab's life — with the flash back and nothing saying so. */
describe("the store's lifetime", () => {
  it("is not readable from, or writable to, any persistent browser storage", () => {
    /* Comments stripped first — the module's own header NAMES `sessionStorage` to explain why it is
       not used, and a guard that trips on its own rationale is a guard nobody can keep. */
    expect(codeOnly(readSource())).not.toMatch(/sessionStorage|localStorage|indexedDB/);
  });
  it("keys the stamps in module scope, so every remount of every component shares one answer", () => {
    const src = readSource();
    expect(src).toMatch(/^const stamps = new Map\(\);$/m);
  });
});

/** Source with block and line comments removed, so a source guard asserts about CODE. */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function readSource() {
  return readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/lib/bootFramingDeadline.js", import.meta.url)), "utf8");
}
