/* TOOLING / NODE SCRIPTS ONLY — the FULL registry. Imports every source pack statically and merges it, then re-exports everything sources.js does.
 * ui-audit/*.mjs and scripts/*.mjs import this instead of sources.js when they audit or probe rows that live in a pack. The app never imports it (test/sourcePacks.test.js). */
import { registerSourcePack } from "./sources.js";
import { PACKS_ALL } from "./sourcePacksAll.js";
for (const [id, rows] of Object.entries(PACKS_ALL)) registerSourcePack(id, rows);
export * from "./sources.js";
