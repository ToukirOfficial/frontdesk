import { createReadStream } from 'node:fs';
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  type CreateKnowledgeBody,
  createKnowledgeBodySchema,
  ErrorCode,
  type ImportUrlBody,
  importUrlBodySchema,
  type KnowledgeList,
  knowledgeListSchema,
  type KnowledgeSource,
  knowledgeSourceSchema,
  MAX_UPLOAD_BYTES,
  okSchema,
  sourceParamsSchema,
  type UpdateKnowledgeBody,
  updateKnowledgeBodySchema,
  workspaceParamsSchema,
} from '@frontdesk/shared';
import { Member, Roles, type WorkspaceAuth } from '../common/auth.js';
import { AppError } from '../common/errors.js';
import { RateLimiter } from '../common/rate-limit.js';
import { Returns } from '../common/schema.js';
import { KnowledgeService } from './knowledge.service.js';

/** Knowledge is managed by owners and admins. */
@Controller('workspaces/:workspaceId/knowledge')
@Roles('owner', 'admin')
export class KnowledgeController {
  constructor(
    @Inject(KnowledgeService) private readonly knowledge: KnowledgeService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  @Get()
  @Returns(knowledgeListSchema)
  async list(@Param({ schema: workspaceParamsSchema }) _p: unknown, @Member() auth: WorkspaceAuth): Promise<KnowledgeList> {
    return { items: await this.knowledge.list(auth) };
  }

  @Post()
  @Returns(knowledgeSourceSchema, 201)
  async create(
    @Param({ schema: workspaceParamsSchema }) _p: unknown,
    @Member() auth: WorkspaceAuth,
    @Body({ schema: createKnowledgeBodySchema }) body: CreateKnowledgeBody,
  ): Promise<KnowledgeSource> {
    await this.limiter.hit(`knowledge:ws:${auth.workspaceId}`, 300, 60 * 60);
    return this.knowledge.create(auth, body);
  }

  /** multipart/form-data with one `file` field. The guard runs before the body is read. */
  @Post('upload')
  @Returns(knowledgeSourceSchema, 201)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } }))
  async upload(
    @Param({ schema: workspaceParamsSchema }) _p: unknown,
    @Member() auth: WorkspaceAuth,
    @UploadedFile() file: { buffer: Buffer; originalname: string; size: number } | undefined,
  ): Promise<KnowledgeSource> {
    if (!file) throw new AppError(400, ErrorCode.FILE_REJECTED, 'Choose a PDF or Word file to upload.');
    await this.limiter.hit(`upload:ws:${auth.workspaceId}`, 60, 60 * 60);
    return this.knowledge.upload(auth, file);
  }

  @Post('import-url')
  @Returns(knowledgeSourceSchema, 201)
  async importUrl(
    @Param({ schema: workspaceParamsSchema }) _p: unknown,
    @Member() auth: WorkspaceAuth,
    @Body({ schema: importUrlBodySchema }) body: ImportUrlBody,
  ): Promise<KnowledgeSource> {
    await this.limiter.hit(`import:ws:${auth.workspaceId}`, 20, 60 * 60);
    return this.knowledge.importUrl(auth, body);
  }

  @Get(':sourceId')
  @Returns(knowledgeSourceSchema)
  get(@Param({ schema: sourceParamsSchema }) p: { sourceId: string }, @Member() auth: WorkspaceAuth): Promise<KnowledgeSource> {
    return this.knowledge.get(auth, p.sourceId);
  }

  @Patch(':sourceId')
  @Returns(knowledgeSourceSchema)
  update(
    @Param({ schema: sourceParamsSchema }) p: { sourceId: string },
    @Member() auth: WorkspaceAuth,
    @Body({ schema: updateKnowledgeBodySchema }) body: UpdateKnowledgeBody,
  ): Promise<KnowledgeSource> {
    return this.knowledge.update(auth, p.sourceId, body);
  }

  @Post(':sourceId/reprocess')
  @Returns(knowledgeSourceSchema)
  async reprocess(@Param({ schema: sourceParamsSchema }) p: { sourceId: string }, @Member() auth: WorkspaceAuth): Promise<KnowledgeSource> {
    await this.limiter.hit(`knowledge:ws:${auth.workspaceId}`, 300, 60 * 60);
    return this.knowledge.reprocess(auth, p.sourceId);
  }

  @Delete(':sourceId')
  @Returns(okSchema)
  async remove(@Param({ schema: sourceParamsSchema }) p: { sourceId: string }, @Member() auth: WorkspaceAuth) {
    await this.knowledge.remove(auth, p.sourceId);
    return { ok: true } as const;
  }

  /** Downloads an uploaded file. Served only through this permission-checked route, always as an attachment. */
  @Get(':sourceId/file')
  async file(@Param({ schema: sourceParamsSchema }) p: { sourceId: string }, @Member() auth: WorkspaceAuth): Promise<StreamableFile> {
    const f = await this.knowledge.file(auth, p.sourceId);
    return new StreamableFile(createReadStream(f.path), {
      type: f.mimeType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    });
  }
}
