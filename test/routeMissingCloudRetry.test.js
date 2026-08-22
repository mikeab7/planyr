/* NEW-3 (owner report 2026-08-22) — a deep link to a project the signed-in user OWNS, but whose
 * local cache is cold (created on another device, or never pulled), used to render the
 * "this account doesn't have it open here" banner permanently. `routeProjectAvailability` only
 * ever asks the LOCAL cache, and the only thing that fills it is the one bulk `pullCloud` sign-in
 * runs — so a project outside that one pull's timing was permanently unreachable by deep link.
 *
 * Fix: before showing the banner for a signed-in user, retry ONE fresh cloud pull for exactly this
 * project id, guarded so a genuinely-gone id only retries once. This is a SOURCE guard (mirrors
 * parcelClickRouting.test.js / handleLayerOrder.test.js) because standing up the full signed-in
 * Supabase + Leaflet boot sequence is a live-verify concern (auth is blocked in this sandbox), but
 * the WIRING — that a fresh pull is attempted before the banner is trusted — is a real, checkable
 * property of the source.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SP = readFileSync(join(here, "../src/workspaces/site-planner/SitePlannerApp.jsx"), "utf8");

const start = SP.indexOf("const routeMissingRetryRef = useRef(new Set());");
const end = SP.indexOf("}, [projectId, sites, bootResolved, signedInUid]);");
if (start < 0 || end < 0) throw new Error("routeMissingCloudRetry.test.js: the route-availability effect moved — update the slice");
const region = SP.slice(start, end + 60);

describe("NEW-3: a deep link to an owned-but-uncached project retries the cloud before giving up", () => {
  it("retries a fresh cloud pull for a signed-in user before showing the not-found banner", () => {
    expect(region.includes("signedInUid && !routeMissingRetryRef.current.has(projectId)")).toBe(true);
    expect(region.includes("pullCloud(signedInUid)")).toBe(true);
    expect(region.includes("refreshSites()")).toBe(true);
  });

  it("retries at most once per project id (never loops on a genuinely-gone id)", () => {
    expect(region.includes("routeMissingRetryRef.current.add(projectId)")).toBe(true);
  });

  it("the effect re-evaluates once the retry's pull lands (signedInUid is a real dependency)", () => {
    expect(SP.includes("}, [projectId, sites, bootResolved, signedInUid]);")).toBe(true);
  });

  it("only falls back to the not-found banner when not signed in or already retried", () => {
    const bannerIdx = region.indexOf("setRouteMissing(projectId); setActiveSiteId(null); setMode(\"map\");");
    const retryIdx = region.indexOf("routeMissingRetryRef.current.add(projectId)");
    expect(bannerIdx).toBeGreaterThan(-1);
    expect(retryIdx).toBeGreaterThan(-1);
    expect(bannerIdx).toBeGreaterThan(retryIdx); // the banner is the ELSE of the retry check, not a parallel path
  });
});
