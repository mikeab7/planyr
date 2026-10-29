// B2095121 LOUD-FAILURE: every `Supabase set error` branch of the Scheduler's legacy planar_data write
// must tell the user (a 403/42501 used to reach only the console while the grid showed the edit as saved).
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const html = readFileSync(new URL("../public/sequence/index.html", import.meta.url), "utf8");
describe("scheduler cloud-write failures are loud", () => {
  const lines = html.split("\n").filter((l) => l.includes('console.error("Supabase set error'));
  it("finds the three write paths", () => expect(lines.length).toBe(3));
  it("each reports the failure to the user", () => { for (const l of lines) expect(l).toContain("reportCloudSaveFailed("); });
  it("the helper raises the schedule toast", () => expect(html).toMatch(/const reportCloudSaveFailed[\s\S]{0,1400}showToast\(/));
  // B2189604 (owner decision 2026-10-29): a permission refusal reads as amber "View only", every other failure stays red.
  it("a permission refusal says View only in amber, other failures stay red", () => {
    expect(html).toMatch(/err\.code === "42501" \|\| err\.status === 403[\s\S]{0,200}View only[\s\S]{0,200}type: "warn"/);
    expect(html).toMatch(/did NOT save to the cloud[\s\S]{0,160}type: "error"/);
    expect(html).toMatch(/const isWarn = type === "warn"/);
  });
});
