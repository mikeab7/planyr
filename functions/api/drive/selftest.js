/* GET /api/drive/selftest — backend Drive round-trip smoke test (B207 verification).
 *
 * Runs SERVER-SIDE on the deploy, where the Google creds live, so it proves the stored
 * refresh token actually authenticates and writes to Drive — end to end: save → list →
 * fetch → delete a throwaway file. Returns a sanitized JSON pass/fail (never echoes a
 * token). Creates and then deletes its probe file, so it leaves nothing behind.
 *
 * DISABLED unless `PLANYR_SELFTEST_TOKEN` is set in the deploy env AND the request passes
 * the same value as `?token=…`. This keeps it from being a world-triggerable Drive writer.
 * Recommended use: set PLANYR_SELFTEST_TOKEN to a random value, run once, then delete the
 * var to turn the endpoint back off.
 */
import { buildStorageAdapter, storageConfig, defaultDriveClientFactory } from "../../../server/storage/index.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8" } });

export async function onRequestGet(context) {
  const { env, request } = context;
  const token = new URL(request.url).searchParams.get("token");
  if (!env.PLANYR_SELFTEST_TOKEN || token !== env.PLANYR_SELFTEST_TOKEN) {
    return new Response("Not found", { status: 404 }); // off unless explicitly enabled
  }

  const cfg = storageConfig(env);
  if (cfg.backend !== "drive") {
    return json({ ok: false, error: `PLANYR_STORAGE_BACKEND is "${cfg.backend}", not "drive" — set it to drive (or this test can't exercise Drive).` });
  }

  const adapter = buildStorageAdapter(cfg);
  const steps = [];
  const run = async (label, fn) => { const r = await fn(); steps.push({ step: label, ok: !!r.ok, error: r.ok ? undefined : r.error }); return r; };

  const key = `__selftest__/probe-${Date.now()}.txt`;
  const bytes = new TextEncoder().encode("planyr drive self-test — safe to delete");

  const save = await run("save", () => adapter.save({ planyrKey: key, bytes, contentType: "text/plain", name: "planyr-selftest.txt", folder: "__selftest__" }));
  if (save.ok) {
    const list = await run("list", () => adapter.list({ folder: "__selftest__" }));
    if (list.ok) steps[steps.length - 1].found = (list.items || []).some((i) => i.planyrKey === key);
    const got = await run("fetch", () => adapter.fetch(key));
    if (got.ok) {
      try { steps[steps.length - 1].roundTrip = new TextDecoder().decode(got.bytes) === "planyr drive self-test — safe to delete"; } catch (_) { steps[steps.length - 1].roundTrip = false; }
    }
    await run("delete (cleanup)", () => adapter.remove(key));
  }

  // Resumable round-trip (B409) — proves the LARGE-file transport (session init → PUT →
  // read-back) works against real Drive, so the path the 100 MB+ browser-direct upload relies on
  // can't silently regress. Size is overridable via ?mb=N (default 6 MB, already past Google's
  // 5 MB multipart limit). This step runs server-side, so it's bounded by the Worker's memory and
  // capped at 64 MB; the true >100 MB validation is dropping a big PDF on the deployed app, where
  // the browser PUTs straight to Google and nothing is buffered server-side.
  const client = defaultDriveClientFactory(cfg.drive);
  if (client) {
    const mb = Math.min(Math.max(Number(new URL(request.url).searchParams.get("mb")) || 6, 1), 64);
    const big = new Uint8Array(mb * 1024 * 1024); // zero-filled; only the transport is under test
    let rid = null;
    await run(`resumable upload (${mb} MB)`, async () => {
      try {
        const parentFolderId = await client.folderId("__selftest__");
        const res = await client.createViaResumable({ bytes: big, contentType: "application/octet-stream", name: `planyr-resumable-${Date.now()}.bin`, parentFolderId });
        rid = res && res.id; return { ok: !!rid };
      } catch (e) { return { ok: false, error: (e && e.message) || "resumable upload failed" }; }
    });
    if (rid) {
      await run("resumable read-back", async () => {
        try { const m = await client.media(rid); return { ok: !!(m && m.bytes && m.bytes.byteLength === big.byteLength) }; }
        catch (e) { return { ok: false, error: (e && e.message) || "read-back failed" }; }
      });
      await run("resumable delete (cleanup)", async () => {
        try { await client.del(rid); return { ok: true }; } catch (e) { return { ok: false, error: (e && e.message) || "delete failed" }; }
      });
    }
  }

  const ok = steps.every((s) => s.ok);
  return json({
    ok,
    backend: adapter.backendName,
    summary: ok ? "✅ Drive is connected — the refresh token authenticated and a file round-tripped (created, listed, read back, deleted)." : "❌ Drive round-trip failed — see the first step with ok:false.",
    steps,
  }, ok ? 200 : 500);
}
