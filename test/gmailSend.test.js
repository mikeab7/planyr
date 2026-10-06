/* NEW-1 provider layer — Gmail API send via service-account domain-wide delegation. */
import { describe, it, expect, vi } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { sendViaGmail, signJwt, buildMime, parseServiceAccount } from "../functions/api/lib/gmailSend.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA = { client_email: "sa@p.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) };

describe("service-account JWT", () => {
  it("is a valid RS256 signature over the right claims (iss=SA, sub=mailbox, gmail.send scope)", async () => {
    const jwt = await signJwt({ clientEmail: SA.client_email, privateKey: SA.private_key }, "mike@planyr.io", 1000);
    const [h, c, sig] = jwt.split(".");
    const v = createVerify("RSA-SHA256"); v.update(`${h}.${c}`);
    expect(v.verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
    expect(JSON.parse(Buffer.from(c, "base64url"))).toMatchObject({ iss: SA.client_email, sub: "mike@planyr.io", scope: "https://www.googleapis.com/auth/gmail.send", iat: 1000, exp: 4600 });
  });
  it("rejects a non-key secret", () => {
    expect(parseServiceAccount("not json")).toBeNull();
    expect(parseServiceAccount('{"client_email":"x"}')).toBeNull();
  });
});

describe("MIME", () => {
  it("strips CR/LF so a name can't inject headers, and encodes non-ASCII subjects", () => {
    const m = buildMime({ from: "P <a@planyr.io>", to: "x@y.com\r\nBcc: evil@z.com", subject: "Zoë\r\nBcc: e@z.com", text: "t", html: "<p>h</p>", boundary: "B" });
    expect(m).not.toMatch(/^Bcc:/m);
    expect(m).toMatch(/^Subject: =\?UTF-8\?B\?/m);
  });
});

describe("sendViaGmail", () => {
  const tokenOk = () => new Response('{"access_token":"t","expires_in":3600}', { status: 200 });
  it("token then one send; reuses the token on the next send", async () => {
    const calls = [];
    const f = vi.fn(async (u) => { calls.push(u); return String(u).includes("oauth2") ? tokenOk() : new Response("{}", { status: 200 }); });
    const args = { serviceAccountJson: JSON.stringify(SA), sender: "cache-test@planyr.io", to: "a@b.com", subject: "s", html: "h", text: "t", fetchImpl: f };
    expect(await sendViaGmail(args)).toEqual({ ok: true });
    expect(await sendViaGmail(args)).toEqual({ ok: true });
    expect(calls.filter((u) => String(u).includes("oauth2"))).toHaveLength(1);
    expect(calls.filter((u) => String(u).includes("gmail"))).toHaveLength(2);
  });
  it("surfaces a delegation refusal (token 401) loudly, sends nothing", async () => {
    const f = vi.fn(async () => new Response('{"error":"unauthorized_client"}', { status: 401 }));
    const r = await sendViaGmail({ serviceAccountJson: JSON.stringify(SA), sender: "nodwd@planyr.io", to: "a@b.com", subject: "s", html: "h", text: "t", fetchImpl: f });
    expect(r.ok).toBe(false); expect(r.error).toMatch(/401/); expect(f).toHaveBeenCalledTimes(1);
  });
  it("surfaces a Gmail send refusal", async () => {
    const f = vi.fn(async (u) => (String(u).includes("oauth2") ? tokenOk() : new Response("{}", { status: 403 })));
    const r = await sendViaGmail({ serviceAccountJson: JSON.stringify(SA), sender: "refuse@planyr.io", to: "a@b.com", subject: "s", html: "h", text: "t", fetchImpl: f });
    expect(r).toMatchObject({ ok: false }); expect(r.error).toMatch(/403/);
  });
});
