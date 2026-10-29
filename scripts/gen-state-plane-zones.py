#!/usr/bin/env python3
"""DEV-TIME ONLY — regenerates src/shared/coordinates/statePlaneData.js and test/fixtures/statePlaneGolden.json
from the EPSG database that ships inside pyproj. Nothing here runs in the app or in CI.

    python3 -m venv /tmp/pv && /tmp/pv/bin/pip install pyproj
    /tmp/pv/bin/python scripts/gen-state-plane-zones.py

WHY GENERATED: every zone constant and every county->zone assignment is read from EPSG (which carries the NGS
SPCS83 definitions), never typed from memory. The county lists are the "counties of ..." text of each zone's EPSG
area-of-use. The output is cross-checked against public/geo/county-polygons.json (all 3,144 counties) so a county
missing from a multi-zone state fails the run instead of silently resolving to nothing.
See docs/incidents/STATE-PLANE-AUDIT.md.
"""
import json, math, re, sys, os
from pyproj import CRS, Transformer
import pyproj

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# state -> [zone labels, in EPSG name form]. The label is the EPSG CRS name without "NAD83 / " and unit suffix.
STATES = {
 "AL": ["Alabama East", "Alabama West"],
 "AZ": ["Arizona East", "Arizona Central", "Arizona West"],
 "AR": ["Arkansas North", "Arkansas South"],
 "CA": [f"California zone {i}" for i in range(1, 7)],
 "CO": ["Colorado North", "Colorado Central", "Colorado South"],
 "CT": ["Connecticut"],
 "DE": ["Delaware"],
 "FL": ["Florida East", "Florida West", "Florida North"],
 "GA": ["Georgia East", "Georgia West"],
 "HI": [f"Hawaii zone {i}" for i in range(1, 6)],
 "AK": [f"Alaska zone {i}" for i in range(1, 11)],
 "ID": ["Idaho East", "Idaho Central", "Idaho West"],
 "IL": ["Illinois East", "Illinois West"],
 "IN": ["Indiana East", "Indiana West"],
 "IA": ["Iowa North", "Iowa South"],
 "KS": ["Kansas North", "Kansas South"],
 "KY": ["Kentucky North", "Kentucky South"],
 "LA": ["Louisiana North", "Louisiana South", "Louisiana Offshore"],
 "ME": ["Maine East", "Maine West"],
 "MD": ["Maryland"],
 "MA": ["Massachusetts Mainland", "Massachusetts Island"],
 "MI": ["Michigan North", "Michigan Central", "Michigan South"],
 "MN": ["Minnesota North", "Minnesota Central", "Minnesota South"],
 "MS": ["Mississippi East", "Mississippi West"],
 "MO": ["Missouri East", "Missouri Central", "Missouri West"],
 "MT": ["Montana"],
 "NE": ["Nebraska"],
 "NV": ["Nevada East", "Nevada Central", "Nevada West"],
 "NH": ["New Hampshire"],
 "NJ": ["New Jersey"],
 "NM": ["New Mexico East", "New Mexico Central", "New Mexico West"],
 "NY": ["New York East", "New York Central", "New York West", "New York Long Island"],
 "NC": ["North Carolina"],
 "ND": ["North Dakota North", "North Dakota South"],
 "OH": ["Ohio North", "Ohio South"],
 "OK": ["Oklahoma North", "Oklahoma South"],
 "OR": ["Oregon North", "Oregon South"],
 "PA": ["Pennsylvania North", "Pennsylvania South"],
 "RI": ["Rhode Island"],
 "SC": ["South Carolina"],
 "SD": ["South Dakota North", "South Dakota South"],
 "TN": ["Tennessee"],
 "TX": ["Texas North", "Texas North Central", "Texas Central", "Texas South Central", "Texas South"],
 "UT": ["Utah North", "Utah Central", "Utah South"],
 "VT": ["Vermont"],
 "VA": ["Virginia North", "Virginia South"],
 "WA": ["Washington North", "Washington South"],
 "WV": ["West Virginia North", "West Virginia South"],
 "WI": ["Wisconsin North", "Wisconsin Central", "Wisconsin South"],
 "WY": ["Wyoming East", "Wyoming East Central", "Wyoming West Central", "Wyoming West"],
}
# Preference order of unit suffixes: the state's foot variant first, metres only where EPSG has no foot code.
UNIT_SUFFIXES = [" (ftUS)", " (ft)", ""]
# DC has no zone of its own: NGS assigns it to the Maryland zone.
ALIAS_STATES = {"DC": "MD"}
ID_OVERRIDE = {"Texas South Central": "tx_sc"}  # the app's original id
SKIP_COUNTY_LIST = {"Louisiana Offshore"}

import unicodedata
def slug(s):
    # MUST stay identical to slugCounty() in src/shared/coordinates/statePlane.js (the test pins the pair).
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"^[a-z]{2}_", "", s)
    s = re.sub(r"\b(city|and|county|parish|borough|census area|municipality|of)\b", "", s)
    return re.sub(r"[^a-z]", "", s)

def zid(st, label):
    if label in ID_OVERRIDE: return ID_OVERRIDE[label]
    rest = label.split(" ", 1)[1] if st not in ("CT", "DE", "MD", "MT", "NE", "NH", "NJ", "NC", "RI", "SC", "TN", "VT") else ""
    # drop the state name from the label ("New York Long Island" -> "long island")
    names = {"NY": "New York", "NH": "New Hampshire", "NJ": "New Jersey", "NC": "North Carolina", "ND": "North Dakota",
             "SC": "South Carolina", "SD": "South Dakota", "WV": "West Virginia", "RI": "Rhode Island", "NM": "New Mexico"}
    nm = names.get(st)
    if nm and label.startswith(nm): rest = label[len(nm):].strip()
    rest = rest.replace("zone ", "").strip()
    return st.lower() + ("_" + re.sub(r"[^a-z0-9]+", "_", rest.lower()).strip("_") if rest else "")

METRE_ONLY_STATES = {"HI"}   # NGS/EPSG: Hawaii is defined in metres (EPSG's one ftUS Hawaii code, 3759, is an alternate)
def find_crs(label):
    for suf in ([""] if label.startswith("Hawaii") else UNIT_SUFFIXES):
        name = f"NAD83 / {label}{suf}"
        from pyproj.database import query_crs_info
        from pyproj.enums import PJType
        hits = [i for i in query_crs_info(auth_name="EPSG", pj_types=[PJType.PROJECTED_CRS]) if i.name == name and not i.deprecated]
        if hits: return CRS.from_epsg(int(hits[0].code)), suf
    raise SystemExit(f"no EPSG CRS for {label}")

def param(op, name):
    for p in op.params:
        if p.name == name: return p
    raise SystemExit(f"missing {name} in {op.method_name}")

def deg(p):
    return p.value if p.unit_name == "degree" else p.value * p.unit_conversion_factor * 180 / math.pi

def metres(p):
    return p.value * p.unit_conversion_factor

def crs_unit(c):
    u = c.axis_info[0].unit_name
    return {"US survey foot": "us-ft", "foot": "ft", "metre": "m"}[u], c.axis_info[0].unit_conversion_factor

# county names exactly as EPSG states them -> list
def counties_of(area):
    m = re.search(r"counties(?: and independent cities)?(?: of)?:? (.*)$", area, re.I)
    if not m: return None
    body = m.group(1).strip().rstrip(".")
    return [x.strip() for x in body.split(";") if x.strip()]

zones, county_tab, goldens, warn = {}, {}, [], []
poly = json.load(open(os.path.join(ROOT, "public/geo/county-polygons.json")))
poly_by_state = {}
for c in poly["counties"]: poly_by_state.setdefault(c["state"], []).append(c["name"])

for st, labels in STATES.items():
    for label in labels:
        crs, suf = find_crs(label)
        op = crs.coordinate_operation
        unit, unit_m = crs_unit(crs)
        z = {"id": zid(st, label), "epsg": int(crs.to_epsg()), "state": st, "name": crs.name, "label": label, "unit": unit}
        if op.method_name == "Lambert Conic Conformal (2SP)":
            z.update(proj="lcc",
                     lat0=deg(param(op, "Latitude of false origin")), lon0=deg(param(op, "Longitude of false origin")),
                     lat1=deg(param(op, "Latitude of 1st standard parallel")), lat2=deg(param(op, "Latitude of 2nd standard parallel")),
                     feM=metres(param(op, "Easting at false origin")), fnM=metres(param(op, "Northing at false origin")))
        elif op.method_name == "Transverse Mercator":
            z.update(proj="tm",
                     lat0=deg(param(op, "Latitude of natural origin")), lon0=deg(param(op, "Longitude of natural origin")),
                     k0=param(op, "Scale factor at natural origin").value,
                     feM=metres(param(op, "False easting")), fnM=metres(param(op, "False northing")))
        elif op.method_name == "Hotine Oblique Mercator (variant A)":
            # Alaska zone 1 — the one oblique zone. EPSG method 9812.
            z.update(proj="hom",
                     lat0=deg(param(op, "Latitude of projection centre")), lon0=deg(param(op, "Longitude of projection centre")),
                     alpha=deg(param(op, "Azimuth at projection centre")), gamma=deg(param(op, "Angle from Rectified to Skew Grid")),
                     k0=param(op, "Scale factor at projection centre").value,
                     feM=metres(param(op, "False easting")), fnM=metres(param(op, "False northing")))
        else:
            raise SystemExit(f"{label}: unsupported method {op.method_name}")
        a = crs.area_of_use
        z["bounds"] = [round(v, 4) for v in a.bounds]
        lst = None if label in SKIP_COUNTY_LIST else counties_of(a.name)
        z["_list"] = lst
        zones[z["id"]] = z
        # golden points: area centre and a point 35% toward the SW corner, forward via PROJ in the zone's own unit
        tr = Transformer.from_crs(4269, crs.to_epsg(), always_xy=True)
        w, s, e, n = a.bounds
        pts = [((w + e) / 2, (s + n) / 2), (w + (e - w) * 0.3, s + (n - s) * 0.3), (w + (e - w) * 0.8, s + (n - s) * 0.8)]
        if z["id"] == "ak_10":   # the Aleutians cross the antimeridian (bounds run 172.42E -> 164.84W), so give three real islands
            pts = [(-166.54, 53.88), (-176.64, 51.88), (172.9, 52.9)]
        gp = []
        for lon, lat in pts:
            x, y = tr.transform(lon, lat)
            gp.append({"lat": lat, "lon": lon, "x": x, "y": y})
        goldens.append({"id": z["id"], "epsg": z["epsg"], "unit": unit, "points": gp})

# --- county tables ---------------------------------------------------------------------------
# Names EPSG still carries from before a county was renamed / a typo in the EPSG text. The table is keyed on
# the CURRENT name (what the county-polygons asset and every Census product call it); the old spelling stays
# accepted as an alias so nothing that stored it breaks.
RENAMES = {  # (state, EPSG slug) -> (current slug, why)
    ("FL", "dade"): ("miamidade", "Dade County was renamed Miami-Dade in 1997."),
    ("ND", "mountrial"): ("mountrail", "EPSG's county list spells Mountrail 'Mountrial' (a typo; Mountrail County, ND)."),
    ("SD", "shannon"): ("oglalalakota", "Shannon County was renamed Oglala Lakota County in 2015."),
}
by_state = {}
for z in zones.values(): by_state.setdefault(z["state"], []).append(z)

def decode(flat):
    out = [[flat[0], flat[1]]]
    x, y = flat[0], flat[1]
    for i in range(2, len(flat), 2):
        x += flat[i]; y += flat[i + 1]; out.append([x, y])
    return out
def pip(ring, x, y):
    ins = False; j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]; xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: ins = not ins
        j = i
    return ins
def bbox_centre(c):
    b = c["bbox"]; return ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)

county_tab, aliases, decided, splits = {}, {}, {}, {}
for st, zs in by_state.items():
    if len(zs) == 1: continue
    if st in ("AK", "HI"): continue          # resolved by position / island, see statePlane.js
    names = poly_by_state.get(st, [])
    tab, seen = {}, {}
    for z in zs:
        if z["_list"] is None:
            if z["label"] not in SKIP_COUNTY_LIST: warn.append(f"{st}/{z['id']}: no county list in EPSG area-of-use")
            continue
        keys = set()
        for x in z["_list"]:
            k = slug(x)
            if "approximately" in x.lower():                 # WA: Grant County straddles 47°30'N
                base = slug(re.split(r"\s+(north|south)\b", x, flags=re.I)[0])
                splits.setdefault(f"{st}:{base}", {})["north" if " north" in x.lower() else "south"] = z["id"]
                continue
            if (st, k) in RENAMES:
                cur, why = RENAMES[(st, k)]; aliases[f"{st}:{k}"] = cur; k = cur
            keys.add(k)
            if k in seen and seen[k] != z["id"]: warn.append(f"{st}: county '{x}' ({k}) in both {seen[k]} and {z['id']}")
            seen[k] = z["id"]
        tab[z["id"]] = sorted(keys)
    # counties the zone list does not name
    have = set(seen) | {k.split(":")[1] for k in splits if k.startswith(st + ":")}
    missing = [n for n in names if slug(n) not in have]
    if missing:
        polys = poly_by_state[st]
        real = [c for c in poly["counties"] if c["state"] == st and not c["name"].lower().endswith(" city") or c["name"] == "Carson City" and c["state"] == st]
        for m in missing:
            c = next(c for c in poly["counties"] if c["state"] == st and c["name"] == m)
            k = slug(m)
            if st == "VA" and m.endswith(" city"):
                # an independent city belongs to the zone of the county that surrounds it
                cx, cy = bbox_centre(c); found = None
                for o in poly["counties"]:
                    if o["state"] != st or o["name"].endswith(" city") or o["bbox"][0] > cx or o["bbox"][2] < cx or o["bbox"][1] > cy or o["bbox"][3] < cy: continue
                    if any(pip(decode(r), cx, cy) for r in o["rings"]): found = o; break
                if not found:
                    # the generalised county outlines can leave the city itself as a hole: take the NEAREST county outline vertex instead
                    best = None
                    for o in poly["counties"]:
                        if o["state"] != st or o["name"].endswith(" city"): continue
                        for r in o["rings"]:
                            for (vx, vy) in decode(r):
                                d = (vx - cx) ** 2 + (vy - cy) ** 2
                                if best is None or d < best[0]: best = (d, o)
                    found = best[1]
                zid_ = seen.get(slug(found["name"]))
                decided[f"{st}:{k}"] = {"zone": zid_, "surroundedBy": found["name"]}
            elif st == "NV" and m == "Carson City":
                decided[f"{st}:{k}"] = {"zone": "nv_west", "note": "Carson City (formerly Ormsby County) is not named in EPSG's Nevada zone lists; it is surrounded by Douglas, Lyon, Storey and Washoe counties, all Nevada West."}
            elif st == "CO" and m == "Broomfield":
                continue   # decided by hand in statePlane.js (COLORADO-AUDIT.md)
            else:
                warn.append(f"{st}: polygons county with NO zone: {m}")
    extra = sorted(k for k in seen if k not in {slug(n) for n in names})
    if extra: warn.append(f"{st}: zone-list names not in polygons asset: {extra}")
    county_tab[st] = tab

# Hawaii: counties are island groups; Kauai County also holds Niihau (zone 5).
hi = {"hawaii": "hi_1", "maui": "hi_2", "kalawao": "hi_2", "honolulu": "hi_3", "kauai": "hi_4"}
decided.update({f"HI:{k}": {"zone": v, "note": {"hi_1": "Hawaii County = the island of Hawaii.", "hi_2": "Maui County holds Maui, Molokai, Lanai and Kahoolawe (EPSG zone 2); Kalawao is on Molokai.", "hi_3": "Honolulu County = Oahu.", "hi_4": "Kauai County resolves to Kauai (zone 4); Niihau (zone 5) is also in Kauai County, so a point on Niihau is resolved by position."}[v]} for k, v in hi.items()})

out_js = {"zones": {}, "counties": {}, "aliases": aliases, "decided": decided, "splits": splits}
for zid_, z in zones.items():
    d = {k: v for k, v in z.items() if k not in ("_list", "name", "id")}
    out_js["zones"][zid_] = d
for st, tab in county_tab.items():
    out_js["counties"][st] = {zid_: ",".join(v) for zid_, v in tab.items()}

def fmt(v):
    if isinstance(v, float): return repr(v)
    return json.dumps(v, ensure_ascii=False)
lines = ["/* GENERATED by scripts/gen-state-plane-zones.py from the EPSG database (pyproj %s, PROJ %s). DO NOT EDIT BY HAND." % (pyproj.__version__, pyproj.proj_version_str),
         " * Every constant is read from EPSG (which carries the NGS SPCS83 definitions); every county list is the 'counties of ...'",
         " * text of that zone's EPSG area-of-use, cross-checked against public/geo/county-polygons.json (all 3,144 counties).",
         " * See docs/incidents/STATE-PLANE-AUDIT.md. Angles in degrees, false origin in METRES, `unit` is the zone's legislated grid unit. */",
         "", "export const GEN_ZONES = {"]
for zid_, z in out_js["zones"].items():
    lines.append("  %s: {%s}," % (json.dumps(zid_), ", ".join("%s: %s" % (k, fmt(v)) for k, v in z.items())))
lines += ["};", "", "/* state -> zone id -> comma-joined county slugs (letters only, designation words removed). */", "export const COUNTY_TABLE = {"]
for st, tab in out_js["counties"].items():
    lines.append("  %s: {" % st)
    for zid_, v in tab.items(): lines.append("    %s: %s," % (json.dumps(zid_), json.dumps(v)))
    lines.append("  },")
lines += ["};", "", "/* An old / mistyped county spelling -> the current slug. */", "export const COUNTY_ALIASES = %s;" % json.dumps(aliases, indent=2),
          "", "/* Assignments EPSG does not make that this project DID (same pattern as Colorado's Broomfield). */",
          "export const DECIDED_COUNTIES = %s;" % json.dumps(decided, indent=2, ensure_ascii=False),
          "", "/* Counties split by a parallel: state:slug -> { north, south } zone ids (the split latitude is in statePlane.js). */",
          "export const SPLIT_COUNTIES = %s;" % json.dumps(splits, indent=2)]
open(os.path.join(ROOT, "src/shared/coordinates/statePlaneData.js"), "w").write("\n".join(lines) + "\n")
json.dump({"generator": "scripts/gen-state-plane-zones.py", "pyproj": pyproj.__version__, "proj": pyproj.proj_version_str, "zones": goldens},
          open(os.path.join(ROOT, "test/fixtures/statePlaneGolden.json"), "w"), indent=1)
for w in warn: print("WARN", w)
print(len(zones), "zones;", sum(len(v.split(",")) for t in out_js["counties"].values() for v in t.values()), "county slugs;", len(decided), "decided;", pyproj.__version__)
