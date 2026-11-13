# ==========================================
# Stage 1: Dependencies & Build
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Install build dependencies if needed for native modules
RUN apk add --no-cache python3 make g++

# Copy package manifests
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including devDependencies needed for build & prisma generate)
RUN npm ci

# Generate Prisma Client
RUN npx prisma generate

# ==========================================
# Stage 2: Production Runtime
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /usr/src/app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Copy node_modules from builder
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/prisma ./prisma
COPY src ./src

# Run as non-root user for container security
USER node

EXPOSE 3000

CMD ["node", "src/server.js"]
