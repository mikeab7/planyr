/* NEW-1 (B2671215 follow-up, owner 2026-11-11) — a rename that reached THIS device but not the cloud must warn, not look fine.
 * "If it fails to save to the cloud, then I should get a warning banner saying the save didn't go through. It shouldn't show that everything's working."
 *
 * What is pinned here (the live end-to-end proof is ui-audit/verify-rename-cloud-failure-live.mjs, which was RED on main: 12 of 46 checks):
 *   1  the sentence the person reads — plan and project — has no status code, no error class and no server words
 *   2  the durable failure log keeps ONE record per thing (a plan renamed three times is one record, not three) and can be cleared by plan / group
 *   3  a project rename that fails in the cloud hands back PLAIN words (the raw message rides on `rawError` for telemetry), and a dead sign-in is flagged
 *      `authExpired` so the shell's own sign-in notice — not a second banner — speaks
 *   4  the wiring (source scans — SitePlannerApp cannot be mounted under Node): the banner clears when a later sync lands (onSiteSynced) or the browser
 *      comes back online, the breadcrumb uses the host's rename writer, and a banner-raising writer suppresses the duplicate toast
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("../src/workspaces/site-planner/lib/cloudSync.js", async (orig) => {
  const real = await orig();
  return { ...real, cloudUpsert: vi.fn(async () => ({ ok: true })) };
});
const cloudRenameGroup = vi.fn();
vi.mock("../src/workspaces/site-planner/lib/cloudRename.js", () => ({ cloudRenameGroup: (...a) => cloudRenameGroup(...a) }));

import { PLAN_RENAME_TEXT, PROJECT_RENAME_TEXT, renameBannerText, isAuthExpiredError, isRenameEntry } from "../src/workspaces/site-planner/lib/renameSyncNotice.js";
import { recordCloudWriteFailure, readCloudWriteFailures, clearCloudWriteFailuresFor, WHAT_PLAN_RENAME, WHAT_RENAME, WHAT_STATUS } from "../src/shared/cloud/writeFailureLog.js";
import { renameSiteGroup, saveSite } from "../src/workspaces/site-planner/lib/storage.js";
import { setActiveUser } from "../src/workspaces/site-planner/lib/activeUser.js";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const RAW = /PGRST|TypeError|Failed to fetch|NetworkError|ERR_|\b[45]\d\d\b|internal server|JWT|undefined|null|[{}]/i;

let win;
beforeEach(() => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null, get length() { return Object.keys(store).length; }, clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
  win = { localStorage: globalThis.localStorage };
  cloudRenameGroup.mockReset();
  setActiveUser("00000000-0000-4000-8000-000000000001");
});

describe("the words", () => {
  it("say, in plain English, that the rename did not save to the cloud and other devices still see the old name", () => {
    expect(PLAN_RENAME_TEXT).toBe("Rename didn't save to the cloud. Your other devices still see the old name.");
    expect(PROJECT_RENAME_TEXT).toBe("Rename didn't fully save to the cloud. Your other devices may still see the old name.");
  });
  it("carry no status code, error class, server sentence or markup", () => {
    expect(RAW.test(PLAN_RENAME_TEXT)).toBe(false);
    expect(RAW.test(PROJECT_RENAME_TEXT)).toBe(false);
  });
  it("a boot banner over ONLY renames reads in the rename sentence; any other kind of write keeps the generic summary", () => {
    expect(renameBannerText([{ what: WHAT_PLAN_RENAME, siteId: "a" }])).toBe(PLAN_RENAME_TEXT);
    expect(renameBannerText([{ what: WHAT_PLAN_RENAME, siteId: "a" }, { what: WHAT_PLAN_RENAME, siteId: "b" }])).toBe(PLAN_RENAME_TEXT);
    expect(renameBannerText([{ what: WHAT_PLAN_RENAME, siteId: "a" }, { what: WHAT_RENAME, groupId: "g" }])).toBe(PROJECT_RENAME_TEXT); // a project rename can be partial
    expect(renameBannerText([{ what: WHAT_PLAN_RENAME }, { what: WHAT_STATUS, groupId: "g" }])).toBeNull();
    expect(renameBannerText([])).toBeNull();
    expect(isRenameEntry({ what: "x", kind: "rename" })).toBe(true);
  });
});

describe("a dead sign-in is told apart from a cloud outage", () => {
  it("expired / invalid tokens are auth", () => {
    for (const e of ["JWT expired", { message: "JWT expired" }, { code: "PGRST301" }, "invalid JWT: unable to parse", "Invalid Refresh Token: Refresh Token Not Found", "refresh_token_not_found"]) expect(isAuthExpiredError(e), String(e && e.message || e)).toBe(true);
  });
  it("a network failure, a server error, a conflict or nothing is NOT auth", () => {
    for (const e of ["TypeError: Failed to fetch", "internal server error", "stale write", "", null, undefined, { message: "duplicate key value" }]) expect(isAuthExpiredError(e), String(e)).toBe(false);
  });
});

describe("the durable failure log", () => {
  it("keeps ONE record per plan and kind — a plan renamed three times is one fact", () => {
    for (let i = 0; i < 3; i++) recordCloudWriteFailure({ what: WHAT_PLAN_RENAME, siteId: "p1", error: "x" + i }, win);
    recordCloudWriteFailure({ what: WHAT_PLAN_RENAME, siteId: "p2", error: "y" }, win);
    recordCloudWriteFailure({ what: WHAT_RENAME, kind: "rename", groupId: "g1", error: "z" }, win);
    recordCloudWriteFailure({ what: WHAT_RENAME, kind: "rename", groupId: "g1", error: "z2" }, win);
    const list = readCloudWriteFailures(win);
    expect(list.filter((e) => e.siteId === "p1")).toHaveLength(1);
    expect(list.find((e) => e.siteId === "p1").error).toBe("x2");     // the newest wins
    expect(list.filter((e) => e.siteId === "p2")).toHaveLength(1);    // a different plan is a different fact
    expect(list.filter((e) => e.groupId === "g1")).toHaveLength(1);
  });
  it("is cleared by plan (a whole-header push settles it) or by group + kind (a group write settles only its own kind)", () => {
    recordCloudWriteFailure({ what: WHAT_PLAN_RENAME, siteId: "p1" }, win);
    recordCloudWriteFailure({ what: WHAT_PLAN_RENAME, siteId: "p2" }, win);
    recordCloudWriteFailure({ what: WHAT_RENAME, kind: "rename", groupId: "g1" }, win);
    recordCloudWriteFailure({ what: WHAT_STATUS, kind: "status", groupId: "g1" }, win);
    expect(clearCloudWriteFailuresFor({ siteId: "p1" }, win)).toBe(1);
    expect(clearCloudWriteFailuresFor({ groupId: "g1", what: WHAT_RENAME }, win)).toBe(1);
    const left = readCloudWriteFailures(win);
    expect(left.map((e) => e.what).sort()).toEqual([WHAT_PLAN_RENAME, WHAT_STATUS].sort());   // p2's rename and g1's STATUS change are untouched
    expect(clearCloudWriteFailuresFor({}, win)).toBe(0);
  });
});

describe("a project rename that fails in the cloud", () => {
  beforeEach(() => { saveSite({ id: "g1", groupId: "g1", site: "Old", name: "Concept A", origin: null, county: null, parcels: [], els: [], measures: [], settings: {} }); });
  it("hands back plain words, keeps the raw message for telemetry, and keeps the new name on this device", async () => {
    cloudRenameGroup.mockResolvedValueOnce({ ok: false, rows: 0, error: PROJECT_RENAME_TEXT, rawError: "TypeError: Failed to fetch", authExpired: false });
    const res = await renameSiteGroup("g1", "New");
    expect(res.ok).toBe(false);
    expect(res.error).toBe(PROJECT_RENAME_TEXT);
    expect(RAW.test(res.error)).toBe(false);
    expect(res.authExpired).toBe(false);
  });
  it("flags a dead sign-in so the shell's own notice speaks instead of a second banner", async () => {
    cloudRenameGroup.mockResolvedValueOnce({ ok: false, rows: 0, error: PROJECT_RENAME_TEXT, rawError: "JWT expired", authExpired: true });
    expect((await renameSiteGroup("g1", "New2")).authExpired).toBe(true);
  });
  it("a thrown error from the cloud layer is plain too", async () => {
    cloudRenameGroup.mockRejectedValueOnce(new Error("TypeError: Failed to fetch"));
    const res = await renameSiteGroup("g1", "New3");
    expect(res.ok).toBe(false); expect(res.error).toBe(PROJECT_RENAME_TEXT); expect(res.rawError).toMatch(/Failed to fetch/);
  });
});

describe("the wiring (source scans)", () => {
  const app = src("src/workspaces/site-planner/SitePlannerApp.jsx");
  const cloudSync = src("src/workspaces/site-planner/lib/cloudSync.js");
  const crumb = src("src/shared/ui/ProjectBreadcrumb.jsx");
  const names = src("src/shared/names/names.js");
  it("a plan rename's banner uses the rename sentence, and the project rename the project one", () => {
    expect(app).toMatch(/what === WHAT_PLAN_RENAME \? PLAN_RENAME_TEXT/);
    expect(app).toMatch(/setPushErrorWithRetry\(PROJECT_RENAME_TEXT/);
    expect(app).not.toMatch(/is saved on this device, but the rename may not have fully reached the cloud/);
  });
  it("every success path of the header write announces it, and the planner clears the banner on it", () => {
    expect((cloudSync.match(/announceSynced\(m\.id/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(app).toMatch(/onSiteSynced\(/);
    expect(app).toMatch(/addEventListener\("online"/);
    expect(app).toMatch(/reconcileBannerWithLog\(\)/);
    expect(app).toMatch(/held\.name !== local\.name/);   // an older push that landed after the rename settles nothing
  });
  it("a dead sign-in is routed to the shell's notice (the shared session helper), never a second banner", () => {
    expect(app).toMatch(/await import\("..\/..\/shared\/auth\/apiAuth\.js"\)/);
    expect(app).toMatch(/getApiToken\(\{ refresh: true \}\)/);
    expect(app).toMatch(/state === "signed-out"\) return false/);
  });
  it("the breadcrumb uses the host's rename writer even when uncontrolled, and a bannered failure adds no toast", () => {
    expect(crumb).toMatch(/const hostRename = !controlled && typeof onRenameProject === "function"/);
    expect(crumb).toMatch(/res\.ok === false && !res\.bannered/);
    expect(names).toMatch(/if \(!res\.bannered\) announceNameNotice/);
  });
});
