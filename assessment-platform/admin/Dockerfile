# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:24.12.0-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
ARG BACKEND_API_URL=http://admin-api:4000
ENV BACKEND_API_URL=${BACKEND_API_URL}
RUN pnpm --filter @assessment/admin build
RUN mkdir -p admin/public admin/.next/standalone/admin/.next/static admin/.next/standalone/admin/public && cp -a admin/.next/static/. admin/.next/standalone/admin/.next/static/ && cp -a admin/public/. admin/.next/standalone/admin/public/

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3001 BACKEND_API_URL=http://admin-api:4000
WORKDIR /app
RUN groupadd --gid 10001 assessment && useradd --uid 10001 --gid 10001 --no-create-home assessment
COPY --from=build --chown=10001:10001 /app/admin/.next/standalone/ ./
USER 10001:10001
EXPOSE 3001
CMD ["node", "admin/server.js"]
