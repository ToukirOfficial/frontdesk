# Frontdesk — build plan

Source of truth: `PRD.md`. Stack and rules: the project rules. Approved 2026-11-02 with the decisions at the end.
Monorepo: `apps/web` (Next.js 16.4 — moved from 16.3 because every 16.3.x release has critical advisories, approved 2026-11-02; port 8025), `apps/api` (NestJS 12 + Prisma 7, port 8125, plus a worker entry point), `packages/shared` (Zod), `packages/widget` (plain Web Component), `evals/`.

## Data model (Prisma, PostgreSQL 18 + pgvector; UUIDv7 ids, `createdAt`/`updatedAt` everywhere)

| Table | Key fields |
|---|---|
| `User` | email (unique), passwordHash (argon2id), name |
| `LoginCode` | userId, codeHash, expiresAt, attempts, usedAt |
| `RefreshToken` | userId, tokenHash, familyId, expiresAt, revokedAt (rotation + reuse detection) |
| `Workspace` | name, slug, publicKey (widget id), allowedOrigins[], retentionDays (90), monthlyTokenCap, isDemo |
| `Membership` | userId, workspaceId, role `OWNER/ADMIN/STAFF` (unique pair) |
| `Invite` | workspaceId, email, role, tokenHash, expiresAt, acceptedAt |
| `BusinessProfile` | workspaceId (1:1), name, address, openingHours (json), email, phone, bookingUrl |
| `AssistantSettings` | workspaceId (1:1), preset `LAW/CLINIC/GENERAL`, rules, greeting, brandColour, position, avatarPath, slotwiseBaseUrl, slotwiseServiceIds[], slotwiseKeyCipher (AES-256-GCM, never returned) |
| `KnowledgeSource` | workspaceId, type `FAQ/TEXT/FILE/URL`, title, content/question/answer, filePath, url, status `PROCESSING/READY/FAILED`, error |
| `KnowledgeChunk` | workspaceId, sourceId, content, `embedding vector(384)` (HNSW index, raw-SQL migration) |
| `Conversation` | workspaceId, visitorId, mode `AI/HUMAN/CLOSED`, assignedUserId, lastMessageAt |
| `Message` | conversationId, workspaceId, role `VISITOR/ASSISTANT/STAFF/SYSTEM`, content, sources (json), inputTokens, outputTokens |
| `Enquiry` | workspaceId, conversationId?, name, contact, need, consentAt, emailedAt |
| `UnansweredQuestion` | workspaceId, conversationId, question, resolvedAt |
| `UsageMonth` | workspaceId, month (`YYYY-MM`), inputTokens, outputTokens (unique pair) |

## NestJS modules

- **auth** — register, login (password → 6-digit email code on **every** login → tokens), refresh, logout, password reset (rate-limited, per the project rules rule 4), cookies, rate limits. Global `AuthGuard` + `RolesGuard`, `@Public()`, `@Roles()`.
- **workspaces** — workspace CRUD, members, invites, roles.
- **business** — business profile and assistant settings (rules, presets, widget look, Slotwise connection).
- **knowledge** — sources CRUD, file upload (PDF/DOCX, magic-byte check, random name outside public dirs), URL import request; jobs to queue.
- **ai** — provider interface (`streamChat` with tools, `embed`), Anthropic + OpenAI chat, local + OpenAI embeddings, a `FakeProvider` for tests; model names from env; prompts in `apps/api/prompts/*.md` (versioned).
- **retrieval** — chunking, workspace-scoped vector search, prompt assembly.
- **chat** — WebSocket gateway (Socket.IO + Redis adapter), visitor sessions, streaming, sources, enquiry capture.
- **handover** — staff presence (Redis), atomic take over / hand back, fallback to enquiry when nobody is online.
- **booking** — booking link, or Slotwise.
- **limits** — rate limits per IP, per visitor and per workspace (Redis); monthly token cap → "leave a message" mode.
- **insights** — conversation history + search, enquiries, unanswered questions.
- **mail** — queued emails (codes, invites, enquiries); SMTP in prod, log-only (no content) in dev/demo.
- **worker** (separate process) — BullMQ queues: `embed`, `import-url`, `parse-file`, `email`, `retention` (nightly), `demo-reset` (nightly when `DEMO_MODE`).

## API endpoints (all under `/api`, Zod-validated, response DTOs only)

- Auth (public, rate-limited): `POST /auth/register`, `/auth/login`, `/auth/verify-code`, `/auth/refresh`, `/auth/logout`; `GET /auth/me`.
- Workspaces: `GET/POST /workspaces`, `GET/PATCH /workspaces/:id`, `GET/PATCH/DELETE /workspaces/:id/members[/:userId]`, `GET/POST/DELETE /workspaces/:id/invites`, `GET /invites/:token`, `POST /invites/accept`.
- Settings: `GET/PUT /workspaces/:id/business`, `GET/PUT /workspaces/:id/assistant`, `PUT/DELETE /workspaces/:id/slotwise`.
- Knowledge: `GET/POST /workspaces/:id/knowledge`, `GET/PATCH/DELETE .../knowledge/:sourceId`, `POST .../knowledge/upload`, `POST .../knowledge/import-url`, `GET .../knowledge/:sourceId/file`.
- Conversations: `GET /workspaces/:id/conversations?q=`, `GET .../conversations/:cid`, `POST .../conversations/:cid/takeover`, `/handback`, `/messages`.
- Insights: `GET /workspaces/:id/enquiries`, `GET/PATCH /workspaces/:id/unanswered[/:qid]`, `GET /workspaces/:id/usage`.
- Widget (public, by `publicKey`, origin-checked): `GET /widget/:publicKey/config`, `POST /widget/:publicKey/session`.
- WebSockets: `/visitor` (message, stream, enquiry, booking) and `/staff` (live list, presence, takeover, reply).

Roles: Owner = everything incl. members and delete workspace; Admin = settings, knowledge, conversations, invites (not Owner role); Staff = conversations, enquiries, unanswered.

## Pages (`apps/web`, shadcn/ui, mobile responsive)

`/login`, `/login/code`, `/register`, `/invite/[token]` · `/w/[id]` overview · `/w/[id]/knowledge` · `/w/[id]/business` · `/w/[id]/assistant` (rules, presets, widget look, embed snippet, Slotwise) · `/w/[id]/conversations` · `/w/[id]/enquiries` · `/w/[id]/unanswered` · `/w/[id]/team` · `/demo`.

## Security and grounding details

- **SSRF (URL import):** HTTPS only in production (HTTP allowed in dev), same domain as the start URL, page and size limits. Resolve DNS ourselves, reject loopback, private, link-local, CGNAT, multicast, unspecified and cloud metadata ranges (IPv4 and IPv6, incl. IPv4-mapped) with `net.BlockList`, then connect to the vetted IP (pinned `lookup`, SNI kept). No redirects followed (a redirect to the same domain is re-vetted as a new URL). 10 s timeout, 2 MB body limit, HTML only. Tested.
- **Slotwise key:** stored AES-256-GCM encrypted (`ENCRYPTION_KEY` env, 32 bytes, random IV per value); the API only ever returns `connected: true/false`.
- **Indirect prompt injection:** business details, knowledge chunks and imported pages go in the prompt inside labelled `<untrusted_data>` blocks with an instruction that they are reference material, never instructions. Eval cases include chunks containing injected instructions.
- **"Don't know" signal:** the model is given a `report_unanswered` tool (and `cite_sources`); unanswered questions are recorded from that tool call, never by matching the answer text. Leaving a message, booking and asking for a person are always-visible widget buttons rather than model tools (simpler, and the reply text already offers them).
- **Vector search:** `SET LOCAL hnsw.iterative_scan = relaxed_order` (pgvector ≥ 0.8) inside a transaction with the `workspaceId` filter, so filtering still returns k results; tested with several workspaces; decision note `docs/decisions/0001-filtered-vector-search.md`.
- **Rate limits:** per IP, per visitor and per workspace. README notes that origin checks only stop browsers, not scripts.
- **Takeover:** one conditional update (`WHERE mode = 'AI'`); the loser gets 409. Tested with two simultaneous takeovers.
- **Retention:** the nightly job deletes conversations, messages, enquiries and unanswered questions older than the workspace's retention period.

## Slotwise integration

Base URL + `/api/v1`, header `Authorization: Bearer sw_live_<prefix>_<secret>`. `GET /services`; `GET /availability?serviceId=&from=YYYY-MM-DD&to=YYYY-MM-DD` → `days[].slots[{startsAt, endsAt, localTime}]`; `POST /bookings` with `Idempotency-Key` and `{serviceId, staffId: "any", startsAt, customer: {name, email, phone}}`. Errors `{statusCode, errorCode, message}`; `SLOT_TAKEN` (409) → offer other times; 429 honours `Retry-After`. Calls cached briefly in Redis to stay under 60/min per key.

## Libraries (approved)

`@anthropic-ai/sdk`, `openai`, `@huggingface/transformers` (local all-MiniLM-L6-v2, 384 dims; `EMBEDDING_PROVIDER=local|openai`, OpenAI uses `text-embedding-3-small` at 384 dims), `argon2`, `@nestjs/websockets` + `@nestjs/platform-socket.io` + `socket.io` + `@socket.io/redis-adapter`, `nodemailer`, **`unpdf`** (maintained PDF.js-based text extraction, replaces pdf-parse; run with a timeout and page limit), `mammoth` (DOCX), `file-type`, `cheerio`, `uuidv7`. Widget: plain Web Component, Shadow DOM, no framework.

## Build phases

1. **Foundation, auth, workspaces, roles** — monorepo, tooling, CI, docker-compose, Prisma schema + first migration, auth (password + email code, rotating refresh cookies, password reset), guards, workspaces, members, invites, dashboard login and team pages. Tests: login/code/refresh/reuse, role permissions, workspace isolation, auth rate limits.
2. **Business details and knowledge** — settings, Slotwise key encryption, knowledge CRUD, uploads, SSRF-safe URL import, pgvector extension + chunk table, chunking + embedding jobs, status UI. Tests: knowledge isolation incl. multi-workspace vector search, upload permissions, SSRF guard.
3. **Assistant and widget** — provider interface, versioned prompts with untrusted-data wrapping, RAG with sources, `report_unanswered` tool, rules + presets, streaming over WebSockets, the widget. Tests: widget key/origin checks, retrieval scoping through the chat path (fake provider).
4. **Enquiries, booking, handover** — enquiry capture + consent + email, booking link / Slotwise, presence, atomic takeover / hand back, fallback to enquiry. Tests: handover rules, concurrent takeover.
5. **Limits, insights, retention** — IP/visitor/workspace limits, monthly token cap, insights pages, retention job. Tests: rate limits, spend cap, retention.
6. **Evals, demo, self-hosting, docs** — eval set (grounded answer, honest "I don't know", refuses legal advice, direct and indirect injection) + `pnpm eval`; small CI eval; `DEMO_MODE` seed, demo page, nightly reset; Dockerfiles, `docker compose up`; README, `ASSUMPTIONS.md`, decision notes.

Each phase ends with `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, the security sweep and `pnpm audit`, then is marked done here.

## Progress

- [x] Phase 1 (2026-11-02: 34 API tests, typecheck/lint/build clean, audit has no high/critical) · [x] Phase 2 (2026-11-02: 87 API tests; local embedding model not run here, Hugging Face is blocked in this environment) · [x] Phase 3 (2026-11-02: 99 API tests; widget checked in a browser through the proxy; real model replies not run here, no API key) · [x] Phase 4 (2026-11-02: 117 API tests; handover checked in two browsers) · [ ] Phase 5 · [ ] Phase 6
