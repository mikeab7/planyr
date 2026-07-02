import { describe, it, expect } from "vitest";
import { createStorageAdapter } from "../server/storage/adapter.js";
import { createIdMap, memoryIdStore } from "../server/storage/idMap.js";
import { createLinkProvider } from "../server/storage/linkProvider.js";
import { memoryBackend } from "../server/storage/backends/memoryBackend.js";
import { driveBackend } from "../server/storage/backends/driveBackend.js";
import { buildStorageAdapter } from "../server/storage/index.js";

const bytes = (s) => new TextEncoder().encode(s);

describe("storage adapter — core ops, Planyr-keys only (B206/NEW-1)", () => {
  const make = () => createStorageAdapter({ backend: memoryBackend() });

  it("saves, fetches, lists, renames, moves, removes by Planyr key", async () => {
    const a = make();
    const s = await a.save({ planyrKey: "katy/survey/alta.pdf", bytes: bytes("hello"), name: "alta.pdf", folder: "katy/survey" });
    expect(s.ok).toBe(true);
    expect(s.planyrKey).toBe("katy/survey/alta.pdf");

    const g = await a.fetch("katy/survey/alta.pdf");
    expect(g.ok).toBe(true);
    expect(new TextDecoder().decode(g.bytes)).toBe("hello");

    const l = await a.list({ folder: "katy/survey" });
    expect(l.ok).toBe(true);
    expect(l.items).toHaveLength(1);
    expect(l.items[0].planyrKey).toBe("katy/survey/alta.pdf");

    expect((await a.rename("katy/survey/alta.pdf", "ALTA Survey.pdf")).ok).toBe(true);
    expect((await a.move("katy/survey/alta.pdf", "katy/survey/superseded")).ok).toBe(true);
    expect((await a.remove("katy/survey/alta.pdf")).ok).toBe(true);
    expect((await a.fetch("katy/survey/alta.pdf")).ok).toBe(false); // gone
  });

  it("NEVER leaks a backend id — list items + results carry only Planyr keys", async () => {
    const a = make();
    await a.save({ planyrKey: "p/x.pdf", bytes: bytes("x"), name: "x.pdf" });
    const l = await a.list({});
    const keys = Object.keys(l.items[0]);
    expect(keys).toContain("planyrKey");
    expect(keys).not.toContain("backendId");
    expect(JSON.stringify(l.items[0])).not.toMatch(/mem_/); // no backend id string anywhere
  });

  it("a backend object with no Planyr binding is invisible to the app", async () => {
    const backend = memoryBackend();
    await backend.put({ bytes: bytes("orphan"), name: "orphan.pdf" }); // put straight on the backend, no adapter binding
    const a = createStorageAdapter({ backend });
    const l = await a.list({});
    expect(l.items).toHaveLength(0); // unbound backend object is dropped, not leaked
  });
});

describe("storage adapter — no silent failures (B209/NEW-4)", () => {
  it("an unmapped key fails visibly, never throws", async () => {
    const a = createStorageAdapter({ backend: memoryBackend() });
    for (const r of [await a.fetch("nope"), await a.remove("nope"), await a.move("nope", "x"), await a.rename("nope", "y"), await a.shareLink("nope")])
      { expect(r.ok).toBe(false); expect(typeof r.error).toBe("string"); }
  });

  it("a throwing backend becomes ok:false, not an exception", async () => {
    const boom = { name: "boom", put: () => { throw new Error("disk on fire"); } };
    const a = createStorageAdapter({ backend: boom });
    const r = await a.save({ planyrKey: "k", bytes: bytes("z") });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/disk on fire/);
  });

  it("a backend that returns ok:false propagates the failure (no false success)", async () => {
    const refusing = { name: "refusing", put: async () => ({ ok: false, error: "quota exceeded" }) };
    const a = createStorageAdapter({ backend: refusing });
    const r = await a.save({ planyrKey: "k", bytes: bytes("z") });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/quota exceeded/);
  });

  it("rolls the bytes back and fails honestly when the mapping write fails (NEW-4)", async () => {
    const removed = [];
    const backend = {
      name: "stub",
      put: async () => ({ ok: true, backendId: "drive_x" }),
      remove: async (id) => { removed.push(id); return { ok: true }; },
    };
    // a durable store that can't persist the mapping — the file would read back as "missing"
    const failingStore = { get: () => null, getByBackend: () => null, set: async () => ({ ok: false, error: "drive_files set 500" }), del: () => {}, all: () => [] };
    const a = createStorageAdapter({ backend, idMap: createIdMap(failingStore) });
    const r = await a.save({ planyrKey: "proj/x.pdf", bytes: bytes("x"), name: "x.pdf" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/couldn't record|rolled back/i);
    expect(removed).toEqual(["drive_x"]); // the just-saved bytes were rolled back — no orphan, no phantom "saved"
  });

  it("treats a legacy store whose set() returns nothing as success (back-compat, no false rollback)", async () => {
    const removed = [];
    const backend = { name: "stub", put: async () => ({ ok: true, backendId: "d1" }), remove: async (id) => { removed.push(id); return { ok: true }; } };
    const legacyStore = { get: () => null, getByBackend: () => null, set: () => undefined, del: () => {}, all: () => [] };
    const a = createStorageAdapter({ backend, idMap: createIdMap(legacyStore) });
    const r = await a.save({ planyrKey: "p/x.pdf", bytes: bytes("x") });
    expect(r.ok).toBe(true);
    expect(removed).toEqual([]); // no explicit {ok:false} → no rollback
  });
});

describe("storage adapter — backend is swappable with zero consumer changes (B206/NEW-1 acceptance)", () => {
  // A tiny "app consumer" written ONLY against the adapter API + Planyr keys.
  async function appFlow(adapter) {
    await adapter.save({ planyrKey: "proj/civil/grading.pdf", bytes: bytes("grading"), folder: "proj/civil" });
    const got = await adapter.fetch("proj/civil/grading.pdf");
    const listed = await adapter.list({ folder: "proj/civil" });
    return { text: new TextDecoder().decode(got.bytes), count: listed.items.length, key: listed.items[0].planyrKey };
  }
  it("identical observable behavior across two different backends", async () => {
    const r1 = await appFlow(createStorageAdapter({ backend: memoryBackend() }));
    // a second, independent stub backend with different internal ids
    const alt = (() => { const m = memoryBackend(); return { ...m, name: "alt" }; })();
    const r2 = await appFlow(createStorageAdapter({ backend: alt }));
    expect(r1).toEqual(r2);
    expect(r1.key).toBe("proj/civil/grading.pdf");
  });
});

describe("idMap — the only Planyr↔backend translator (B206/NEW-1)", () => {
  it("round-trips and unbinds", async () => {
    const m = createIdMap(memoryIdStore());
    await m.bind("planyr/a.pdf", "drive_123");
    expect(await m.resolve("planyr/a.pdf")).toBe("drive_123");
    expect(await m.reverse("drive_123")).toBe("planyr/a.pdf");
    await m.unbind("planyr/a.pdf");
    expect(await m.resolve("planyr/a.pdf")).toBe(null);
    expect(await m.reverse("drive_123")).toBe(null);
  });
});

describe("link provider — one place to switch link kinds (B208/NEW-3)", () => {
  it("drive kind returns the backend's native link", async () => {
    const backend = memoryBackend();
    const put = await backend.put({ bytes: bytes("x"), name: "x.pdf" });
    const lp = createLinkProvider({ kind: "drive", backend });
    const r = await lp.link("planyr/x.pdf", put.backendId);
    expect(r.ok).toBe(true);
    expect(r.url).toMatch(/^memory:\/\/share\//);
  });
  it("planyr kind mints a signed link via the injected signer — one-place switch", async () => {
    const lp = createLinkProvider({ kind: "planyr", signer: async (key) => ({ ok: true, url: `https://planyr.io/s/${encodeURIComponent(key)}` }) });
    const r = await lp.link("proj/civil/grading.pdf", "ignored-backend-id");
    expect(r.ok).toBe(true);
    expect(r.url).toBe("https://planyr.io/s/proj%2Fcivil%2Fgrading.pdf");
  });
  it("planyr kind without a signer fails visibly (not configured)", async () => {
    const r = await createLinkProvider({ kind: "planyr" }).link("k", "b");
    expect(r.ok).toBe(false);
  });
  it("adapter.shareLink round-trips a mapped file to its link (what /api/files/share exposes)", async () => {
    const a = createStorageAdapter({ backend: memoryBackend() });
    await a.save({ planyrKey: "proj/civil/grading.pdf", bytes: bytes("g"), name: "grading.pdf" });
    const r = await a.shareLink("proj/civil/grading.pdf");
    expect(r.ok).toBe(true);
    expect(r.url).toMatch(/^memory:\/\/share\//);
  });
});

describe("drive backend — scaffold reports 'not connected' until creds (B207/NEW-2)", () => {
  it("every op fails clearly when no client is provided, and never throws", async () => {
    const d = driveBackend({});
    expect(d.configured).toBe(false);
    for (const r of [
      await d.put({ bytes: bytes("x"), name: "x" }),
      await d.get("id"), await d.list({}), await d.move("id", "f"),
      await d.rename("id", "n"), await d.remove("id"), await d.shareLink("id"),
    ]) { expect(r.ok).toBe(false); expect(r.error).toMatch(/isn't connected|not connected|enable filing/i); }
  });
  it("with a stub client, put returns a backend id (proves the fill-in seam)", async () => {
    const client = {
      folderId: async () => "folder1",
      create: async () => ({ id: "drive_abc" }),
    };
    const d = driveBackend({ client });
    expect(d.configured).toBe(true);
    const r = await d.put({ bytes: bytes("x"), name: "x.pdf", folder: "proj/civil" });
    expect(r.ok).toBe(true);
    expect(r.backendId).toBe("drive_abc");
  });
  it("with a stub client, shareLink returns Drive's native webViewLink (B208 default)", async () => {
    const client = { permitAnyoneReader: async (id) => ({ webViewLink: `https://drive.google.com/file/d/${id}/view` }) };
    const d = driveBackend({ client });
    const r = await d.shareLink("drive_abc");
    expect(r.ok).toBe(true);
    expect(r.url).toBe("https://drive.google.com/file/d/drive_abc/view");
  });
});

describe("assembly — buildStorageAdapter (B206)", () => {
  it("defaults to the memory backend when Drive isn't configured", () => {
    const a = buildStorageAdapter({ backend: "memory", linkKind: "drive" });
    expect(a.backendName).toBe("memory");
    expect(a.linkKind).toBe("drive");
  });
  it("selects the drive backend (still 'not connected' without a client factory)", async () => {
    const a = buildStorageAdapter({ backend: "drive", linkKind: "drive", drive: {} });
    expect(a.backendName).toBe("drive");
    const r = await a.save({ planyrKey: "k", bytes: bytes("z") }); // no client → visible failure, no throw
    expect(r.ok).toBe(false);
  });
});
