FROM node:20-slim
WORKDIR /app

# Copy root package.json for workspace setup
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/

# Copy shared source (server imports directly from src)
COPY packages/shared/ packages/shared/

# Install server deps only (skip workspace resolution of shared)
WORKDIR /app/packages/server
RUN npm install --omit=dev --ignore-scripts --no-package-lock firebase-admin express tsx 2>/dev/null || true

# Copy server source
COPY packages/server/src/ src/

EXPOSE 8080
CMD ["npx", "tsx", "src/index.ts"]
