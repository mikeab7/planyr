import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/* B1843888 — the vitest suite was reaching PRODUCTION Supabase. CI's required `build` check runs
 * every gate — including `npm test` — inside ONE step ("Run CI gates", .github/workflows/build.yml)
 * that carries the real VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY secrets as env (needed later in
 * that same step by the `vite build` / bundle-budget gates). vitest inherited them too, so
 * `purgeProjectFoldersFor` (site-planner/lib/storage.js) was posting live telemetry AND attempting
 * a live `project_folders` DELETE on every CI run — measured: 44 `project-folder-purge-failed`
 * events on 2026-09-19 alone, every one carrying build:"dev", url:"", user_id NULL — the test
 * suite's own signature, never a real user's.
 *
 * These tests reproduce the exact CI condition (real-looking production env vars present in the
 * process) rather than relying on this sandbox happening to have none configured, so a pass here
 * is a genuine proof rather than an artifact of local env being empty. They fail on the pre-fix
 * `site-planner/lib/supabase.js` / `food/lib/supabaseClient.js` (which read VITE_SUPABASE_URL /
 * VITE_SUPABASE_ANON_KEY unconditionally) and pass once each client refuses to configure whenever
 * import.meta.env.VITEST is set — a flag vitest itself sets and a test cannot spoof away merely by
 * re-stubbing the Supabase URL/key. */

const FAKE_PROD_URL = "https://fake-prod-project.supabase.co";
const FAKE_PROD_ANON = "fake-prod-anon-key";

async function freshModule(path) {
  vi.resetModules();
  return import(path);
}

describe("vitest must never configure a real Supabase client (B1843888)", () => {
  beforeEach(() => {
    // Simulate exactly what CI's shared "Run CI gates" step env hands every gate, `npm test`
    // included: real-looking project credentials, not blank ones. Proves the guard holds because
    // of WHAT it checks (import.meta.env.VITEST), not because these vars happen to be unset here.
    vi.stubEnv("VITE_SUPABASE_URL", FAKE_PROD_URL);
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", FAKE_PROD_ANON);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("the site-planner Supabase client stays unconfigured even with production-looking env vars", async () => {
    const mod = await freshModule("../src/workspaces/site-planner/lib/supabase.js");
    expect(mod.supabaseConfigured()).toBe(false);
    expect(mod.supabase).toBeNull();
    expect(mod.connectionInfo().configured).toBe(false);
    expect(mod.connectionInfo().url).toBe("(unset)");
    expect(mod.connectionInfo().rawUrl).toBe("(unset)");
    expect(mod.connectionInfo().keyLen).toBe(0);
    expect(mod.supabaseRest()).toEqual({ url: "", anon: "" });
  });

  it("the food workspace's own duplicate Supabase client stays unconfigured too", async () => {
    const mod = await freshModule("../src/workspaces/food/lib/supabaseClient.js");
    expect(mod.supabaseConfigured()).toBe(false);
    expect(mod.supabase).toBeNull();
  });

  it("reportClientEvent performs no network write under vitest, even with production-looking env vars", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { reportClientEvent } = await freshModule("../src/shared/telemetry/clientErrors.js");

    const outcome = await reportClientEvent(
      "test-event",
      "a probe event that must never reach a real Supabase project",
      { probe: true }
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("no-cloud");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("purgeProjectFoldersFor's folder purge never reaches Drive/Supabase under vitest", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { purgeProjectFolders } = await freshModule("../src/workspaces/library/lib/folders.js");

    const r = await purgeProjectFolders("fake-group-id-that-must-never-be-touched");

    expect(r).toEqual({ ok: true, skipped: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
