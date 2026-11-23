// A copy of an object without the named keys (the "destructure and discard" idiom, minus the unused locals).
export const omitKeys = (o, keys) => { const out = { ...o }; for (const k of keys) delete out[k]; return out; };
