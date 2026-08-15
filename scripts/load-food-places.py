#!/usr/bin/env python3
"""
load-food-places.py — one-time ETL: Overture Maps' open Places snapshot -> food_places.csv (B568400).

WHAT THIS IS. The /food module never calls a paid API at runtime (the owner's hard rule: "I'm
not trying to pay a dime"). Instead it loads a SNAPSHOT once: Overture Maps publishes an open,
no-key-required Places dataset on public S3 (s3://overturemaps-us-west-2/release/<version>/
theme=places/type=place/*.parquet, GeoParquet, ~13 GB globally across 16 files for the
2026-07-22.0 release). This script pulls only the Houston-metro slice, filters it to eat-and-
-drink places, and writes a CSV that food.sql's loader path (see the bottom of this file) bulk-
inserts into Supabase. Re-run this once or twice a year to refresh the snapshot — it is NOT a
live dependency of the app.

WHY PYTHON, not Node like every other script in this repo. Reading a *remote* GeoParquet file
efficiently needs per-row-group column statistics for spatial pruning (see below) — pyarrow
gives that for free, dependency-free (no native toolchain to compile). This repo has no Node
parquet reader with the same row-group-stats API, and this script runs at BUILD/ETL time only —
it never ships to the browser, so it has zero effect on the client bundle or the perf-bundle
gate (BUNDLE-ISOLATION). Requires: `pip install pyarrow requests`.

HOW THE PRUNING WORKS (so a re-run doesn't accidentally download 13 GB). Overture's writer sorts
each file by a spatial-filling curve, so nearby places land in the same row groups. Every place
row also carries a flat `bbox {xmin,xmax,ymin,ymax}` struct (degenerate to the point itself,
since a place's geometry is always a POINT) — and Parquet stores per-row-group min/max statistics
for that struct's leaf columns for free. So: open each file's footer (cheap — one or two small
range reads), read every row group's bbox stats, and only fetch+decode the row groups whose
bbox actually overlaps the Houston-metro window. Measured on the 2026-07-22.0 release: of
16 files / 5,120 row groups total, exactly 45 row groups in ONE file intersect the window
(~387k rows of every category); fetching only those took ~68s and ~80 MB over the wire.

CATEGORY FILTER. Overture stamps every place with `taxonomy.hierarchy`, the FULL parent chain
from Foursquare's open category taxonomy. The eat-and-drink top-level group is literally named
`food_and_drink` in that hierarchy (restaurants, bars, cafes, bakeries, food trucks, dessert
shops, ... — but NOT a `food_and_beverage_store` grocery retailer, which sits under `shopping`).
Filtering on `hierarchy[0] == 'food_and_drink'` is therefore exact — no substring/keyword
guessing needed.

LICENSING (attribution requirement — see food.sql's `source`/`source_licence` columns and the
UI attribution line). Overture aggregates several open datasets under ONE umbrella licence
(CDLA-Permissive-2.0) except the Foursquare-contributed rows (Apache-2.0) and AllThePlaces rows
(CC0-1.0). Each place's `sources` list names its actual contributor(s); this script records the
first non-Overture-internal source's dataset + licence per row, so the UI can attribute correctly
per place rather than guessing one licence for everything.

USAGE
  pip install pyarrow requests
  python3 scripts/load-food-places.py [--bbox W,S,E,N] [--min-confidence 0.5] [--out FILE]

Then load FILE into Supabase (see src/workspaces/food/db/food.sql's header for the loader path,
or hand the CSV + the anon-writeable-nowhere reference table to a session with Supabase MCP
access — food_places is service-role-write-only by design).
"""
import argparse
import csv
import io
import os
import sys
import time
from urllib.parse import quote

try:
    import pyarrow.parquet as pq
except ImportError:
    sys.exit("Missing dependency: pip install pyarrow requests")

try:
    import requests
except ImportError:
    sys.exit("Missing dependency: pip install pyarrow requests")

BUCKET = "overturemaps-us-west-2"
S3_BASE = f"https://{BUCKET}.s3.amazonaws.com"
PLACES_PREFIX = "theme=places/type=place/"

# Houston-metro bbox: west,south,east,north (WGS84 degrees). Roughly Katy -> Baytown,
# Galveston Bay -> The Woodlands/Conroe. Widen this to cover a bigger service area later —
# it is the ONLY thing that needs to change to re-scope the snapshot.
DEFAULT_BBOX = (-96.0, 29.0, -94.6, 30.5)
DEFAULT_MIN_CONFIDENCE = 0.5

COLUMNS = ["id", "categories", "taxonomy", "confidence", "addresses", "names", "brand", "sources", "bbox"]


class S3RangeFile(io.RawIOBase):
    """A read-only, seekable file-like object over a public S3 key, fetched via plain
    HTTPS Range requests (no AWS SDK / credentials needed — the Overture bucket is public-read).
    This is what lets pyarrow read a GeoParquet file's footer + only the row groups it asks for,
    without downloading the whole (up to ~950 MB) file."""

    def __init__(self, key, session):
        self.key = key
        self.session = session
        self.pos = 0
        self.url = f"{S3_BASE}/{quote(key)}"
        head = session.head(self.url, timeout=30)
        head.raise_for_status()
        self.size = int(head.headers["Content-Length"])

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        if whence == 0:
            self.pos = offset
        elif whence == 1:
            self.pos += offset
        elif whence == 2:
            self.pos = self.size + offset
        return self.pos

    def read(self, n=-1):
        end = (self.size - 1) if (n is None or n < 0) else min(self.pos + n, self.size) - 1
        if self.pos > end:
            return b""
        resp = self.session.get(self.url, headers={"Range": f"bytes={self.pos}-{end}"}, timeout=60)
        resp.raise_for_status()
        data = resp.content
        self.pos += len(data)
        return data


def list_place_files(session):
    resp = session.get(f"{S3_BASE}/", params={"list-type": "2", "prefix": f"release/", "delimiter": "/"}, timeout=30)
    resp.raise_for_status()
    import xml.etree.ElementTree as ET
    ns = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
    releases = sorted(p.find("s3:Prefix", ns).text for p in ET.fromstring(resp.text).findall("s3:CommonPrefixes", ns))
    latest = releases[-1]
    resp = session.get(f"{S3_BASE}/", params={"list-type": "2", "prefix": f"{latest}{PLACES_PREFIX}"}, timeout=30)
    resp.raise_for_status()
    keys = [c.find("s3:Key", ns).text for c in ET.fromstring(resp.text).findall("s3:Contents", ns)]
    return latest, keys


def pick_source(sources):
    if not sources:
        return (None, None)
    non_overture = [s for s in sources if s.get("dataset") and not str(s["dataset"]).lower().startswith("overture")]
    s = non_overture[0] if non_overture else sources[0]
    return (s.get("dataset"), s.get("license"))


def fmt_addr(addrs):
    if not addrs:
        return None
    a = addrs[0]
    return ", ".join(p for p in (a.get("freeform"), a.get("locality"), a.get("region"), a.get("postcode")) if p)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bbox", default=",".join(str(x) for x in DEFAULT_BBOX), help="west,south,east,north")
    ap.add_argument("--min-confidence", type=float, default=DEFAULT_MIN_CONFIDENCE)
    ap.add_argument("--out", default="food_places_houston.csv")
    args = ap.parse_args()
    W, S, E, N = (float(x) for x in args.bbox.split(","))

    session = requests.Session()
    session.headers["User-Agent"] = "planyr-food-loader/1 (one-time ETL script, see scripts/load-food-places.py)"

    print(f"Discovering the latest Overture release...", file=sys.stderr)
    release, keys = list_place_files(session)
    print(f"Release {release}: {len(keys)} place files. Scanning row-group bbox stats for {args.bbox}...", file=sys.stderr)

    rows_out, seen_ids = [], set()
    scanned = 0
    t0 = time.time()
    for key in keys:
        f = S3RangeFile(key, session)
        pf = pq.ParquetFile(f)
        names = pf.schema.names
        ix = {n: names.index(n) for n in ("xmin", "xmax", "ymin", "ymax")}
        hit_rgs = []
        for rg in range(pf.metadata.num_row_groups):
            rgmeta = pf.metadata.row_group(rg)
            rg_xmin = rgmeta.column(ix["xmin"]).statistics.min
            rg_xmax = rgmeta.column(ix["xmax"]).statistics.max
            rg_ymin = rgmeta.column(ix["ymin"]).statistics.min
            rg_ymax = rgmeta.column(ix["ymax"]).statistics.max
            if not (rg_xmax < W or rg_xmin > E or rg_ymax < S or rg_ymin > N):
                hit_rgs.append(rg)
        if not hit_rgs:
            continue
        print(f"  {key.split('/')[-1]}: fetching {len(hit_rgs)} of {pf.metadata.num_row_groups} row groups", file=sys.stderr)
        for rg in hit_rgs:
            batch = pf.read_row_group(rg, columns=COLUMNS).to_pylist()
            scanned += len(batch)
            for r in batch:
                bbox = r["bbox"]
                lon, lat = bbox["xmin"], bbox["ymin"]
                if not (W <= lon <= E and S <= lat <= N):
                    continue
                tax = r["taxonomy"]
                if not tax or tax.get("hierarchy") is None or "food_and_drink" not in tax["hierarchy"]:
                    continue
                conf = r["confidence"]
                if conf is not None and conf < args.min_confidence:
                    continue
                if r["id"] in seen_ids:
                    continue
                seen_ids.add(r["id"])
                cat = r["categories"] or {}
                src, lic = pick_source(r["sources"])
                rows_out.append({
                    "id": r["id"],
                    "name": (r["names"] or {}).get("primary"),
                    "lat": lat,
                    "lon": lon,
                    "category": cat.get("primary"),
                    "cuisine": (tax.get("hierarchy") or [None])[-1],
                    "address": fmt_addr(r["addresses"]),
                    "brand": ((r["brand"] or {}).get("names") or {}).get("primary"),
                    "source": src,
                    "source_licence": lic,
                    "confidence": conf,
                })

    elapsed = time.time() - t0
    print(f"Scanned {scanned} places, kept {len(rows_out)} food-and-drink places in {elapsed:.1f}s.", file=sys.stderr)

    if not rows_out:
        sys.exit("No rows matched — check --bbox.")

    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows_out[0].keys()))
        w.writeheader()
        w.writerows(rows_out)

    size = os.path.getsize(args.out)
    print(f"Wrote {len(rows_out)} rows, {size / 1024 / 1024:.1f} MiB -> {args.out}", file=sys.stderr)
    print("Next: bulk-load this CSV into the food_places table (service-role write; see food.sql's header).", file=sys.stderr)


if __name__ == "__main__":
    main()
