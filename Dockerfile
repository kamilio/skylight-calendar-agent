FROM node:24.14.0-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . ./
RUN npm run build

FROM node:24.14.0-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --chown=root:root docker-entrypoint.mjs ./docker-entrypoint.mjs
USER root
EXPOSE 8080
CMD ["node", "--enable-source-maps", "docker-entrypoint.mjs"]
