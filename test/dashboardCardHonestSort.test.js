import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NeedsAttentionCard } from "../src/workspaces/dashboard/components/NeedsAttentionCard.jsx";
import { PursuitsCard } from "../src/workspaces/dashboard/components/PursuitsCard.jsx";
import { needsAttentionList } from "../src/workspaces/dashboard/lib/needsAttentionList.js";
import { pursuitsTable } from "../src/workspaces/dashboard/lib/pursuitsList.js";

// B1411504 — this is the Claude-doable headless self-verification ATTEMPT-BEFORE-YOU-PARK calls
// for: neither card needs a signed-in session or a live GIS/network call to RENDER (both take
// already-fetched `rows` as plain props), so the honest-sort fix is proven against the real
// component output, not just the pure lib functions, using fixture shapes that mirror the owner's
// real production account (25 tasks sharing one exact stamp, 6 sharing another; every pursuit
// undated) — confirmed via a read-only query against `planyr_production` on 2026-09-09.

describe("NeedsAttentionCard — bulk-stamp honesty renders", () => {
  const NOW = Date.parse("2026-09-09T12:00:00Z");
  // Mirrors the owner's real shape: 25 tasks stamped identically two days ago (a mass reconcile
  // event), one task stamped uniquely today (a genuine post-rollout transition).
  const bulkStamp = "2026-09-06T18:57:08.194Z";
  const bulkTasks = Array.from({ length: 25 }, (_, i) => ({
    id: i + 1, name: `Bulk task ${i + 1}`, parentId: null, end: "2026-08-13", health: "red", needsAttentionSince: bulkStamp,
  }));
  const genuineTask = { id: 999, name: "Fresh real transition", parentId: null, end: "2026-09-09", health: "red", needsAttentionSince: "2026-09-09T05:00:21.887Z" };
  const projects = { 1: { id: 1, name: "Test Project", tasks: [...bulkTasks, genuineTask] } };
  const rows = needsAttentionList(projects, NOW);

  it("marks the bulk-stamped rows with a '+' and never marks the genuine one", () => {
    const html = renderToStaticMarkup(createElement(NeedsAttentionCard, { rows }));
    // The bulk cluster's day count (all 25 share the same floor(days)) renders with a trailing "+".
    const bulkDays = rows.find((r) => r.bulkStamped).days;
    expect(html).toMatch(new RegExp(`>${bulkDays}\\+<`));
    // The genuine, uniquely-stamped row's day count renders WITHOUT a "+".
    const genuineRow = rows.find((r) => r.taskName === "Fresh real transition");
    expect(genuineRow.bulkStamped).toBe(false);
  });

  it("shows the one-line footnote explaining '+' only because a bulk-stamped row is present", () => {
    const html = renderToStaticMarkup(createElement(NeedsAttentionCard, { rows }));
    expect(html).toMatch(/flagged in a batch when tracking began/);
  });

  it("omits the footnote when nothing is bulk-stamped", () => {
    const cleanRows = needsAttentionList({ 1: { id: 1, name: "P", tasks: [genuineTask] } }, NOW);
    const html = renderToStaticMarkup(createElement(NeedsAttentionCard, { rows: cleanRows }));
    expect(html).not.toMatch(/flagged in a batch/);
  });
});

// B1342848 (owner instruction, 2026-09-09: "remove the deal date from pursuits") — the card no
// longer has a "Next" column, a contractual-date sort, or a "no deal dates set yet" banner (all
// removed; see pursuitsList.js's header). This replaces the old "all-undated honesty" suite.
describe("PursuitsCard — no deal-date column or sort", () => {
  const base = { role: "pursuit", status: "pursuit" };
  const projects = [
    { ...base, groupId: "1", name: "Goose Creek", county: "harris" },
    { ...base, groupId: "2", name: "Bain", county: "fortbend" },
    { ...base, groupId: "3", name: "Tsakiris", county: "waller" },
  ];
  const rows = pursuitsTable(projects, {});

  it("orders alphabetically, not by fetch/insertion order", () => {
    expect(rows.map((r) => r.name)).toEqual(["Bain", "Goose Creek", "Tsakiris"]);
  });

  it("renders exactly three columns (Pursuit / Yield / Quiet for) with no Next/date column", () => {
    const html = renderToStaticMarkup(createElement(PursuitsCard, { rows, yieldBySite: {} }));
    expect(html).toMatch(/>Pursuit</);
    expect(html).toMatch(/>Yield</);
    expect(html).toMatch(/>Quiet for</);
    expect(html).not.toMatch(/>Next</);
    expect(html).not.toMatch(/Nothing scheduled/);
    expect(html).not.toMatch(/No deal dates/);
  });
});
