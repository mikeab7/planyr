import { useEffect, useState } from "react";
/* One answer to "is the primary input a finger?" (NEW-1). A panel or dialog that merely OPENS must
 * not take text focus on such a device — the on-screen keyboard would cover it. Fields the user
 * deliberately tapped to edit (rename, cell editors) are exempt and keep their own focus. */
export const isCoarsePointer = () => {
  try { return !!(typeof window !== "undefined" && window.matchMedia && window.matchMedia("(pointer: coarse)").matches); } catch (_) { return false; }
};

/* B2671348 (2026-11-28) — the REACTIVE twin: "should controls be finger-sized?" is a question
 * about the INPUT, never about the window's width. A laptop at 150% display scaling plus a browser
 * zoom has a phone-width window and a MOUSE; keying 44px tap targets on width alone gave it giant,
 * stretched buttons (owner photo, Goose Creek › Notes). Updates live when a tablet docks a mouse. */
export const COARSE_POINTER_QUERY = "(pointer: coarse)";
export function useCoarsePointer() {
  const [coarse, setCoarse] = useState(isCoarsePointer);
  useEffect(() => {
    let mq; try { mq = window.matchMedia(COARSE_POINTER_QUERY); } catch (_) { return undefined; }
    const on = () => setCoarse(!!mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return coarse;
}
