FROM node:20-slim AS builder
WORKDIR /app
COPY packages/shared/ packages/shared/
COPY packages/server/package*.json packages/server/
RUN cd packages/server && npm install
COPY packages/server/ packages/server/

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/packages/ packages/
WORKDIR /app/packages/server
CMD ["npx", "tsx", "src/index.ts"]
