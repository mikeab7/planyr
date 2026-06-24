import { describe, it, expect, beforeEach } from "vitest";
import {
  cacheSourceBytes, getSourceBytes, hasSourceBytes, _clearSessionBytes, SESSION_BYTES_CAP,
} from "../src/workspaces/doc-review/lib/sessionBytes.js";

// B448 — the dropped bytes kept in memory keyed by srcId so a switch/reload mid-upload (source
// still keyless) never loses the backdrop. A File re-reads cleanly; a worker-detached ArrayBuffer
// would not, which is why only the File reference is held — these tests pin the cache contract.
const fakeFile = (name) => ({ name, _blob: true }); // a stand-in File reference (identity matters)

describe("sessionBytes — dropped-bytes session cache (B448)", () => {
  beforeEach(() => _clearSessionBytes());

  it("returns the exact File reference that was cached, by srcId", () => {
    const f = fakeFile("a.pdf");
    cacheSourceBytes("s1", f);
    expect(getSourceBytes("s1")).toBe(f);
    expect(hasSourceBytes("s1")).toBe(true);
  });

  it("a source never dropped this session is a miss (so the caller falls back to cloud)", () => {
    cacheSourceBytes("s1", fakeFile("a.pdf"));
    expect(getSourceBytes("s2")).toBe(undefined);
    expect(hasSourceBytes("s2")).toBe(false);
  });

  it("ignores empty keys / files (never caches a null)", () => {
    cacheSourceBytes("", fakeFile("x.pdf"));
    cacheSourceBytes("s1", null);
    expect(getSourceBytes("")).toBe(undefined);
    expect(hasSourceBytes("s1")).toBe(false);
  });

  it("re-caching a key refreshes recency so it survives eviction", () => {
    // Fill to capacity, then re-touch the oldest, then push one more: the re-touched key must stay.
    for (let i = 0; i < SESSION_BYTES_CAP; i++) cacheSourceBytes(`s${i}`, fakeFile(`${i}.pdf`));
    cacheSourceBytes("s0", fakeFile("0-again.pdf")); // refresh s0's recency (now most-recent)
    cacheSourceBytes("sNew", fakeFile("new.pdf"));   // evicts the now-oldest (s1), NOT s0
    expect(hasSourceBytes("s0")).toBe(true);
    expect(hasSourceBytes("s1")).toBe(false);
    expect(hasSourceBytes("sNew")).toBe(true);
  });

  it("is bounded — never holds more than the cap (FIFO eviction)", () => {
    for (let i = 0; i < SESSION_BYTES_CAP + 5; i++) cacheSourceBytes(`k${i}`, fakeFile(`${i}.pdf`));
    let held = 0;
    for (let i = 0; i < SESSION_BYTES_CAP + 5; i++) if (hasSourceBytes(`k${i}`)) held++;
    expect(held).toBe(SESSION_BYTES_CAP);
    // the most-recent are the ones kept; the earliest are evicted
    expect(hasSourceBytes("k0")).toBe(false);
    expect(hasSourceBytes(`k${SESSION_BYTES_CAP + 4}`)).toBe(true);
  });
});
