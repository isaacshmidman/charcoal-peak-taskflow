# ── Build stage ──────────────────────────────────────────────
FROM node:22.14.0-slim AS build

ARG VITE_APP_ID=69b71a4b57ba76a74090fc6e
ENV VITE_APP_ID=$VITE_APP_ID

WORKDIR /app

# Install dependencies first (layer caching — only re-runs when lockfile changes)
COPY package.json package-lock.json ./
RUN npm ci --loglevel=error

# Copy source and build the frontend
COPY . .
RUN rm -rf dist && npm run build

# ── Production stage ─────────────────────────────────────────
FROM node:22.14.0-slim

WORKDIR /app

# Install libvips (image processing) WITH libheif so sharp's HEIC →
# JPEG conversion uses native code instead of a slow JS fallback.
# Phone photos (iPhone defaults to HEIC) need this — without it the
# upload appears to hang for tens of seconds, then the file can't
# render in any non-Safari browser.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libvips \
      libheif1 \
 && rm -rf /var/lib/apt/lists/*

# Copy package files and install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --loglevel=error

# Copy built frontend from build stage
COPY --from=build /app/dist ./dist

# Copy backend source
COPY backend ./backend

# Create data directory (will be overridden by volume mount)
RUN mkdir -p backend/data

EXPOSE 8787

CMD ["node", "backend/server.js"]
