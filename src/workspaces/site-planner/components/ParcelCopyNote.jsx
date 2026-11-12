/* The "this lot came from a COPY of the county's data" line (NEW-1, owner request 2026-10-29: "use the copy, but then just state
 * that it's a copy and state the date that it came from. And then maybe we say something about, like, please contact X if you'd like Y").
 * One short plain line (publisher + date, from lib/parcelCopies.js) and the same "Email Michael to request it" button the
 * no-parcel-data message carries, with the ask worded for this case. Renders NOTHING for an official county / statewide row.
 * Module scope; theme tokens only; no DOM dependency, so it renders in a unit test. Shared by the address-search card and the
 * Add-parcel result so the two cannot grow apart. */
import { useState, useEffect } from "react";
import { parcelCopyNotice, hasLiveCopyDate, readLiveCopyAsOf } from "../lib/parcelCopies.js";
import ParcelRequestLink from "./ParcelRequestLink.jsx";

/* NEW-2 (2026-11-12): a live-date county (Fort Bend) reads the layer's own last-edit month once; until it answers — and if it never does — the line says "date not published". */
function useLiveAsOf(county) {
  const [v, setV] = useState(null);
  useEffect(() => {
    let live = true;
    setV(null);
    if (hasLiveCopyDate(county)) readLiveCopyAsOf(county).then((r) => { if (live) setV(r); });
    return () => { live = false; };
  }, [county]);
  return v;
}

export default function ParcelCopyNote({ county, point, testId = "parcel-copy-note", style }) {
  const liveAsOf = useLiveAsOf(county);
  const n = parcelCopyNotice(county, point, liveAsOf);
  if (!n) return null;
  return (
    <div data-testid={testId} style={{ marginTop: 8, fontSize: 11, lineHeight: 1.45, color: "var(--text-secondary)", ...style }}>
      <div data-testid={`${testId}-line`}>{n.line}</div>
      <div data-testid={`${testId}-ask`} style={{ marginTop: 3 }}>{n.ask}</div>
      <ParcelRequestLink href={n.href} testId={`${testId}-request`} />
    </div>
  );
}
