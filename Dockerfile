# ── Why it is built this way ──────────────────────────────────
# A deploy used to download every package twice (and Debian's packages
# once) on every build, so a minute without internet at the box stopped
# the deploy (2026-11-17: `npm ci` failed with ETIMEDOUT). Now:
#   - downloaded packages are kept on the box between builds (the
#     `--mount=type=cache` lines; `docker compose build --no-cache` does
#     not empty them), and npm uses them before asking the internet, so a
#     deploy that changes no dependency needs no internet at all;
#   - when it does need the internet, npm retries for about two minutes
#     before giving up, instead of one short try;
#   - nothing is installed from Debian: the app never used those
#     packages (see backend/lib/heic.js).
# CI rebuilds this image with the network switched off to prove the
# first point (.github/workflows/verify.yml, job "docker").

# ── Build stage ──────────────────────────────────────────────
FROM node:22.14.0-slim AS build

ARG VITE_APP_ID=69b71a4b57ba76a74090fc6e
ENV VITE_APP_ID=$VITE_APP_ID
# How npm waits for a slow or dropped connection: 5 tries, up to 2 minutes apart.
ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_mintimeout=10000 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm_config_audit=false \
    npm_config_fund=false \
    npm_config_update_notifier=false

WORKDIR /app

# Install dependencies first (layer caching — only re-runs when lockfile changes)
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=zephyrly-npm,target=/root/.npm,sharing=locked \
    npm ci --prefer-offline --loglevel=error

# Copy source and build the frontend
COPY . .
RUN rm -rf dist && npm run build

# ── Production stage ─────────────────────────────────────────
FROM node:22.14.0-slim

ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_mintimeout=10000 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm_config_audit=false \
    npm_config_fund=false \
    npm_config_update_notifier=false

WORKDIR /app

# Image libraries: none. sharp carries its own prebuilt libvips, and HEIC
# photos are decoded by libheif compiled to WebAssembly (heic-decode), so
# Debian's libvips and libheif were installed but never used. They were
# kept only until the HEIC fix had shipped; dropping them takes the last
# download from Debian out of every deploy.

# Copy package files and install production deps only (from the same
# kept downloads as the build stage)
COPY package.json package-lock.json ./
RUN --mount=type=cache,id=zephyrly-npm,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --prefer-offline --loglevel=error

# Copy built frontend from build stage
COPY --from=build /app/dist ./dist

# Copy backend source
COPY backend ./backend

# Create data directory (will be overridden by volume mount)
RUN mkdir -p backend/data

EXPOSE 8787

CMD ["node", "backend/server.js"]
