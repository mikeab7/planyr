/* Fixture-set integrity + LIVE-VERIFY coverage guard (B278/B280/B281 amendment). Asserts:
 *   (1) every fixture + golden the manifest lists exists, parses, and is at the current fixtureVersion;
 *   (2) every one of the mandatory LIVE-VERIFY classes maps to >=1 harness spec (the amendment's goal
 *       state — the manual live gate shrinks as classes gain sandbox specs);
 *   (3) the committed fixtures + goldens are not stale vs. `scripts/build-fixtures.mjs` (drift guard,
 *       same pattern as MAP.md / BACKLOG_OPEN.md). */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { loadManifest, loadFixture, loadGolden, FIXTURE_VERSION } from "../e2e/fixtures/index.js";
import { auditFixtures } from "../scripts/build-fixtures.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXDIR = join(REPO, "e2e", "fixtures");
const manifest = loadManifest();

// The mandatory LIVE-VERIFY classes (CLAUDE.md LIVE-VERIFY rule / NEW-1). Each must map to >=1 spec.
const LIVE_VERIFY_CLASSES = [
  "timing / race bugs",
  "concurrency / multi-writer",
  "GIS endpoint behavior",
  "zoom- or data-density-dependent rendering",
  "PDF/export parity",
  "real-project-data repros",
];

describe("fixture set integrity", () => {
  it("every manifest fixture + golden exists, parses, and is at the current fixtureVersion", () => {
    for (const f of manifest.fixtures) {
      expect(existsSync(join(FIXDIR, f.fixture)), f.fixture).toBe(true);
      expect(existsSync(join(FIXDIR, f.golden)), f.golden).toBe(true);
      expect(loadFixture(f.fixture).fixtureVersion).toBe(FIXTURE_VERSION);
      expect(() => loadGolden(f.golden)).not.toThrow();
    }
  });

  it("is byte-identical to a fresh `node scripts/build-fixtures.mjs` (no drift)", () => {
    const { ok, problems } = auditFixtures();
    expect(ok, "\n" + problems.join("\n") + "\n").toBe(true);
  });
});

describe("LIVE-VERIFY coverage map", () => {
  it("every mandatory LIVE-VERIFY class maps to at least one harness spec", () => {
    const covered = new Map(manifest.liveVerifyCoverage.map((c) => [c.class, c.specs || []]));
    for (const cls of LIVE_VERIFY_CLASSES) {
      expect(covered.has(cls), `missing coverage entry for "${cls}"`).toBe(true);
      expect(covered.get(cls).length, `no spec mapped for "${cls}"`).toBeGreaterThan(0);
    }
  });

  it("every sandbox spec named in the coverage map exists on disk", () => {
    for (const c of manifest.liveVerifyCoverage) {
      for (const spec of c.specs) {
        if (spec.startsWith("VERIFICATION.md") || spec.endsWith(".yml")) continue; // live / workflow refs
        expect(existsSync(join(REPO, spec)), `coverage spec missing: ${spec}`).toBe(true);
      }
    }
  });
});
