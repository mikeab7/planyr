/* Univer ships ~77 hyphenation PATTERN files (one per language) as lazily loaded chunks of its render engine. They are named
 * after the language tag, then TWO hashes — Univer's own (`af-DK_CjRn6.js`) and the bundler's (`-C81U6qP1`) — which no Planyr
 * chunk is (ours carry one). A sheet in English never asks for one; this is how a harness tells a request for one from the rest. */
export const LANG_FILE = /\/assets\/[a-z]{2,3}(?:-[a-z0-9]+)*-[A-Za-z0-9_-]{8}-[A-Za-z0-9_-]{8}\.js(?:\?|$)/;
export const isLangFile = (url) => LANG_FILE.test(url);
