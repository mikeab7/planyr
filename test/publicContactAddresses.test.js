/* PUBLIC CONTACT ADDRESSES (NEW-1, owner decision 2026-10-20). Public pages use role aliases; michael@planyr.io
 * is public in exactly ONE place (the signed note on the landing page); postmaster@ / abuse@ are reserved by
 * Google and must never appear anywhere. Test fixtures that need a real-looking address are exempt. */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");
const tracked = execSync("git ls-files -- public src functions server", { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
const texty = tracked.filter((f) => /\.(html|jsx?|mjs|json|md|txt)$/.test(f) && !f.includes("/test/"));

describe("public contact addresses", () => {
  it("michael@planyr.io appears only in the landing owner note", () => {
    const hits = texty.filter((f) => read(f).includes("michael@planyr.io"));
    expect(hits).toEqual(["public/landing/index.html"]);
    const html = read("public/landing/index.html");
    expect(html.match(/michael@planyr\.io/g).length).toBe(2); // mailto href + visible text, one link
    expect(html).toContain("Planyr is new, and I read every email. If something's off or you have an idea, write me at");
  });
  it("postmaster@ and abuse@ appear nowhere", () => {
    const hits = texty.filter((f) => /\b(postmaster|abuse)@/i.test(read(f)));
    expect(hits).toEqual([]);
  });
  it("legal + footer links use the role aliases", () => {
    expect(read("public/landing/index.html")).toContain('mailto:hello@planyr.io">Contact');
    for (const p of ["public/privacy/index.html", "public/terms/index.html"]) {
      expect(read(p)).toContain("mailto:support@planyr.io");
      expect(read(p)).not.toContain("michael@");
    }
    expect(read("public/privacy/index.html")).toContain("mailto:security@planyr.io");
  });
});
