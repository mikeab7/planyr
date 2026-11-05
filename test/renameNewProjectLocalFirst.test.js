/* B1991041 follow-up — renaming a brand-new (never-drawn) project is LOCAL-FIRST.
 *
 * MEASURED LIVE 2026-10-08 on a slow network: the first version of the fix went through ensureProjectRow, which
 * makes a network round trip (the deleted-project check) BEFORE it saves anything. For the seconds that trip took,
 * the new name existed only on screen — a reload or closed tab in that window lost the project and the name
 * silently (2 of 7 live runs; the cloud row never landed and a reload said "this account doesn't have that
 * project"). The local record must be written in the same tick as the typed name, with the cloud HUNG.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let releaseUpsert;
vi.mock("../src/workspaces/site-planner/lib/cloudSync.js", async (orig) => {
  const real = await orig();
  return {
    ...real,
    // the cloud: hangs until the test releases it (a slow network)
    cloudUpsert: vi.fn(() => new Promise((res) => { releaseUpsert = () => res({ ok: true }); })),
  };
});
vi.mock("../src/workspaces/site-planner/lib/cloudRename.js", () => ({ cloudRenameGroup: vi.fn(async () => ({ ok: true })) }));

import { renameSiteGroup, loadSite, loadPlansOfGroup } from "../src/workspaces/site-planner/lib/storage.js";
import { setActiveUser } from "../src/workspaces/site-planner/lib/activeUser.js";
import { markProjectFreshlyMinted } from "../src/shared/projects/projectModel.js";
import { cloudUpsert } from "../src/workspaces/site-planner/lib/cloudSync.js";

beforeEach(() => {
  const store = {}; // Node has no localStorage — same minimal shim the other storage suites use
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
  cloudUpsert.mockClear();
  setActiveUser("00000000-0000-4000-8000-000000000001");
});

describe("renaming a freshly minted, never-drawn project while signed in", () => {
  it("writes the local record SYNCHRONOUSLY — before any cloud call resolves", () => {
    markProjectFreshlyMinted("gnew1");
    expect(loadSite("gnew1")).toBeNull();
    const pending = renameSiteGroup("gnew1", "My New Name"); // NOT awaited: the cloud is hung
    const local = loadSite("gnew1");
    expect(local, "the project must exist on this device the instant the name is typed").toBeTruthy();
    expect(local.site).toBe("My New Name");
    expect(loadPlansOfGroup("gnew1")).toHaveLength(1);
    expect(pending).toBeInstanceOf(Promise);
  });

  it("then pushes to the cloud and completes the group rename once the push lands", async () => {
    markProjectFreshlyMinted("gnew2");
    const pending = renameSiteGroup("gnew2", "Second");
    await vi.waitFor(() => expect(cloudUpsert).toHaveBeenCalledTimes(1));
    releaseUpsert();
    const res = await pending;
    expect(res.ok).toBe(true);
    expect(loadSite("gnew2").site).toBe("Second");
  });

  it("an id this device never minted stays the harmless no-op (nothing is created)", async () => {
    const res = await renameSiteGroup("ghost-id", "X");
    expect(loadSite("ghost-id")).toBeNull();
    expect(cloudUpsert).not.toHaveBeenCalled();
    expect(res.ok === false || res.ok === true).toBe(true);
  });

  it("a failed push keeps the local record and reports the failure (never a silent success)", async () => {
    cloudUpsert.mockImplementationOnce(() => Promise.resolve({ ok: false, error: "network down" }));
    markProjectFreshlyMinted("gnew3");
    const res = await renameSiteGroup("gnew3", "Kept");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/network down|couldn.t reach/i);
    expect(loadSite("gnew3").site).toBe("Kept");
  });
});
