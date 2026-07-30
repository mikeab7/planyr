/* NEW-1 — guard the on-demand `lib/sharing.js` import.
 *
 * `MapFinder.jsx` no longer static-imports the share helpers; `doShare` reaches them
 * through a dynamic `import()` so their bytes stay off the Site route's critical chunk.
 * A dynamic import is resolved at RUNTIME, so a rename or a moved file no longer fails
 * the build — it fails the first time the owner tries to share a project, on a signed-in
 * path the sandbox cannot reach. That is precisely the B1123 trap (a re-export that
 * compiled fine and was broken at runtime), so it gets its own cheap assertion.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const finder = readFileSync(resolve(here, "../src/workspaces/site-planner/MapFinder.jsx"), "utf8");

describe("NEW-1 · the deferred sharing import", () => {
  it("still resolves, and still exports both names the map finder destructures", async () => {
    const mod = await import("../src/workspaces/site-planner/lib/sharing.js");
    expect(typeof mod.shareProject).toBe("function");
    expect(typeof mod.makeProjectPrivate).toBe("function");
  });

  it("is reached lazily, not statically — the whole point of the change", () => {
    expect(finder).not.toMatch(/^import\s.*from\s+"\.\/lib\/sharing\.js"/m);
    expect(finder).toMatch(/import\("\.\/lib\/sharing\.js"\)/);
  });

  it("turns a failed chunk load into a visible error rather than a silent no-op", () => {
    // LOUD-FAILURE: doShare renders `r.error` when `r.ok` is false, so the rejection
    // handler must produce that shape rather than swallowing the failure.
    expect(finder).toMatch(/Couldn't load the sharing tools/);
  });
});
