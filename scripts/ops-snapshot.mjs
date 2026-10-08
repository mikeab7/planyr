#!/usr/bin/env node
/* Ops snapshot (B711908) — reads the ledger folders (the canonical trackers) and prints the two
 * payloads the admin Ops panel shows, plus ready-to-run SQL that upserts them into
 * public.ops_snapshots. The ledger stays canonical; this is a read-only copy for the page.
 *   node scripts/ops-snapshot.mjs          → JSON
 *   node scripts/ops-snapshot.mjs --sql    → SQL for the Supabase SQL editor / MCP
 *   node scripts/ops-snapshot.mjs --push   → send both payloads to the Ops page (B2159504). Run by the Build
 *                                            workflow's `ops-digest` job after every merge to main.
 *   … --push --dry-run                     → build + validate + print the request, send nothing (a CI gate).
 * --push needs VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and OPS_INGEST_TOKEN (the GitHub Actions secret whose
 * SHA-256 is in public.ops_ingest_tokens — src/workspaces/admin/db/admin_ops_ingest.sql). The token is only ever
 * sent as an RPC argument over HTTPS and is never printed. Without the token the push says so loudly and exits 0
 * (setup not done yet); a rejected or failed push exits 1.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const heading = (dir, file) => {
  const first = readFileSync(join(dir, file), "utf8").split("\n", 1)[0];
  const m = /^###\s+([BV]\d+|NEW-\d+)\s+—\s+(.*)$/.exec(first);
  if (!m) return null;
  const title = m[2].replace(/\s*\*\(.*$/, "").replace(/`/g, "").trim();
  const tags = (title.match(/#[a-z0-9-]+/g) || []);
  return { id: m[1], title: title.replace(/\s*#[a-z0-9-]+/g, "").trim().slice(0, 160), tags };
};
const list = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => /^[BV]\d+.*\.md$/.test(f)).map((f) => heading(dir, f)).filter(Boolean) : []);

const num = (it) => Number(String(it.id).replace(/\D/g, "")) || 0;
/* Counts + the newest N of each queue — a read-only digest, not a copy of the ledger. */
const digest = (items, n = 25) => ({
  count: items.length,
  recent: [...items].sort((a, b) => num(b) - num(a)).slice(0, n).map(({ id, title }) => ({ id, title })),
});

export function buildSnapshots(root = ".", stamp = {}) {
  const open = list(join(root, "ledger/backlog/open"));
  const tagCounts = {};
  for (const it of open) for (const t of it.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag, count]) => ({ tag, count }));
  /* commit + committedAt: which merge this digest reflects (the page shows "after <short commit>", and the
   * database refuses an OLDER commit's late-finishing run over a newer one). Absent for a hand run. */
  const meta = stamp.commit ? { commit: stamp.commit, committedAt: stamp.committedAt || null } : {};
  return {
    backlog: { ...meta, open: { ...digest(open), topTags }, verify: digest(list(join(root, "ledger/backlog/verify"))) },
    verification: { ...meta, pending: digest(list(join(root, "ledger/verification/pending"))) },
  };
}

export const MAX_PAYLOAD_BYTES = 200_000;

/** The HTTP request for the ingest RPC. Pure — the token goes in the body only, never a URL or a log. */
export function buildIngestRequest({ url, anonKey, token, snapshots }) {
  return {
    url: `${String(url).replace(/\/+$/, "")}/rest/v1/rpc/ops_ingest_snapshots`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", apikey: anonKey, authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ p_token: token, p_snapshots: snapshots }),
    },
  };
}

/** Refuse a payload the page could not use, before anything is sent. Returns a list of problems. */
export function validateSnapshots(s) {
  const bad = [];
  const dig = (d, name) => { if (!d || !Number.isInteger(d.count) || !Array.isArray(d.recent)) bad.push(`${name} is not a digest`); };
  dig(s.backlog && s.backlog.open, "backlog.open"); dig(s.backlog && s.backlog.verify, "backlog.verify");
  dig(s.verification && s.verification.pending, "verification.pending");
  if (JSON.stringify(s).length > MAX_PAYLOAD_BYTES) bad.push("payload is over the size cap");
  return bad;
}

function gitStamp() {
  const sha = process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const committedAt = execFileSync("git", ["show", "-s", "--format=%cI", sha], { encoding: "utf8" }).trim();
  return { commit: sha, committedAt };
}

/** The --push path. `env`/`fetchImpl`/`stamp` are injectable so the whole flow is unit-tested without a network. */
export async function runPush({ env = process.env, dryRun = false, fetchImpl = globalThis.fetch, stamp = gitStamp(), root = ".", log = console.log } = {}) {
  const snapshots = buildSnapshots(root, stamp);
  const problems = validateSnapshots(snapshots);
  if (problems.length) { log("ops-digest: refusing to send — " + problems.join("; ")); return { code: 1, sent: false }; }
  const url = env.VITE_SUPABASE_URL, anonKey = env.VITE_SUPABASE_ANON_KEY, token = env.OPS_INGEST_TOKEN;
  const summary = `backlog open ${snapshots.backlog.open.count}, verify ${snapshots.backlog.verify.count}, pending V# ${snapshots.verification.pending.count} @ ${String(stamp.commit).slice(0, 7)}`;
  if (dryRun) {
    const req = token && url && anonKey ? buildIngestRequest({ url, anonKey, token: "<redacted>", snapshots }) : null;
    log(`ops-digest (dry run): payload valid — ${summary}${req ? `; would POST ${req.url}` : "; env not set here, request not built"}`);
    return { code: 0, sent: false, dryRun: true };
  }
  if (!token) {
    log(`::warning title=Ops digest NOT updated::OPS_INGEST_TOKEN is not set as a GitHub Actions secret, so the admin Ops page is not refreshing itself. Setup: see src/workspaces/admin/db/admin_ops_ingest.sql.`);
    log("ops-digest: skipped (no OPS_INGEST_TOKEN) — " + summary);
    return { code: 0, sent: false, skipped: true };
  }
  if (!url || !anonKey) { log("ops-digest: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set — cannot send"); return { code: 1, sent: false }; }
  const req = buildIngestRequest({ url, anonKey, token, snapshots });
  let res;
  try { res = await fetchImpl(req.url, req.init); } catch (e) { log("ops-digest: request failed — " + ((e && e.message) || e)); return { code: 1, sent: false }; }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    log(`ops-digest: the server refused it (HTTP ${res.status}) ${body.slice(0, 200).split(token).join("<token>")}`);
    return { code: 1, sent: false };
  }
  log("ops-digest: sent — " + summary + " " + (await res.text().catch(() => "")).slice(0, 200));
  return { code: 0, sent: true };
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes("--push")) {
  runPush({ dryRun: process.argv.includes("--dry-run") }).then((r) => { process.exitCode = r.code; });
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const s = buildSnapshots();
  const q = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
  if (process.argv.includes("--sql")) {
    console.log(`insert into public.ops_snapshots(key,payload,updated_at) values ('backlog',${q(s.backlog)},now()),('verification',${q(s.verification)},now())\non conflict (key) do update set payload=excluded.payload, updated_at=now();`);
  } else console.log(JSON.stringify(s, null, 1));
}
