# 0001 — Filtered vector search returns k results from one workspace

**Status:** accepted · 2026-11-02

## Problem

Knowledge from every workspace lives in one `knowledge_chunks` table with one HNSW index. Every search filters by `workspace_id`. With a plain HNSW index scan, PostgreSQL fetches the `hnsw.ef_search` (default 40) nearest chunks from the whole table and *then* applies the filter. If other workspaces hold many chunks closer to the question, the filter removes them all and the search returns fewer than k results, often none. That isn't a leak (the filter still holds), but the assistant would wrongly say "I don't know".

Measured locally with 300 near chunks in workspace B and 12 far chunks in workspace A, asking for 5 from A:

| Plan | Rows returned |
|---|---|
| HNSW index scan + workspace filter | **0** |
| Exact scan of A's rows (our fallback) | 5 |

## Decision

`VectorStore.search` (the only code that reads embeddings) always filters by `workspace_id` and runs inside a transaction:

- **pgvector 0.8+** (Docker image and CI: `pgvector/pgvector:pg18`): `SET LOCAL hnsw.iterative_scan = relaxed_order` and `hnsw.ef_search = 100`. The index scan keeps going until k rows pass the filter. `relaxed_order` can return rows slightly out of order, so results are re-sorted by distance in the app.
- **Older pgvector** (e.g. Ubuntu's 0.6 package): `SET LOCAL enable_indexscan = off`, so PostgreSQL reads only the workspace's rows (via the `workspace_id` index) and sorts them exactly. That's slower on huge workspaces, but correct, and small businesses have hundreds of chunks, not millions.

The version is read once from `pg_extension`.

## Why not…

- **Partitioning or one index per workspace:** a lot of moving parts for small self-hosted installs.
- **A larger `ef_search` alone:** it only makes the failure rarer.

## Tests

`apps/api/test/knowledge.test.ts` seeds three workspaces (two holding 300 chunks each that match the question almost exactly) and checks that a search in the third returns exactly k of its own chunks, nearest first. On tables this small the planner usually picks an exact plan anyway, so the test guards against regressions (wrong filter, wrong workspace, short results); the table above shows the HNSW failure itself.
