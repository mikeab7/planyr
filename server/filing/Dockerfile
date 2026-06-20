# Auto-filing service (B297) — Google Cloud Run container.
#
# Build context is the /server folder, so the service code + the shared result helper come
# along without the frontend repo:
#   docker build -f server/filing/Dockerfile -t planyr-doc-filing server/
# Run locally (needs ANTHROPIC_API_KEY in the env to actually read; /health works without):
#   docker run --rm -p 8080:8080 -e ANTHROPIC_API_KEY=sk-... planyr-doc-filing
#   curl -s localhost:8080/health
#
# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS service

WORKDIR /app
# ESM marker so the copied server code (import/export) runs under plain `node` without the
# repo's root package.json. No npm install — the service uses only Node built-ins (the
# title-block read calls the Claude Messages API over the global `fetch`, no SDK bundled).
RUN printf '{"type":"module","private":true}\n' > package.json
COPY filing/ ./server/filing/
COPY storage/result.js ./server/storage/result.js

ENV NODE_ENV=production \
    PORT=8080
EXPOSE 8080

# Least privilege: the stock node image ships a non-root `node` user.
USER node

CMD ["node", "server/filing/server.js"]
