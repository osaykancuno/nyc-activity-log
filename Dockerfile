# Normies Yacht Club Activity Log - worker image (no web port, no web dyno).
FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# The club's pixel face for the card chrome. Optional: without it the cards fall
# back to a system sans, so a failure here must never fail the build.
RUN node scripts/fetch-font.mjs || true

# The dedup ledger and the block cursor live here. Mount a volume at /data in the
# host (Railway, Fly) or a redeploy makes the log repeat itself.
# No VOLUME instruction on purpose: it collides with Railway's own mount.
ENV STATE_DIR=/data/state

CMD ["npx", "tsx", "src/index.ts"]
