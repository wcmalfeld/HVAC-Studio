# HVAC Studio web (Next.js) — build context: repo root (needs the pnpm workspace). Optional in compose.
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @hvac/web build

FROM node:22-slim
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo
COPY --from=build /repo /repo
EXPOSE 3000
CMD ["pnpm", "--filter", "@hvac/web", "start"]
