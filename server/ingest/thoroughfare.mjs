#!/usr/bin/env node
/* Thoroughfare ingestion adapter (B721; framework generalized in B722). Fetches a jurisdiction's
 * thoroughfare layer from its ArcGIS REST endpoint, normalizes each feature via the shared pure
 * transform, and idempotently upserts into Supabase `thoroughfare_segments` (on
 * jurisdiction+source_feature_id — re-running updates in place, never duplicates). Also seeds that
 * jurisdiction's `jurisdiction_row_standards`.
 *
 * SERVER-SIDE ONLY. Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY — the service role bypasses
 * the public-read RLS to write (the anon/authenticated roles can only read). Not deployed yet:
 * run on-demand from a network-enabled context, or from the future Cloud Run cron (B726).
 *
 * ⚠ The build sandbox is egress-blocked from houstontx.gov (org policy), so this cannot run there —
 * it is the artifact the live-verify step (V274) runs. On Node ≥ 22.21 behind the agent proxy,
 * run with NODE_USE_ENV_PROXY=1 so built-in fetch honors HTTPS_PROXY.
 *
 * If you do NOT have SUPABASE_SERVICE_ROLE_KEY, do not run this — load via the Supabase-MCP /
 * DB-native path instead (see B721 in BACKLOG-DONE.md for how the live Houston pull was run).
 *
 * LOUD-FAILURE: any fetch / ArcGIS / upsert error throws with context and exits non-zero; a single
 * bad feature is skipped + counted; paging stops on the server's own `exceededTransferLimit` signal
 * (not a brittle page-size compare) with a dedupe guard so a layer that ignores resultOffset can't
 * loop forever; a "0 upserted but N skipped" run warns loudly (usually a geometry-format mismatch).
 *
 * Usage:  node server/ingest/thoroughfare.mjs [houston]
 */
import { createClient } from "@supabase/supabase-js";
import { HOUSTON, HOUSTON_ROW_STANDARDS } from "../../src/shared/thoroughfare/houston.js";
import { featureToRow, buildQueryUrl } from "../../src/shared/thoroughfare/ingestTransform.js";

const CONFIGS = {
  houston: { config: HOUSTON, standards: HOUSTON_ROW_STANDARDS },
};

async function fetchPage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ArcGIS fetch failed ${res.status} ${res.statusText}: ${url}`);
  const json = await res.json();
  if (json.error) throw new Error(`ArcGIS returned an error: ${JSON.stringify(json.error)}`);
  // `exceededTransferLimit` (Esri JSON) is the authoritative "there are more records" signal —
  // correct even when the server caps a page below any pageSize we asked for.
  return { features: json.features || [], more: json.exceededTransferLimit === true };
}

async function seedStandards(db, jurisdiction, standards) {
  if (!standards?.length) return;
  const now = new Date().toISOString();
  const rows = standards.map((s) => ({ jurisdiction, updated_at: now, ...s }));
  const { error } = await db
    .from("jurisdiction_row_standards")
    .upsert(rows, { onConflict: "jurisdiction,classification" });
  if (error) throw new Error(`standards upsert failed: ${error.message}`);
  console.log(`  seeded ${rows.length} ROW-standard rows for ${jurisdiction}`);
}

async function ingest(name) {
  const entry = CONFIGS[name];
  if (!entry) throw new Error(`unknown jurisdiction '${name}'. known: ${Object.keys(CONFIGS).join(", ")}`);
  const { config, standards } = entry;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (service role — server-side only). Without them, load via the Supabase-MCP / DB-native path (see B721 in BACKLOG-DONE.md).");
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  // Seed standards first so a segment's resolved widths agree with the lookup table.
  await seedStandards(db, config.jurisdiction, standards);

  let offset = 0, total = 0, skipped = 0;
  const seen = new Set(); // dedupe guard: a layer that ignores resultOffset repeats page 1 forever.
  for (let guard = 0; guard < 100000; guard++) {
    const { features, more } = await fetchPage(buildQueryUrl(config, { offset }));
    if (!features.length) break;

    const rows = [];
    let fresh = 0;
    for (const feat of features) {
      const row = featureToRow(feat, config);
      if (!row) { skipped++; continue; }
      if (seen.has(row.source_feature_id)) continue; // already loaded this feature (repeat page)
      seen.add(row.source_feature_id);
      fresh++;
      rows.push(row);
    }
    if (rows.length) {
      const { error } = await db
        .from("thoroughfare_segments")
        .upsert(rows, { onConflict: "jurisdiction,source_feature_id" });
      if (error) throw new Error(`segment upsert failed at offset ${offset}: ${error.message}`);
      total += rows.length;
    }
    console.log(`  …${total} upserted (offset ${offset}, +${rows.length} fresh, ${skipped} skipped so far)`);

    offset += features.length;
    if (!more) break; // server: no more records
    if (fresh === 0) {
      console.warn("  ⚠ a full page returned no NEW features — the layer likely ignores resultOffset paging. Stopping; switch to OBJECTID-window paging (where=OBJECTID>lastId with orderByObjectId).");
      break;
    }
  }

  if (total === 0 && skipped > 0) {
    console.warn(`  ⚠ 0 segments upserted but ${skipped} skipped — almost certainly a geometry-format mismatch (no usable line geometry parsed). Check the layer's response geometry shape.`);
  }
  console.log(`✅ ${name}: ${total} segments upserted, ${skipped} skipped.`);
  return { total, skipped };
}

const name = process.argv[2] || "houston";
ingest(name).catch((e) => {
  console.error(`❌ thoroughfare ingest failed: ${e.message}`);
  process.exit(1);
});
