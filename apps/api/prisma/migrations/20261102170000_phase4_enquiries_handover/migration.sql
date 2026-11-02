-- Generated with `prisma migrate diff`; the DROP of the HNSW index Prisma can't see was removed.
-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "handover_requested_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "enquiries" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "need" TEXT NOT NULL,
    "consent_text" TEXT NOT NULL,
    "consent_at" TIMESTAMPTZ(3) NOT NULL,
    "emailed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "enquiries_workspace_id_created_at_idx" ON "enquiries"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "enquiries_conversation_id_idx" ON "enquiries"("conversation_id");

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

