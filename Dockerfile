# syntax=docker/dockerfile:1
# ---------------------------------------------------------------
# Backend image: Express 5 + Prisma 7 (PostgreSQL)
#
# Stages:
#   base      -> common Node base
#   deps      -> ALL dependencies + generated Prisma client
#   dev       -> hot reload (used by compose.dev.yaml)
#   migrate   -> runs "prisma migrate deploy" once, then exits
#   prod-deps -> only production dependencies
#   runner    -> final small production image (default target)
# ---------------------------------------------------------------

# Node 22.18+ is required: lib/prisma.js imports a .ts file and
# Node only strips TypeScript types natively from 22.18 onward.
FROM node:22-alpine AS base
WORKDIR /app
# openssl is used by the Prisma CLI (migrations)
RUN apk add --no-cache openssl

# ---------- deps ----------
FROM base AS deps
# Copy only what "npm ci" needs first, so Docker can cache this layer.
# It is rebuilt only when package*.json or the Prisma schema changes.
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma7.config.ts ./
# "postinstall" runs "prisma generate". The Prisma config reads
# DATABASE_URL, so we pass a dummy value. No database is contacted.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npm ci

# ---------- dev ----------
FROM deps AS dev
ENV NODE_ENV=development
COPY . .
EXPOSE 8080
CMD ["npm", "run", "dev"]

# ---------- migrate ----------
FROM deps AS migrate
COPY . .
CMD ["npx", "prisma", "migrate", "deploy"]

# ---------- prod-deps ----------
FROM base AS prod-deps
COPY package.json package-lock.json ./
# --omit=dev     : skip prisma CLI, nodemon, ...
# --ignore-scripts: skip "postinstall" (prisma CLI is not installed here);
#                   we copy the already generated client from "deps" instead.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---------- runner (production) ----------
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=deps /app/generated ./generated
COPY . .

# Never run as root inside the container
USER node

EXPOSE 8080

# Docker marks the container "healthy" only when this succeeds
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:${PORT}/api/health || exit 1

CMD ["node", "server.js"]
