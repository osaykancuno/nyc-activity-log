# Normies Yacht Club Activity Log - worker image (no web port, no web dyno).
FROM node:20-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

# The slim image carries no fonts whatsoever. Without one, Skia falls back to
# the only face this app registers - the club's pixel font - and every price,
# block number and percentage on a card gets drawn in a face whose digits are
# ambiguous. DejaVu Sans is what `font()` already asks for after Segoe UI.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

# Prove it landed. An image that cannot draw a legible digit must not build:
# the alternative is finding out from a published card, which is how this was
# found the first time.
RUN test -f /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf \
 && test -f /usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf

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
