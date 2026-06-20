# DWG→DXF conversion service (B238) — Google Cloud Run container.
#
# Build context is the /server folder, so the service code + the shared result helper come
# along without the frontend repo:
#   docker build -f server/convert/Dockerfile -t planyr-dwg-convert server/
# Run locally:
#   docker run --rm -p 8080:8080 planyr-dwg-convert
#
# syntax=docker/dockerfile:1

# ── Stage 1: compile LibreDWG's dwg2dxf from source ─────────────────────────────────────
# LibreDWG isn't packaged in Debian/Ubuntu, so we build the official release. Static-linking
# libredwg into the program leaves only libc/libm dynamic, so the runtime stage carries just
# the one ~MB binary — no shared library or ldconfig juggling.
FROM debian:bookworm-slim AS libredwg

ARG LIBREDWG_VERSION=0.13.4
# CURL_INSECURE exists ONLY to build behind this repo's sandbox TLS-inspecting proxy (see
# CLAUDE.md — Chromium/curl don't trust the proxy cert). Production builds (Cloud Build)
# leave it empty → curl does full TLS verification. Pass --build-arg CURL_INSECURE=1 locally.
ARG CURL_INSECURE=

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl build-essential pkg-config python3 xz-utils \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN curl ${CURL_INSECURE:+-k} -fsSL \
      "https://github.com/LibreDWG/libredwg/releases/download/${LIBREDWG_VERSION}/libredwg-${LIBREDWG_VERSION}.tar.xz" \
      -o libredwg.tar.xz \
 && tar -xf libredwg.tar.xz \
 && cd "libredwg-${LIBREDWG_VERSION}" \
 && ./configure --disable-bindings --disable-shared --enable-static --disable-dependency-tracking CFLAGS="-O2 -g0" \
 && make -j"$(nproc)" \
 && install -Ds programs/dwg2dxf /out/dwg2dxf

# ── Stage 2: the conversion service ─────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS service

# The compiled DWG→DXF engine, on PATH as `dwg2dxf` (matches LIBREDWG_BIN's default).
COPY --from=libredwg /out/dwg2dxf /usr/local/bin/dwg2dxf

WORKDIR /app
# ESM marker so the copied server code (import/export) runs under plain `node` without the
# repo's root package.json. No npm install — the service uses only Node built-ins.
RUN printf '{"type":"module","private":true}\n' > package.json
COPY convert/ ./server/convert/
COPY storage/result.js ./server/storage/result.js

ENV NODE_ENV=production \
    PORT=8080
EXPOSE 8080

# Least privilege: the stock node image ships a non-root `node` user; /tmp stays writable
# for the temp DWG/DXF files.
USER node

CMD ["node", "server/convert/server.js"]
