# 0004: Bring your own key

**Decision.** Frontdesk includes no AI model and pays for none. Chat replies use, in order: the workspace's own key (Settings → AI provider), the instance key from `.env`, or nothing. The public demo never uses the instance key. It replays recorded answers unless a visitor pastes their own key.

**Why.** A free, self-hosted project can't have a running AI bill that depends on one person's key or machine. Businesses keep control of their provider, model, data agreement and spending.

**How it works.**
- `AiResolver` picks the provider for each message. A workspace's key is looked up by that workspace's id only. Tests prove one workspace never answers with another's key.
- Providers: Anthropic (its SDK), and OpenAI, Gemini and any OpenAI-compatible server through the `openai` SDK with a base URL. Model ids always come from configuration. There's no default to go stale.
- Keys are AES-256-GCM sealed with `ENCRYPTION_KEY` and never returned (only the last 4 characters). Provider errors are reduced to a fixed category before logging, because an SDK error can echo request details. A test captures the real JSON logger's output and checks for keys.
- A workspace's OpenAI-compatible address is admin-typed, so it goes through the same SSRF guard as website import, as a streaming `fetch`: DNS is vetted, the connection is pinned, private addresses are refused in production and no redirects are followed.
- Demo visitor keys are sealed in Redis with a 24-hour TTL, tied to one conversation, and cleared at the nightly reset.

**Trade-offs.** A business must get its own key before the assistant answers, so the setup card and the widget's "No AI provider configured" state make that obvious. Replayed demo answers aren't live, so every one is labelled "Demo: sample answers" and free text isn't offered.
