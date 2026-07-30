/* The mint gate (B779) — unit coverage for the pure decision layer behind
 * `scripts/check-mint.mjs` and the strict `next-id --against-main`.
 *
 * CONTEXT. B779 shipped `--against-main` plus a CLAUDE.md convention ("mint as the LAST step
 * before you push") and claimed it collapsed the collision window "to a few seconds". Six
 * consecutive dispatches collided anyway. The reproduction (two clones, both fetching a fresh
 * main, both running `--against-main --no-peers`) hands BOTH sessions the same number — the rule
 * was being followed and the tool was structurally blind to the other branch. So the fix is not a
 * stricter convention, it is (a) peer visibility in the tool and (b) this gate, which re-checks
 * the property at push time. These tests pin the decision logic; the end-to-end red-then-green
 * proof lives in the reproduction script recorded on the item.
 *
 * Everything here is PURE — no git, no network, no clock — so it runs in the hermetic unit suite
 * alongside test/idUniqueness.test.js (which is deliberately untouched: it is the backstop, and
 * it works — it fired RED pre-merge on both B1140 renumbers). */
import { describe, it, expect } from "vitest";
import { mintVerdict, announceVerdict, idsNamedIn } from "../scripts/check-mint.mjs";
import {
  assessFreshness, headingIdsIn, selectPeerRefs,
  DEFAULT_MAX_FETCH_AGE_S, DEFAULT_PEER_DAYS, PEER_NS,
} from "../scripts/next-id.mjs";

describe("freshness — `--against-main` must PROVE the ref it trusts is current (defect 3)", () => {
  // Measured in this repo on 2026-07-30: origin/main sat 7 days / 169 ids behind (maxB 974 vs
  // 1143) while the banner still read "[incl. origin/main]". A stale answer is indistinguishable
  // from a correct one, which is exactly why this refuses instead of warning.
  const fresh = { sha: "d5476d0c909d47cec8bd71ce0cfbb276f6f740af", ageSeconds: 3 };

  it("accepts a just-fetched ref and reports what it read", () => {
    const v = assessFreshness(fresh);
    expect(v.ok).toBe(true);
    expect(v.message).toMatch(/d5476d0/);
    expect(v.message).toMatch(/3s ago/);
  });

  it("REFUSES when the ref does not exist", () => {
    const v = assessFreshness({ sha: null, ageSeconds: 1 });
    expect(v.ok).toBe(false);
    expect(v.code).toBe("no-ref");
  });

  it("REFUSES when the clone has never fetched", () => {
    const v = assessFreshness({ sha: fresh.sha, ageSeconds: null });
    expect(v.ok).toBe(false);
    expect(v.code).toBe("never-fetched");
  });

  it("REFUSES a stale ref, and names the limit it broke", () => {
    const v = assessFreshness({ sha: fresh.sha, ageSeconds: DEFAULT_MAX_FETCH_AGE_S + 1 });
    expect(v.ok).toBe(false);
    expect(v.code).toBe("stale");
    expect(v.message).toMatch(/git fetch origin main/);
  });

  it("the boundary is inclusive — exactly at the limit still passes", () => {
    expect(assessFreshness({ sha: fresh.sha, ageSeconds: DEFAULT_MAX_FETCH_AGE_S }).ok).toBe(true);
  });
});

describe("mintVerdict — the gate's decision (red on an early or stale mint, green on a correct one)", () => {
  const base = { letter: "B", claimedMax: 1143, mainIds: new Set([1100, 1143]), peerOwners: new Map() };

  it("GREEN: a correct late mint above everyone's high-water mark", () => {
    const v = mintVerdict({ ...base, added: [1144, 1145] });
    expect(v.ok).toBe(true);
    expect(v.offenders).toEqual([]);
  });

  it("RED: the id is already taken on origin/main (the B1140 case — main merged it mid-flight)", () => {
    const v = mintVerdict({ ...base, added: [1143] });
    expect(v.ok).toBe(false);
    expect(v.offenders).toEqual([{ id: "B1143", kind: "taken", where: "origin/main" }]);
    expect(v.nextFree).toBe(1144);
  });

  it("RED: the id is held by an UNMERGED peer branch — the window B779 could not see at all", () => {
    const v = mintVerdict({
      ...base, claimedMax: 1145, added: [1145],
      peerOwners: new Map([[1145, "planyr-peers/claude/other-session"]]),
    });
    expect(v.ok).toBe(false);
    expect(v.offenders[0]).toEqual({ id: "B1145", kind: "taken", where: "planyr-peers/claude/other-session" });
  });

  it("RED: an id that is free today but sits UNDER the claimed mark — minted against a stale view", () => {
    const v = mintVerdict({ ...base, claimedMax: 1150, added: [1144] });
    expect(v.ok).toBe(false);
    expect(v.offenders[0].kind).toBe("below");
    expect(v.nextFree).toBe(1151);
  });

  it("GAPS ARE LEGAL — B1140 established that skipping numbers costs nothing, so only `> max` is required", () => {
    // B1140–B1143 deliberately skipped B1136–B1139 to break a two-renumber loop. A gate that
    // demanded max+1 exactly would have rejected the very fix that ended that loop.
    expect(mintVerdict({ ...base, added: [1150, 1151] }).ok).toBe(true);
  });

  it("a RECURRENCE mints nothing, so it can never trip the gate", () => {
    // Re-opening B779 moves its heading from BACKLOG-DONE.md back to BACKLOG.md. Because `added`
    // is measured over the UNION of the live + archive pair against the merge base, the id was
    // already present and is not "added" — DEDUPE-FIRST stays free of gate friction. (This very
    // item is a B779 recurrence, so the case is not hypothetical.)
    const priorIds = headingIdsIn(["### B779 — the original fix"], "B"); // as seen in the archive at the base
    const localIds = headingIdsIn(["### B779 — the original fix (×2, re-opened)"], "B"); // now in the live file
    const added = [...localIds].filter((n) => !priorIds.has(n));
    expect(added).toEqual([]);
    expect(mintVerdict({ ...base, added }).ok).toBe(true);
  });

  it("reports EVERY offender, in order — a multi-mint dispatch renumbers once, not one id per pass", () => {
    const v = mintVerdict({ ...base, claimedMax: 1145, added: [1145, 1143, 1146] });
    expect(v.offenders.map((o) => o.id)).toEqual(["B1143", "B1145"]);
    expect(v.nextFree).toBe(1146);
  });
});

describe("headingIdsIn — the union that makes a recurrence invisible to the gate", () => {
  it("collects heading ids across every file of a family", () => {
    expect([...headingIdsIn(["### B10 — a\n### B12 — b", "### B11 — archived"], "B")].sort((a, b) => a - b))
      .toEqual([10, 11, 12]);
  });

  it("does not confuse the B and V families", () => {
    expect([...headingIdsIn(["### B5 — a\n### V5 — b"], "V")]).toEqual([5]);
  });

  it("ignores inline prose mentions — only a real `### B###` heading claims a number", () => {
    // Same rationale as maxId's: a stray "B99999" in prose must never inflate or trip anything.
    expect([...headingIdsIn(["see B99999 for context\n### B7 — real"], "B")]).toEqual([7]);
  });
});

describe("selectPeerRefs — which branches still count as racing us", () => {
  const NS = PEER_NS.split("/").pop();
  const now = 1_800_000_000_000; // fixed clock: these tests never depend on the wall time
  const at = (daysAgo) => now / 1000 - daysAgo * 86400;
  const rows = [
    { name: `${NS}/main`, ts: at(0) },
    { name: `${NS}/claude/mine`, ts: at(0) },
    { name: `${NS}/claude/other-live`, ts: at(1) },
    { name: `${NS}/claude/abandoned`, ts: at(30) },
  ];

  it("keeps other in-flight branches, drops main, our own branch, and anything long-dead", () => {
    const kept = selectPeerRefs(rows, { now, exclude: ["claude/mine"] }).map((r) => r.name);
    expect(kept).toEqual([`${NS}/claude/other-live`]);
  });

  it("excludes EVERY name this checkout answers to — the detached-HEAD false red (caught by CI on this item's own PR)", () => {
    // `actions/checkout` lands on the PR's test-merge commit in DETACHED HEAD, so
    // `git rev-parse --abbrev-ref HEAD` returns the literal "HEAD" and the branch's own mirrored
    // ref reads as a peer holding its own number. This PR's first CI run failed exactly that way
    // (`V531 is ALREADY TAKEN on planyr-peers/claude/backlog-id-collision-recurrence-2z85n2` — our
    // own branch). A gate that cries wolf gets bypassed with --no-verify, so this stays pinned.
    const kept = selectPeerRefs(
      [{ name: `${NS}/claude/mine`, ts: at(0) }, { name: `${NS}/claude/theirs`, ts: at(0) }],
      { now, exclude: ["claude/mine", "HEAD"] }, // GITHUB_HEAD_REF + the useless abbrev-ref answer
    ).map((r) => r.name);
    expect(kept).toEqual([`${NS}/claude/theirs`]);
  });

  it("the window is the PR lifetime, not a guess — a branch just inside it still counts", () => {
    const kept = selectPeerRefs([{ name: `${NS}/claude/x`, ts: at(DEFAULT_PEER_DAYS - 0.1) }], { now });
    expect(kept).toHaveLength(1);
    // and just outside it does not — an aged-out claim only ever leaves a numbering gap, which is free
    expect(selectPeerRefs([{ name: `${NS}/claude/x`, ts: at(DEFAULT_PEER_DAYS + 0.1) }], { now })).toEqual([]);
  });
});

/* NEW-H (2026-07-30) — the ANNOUNCEMENT half of the gate.
 *
 * The owner's report was that PR #865 and PR #866 both claim B1144 / B1145 / B1146 and both claim
 * V531. Audited: they do — in their TITLES. In the FILES they do not, and the gate above is why:
 * #866's ids were renumbered to B1151–B1153 / V534 before merge, `test/idUniqueness.test.js` is
 * green, and there is no duplicate heading anywhere. What nobody updated was the subject line, so
 * `git log --oneline` shows two commits announcing the same three numbers for different features.
 *
 * That is a real gap and this is the fix: the number a PR ANNOUNCES must be a number it FILED.
 * Renumbering is precisely when it breaks, because the late-bind rule (B779) moves the heading at
 * the last moment and the subject was written first. */
describe("announceVerdict — a commit subject may only name ids this branch actually filed (NEW-H)", () => {
  const filed = { B: new Set([1151, 1152, 1153]), V: new Set([534]) };

  it("passes when the subject names exactly what was filed", () => {
    const v = announceVerdict({ subjects: ["Measurements get real style options (B1151 / B1152 / B1153 — V534)"], filed });
    expect(v.ok).toBe(true);
    expect(v.offenders).toEqual([]);
  });

  it("REPRODUCES #866: the stale pre-renumber title goes red, naming every wrong id", () => {
    const v = announceVerdict({
      subjects: ["Measurements get real style options, a settable label zoom, and a proper annotation (B1144 / B1145 / B1146 — V531)"],
      filed,
    });
    expect(v.ok).toBe(false);
    expect(v.offenders.map((o) => o.id)).toEqual(["B1144", "B1145", "B1146", "V531"]);
  });

  it("a subject naming NO ids is fine — plenty of commits legitimately announce nothing", () => {
    expect(announceVerdict({ subjects: ["Tidy the road label spacing"], filed }).ok).toBe(true);
  });

  it("a RECURRENCE passes: it re-opens an existing heading and mints nothing", () => {
    // The heading is in the working tree (moved back from the archive), so the subject that names
    // it is truthful — which is the whole property being checked, rather than 'was this new?'.
    expect(announceVerdict({ subjects: ["Buildings stay welded on a hard sling (B1122 ×2)"], filed: { B: new Set([1122]), V: new Set() } }).ok).toBe(true);
  });

  it("expands a RANGE the way a real subject writes one", () => {
    // The #869 subject: "…four memory tiers that let go (B1156–B1163 — V536–V541)".
    expect([...idsNamedIn("(B1156–B1163 — V536–V541)", "B")]).toEqual([1156, 1157, 1158, 1159, 1160, 1161, 1162, 1163]);
    expect([...idsNamedIn("(B1156–B1163 — V536–V541)", "V")]).toEqual([536, 537, 538, 539, 540, 541]);
  });

  it("does not match a SHORTER id inside a longer one", () => {
    expect([...idsNamedIn("B1144", "B")]).toEqual([1144]);   // not 1, 11, 114…
    expect([...idsNamedIn("B11 and B1144", "B")].sort((a, b) => a - b)).toEqual([11, 1144]);
  });

  it("refuses to expand a nonsense range instead of enumerating thousands of ids", () => {
    expect([...idsNamedIn("B1 – B9999", "B")].sort((a, b) => a - b)).toEqual([1, 9999]);
  });

  it("checks every commit on the branch, not just the first", () => {
    const v = announceVerdict({ subjects: ["Fine (B1151)", "Stale (B1144)"], filed });
    expect(v.ok).toBe(false);
    expect(v.offenders.map((o) => o.id)).toEqual(["B1144"]);
  });
});
