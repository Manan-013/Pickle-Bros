# PickleBros: one container serves the game page and the online server on one port.
FROM node:22-slim

WORKDIR /app

# Install dependencies first (cached unless package files change).
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
COPY shared/package.json shared/
RUN npm ci

# Build the game page.
COPY shared shared
COPY client client
COPY server server
RUN npm run build -w client

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

USER node
CMD ["npx", "tsx", "server/src/index.ts"]
