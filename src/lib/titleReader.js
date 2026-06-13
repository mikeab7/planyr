/* Title-commitment reader — extracts Schedule B exceptions from an uploaded PDF
 * via the Claude API, plus any metes-and-bounds legal description it finds.
 *
 * This is a 100% client-side static app (GitHub Pages, no backend), so there is
 * no server to hold a secret. Per the project's security rule we NEVER commit a
 * key: the user pastes their own Anthropic API key into the UI; it's kept only
 * in localStorage on their device and sent straight to the Anthropic API from
 * the browser (dangerouslyAllowBrowser). No key, no call.
 *
 * The SDK is imported lazily (dynamic import inside readTitlePDF) so it's
 * code-split out of the main bundle — only fetched when someone actually reads
 * a title PDF, keeping the planner's initial load light.
 */
export const KEY_LS = "planarfit:anthropicKey";
export const getKey = () => { try { return localStorage.getItem(KEY_LS) || ""; } catch (_) { return ""; } };
export const setKey = (k) => { try { k ? localStorage.setItem(KEY_LS, k) : localStorage.removeItem(KEY_LS); } catch (_) {} };

// Structured-output schema: a Schedule B checklist + the legal description.
const SCHEMA = {
  type: "object",
  properties: {
    legalDescription: {
      type: "string",
      description: "The full metes-and-bounds legal description (Exhibit A / property description) verbatim if present, including every bearing/distance call. Empty string if none is in the document.",
    },
    exceptions: {
      type: "array",
      description: "Every Schedule B (or Schedule B Section 2) exception, in order.",
      items: {
        type: "object",
        properties: {
          number: { type: "string", description: "The exception item number/letter as printed (e.g. '10', 'h')." },
          type: {
            type: "string",
            enum: ["easement", "right-of-way", "restriction", "mineral", "lien", "setback", "encroachment", "lease", "taxes", "other"],
            description: "Best-fit category for the exception.",
          },
          recordingReference: { type: "string", description: "Recording reference: volume/page, clerk's file/instrument no., plat/slide, etc. Empty if none." },
          description: { type: "string", description: "Concise one-line summary of what the exception is." },
          plottable: { type: "boolean", description: "True if it references a specific surveyed/plottable location (a metes-and-bounds easement, a dimensioned setback, a platted right-of-way)." },
        },
        required: ["number", "type", "recordingReference", "description", "plottable"],
        additionalProperties: false,
      },
    },
  },
  required: ["legalDescription", "exceptions"],
  additionalProperties: false,
};

const PROMPT =
  "You are reviewing a title insurance commitment for an industrial site. " +
  "Read Schedule B (Exceptions) and extract every exception as a checklist item. " +
  "Categorize each, capture its recording reference exactly as written, and write a one-line summary. " +
  "Flag items that reference a specific surveyable location as plottable. " +
  "Also return the property's metes-and-bounds legal description verbatim if the document contains one. " +
  "Return only the structured data.";

/* Run the extraction. `pdfBase64` is the raw base64 (no data: prefix).
 * Returns { legalDescription, exceptions:[...] }. Throws on auth/other errors. */
export async function readTitlePDF(pdfBase64, { apiKey, model = "claude-opus-4-8" } = {}) {
  const key = apiKey || getKey();
  if (!key) throw new Error("No API key — paste your Anthropic API key first.");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });

  const msg = await client.messages.create({
    model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", name: "schedule_b", schema: SCHEMA } },
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
        { type: "text", text: PROMPT },
      ],
    }],
  });

  if (msg.stop_reason === "refusal") throw new Error("The request was declined by safety filters. Try a different document.");
  const block = (msg.content || []).find((b) => b.type === "text");
  const raw = block?.text || "";
  let data;
  try { data = JSON.parse(raw); }
  catch (_) {
    const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
    if (s >= 0 && e > s) data = JSON.parse(raw.slice(s, e + 1));
    else throw new Error("Couldn't parse the model's response.");
  }
  return { legalDescription: data.legalDescription || "", exceptions: Array.isArray(data.exceptions) ? data.exceptions : [] };
}

// Read a File/Blob into raw base64 (strips the data: URL prefix).
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result || ""); const i = s.indexOf(","); resolve(i >= 0 ? s.slice(i + 1) : s); };
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsDataURL(file);
  });
}
