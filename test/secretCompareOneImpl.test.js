import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { safeEqual } from "../functions/api/lib/safeEqual.js";
import { onRequestPost } from "../functions/api/taxunits-index.js";
import { handleMcp } from "../functions/api/mcp/_handler.js";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("one constant-time secret compare for every functions/ route (audit batch A)", () => {
  it("safeEqual is exact", async () => {
    expect(await safeEqual("abc", "abc")).toBe(true);
    expect(await safeEqual("abc", "abd")).toBe(false);
    expect(await safeEqual("abc", "abcd")).toBe(false);
  });
  it("no route compares a secret with === / !==", () => {
    for (const f of ["functions/api/taxunits-index.js", "functions/api/mcp/_handler.js", "functions/api/drive/selftest.js"]) {
      const s = src(f);
      expect(s, f).toMatch(/safeEqual/);
      expect(s, f).not.toMatch(/[!=]==?\s*env\.(E2E_LOGIN_KEY|PLANYR_MCP_TOKEN|PLANYR_SELFTEST_TOKEN|TAXUNITS_INDEX_KEY)/);
    }
  });
  it("e2e-session re-uses the shared helper instead of defining its own", () => {
    expect(src("functions/api/auth/e2e-session.js")).not.toMatch(/function safeEqual/);
  });
  it("taxunits-index no longer reads E2E_LOGIN_KEY; unset own key is a loud 503; wrong key 403", async () => {
    expect(src("functions/api/taxunits-index.js")).not.toMatch(/env\.E2E_LOGIN_KEY/);
    const mk = (key) => ({ request: new Request("https://x/api/taxunits-index?county=harris&year=2025&action=rates", { method: "POST", headers: key ? { "x-index-key": key } : {} }) });
    expect((await onRequestPost({ ...mk("k"), env: { E2E_LOGIN_KEY: "k" } })).status).toBe(503);
    expect((await onRequestPost({ ...mk("nope"), env: { TAXUNITS_INDEX_KEY: "right" } })).status).toBe(403);
  });
  it("MCP accepts the legacy secret as Bearer on the bare route, and still the path token; a wrong path token is 404, a wrong or missing bearer 401 (OAuth discovery)", async () => {
    const env = { PLANYR_MCP_TOKEN: "sekret-token", PLANYR_MCP_OWNER_ID: "OWNER-1" };
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    const call = (headers, segs) => handleMcp({ env, request: new Request("https://x/api/mcp", { method: "POST", body, headers }), method: "POST", segs });
    expect((await call({ authorization: "Bearer sekret-token" }, [])).status).toBe(200);
    expect((await call({}, ["sekret-token"])).status).toBe(200);
    expect((await call({}, ["wrong"])).status).toBe(404);
    expect((await call({ authorization: "Bearer wrong" }, [])).status).toBe(401);
    expect((await call({}, [])).status).toBe(401);
  });
});
