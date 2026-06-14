/* Document Review workspace — placeholder (scaffold). The PDF review core
 * (PDF.js viewer, calibrate-to-scale, measure/count, redline, takeoff rollup)
 * is built here next, on a separate branch (doc-review/pdf-core). Lazy-loaded by
 * the shell so it never affects the Site Planner. */
export default function DocReview() {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", background: "#efeadf", color: "#6b6557", fontFamily: "system-ui, sans-serif", textAlign: "center", padding: 24 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#2c2a26", marginBottom: 8 }}>Document Review</div>
        <div style={{ fontSize: 13.5 }}>Coming soon — PDF takeoff &amp; review.</div>
      </div>
    </div>
  );
}
