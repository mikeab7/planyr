/*
 * idBlocks.mjs — RESERVED B#/V# BLOCKS PER SESSION (NEW-3).
 *
 * WHY THIS EXISTS. The mint gate (B779, `check-mint.mjs`) rejected an id on two grounds: TAKEN
 * (someone else genuinely holds it — a real collision) and BELOW (the id is free, but sits at or
 * under `claimedMax`, the single highest id across origin/main ∪ every in-flight peer branch).
 * The BELOW rule is a RATCHET, and on 2026-08-06 it took the whole repository down:
 *
 *   · a session is rejected for holding an id below the mark, so it renumbers UPWARD;
 *   · that raises the mark for every OTHER in-flight branch, which must then renumber higher still;
 *   · nothing merges while this happens, so no range is ever released and the mark only climbs.
 *
 * Measured that day: origin/main's highest id was B1449. The claimed high-water mark had reached
 * B25005 — 23,556 ids of pure inflation, none of them a real collision. One PR's ids moved six
 * times (B1467 → B1479 → B1501 → B1601 → B1801 → B3001 → B9001). Seven PRs were open; none could
 * merge. The rejection that started it was verbatim:
 *
 *     B3005 is at or below the claimed high-water mark B25005 — minted against a stale view
 *
 * B3005 collided with NOTHING. It was rejected purely for being below a number another branch had
 * picked. A rule that fires on a prediction rather than on a fact, and whose only remedy pushes
 * everyone else toward the same rejection, has no fixed point.
 *
 * THE REPLACEMENT. Each branch gets its own disjoint BLOCK of ids, and mints inside it. Two
 * sessions minting at the same instant draw from different blocks, so they cannot pick the same
 * number — which is the property the BELOW rule was reaching for and never actually had.
 *
 * NO ALLOCATOR, DELIBERATELY. The block is a PURE FUNCTION of the branch name. Nothing is handed
 * out, nothing is written down, no service is consulted. This is the single most important
 * property of the design, because it answers the two failure modes an allocator would introduce:
 * it cannot become a single point of failure (there is nothing to be down), and two sessions
 * cannot be handed the same block by a race (there is no hand-out — the same name always yields
 * the same block, and different names yield different blocks unless their hashes collide, which
 * is detected; see `blockCollision` below).
 *
 * THE NUMBERS. `size` 16 ids per block × `slots` 512 blocks = an 8,192-id span sitting just above
 * origin/main's current maximum, moving up as main moves up rather than inflating without bound.
 *
 * ⚠ CORRECTED 2026-08-07 (B226402) — THE FOUR-DIGIT PROMISE DID NOT SURVIVE THE OUTAGE THIS FILE
 * WAS WRITTEN TO END, and the original wording is left here so the correction is legible rather
 * than tidied away. It read: *"With main at B1449 that is B1456–B9647: still four digits, still
 * readable."* That was true when it was written and is now false. The ring anchors ABOVE main's
 * maximum, and main's maximum absorbed the inflation era when those branches merged: measured
 * against `origin/main` at `87f0438` on 2026-08-07 it is **B225,984** (V23,409), so the ring runs
 * from B225,995 to about B234,180 and a reserved block is **six digits** — this branch's is
 * B226400–B226415. Repro: `node scripts/check-mint.mjs --ci` on any branch, and read the block it
 * reports. (Note the distinction the report itself draws: "highest assigned anywhere" was B227,475
 * that day, which includes an id held by an unmerged peer. The ring floor follows main's maximum,
 * not that one.)
 *
 * The width is a CONSEQUENCE of main's maximum, never a guarantee this file can make — it will not
 * come back down, because ids are never reused (B1140: gaps are free, and reuse is what makes a
 * grep ambiguous). Nothing counts or iterates ids, so digit count is a readability preference and
 * costs nothing; the correction is here because a header describing a state the repo has left
 * behind is how the next reader stops trusting the rest of the file.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * STEEL-MAN (required by the owner before this shipped). Each argument is stated at its strongest
 * AGAINST the design, then answered — or conceded where it is a genuine cost.
 *
 *  1. "A block can be EXHAUSTED mid-session." Real. 16 ids is not many for a large chat block.
 *     ANSWERED: exhaustion is not an error and never blocks work — `nextFreeBlock` continues into
 *     the branch's next free slot (deterministic probe, same rule), so a session that needs 40 ids
 *     gets them. What it must never do is fall back to "any free number", which is the behaviour
 *     that caused the collisions in the first place. CONCEDED COST: a session spanning three
 *     blocks holds non-contiguous ids. See (6).
 *
 *  2. "An ABANDONED session leaves a permanent hole." True, and it is the design's cheapest cost.
 *     B1140 already established that gaps are free — nothing counts ids, nothing iterates them,
 *     and a gap costs one thing only: a number nobody will ever grep. Against that, the status quo
 *     ante spent 23,556 ids in a single day. A hole is strictly cheaper than a renumber.
 *
 *  3. "Two sessions could be handed the SAME BLOCK by a racing allocator." There is no allocator —
 *     see above. The residual risk is a HASH COLLISION between two different branch names landing
 *     on the same slot. That is not silent: `blockCollision()` detects a peer branch holding ids
 *     inside our block, and the probe steps past it. With ~20 concurrent branches over 512 slots
 *     the birthday probability of any pair sharing a slot is ~32%, which is why the probe is part
 *     of the design and not an afterthought — but a collision now costs ONE branch ONE step to the
 *     next free block, and critically it does NOT propagate: stepping does not invalidate anyone
 *     else's ids, because there is no high-water mark left to raise. That is the whole difference
 *     between this and what it replaces.
 *
 *  4. "A session could RENUMBER ANYWAY and defeat the scheme." It could — but the incentive that
 *     forced renumbering is gone. Under the old rule a session renumbered because CI rejected a
 *     number that collided with nothing. Under this one CI only rejects a genuine collision, which
 *     a block-minted id essentially never is. Renumbering becomes pointless rather than mandatory.
 *
 *  5. "BACKLOG.md conflicts become NON-ADJACENT rather than adjacent." Conceded, and it is a real
 *     trade. Two sessions' new items previously landed on consecutive numbers and therefore next
 *     to each other; now they land in different numeric regions of the same section. Git resolves
 *     both cases the same way (both are appends to `## 🔲 Open`), and non-adjacent hunks conflict
 *     LESS often, not more — adjacency is what makes two inserts collide in the same hunk. The
 *     cost is to a human reading the file, not to the merge.
 *
 *  6. "Something may depend on ids being SORTABLE or CONTIGUOUS." Audited before shipping, and the
 *     answer is no on both counts. Ids are compared for equality and greped as literals; nothing
 *     iterates a range, infers "the next one", or assumes density. `build-backlog-index.mjs` sorts
 *     for display only. Sortability SURVIVES this change regardless — blocks are integer ranges,
 *     so ids remain totally ordered; only contiguity goes, and contiguity was already broken by
 *     every gap the old scheme left behind.
 *
 *  7. "MIGRATION: branches already hold ad-hoc numbers (B3005, B9001, B10005, B25000)." Those ids
 *     are UNCLAIMED and therefore harmless — the property that matters is uniqueness, which they
 *     satisfy. They are GRANDFATHERED: an out-of-block id is reported, never fatal in CI (see
 *     `check-mint.mjs`). Forcing seven blocked PRs to renumber onto blocks would be one more
 *     renumber round — the exact tax this change exists to end.
 *
 *  8. "The gate is WEAKER now." The opposite, and this is worth stating precisely. What was removed
 *     is a HEURISTIC that never proved a collision and produced a repo-wide outage. What remains
 *     fatal is TAKEN — a proven, present collision — plus `test/idUniqueness.test.js`. What is ADDED
 *     is a structural guarantee that two concurrent sessions draw from disjoint ranges, so the
 *     collision the heuristic was guessing at cannot form. Replacing a false-positive predicate
 *     with a structural invariant is a strengthening.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Proven by `test/idBlocks.test.js`, whose central assertion is the one the owner required: two
 * concurrent allocations cannot overlap.
 */

/** Ids per block. Sized so an ordinary session fits in one and a large chat block spans two. */
export const DEFAULT_BLOCK_SIZE = 16;
/** Number of blocks in the ring. size × slots is the id span reserved above main's maximum. */
export const DEFAULT_SLOTS = 512;

/**
 * FNV-1a (32-bit), chosen because it is tiny, dependency-free, and — the only property that
 * matters here — STABLE across machines and Node versions. A hash whose value drifted between
 * runs would hand the same branch a different block on its second mint, which is precisely the
 * churn this file exists to stop.
 */
export function hashBranch(branch) {
  let h = 0x811c9dc5;
  const s = String(branch ?? "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The slot a branch name hashes to. Pure, stable, uniform over `slots`. */
export function hashSlot(branch, slots = DEFAULT_SLOTS) {
  return hashBranch(branch) % slots;
}

/**
 * The first id of the block ring. Anchored just above what main already holds, rounded up to a
 * block boundary so blocks tile cleanly. Passing main's max keeps ids short and keeps the ring
 * moving up with main instead of inflating without bound.
 */
export function ringFloor(mainMax, size = DEFAULT_BLOCK_SIZE) {
  return (Math.floor(Math.max(0, mainMax) / size) + 1) * size;
}

/** The block at a given slot. `{ slot, lo, hi }`, inclusive bounds. */
export function blockAt(slot, { floor, size = DEFAULT_BLOCK_SIZE, slots = DEFAULT_SLOTS } = {}) {
  const s = ((slot % slots) + slots) % slots;
  const lo = floor + s * size;
  return { slot: s, lo, hi: lo + size - 1 };
}

/** The block a branch name owns by hash, before any collision probe. */
export function blockFor(branch, { floor, size = DEFAULT_BLOCK_SIZE, slots = DEFAULT_SLOTS } = {}) {
  return blockAt(hashSlot(branch, slots), { floor, size, slots });
}

/** Is `n` inside `block`? */
export function inBlock(n, block) {
  return !!block && n >= block.lo && n <= block.hi;
}

/** Do two blocks overlap? The invariant `test/idBlocks.test.js` asserts across the whole ring. */
export function blocksOverlap(a, b) {
  return a.lo <= b.hi && b.lo <= a.hi;
}

/** Does any already-claimed id fall inside `block`? Used to detect a hash collision with a peer. */
export function blockCollision(block, claimed) {
  for (const n of claimed) if (inBlock(n, block)) return n;
  return null;
}

/**
 * The block this branch should mint from: its hashed block, or — if a peer already holds ids
 * inside it (a hash collision, or this branch's own earlier block now full) — the next free block,
 * probing forward deterministically around the ring.
 *
 * `claimed` is the set of ids anyone already holds (main ∪ peers ∪ optionally our own, when we are
 * looking for a SECOND block because the first filled up).
 *
 * Returns `{ slot, lo, hi, probes, exhausted }`. `exhausted:true` means every slot in the ring is
 * occupied — reported honestly rather than silently wrapping onto someone else's ids.
 */
export function nextFreeBlock(branch, { floor, size = DEFAULT_BLOCK_SIZE, slots = DEFAULT_SLOTS, claimed = new Set() } = {}) {
  const start = hashSlot(branch, slots);
  for (let i = 0; i < slots; i++) {
    const block = blockAt(start + i, { floor, size, slots });
    if (blockCollision(block, claimed) == null) return { ...block, probes: i, exhausted: false };
  }
  return { ...blockAt(start, { floor, size, slots }), probes: slots, exhausted: true };
}

/**
 * The next `count` free ids for this branch, drawn from its block and continuing into further free
 * blocks when one fills up (steel-man point 1). Never falls back to "any free number".
 */
export function allocateIds(branch, { floor, size = DEFAULT_BLOCK_SIZE, slots = DEFAULT_SLOTS, claimed = new Set(), count = 1 } = {}) {
  const out = [];
  const taken = new Set(claimed);
  let guard = 0;
  while (out.length < count && guard++ < slots) {
    const block = nextFreeBlock(branch, { floor, size, slots, claimed: taken });
    if (block.exhausted) break;
    for (let n = block.lo; n <= block.hi && out.length < count; n++) {
      out.push(n);
      taken.add(n);
    }
  }
  return out;
}
