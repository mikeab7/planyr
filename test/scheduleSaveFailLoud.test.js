// B2095121 LOUD-FAILURE: every `Supabase set error` branch of the Scheduler's legacy planar_data write
// must tell the user (a 403/42501 used to reach only the console while the grid showed the edit as saved).
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
const html = readFileSync(new URL("../public/sequence/index.html", import.meta.url), "utf8");
describe("scheduler cloud-write failures are loud", () => {
  const lines = html.split("\n").filter((l) => l.includes('console.error("Supabase set error'));
  it("finds the three write paths", () => expect(lines.length).toBe(3));
  it("each reports the failure to the user", () => { for (const l of lines) expect(l).toContain("reportCloudSaveFailed("); });
  it("the helper raises the schedule toast", () => expect(html).toMatch(/const reportCloudSaveFailed[\s\S]{0,700}showToast\(/));
});
