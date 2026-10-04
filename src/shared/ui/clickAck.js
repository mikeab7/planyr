/* clickAck — an INSTANT, cursor-anchored acknowledgement for a click whose answer takes a network
 * round-trip (NEW-1 / owner report 2026-09-29: a Chambers County lot took 1.5–2 s before anything on
 * screen showed the app had heard the click; the county server is the floor, so the click itself
 * has to be acknowledged at once, where the eye already is).
 *
 * WHY THIS IS PLAIN DOM AND NOT REACT STATE. The planner's own render is a ~150 ms long task on a real
 * plan; a ring that waits for a state update waits for that render, which is exactly the lag being
 * reported. So `startClickAck` appends one small element and toggles one class SYNCHRONOUSLY inside the
 * pointerdown handler — the next frame paints it, whatever React is about to do.
 *
 * LIFECYCLE (never hangs — LOUD-FAILURE): `done()` clears it (the lot landed) · `empty(msg)` swaps the
 * ring for a short "no lot here" tag at the same point, then removes itself · `cancel()` clears with no
 * message (a drag became a pan, or a newer click superseded this one) · a watchdog turns an answer that
 * never comes into the same tag, so a wedged county host can never leave a ring spinning forever.
 * Styling lives in index.css (`.click-ack`) so no colour/size literal is needed here. */

const CLS_BUSY = "click-ack-busy";
const WATCHDOG_MS = 12000; // > the 8 s per-source fetch timeout; only a wedged path reaches it
const TAG_MS = 2600;
const live = new Set();

function syncBusy() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle(CLS_BUSY, live.size > 0);
}

export function startClickAck(clientX, clientY) {
  if (typeof document === "undefined" || !document.body) return { done() {}, empty() {}, cancel() {} };
  const el = document.createElement("div");
  el.className = "click-ack";
  el.setAttribute("data-testid", "click-ack");
  el.setAttribute("data-state", "pending");
  el.setAttribute("aria-hidden", "true");
  el.style.left = `${clientX}px`;
  el.style.top = `${clientY}px`;
  const ring = document.createElement("span");
  ring.className = "click-ack__ring";
  el.appendChild(ring);
  document.body.appendChild(el);

  let closed = false;
  let tagTimer = null;
  let watchdog = null;
  const handle = {};
  const remove = () => {
    if (tagTimer) clearTimeout(tagTimer);
    if (watchdog) clearTimeout(watchdog);
    tagTimer = watchdog = null;
    live.delete(handle);
    if (el.parentNode) el.parentNode.removeChild(el);
    syncBusy();
  };
  handle.done = () => { if (closed) return; closed = true; remove(); };
  handle.cancel = handle.done;
  handle.empty = (msg) => {
    if (closed) return;
    closed = true;
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    live.delete(handle); syncBusy(); // the cursor stops reading "busy" the moment we have an answer
    el.setAttribute("data-state", "empty");
    el.removeChild(ring);
    const tag = document.createElement("span");
    tag.className = "click-ack__tag";
    tag.textContent = msg || "No lot here";
    el.appendChild(tag);
    tagTimer = setTimeout(remove, TAG_MS);
  };
  live.add(handle);
  syncBusy();
  watchdog = setTimeout(() => handle.empty("No answer yet — the county server is slow"), WATCHDOG_MS);
  return handle;
}

/* Test hook: how many acknowledgements are currently pending. */
export function pendingClickAcks() { return live.size; }
