# Frontdesk — build plan

Source of truth: `PRD.md` (features numbered F1–F22 below). Stack and rules: the project rules.
Monorepo: `apps/web` (Next.js 16.3, port 8025), `apps/api` (NestJS 12 + Prisma, port 8125, plus a worker entry point), `packages/shared` (Zod), `packages/widget` (Web Component), `evals/`.

## Data model (Prisma, PostgreSQL 18 + pgvector; UUIDv7 ids, `createdAt`/`updatedAt` everywhere)

| Table | Key fields |
|---|---|
| `User` | email (unique), passwordHash (argon2id), name |
| `LoginCode` | userId, codeHash, expiresAt, attempts, usedAt |
| `RefreshToken` | userId, tokenHash, familyId, expiresAt, revokedAt (rotation + reuse detection) |
| `Workspace` | name, slug, publicKey (widget id), allowedOrigins[], retentionDays (90), monthlyTokenCap, isDemo |
| `Membership` | userId, workspaceId, role `OWNER/ADMIN/STAFF` (unique pair) |
| `Invite` | workspaceId, email, role, tokenHash, expiresAt |
| `BusinessProfile` | workspaceId (1:1), name, address, openingHours (json), email, phone, bookingUrl |
| `AssistantSettings` | workspaceId (1:1), preset `LAW/CLINIC/GENERAL`, rules (text), greeting, brandColour, position, avatarPath, slotwiseUrl |
| `KnowledgeSource` | workspaceId, type `FAQ/TEXT/FILE/URL`, title, content/question/answer, filePath, url, status `PROCESSING/READY/FAILED`, error |
| `KnowledgeChunk` | workspaceId, sourceId, content, `embedding vector(384)` (HNSW index, raw-SQL migration) |
| `Conversation` | workspaceId, visitorId, mode `AI/HUMAN/CLOSED`, assignedUserId, lastMessageAt |
| `Message` | conversationId, workspaceId, role `VISITOR/ASSISTANT/STAFF/SYSTEM`, content, sources (json), inputTokens, outputTokens |
| `Enquiry` | workspaceId, conversationId?, name, contact, need, consentAt, emailedAt |
| `UnansweredQuestion` | workspaceId, conversationId, question, resolvedAt |
| `UsageMonth` | workspaceId, month (`YYYY-MM`), inputTokens, outputTokens (unique pair) |

Every query carries `workspaceId`; vector search is `WHERE "workspaceId" = $1 ORDER BY embedding <=> $2 LIMIT k`.

## NestJS modules

- **auth** — register, login (password → emailed 6-digit code → tokens), refresh, logout, cookies, rate limits. Global `AuthGuard` + `RolesGuard`, `@Public()`, `@Roles()`.
- **workspaces** — workspace CRUD, members, invites, roles.
- **business** — business profile and assistant settings (rules, presets, widget look).
- **knowledge** — sources CRUD, file upload (PDF/DOCX, magic-byte check, random name outside public dirs), URL import request; jobs to queue.
- **ai** — provider interface (`streamChat`, `embed`), Anthropic + OpenAI implementations and a `FakeProvider` for tests; model names from env; prompts loaded from `apps/api/prompts/*.md` (versioned).
- **retrieval** — chunking, workspace-scoped vector search, prompt assembly (business details + rules + chunks).
- **chat** — WebSocket gateway (Socket.IO + Redis adapter for multi-instance), visitor sessions, streaming, sources, "don't know" detection → unanswered list, enquiry capture.
- **handover** — staff presence (Redis), take over / hand back, fallback to enquiry when nobody is online.
- **booking** — booking link, or Slotwise public API (list slots, book).
- **limits** — per-visitor and per-workspace rate limits (Redis), monthly token cap → "leave a message" mode.
- **insights** — conversation history + search, enquiries, unanswered questions.
- **mail** — queued emails (codes, invites, enquiries); SMTP in prod, log-only in demo/dev.
- **worker** (separate process, same codebase) — BullMQ queues: `embed`, `import-url`, `parse-file`, `email`, `retention` (nightly), `demo-reset` (nightly when `DEMO_MODE`).

## API endpoints (all under `/api`, Zod-validated, response DTOs only)

- Auth (public, rate-limited): `POST /auth/register`, `/auth/login`, `/auth/verify-code`, `/auth/refresh`, `/auth/logout`; `GET /auth/me`.
- Workspaces: `GET/POST /workspaces`, `GET/PATCH /workspaces/:id`, `GET/POST/PATCH/DELETE /workspaces/:id/members`, `POST /workspaces/:id/invites`, `POST /invites/accept` (public).
- Settings: `GET/PUT /workspaces/:id/business`, `GET/PUT /workspaces/:id/assistant`.
- Knowledge: `GET/POST /workspaces/:id/knowledge`, `GET/PATCH/DELETE /workspaces/:id/knowledge/:sourceId`, `POST .../knowledge/upload`, `POST .../knowledge/import-url`, `GET .../knowledge/:sourceId/file`.
- Conversations: `GET /workspaces/:id/conversations?q=`, `GET .../conversations/:cid`, `POST .../conversations/:cid/takeover`, `/handback`, `/messages`.
- Insights: `GET /workspaces/:id/enquiries`, `GET /workspaces/:id/unanswered`, `PATCH .../unanswered/:qid`, `GET /workspaces/:id/usage`.
- Widget (public, by `publicKey`, origin-checked): `GET /widget/:publicKey/config`, `POST /widget/:publicKey/session`.
- WebSocket namespaces: `/visitor` (send message, stream tokens, enquiry, booking) and `/staff` (live list, presence, takeover, reply). Both authenticated (visitor session token / staff cookie).

Roles: Owner = everything incl. members and delete workspace; Admin = settings, knowledge, conversations; Staff = conversations, enquiries, unanswered (read).

## Pages (`apps/web`, shadcn/ui, mobile responsive)

`/login`, `/login/code`, `/register`, `/invite/[token]` · `/w/[id]` overview (usage, recent) · `/w/[id]/knowledge` (+ status) · `/w/[id]/business` · `/w/[id]/assistant` (rules, presets, widget look, embed snippet) · `/w/[id]/conversations` (live + history, search, take over) · `/w/[id]/enquiries` · `/w/[id]/unanswered` · `/w/[id]/team` · `/demo` (fake clinic site with the widget).

## Build phases

1. **Foundation, auth, workspaces, roles** — monorepo, tooling, CI, docker-compose (postgres+pgvector, redis), Prisma schema + first migration, auth (password + email code, rotating refresh cookies), guards, workspaces, members, invites, dashboard login and team pages. Tests: login/code/refresh/reuse, role permissions, workspace isolation, auth rate limits.
2. **Business details and knowledge** — business + assistant settings, knowledge CRUD, uploads, URL import (same domain, page limit), chunking + embedding jobs in worker, status UI. Tests: knowledge isolation incl. vector search never crossing workspaces, upload permissions.
3. **Assistant and widget** — AI provider interface, versioned prompts, RAG with sources, "don't know" behaviour, rules + presets, guardrails, streaming over WebSockets with Redis adapter, the Web Component widget (Shadow DOM, a11y, mobile), embed snippet. Tests: widget origin/key checks, retrieval scoping through the chat path (fake provider).
4. **Enquiries, booking, handover** — enquiry capture + consent + queued email, booking link / Slotwise, staff presence, takeover / hand back, fallback to enquiry. Tests: handover rules and permissions.
5. **Limits, insights, retention** — per-visitor + per-workspace rate limits, monthly token cap → "leave a message" mode, conversations search, enquiries list, unanswered list, retention job. Tests: rate limits, spend cap.
6. **Evals, demo, self-hosting, docs** — `evals/` set (grounded answer, honest "I don't know", refuses legal advice, resists injection) + `pnpm eval` score; small CI eval with the fake provider (real eval run needs an API key); `DEMO_MODE` seed (fictional physio clinic), demo page, strict limits, nightly reset; Dockerfiles, `docker compose up` from clean; README, `ASSUMPTIONS.md`, decision notes.

Each phase ends with: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, the security sweep, `pnpm audit`, and is marked done here.

## Decisions I need from you before starting

1. **Embeddings.** Anthropic has no embeddings API (it recommends Voyage AI). Proposal: `EMBEDDING_PROVIDER=local` by default — a small model run on CPU in the worker (`@huggingface/transformers`, all-MiniLM-L6-v2, 384 dims), so a self-hoster needs only one API key — with `openai` (`text-embedding-3-small` at 384 dims) as the alternative. Switching provider means re-embedding.
2. **New libraries** (beyond the fixed stack): `@anthropic-ai/sdk`, `openai`, `@huggingface/transformers`, `argon2`, `socket.io` + `@nestjs/websockets` + `@socket.io/redis-adapter`, `nodemailer`, `pdf-parse`, `mammoth` (DOCX), `file-type` (content sniffing), `cheerio` (URL import), `uuidv7`, `lit` (widget, ~6 KB) — or plain Web Component with no library.
3. **Login code:** sent on every login (password + code each time). Alternative: code only on new devices.
4. **Slotwise:** I'll assume a public API for listing slots and creating a booking and write the client against a small documented interface; please point me at its API docs if it differs.

Status: **Waiting for your go.**
