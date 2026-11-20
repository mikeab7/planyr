import { defineConfig } from "vitest/config";

// The LEDGER-DATA tests (NEW-1, 2026-11-05): checks over the REAL ledger content — id uniqueness, leftover conflict
// markers, verification closability, the tag legend, the verification-queue ceiling. The ledger lives on its own
// branch with no required checks, so these cannot gate main's build (a bad record must never fail an unrelated code
// PR). They run in the scheduled ledger-health job and on demand: `npm run test:ledger` (it syncs the ledger first).
process.env.TZ = "UTC";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["test/ledger-data/**/*.test.js"],
    globalSetup: ["test/ledger-data/_setup.mjs"],
  },
});
