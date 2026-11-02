# 0003: Real-time chat and live handover

**Status:** accepted · 2026-11-02

## Decision

- **Socket.IO** with the **Redis adapter**: any API instance can emit to any conversation's room, so several API instances work behind a load balancer. Sockets live at `/api/socket.io` with no trailing slash, so they pass through the Next.js `/api` proxy (Next.js redirects `/path/` to `/path`).
- **Visitors** authenticate each socket on connect with a visitor token (JWT with its own audience) that names one workspace and one conversation. A visitor socket only ever joins that conversation's room.
- **Staff** authenticate with the dashboard's httpOnly cookie. Any other site's Origin is refused. A missing Origin is allowed, because browsers omit it on same-origin GETs, which is how Socket.IO's first request goes; cross-site requests always carry one. A membership check runs before a socket joins a workspace room.
- **Online** means a staff dashboard socket is in the workspace room on any instance (`fetchSockets()` through the adapter). There's no separate presence store to go stale.
- **Takeover is one conditional update** (`UPDATE … WHERE mode = 'ai'`). Of two people pressing "Take over" at once, exactly one gets the chat; the other gets 409. Tested with concurrent requests.
- **The assistant stays quiet** while a person has the chat. Visitor messages are still stored and forwarded to staff.
- **One reply at a time per conversation** (a short Redis lock), so a visitor can't make the model answer several messages in parallel.

## Why not…

- **Server-Sent Events plus POST:** simpler, but handover needs both directions and presence; Socket.IO gives rooms, acks and reconnection.
- **Sticky sessions:** not needed for WebSockets; long-polling fallback with several instances would need them, which the README notes.
