import { defineConfig } from "vitest/config";

// Standalone, intentionally minimal. These are fast, pure-logic smoke tests over
// the shared/canonical modules that multiple parallel branches keep editing
// (siteModel, metesAndBounds, takeoff, the coordinate spine). They guard against a
// *semantic* regression slipping through a build-only CI check — `vite build`
// proves the bundle compiles, not that the math/selectors still behave.
//
// Node environment only: every module under test is pure JS (no DOM, no React, no
// network), so we deliberately skip the react plugin and jsdom to keep CI quick.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
  },
});
