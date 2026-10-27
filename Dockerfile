# One image = web app + live-sync server. Mount a volume at /data to keep trips across restarts.
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data STATIC_DIR=/app/dist
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "server/relay.mjs"]
