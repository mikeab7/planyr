#!/usr/bin/env node
/* Ops snapshot (B711908) — reads the ledger folders (the canonical trackers) and prints the two
 * payloads the admin Ops panel shows, plus ready-to-run SQL that upserts them into
 * public.ops_snapshots. The ledger stays canonical; this is a read-only copy for the page.
 *   node scripts/ops-snapshot.mjs          → JSON
 *   node scripts/ops-snapshot.mjs --sql    → SQL for the Supabase SQL editor / MCP
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

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

export function buildSnapshots(root = ".") {
  const open = list(join(root, "ledger/backlog/open"));
  const tagCounts = {};
  for (const it of open) for (const t of it.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tag, count]) => ({ tag, count }));
  return {
    backlog: { open: { ...digest(open), topTags }, verify: digest(list(join(root, "ledger/backlog/verify"))) },
    verification: { pending: digest(list(join(root, "ledger/verification/pending"))) },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = buildSnapshots();
  const q = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;
  if (process.argv.includes("--sql")) {
    console.log(`insert into public.ops_snapshots(key,payload,updated_at) values ('backlog',${q(s.backlog)},now()),('verification',${q(s.verification)},now())\non conflict (key) do update set payload=excluded.payload, updated_at=now();`);
  } else console.log(JSON.stringify(s, null, 1));
}
