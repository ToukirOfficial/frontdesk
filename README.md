# Frontdesk

A free, self-hosted AI receptionist for small business websites. It answers visitors’ questions from the business’s own information, takes enquiries, books appointments and hands over to a human when it isn’t sure.

🚧 In development. See [plan.md](plan.md) for progress.

## Run it locally

You need Node.js 24, pnpm and Docker.

```bash
docker compose up -d          # PostgreSQL (with pgvector) and Redis
cp .env.example .env          # then fill in JWT_SECRET, CODE_SECRET and ENCRYPTION_KEY (openssl rand -hex 32)
pnpm install
pnpm --filter @frontdesk/api migrate
pnpm dev                      # web on http://localhost:8025, API on :8125, plus the worker
```

Sign up at http://localhost:8025/signup. With no `SMTP_URL`, your login code is written to `apps/api/tmp/mail/`.

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Tests run against real PostgreSQL and Redis (`TEST_DATABASE_URL`).

## Licence

AGPL-3.0
