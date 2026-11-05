/* B2200384 — a test that used to read the raw `planarfit:sites:v1` entry reads THIS instead: the library as the old blob would have held it,
 * rebuilt from the per-plan entries (the one implementation the harnesses use in a page: src/shared/storage/sitesRawView.js). */
export { sitesRaw, sitesObject } from "../../src/shared/storage/sitesRawView.js";
