# ==============================================================================
# Stage 1: Build Frontend Assets
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /build

# Copy dependency manifests
COPY package*.json ./
COPY frontend/package*.json ./frontend/

# Install all dependencies for build
RUN npm install
RUN npm --prefix frontend install

# Copy source trees
COPY backend/ ./backend/
COPY database/ ./database/
COPY frontend/ ./frontend/

# Build optimized production frontend distribution
RUN npm --prefix frontend run build

# ==============================================================================
# Stage 2: Production Runtime
# ==============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

# Set default production environment variables
ENV NODE_ENV=production
ENV PORT=5000
ENV API_PREFIX=/api/v1
ENV DB_CLIENT=sqlite
ENV DB_FILE=/data/appointment_system.db

# Copy package manifests and install production-only dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy backend, database migrations, and compiled frontend assets
COPY backend/ ./backend/
COPY database/ ./database/
COPY --from=builder /build/frontend/dist/ ./frontend/dist/

# Ensure directory for persistent SQLite volume exists
RUN mkdir -p /data && chown -R node:node /app /data

# Run as non-root user for container security
USER node

# Expose web service port
EXPOSE 5000

# Native healthcheck using fetch against liveness probe
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 5000) + '/api/v1/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Execute migrations then bootstrap Express application
CMD ["sh", "-c", "node database/migrate.js && node backend/src/server.js"]
