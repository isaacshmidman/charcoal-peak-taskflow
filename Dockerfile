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

# System image libraries. NOTE: sharp does not use these — it ships its
# own prebuilt library, and would only use the system one if compiled
# against it (Debian's is older than sharp accepts). HEIC photos are
# converted by backend/lib/heic.js instead, which needs nothing from the
# system. These are kept only so this image doesn't change shape in the
# same release as that fix; they can be dropped in a later one.
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
