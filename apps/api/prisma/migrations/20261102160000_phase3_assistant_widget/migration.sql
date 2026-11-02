-- Generated with `prisma migrate diff`; the DROP of the HNSW index Prisma can't see was removed.
-- CreateEnum
CREATE TYPE "ConversationMode" AS ENUM ('ai', 'human', 'closed');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('visitor', 'assistant', 'staff', 'system');

-- AlterTable
ALTER TABLE "assistant_settings" ADD COLUMN     "avatar_name" TEXT,
ADD COLUMN     "brand_colour" TEXT NOT NULL DEFAULT '#0f766e',
ADD COLUMN     "greeting" TEXT NOT NULL DEFAULT 'Hello! How can I help you today?',
ADD COLUMN     "position" TEXT NOT NULL DEFAULT 'right';

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "allowed_origins" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "public_key" TEXT NOT NULL DEFAULT ('fd_pk_'::text || replace((gen_random_uuid())::text, '-'::text, ''::text));

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "visitor_id" TEXT NOT NULL,
    "mode" "ConversationMode" NOT NULL DEFAULT 'ai',
    "assigned_user_id" UUID,
    "last_message_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "sources" JSONB,
    "author_name" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unanswered_questions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "conversation_id" UUID,
    "question" TEXT NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "unanswered_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_months" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usage_months_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_workspace_id_last_message_at_idx" ON "conversations"("workspace_id", "last_message_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_workspace_id_created_at_idx" ON "messages"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "unanswered_questions_workspace_id_created_at_idx" ON "unanswered_questions"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "unanswered_questions_conversation_id_idx" ON "unanswered_questions"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "usage_months_workspace_id_month_key" ON "usage_months"("workspace_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_public_key_key" ON "workspaces"("public_key");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unanswered_questions" ADD CONSTRAINT "unanswered_questions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unanswered_questions" ADD CONSTRAINT "unanswered_questions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_months" ADD CONSTRAINT "usage_months_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

