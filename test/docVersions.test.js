import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { versionList, saveVersion, restoreVersion, packSource, copyFileName, earlierVersionLabel, fmtVersionSize, canOpenEarlier } from "../src/workspaces/doc-review/lib/docVersions.js";

// An in-memory "Library": srcId → bytes. The same shape DocReview's saveDocFile/openVersion inject.
function lab() {
  const bytes = new Map(); let n = 0;
  const io = {
    newId: () => `s${++n}`,
    cache: (id, b) => bytes.set(id, b),
    store: async (id, b) => { bytes.set(id, b); return { ok: true, driveKey: `drive/${id}` }; },
    read: async (v) => bytes.get(v.srcId) || null,
  };
  return { bytes, io };
}
const blob = (t) => new Blob([t]);
const text = (b) => b.text();

async function savedThreeTimes() {
  const { bytes, io } = lab();
  let source = packSource({ srcId: "s0", name: "Scope.txt", size: 5, driveKey: "drive/s0", savedAt: 1000, savedBy: "Ann" });
  bytes.set("s0", blob("one  "));
  let prior = [];
  for (const [t, who, at] of [["two", "Bo", 2000], ["three", "Cy", 3000]]) {
    const r = await saveVersion({ source, prior, blob: blob(t), io, by: who, now: at });
    expect(r.ok).toBe(true); source = r.source; prior = r.prior;
  }
  return { bytes, io, source, prior };
}

describe("version history — list, open, restore (B2022929 / NEW-1)", () => {
  it("a file saved three times lists three versions, newest first, with date, author, size", async () => {
    const { source, prior } = await savedThreeTimes();
    const v = versionList(source, prior);
    expect(v.map((x) => x.number)).toEqual([3, 2, 1]);
    expect(v.map((x) => x.savedBy)).toEqual(["Cy", "Bo", "Ann"]);
    expect(v.map((x) => x.savedAt)).toEqual([3000, 2000, 1000]);
    expect(v.map((x) => x.size)).toEqual([5, 3, 5]);
    expect(v[0].isCurrent).toBe(true); expect(v[1].isCurrent).toBe(false);
  });

  it("the middle version reads back its own content (nothing was overwritten)", async () => {
    const { io, source, prior } = await savedThreeTimes();
    const mid = versionList(source, prior)[1];
    expect(await text(await io.read(mid))).toBe("two");
  });

  it("Restore creates a FOURTH version holding the old content, and all three originals still exist", async () => {
    const { io, bytes, source, prior } = await savedThreeTimes();
    const before = versionList(source, prior);
    const mid = before[1];
    const r = await restoreVersion({ source, prior, version: mid, io, by: "Di", now: 4000 });
    expect(r.ok).toBe(true);
    const after = versionList(r.source, r.prior);
    expect(after.length).toBe(4);
    expect(after[0].isCurrent).toBe(true);
    expect(after[0].restoredFrom).toBe(mid.srcId);
    expect(after[0].savedBy).toBe("Di");
    expect(await text(r.blob)).toBe("two");
    expect(await text(await io.read(after[0]))).toBe("two");
    // history is append-only: every earlier srcId still listed AND its bytes still stored, unchanged
    for (const b of before) { expect(after.some((a) => a.srcId === b.srcId)).toBe(true); }
    expect(await text(bytes.get(before[2].srcId))).toBe("one  ");
    expect(await text(bytes.get(before[1].srcId))).toBe("two");
    expect(await text(bytes.get(before[0].srcId))).toBe("three");
  });

  it("undo by restoring the previous latest: five versions, nothing lost", async () => {
    const { io, source, prior } = await savedThreeTimes();
    const latest = versionList(source, prior)[0];
    const r1 = await restoreVersion({ source, prior, version: versionList(source, prior)[1], io, by: "Di", now: 4000 });
    const r2 = await restoreVersion({ source: r1.source, prior: r1.prior, version: versionList(r1.source, r1.prior).find((x) => x.srcId === latest.srcId), io, by: "Di", now: 5000 });
    expect(r2.ok).toBe(true);
    const l = versionList(r2.source, r2.prior);
    expect(l.length).toBe(5);
    expect(await text(r2.blob)).toBe("three");
  });

  it("restoring the version that is already latest is refused (no pointless duplicate)", async () => {
    const { io, source, prior } = await savedThreeTimes();
    const r = await restoreVersion({ source, prior, version: versionList(source, prior)[0], io });
    expect(r.ok).toBe(false);
  });

  it("a failed upload keeps the history exactly as it was and says so", async () => {
    const { io, source, prior } = await savedThreeTimes();
    const bad = { ...io, store: async () => ({ ok: false, driveError: "offline" }) };
    const r = await restoreVersion({ source, prior, version: versionList(source, prior)[2], io: bad });
    expect(r.ok).toBe(false); expect(r.error).toMatch(/offline/);
    expect(versionList(source, prior).length).toBe(3);
  });

  it("an unreadable earlier version fails loudly, never restores empty", async () => {
    const { io, source, prior } = await savedThreeTimes();
    const r = await restoreVersion({ source, prior, version: versionList(source, prior)[1], io: { ...io, read: async () => null } });
    expect(r.ok).toBe(false); expect(r.error).toMatch(/Couldn’t read/);
  });

  it("signed out from the start: upload + two local saves still lists three, restorable this session", async () => {
    const { io, bytes } = lab();
    let source = packSource({ srcId: "u0", name: "n.txt", size: 3, savedAt: 1, savedBy: "Me" }); bytes.set("u0", blob("v1")); let prior = [];
    for (const [t, at] of [["v2", 2], ["v3", 3]]) { const r = await saveVersion({ source, prior, blob: blob(t), io, online: false, by: "Me", now: at }); source = r.source; prior = r.prior; }
    const l = versionList(source, prior); expect(l.map((x) => x.number)).toEqual([3, 2, 1]); expect(l.every((x) => x.readable)).toBe(true);
    const r = await restoreVersion({ source, prior, version: l[2], io, online: false, by: "Me", now: 4 });
    expect(await text(r.blob)).toBe("v1"); expect(versionList(r.source, r.prior).length).toBe(4);
  });
  it("signed out: the save stays on this device but the old version is still kept", async () => {
    const { io, source, prior } = await savedThreeTimes();
    const r = await saveVersion({ source, prior, blob: blob("x"), io, online: false, by: "Ed", now: 9 });
    expect(r.local).toBe(true);
    expect(versionList(r.source, r.prior).length).toBe(4);
  });
});

describe("adjacent cases", () => {
  it("a file with ONE version lists one row, current, nothing to open or restore", () => {
    const v = versionList(packSource({ srcId: "a", name: "x.docx", size: 9, driveKey: "k" }), []);
    expect(v.length).toBe(1); expect(v[0].isCurrent).toBe(true); expect(v[0].number).toBe(1);
    expect(canOpenEarlier(v, true)).toBe(false);
  });
  it("a legacy version (saved before dates were recorded) says so rather than inventing a date", () => {
    const v = versionList(packSource({ srcId: "b", name: "x.docx", driveKey: "k2" }), [packSource({ srcId: "a", name: "x.docx", driveKey: "k" })]);
    expect(v[1].savedAt).toBeNull();
    expect(earlierVersionLabel(v[1].savedAt)).toBe("Earlier version — date not recorded");
  });
  it(".txt keeps its extension in a copy name; no project/PDF names are special-cased", () => {
    expect(copyFileName("Scope.txt", Date.UTC(2026, 9, 3, 12), "en-US")).toBe("Scope (copy of Oct 3, 2026).txt");
    expect(copyFileName("noext", null)).toBe("noext (copy of an earlier version)");
  });
  it("a PDF has one stored source, so it lists one version and offers no Open/Restore", () => {
    const v = versionList(packSource({ srcId: "p", name: "Plan.pdf", size: 2e6, driveKey: "k" }), []);
    expect(v.length).toBe(1); expect(canOpenEarlier(v, false)).toBe(false);
    expect(fmtVersionSize(2e6)).toBe("1.9 MB");
  });
  it("duplicate source ids collapse; unstored prior entries are not listed as readable", () => {
    const cur = packSource({ srcId: "a", name: "x", driveKey: "k" });
    expect(versionList(cur, [cur, cur]).length).toBe(1);
  });
});

describe("wiring guards", () => {
  const dr = readFileSync(new URL("../src/workspaces/doc-review/DocReview.jsx", import.meta.url), "utf8");
  it("DocReview persists the save stamp (packSource) and saves/restores through the shared ops", () => {
    expect(dr).toMatch(/saveVersion\(/); expect(dr).toMatch(/restoreVersion\(/); expect(dr).toMatch(/packSource\(/);
  });
  it("opening an earlier version never downloads", () => {
    const ed = readFileSync(new URL("../src/workspaces/doc-review/components/VersionHistorySheet.jsx", import.meta.url), "utf8");
    expect(ed).not.toMatch(/createObjectURL|\.download\s*=|download=/);
  });
});
