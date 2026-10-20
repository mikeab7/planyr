import { defineConfig } from "vitest/config";

// NEW-7 — THE SUITE RUNS IN UTC, wherever it runs. Measured 2026-10-19 in a container with
// TZ=America/Chicago: `npm test` → 6 failed / 24,683 passed, every failure in two files that build
// a date from `toISOString().slice(0, 10)` (a UTC calendar day) and compare it to a product
// "today" computed in LOCAL time (scheduleHealth's `localIso`) — a midnight-UTC instant is the
// previous day in Central, so "one day overdue" was not overdue. CI was green only because GitHub
// runners are UTC. Pinned here, before `defineConfig`, so every worker inherits it (Node reads
// `process.env.TZ` dynamically; workers inherit the parent's env). The two files were ALSO made
// timezone-honest in their own right (test/scheduleHealth.test.js builds LOCAL calendar days), so
// the pin is belt-and-braces, not what the tests mean.
process.env.TZ = "UTC";

// Standalone, intentionally minimal. These are fast, pure-logic smoke tests over
// the shared/canonical modules that multiple parallel branches keep editing
// (siteModel, metesAndBounds, takeoff, the coordinate spine). They guard against a
// *semantic* regression slipping through a build-only CI check — `vite build`
// proves the bundle compiles, not that the math/selectors still behave.
//
// Node environment only: every module under test is pure JS (no DOM, no React, no
// network), so we deliberately skip the react plugin and jsdom to keep CI quick.
export default defineConfig({
  // JSX, automatic runtime. A handful of suites render a small, DOM-free component to
  // static markup with `react-dom/server` (test/parcelCard.test.js) — that needs the JSX
  // transform, but NOT jsdom: renderToStaticMarkup produces a string, so the environment
  // stays "node" and the suite stays fast.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
  },
});
