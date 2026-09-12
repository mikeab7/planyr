/* B1594320 — `applyUser`'s same-user dedup guard must stamp `prevUid.current` BEFORE any `await`,
 * not only at the end of the function.
 *
 * THE RACE. `applyUser` opens with `if (uid && uid === prevUid.current && event !== "SIGNED_OUT")
 * return;` — a guard against supabase-js re-emitting an auth event for a session that is already
 * active (tab focus, a token refresh, or — the case that matters here — its own GoTrueClient
 * legitimately delivering more than one event for the SAME resumed session close together:
 * `_emitInitialSession` fires the instant a new listener subscribes, independently of
 * `_recoverAndRefresh`'s own later `SIGNED_IN` broadcast). With `prevUid.current = uid` written
 * only at the very end of this long multi-`await` function (claimInvites, pullCloud, refreshSites,
 * …), a SECOND event for the same uid arriving before the first call's assignment landed reads the
 * guard as "not a duplicate" and re-runs the whole pull+resume+`setLoadEpoch` sequence again — which
 * force-remounts the keyed planner (`${activeSiteId}:${loadEpoch}`) a second time mid-boot. That
 * remount is exactly the mechanism B1574432's own commit named as its flash bug's trigger, and a
 * repeating version of it is one credible contributor to B1594320 (the P0 canvas-invisible outage;
 * see docs/incidents/B1594320-CANVAS-VISIBILITY-OUTAGE.md for the full investigation — this session
 * could not prove it is THE trigger, only that it is a real, closable gap).
 *
 * There is no jsdom/component-render environment in this repo's vitest config (Node-only, pure-
 * logic tests — see vitest.config.js), so this is a SOURCE assertion on the exact shape of the fix,
 * the same idiom test/authSubscriptionFreshClosure.test.js already uses for a neighboring auth-
 * timing defect in this same function.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  fileURLToPath(new URL("../src/workspaces/site-planner/SitePlannerApp.jsx", import.meta.url)),
  "utf8",
);

function applyUserBody() {
  const at = src.indexOf("const applyUser = async (u, event) => {");
  expect(at, "applyUser was not found — has it moved or been renamed?").toBeGreaterThan(-1);
  // applyUser is a long function; grab enough of it to cover the guard, its explanatory comment,
  // and the first await (claimInvites).
  return src.slice(at, at + 3000);
}

describe("B1594320 — applyUser's dedup marker is stamped before any await, not only at the end", () => {
  it("prevUid.current is assigned immediately after the dedup guard, before the seq/await machinery", () => {
    const body = applyUserBody();
    const guardAt = body.indexOf('if (uid && uid === prevUid.current && event !== "SIGNED_OUT") return;');
    expect(guardAt, "the same-user dedup guard was not found in its expected shape").toBeGreaterThan(-1);
    const markerAt = body.indexOf("prevUid.current = uid;", guardAt);
    const firstAwaitAt = body.indexOf("await ", guardAt);
    expect(markerAt, "prevUid.current = uid was not found shortly after the guard").toBeGreaterThan(guardAt);
    expect(firstAwaitAt, "no await found after the guard — has applyUser changed shape?").toBeGreaterThan(guardAt);
    expect(markerAt, "prevUid.current must be stamped BEFORE the function's first await — a race a second auth event can win").toBeLessThan(firstAwaitAt);
  });

  it("MUTATION CHECK — reverting to an end-of-function-only assignment reintroduces the race the guard above catches", () => {
    // Simulate the pre-fix shape: no early stamp, only the historical end-of-function one.
    const preFix = src.replace(
      'if (uid && uid === prevUid.current && event !== "SIGNED_OUT") return;\n    /* B1594320',
      'if (uid && uid === prevUid.current && event !== "SIGNED_OUT") return;\n    /* NOT-B1594320',
    ).replace("    prevUid.current = uid;\n    const seq = ++applySeq.current;", "    const seq = ++applySeq.current;");
    const at = preFix.indexOf("const applyUser = async (u, event) => {");
    const body = preFix.slice(at, at + 3000);
    const guardAt = body.indexOf('if (uid && uid === prevUid.current && event !== "SIGNED_OUT") return;');
    const markerAt = body.indexOf("prevUid.current = uid;", guardAt);
    // With the fix removed, the only remaining assignment is the original end-of-function one,
    // which sits well past the first await — so this must NOT be found within the guarded window.
    expect(markerAt === -1 || markerAt > body.indexOf("await ", guardAt)).toBe(true);
  });
});
