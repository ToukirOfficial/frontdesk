-- Page limit for website imports.
-- Note: Prisma doesn't know about the HNSW index (raw SQL in phase 2) and adds a DROP INDEX to every new
-- migration. Always delete that line.
ALTER TABLE "knowledge_sources" ADD COLUMN "max_pages" INTEGER;
