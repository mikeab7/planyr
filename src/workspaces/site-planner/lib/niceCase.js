/* ALL-CAPS agency text → words (Florida layers). Split out of floridaLayers.js, a lazy per-state layer file. */
/* The agencies publish ALL-CAPS names and addresses; a card prints them in words (a value with any lowercase letter is left exactly as written). */
const KEEP_CAPS = new Set(["LLC", "INC", "LP", "LLP", "II", "III", "IV", "NW", "NE", "SW", "SE", "FPL", "FDOT", "USA", "FL", "MD", "SR", "US", "CR", "PGA", "DBA", "DEP", "AT&T", "SFWMD", "SWFWMD", "SJRWMD", "SRWMD", "NWFWMD", "WMD", "WCD", "FWC", "USACE", "FEC", "DD", "BCB", "ID",
  // acronyms that carry a vowel and so look like words (STA = Stormwater Treatment Area), and the ones the live canal / permit / site-name lists actually hold
  "STA", "HDPE", "CATV", "CMP", "RCP", "EAA", "HEFT", "JEA", "JTA", "GRU", "EPA", "IMC", "ITT", "AAFES", "USDA", "YMCA", "COJ", "JSO", "ABCA", "MCI", "DERM", "CERP", "TCI", "IXC", "NUI", "CCI", "NASA", "HAFB", "AFS", "FCI",
  "HICPO", "FPDA", "PBIA", "USSC", "ENP", "NDA", "SDA", "SIRWCD", "NSID", "CSID", "DICD", "ITID", "ECWCD", "EBWCD", "ESWCD", "LAMSID"]);
/* Abbreviations that have no vowels but are words, not acronyms ("Ft", "St", "Hwy", "Bldg"). */
const WORD_ABBR = new Set(["ST", "FT", "MT", "DR", "RD", "HWY", "BLVD", "PKWY", "PKY", "CT", "LN", "PL", "CIR", "TRL", "STE", "JR", "TPKE", "CNL", "CNLS", "BRK", "CRK", "BLDG", "CTR", "BD", "MGMT", "PLT", "TR", "BLK", "LK", "PLZ", "BTWN", "SRVC", "MSTR", "FRM", "MR", "MRS", "MS", "DPT", "DEPT", "CNTY", "CTY", "TWP", "BR", "NR", "PRK", "VLG", "SQ", "TRM", "WRK", "WKS", "BLD", "BRG", "HTS", "PT", "MTN", "SPGS"]);
const SMALL_WORDS = new Set(["of", "and", "the", "at", "in", "on", "for", "de", "del", "la"]);
/* A token stays upper-case when it is a known acronym, a district-style acronym (…WCD, …WMD), a canal / road id mixing letters and digits ("C-24D", "L-35"), initials joined by "&" ("J&J", "FP&L"),
 * or a vowel-less run of letters — the shape most district and canal-authority acronyms have ("NSLRWCD", "LWDD") and no ordinary name has. Everything else is title-cased. An acronym's possessive keeps its acronym ("FPL's"). */
const isAcronym = (w) => KEEP_CAPS.has(w.toUpperCase())
  || /^[a-z]{2,}(wcd|wmd)$/.test(w)
  || (/\d/.test(w) && /[a-z]/.test(w) && !/^\d+(st|nd|rd|th)$/.test(w))
  || /^[a-z]{1,3}(&[a-z]{1,3})+$/.test(w)
  || (/^[a-z]{2,}$/.test(w) && !/[aeiouy]/.test(w) && !WORD_ABBR.has(w.toUpperCase()));
const wordCase = (w, i) => {
  const poss = /^([a-z&]+)'s$/.exec(w);
  if (poss && isAcronym(poss[1])) return poss[1].toUpperCase() + "'s";
  if (isAcronym(w)) return w.toUpperCase();
  if (i > 0 && SMALL_WORDS.has(w)) return w;
  if (/^[a-z]'[a-z]/.test(w)) return w.charAt(0).toUpperCase() + "'" + w.charAt(2).toUpperCase() + w.slice(3);
  return w.charAt(0).toUpperCase() + w.slice(1);
};
export function niceCase(v) {
  const t = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  if (!t || /[a-z]/.test(t)) return t;
  let i = 0;
  return t.toLowerCase().replace(/[a-z0-9&']+/g, (w) => wordCase(w, i++)).replace(/(\d)(St|Nd|Rd|Th)\b/g, (_m, d, suf) => d + suf.toLowerCase());
}
