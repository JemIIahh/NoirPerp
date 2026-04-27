# Multi-stage build for the NoirPerp KYC Merkle allowlist API.
#
# Stage 1 compiles the TypeScript source. Stage 2 runs the compiled
# JS with only production deps installed. The allowlist JSON is baked
# into the image at build time — for a hackathon demo this is the
# right tradeoff (allowlist updates redeploy the image; no runtime
# write-back needed). For a production deployment, mount data/ as a
# persistent volume instead.

# ─── Stage 1: build ──────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ─── Stage 2: runtime ────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY data ./data

USER node
EXPOSE 4001
CMD ["node", "dist/index.js"]
