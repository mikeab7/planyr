// pinSchedCursor(cursor, { onExit }) — the scheduler iframe's own copy of src/shared/ui/controls.jsx `pinDragCursor` (this
// standalone page cannot import from src/). Pins ONE cursor over the whole page for the LIFE of a drag, so it does not flip
// back to whatever the pointer happens to be over (every grid cell / header / Gantt row sets its own inline cursor, and the
// pointer routinely leaves the grip: Snap mode moves the divider away from it). `!important` on the root + every descendant
// beats those inline cursors. Released by the returned function (idempotent), by pointerup / mouseup, and — as an ABORT, which
// also calls `onExit` so the caller can end its own gesture — by pointercancel, Escape and window blur. One pin at a time: a
// second call replaces the first.
export function installPinSchedCursor() {
  var live = null;
  window.pinSchedCursor = function (cursor, opts) {
    if (live) live.release(false);
    var el = document.createElement("style");
    el.setAttribute("data-pinned-cursor", cursor);
    el.textContent = "html, html * { cursor: " + cursor + " !important; }";
    document.head.appendChild(el);
    var onExit = opts && opts.onExit;
    var me = { release: release };
    function onEvent(e) {
      if (e.type === "keydown" && e.key !== "Escape") return;
      release(e.type === "keydown" || e.type === "blur" || e.type === "pointercancel");
    }
    function release(abort) {
      if (live !== me) return;
      live = null;
      el.remove();
      window.removeEventListener("pointerup", onEvent, true);
      window.removeEventListener("mouseup", onEvent, true);
      window.removeEventListener("pointercancel", onEvent, true);
      window.removeEventListener("keydown", onEvent, true);
      window.removeEventListener("blur", onEvent);
      if (abort === true && onExit) onExit();
    }
    live = me;
    window.addEventListener("pointerup", onEvent, true);
    window.addEventListener("mouseup", onEvent, true);
    window.addEventListener("pointercancel", onEvent, true);
    window.addEventListener("keydown", onEvent, true);
    window.addEventListener("blur", onEvent);
    return function () { release(false); };
  };
}
