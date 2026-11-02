-- Generated with `prisma migrate diff`; the DROP of the HNSW index Prisma can't see was removed.
-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "monthly_token_cap" INTEGER NOT NULL DEFAULT 2000000,
ADD COLUMN     "retention_days" INTEGER NOT NULL DEFAULT 90;

