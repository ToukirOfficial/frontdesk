# Assumptions

Decisions made where `PRD.md` and `plan.md` leave room. Each is easy to change.

## Accounts and access

- **A code on every login.** Password first, then a 6-digit code emailed for that login. Sign-up uses the same code step, which also confirms the email address. Codes expire after 10 minutes, work once, allow 5 tries, and a newer code cancels older ones.
- **Accepting an invite logs you in without a code.** The invite link was emailed to that address, so it already proves the person controls the inbox. People who already have an account confirm with their password.
- **Password reset** is included because the project rules require it to be rate-limited. A reset logs the account out everywhere.
- **Roles.** Owner: everything, including role changes and deleting the workspace. Admin: settings, knowledge, conversations, inviting admins and staff, removing staff. Staff: conversations, enquiries and unanswered questions. Ownership can't be handed over in version 1.
- **Someone else's workspace is "not found", not "forbidden",** so ids reveal nothing.
- **Access tokens carry only the user id.** Roles are read from the database on every workspace request, so removing someone takes effect immediately.

## Running locally

- Without `SMTP_URL`, the worker writes each email to `apps/api/tmp/mail/*.eml` (git-ignored) instead of sending it, so you can read your login code. Email contents never go to the logs.
- In production, `SMTP_URL` is required unless `DEMO_MODE=true` (the demo sends no email at all).

## Versions

- **Next.js 16.4** rather than the 16.3 in the original stack: every 16.3.x release has critical advisories (remote code execution) fixed only in 16.4.1+. Approved on 2026-11-02.
