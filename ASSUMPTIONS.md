# Assumptions

Decisions made where `PRD.md` and `plan.md` leave room. Each is easy to change.

## Accounts and access

- **A code on every login.** Password first, then a 6-digit code emailed for that login. Sign-up uses the same code step, which also confirms the email address. Codes expire after 10 minutes, work once, allow 5 tries, and a newer code cancels older ones.
- **Accepting an invite logs you in without a code.** The invite link was emailed to that address, so it already proves the person controls the inbox. People who already have an account confirm with their password.
- **Password reset** is included because the project rules require it to be rate-limited. A reset logs the account out everywhere.
- **Roles.** Owner: everything, including role changes and deleting the workspace. Admin: settings, knowledge, conversations, inviting admins and staff, removing staff. Staff: conversations, enquiries and unanswered questions. Ownership can't be handed over in version 1.
- **Someone else's workspace is "not found", not "forbidden",** so ids reveal nothing.
- **Access tokens carry only the user id.** Roles are read from the database on every workspace request, so removing someone takes effect immediately.

## Knowledge

- **Only owners and admins** manage knowledge, business details and assistant settings.
- **Website import** reads up to 25 pages (10 by default) from the same site (`www.` ignored), breadth first. Scripts, styles, menus, footers and forms are dropped. A redirect to another site stops that page. Plain http is allowed outside production.
- **Files:** PDF and DOCX up to 10 MB, checked by their bytes. PDFs over 300 pages are refused. Text is read in the worker with a 60-second limit.
- **Editing:** FAQs and text pages can be edited. Files and websites can be renamed, processed again or deleted, not edited.
- **Embeddings:** the default `local` model (all-MiniLM-L6-v2, 384 dimensions) downloads once to `MODEL_CACHE_DIR` on first use. Changing `EMBEDDING_PROVIDER` later means processing knowledge again.
- **Slotwise:** the key is checked only for shape when saved. The first real call (Phase 4) shows whether it works.

## Assistant and widget

- **Model:** `ANTHROPIC_MODEL` defaults to `claude-opus-5-5` at `ANTHROPIC_EFFORT=low` (short receptionist replies), with Anthropic's server-side refusal fallback on (`ANTHROPIC_FALLBACKS=default`). For lower cost set `ANTHROPIC_MODEL=claude-haiku-5-5` and `ANTHROPIC_FALLBACKS=off` (Haiku has no server-side fallback). `OPENAI_CHAT_MODEL` defaults to `gpt-4.1-mini`; I couldn't confirm current OpenAI model names from an official source, so set it yourself.
- **Without an API key** the API still starts; each reply becomes a polite "leave a message" fallback.
- **Grounding:** each question retrieves the 5 nearest knowledge extracts. Business details are always included. Both are wrapped in `<untrusted_data>` tags, and any such tags inside the data are neutralised. The model reports gaps with `report_unanswered` and citations with `cite_sources`; sources shown to visitors come only from those calls.
- **Allowed websites:** an empty list means any website may show the chat (handy while testing); the dashboard says so.
- **Visitor tokens** are kept in the customer site's `localStorage`, so a conversation resumes after a page reload. They grant access to that one conversation only, and are rejected as dashboard logins (separate JWT audience).
- **Sockets** are served at `/api/socket.io` with no trailing slash, so they pass through the Next.js `/api` rewrite in development. In production, route `/api` (including WebSocket upgrades) to the API.
- **Basic chat rate limits** (per visitor 10/min, per IP 30/min, per workspace 300/min) are in from Phase 3; Phase 5 adds the monthly spend cap.

## Enquiries, booking and handover

- **Leave a message, Book, Talk to a person** are always shown as buttons in the widget. Booking shows only if Slotwise is connected (in-chat booking) or a booking link is set (opens the link).
- **Enquiries** need a name, an email or a phone number, the request, and a ticked consent box. The exact consent wording is stored with each enquiry. The email goes to the business email in Business details, or to the workspace owners if none is set.
- **Booking** looks one week ahead at a time (UK time), up to two weeks per request. Each attempt carries its own Idempotency-Key, and Slotwise sends its own confirmation email. Free times are cached for 30 seconds and the service list for 5 minutes, to stay well under Slotwise's 60 requests a minute.
- **"Online" for handover** means someone from the workspace has the Conversations page open (a live dashboard socket on any API instance). If nobody is online, asking for a person opens the leave-a-message form.
- **Every role can take over a chat.** Only the person who took it over can reply. They, or an owner or admin, can hand it back to the assistant.
- **A removed team member** keeps live updates in an already-open Conversations tab until it reconnects. Every action still needs a membership check, and their access token expires within 15 minutes.

## Limits, insights and retention

- **Spend cap** counts input plus output tokens (cached reads included) per calendar month in UTC. The default is 2,000,000, roughly 1,000 answers. Owners and admins can change it, and the overview shows usage. At the cap, the widget offers leave-a-message only; enquiries still work.
- **Retention** (default 90 days, 1–3650) is set per workspace. Every night at 03:15 UK time, the worker deletes conversations (with their messages), enquiries and unanswered questions older than that. It also clears login codes, refresh tokens, reset links and invites that expired over a day ago. Knowledge and settings are never deleted.
- **Search** matches message text (case-insensitive) within the workspace only.
- **Unanswered questions:** "Add answer" turns the question and the answer into an FAQ; "Dismiss" marks it done without adding knowledge.

## Demo, evaluation and self-hosting

- **Demo mode** seeds one fictional clinic (every name, address, number and price is made up, in `apps/api/src/demo/clinic.ts`). It switches off sign-up and new workspaces, because the demo runs on the owner's AI key. It sends no emails, allows each visitor 20 messages a day (60 per IP), sets a hard monthly limit (`DEMO_MONTHLY_TOKEN_CAP`, default 300,000 tokens) and resets visitors' data every night at 03:30 UK time. The demo has no Book button (there's nowhere real to book).
- **The evaluation set** uses the demo clinic's knowledge plus a small fictional law firm, retrieves the same way as the app (same chunking, top 5), and grades by phrases that must or must not appear, plus whether `report_unanswered` was called. It can't judge tone; read the saved answers in `evals/results/latest.json` too.
- **Docker:** the web container proxies `/api` (including WebSockets) to the API, so only port 8025 is published. Migrations run when the API container starts. The worker uses the same image. The local embedding model downloads once into the `storage` volume.

## Running locally

- Without `SMTP_URL`, the worker writes each email to `apps/api/tmp/mail/*.eml` (git-ignored) instead of sending it, so you can read your login code. Email contents never go to the logs.
- In production, `SMTP_URL` is required unless `DEMO_MODE=true` (the demo sends no email at all).

## Versions

- **Next.js 16.4** rather than the 16.3 in the original stack: every 16.3.x release has critical advisories (remote code execution) fixed only in 16.4.1+. Approved on 2026-11-02.
