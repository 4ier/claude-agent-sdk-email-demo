FROM node:20-slim AS base

ENV NODE_ENV=production
WORKDIR /app

# Install Claude Code CLI (required by Agent SDK runtime)
RUN npm install -g @anthropic-ai/claude-code && rm -rf /var/lib/apt/lists/*

# Copy manifest and lock, install deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy sources and build with a separate stage to avoid dev deps in final image
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Final runtime image
FROM base AS runtime
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY .env.example ./
COPY docs ./docs

# Healthcheck (simple file existence check for built server)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('fs').access('dist/server.js', require('fs').constants.R_OK, e => process.exit(e?1:0))"

CMD ["node", "dist/server.js"]