/* "Connect to Claude" browser helpers (2026-11-27): the Allow page's id survives sign-in, the consent list is the
 * connector's own list, Sign out on all devices disconnects assistants, and the wiring the reviewer named (A5/A9). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { connectIdFromHash, isConnectRoute, rememberPendingConnect, freshPendingConnect, clearPendingConnect, PENDING_MS, connectorUrl } from "../src/shared/auth/connectRequest.js";
import { safeNextRoute } from "../src/shared/auth/authLink.js";
import { unknownModuleSlug } from "../src/app/route.js";
import { CONNECTOR_TOOLS, CONNECTOR_CANNOT } from "../src/shared/mcp/connectorScope.js";
import { TOOLS } from "../functions/api/mcp/_tools.js";
import { returnUrl } from "../src/shared/mcp/connectorClient.js";
import { dayWords, usedWords, grantLine } from "../src/shared/mcp/assistantsView.js";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
// source-scan: wiring checks the adversarial reviewer named (consent is a POST, no skip, Settings section, signOut order)
const src = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

describe("the Allow page's request id", () => {
  it("reads #/connect/<uuid> and nothing looser", () => {
    expect(connectIdFromHash("#/connect/" + ID)).toBe(ID);
    expect(connectIdFromHash("/connect/" + ID.toUpperCase())).toBe(ID);
    for (const bad of ["#/connect/", "#/connect/abc", `#/connect/${ID}/x`, `#/site/${ID}`, `#/connect/${ID}?x=1`, "", null]) expect(connectIdFromHash(bad)).toBeNull();
    expect(isConnectRoute("#/connect/" + ID)).toBe(true);
  });
  it("survives safeNextRoute, so an emailed sign-in link brings the person back to it", () => {
    expect(safeNextRoute("#/connect/" + ID)).toBe("/connect/" + ID);
  });
  it("is a known route, so the 'newer version' banner never fires on it", () => {
    expect(unknownModuleSlug("#/connect/" + ID)).toBeNull();
    expect(unknownModuleSlug("#/connectx")).toBe("connectx");
  });
  it("is remembered on this device for 10 minutes only", () => {
    const st = memStore();
    rememberPendingConnect(ID, st, 1000);
    expect(freshPendingConnect(st, 1000 + PENDING_MS - 1)).toBe(ID);
    expect(freshPendingConnect(st, 1000 + PENDING_MS)).toBeNull();
    expect(freshPendingConnect(st, 999)).toBeNull();          // a clock that went backwards is not "fresh"
    rememberPendingConnect("not-a-uuid", st, 5000);
    expect(freshPendingConnect(st, 5000)).toBe(ID);           // the bad id was refused; the earlier entry stands
    rememberPendingConnect(ID, st, 1);
    clearPendingConnect(st);
    expect(freshPendingConnect(st, 2)).toBeNull();
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(() => { rememberPendingConnect(ID, broken); clearPendingConnect(broken); }).not.toThrow();
    expect(freshPendingConnect(broken)).toBeNull();
  });
  it("the connector's address", () => {
    expect(connectorUrl("https://planyr.io/")).toBe("https://planyr.io/api/mcp");
  });
});

describe("A9 — the Allow page promises exactly what the connector does", () => {
  it("one line per real tool, in the same order", () => {
    expect(CONNECTOR_TOOLS.map((t) => t.tool)).toEqual(TOOLS.map((t) => t.name));
    for (const t of CONNECTOR_TOOLS) expect(t.can.length).toBeGreaterThan(20);
  });
  it("does not claim file contents or Notes, and says so", () => {
    const can = CONNECTOR_TOOLS.map((t) => t.can).join(" ");
    expect(can).not.toMatch(/\bnotes\b/i);
    expect(can).toMatch(/can.t open or read the files/);
    expect(CONNECTOR_CANNOT.join(" ")).toMatch(/contents of your files or Notes/);
  });
});

describe("returning to the assistant", () => {
  it("only to the redirect the database returned, with code, state and issuer", () => {
    expect(returnUrl({ redirect_uri: "https://claude.ai/api/mcp/auth_callback", state: "s 1", code: "pmcp_code_x" }, "https://planyr.io"))
      .toBe("https://claude.ai/api/mcp/auth_callback?code=pmcp_code_x&state=s+1&iss=https%3A%2F%2Fplanyr.io");
    expect(returnUrl({ redirect_uri: "http://localhost:9/cb", state: null, error: "access_denied" }, "https://planyr.io"))
      .toBe("http://localhost:9/cb?error=access_denied&iss=https%3A%2F%2Fplanyr.io");
  });
});

describe("Settings → AI assistants wording", () => {
  const now = new Date(2026, 10, 27, 15, 0, 0);
  it("days and last use in plain words", () => {
    expect(dayWords(new Date(2026, 10, 27, 1).toISOString(), now)).toBe("today");
    expect(dayWords(new Date(2026, 10, 26, 23).toISOString(), now)).toBe("yesterday");
    expect(dayWords(new Date(2026, 10, 24).toISOString(), now)).toBe("3 days ago");
    expect(dayWords(new Date(2026, 9, 2).toISOString(), now)).toMatch(/^on /);
    expect(usedWords(null, now)).toBe("not used yet");
    expect(usedWords(new Date(now.getTime() - 30_000).toISOString(), now)).toBe("used just now");
    expect(usedWords(new Date(now.getTime() - 10 * 60_000).toISOString(), now)).toBe("used a few minutes ago");
    expect(usedWords(new Date(now.getTime() - 2 * 3600_000).toISOString(), now)).toBe("used 2 hours ago");
    expect(usedWords(new Date(now.getTime() - 3600_000 - 1).toISOString(), now)).toBe("used 1 hour ago");
    expect(grantLine({ created_at: new Date(2026, 10, 27, 9).toISOString(), last_used_at: null }, now)).toBe("Connected today · not used yet");
  });
});

describe("wiring the reviewer named", () => {
  it("Allow and Cancel are POSTs through the person's own session, never a link", () => {
    const client = src("src/shared/mcp/connectorClient.js");
    expect(client).toMatch(/await supabase\.rpc\(fn, args\)/);
    expect(client).toMatch(/call\("mcp_oauth_decide"/);
    const page = src("src/app/ConnectLanding.jsx");
    expect(page).not.toMatch(/<a [^>]*href=[^>]*decide/);
    expect(page).toMatch(/data-testid="connect-allow"/);
    expect(page).toMatch(/gave itself/);                  // the name is labelled as self-reported
    expect(page).toMatch(/sends you back to/);            // and the real host is shown
    expect(page).not.toMatch(/skip this|remember (this|my) (assistant|choice)|don.t ask again/i); // no "skip consent next time"
  });
  it("the app root may not be framed (the Allow button lives there)", () => {
    const headers = src("public/_headers");
    expect(headers).toMatch(/^\/\n\s+Cache-Control: no-cache\n\s+X-Frame-Options: DENY\n\s+Content-Security-Policy: frame-ancestors 'none'/m);
  });
  it("Sign out on all devices disconnects assistants first, and refuses to half-finish", () => {
    const auth = src("src/workspaces/site-planner/lib/auth.js");
    const body = auth.slice(auth.indexOf("export async function signOutEverywhere"));
    expect(body.indexOf("disconnectAllAssistants()")).toBeGreaterThan(0);
    expect(body.indexOf("disconnectAllAssistants()")).toBeLessThan(body.indexOf('signOut({ scope: "global" })'));
  });
  it("Settings has the AI assistants section, lazily loaded", () => {
    const panel = src("src/workspaces/site-planner/components/AuthPanel.jsx");
    expect(panel).toMatch(/lazy\(\(\) => import\("\.\.\/\.\.\/\.\.\/shared\/mcp\/AssistantsPanel\.jsx"\)\)/);
    expect(panel).toMatch(/\{ id: "assistants", label: "AI assistants"/);
  });
  it("the Shell mounts the Allow page lazily and only for a connect id", () => {
    const shell = src("src/app/Shell.jsx");
    expect(shell).toMatch(/const ConnectLanding = lazy\(\(\) => import\("\.\/ConnectLanding\.jsx"\)\)/);
    expect(shell).toMatch(/\{connectId && !authOpen/);
  });
});
