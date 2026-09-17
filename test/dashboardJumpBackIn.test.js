import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JumpBackInCard } from "../src/workspaces/dashboard/components/DashboardCards.jsx";
import { recentProjects } from "../src/workspaces/dashboard/lib/dashboardPipeline.js";
import { normalizeJumpBackInCount, JUMP_BACK_IN_COUNT_DEFAULT, JUMP_BACK_IN_COUNT_MAX } from "../src/workspaces/dashboard/lib/dashboardLayout.js";

/* NEW-1 (owner ask, 2026-09-17): "jump back in should be the last couple projects I was working
 * on, and I should be able to increase the amount it shows." This is the red-proof for the whole
 * pipeline (recentProjects → normalizeJumpBackInCount → JumpBackInCard render) — it fails on
 * pre-change main, where the card only ever rendered ONE project (mostRecentProject) with no
 * count to configure at all.
 *
 * Rendered names appear in the html in the order React emits its children, which for a plain
 * `.map()` over an already-sorted array is document order — so asserting each name's INDEX in
 * the rendered string is a valid, simple way to assert "most-recent-first" without a DOM.
 */
const NOW = Date.parse("2026-09-17T00:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();

function project(groupId, name, ago) {
  return { groupId, name, status: "active", role: "pursuit", updatedAt: daysAgo(ago) };
}

function renderList(allProjects, rawCount) {
  const count = normalizeJumpBackInCount(rawCount);
  const list = recentProjects(allProjects, count);
  const html = renderToStaticMarkup(createElement(JumpBackInCard, { projects: list, doc: null }));
  return { html, list, count };
}

describe("Jump back in — the full recentProjects/normalizeJumpBackInCount/JumpBackInCard pipeline", () => {
  it("more projects than the configured count — renders EXACTLY the configured count, most-recent-first", () => {
    const all = [project("a", "Alpha", 10), project("b", "Bravo", 0), project("c", "Charlie", 20), project("d", "Delta", 1), project("e", "Echo", 5)];
    const { html, list } = renderList(all, 3);
    expect(list.map((p) => p.groupId)).toEqual(["b", "d", "e"]); // 0, 1, 5 days ago
    expect(list).toHaveLength(3);
    // Order in the rendered markup follows the same most-recent-first sequence.
    expect(html.indexOf("Bravo")).toBeLessThan(html.indexOf("Delta"));
    expect(html.indexOf("Delta")).toBeLessThan(html.indexOf("Echo"));
    expect(html).not.toMatch(/Alpha|Charlie/);
  });

  it("fewer projects than the configured count — renders every project available, never padding", () => {
    const all = [project("a", "Alpha", 2), project("b", "Bravo", 0)];
    const { html, list } = renderList(all, 6);
    expect(list).toHaveLength(2);
    expect(html).toMatch(/Bravo/);
    expect(html).toMatch(/Alpha/);
  });

  it("exactly one project on the account — renders that one row, no crash", () => {
    const { html, list } = renderList([project("a", "Solo Site", 0)], JUMP_BACK_IN_COUNT_DEFAULT);
    expect(list).toHaveLength(1);
    expect(html).toMatch(/Solo Site/);
  });

  it("zero projects on the account, no document either — the empty state, not a broken/empty list render", () => {
    const { html, list } = renderList([], JUMP_BACK_IN_COUNT_DEFAULT);
    expect(list).toHaveLength(0);
    expect(html).toMatch(/Nothing to jump back into yet/);
  });

  it("zero projects but a document exists — the document row still renders on its own", () => {
    const html = renderToStaticMarkup(createElement(JumpBackInCard, {
      projects: recentProjects([], JUMP_BACK_IN_COUNT_DEFAULT),
      doc: { id: "d1", title: "Concept A.pdf", project: "Richfield", updatedAt: daysAgo(1) },
    }));
    expect(html).toMatch(/Concept A\.pdf/);
    expect(html).not.toMatch(/Nothing to jump back into yet/);
  });

  it("a user who has never touched the setting gets the DEFAULT count, not an empty list or a single row", () => {
    const all = Array.from({ length: 8 }, (_, i) => project(`p${i}`, `Project ${i}`, i));
    const { list, count } = renderList(all, undefined); // undefined = "never saved a value" (dashboardPrefs.js's real shape)
    expect(count).toBe(JUMP_BACK_IN_COUNT_DEFAULT);
    expect(list).toHaveLength(JUMP_BACK_IN_COUNT_DEFAULT);
  });

  it("a maxed-out count still renders in full — clamped at the ceiling, not silently truncated further", () => {
    const all = Array.from({ length: 10 }, (_, i) => project(`p${i}`, `Project ${i}`, i));
    const { list, count } = renderList(all, 999);
    expect(count).toBe(JUMP_BACK_IN_COUNT_MAX);
    expect(list).toHaveLength(JUMP_BACK_IN_COUNT_MAX);
  });
});
