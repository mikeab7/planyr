/*
 * mintFatality.mjs — the PURE half of the MINT-FATALITY guard (NEW-2).
 *
 * THE INVARIANT, in one sentence (`FATALITY_INVARIANT` below, and the first thing
 * `test/mintFatality.test.js` says):
 *
 *     A fatal mint verdict may only ever name an id that is HELD RIGHT NOW — present on
 *     origin/main or on a live peer branch — and never an id judged against an AGGREGATE of peer
 *     state such as a maximum, a mean, or a high-water mark.
 *
 * WHY A GUARD AND NOT A MEMORY. On 2026-08-06 this repository could not merge anything for hours.
 * The cause was not a bug in the sense of a wrong line; it was a SHAPE, and the shape was lethal
 * because of three properties stacked together:
 *
 *   1. the check was REQUIRED — an unsatisfied required context offers no merge control to anyone,
 *      not even an administrator, so the repo could not recover from the GitHub side;
 *   2. its verdict depended on ANOTHER UNMERGED BRANCH — specifically on `claimedMax`, the single
 *      highest id across origin/main ∪ every in-flight peer, which is an aggregate of state that
 *      no branch controls and that changes without any action by the branch being judged;
 *   3. THE ONLY REMEDY WORSENED THE CONDITION FOR EVERY PEER — the gate's advice was "renumber
 *      upward", and every renumber raised the mark that every other in-flight branch was being
 *      judged against.
 *
 * `BELOW` — the predicate with that shape — was removed from `scripts/check-mint.mjs` and
 * `scripts/idBlocks.mjs` (B6866). Nothing, however, forbade the SHAPE from coming back, and the
 * shape is easy to re-derive from first principles: "your id is below what everyone else picked, so
 * the next merge will probably take it" is a perfectly reasonable-sounding sentence. It is also
 * false in a sparse id space, and it has no fixed point — see `docs/CI-REQUIRED-CHECK.md` §2.
 *
 * So this file turns the lesson into a property that CI re-proves on every build. It checks the
 * verdict function two independent ways, because either alone can be fooled:
 *
 *   · BEHAVIOURALLY (`fatalityVerdict`) — drive the real `mintVerdict` through a battery of probes
 *     built so that every aggregate of peer state (max, mean, min, count, high-water) is wildly
 *     out of line with the ids being judged, and assert that the fatal set is EXACTLY the ids that
 *     something actually holds. This catches any aggregate predicate whatever, including ones
 *     nobody thought to name, because it tests the property rather than the spelling.
 *
 *   · STRUCTURALLY (`fatalGuardVerdict`) — assert the decision loop that produces `offenders`
 *     mentions no aggregate identifier at all. This catches a reintroduced predicate that happens
 *     to be dormant on every probe (guarded behind a flag, an env var, a date), which the
 *     behavioural half by construction cannot see.
 *
 * BOTH HALVES ARE MUTATION-CHECKED (`test/mintFatality.test.js`): the real repo passes, and a
 * deliberately reintroduced `claimedMax`-style predicate goes red. A guard that has never been
 * shown to fail is indistinguishable from a guard that cannot — the failure mode
 * VIEW-INDEPENDENT-ONCE §6 names, and the reason `missed-collision` below exists.
 *
 * SCOPE, stated so it is not mistaken for a loophole. This governs the MINT verdict — the one whose
 * inputs include peer state. The other fatal path in `check-mint.mjs`, the ANNOUNCEMENT check
 * (does a commit subject name an id this branch actually filed?), is deliberately in scope for the
 * structural half and needs no exemption: it reads only this branch's own working tree, so its
 * verdict is a present, self-contained fact with no peer state in it at all.
 *
 * Pure — no git, no network, no clock, no filesystem. The caller supplies the verdict function and
 * the source text.
 */

/** The invariant this file exists to keep. Quoted verbatim in every failure message. */
export const FATALITY_INVARIANT =
  "A fatal mint verdict may only ever name an id that is HELD RIGHT NOW — present on origin/main " +
  "or on a live peer branch — and never an id judged against an AGGREGATE of peer state such as a " +
  "maximum, a mean, or a high-water mark.";

/**
 * Identifiers that name an AGGREGATE of state the branch under judgement does not control. None of
 * them may appear in a decision path that can produce a fatal offender. `max`/`min`/`mean` are
 * listed bare as well as camel-cased because `Math.max(...)` over peer ids is the same defect
 * wearing a different name.
 */
export const AGGREGATE_IDENTIFIERS = [
  "claimedMax", "nextFree", "peerMax", "mainMax", "highWater", "highWaterMark", "watermark",
  "mark", "ceiling", "floorMax", "max", "min", "mean", "avg", "average", "median", "total", "sum",
];

const peerMap = (ids) => new Map(ids.map((n, i) => [n, `planyr-peers/claude/peer-branch-${i}`]));

/**
 * The probe battery. Every case is a complete `mintVerdict` input; the EXPECTATION is derived from
 * the input itself rather than written out, which is what makes the battery extensible without
 * anyone having to keep a parallel answer key in step:
 *
 *   · an id in `mainIds` MUST be fatal          (else the guard would pass a gate that never fails)
 *   · an id in `peerOwners` MAY be fatal        (a present fact; today it is an advisory — B36051)
 *   · anything else MUST NOT be fatal           (it is held by nobody, so no collision exists)
 *
 * The cases are chosen so that every aggregate of peer state is far from the ids being judged, in
 * both directions — an aggregate predicate cannot be satisfied by all of them at once.
 */
export function probeCases() {
  return [
    {
      name: "unclaimed id far BELOW every peer aggregate — the exact rejection that took the repo down",
      // Verbatim from run 2342: "B3005 is at or below the claimed high-water mark B25005".
      // B3005 collided with nothing then and must collide with nothing now.
      input: {
        letter: "B", added: [3005, 3006, 3007],
        mainIds: new Set([1, 779, 1449]), peerOwners: peerMap([25005, 100002, 209509]),
        claimedMax: 209509, block: { lo: 226400, hi: 226415 },
      },
    },
    {
      name: "unclaimed id far ABOVE every peer aggregate (catches a 'must be near the mark' rule)",
      input: {
        letter: "B", added: [999001],
        mainIds: new Set([1449]), peerOwners: peerMap([1450, 1451]),
        claimedMax: 1451, block: { lo: 1456, hi: 1471 },
      },
    },
    {
      name: "unclaimed id EXACTLY at the old `<=` boundary (an off-by-one is still the same shape)",
      input: {
        letter: "B", added: [25005],
        mainIds: new Set([1449]), peerOwners: peerMap([25006, 25007]),
        claimedMax: 25007, block: { lo: 226400, hi: 226415 },
      },
    },
    {
      name: "unclaimed id OUTSIDE this branch's reserved block — hygiene, never a collision",
      input: {
        letter: "B", added: [42],
        mainIds: new Set([1449]), peerOwners: new Map(),
        claimedMax: 1449, block: { lo: 226400, hi: 226415 },
      },
    },
    {
      name: "no block resolved at all (the gate must still work when the ring cannot be computed)",
      input: {
        letter: "B", added: [7000, 7001],
        mainIds: new Set([1449]), peerOwners: peerMap([9000]),
        claimedMax: 9000, block: null,
      },
    },
    {
      name: "a large peer set — count, mean and max are all enormous, every id unheld",
      input: {
        letter: "B", added: [226400, 226401],
        mainIds: new Set([1449]),
        peerOwners: peerMap(Array.from({ length: 200 }, (_, i) => 500000 + i * 7)),
        claimedMax: 501393, block: { lo: 226400, hi: 226415 },
      },
    },
    {
      name: "a peer set whose MEAN sits above the id and whose MIN sits below it",
      input: {
        letter: "B", added: [5000],
        mainIds: new Set([1449]), peerOwners: peerMap([10, 20, 30, 400000]),
        claimedMax: 400000, block: { lo: 226400, hi: 226415 },
      },
    },
    {
      name: "TAKEN on origin/main — the one case that MUST stay fatal",
      input: {
        letter: "B", added: [1449],
        mainIds: new Set([1449]), peerOwners: new Map(),
        claimedMax: 1449, block: { lo: 226400, hi: 226415 },
      },
    },
    {
      name: "one id taken on main among several unclaimed — exactly one offender, and it is the right one",
      input: {
        letter: "B", added: [226400, 226401, 1449, 226402],
        mainIds: new Set([1, 1449, 225984]), peerOwners: peerMap([227475]),
        claimedMax: 227475, block: { lo: 226400, hi: 226415 },
      },
    },
    {
      name: "held only by an unmerged PEER (a present fact — fatal is permitted, never required)",
      input: {
        letter: "B", added: [227475],
        mainIds: new Set([225984]), peerOwners: peerMap([227475]),
        claimedMax: 227475, block: { lo: 226400, hi: 226415 },
      },
    },
    {
      name: "a RECURRENCE mints nothing — an empty added set can never be fatal",
      input: {
        letter: "B", added: [],
        mainIds: new Set([1, 2, 3]), peerOwners: peerMap([900000]),
        claimedMax: 900000, block: { lo: 226400, hi: 226415 },
      },
    },
    {
      name: "the V family behaves identically — nothing here is B-specific",
      input: {
        letter: "V", added: [1501, 23824],
        mainIds: new Set([23409]), peerOwners: peerMap([24897]),
        claimedMax: 24897, block: { lo: 23824, hi: 23839 },
      },
    },
    // A small deterministic sweep, so the battery covers combinations nobody wrote out by hand:
    // the same id judged against a peer maximum an order of magnitude away in each direction.
    ...[10, 1000, 100000].flatMap((id) =>
      [1, 5000, 5000000].map((peerHigh) => ({
        name: `sweep — id ${id} against a peer maximum of ${peerHigh}`,
        input: {
          letter: "B", added: [id],
          mainIds: new Set([1449]), peerOwners: peerMap([peerHigh]),
          claimedMax: Math.max(1449, peerHigh), block: { lo: 226400, hi: 226415 },
        },
      })),
    ),
  ];
}

/** What a probe's input itself says about which ids may and must be fatal. */
function expectationsFor({ added, mainIds = new Set(), peerOwners = new Map() }) {
  const must = new Set([...added].filter((n) => mainIds.has(n)));
  const may = new Set([...added].filter((n) => mainIds.has(n) || peerOwners.has(n)));
  return { must, may };
}

/**
 * BEHAVIOURAL half. Drive `verdictFn` (normally `mintVerdict` from `scripts/check-mint.mjs`)
 * through the battery and report every departure from the invariant.
 *
 * Two violation kinds, and the second matters as much as the first:
 *   · `unfounded-fatal`   — a fatal id nothing actually holds. The outage class itself.
 *   · `missed-collision`  — an id genuinely present on origin/main that came back non-fatal. This
 *                           is what stops the guard passing a verdict function that has quietly
 *                           stopped failing on anything, which is how a guard of this shape rots
 *                           into a permanent green.
 */
export function fatalityVerdict(verdictFn, { cases = probeCases() } = {}) {
  const violations = [];
  for (const c of cases) {
    const { must, may } = expectationsFor(c.input);
    let res;
    try {
      res = verdictFn({ ...c.input });
    } catch (err) {
      violations.push({ kind: "threw", probe: c.name, detail: String(err && err.message) });
      continue;
    }
    const offenders = (res && res.offenders) || [];
    const fatalIds = new Set(offenders.map((o) => Number(String(o.id).replace(/^[A-Z]/, ""))));

    for (const n of fatalIds) {
      if (!may.has(n)) {
        violations.push({
          kind: "unfounded-fatal", probe: c.name, id: `${c.input.letter}${n}`,
          detail: "fatal on an id that neither origin/main nor any peer branch holds — a prediction, not a collision",
        });
      }
    }
    for (const n of must) {
      if (!fatalIds.has(n)) {
        violations.push({
          kind: "missed-collision", probe: c.name, id: `${c.input.letter}${n}`,
          detail: "present on origin/main and NOT fatal — the gate has stopped catching real collisions",
        });
      }
    }
    // `ok` must agree with the offender list, or a caller reading either one is misled.
    if (res && typeof res.ok === "boolean" && res.ok !== (offenders.length === 0)) {
      violations.push({
        kind: "ok-disagrees", probe: c.name,
        detail: `ok=${res.ok} with ${offenders.length} offender(s)`,
      });
    }
  }
  return { ok: violations.length === 0, violations, probes: cases.length, invariant: FATALITY_INVARIANT };
}

/**
 * Brace-match a function's first loop body out of source text. Small and deliberate: the decision
 * loop in `mintVerdict` is a handful of lines and has been stable across every revision of the
 * gate, so a targeted extraction is worth more than a parser dependency — and it REFUSES rather
 * than returning an empty string when it cannot find what it was told to find (LOUD-FAILURE: a
 * structural guard that silently scans nothing reads exactly like a pass).
 */
export function extractDecisionLoop(source, fnName) {
  const decl = source.indexOf(`function ${fnName}`);
  if (decl < 0) return { ok: false, reason: `no \`function ${fnName}\` in the source` };
  const loop = source.indexOf("for (", decl);
  if (loop < 0) return { ok: false, reason: `\`${fnName}\` has no \`for (\` loop to inspect` };
  // Walk the loop HEADER by paren depth — `for (const n of xs.sort((a, b) => a - b))` has nested
  // parens, and taking the first `)` would land inside the comparator.
  let parens = 0, headerEnd = -1;
  for (let i = loop + 4; i < source.length; i++) {
    if (source[i] === "(") parens++;
    else if (source[i] === ")" && --parens === 0) { headerEnd = i; break; }
  }
  if (headerEnd < 0) return { ok: false, reason: `\`${fnName}\`'s loop header has unbalanced parens` };
  const open = source.indexOf("{", headerEnd);
  if (open < 0) return { ok: false, reason: `\`${fnName}\`'s loop has no braced body` };
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return { ok: true, body: source.slice(open, i + 1) };
  }
  return { ok: false, reason: `unbalanced braces after \`${fnName}\`'s loop` };
}

/**
 * STRUCTURAL half. Assert the decision loops that can produce a fatal offender mention no aggregate
 * identifier at all — so a reintroduced `claimedMax` predicate is red even if it is dormant on
 * every probe (behind a flag, an env var, a date), which is the one case the behavioural half
 * cannot reach.
 *
 * Comments are stripped before the scan: this file's own prose, and the gate's, discuss `claimedMax`
 * at length precisely because it was removed, and a guard that fired on the explanation of why a
 * thing is gone would be unusable.
 */
export function fatalGuardVerdict(source, { functions = ["mintVerdict", "announceVerdict"] } = {}) {
  const violations = [];
  const scanned = [];
  for (const fn of functions) {
    const loop = extractDecisionLoop(source, fn);
    if (!loop.ok) {
      violations.push({ kind: "unreadable", fn, detail: loop.reason });
      continue;
    }
    const code = loop.body
      .replace(/\/\*[\s\S]*?\*\//g, " ")   // block comments
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1"); // line comments (the guard on `:` spares `https://`)
    scanned.push({ fn, lines: code.split("\n").length });
    for (const id of AGGREGATE_IDENTIFIERS) {
      if (new RegExp(`\\b${id}\\b`).test(code)) {
        violations.push({
          kind: "aggregate-in-decision", fn, id,
          detail: `\`${id}\` appears in ${fn}'s decision loop — a fatal verdict may not be a function of an aggregate of peer state`,
        });
      }
    }
  }
  return { ok: violations.length === 0, violations, scanned, invariant: FATALITY_INVARIANT };
}
