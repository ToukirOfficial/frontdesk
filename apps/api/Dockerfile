# syntax=docker/dockerfile:1
# The API and the worker (same image, different command). Build from the repo root:
#   docker build -f apps/api/Dockerfile .
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
# Behind a TLS-inspecting proxy? Pass its CA: docker build --secret id=ca,src=/path/ca.crt … (optional).
ENV CA_SECRET=/run/secrets/ca
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=secret,id=ca,required=false \
  sh -c '[ -f "$CA_SECRET" ] && export NODE_EXTRA_CA_CERTS="$CA_SECRET"; pnpm install --frozen-lockfile --filter "@frontdesk/api..."'
COPY packages/shared packages/shared
COPY apps/api apps/api
# prisma generate reads DATABASE_URL from prisma.config.ts but doesn't connect: a placeholder is enough at build time.
RUN --mount=type=secret,id=ca,required=false sh -c '[ -f "$CA_SECRET" ] && export NODE_EXTRA_CA_CERTS="$CA_SECRET"; pnpm --filter @frontdesk/shared build && DATABASE_URL=postgresql://unused@localhost/unused pnpm --filter @frontdesk/api build \
  && pnpm install --frozen-lockfile --prod --filter "@frontdesk/api..." --offline'

FROM node:24-slim
ENV NODE_ENV=production API_HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app /app
# Uploaded files and the local embedding model live here (a volume in docker compose).
RUN mkdir -p /app/apps/api/storage && chown node:node /app/apps/api/storage
WORKDIR /app/apps/api
USER node
EXPOSE 8125
# Apply any new migrations, then start the API. The worker overrides this with `node dist/worker.js`.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/main.js"]
