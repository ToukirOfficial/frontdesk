# Frontdesk — PRD

**One line:** a free, self-hosted AI receptionist for small business websites. It answers visitors' questions from the business's own information, takes enquiries, books appointments and hands over to a human when it isn't sure.

**Owner:** Toukir Ahmed Rony · **Licence:** AGPL-3.0 · **Repo:** public on GitHub · **Demo:** frontdesk.toukirahmedrony.com

## 1. The problem

Small businesses (clinics, solicitors, salons, cleaners, tutors, restaurants) get the same questions all day: prices, opening hours, "do you cover my area?", "can I book?". Missed questions out of hours become lost customers. Paid AI chat tools exist (Tidio, Intercom's AI agent), but they cost monthly, keep the data on someone else's servers, and often make things up. Frontdesk is the free, open-source, self-hosted alternative that only answers from the business's own information and says "I don't know" instead of guessing.

## 2. Users

- **Business admin:** sets up the assistant, adds knowledge, sets rules, watches conversations.
- **Business staff:** answers handed-over chats live, follows up enquiries.
- **Visitor:** a member of the public chatting on the business website, often on a phone.
- **Self-hoster:** a developer installing Frontdesk for a business.

## 3. Features (version 1)

**Workspaces and team**
1. Multi-tenant: each business is a workspace; every query is scoped to it. Roles: Owner, Admin, Staff.
2. Login with email + password (argon2id) and a 6-digit email code.

**Knowledge**
3. Add knowledge as: FAQ pairs, plain text pages (prices, services, policies, opening hours), uploaded PDF or DOCX files, and a website URL to import pages from (same domain only, limited page count).
4. Knowledge is split into chunks and embedded in the background (queue), then stored with pgvector. Status shown: processing, ready, failed.
5. Business details as structured fields: name, address, opening hours, contact email and phone, booking link. Always available to the assistant.

**The assistant**
6. Answers only from the workspace's knowledge and business details (retrieval-augmented generation). Every answer can show the sources it used.
7. If the answer isn't in the knowledge, it says so plainly and offers to take a message or hand over to a human. It never invents prices, times or policies.
8. Per-workspace rules in plain English, e.g. "Never give legal advice; offer a consultation instead." Built-in presets: Law firm, Clinic, General business.
9. Guardrails: resists prompt injection ("ignore your instructions"), stays on topic, never reveals its system prompt or other businesses' data, and refuses harmful requests.
10. Answers stream word by word.
11. AI provider is swappable by env: Anthropic Claude (default) or OpenAI.

**Enquiries and bookings**
12. Collects an enquiry inside the chat (name, email or phone, what they need), with consent text, and emails it to the business.
13. Booking: shows the business's booking link, or, if connected, offers available times from a Slotwise instance through its public API and books one.

**Live handover**
14. Staff see live conversations in a dashboard and can take over a chat; the visitor sees "You're now chatting with [name]". Staff can hand back to the assistant.
15. If no staff member is online, handover becomes an enquiry instead.

**The widget**
16. Added to any website with one script tag and one HTML tag (a Web Component with Shadow DOM, so no CSS clashes). Brand colour, greeting, position and avatar set in the dashboard. Works on WordPress, Laravel, plain HTML.
17. Mobile-friendly, keyboard accessible, screen-reader labelled.

**Insights**
18. Conversation history with search; enquiries list; "unanswered questions" list (questions the assistant couldn't answer), so the business knows what knowledge to add.

**Cost and abuse controls**
19. Rate limit per visitor and per workspace; a monthly AI spend cap per workspace (tracked in tokens); when the cap is hit, the widget switches to "leave a message" mode.

**Quality**
20. An evaluation set in the repo: questions with expected behaviour (correct answer from knowledge, honest "I don't know", refuses legal advice, resists prompt injection). A command runs it and prints a score. CI runs a small version.

**Demo mode**
21. `DEMO_MODE=true`: a seeded demo business (a fictional physiotherapy clinic) with knowledge loaded, a demo page showing the widget on a fake website, a strict per-visitor message limit and a hard monthly cap, no real emails, nightly reset.

**Self-hosting**
22. `docker compose up` runs web, API, worker, PostgreSQL (with pgvector) and Redis.

## 4. Non-functional

- First token of an answer in under 2 seconds on a normal connection.
- Real-time over WebSockets, working across more than one API instance (Redis pub/sub).
- UK English. No real personal data in seeds, tests, logs or evaluation files. Conversation data retention configurable (default 90 days).

## 5. README must include

What it does (with a short demo GIF), why it exists, add the widget to a site, self-host with Docker, how answers stay grounded (retrieval, rules, guardrails), the evaluation set and its latest score, hard problems and decisions, tests. Plain, simple English, same standard as the Slotwise repo.

## 6. Out of scope for version 1

Voice and phone calls, WhatsApp/Messenger channels, payments, multiple languages, fine-tuning models, a hosted SaaS version.

## 7. Done means

- A business can add knowledge, embed the widget, and get grounded, streamed answers; enquiries arrive by email; staff can take over a chat live; unanswered questions are listed.
- Tests pass for login, permissions, workspace isolation (no cross-workspace retrieval), rate limits and spend cap.
- Evaluation set runs and its score is in the README. Demo live, `docker compose up` works from a clean machine.
