/* yieldToMain — hand the main thread back so the page can PAINT and handle input, then continue.
 *
 * A macrotask (`setTimeout 0`), chosen deliberately over `scheduler.yield()`. `scheduler.yield()` resumes its continuation AHEAD of other
 * queued work, which is right for "finish what I was doing soon" and the opposite of what a background computation wants: it should queue
 * BEHIND the frame's rendering step so each slice is followed by a chance to paint. Measured on the share pass (slow report 55807aa9,
 * ui-audit perf-jurisdiction-switch): with `scheduler.yield` several 7–40 ms slices were seen sharing one ~85–120 ms animation frame; with this
 * macrotask the worst frame carrying share work was 50–117 ms across five runs. That is NOT a clean win — the remaining frame time is mostly
 * non-script work in the same frame — so this is chosen on the principle above and was not measurably worse, not because a number proved it.
 * The cost is a few ms of timer latency per slice, which this computation can afford; an interactive continuation could not.
 *
 * A leaf with no imports, so a pure library can use it without pulling anything onto the boot path. */
export function yieldToMain() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
