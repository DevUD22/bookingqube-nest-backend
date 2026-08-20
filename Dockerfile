FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run prisma:generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# Use build-stage node_modules so @prisma/client includes generated enums.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
# Seed imports ../src/common/crypto/password
COPY --from=build /app/src ./src
COPY docker-entrypoint.sh ./docker-entrypoint.sh
# prisma + tsx stay after prune (listed in dependencies) for migrate/seed at boot
RUN npm prune --omit=dev \
  && chmod +x ./docker-entrypoint.sh
EXPOSE 4000
CMD ["./docker-entrypoint.sh"]
