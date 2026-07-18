/* next-id scanner (B755). Guards the deterministic "next free B#/V#" helper that replaces reading the
 * 464 KB BACKLOG.md + 1.4 MB BACKLOG-DONE.md into model context just to find the max. The parse must
 * (a) count the two authoritative id forms — `### B123` headings and `**B123**` bold mints, incl.
 * ranges — and (b) be IMMUNE to a stray inline prose mention inflating the max (the one dangerous
 * error is UNDER-counting, i.e. reusing a live number; over-counting from a typo is what we prevent). */
import { describe, it, expect } from "vitest";
import { maxId, computeNextIds, findDuplicateIdsIn, maxAgainstMain, readOriginMain, B_FILES, V_FILES } from "../scripts/next-id.mjs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("maxId — parses only the authoritative id forms", () => {
  it("reads a plain `### B123` heading", () => {
    expect(maxId("### B123 — a thing `[mod]` (bug)", "B")).toBe(123);
  });

  it("reads a `**B123**` bold mint", () => {
    expect(maxId("... minted **B412** = highest + 1 ...", "B")).toBe(412);
  });

  it("captures the END of a heading range (`### B300–B302`)", () => {
    expect(maxId("### B300–B302 — a multi-mint", "B")).toBe(302);
  });

  it("captures the END of a bold range in either dash style", () => {
    expect(maxId("minted **B378–B379**", "B")).toBe(379); // en-dash
    expect(maxId("minted **B378-B379**", "B")).toBe(379); // hyphen
    expect(maxId("minted **B378—B379**", "B")).toBe(379); // em-dash
    expect(maxId("minted **B300–302**", "B")).toBe(302); // range end without repeated letter
  });

  it("takes the MAX across mixed forms", () => {
    const text = "### B100 — a\n### B250 — b\n... see **B090** ...\n### B222 — c";
    expect(maxId(text, "B")).toBe(250);
  });

  it("is IMMUNE to a stray inline prose mention (no heading, no bold)", () => {
    // A bare "B99999" in prose must NOT inflate the max — it is not an assigned id.
    const text = "### B120 — real\nsome note about B99999 in passing, and box B2B sizing";
    expect(maxId(text, "B")).toBe(120);
  });

  it("handles the V family the same way", () => {
    expect(maxId("### V267 — live check\n**V189** archived", "V")).toBe(267);
  });

  it("returns 0 when nothing matches", () => {
    expect(maxId("no ids here at all", "B")).toBe(0);
    expect(maxId("", "V")).toBe(0);
  });

  it("does not confuse the B family with the V family", () => {
    expect(maxId("### V900 — a", "B")).toBe(0);
    expect(maxId("### B900 — a", "V")).toBe(0);
  });
});

describe("computeNextIds — real repo files", () => {
  it("returns nextB = maxB + 1 and nextV = maxV + 1", () => {
    const { maxB, maxV, nextB, nextV } = computeNextIds();
    expect(nextB).toBe(maxB + 1);
    expect(nextV).toBe(maxV + 1);
  });

  it("finds real, plausibly-large maxes (the archive is scanned, not just the open file)", () => {
    const { maxB, maxV } = computeNextIds();
    expect(maxB).toBeGreaterThan(700); // sanity floor as of B755
    expect(maxV).toBeGreaterThan(200);
  });
});

describe("findDuplicateIdsIn — the concurrent-mint collision detector (B779)", () => {
  it("flags an id whose heading appears more than once", () => {
    expect(findDuplicateIdsIn(["### B764 — a\n### B764 — b"], "B")).toEqual([{ id: "B764", count: 2 }]);
  });
  it("counts a range heading once, at its primary id (no false positive)", () => {
    expect(findDuplicateIdsIn(["### B300–B302 — multi\n### B303 — ok"], "B")).toEqual([]);
  });
  it("returns [] when every id is unique", () => {
    expect(findDuplicateIdsIn(["### B1 — a\n### B2 — b\n### B3 — c"], "B")).toEqual([]);
  });
  it("only counts `### <L>###` headings, never bold mints or prose", () => {
    // a `**B5**` re-mint / a prose "B5" must NOT read as a second heading occurrence
    expect(findDuplicateIdsIn(["### B5 — the item\n... see **B5** again, and note B5 in passing"], "B")).toEqual([]);
  });
  it("sorts duplicates numerically", () => {
    const d = findDuplicateIdsIn(["### B30 — a\n### B30 — a2\n### B9 — b\n### B9 — b2"], "B");
    expect(d.map((x) => x.id)).toEqual(["B9", "B30"]);
  });
});

describe("maxAgainstMain — folds in origin/main (B779)", () => {
  it("is never LESS than the local-only max (origin/main only adds ids), and never throws", () => {
    // In CI origin/main may or may not be fetched; either way this must be safe + monotone.
    const local = computeNextIds().maxB;
    const withMain = maxAgainstMain(REPO, B_FILES, "B");
    expect(withMain).toBeGreaterThanOrEqual(local);
    expect(maxAgainstMain(REPO, V_FILES, "V")).toBeGreaterThanOrEqual(computeNextIds().maxV);
  });
});

describe("readOriginMain — must not silently degrade on a large archive (B896 regression)", () => {
  // BACKLOG-DONE.md is a write-only, ever-growing archive (1.7 MB+ as of B896) — comfortably
  // past Node's DEFAULT execSync maxBuffer (1 MB). Before this fix, exceeding it threw ENOBUFS,
  // which readOriginMain's catch swallowed silently, so `--against-main` quietly fell back to a
  // stale LOCAL-ONLY max — the exact failure that let two sessions both mint B896 on 2026-07-18
  // (this redesign, and an unrelated typeface/bug-fix item already merged to main). This guards
  // the regression directly: a real git repo, a real oversized file, no mocks.
  const hasOriginMain = (() => {
    try { execSync("git rev-parse origin/main", { cwd: REPO, stdio: "ignore" }); return true; } catch { return false; }
  })();
  const maybeIt = hasOriginMain ? it : it.skip; // sandboxes without a fetched origin/main skip, never false-fail

  maybeIt("reads BACKLOG-DONE.md from origin/main in full, without an ENOBUFS-triggered null", () => {
    const text = readOriginMain(REPO, "BACKLOG-DONE.md");
    expect(text).not.toBeNull();
    expect(text.length).toBeGreaterThan(1024 * 1024); // bigger than the default 1 MB buffer that used to choke
  });

  it("passes an explicit maxBuffer comfortably above BACKLOG-DONE.md's on-disk size", () => {
    const onDiskBytes = readFileSync(resolve(REPO, "BACKLOG-DONE.md")).length;
    const src = readFileSync(resolve(REPO, "scripts/next-id.mjs"), "utf8");
    const m = src.match(/maxBuffer:\s*([0-9_]+(?:\s*\*\s*[0-9_]+)*)/);
    expect(m, "readOriginMain must pass an explicit maxBuffer to execSync").toBeTruthy();
    const configuredBuffer = m[1].split("*").map((n) => parseInt(n.replace(/_/g, ""), 10)).reduce((a, b) => a * b, 1);
    expect(configuredBuffer).toBeGreaterThan(onDiskBytes);
  });
});
