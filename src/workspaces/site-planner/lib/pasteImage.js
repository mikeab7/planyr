/* NEW-1 — Ctrl+V a clipboard image onto the Site Planner as a new overlay.
 *
 * Pure helpers only. The overlay itself is created by the planner's ONE upload path
 * (`addOverlayFile` in SitePlanner.jsx) — there is no second overlay model here. */

export const PASTED_IMAGE_BASE = "Pasted image";

/** The first image the clipboard carries, or null. Looks at `files` first (what a screenshot paste
 *  populates in every browser), then at `items` of kind "file". Text-only / empty → null, which the
 *  caller treats as "not mine" (silent no-op). The returned File always has a real image MIME type and
 *  a `.png`/`.jpg`-style name — screenshots arrive as a nameless "image.png". */
export function imageFileFromClipboard(cd) {
  if (!cd) return null;
  let f = null;
  const files = cd.files ? Array.from(cd.files) : [];
  f = files.find((x) => x && /^image\//i.test(x.type || "")) || null;
  if (!f && cd.items) {
    for (const it of Array.from(cd.items)) {
      if (it && it.kind === "file" && /^image\//i.test(it.type || "")) {
        const g = typeof it.getAsFile === "function" ? it.getAsFile() : null;
        if (g) { f = g; break; }
      }
    }
  }
  if (!f) return null;
  const type = f.type || "image/png";
  const ext = (type.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "").replace(/^jpeg$/i, "jpg") || "png";
  return new File([f], `pasted-image.${ext}`, { type });
}

/** "Pasted image", then "Pasted image 2", "Pasted image 3"… — deduped against the overlay names already on the plan. */
export function pastedImageName(existingNames = []) {
  const taken = new Set((existingNames || []).map((n) => String(n || "").trim().toLowerCase()));
  if (!taken.has(PASTED_IMAGE_BASE.toLowerCase())) return PASTED_IMAGE_BASE;
  for (let i = 2; i < 10000; i++) {
    const n = `${PASTED_IMAGE_BASE} ${i}`;
    if (!taken.has(n.toLowerCase())) return n;
  }
  return `${PASTED_IMAGE_BASE} ${Date.now()}`;
}
