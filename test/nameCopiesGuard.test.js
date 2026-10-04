/* NEW-1 (B1991040) — a stored COPY of a project's name must not be able to slip in unnoticed, and
 * the two copies that existed (schedules.linked_site_name, doc_reviews.project + auto titles) must
 * resolve their DISPLAY live by id.
 *
 * Measured live 2026-09-29: public.schedules id 6 held linked_site_name "Pappadoupolos" and
 * public.doc_reviews rvmqzs201bfcc2d held project "Pappadoupolos" / title "Pappadoupolos - Other -
 * 2026.06.29" while public.sites.site read "Papadopoulos". The first matrix only looked at component
 * state; these were copies in OTHER TABLES.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isAutoTitle, liveReviewProject, liveReviewTitle, withLiveReviewNames, composeTitle } from "../src/workspaces/doc-review/lib/reviewNaming.js";
import { ownerOf, crossScheduleLabel, setSiteNameResolver, liveSiteName } from "../src/shared/schedule/scheduleOwnership.js";

const walk = (d, out = []) => {
  for (const f of readdirSync(d)) {
    if (f === "node_modules" || f === "test") continue;
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p, out); else if (f.endsWith(".sql")) out.push(p);
  }
  return out;
};

// Every SQL column that could hold a COPY of a Site Planner project/plan name, and why each is OK.
// A NEW entry needs the same justification: either it resolves live by an id at read time (name the
// function), or it is not a Site Planner name at all.
const NAME_COPY_COLUMNS = {
  "linked_site_name": "schedules — display resolves live by linked_site_id (scheduleOwnership.liveSiteName); the stored text is ONLY the fallback for an unresolvable link",
  "project": "doc_reviews — display resolves live by project_id (reviewNaming.liveReviewProject, applied in reviewStore's list reads + dashboardDocFetch); stored text is ONLY the fallback",
  "plan_name": "thoroughfare_segments — the MUNICIPALITY's plan name (a city thoroughfare plan), unrelated to a Site Planner plan",
};
const COPY_COL = /^\s*(?:alter table\s+\S+\s+add column(?: if not exists)?\s+)?"?(linked_site_name|site_name|project_name|plan_name|project|siteName|projectName)"?\s+(?:text|varchar|citext|character)/i;

describe("no undeclared denormalised name column", () => {
  it("every project/plan-name-like SQL column is declared above with its read-time rule", () => {
    const found = new Set(); const undeclared = [];
    for (const f of walk("src").concat(walk("server"))) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (/^\s*--/.test(line)) return;
        const m = COPY_COL.exec(line);
        if (!m) return;
        const col = m[1].toLowerCase() === "sitename" ? "site_name" : m[1];
        found.add(col);
        if (!NAME_COPY_COLUMNS[col]) undeclared.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(undeclared, "a new name-like column: resolve it live by id at read time, then declare it in NAME_COPY_COLUMNS").toEqual([]);
    // the declared list has no dead entries (the guard cannot rot into a permanent green)
    for (const col of Object.keys(NAME_COPY_COLUMNS)) expect(found.has(col), `${col} no longer exists in any .sql — delete its entry`).toBe(true);
  });
});

describe("schedules — the linked project's name is a read-time lookup", () => {
  beforeEach(() => setSiteNameResolver(null));
  const sched = { id: 6, name: "Master Schedule", ownerKind: "site", linkedSiteId: "smqgpt12zh5o", linkedSiteName: "Pappadoupolos" };

  it("with no resolver the stored copy is the fallback (unchanged behaviour)", () => {
    expect(crossScheduleLabel(sched)).toBe("Pappadoupolos / Master Schedule");
  });
  it("a registered resolver wins over the stored copy — the measured Dashboard defect", () => {
    setSiteNameResolver((id) => (id === "smqgpt12zh5o" ? "Papadopoulos" : null));
    expect(crossScheduleLabel(sched)).toBe("Papadopoulos / Master Schedule");
    expect(ownerOf(sched).siteName).toBe("Papadopoulos");
  });
  it("an id the resolver cannot answer falls back to the stored copy, never to blank", () => {
    setSiteNameResolver(() => null);
    expect(liveSiteName("gone", "Old Name")).toBe("Old Name");
    expect(liveSiteName("gone", "")).toBe(null);
  });
  it("a resolver that throws degrades to the fallback", () => {
    setSiteNameResolver(() => { throw new Error("store unreadable"); });
    expect(crossScheduleLabel(sched)).toBe("Pappadoupolos / Master Schedule");
  });
  it("no host code reads linkedSiteName for DISPLAY outside the ownership module", () => {
    const allowed = ["scheduleOwnership.js", "scheduleSource.js", "scheduleLinkHints.js", "navState.js", "scheduleSiteNames.js"];
    const bad = [];
    const scan = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) scan(p); else if (/\.(jsx?|mjs)$/.test(f) && !allowed.includes(f)) {
      readFileSync(p, "utf8").split("\n").forEach((l, i) => { if (/\.linkedSiteName\b/.test(l) && !/^\s*(\/\/|\*)/.test(l) && !/liveSiteName/.test(l)) bad.push(`${p}:${i + 1}: ${l.trim()}`); });
    } } };
    scan("src");
    expect(bad).toEqual([]);
  });
});

describe("doc_reviews — project label and auto-titles follow a rename; typed titles never move", () => {
  const nameOf = (id) => (id === "smqgpt12zh5o" ? "Papadopoulos" : null);
  // the real production row, verbatim
  // (the pre-B659 name-first shape the production row actually carries)
  const prod = { id: "rvmqzs201bfcc2d", project: "Pappadoupolos", project_id: "smqgpt12zh5o", item: "Other", doc_date: "2026-06-29", title: "Pappadoupolos - Other - 2026.06.29" };
  const dateFirst = { ...prod, title: "2026.06.29 Pappadoupolos - Other" };

  it("infers the legacy title is auto-generated (it equals what a generator produced)", () => {
    expect(isAutoTitle(prod)).toBe(true);
    expect(composeTitle({ project: "Pappadoupolos", item: "Other", docDate: "2026-06-29" })).toBe(dateFirst.title);
    expect(isAutoTitle(dateFirst)).toBe(true);
  });
  it("the shown project + title use the live name, in the shape each was found in", () => {
    const shown = withLiveReviewNames(prod, nameOf);
    expect(shown.project).toBe("Papadopoulos");
    expect(shown.title).toBe("Papadopoulos - Other - 2026.06.29");
    expect(withLiveReviewNames(dateFirst, nameOf).title).toBe("2026.06.29 Papadopoulos - Other");
  });
  it("a TYPED title is never rewritten, even when it contains the old project name", () => {
    const typed = { ...prod, title: "Pappadoupolos grading set — final" };
    expect(isAutoTitle(typed)).toBe(false);
    expect(liveReviewTitle(typed, nameOf)).toBe("Pappadoupolos grading set — final");
  });
  it("the explicit flag wins over inference, both ways", () => {
    expect(isAutoTitle({ ...prod, title: "anything", titleAuto: true })).toBe(true);
    expect(isAutoTitle({ ...prod, titleAuto: false })).toBe(false);
  });
  it("a row with no resolvable project id keeps its stored text (the documented fallback)", () => {
    const orphan = { ...prod, project_id: null };
    expect(liveReviewProject(orphan, nameOf)).toBe("Pappadoupolos");
    expect(withLiveReviewNames({ ...prod, project_id: "deleted-id" }, nameOf).project).toBe("Pappadoupolos");
  });
  it("a legacy row with no date cannot be compared, so it is treated as typed (safe direction)", () => {
    expect(isAutoTitle({ title: "Pappadoupolos - Other", project: "Pappadoupolos", item: "Other" })).toBe(false);
  });
});

describe("review tabs — the persisted tab.project text is only a fallback", () => {
  it("tabTitle resolves the project live by projectId and falls back to the stored text", async () => {
    const { tabTitle } = await import("../src/workspaces/doc-review/lib/reviewTabs.js");
    const nameOf = (id) => (id === "g1" ? "Papadopoulos" : null);
    const tab = { id: "r1", name: "Grading set", projectId: "g1", project: "Pappadoupolos" };
    expect(tabTitle(tab, nameOf)).toBe("Grading set — Papadopoulos");
    expect(tabTitle({ ...tab, projectId: "gone" }, nameOf)).toBe("Grading set — Pappadoupolos");
    expect(tabTitle({ ...tab, projectId: null, project: "" }, nameOf)).toBe("Grading set");
    expect(tabTitle(tab)).toBe("Grading set — Pappadoupolos"); // no resolver → unchanged behaviour
  });
});
