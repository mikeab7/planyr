/* Concurrent-mint collision guard (B779). `next-id` (B755) stops a session from MISREADING the
 * next-free number, but it can't stop two sessions running in parallel — each branched from the same
 * main, neither able to see the other's not-yet-merged mint — from grabbing the SAME number. That
 * shows up as an id assigned to two different items. This test fails the build if any B# / V# id is
 * used more than once in the LIVE (active) surfaces — so a colliding PR goes red BEFORE it merges and
 * the branch renumbers then, instead of the collision shipping silently (which is how ~50 historical
 * cross-file dupes + the duplicate V197 all slipped onto main unnoticed).
 *
 * SCOPE: the live files only (BACKLOG.md, VERIFICATION.md). The write-only *-DONE.md archives carry
 * the historical collisions that predate this guard and can't be renumbered in place; `next-id
 * --against-main` prevents minting OVER an archived id in the first place. The full-pair audit is
 * still available via findDuplicateIds(REPO, B_FILES, "B") for a future archive cleanup. */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { findDuplicateIds, findDuplicateIdsIn, LIVE_B_FILES, LIVE_V_FILES } from "../scripts/next-id.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("backlog id uniqueness — the concurrent-mint collision guard (B779)", () => {
  it("no two ACTIVE items share a B# (BACKLOG.md)", () => {
    const dups = findDuplicateIds(REPO, LIVE_B_FILES, "B");
    expect(dups, `\nDuplicate B# in BACKLOG.md — a concurrent-mint collision. Renumber the newer item to the next free id (git fetch origin main && npm run next-id -- --against-main):\n${JSON.stringify(dups)}\n`).toEqual([]);
  });

  it("no two ACTIVE items share a V# (VERIFICATION.md)", () => {
    const dups = findDuplicateIds(REPO, LIVE_V_FILES, "V");
    expect(dups, `\nDuplicate V# in VERIFICATION.md — renumber the newer item to the next free V#:\n${JSON.stringify(dups)}\n`).toEqual([]);
  });

  it("actually catches a collision (proves the guard is not a no-op)", () => {
    const collided = "### B764 — one thing\n### B764 — a different thing minted concurrently\n### B765 — ok";
    expect(findDuplicateIdsIn([collided], "B")).toEqual([{ id: "B764", count: 2 }]);
    // a collision split across two texts (a merge bringing a colliding copy in) is caught too
    expect(findDuplicateIdsIn(["### V276 — a", "### V276 — b"], "V")).toEqual([{ id: "V276", count: 2 }]);
  });

  it("a range heading counts ONCE at its primary id — no false positive", () => {
    expect(findDuplicateIdsIn(["### B300–B302 — a multi-mint\n### B303 — ok"], "B")).toEqual([]);
    // but a range primary that ALSO has its own heading is a real dup
    expect(findDuplicateIdsIn(["### B300–B302 — multi\n### B300 — separate"], "B")).toEqual([{ id: "B300", count: 2 }]);
  });

  it("doesn't confuse the B and V families", () => {
    expect(findDuplicateIdsIn(["### B5 — a\n### V5 — b"], "B")).toEqual([]);
    expect(findDuplicateIdsIn(["### B5 — a\n### V5 — b"], "V")).toEqual([]);
  });
});
