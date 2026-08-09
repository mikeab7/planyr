/* A COPY NEVER CHANGES PROJECT (NEW-1), AND THE MACHINE THAT NOTICES WHEN ONE DID (NEW-4).
 *
 * ⛔ WHAT WENT WRONG, AND THEREFORE WHAT THESE HAVE TO ASSERT. One note — Grand Port's
 * "Coordination" — ended up with a near-identical twin filed under an unrelated Colorado
 * pursuit. Nobody was told when it happened; it was found by hand six days later, under a
 * "from a project you deleted" heading, because the pursuit had since been binned.
 *
 * ⛔ EVERY CHECK BELOW ASSERTS THE RESULTING STORE, NEVER THAT A HANDLER RAN. That
 * distinction is the whole point: a test that only asserts "a copy was made" passes on the
 * broken build, because the broken build DID make a copy — it made it in the wrong project.
 * So each one counts the pages that exist afterwards AND reads every page's project back.
 *
 * The mutation check is written down rather than implied: reverting `copyPageWithin` to take
 * a projectId from its caller (the shape the old conflict park had) must reproduce EXACTLY
 * this fingerprint — two pages whose text matches while their projects differ — and the
 * duplicate detector below must go from silent to loud on it. `it("MUTATION", …)` at the end
 * performs that revert against the same fixtures rather than describing it.
 */
import { describe, expect, it } from "vitest";

import {
  addPage, allPageIds, copyPageWithin, deleteNode, emptyTree, findPage, migrate, moveProjectNotes,
  movePage, pageProjectIndex, projectNoteCensus, projectOfPage, setPageProject,
  COPY_SUFFIX, NO_PROJECT_LABEL,
} from "../src/workspaces/notes/lib/notesModel.js";
import { mergeTrees } from "../src/workspaces/notes/lib/notesCloud.js";
import {
  duplicateNotice, findCrossProjectDuplicates, normalizeText, similarity, shingles,
  MIN_TEXT_CHARS, NEAR_DUPLICATE_SIMILARITY,
} from "../src/workspaces/notes/lib/notesDuplicates.js";

/* ---- fixtures: the owner's own shape, with his own words --------------------------------
 *
 * The two real documents differ by ONE WORD in about forty ("Plat" against "RPlat"), which
 * is the hardest case a near-duplicate detector has to get right: too strict and it misses
 * the thing it was built for, too loose and it flags every meeting note in the account. */
const GRAND_PORT = "smqfy2r7pdec";
const COLORADO = "sms7v3ua7ksy";

const COORDINATION = [
  "Civil", "RPlat", "Resubmitted to Baytown 7/13", "CP Grant To Others",
  "Civil working to include irrigation line", "Sanitary Line Extension",
  "Can we get this reimbursed?", "Water / Sanitary Additional Reservation",
  "Working to schedule payment", "LONOs", "Last email to DOW was 7/13, they responded on 7/16",
  "Truck Turn Exhibit", "Quiddity looking into expanding areas, WB-67", "Permitting",
  "Baytown - LPA", "Anything needing my attention?", "Chambers County - Sitework",
].join(" ");
const COORDINATION_COPY = COORDINATION.replace("RPlat", "Plat");
const BONDING = "Required Bonds: Force Main across Needlepoint. Median Openings. Lift Station & Force Main.";

const page = (id, title = id, kids = []) => ({ id, title, createdAt: 1000, updatedAt: 1000, pages: kids });
const root = (id, projectId, kids = []) => ({ ...page(id), projectId, pages: kids });

/** Grand Port with a "Coordination" note that has a subpage, plus a second project. */
const fixture = () => ({
  v: 3,
  pages: [
    root("gp_coordination", GRAND_PORT, [page("gp_sub", "Bonding")]),
    root("gp_load", GRAND_PORT),
    root("co_dev", COLORADO, [page("co_page1", "Page 1")]),
    root("loose", null),
  ],
  trash: [],
});

/** Read every page's project back out of a tree — the assertion that matters. */
const projectsOf = (tree) => Object.fromEntries(pageProjectIndex(tree));

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 1. copyPageWithin — the ONE way a page is copied, and it cannot be told where to put it
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("copyPageWithin — a copy never changes project", () => {
  it("has NO way to be handed a project: the signature takes a source id and nothing else", () => {
    // The defect's whole mechanism was a caller passing the project it happened to be
    // showing. An extra argument cannot leak in if there is no argument to leak into.
    const before = fixture();
    const r = copyPageWithin(before, "gp_coordination", { projectId: COLORADO, title: "Sneaky" });
    expect(r.projectId).toBe(GRAND_PORT);
    expect(projectOfPage(r.tree, r.pageId)).toBe(GRAND_PORT);
  });

  it("a ROOT copy lands in the SOURCE ROOT'S project, and the page count goes up by exactly one", () => {
    const before = fixture();
    const r = copyPageWithin(before, "gp_coordination");
    expect(allPageIds(r.tree)).toHaveLength(allPageIds(before).length + 1);
    expect(projectOfPage(r.tree, r.pageId)).toBe(GRAND_PORT);
    // …and NOTHING ELSE MOVED. Every pre-existing page answers exactly as it did before.
    const after = projectsOf(r.tree);
    for (const [id, pid] of Object.entries(projectsOf(before))) expect(after[id]).toBe(pid);
  });

  it("a SUBPAGE copy stores no project of its own — its root's is the only answer", () => {
    const r = copyPageWithin(fixture(), "gp_sub");
    const hit = findPage(r.tree, r.pageId);
    expect(hit.parent.id).toBe("gp_coordination");
    expect(hit.page.projectId).toBeUndefined();          // never a second copy of the fact
    expect(projectOfPage(r.tree, r.pageId)).toBe(GRAND_PORT);
  });

  it("the copy lands as the source's NEXT SIBLING, not at the end of somebody else's list", () => {
    const r = copyPageWithin(fixture(), "co_dev");
    const ids = r.tree.pages.map((p) => p.id);
    expect(ids[ids.indexOf("co_dev") + 1]).toBe(r.pageId);
  });

  it("a copy of a page in NO project stays in no project — that is a real place, not a gap", () => {
    const r = copyPageWithin(fixture(), "loose");
    expect(r.projectId).toBeNull();
    expect(projectOfPage(r.tree, r.pageId)).toBeNull();
  });

  it("names itself as a copy by default, and takes a caller's title when given one", () => {
    const auto = copyPageWithin(fixture(), "gp_load");
    expect(findPage(auto.tree, auto.pageId).page.title).toBe(`gp_load ${COPY_SUFFIX}`);
    const named = copyPageWithin(fixture(), "gp_load", { title: "gp_load (this window’s copy)" });
    expect(findPage(named.tree, named.pageId).page.title).toBe("gp_load (this window’s copy)");
  });

  it("⛔ AN UNKNOWN SOURCE IS REFUSED, and the tree comes back UNTOUCHED", () => {
    const before = fixture();
    const r = copyPageWithin(before, "not_a_page");
    expect(r.refused).toBe("unknown-source");
    expect(r.pageId).toBeNull();
    expect(r.tree).toBe(before);                          // same object — nothing was written
    expect(allPageIds(r.tree)).toHaveLength(allPageIds(before).length);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 2. A REAL CONFLICT BETWEEN TWO CLIENTS — the resulting store, page by page
 *
 * Two windows of one account. Both hold the SAME note; both edit it; one loses the revision
 * race; the loser's text is PARKED rather than destroyed. The store afterwards must contain
 * exactly one more page than it started with, and every page must still answer with the
 * project of the record it came from — including the parked copy, whose whole reason for
 * existing is that it is a copy.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("two clients, one note, both edited — the resulting store", () => {
  /** What the workspace does on "Use the other": park this window's text, then take theirs. */
  const park = (tree, pageId, parkedTitle) => copyPageWithin(tree, pageId, { title: parkedTitle });

  it("ends with EXACTLY one extra page, and every page's project equals its source's", () => {
    // Window A and window B both looked at Grand Port's "Coordination" while standing in
    // DIFFERENT projects — which is the condition the defect needed. B is standing in the
    // Colorado pursuit; nothing about where B is standing may reach the copy.
    const serverTree = fixture();
    const windowB = migrate(JSON.parse(JSON.stringify(serverTree)));
    const before = allPageIds(windowB).length;
    const beforeProjects = projectsOf(windowB);

    const parked = park(windowB, "gp_coordination", `Coordination ${COPY_SUFFIX}`);

    expect(allPageIds(parked.tree)).toHaveLength(before + 1);        // (a) exact page count
    const after = projectsOf(parked.tree);                            // (b) every projectId
    for (const [id, pid] of Object.entries(beforeProjects)) expect(after[id]).toBe(pid);
    expect(after[parked.pageId]).toBe(GRAND_PORT);
    expect(after[parked.pageId]).not.toBe(COLORADO);
    // The Colorado project gained NOTHING — the fingerprint of the original defect.
    expect(Object.values(after).filter((p) => p === COLORADO)).toHaveLength(
      Object.values(beforeProjects).filter((p) => p === COLORADO).length,
    );
  });

  it("the parked copy and its source are the ONLY pair with the same text — and they share a project", () => {
    const parked = park(fixture(), "gp_coordination", `Coordination ${COPY_SUFFIX}`);
    const bodies = {
      gp_coordination: COORDINATION,
      [parked.pageId]: COORDINATION,      // a park copies the document verbatim
      co_page1: "",
      gp_sub: BONDING,
    };
    const rows = Object.entries(bodies).map(([pageId, text]) => ({
      pageId, title: pageId, text, where: "live", projectId: projectOfPage(parked.tree, pageId),
    }));
    // Identical text, SAME project → not a finding. That is the point of the fix.
    expect(findCrossProjectDuplicates(rows)).toEqual([]);
  });

  it("a TREE MERGE between the two windows moves no page between projects", () => {
    // The other way a page could change hands: the structural merge that runs when both
    // devices changed the tree. Rule 3 says the local record wins — including its filing.
    const mine = fixture();
    const theirs = setPageProject(fixture(), "gp_load", COLORADO);   // re-filed on the other device
    const merged = mergeTrees(mine, theirs);
    expect(allPageIds(merged)).toHaveLength(allPageIds(mine).length);
    expect(projectOfPage(merged, "gp_coordination")).toBe(GRAND_PORT);
    expect(projectOfPage(merged, "gp_sub")).toBe(GRAND_PORT);
    expect(projectOfPage(merged, "co_page1")).toBe(COLORADO);
    expect(projectOfPage(merged, "loose")).toBeNull();
    // gp_load legitimately followed its own record — the re-filing is a real edit, not drift.
    expect([GRAND_PORT, COLORADO]).toContain(projectOfPage(merged, "gp_load"));
  });

  it("a merge that only ADDS a page on one side leaves every other page's project alone", () => {
    const mine = fixture();
    const theirs = addPage(fixture(), { projectId: COLORADO, id: "co_new", title: "New" }).tree;
    const merged = mergeTrees(mine, theirs);
    expect(projectOfPage(merged, "co_new")).toBe(COLORADO);
    for (const [id, pid] of Object.entries(projectsOf(mine))) expect(projectOfPage(merged, id)).toBe(pid);
  });

  it("MOVING a page to root with no explicit project KEEPS the project it already had", () => {
    // The one model op that CAN change a project, and only when told to. Reordering must not.
    const moved = movePage(fixture(), "gp_load", null, 0);
    expect(projectOfPage(moved, "gp_load")).toBe(GRAND_PORT);
    const nested = movePage(fixture(), "gp_load", "co_dev", 0);
    expect(projectOfPage(nested, "gp_load")).toBe(COLORADO);          // it IS in Colorado now, by placement
    expect(findPage(nested, "gp_load").page.projectId).toBeUndefined();  // and stores no second copy
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 3. THE DETECTOR (NEW-4)
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("findCrossProjectDuplicates", () => {
  const row = (pageId, projectId, text, where = "live") => ({ pageId, title: pageId, projectId, text, where });

  it("finds the owner's real pair — one word different in forty, two different projects", () => {
    const found = findCrossProjectDuplicates([
      row("gp_coordination", GRAND_PORT, COORDINATION),
      row("co_page1", COLORADO, COORDINATION_COPY, "bin"),
      row("gp_sub", GRAND_PORT, BONDING),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].pages.map((p) => p.pageId).sort()).toEqual(["co_page1", "gp_coordination"]);
    expect(found[0].projectIds.sort()).toEqual([COLORADO, GRAND_PORT].sort());
    expect(found[0].similarity).toBeGreaterThan(0.95);
    expect(found[0].identical).toBe(false);
    expect(found[0].pages.find((p) => p.pageId === "co_page1").where).toBe("bin");
  });

  it("⛔ SEARCHES THE BIN — both real copies were binned before anyone looked at them", () => {
    const found = findCrossProjectDuplicates([
      row("a", GRAND_PORT, COORDINATION, "bin"),
      row("b", COLORADO, COORDINATION, "bin"),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].identical).toBe(true);
    expect(found[0].similarity).toBe(1);
  });

  it("SAME PROJECT is never a finding, however identical — copying inside a project is ordinary", () => {
    expect(findCrossProjectDuplicates([
      row("a", GRAND_PORT, COORDINATION),
      row("b", GRAND_PORT, COORDINATION),
    ])).toEqual([]);
  });

  it("EMPTY and nearly-empty pages are never findings — otherwise every blank page matches", () => {
    expect(findCrossProjectDuplicates([
      row("a", GRAND_PORT, ""),
      row("b", COLORADO, ""),
      row("c", GRAND_PORT, "   \n  "),
      row("d", COLORADO, "short"),
    ])).toEqual([]);
    expect(similarity(shingles(""), shingles(""))).toBe(0);   // "both say nothing" ≠ "the same"
  });

  it("two notes that merely RHYME are not a finding — a banner nobody trusts is worse than none", () => {
    const a = "Called Baytown about the plat on Tuesday and they want the drainage report first.";
    const b = "Called Chambers County about the driveway permit and they want the truck turn exhibit.";
    expect(a.length).toBeGreaterThan(MIN_TEXT_CHARS);
    expect(findCrossProjectDuplicates([row("a", GRAND_PORT, a), row("b", COLORADO, b)])).toEqual([]);
  });

  it("three copies across three projects come back as ONE group, not three pairs", () => {
    const found = findCrossProjectDuplicates([
      row("a", GRAND_PORT, COORDINATION),
      row("b", COLORADO, COORDINATION),
      row("c", "smrp1wrgg6u5", COORDINATION_COPY),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].pages).toHaveLength(3);
    expect(found[0].projectIds).toHaveLength(3);
  });

  it("case and spacing are not an edit — a round trip through the editor must not read as one", () => {
    expect(normalizeText("  Force   Main\nacross Needlepoint ")).toBe("force main across needlepoint");
    expect(findCrossProjectDuplicates([
      row("a", GRAND_PORT, COORDINATION),
      row("b", COLORADO, `  ${COORDINATION.toUpperCase()}\n\n `),
    ])[0].identical).toBe(true);
  });

  it("says nothing when there is nothing to say — the answer it should usually give", () => {
    expect(findCrossProjectDuplicates([row("a", GRAND_PORT, COORDINATION), row("b", COLORADO, BONDING)])).toEqual([]);
    expect(duplicateNotice([])).toBeNull();
    expect(duplicateNotice(null)).toBeNull();
  });

  it("the notice names the finding, not the category", () => {
    const found = findCrossProjectDuplicates([row("a", GRAND_PORT, COORDINATION), row("b", COLORADO, COORDINATION)]);
    expect(duplicateNotice(found)).toContain("2 different projects");
  });

  it("the threshold is not doing the work — the real pair survives a far stricter bar", () => {
    const rows = [row("a", GRAND_PORT, COORDINATION), row("b", COLORADO, COORDINATION_COPY)];
    expect(findCrossProjectDuplicates(rows, { threshold: 0.95 })).toHaveLength(1);
    expect(NEAR_DUPLICATE_SIMILARITY).toBeLessThan(0.95);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 4. WHAT A PROJECT IS HOLDING (NEW-3)
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("projectNoteCensus / moveProjectNotes", () => {
  it("counts NOTES and the PAGES under them separately — a note with subpages is not one page", () => {
    const c = projectNoteCensus(fixture(), GRAND_PORT);
    expect(c.noteCount).toBe(2);                       // gp_coordination + gp_load
    expect(c.pageCount).toBe(3);                       // …and gp_sub under the first
    expect(c.titles).toContain("gp_coordination");
  });

  it("counts what the project has IN THE BIN too — a restore would bring it back to a dead project", () => {
    const binned = deleteNode(fixture(), "gp_load");
    const c = projectNoteCensus(binned.tree, GRAND_PORT);
    expect(c.noteCount).toBe(1);
    expect(c.binnedNotes).toBe(1);
    expect(c.binnedPages).toBe(1);
  });

  it("a project with nothing filed in it honestly counts zero", () => {
    expect(projectNoteCensus(fixture(), "smsdrvzr9gzx")).toMatchObject({ noteCount: 0, pageCount: 0, binnedNotes: 0 });
  });

  it("no-project is a REAL group with a name, not the absence of an answer", () => {
    expect(projectNoteCensus(fixture(), null).noteCount).toBe(1);
    expect(NO_PROJECT_LABEL).toBe("Not in a project");
  });

  it("moving a project's notes out re-files EVERY one and touches NO other project", () => {
    const before = fixture();
    const { tree, moved } = moveProjectNotes(before, GRAND_PORT, null);
    expect(moved).toBe(2);
    expect(allPageIds(tree)).toHaveLength(allPageIds(before).length);   // a move loses nothing
    expect(projectOfPage(tree, "gp_coordination")).toBeNull();
    expect(projectOfPage(tree, "gp_sub")).toBeNull();                    // the subpage follows its root
    expect(projectOfPage(tree, "co_page1")).toBe(COLORADO);              // untouched
    expect(projectNoteCensus(tree, GRAND_PORT).noteCount).toBe(0);
  });

  it("moves the BIN entries too, so a restore cannot resurrect the dead binding", () => {
    const binned = deleteNode(fixture(), "gp_load");
    const { tree } = moveProjectNotes(binned.tree, GRAND_PORT, null);
    expect(projectNoteCensus(tree, GRAND_PORT).binnedNotes).toBe(0);
    expect(projectNoteCensus(tree, null).binnedNotes).toBe(1);
  });

  it("a project with no notes moves nothing and rewrites nothing", () => {
    expect(moveProjectNotes(fixture(), "nobody", null).moved).toBe(0);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════
 * 5. THE MUTATION CHECK — reverting the fix must reproduce THIS EXACT SHAPE
 *
 * Not a description of what would happen: the broken implementation, run against the same
 * fixtures, asserted to produce the fingerprint the owner found by hand — a page whose text
 * matches another page's while their projects differ — and asserted to be caught.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
describe("MUTATION — the pre-fix copy, and the detector that now catches it", () => {
  /** The OLD shape: a copy filed into whatever project the caller was standing in. */
  const brokenCopy = (tree, sourcePageId, viewersProjectId, title) =>
    addPage(tree, { projectId: viewersProjectId, title });

  it("reverting reproduces the reported defect exactly — same words, different project", () => {
    const viewerIsStandingIn = COLORADO;                      // …and the note is Grand Port's
    const broken = brokenCopy(fixture(), "gp_coordination", viewerIsStandingIn, `Coordination ${COPY_SUFFIX}`);

    expect(projectOfPage(broken.tree, "gp_coordination")).toBe(GRAND_PORT);
    expect(projectOfPage(broken.tree, broken.pageId)).toBe(COLORADO);   // ⛔ the bug

    const rows = [
      { pageId: "gp_coordination", title: "Coordination", projectId: GRAND_PORT, text: COORDINATION, where: "live" },
      { pageId: broken.pageId, title: `Coordination ${COPY_SUFFIX}`, projectId: COLORADO, text: COORDINATION_COPY, where: "live" },
    ];
    const found = findCrossProjectDuplicates(rows);
    expect(found).toHaveLength(1);                            // the detector goes LOUD
    expect(found[0].projectIds.sort()).toEqual([COLORADO, GRAND_PORT].sort());
    expect(duplicateNotice(found)).toBeTruthy();
  });

  it("…and the FIXED copy, on the identical fixtures, is silent", () => {
    const fixed = copyPageWithin(fixture(), "gp_coordination", { title: `Coordination ${COPY_SUFFIX}` });
    const rows = [
      { pageId: "gp_coordination", title: "Coordination", projectId: projectOfPage(fixed.tree, "gp_coordination"), text: COORDINATION, where: "live" },
      { pageId: fixed.pageId, title: `Coordination ${COPY_SUFFIX}`, projectId: projectOfPage(fixed.tree, fixed.pageId), text: COORDINATION_COPY, where: "live" },
    ];
    expect(findCrossProjectDuplicates(rows)).toEqual([]);
    expect(duplicateNotice(findCrossProjectDuplicates(rows))).toBeNull();
  });

  it("an empty tree is a fixed point for every one of these", () => {
    expect(copyPageWithin(emptyTree(), "anything").refused).toBe("unknown-source");
    expect(projectNoteCensus(emptyTree(), GRAND_PORT).noteCount).toBe(0);
    expect(moveProjectNotes(emptyTree(), GRAND_PORT, null).moved).toBe(0);
    expect(findCrossProjectDuplicates([])).toEqual([]);
  });
});
