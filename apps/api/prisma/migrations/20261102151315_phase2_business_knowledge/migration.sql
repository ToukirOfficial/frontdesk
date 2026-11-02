-- pgvector: Prisma can't declare the extension or an HNSW index, so both are added here (create-only migration).
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "Preset" AS ENUM ('general', 'law', 'clinic');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('faq', 'text', 'file', 'url');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('processing', 'ready', 'failed');

-- CreateTable
CREATE TABLE "business_profiles" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "opening_hours" JSONB NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "booking_url" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_settings" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "preset" "Preset" NOT NULL DEFAULT 'general',
    "rules" TEXT NOT NULL DEFAULT '',
    "slotwise_base_url" TEXT,
    "slotwise_key_cipher" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assistant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "type" "SourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "question" TEXT,
    "content" TEXT,
    "stored_name" TEXT,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "url" TEXT,
    "status" "SourceStatus" NOT NULL DEFAULT 'processing',
    "error" TEXT,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "page_url" TEXT,
    "embedding" vector(384) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_profiles_workspace_id_key" ON "business_profiles"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_settings_workspace_id_key" ON "assistant_settings"("workspace_id");

-- CreateIndex
CREATE INDEX "knowledge_sources_workspace_id_created_at_idx" ON "knowledge_sources"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "knowledge_chunks_workspace_id_idx" ON "knowledge_chunks"("workspace_id");

-- CreateIndex
CREATE INDEX "knowledge_chunks_source_id_idx" ON "knowledge_chunks"("source_id");

-- AddForeignKey
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Approximate nearest-neighbour index for cosine distance. Queries always filter by workspace_id too
-- (see docs/decisions/0001-filtered-vector-search.md).
CREATE INDEX "knowledge_chunks_embedding_hnsw" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);
