import { test, expect } from "vitest";
import { dishRowsForTable } from "../src/workspaces/food/lib/dishAggregates.js";

// B2671295 ×2 — the owner's Mizuki shape: two same-name rows, the newer ones carry no score.
test("an unscored newer rating never erases an earlier score", () => {
  const rows = [
    { id: "a", name: "Salmon Nigiri", score: null, rated_on: "2026-11-16", visited_on: null, created_at: "2026-11-16T20:00:00Z" },
    { id: "b", name: "salmon nigiri ", score: 8, rated_on: null, visited_on: "2026-11-10", created_at: "2026-11-10T20:00:00Z" },
  ];
  const [r] = dishRowsForTable(rows);
  expect(r.latestScore).toBe(8);
  expect(r.timesHad).toBe(2);
});
test("all rows unscored stays unscored", () => {
  const [r] = dishRowsForTable([{ id: "a", name: "X", score: null, created_at: "2026-11-16T20:00:00Z" }]);
  expect(r.latestScore).toBe(null);
});
