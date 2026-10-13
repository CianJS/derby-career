# Build context must be the repository root: shared pure domain code is bundled.
FROM node:22-alpine AS build
WORKDIR /repo/services/api
COPY services/api/package*.json ./
RUN npm ci
COPY services/api ./
COPY packages /repo/packages
COPY lib/career /repo/lib/career
COPY contracts /repo/contracts
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production AUTH_MODE=disabled HOST=0.0.0.0 PORT=4000
WORKDIR /repo/services/api
COPY services/api/package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /repo/services/api/dist ./dist
COPY --from=build /repo/services/api/migrations ./migrations
COPY --from=build /repo/services/api/seeds ./seeds
COPY --from=build /repo/contracts /repo/contracts
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
