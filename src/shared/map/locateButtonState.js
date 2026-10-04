/* The locate button's state machine, pure.
 *   idle      — not tracking (outline arrow, normal gray)
 *   locating  — first fix in flight (spinner)
 *   following — map centred on and tracking the user (solid blue arrow)
 *   located   — position still shown and updating, but the user panned away (outline blue arrow)
 *   blocked   — the environment can never answer (opacity-dimmed; handled outside this table)
 * Events: tap · found · error · panned · stop. Unknown pairs return the state unchanged. */

export const LOCATE_STATES = ["idle", "locating", "following", "located", "blocked"];

const TABLE = {
  idle:      { tap: "locating" },
  locating:  { tap: "idle", found: "following", error: "idle", stop: "idle" },
  following: { tap: "idle", panned: "located", error: "idle", stop: "idle" }, // 2nd tap while following = tracking off (Apple)
  located:   { tap: "following", error: "idle", stop: "idle" },               // tap re-centres
  blocked:   {},
};

export function nextLocateState(state, event) {
  const row = TABLE[state];
  return (row && row[event]) || state;
}

// What a tap should DO, given the state it was taken in (the state machine says where we go).
export function tapAction(state) {
  if (state === "idle") return "start";
  if (state === "locating") return "cancel";
  if (state === "following") return "stop";
  if (state === "located") return "recenter";
  return "notice";
}
