import { describe, it, expect } from "vitest";
import { slimForCloud, headerSig, siteRowFor } from "../src/workspaces/site-planner/lib/cloudSync.js";
import { reviewRowFor } from "../src/workspaces/doc-review/lib/reviewStore.js";

// B692 — the share-revert clobber class. Sharing lives in the team_id COLUMN, set ONLY by the
// explicit share/unshare flow (lib/sharing.js) and overlaid back onto models at read time. An
// ordinary content save must therefore NEVER carry the sharing pointer: a tab whose in-memory
// model predates a share would push its stale teamId (null) and silently unshare the project —
// exactly the live failure (share landed, the collaborator saw the site, then the owner's next
// autosave reverted team_id to null and locked them out: red cloud, elements gone, no toasts).
// These tests pin the rule for every writer: sites CAS + keepalive (siteRowFor), doc_reviews
// CAS + keepalive (reviewRowFor), and the slim jsonb itself.

const model = (over = {}) => ({
  id: "s1", groupId: "g1", site: "Goose Creek", name: "Plan 1", county: "Harris",
  updatedAt: 1000, teamId: "team-A", ownerId: "owner-uid",
  els: [{ id: "e1", z: 0 }], markups: [], measures: [], callouts: [], parcels: [],
  settings: { grid: true },
  ...over,
});

describe("siteRowFor — sites content pushes can't touch sharing", () => {
  it("an ordinary UPDATE row has NO team_id key at all (absent, not null)", () => {
    const row = siteRowFor(slimForCloud(model()));
    expect("team_id" in row).toBe(false);
    expect(row.id).toBe("s1");
    expect(row.group_id).toBe("g1");
  });

  it("a brand-new row (isNew) stamps the model's teamId so a plan born in a shared project is born shared", () => {
    const row = siteRowFor(slimForCloud(model()), { isNew: true, teamId: "team-A" });
    expect(row.team_id).toBe("team-A");
    const priv = siteRowFor(slimForCloud(model({ teamId: null })), { isNew: true, teamId: null });
    expect(priv.team_id).toBeNull();
  });
});

describe("slimForCloud — the stored jsonb carries no sharing pointers", () => {
  it("strips teamId and ownerId (the columns are the source of truth, overlaid on read)", () => {
    const slim = slimForCloud(model());
    expect("teamId" in slim).toBe(false);
    expect("ownerId" in slim).toBe(false);
    expect(slim.site).toBe("Goose Creek"); // real header content intact
  });

  it("never mutates the input model (the canvas copy keeps its share badge)", () => {
    const m = model();
    slimForCloud(m);
    expect(m.teamId).toBe("team-A");
    expect(m.ownerId).toBe("owner-uid");
  });
});

describe("headerSig — share state can't defeat the unchanged-header skip", () => {
  it("is identical across teamId/ownerId differences (a share/unshare isn't 'content')", () => {
    expect(headerSig(model({ teamId: "team-A" }))).toBe(headerSig(model({ teamId: null })));
    expect(headerSig(model({ ownerId: "x" }))).toBe(headerSig(model({ ownerId: "y" })));
  });

  it("still changes on real header content", () => {
    expect(headerSig(model({ site: "Renamed" }))).not.toBe(headerSig(model()));
  });
});

describe("reviewRowFor — doc_reviews content pushes can't touch sharing", () => {
  const record = { id: "rv1", title: "T", kind: "pdf", project: "Goose Creek", discipline: "Civil", updatedAt: 1000, teamId: "team-A" };

  it("an ordinary UPDATE row has NO team_id key (CAS autosave + the unload keepalive)", () => {
    const row = reviewRowFor(record);
    expect("team_id" in row).toBe(false);
    expect(row.id).toBe("rv1");
    expect(row.data.teamId).toBe("team-A"); // the jsonb still round-trips every field; only the COLUMN is protected
  });

  it("a brand-new row stamps the record's teamId (born shared inside a shared project)", () => {
    expect(reviewRowFor(record, { isNew: true }).team_id).toBe("team-A");
    expect(reviewRowFor({ ...record, teamId: null }, { isNew: true }).team_id).toBeNull();
  });
});
