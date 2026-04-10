# ── Build stage ──────────────────────────────────────────────
FROM node:22.14.0-slim AS build

WORKDIR /app

# Install dependencies first (layer caching — only re-runs when lockfile changes)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build the frontend
COPY . .
RUN npm run build

# ── Production stage ─────────────────────────────────────────
FROM node:22.14.0-slim

WORKDIR /app

# Copy package files and install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built frontend from build stage
COPY --from=build /app/dist ./dist

# Copy backend source
COPY backend ./backend

# Create data directory (will be overridden by volume mount)
RUN mkdir -p backend/data

EXPOSE 8787

CMD ["node", "backend/server.js"]
