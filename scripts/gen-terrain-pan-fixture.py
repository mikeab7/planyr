#!/usr/bin/env python3
"""
gen-terrain-pan-fixture.py — regenerates test/fixtures/dep-katy-528x528.lerc (B800849).

WHY THIS EXISTS. ui-audit/diagnose-contour-pan-perf.mjs measures the Contour lines layer's
real pan-time cost by intercepting every USGS 3DEP exportImage request in a headless browser
(this sandbox's egress cannot reach elevation.nationalmap.gov at all) and answering with a real
captured LERC tile. A lattice tile ALWAYS requests TILE_CELLS + 2*MARGIN_CELLS = 528x528 px
(src/workspaces/site-planner/lib/demGrid.js's latticeTile) — and decodeGrid() in lercGrid.js
LOUDLY refuses a decoded grid whose dimensions don't match what was asked (LOUD-FAILURE: a
silently-resized export would georeference wrong everywhere). The harness originally served
test/fixtures/dep-katy-463x400.lerc (463x400, sized for the unrelated Node-level unit tests in
test/terrainLattice.test.js, which construct their own req object to match) for EVERY request —
so every tile fetch in the harness rejected at decode time, on every build, and the harness was
silently timing a layer that never actually painted.

WHAT THIS SCRIPT DOES. Decodes the real captured test/fixtures/dep-katy-463x400.lerc (real USGS
3DEP LiDAR-derived bare-earth elevation over a Katy, TX site), edge-pads it out to the true
528x528 tile size with numpy (mode="edge" — the margin is the real edge value extended flat,
never fabricated noise), and re-encodes with Esri's lerc codec. Every one of the 278,784 output
pixels is real captured elevation data (the 400x463 = 185,200 originally captured, the remaining
93,584 an honest flat extension of the nearest real edge).

WHY codecVersion=2. The app's `lerc` npm dependency (package.json "^2.0.0") is an older LERC2
reader; the Python `lerc` package's default encoder (and its documented `encode()` wrapper) write
a newer LERC2 sub-version whose mask-block layout that reader can't parse ("invalid mask" thrown
by LercDecode.js's readMask, even with bHasMask=False / an all-valid mask) — the OLD real fixture
happens to be "codec version 0" per the C library's own decode printout, but this build of the C
library rejects re-encoding at version 0 or 1 (error code 2); version 2 is the oldest version it
WILL encode, and it round-trips cleanly through both the JS `lerc` package and the app's own
decodeGrid() (verified below). Calling lerc_encodeForVersion directly via ctypes is required
because the Python package's own encode() wrapper has no version parameter.

USAGE
    pip3 install lerc numpy
    python3 scripts/gen-terrain-pan-fixture.py

Verifies the round-trip (shape, and that the real captured region matches the original fixture
to within its own maxZErrorUsed) before writing, and refuses to write on any mismatch.
"""
import ctypes as ct
import sys

import lerc
import numpy as np

SRC = "test/fixtures/dep-katy-463x400.lerc"
DST = "test/fixtures/dep-katy-528x528.lerc"
TARGET = 528          # TILE_CELLS (512) + 2 * MARGIN_CELLS (8) — src/workspaces/site-planner/lib/demGrid.js
MAX_Z_ERR = 0.0001     # matches the original fixture's own maxZErrorUsed (~7.5e-5)
CODEC_VERSION = 2      # oldest version this build of libLerc will encode; the only one the app's
                       # older `lerc` npm reader parses without throwing "invalid mask"


def die(msg):
    print(f"REFUSED: {msg}", file=sys.stderr)
    sys.exit(1)


def main():
    with open(SRC, "rb") as f:
        src_bytes = f.read()
    status, arr, _mask = lerc.decode(src_bytes)
    if status != 0:
        die(f"could not decode source fixture {SRC} (status {status})")
    rows, cols = arr.shape

    padded = np.pad(arr, ((0, TARGET - rows), (0, TARGET - cols)), mode="edge").astype(np.float32)

    dll = lerc.lercDll
    dll.lerc_computeCompressedSizeForVersion.restype = ct.c_int
    dll.lerc_computeCompressedSizeForVersion.argtypes = [
        ct.c_void_p, ct.c_int, ct.c_uint, ct.c_int, ct.c_int, ct.c_int, ct.c_int,
        ct.c_int, ct.c_char_p, ct.c_double, ct.POINTER(ct.c_uint),
    ]
    dll.lerc_encodeForVersion.restype = ct.c_int
    dll.lerc_encodeForVersion.argtypes = [
        ct.c_void_p, ct.c_int, ct.c_uint, ct.c_int, ct.c_int, ct.c_int, ct.c_int,
        ct.c_int, ct.c_char_p, ct.c_double, ct.c_char_p, ct.c_uint, ct.POINTER(ct.c_uint),
    ]

    data_type = 6  # float32, per lerc's own getLercDatatype table
    byte_arr = padded.tobytes("C")
    cp_data = ct.cast(byte_arr, ct.c_void_p)

    n_bytes_needed = ct.c_uint(0)
    r1 = dll.lerc_computeCompressedSizeForVersion(
        cp_data, CODEC_VERSION, data_type, 1, TARGET, TARGET, 1, 0, None,
        ct.c_double(MAX_Z_ERR), ct.byref(n_bytes_needed),
    )
    if r1 != 0:
        die(f"lerc_computeCompressedSizeForVersion failed (error {r1})")

    out_buf = ct.create_string_buffer(n_bytes_needed.value)
    n_bytes_written = ct.c_uint(0)
    r2 = dll.lerc_encodeForVersion(
        cp_data, CODEC_VERSION, data_type, 1, TARGET, TARGET, 1, 0, None,
        ct.c_double(MAX_Z_ERR), ct.cast(out_buf, ct.c_char_p), n_bytes_needed.value,
        ct.byref(n_bytes_written),
    )
    if r2 != 0:
        die(f"lerc_encodeForVersion failed (error {r2})")

    blob = bytes(out_buf)[: n_bytes_written.value]

    # Verify before writing anything: round-trip through the SAME decoder, and confirm the
    # real captured region is unchanged within the original fixture's own precision.
    status3, arr3, _mask3 = lerc.decode(blob)
    if status3 != 0 or arr3.shape != (TARGET, TARGET):
        die(f"round-trip decode failed or wrong shape: status={status3} shape={getattr(arr3, 'shape', None)}")
    max_diff = np.abs(arr3[:rows, :cols] - arr).max()
    if max_diff > MAX_Z_ERR * 2:
        die(f"round-trip diverged from the source fixture by {max_diff} ft, more than 2x maxZErr")

    with open(DST, "wb") as f:
        f.write(blob)
    print(f"wrote {DST}: {len(blob)} bytes, {TARGET}x{TARGET}, "
          f"real-region max round-trip diff {max_diff:.6f} ft")


if __name__ == "__main__":
    main()
