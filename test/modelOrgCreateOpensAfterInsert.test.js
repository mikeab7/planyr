/* B2584320 — a new organization workbook opens only AFTER its first cloud row exists, so the open-time load finds a version
 * and the first edit's push is a compare-and-set update instead of a second INSERT (a 409 duplicate key that never uploaded). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../src/workspaces/model/ModelApp.jsx", import.meta.url), "utf8");
const body = app.slice(app.indexOf("const onOrgCreate"), app.indexOf("const onOrgOpen"));

describe("onOrgCreate", () => {
  it("awaits the create's cloud answer BEFORE it opens the workbook (the red-proof: the old order opened first and raced the insert)", () => {
    expect(body).toMatch(/await saveOrgWorkbookCloud\(/);
    expect(body.indexOf("await saveOrgWorkbookCloud(")).toBeLessThan(body.indexOf("setOrgWorkbookId(id)"));
    expect(body.indexOf("setOrgWorkbookId(id)")).toBeGreaterThan(-1);
  });
  it("opens on this device whatever the cloud said, and says a refusal out loud", () => {
    expect(body).toMatch(/applyOrgOutcome\("create", r, id\)/);
    expect(body).toMatch(/catch \(e\)/);                       // a thrown save still opens the local copy
    expect(body).toMatch(/finally \{ orgCreatingRef\.current = false; \}/); // and never leaves the button dead
  });
  it("a second click while the first create is in flight makes no second workbook", () => {
    expect(body).toMatch(/if \(orgCreatingRef\.current\) return;/);
  });
});
