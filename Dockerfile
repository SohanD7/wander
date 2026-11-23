# Hosted group trips use Postgres. The local pilot can mount /data for filesystem persistence.
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
COPY src/collab/*.mjs ./src/collab/
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "server/relay.mjs"]
