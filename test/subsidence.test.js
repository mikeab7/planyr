// NEW-B4 — subsidence-district cited registry + county flag. Pure.
import { describe, it, expect } from "vitest";
import { subsidenceFor, subsidenceFlag, problems, SUBSIDENCE_DISTRICTS } from "../src/workspaces/site-planner/lib/subsidence.js";

describe("subsidenceFor — county → district", () => {
  it("Harris/Galveston → HGSD; Fort Bend → FBSD", () => {
    expect(subsidenceFor(["harris"]).map((d) => d.key)).toEqual(["hgsd"]);
    expect(subsidenceFor(["galveston"]).map((d) => d.key)).toEqual(["hgsd"]);
    expect(subsidenceFor(["fort bend"]).map((d) => d.key)).toEqual(["fbsd"]);
  });
  it("normalizes 'Harris County' and unmatched counties", () => {
    expect(subsidenceFor(["Harris County"]).map((d) => d.key)).toEqual(["hgsd"]);
    expect(subsidenceFor(["montgomery"])).toEqual([]);
  });
  it("a straddle can hit both", () => {
    expect(subsidenceFor(["harris", "fort bend"]).map((d) => d.key).sort()).toEqual(["fbsd", "hgsd"]);
  });
});

describe("subsidenceFlag", () => {
  it("returns a screening message + citations when a district applies", () => {
    const f = subsidenceFlag(["fort bend"]);
    expect(f.districts).toEqual(["fbsd"]);
    expect(f.message).toMatch(/permit/);
    expect(f.citations[0].url).toMatch(/^https:\/\//);
  });
  it("no district → null", () => {
    expect(subsidenceFlag(["montgomery"])).toBeNull();
  });
});

describe("registry audit", () => {
  it("has no problems", () => {
    expect(problems()).toEqual([]);
  });
  it("every district cites an https source", () => {
    for (const d of Object.values(SUBSIDENCE_DISTRICTS)) expect(d.citation.url).toMatch(/^https:\/\//);
  });
});
