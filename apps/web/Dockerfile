# syntax=docker/dockerfile:1
# The dashboard, demo page and /widget.js. Build from the repo root:
#   docker build -f apps/web/Dockerfile .
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
# Behind a TLS-inspecting proxy? Pass its CA: docker build --secret id=ca,src=/path/ca.crt … (optional).
ENV CA_SECRET=/run/secrets/ca
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/widget/package.json packages/widget/
COPY apps/web/package.json apps/web/
RUN --mount=type=secret,id=ca,required=false \
  sh -c '[ -f "$CA_SECRET" ] && export NODE_EXTRA_CA_CERTS="$CA_SECRET"; pnpm install --frozen-lockfile --filter "@frontdesk/web..."'
COPY packages/shared packages/shared
COPY packages/widget packages/widget
COPY apps/web apps/web
# /api/* is proxied to the API (WebSockets too). Next fixes rewrites at build time, so the address is a build arg.
ARG API_URL=http://api:8125
ENV API_URL=$API_URL NEXT_TELEMETRY_DISABLED=1
RUN --mount=type=secret,id=ca,required=false sh -c '[ -f "$CA_SECRET" ] && export NODE_EXTRA_CA_CERTS="$CA_SECRET"; pnpm --filter @frontdesk/shared build && pnpm --filter @frontdesk/widget build && pnpm --filter @frontdesk/web build'

FROM node:24-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8025 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 8025
CMD ["node", "apps/web/server.js"]
