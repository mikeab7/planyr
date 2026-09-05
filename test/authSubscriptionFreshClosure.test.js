/* NEW-2(c) — "I click Map, and it takes me out to the map for a split second before returning me
 * straight to the Goose Creek site." Traced to a STALE CLOSURE, a different mechanism from the
 * `currentSite`/`lastRoute` fixes above (the report's own hypothesis that it was "very likely the
 * same lastRoute mechanism" does not hold up — `lastRoute` is only ever read once, at true boot,
 * via `seedBootRoute`, so it cannot cause a same-session, no-reload bounce-back at all).
 *
 * THE MECHANISM. `SitePlannerApp.jsx`'s `onAuthChange` subscription is created ONCE
 * (`useEffect(..., [])`, correctly — re-subscribing every render would be its own bug), which
 * means the `applyUser` closure it captured is FROZEN at whatever `resumeAllowed` (and every
 * other component-scope value `applyUser` closes over) was at the very FIRST render — for the
 * entire life of the mount, not just briefly. `resumeAllowed` is a PROP Shell recomputes as FALSE
 * the instant the routed project actually clears, but the frozen closure never sees that: it
 * keeps reasoning as though the tab is still on its original boot route. So a real signed-in
 * account's still-in-flight `pullCloud` (or literally any LATER auth event — a token refresh,
 * hours later) can resolve, read the frozen `resumeAllowed === true` a boot-time deep link/resume
 * produced, and re-open the very project the user has since deliberately left.
 *
 * THE FIX. `applyUserRef` — the standard pattern for a subscription that must stay subscribed
 * once but must always run the LATEST render's logic: kept in sync on every render (a plain
 * assignment, the same idiom `projectIdRef` above it already uses), read at CALL time rather than
 * closed over at SUBSCRIBE time.
 *
 * There is no jsdom/component-render environment in this repo's vitest config (Node-only, pure-
 * logic tests — see vitest.config.js), so a stale-closure defect — which is fundamentally about
 * React's runtime hook behavior — cannot be reproduced by a pure-function test the way the
 * `currentSite`/`lastRoute` fixes could. The guard here is a SOURCE assertion on the exact shape
 * of the fix, mirroring this repo's other hook-wiring source-guards (e.g.
 * `dashboardNav.test.js`/`scheduleDashboardNav.test.js`). The actual runtime behavior needs a real
 * signed-in live pass — filed as its own `Verify: live` item, `Blocker: auth`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  fileURLToPath(new URL("../src/workspaces/site-planner/SitePlannerApp.jsx", import.meta.url)),
  "utf8",
);

function subscriptionBlock() {
  const at = src.indexOf("const applyUserRef = useRef(applyUser);");
  expect(at, "the applyUserRef fix was not found — has it moved or been renamed?").toBeGreaterThan(-1);
  const closeAt = src.indexOf("}, []);", at);
  expect(closeAt, "the onAuthChange subscription's closing dependency array was not found").toBeGreaterThan(-1);
  return src.slice(at, closeAt + "}, []);".length);
}

describe("NEW-2(c) — the onAuthChange subscription always runs the LATEST applyUser, never a stale one", () => {
  it("applyUserRef is kept in sync on every render, like projectIdRef already is", () => {
    const block = subscriptionBlock();
    expect(block).toMatch(/const applyUserRef = useRef\(applyUser\); applyUserRef\.current = applyUser;/);
  });

  it("the subscription callback invokes applyUserRef.current(...), never the bare applyUser identifier", () => {
    const block = subscriptionBlock();
    // The callback body itself — after the ref declaration — must call through the ref.
    const callbackAt = block.indexOf("return onAuthChange((event, u) => {");
    expect(callbackAt, "the onAuthChange callback was not found").toBeGreaterThan(-1);
    const callback = block.slice(callbackAt);
    expect(callback).toMatch(/applyUserRef\.current\(u, event\)/);
    expect(callback).not.toMatch(/[^.]applyUser\(u, event\)/); // never the un-ref'd, staleness-prone call
  });

  it("the subscription itself still subscribes exactly ONCE (empty deps) — this fix must not turn into a re-subscribe-every-render bug instead", () => {
    const block = subscriptionBlock();
    const effectAt = block.indexOf("useEffect(() => {\n    if (!supabaseConfigured()) return;");
    expect(effectAt, "the onAuthChange effect was not found in the expected shape").toBeGreaterThan(-1);
    const effectTail = block.slice(effectAt, block.indexOf("}, []);", effectAt) + "}, []);".length);
    expect(effectTail.trim().endsWith("}, []);")).toBe(true);
  });

  it("MUTATION CHECK — reverting to the bare (stale-closure-prone) applyUser call fails the guard", () => {
    const preFix = src.replace("applyUserRef.current(u, event);", "applyUser(u, event);");
    expect(preFix).not.toBe(src);
    const at = preFix.indexOf("const applyUserRef = useRef(applyUser);");
    const closeAt = preFix.indexOf("}, []);", at);
    const block = preFix.slice(at, closeAt + "}, []);".length);
    const callbackAt = block.indexOf("return onAuthChange((event, u) => {");
    const callback = block.slice(callbackAt);
    expect(callback).not.toMatch(/applyUserRef\.current\(u, event\)/);
  });
});
