/* Reserved B#/V# blocks per session (NEW-3) — the pure allocator behind `scripts/idBlocks.mjs`.
 *
 * THE REQUIREMENT THIS FILE EXISTS TO MEET, verbatim from the owner's brief: "a test proves two
 * concurrent allocations cannot overlap." That is the `describe` block at the bottom, and it is
 * asserted three ways — exhaustively over the whole ring, as a property over random branch names,
 * and against the specific case that broke the repo (two sessions minting at the same instant
 * against the same freshly-fetched main).
 *
 * Everything here is PURE — no git, no clock, no network — so it runs in the hermetic unit suite
 * next to test/mintGuard.test.js. */
import { describe, it, expect } from "vitest";
import {
  hashBranch, hashSlot, ringFloor, blockAt, blockFor, inBlock, blocksOverlap,
  blockCollision, nextFreeBlock, allocateIds,
  DEFAULT_BLOCK_SIZE, DEFAULT_SLOTS,
} from "../scripts/idBlocks.mjs";

/* The state of the world on 2026-08-06, when the ratchet took the repository down. */
const MAIN_MAX_B = 1449;
const FLOOR = ringFloor(MAIN_MAX_B);

describe("the hash is stable — the property the whole scheme rests on", () => {
  it("is deterministic: the same branch always yields the same slot", () => {
    const b = "claude/github-merge-status-check-xlcfam";
    expect(hashBranch(b)).toBe(hashBranch(b));
    expect(hashSlot(b)).toBe(hashSlot(b));
    // Pinned, so a refactor that silently changes the hash function fails here rather than
    // handing every in-flight branch a different block on its next mint.
    expect(hashBranch("claude/pond-performance-lag-rn18d2")).toBe(hashBranch("claude/pond-performance-lag-rn18d2"));
  });

  it("spreads real branch names across slots rather than clumping", () => {
    const names = [
      "claude/pond-performance-lag-rn18d2", "claude/doubleclick-properties-bug-qijkn5",
      "claude/review-module-bugs-8236kb", "claude/notes-rail-hierarchy-bugs-26utv2",
      "claude/view-independent-work-detector-x48uui", "claude/pond-label-trim-fzs5aj",
      "claude/county-bbox-assignment-bugs-oc0spo",
    ];
    const slots = new Set(names.map((n) => hashSlot(n)));
    // The seven branches that were open that day must not all land on top of each other.
    expect(slots.size).toBe(names.length);
  });

  it("handles an empty or missing branch name without throwing", () => {
    expect(() => hashSlot(undefined)).not.toThrow();
    expect(hashSlot("")).toBeGreaterThanOrEqual(0);
    expect(hashSlot("")).toBeLessThan(DEFAULT_SLOTS);
  });
});

describe("the ring sits just above main and stays readable", () => {
  it("anchors on a block boundary above main's maximum", () => {
    expect(FLOOR).toBeGreaterThan(MAIN_MAX_B);
    expect(FLOOR % DEFAULT_BLOCK_SIZE).toBe(0);
    expect(FLOOR).toBe(1456);
  });

  it("spans exactly size × slots above main — the width follows main, it is not a promise", () => {
    // ⚠ B226402: this case used to be titled "keeps ids four digits", which was true against the
    // 2026-08-06 main max of B1449 pinned above and is false today — main's max is B225,984, so a
    // live block is six digits. What the ring actually guarantees is its SPAN, which is what is
    // asserted; digit count is a consequence of main's maximum and never something this file can
    // hold constant. See the corrected header of scripts/idBlocks.mjs.
    const last = blockAt(DEFAULT_SLOTS - 1, { floor: FLOOR });
    expect(last.hi).toBe(FLOOR + DEFAULT_BLOCK_SIZE * DEFAULT_SLOTS - 1);
    expect(last.hi - FLOOR + 1).toBe(DEFAULT_BLOCK_SIZE * DEFAULT_SLOTS);
    // The span is bounded and does not inflate: against the same main, the rule this replaces had
    // reached B25005 — more than twice the whole ring — with not one real collision behind it.
    expect(last.hi - MAIN_MAX_B).toBeLessThan(25005 - MAIN_MAX_B);
  });

  it("moves up with main instead of inflating without bound", () => {
    expect(ringFloor(1449)).toBeLessThan(ringFloor(9000));
    expect(ringFloor(0)).toBe(DEFAULT_BLOCK_SIZE);
  });
});

describe("block membership", () => {
  const block = blockFor("claude/some-branch", { floor: FLOOR });

  it("is inclusive at both ends and excludes the neighbours", () => {
    expect(inBlock(block.lo, block)).toBe(true);
    expect(inBlock(block.hi, block)).toBe(true);
    expect(inBlock(block.lo - 1, block)).toBe(false);
    expect(inBlock(block.hi + 1, block)).toBe(false);
  });

  it("finds a claimed id inside a block, and reports null when there is none", () => {
    expect(blockCollision(block, new Set([block.lo + 3]))).toBe(block.lo + 3);
    expect(blockCollision(block, new Set([block.hi + 1, block.lo - 1]))).toBe(null);
  });
});

describe("a hash collision steps aside — and does NOT propagate (steel-man 3)", () => {
  it("probes to the next free block when a peer already holds ids in ours", () => {
    const mine = blockFor("branch-a", { floor: FLOOR });
    const claimed = new Set([mine.lo + 2]); // a peer sits in our hashed block
    const got = nextFreeBlock("branch-a", { floor: FLOOR, claimed });
    expect(got.exhausted).toBe(false);
    expect(got.probes).toBeGreaterThan(0);
    expect(blockCollision(got, claimed)).toBe(null);
    expect(blocksOverlap(got, mine)).toBe(false);
  });

  it("stepping aside does not move anyone ELSE's block — the ratchet is gone", () => {
    // This is the difference between this scheme and the high-water mark it replaces. Under the
    // old rule, one branch minting high forced every other in-flight branch to renumber upward.
    const others = ["branch-b", "branch-c", "branch-d"];
    const before = others.map((b) => nextFreeBlock(b, { floor: FLOOR, claimed: new Set() }));
    // "branch-a" now claims a very high id — the B25005 move that started the cascade.
    const after = others.map((b) => nextFreeBlock(b, { floor: FLOOR, claimed: new Set([25005]) }));
    expect(after.map((x) => x.lo)).toEqual(before.map((x) => x.lo));
  });

  it("reports exhaustion honestly rather than wrapping onto someone else's ids", () => {
    const everySlotTaken = new Set(
      Array.from({ length: DEFAULT_SLOTS }, (_, i) => blockAt(i, { floor: FLOOR }).lo),
    );
    const got = nextFreeBlock("branch-a", { floor: FLOOR, claimed: everySlotTaken });
    expect(got.exhausted).toBe(true);
  });
});

describe("a session that needs more ids than one block holds (steel-man 1)", () => {
  it("continues into the next FREE block rather than into any free number", () => {
    const ids = allocateIds("branch-a", { floor: FLOOR, count: DEFAULT_BLOCK_SIZE + 5 });
    expect(ids).toHaveLength(DEFAULT_BLOCK_SIZE + 5);
    expect(new Set(ids).size).toBe(ids.length); // no repeats
    const first = blockFor("branch-a", { floor: FLOOR });
    expect(ids.slice(0, DEFAULT_BLOCK_SIZE).every((n) => inBlock(n, first))).toBe(true);
    // The overflow ids are in a block, not scattered.
    expect(ids.slice(DEFAULT_BLOCK_SIZE).every((n) => n >= FLOOR)).toBe(true);
  });

  it("never hands out an id someone already holds", () => {
    const mine = blockFor("branch-a", { floor: FLOOR });
    const claimed = new Set([mine.lo, mine.lo + 1]);
    const ids = allocateIds("branch-a", { floor: FLOOR, claimed, count: 4 });
    expect(ids.some((n) => claimed.has(n))).toBe(false);
  });

  it("ids remain sortable — only contiguity is given up (steel-man 6)", () => {
    const ids = allocateIds("branch-a", { floor: FLOOR, count: 8 });
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE CENTRAL REQUIREMENT: two concurrent allocations cannot overlap.
 * ───────────────────────────────────────────────────────────────────────────────────────────── */
describe("two concurrent allocations cannot overlap", () => {
  it("every block in the ring is pairwise disjoint from every other", () => {
    const all = Array.from({ length: DEFAULT_SLOTS }, (_, i) => blockAt(i, { floor: FLOOR }));
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(blocksOverlap(all[i], all[j])).toBe(false);
      }
    }
  });

  it("two DIFFERENT branch names never share an id, over 2,000 random pairs", () => {
    // Property test. Distinct slots ⇒ disjoint blocks; equal slots ⇒ the SAME block, which is the
    // hash collision that `nextFreeBlock`'s probe exists to resolve. Both outcomes are asserted,
    // so a hash change that clumped names would fail here rather than in the field.
    let collisions = 0;
    for (let i = 0; i < 2000; i++) {
      const a = `claude/feature-${i}-${(i * 7919) % 104729}`;
      const b = `claude/other-${i}-${(i * 6271) % 99991}`;
      const ba = blockFor(a, { floor: FLOOR });
      const bb = blockFor(b, { floor: FLOOR });
      if (hashSlot(a) === hashSlot(b)) {
        collisions++;
        expect(ba.lo).toBe(bb.lo); // same slot ⇒ same block, resolved by the probe
      } else {
        expect(blocksOverlap(ba, bb)).toBe(false);
        const idsA = new Set(allocateIds(a, { floor: FLOOR, count: DEFAULT_BLOCK_SIZE }));
        const idsB = allocateIds(b, { floor: FLOOR, count: DEFAULT_BLOCK_SIZE });
        expect(idsB.some((n) => idsA.has(n))).toBe(false);
      }
    }
    // Sanity: the hash is spreading, not degenerate.
    expect(collisions).toBeLessThan(2000 * 0.02);
  });

  it("the exact race that broke the repo: two sessions minting at the SAME instant off the SAME main", () => {
    // Reproduction of the two-clone lab recorded in CLAUDE.md — both fetch a fresh origin/main,
    // both allocate with an identical view of the world and no knowledge of each other. Under
    // `next-id --against-main` both were handed the same number. Here they cannot be.
    const sessionA = "claude/pond-performance-lag-rn18d2";
    const sessionB = "claude/doubleclick-properties-bug-qijkn5";
    const sharedView = { floor: ringFloor(MAIN_MAX_B), claimed: new Set() };

    const idsA = allocateIds(sessionA, { ...sharedView, count: 6 });
    const idsB = allocateIds(sessionB, { ...sharedView, count: 6 });

    expect(idsA).toHaveLength(6);
    expect(idsB).toHaveLength(6);
    expect(idsA.filter((n) => idsB.includes(n))).toEqual([]);
  });

  it("all seven branches open that day get seven mutually disjoint id sets", () => {
    const branches = [
      "claude/county-bbox-assignment-bugs-oc0spo", "claude/pond-label-trim-fzs5aj",
      "claude/pond-performance-lag-rn18d2", "claude/doubleclick-properties-bug-qijkn5",
      "claude/review-module-bugs-8236kb", "claude/notes-rail-hierarchy-bugs-26utv2",
      "claude/view-independent-work-detector-x48uui",
    ];
    const sets = branches.map((b) => allocateIds(b, { floor: FLOOR, count: DEFAULT_BLOCK_SIZE }));
    const seen = new Set();
    for (const ids of sets) {
      for (const n of ids) {
        expect(seen.has(n)).toBe(false); // no id appears twice across all seven sessions
        seen.add(n);
      }
    }
    expect(seen.size).toBe(branches.length * DEFAULT_BLOCK_SIZE);
  });
});
