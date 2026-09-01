# Normies Yacht Club Activity Log - worker image (no web dyno needed).
FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# The club's pixel face for the card chrome. Optional: a system sans is used if this fails.
RUN node scripts/fetch-font.mjs || true

# State (dedup ledger + block cursor) must survive a redeploy: mount a volume here.
ENV STATE_DIR=/data/state
VOLUME ["/data"]

CMD ["npx", "tsx", "src/index.ts"]
