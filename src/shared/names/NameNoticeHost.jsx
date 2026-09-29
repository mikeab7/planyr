/* NameNoticeHost — the one visible surface for a rejected/failed rename (LOUD-FAILURE). Mounted
 * once in Shell; every rename entry point announces through `announceNameNotice`. */
import { useEffect, useState } from "react";
import FloatingNotice from "../ui/FloatingNotice.jsx";
import { RADIUS } from "../ui/radius.js";
import { subscribeNameNotices } from "./nameCore.js";

export default function NameNoticeHost() {
  const [note, setNote] = useState(null);
  useEffect(() => subscribeNameNotices((n) => setNote(n)), []);
  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(null), 7000);
    return () => clearTimeout(t);
  }, [note]);
  if (!note) return null;
  return (
    <FloatingNotice testId="name-notice">
      <div role="alert" style={{
        padding: "9px 14px", borderRadius: RADIUS.md, background: "var(--surface-raised, var(--surface))",
        color: "var(--text)", border: "1px solid var(--danger)", fontWeight: 600, fontSize: 13,
      }}>
        {note.message}
      </div>
    </FloatingNotice>
  );
}
