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
 * ⚠ The build sandbox is egress-blocked from houstontx.gov (org policy), so this cannot run here —
 * it is the artifact the live-verify step (V274) runs. On Node ≥ 22.21 behind the agent proxy,
 * run with NODE_USE_ENV_PROXY=1 so built-in fetch honors HTTPS_PROXY.
 *
 * LOUD-FAILURE: any fetch / ArcGIS / upsert error throws with context and exits non-zero; a single
 * bad feature is skipped + counted, never silently dropped as success.
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
  return json.features || [];
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
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (service role — server-side only).");
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  // Seed standards first so a segment's resolved widths agree with the lookup table.
  await seedStandards(db, config.jurisdiction, standards);

  const pageSize = 1000;
  let offset = 0, total = 0, skipped = 0;
  for (;;) {
    const features = await fetchPage(buildQueryUrl(config, { offset, pageSize }));
    if (!features.length) break;

    const rows = [];
    for (const feat of features) {
      const row = featureToRow(feat, config);
      if (row) rows.push(row);
      else skipped++;
    }
    if (rows.length) {
      const { error } = await db
        .from("thoroughfare_segments")
        .upsert(rows, { onConflict: "jurisdiction,source_feature_id" });
      if (error) throw new Error(`segment upsert failed at offset ${offset}: ${error.message}`);
      total += rows.length;
    }
    console.log(`  …${total} upserted (offset ${offset}, +${rows.length}, ${skipped} skipped so far)`);
    if (features.length < pageSize) break;
    offset += pageSize;
  }

  console.log(`✅ ${name}: ${total} segments upserted, ${skipped} skipped.`);
  return { total, skipped };
}

const name = process.argv[2] || "houston";
ingest(name).catch((e) => {
  console.error(`❌ thoroughfare ingest failed: ${e.message}`);
  process.exit(1);
});
