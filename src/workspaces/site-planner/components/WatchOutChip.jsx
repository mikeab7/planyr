/* WatchOutChip (B895) — the ONE consistent rendering for an item-specific screening
 * risk (Atlas-14 study required, NGVD29-vs-NAVD88 datum, a pond berm toeing into the
 * mapped floodplain, a dock-approach grade break, "haul/compaction is your engineer's",
 * …): ⚠ + non-italic bold amber (or, for the loudest cases, danger red), with the
 * longer explanation one native-tooltip hover away via `info` — unchanged from the
 * prior per-call-site styling's title= mechanism, just drawn from one definition so
 * every watch-out looks the same. NEVER used for the generic panel disclaimer — that
 * lives once in the Yield-panel footer (YieldFooterDisclaimer). */
export default function WatchOutChip({ children, info, danger = false, style }) {
  const color = danger ? "var(--danger-text)" : "var(--warn-text)";
  return (
    <div
      title={info || ""}
      style={{ display: "flex", alignItems: "flex-start", gap: 5, margin: "4px 0 0", cursor: info ? "help" : undefined, ...style }}
    >
      <span aria-hidden="true" style={{ flex: "none", fontSize: 11, lineHeight: 1.45, color }}>⚠</span>
      <span style={{ fontSize: 10.5, lineHeight: 1.45, fontWeight: 700, color }}>
        {children}
        {info ? <span aria-hidden="true" style={{ fontSize: 9.5, marginLeft: 4, fontWeight: 400, color: "var(--text-tertiary)" }}>ⓘ</span> : null}
      </span>
    </div>
  );
}
