/* One answer to "is the primary input a finger?" (NEW-1). A panel or dialog that merely OPENS must
 * not take text focus on such a device — the on-screen keyboard would cover it. Fields the user
 * deliberately tapped to edit (rename, cell editors) are exempt and keep their own focus. */
export const isCoarsePointer = () => {
  try { return !!(typeof window !== "undefined" && window.matchMedia && window.matchMedia("(pointer: coarse)").matches); } catch (_) { return false; }
};
