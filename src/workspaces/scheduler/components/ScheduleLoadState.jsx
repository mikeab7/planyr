/* ScheduleLoadState — what the Schedule tab shows while the schedule LIST has not arrived.
 *
 * NEW-1 (SCHED-EMPTY-ON-SLOW-LOAD, 2026-10-06). The old tab treated "the list has not loaded yet / the
 * load failed" as "this project has zero schedules" and offered Create — on a project that already had
 * three. This is the replacement for those two states; the genuine-zero state (LinkSchedulePanel, with
 * its Create button) is reachable ONLY from a loaded list. Nothing here can create, rename or link
 * anything: the only action is Retry, which re-asks the cloud and writes nothing.
 *
 *   loading — a quiet line, no actions.
 *   slow    — still loading past a few seconds: say the cloud is slow (so it never reads as "gone").
 *   failed  — "Couldn't reach your schedules. Nothing is lost." + Retry. The embedded app keeps
 *             retrying in the background with backoff, so when the cloud answers the real schedule
 *             opens on its own — Retry only skips the wait.
 *
 * There is deliberately NO local copy of the schedule to open while waiting: the schedule document is
 * cloud-only (cloud rows + a version-guarded write path), and editing a stale local copy is exactly the
 * overwrite this item exists to prevent. `hasScheduleHint` (the Site Planner's own local "this project has
 * a schedule" marker) is the one local fact available, so it is used for reassurance only.
 */
import { Button } from "../../../shared/ui/controls.jsx";
import { FONT_SIZE, SPACE } from "../../../shared/ui/designTokens.js";

const wrap = {
  display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center",
  gap: SPACE.lg, width: "min(380px, 100%)", color: "var(--text-primary)", fontFamily: "system-ui, sans-serif",
};

export default function ScheduleLoadState({ state = "loading", siteName = null, hasScheduleHint = false, onRetry }) {
  const failed = state === "failed";
  const slow = state === "slow";
  const headline = failed
    ? "Couldn’t reach your schedules. Nothing is lost."
    : slow
      ? "Still loading your schedules — the cloud is slow right now."
      : "Loading your schedules…";
  return (
    <div
      data-testid="schedule-load-state"
      data-load-state={state}
      role={failed ? "alert" : "status"}
      aria-live="polite"
      aria-label={siteName ? `Schedules for ${siteName}: ${headline}` : headline}
      style={wrap}
    >
      <p style={{ margin: 0, fontSize: FONT_SIZE.display, fontWeight: 600, lineHeight: 1.4 }}>{headline}</p>
      {failed && (
        <p style={{ margin: 0, fontSize: FONT_SIZE.emphasis, lineHeight: 1.5, color: "var(--text-secondary)" }}>
          Your schedules are safe in the cloud. We’ll keep trying, and the schedule opens by itself the moment it answers.
        </p>
      )}
      {failed && onRetry && <Button onClick={onRetry}>Retry</Button>}
      {(failed || slow) && hasScheduleHint && siteName && (
        <p
          data-testid="schedule-load-has-schedule"
          style={{ margin: 0, fontSize: FONT_SIZE.control, lineHeight: 1.5, color: "var(--text-secondary)", overflowWrap: "anywhere" }}
        >
          “{siteName}” has a schedule on file.
        </p>
      )}
    </div>
  );
}
