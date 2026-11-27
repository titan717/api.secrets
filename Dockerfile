# One image = API + web client (API serves apps/web/dist on the same origin)
FROM node:20-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile=false && pnpm build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
EXPOSE 8080
CMD ["node", "apps/api/dist/index.js"]
