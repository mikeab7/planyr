import { describe, it, expect } from "vitest";
import {
  CLOUD_FILE_LIMIT_MB, classifySource, sourceUnavailableMessage, fileWarn,
} from "../src/workspaces/doc-review/lib/sourceState.js";

// The bug B405 fixes: every open failure collapsed into one "Couldn't fetch …" string, and a
// missing source returned SILENTLY (no banner). These assert each cause is now distinct.
describe("classifySource — distinct unavailable states (B405)", () => {
  it("a fetchable source (has a storage key) returns null", () => {
    expect(classifySource({ name: "A", storageKey: "u/x.pdf" })).toBe(null);
    expect(classifySource({ name: "A", driveKey: "p/x.pdf" })).toBe(null);
  });
  it("oversize wins even if a key is somehow present", () => {
    expect(classifySource({ name: "Big", oversize: true })).toBe("oversize");
    expect(classifySource({ name: "Big", oversize: true, storageKey: "k" })).toBe("oversize");
  });
  it("a source with NO key was never durably stored → not-stored (was the silent path)", () => {
    expect(classifySource({ name: "A", storageKey: null, driveKey: null })).toBe("not-stored");
  });
  it("a missing source object is not-stored, never a silent return", () => {
    expect(classifySource(null)).toBe("not-stored");
    expect(classifySource(undefined)).toBe("not-stored");
  });
  it("signed-out trumps not-stored when the cloud copy can't be read at all", () => {
    expect(classifySource(null, { signedIn: false })).toBe("signed-out");
    expect(classifySource({ name: "A", storageKey: null }, { signedIn: false })).toBe("signed-out");
  });
  it("a keyed source is still fetchable while signed out (the fetch itself decides)", () => {
    expect(classifySource({ name: "A", storageKey: "k" }, { signedIn: false })).toBe(null);
  });
});

describe("sourceUnavailableMessage — precise, durable, distinct copy (B405)", () => {
  const msg = (s) => sourceUnavailableMessage(s, { name: "Civil C-100" });
  it("names the 50 MB cap for oversize (durable — no 'coming soon')", () => {
    const m = msg("oversize");
    expect(m).toContain(`${CLOUD_FILE_LIMIT_MB} MB`);
    expect(m).toMatch(/per-file cloud limit/);
    expect(m).not.toMatch(/coming soon/i);
  });
  it("not-stored tells the user to re-open to UPLOAD", () => {
    expect(msg("not-stored")).toMatch(/wasn’t stored/);
    expect(msg("not-stored")).toMatch(/upload/);
  });
  it("signed-out tells the user to sign in", () => {
    expect(msg("signed-out")).toMatch(/Sign in/);
  });
  it("fetch-failed reads as transient/retryable, not as a missing file", () => {
    const m = msg("fetch-failed");
    expect(m).toMatch(/just now/);
    expect(m).not.toMatch(/wasn’t stored/);
  });
  it("every state reassures that markups are saved, and names the file", () => {
    for (const s of ["oversize", "not-stored", "signed-out", "fetch-failed"]) {
      expect(sourceUnavailableMessage(s, { name: "Civil C-100" })).toContain("Civil C-100");
      expect(sourceUnavailableMessage(s, { name: "Civil C-100" })).toMatch(/markups are saved|Sign in/);
    }
  });
  it("the four states produce four different messages", () => {
    const set = new Set(["oversize", "not-stored", "signed-out", "fetch-failed"].map((s) => msg(s)));
    expect(set.size).toBe(4);
  });
});

describe("fileWarn — the Files-browser / drawer queue warn mirrors the taxonomy", () => {
  it("oversize names the cap; clean store warns nothing", () => {
    expect(fileWarn({ oversize: true })).toMatch(new RegExp(`${CLOUD_FILE_LIMIT_MB} MB`));
    expect(fileWarn({})).toBe(null);
  });
  it("upload-failed → re-open to upload; drive-copy-failed is non-fatal", () => {
    expect(fileWarn({ uploadFailed: true })).toMatch(/re-open to upload/);
    expect(fileWarn({ driveError: true })).toMatch(/Drive copy failed/);
  });
  it("upload-failed surfaces the CONCRETE cause when the store path handed one back (B409)", () => {
    // "re-open to upload" can't fix a full Drive — the real message must reach the tray.
    const quota = "Google Drive is out of storage space — free up room in the connected Drive account and try again.";
    expect(fileWarn({ uploadFailed: true, driveError: quota })).toContain(quota);
    expect(fileWarn({ uploadFailed: true, driveError: null })).toMatch(/re-open to upload/);
  });
  it("oversize takes precedence over a drive error", () => {
    expect(fileWarn({ oversize: true, driveError: true })).toMatch(/cloud limit/);
  });
});

// B409: a big file (over the Supabase cap) whose bytes aren't stored gets a DISTINCT message
// from the legacy 50 MB "oversize" wording, because the fix is now actionable — large files go
// straight to Drive, so re-opening it actually uploads it.
describe("classifySource — big-file 'too-large' state (B409)", () => {
  const BIG = 51 * 1024 * 1024; // over the 50 MB cap
  it("an oversize source with a known large size → too-large", () => {
    expect(classifySource({ name: "Civil IFP", oversize: true, size: BIG })).toBe("too-large");
  });
  it("an oversize source with no/small recorded size stays on the legacy 'oversize' state", () => {
    expect(classifySource({ name: "x", oversize: true })).toBe("oversize");
    expect(classifySource({ name: "x", oversize: true, size: 1024 })).toBe("oversize");
  });
});

describe("too-large copy + warn are distinct from oversize (B409)", () => {
  it("the too-large banner is actionable (re-open to upload, mentions Drive) and not the 50 MB cap line", () => {
    const m = sourceUnavailableMessage("too-large", { name: "Civil IFP" });
    expect(m).toContain("Civil IFP");
    expect(m).toMatch(/upload/);
    expect(m).toMatch(/Drive/);
    expect(m).toMatch(/markups are saved/);
    expect(m).not.toMatch(/per-file cloud limit/); // distinct from the legacy oversize wording
    expect(m).not.toBe(sourceUnavailableMessage("oversize", { name: "Civil IFP" }));
  });
  it("fileWarn distinguishes a large-file upload failure from the plain cap warn", () => {
    const big = fileWarn({ oversize: true, large: true });
    expect(big).toMatch(/large file/);
    expect(big).toMatch(/retry/);
    expect(big).not.toBe(fileWarn({ oversize: true })); // plain cap warn stays for the no-size case
  });
});
