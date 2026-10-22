/* PUBLIC CONTACT ADDRESSES (NEW-1, owner decision 2026-10-20). Public pages use role aliases; michael@planyr.io
 * is public in exactly TWO named places (the signed note on the landing page; the parcel-request link, 2026-10-21); postmaster@ / abuse@ are reserved by
 * Google and must never appear anywhere. Test fixtures that need a real-looking address are exempt. */
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");
const tracked = execSync("git ls-files -- public src functions server", { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
const texty = tracked.filter((f) => /\.(html|jsx?|mjs|json|md|txt)$/.test(f) && !f.includes("/test/"));

/* michael@planyr.io is public in exactly TWO places, each named here by file (never loosened to a pattern): the signed owner note on the
 * landing page (owner decision 2026-10-20) and the "Email Michael to request it" link a county with no parcel data shows (owner request
 * 2026-10-21, NEW-1 — `lib/parcelGaps.js`, which holds the address once as PARCEL_REQUEST_EMAIL). A third place is a new owner decision. */
const MICHAEL_EXCEPTIONS = ["public/landing/index.html", "src/workspaces/site-planner/lib/parcelGaps.js"];

describe("public contact addresses", () => {
  it("michael@planyr.io appears only in the landing owner note and the parcel-request link", () => {
    const hits = texty.filter((f) => read(f).includes("michael@planyr.io"));
    expect(hits).toEqual(MICHAEL_EXCEPTIONS);
    const html = read("public/landing/index.html");
    expect(html.match(/michael@planyr\.io/g).length).toBe(2); // mailto href + visible text, one link
    expect(html).toContain("Planyr is new, and I read every email. If something's off or you have an idea, write me at");
    expect(read("src/workspaces/site-planner/lib/parcelGaps.js").match(/michael@planyr\.io/g).length).toBe(2); // the constant + the header note naming the exception
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
