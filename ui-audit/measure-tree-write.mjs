/* measure-tree-write — WHAT A WRITE-THROUGH TREE SAVE ACTUALLY COSTS PER KEYSTROKE.
 *
 * ⛔ WHY THIS EXISTS. B400176 removed the 400 ms debounce in front of the tree's local write,
 * because the debounce created a window in which the stored tree — the copy the cloud sync
 * reads, adopts from and pushes — was older than the copy on screen, and an edit made inside
 * that window could be adopted away. The debounce's stated justification was that *"a rename is
 * a keystroke stream like any other"*, i.e. cost. That is a claim about a number, and this repo's
 * rule is to measure a number rather than reason about it.
 *
 * So this times the REAL writer (`writeTree`, through the real store, through a localStorage
 * that behaves like the browser's) against a notebook deliberately far larger than the owner's:
 * his is ten live notes and a bin of twenty-four. If the honest answer had been "this is
 * expensive", the fix would have had to be a flush-before-read handshake instead — the number
 * chooses the design, not the other way round.
 *
 * Run: `node ui-audit/measure-tree-write.mjs`
 */
const mem = new Map();
globalThis.window = globalThis.window || {};
globalThis.window.localStorage = {
  get length() { return mem.size; },
  key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
  clear: () => mem.clear(),
};

const store = await import("../src/workspaces/notes/lib/notesStore.js");

/** A notebook of `roots` top-level notes, each with `kids` subpages, plus a bin of `binned`. */
function tree(roots, kids, binned) {
  const page = (id, title, pages = []) => ({ id, title, createdAt: 1, updatedAt: 2, projectId: null, pages });
  const pages = [];
  for (let i = 0; i < roots; i += 1) {
    pages.push(page(`p${i}`, `A note with a reasonably long name ${i}`,
      Array.from({ length: kids }, (_, k) => page(`p${i}_${k}`, `Subpage ${k} of note ${i}`))));
  }
  const trash = Array.from({ length: binned }, (_, i) => ({
    id: `t${i}`, title: `Deleted note ${i}`, at: 1, pageIds: [`gone${i}`], projectId: null,
  }));
  return { v: 3, pages, trash, tombs: [] };
}

/** The median is the honest statistic here: one GC pause in a hundred writes is not the cost
 *  of a keystroke, and a mean would let it claim to be. The worst case is printed beside it. */
function timeWrites(t, n = 200) {
  const ms = [];
  for (let i = 0; i < n; i += 1) {
    t.pages[0].title = `A note being renamed, keystroke ${i}`;   // a real rename mutates one string
    const a = performance.now();
    store.writeTree(t);
    ms.push(performance.now() - a);
  }
  ms.sort((x, y) => x - y);
  return { median: ms[Math.floor(n / 2)], worst: ms[n - 1] };
}

const CASES = [
  ["his notebook today (10 notes, 24 in the bin)", tree(10, 0, 24)],
  ["ten times his (100 notes, 200 in the bin)", tree(100, 0, 200)],
  ["a notebook nobody has (500 notes × 5 subpages, 500 in the bin)", tree(500, 5, 500)],
];

console.log("Cost of ONE tree write, signed out (local only) — median of 200, per keystroke\n");
let worstMedian = 0;
for (const [label, t] of CASES) {
  const bytes = JSON.stringify(t).length;
  const { median, worst } = timeWrites(t);
  worstMedian = Math.max(worstMedian, median);
  console.log(`  ${median.toFixed(3)} ms median · ${worst.toFixed(3)} ms worst · ${(bytes / 1024).toFixed(1)} KB — ${label}`);
}

/* ⛔ THE BAR, CHOSEN BEFORE THE MEASUREMENT (PERCEPTUAL-PARITY's clause 4, applied to time):
 * one keystroke's work must stay inside a single 60 fps frame with the frame mostly free —
 * 2 ms against 16.7. The largest case here is a notebook fifty times the owner's; if even that
 * one is inside the budget, the debounce was never buying anything worth a lost rename. */
const BUDGET_MS = 2;
const verdict = worstMedian <= BUDGET_MS;
console.log(`\n${verdict ? "✓" : "✗"} worst median ${worstMedian.toFixed(3)} ms against a ${BUDGET_MS} ms per-keystroke budget`);
if (!verdict) process.exit(1);
