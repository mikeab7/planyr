/* Title-block reader (B299) — server-side, the auto-filing read pass.
 *
 * MIRRORS the proven client pattern in src/workspaces/site-planner/lib/titleReader.js
 * (read a PDF with the Claude API → clean structured fields via a json_schema), but:
 *   - runs SERVER-SIDE because the API key must never reach the browser (KEY DECISIONS) —
 *     the key comes from server env (config.anthropic.apiKey), never a VITE_ var;
 *   - calls the Messages API over RAW fetch with an injectable `fetchImpl`, exactly like
 *     server/convert/aps.js, so the Cloud Run image stays dependency-free (no SDK bundled)
 *     and this is fully unit-testable without a key or the network.
 *
 * ONE read, TWO payoffs (the whole point of doing it here): the same pass captures the
 * FILING fields (project / discipline / sheet / revision / date — what the matcher needs)
 * AND the PLACEMENT-readiness facts (scale, north arrow, boundary, embedded coords,
 * dimensions — what "Place on map" later needs), so a drawing is read once, not twice.
 *
 * Result-shaped throughout ({ ok, ... } / { ok:false, error }) — never throws, never reports
 * a fabricated read as success. A missing key is an explicit failure, not a silent empty.
 */
import { ok, fail } from "../storage/result.js";

// Keep in lockstep with the client canonical list (src/shared/files/titleBlockParse.js DISCIPLINES);
// /server is walled off from the bundle so it can't import it — update both together. (B360)
export const DISCIPLINES = [
  "Architectural", "Structural", "Civil", "Mechanical", "Electrical", "Plumbing",
  "Landscape", "Fire Alarm", "Fire Sprinkler", "Survey", "Environmental", "Geotech", "CAD", "Other",
];

// Structured-output schema: filing fields + placement-readiness facts in one object. Every
// "present" flag lets "looked, found none" stay distinct from "couldn't read" (the
// silent-failure rule applied to the read itself). Pixel-geometry (scale-bar length in px,
// dimension endpoints) is deliberately NOT asked of the model — that's the later CV step
// (B268/B183); here we capture presence + the values printed on the sheet.
const SCHEMA = {
  type: "object",
  properties: {
    projectName: { type: "string", description: "The project/development name from the title block (e.g. 'Katy Grand — Building 1'). Empty string if none is legible." },
    projectNumber: { type: "string", description: "The firm's project/job number for this sheet, exactly as printed. Empty if none." },
    address: { type: "string", description: "The site street address or location description from the title block. Empty if none." },
    parcel: { type: "string", description: "Any parcel / appraisal account / tract identifier printed on the sheet. Empty if none." },
    discipline: { type: "string", enum: DISCIPLINES, description: "Best-fit discipline for this sheet from its content and sheet number. Fire is split: Fire Alarm vs. Fire Sprinkler. Structural/Mechanical/Electrical/Plumbing are their own disciplines (not lumped 'MEP'). Use Other only when none fit." },
    sheetNumber: { type: "string", description: "The sheet identifier exactly as printed (e.g. 'C-2.01', 'A7.10', 'V1'). Empty if none." },
    sheetTitle: { type: "string", description: "The sheet's title/name (e.g. 'GRADING PLAN', 'BOUNDARY SURVEY'). Empty if none." },
    revision: { type: "string", description: "The current revision label / issue (e.g. 'Rev 3', 'IFC', 'IFP'). Empty if none." },
    date: { type: "string", description: "The sheet/issue date in YYYY-MM-DD if determinable, else as printed. Empty if none." },
    placement: {
      type: "object",
      description: "Placement-readiness facts for later 'Place on map' — capture presence + printed values only, never guessed geometry.",
      properties: {
        embeddedCoords: { type: "boolean", description: "True only if the sheet states real-world coordinates / a coordinate system (e.g. a state-plane grid, NAD83) tying the geometry to the ground." },
        coordSystem: { type: "string", description: "The named coordinate system / datum if stated (e.g. 'NAD83 Texas South Central'). Empty if none." },
        scaleBarPresent: { type: "boolean", description: "True if a graphic scale BAR (a drawn ruler) is present on the sheet." },
        statedScale: { type: "string", description: "The stated scale callout text exactly as printed (e.g. '1\"=40'', '1/4\"=1'-0\"', 'NOT TO SCALE'). Empty if none." },
        northArrowPresent: { type: "boolean", description: "True if a north arrow is present." },
        boundaryPresent: { type: "boolean", description: "True if a property/parcel BOUNDARY outline is drawn on the sheet (vs. only a building/detail)." },
        dimensions: {
          type: "array", description: "Labeled real-world dimensions printed on the sheet (value + its label text). Up to ~8 of the longest/clearest. Empty if none.",
          items: { type: "object", properties: {
            valueFt: { type: "number", description: "The dimension's real-world length in FEET (convert from feet-inches; 0 if not a length)." },
            label: { type: "string", description: "The dimension as printed (e.g. \"240'-6\\\"\")." },
          }, required: ["valueFt", "label"], additionalProperties: false },
        },
      },
      required: ["embeddedCoords", "coordSystem", "scaleBarPresent", "statedScale", "northArrowPresent", "boundaryPresent", "dimensions"],
      additionalProperties: false,
    },
  },
  required: ["projectName", "projectNumber", "address", "parcel", "discipline", "sheetNumber", "sheetTitle", "revision", "date", "placement"],
  additionalProperties: false,
};

const PROMPT =
  "You are reading a single construction/engineering/survey drawing sheet to FILE it. " +
  "Locate the title block (its position varies by firm — find it, don't assume a corner) and extract the project, sheet, revision, and date fields. " +
  "Also capture the placement-readiness facts (scale callout, scale bar present, north arrow, a drawn property boundary, any stated coordinate system, and the clearest labeled dimensions). " +
  "Report only what is actually printed — leave a field empty rather than guessing. Return only the structured data.";

/* Map the model's `placement` object into the shape of
 * src/shared/placement/placementFacts.js (emptyPlacementFacts) so the client can merge it
 * straight in. Self-contained on purpose (server is walled off from src/) — kept in lockstep
 * with that schema by the shared field names. `captured:true` marks "the backend read this". */
export function toPlacementFacts(p = {}) {
  const dims = Array.isArray(p.dimensions) ? p.dimensions.filter((d) => d && Number(d.valueFt) > 0).map((d) => ({ valueFt: Number(d.valueFt), label: d.label || "", p1: null, p2: null })) : [];
  const scaleFt = parseStatedScaleFeetPerInch(p.statedScale);
  return {
    captured: true,
    embeddedCoords: { present: !!p.embeddedCoords, crs: p.coordSystem || null },
    scaleBar: { present: !!p.scaleBarPresent, drawnLenPx: null, realLenFt: null }, // px length is the later CV step
    statedScale: { present: !!(p.statedScale && p.statedScale.trim()), text: p.statedScale || null, feetPerInch: scaleFt },
    northArrow: { present: !!p.northArrowPresent, orientationDeg: null },
    boundary: { present: !!p.boundaryPresent },
    dimensions: dims,
  };
}

// Parse a stated-scale callout to feet-per-inch when unambiguous (engineer's "1\"=40'" and
// architectural "1/4\"=1'-0\""). "NOT TO SCALE"/"AS NOTED"/unparseable → null (not a guess).
export function parseStatedScaleFeetPerInch(text) {
  const s = (text || "").toString().toLowerCase().replace(/\s+/g, "");
  if (!s || /nottoscale|asnoted|nts/.test(s)) return null;
  let m = s.match(/^1?["”]?=(\d+(?:\.\d+)?)['’]?$/) || s.match(/1["”]=(\d+(?:\.\d+)?)['’]/); // 1"=40'
  if (m) return Number(m[1]);
  m = s.match(/(\d+)\/(\d+)["”]=1['’]/); // 1/4"=1'-0"  → (denom/num) ft per inch
  if (m) { const num = Number(m[1]), den = Number(m[2]); if (num > 0) return den / num; }
  return null;
}

/* Read one drawing. `pdfBytes` is a Buffer/Uint8Array of the PDF. Returns
 * ok({ fields, placement }) or fail(...). `fetchImpl` is injectable for tests. */
export async function readTitleBlock(pdfBytes, cfg, { fetchImpl = fetch } = {}) {
  const a = (cfg && cfg.anthropic) || {};
  if (!a.apiKey) return fail("Auto-filing is not configured — set ANTHROPIC_API_KEY (server-side env only).", { configured: false });
  if (!pdfBytes || !pdfBytes.length) return fail("No PDF bytes to read.");

  const b64 = Buffer.from(pdfBytes).toString("base64");
  let res;
  try {
    res = await fetchImpl(`${a.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": a.apiKey, "anthropic-version": a.version || "2023-06-01" },
      signal: a.timeoutMs ? AbortSignal.timeout(a.timeoutMs) : undefined,
      body: JSON.stringify({
        model: a.model,
        max_tokens: a.maxTokens || 8000,
        thinking: { type: "adaptive" },
        output_config: { format: { type: "json_schema", name: "title_block", schema: SCHEMA } },
        messages: [{ role: "user", content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
          { type: "text", text: PROMPT },
        ] }],
      }),
    });
  } catch (e) {
    return fail(`Title-block read request failed: ${(e && e.message) || e}`);
  }

  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok) return fail((data && data.error && (data.error.message || data.error)) || `Claude API ${res.status}`, { status: res.status });
  if (data.stop_reason === "refusal") return fail("The drawing read was declined by safety filters.");

  const block = (data.content || []).find((b) => b.type === "text");
  const raw = (block && block.text) || "";
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (_) {
    const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
    if (s >= 0 && e > s) { try { parsed = JSON.parse(raw.slice(s, e + 1)); } catch (_e) { /* fallthrough */ } }
  }
  if (!parsed || typeof parsed !== "object") return fail("Couldn't parse the title-block read.");

  const fields = {
    projectName: parsed.projectName || "", projectNumber: parsed.projectNumber || "",
    address: parsed.address || "", parcel: parsed.parcel || "",
    discipline: DISCIPLINES.includes(parsed.discipline) ? parsed.discipline : "Other",
    sheetNumber: parsed.sheetNumber || "", sheetTitle: parsed.sheetTitle || "",
    revision: parsed.revision || "", date: parsed.date || "",
  };
  return ok({ fields, placement: toPlacementFacts(parsed.placement || {}) });
}
