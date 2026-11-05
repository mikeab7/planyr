/* useBelowHeader — where the app header ENDS, inside Review's root (B2426787).
 * Review's overlays (Compare) are `position:absolute` over the root. The app header is `position:relative; z-index:60`, so an
 * overlay laid over `inset:0` (z-index 50) put its OWN header row — Close ✕, the ‹ › page steps — underneath the app header,
 * where no mouse click could reach it. The overlay now starts below the header, the way the Stitcher body does (NEW-3).
 * Mount the returned `ref` on a zero-height in-flow marker placed IMMEDIATELY after <AppHeader/>; `top` is the marker's offset
 * from the root, kept current whenever the header resizes (a wrapping tab strip, a narrower window, a toolbar fold). */
import { useLayoutEffect, useRef, useState } from "react";

export function useBelowHeader() {
  const ref = useRef(null);
  const [top, setTop] = useState(0);
  useLayoutEffect(() => {
    const marker = ref.current, header = marker && marker.previousElementSibling;
    if (!marker || !header) return undefined;
    const measure = () => setTop((t) => (t === marker.offsetTop ? t : marker.offsetTop));
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(header);
    return () => ro.disconnect();
  }, []);
  return [ref, top];
}
