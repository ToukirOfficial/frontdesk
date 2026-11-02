import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import {
  type CreateKnowledgeBody,
  ErrorCode,
  type ImportUrlBody,
  type KnowledgeSource,
  type UpdateKnowledgeBody,
} from '@frontdesk/shared';
import type { Queue } from 'bullmq';
import { fileTypeFromBuffer } from 'file-type';
import type { WorkspaceAuth } from '../common/auth.js';
import { AppError, notFound } from '../common/errors.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { checkUrlShape, UrlRejectedError } from '../net/safe-fetch.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { KNOWLEDGE_QUEUE, type KnowledgeJob } from '../queues.js';
import type { KnowledgeSource as SourceRow } from '../generated/prisma/client.js';
import { deleteFile, saveFile, storedFilePath } from './storage.js';

const ALLOWED_FILES: Record<string, 'pdf' | 'docx'> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

export const toSourceDto = (s: SourceRow): KnowledgeSource => ({
  id: s.id,
  type: s.type,
  title: s.title,
  question: s.question,
  content: s.content,
  url: s.url,
  fileName: s.type === 'file' ? s.title : null,
  sizeBytes: s.sizeBytes,
  status: s.status,
  error: s.error,
  chunkCount: s.chunkCount,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

/** A safe display name from an uploaded file's name: no path, no control characters. */
const displayName = (original: string): string => {
  const base = original.split(/[\\/]/).pop() ?? 'file';
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || 'file';
};

@Injectable()
export class KnowledgeService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @InjectQueue(KNOWLEDGE_QUEUE) private readonly queue: Queue<KnowledgeJob>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(auth: WorkspaceAuth): Promise<KnowledgeSource[]> {
    const rows = await this.prisma.knowledgeSource.findMany({
      where: { workspaceId: auth.workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toSourceDto);
  }

  async get(auth: WorkspaceAuth, sourceId: string): Promise<KnowledgeSource> {
    return toSourceDto(await this.find(auth, sourceId));
  }

  async create(auth: WorkspaceAuth, body: CreateKnowledgeBody): Promise<KnowledgeSource> {
    const row = await this.prisma.knowledgeSource.create({
      data:
        body.type === 'faq'
          ? { workspaceId: auth.workspaceId, type: 'faq', title: body.question, question: body.question, content: body.answer }
          : { workspaceId: auth.workspaceId, type: 'text', title: body.title, content: body.content },
    });
    await this.enqueue(row);
    return toSourceDto(row);
  }

  /** FAQ pairs and text pages can be edited; files and websites can only be renamed or re-imported. */
  async update(auth: WorkspaceAuth, sourceId: string, body: UpdateKnowledgeBody): Promise<KnowledgeSource> {
    const row = await this.find(auth, sourceId);
    const changesContent = body.question !== undefined || body.answer !== undefined || body.content !== undefined;
    if (changesContent && (row.type === 'file' || row.type === 'url')) {
      throw new AppError(400, ErrorCode.NOT_EDITABLE, 'Files and websites can’t be edited here. Upload or import again.');
    }
    const data =
      row.type === 'faq'
        ? {
            question: body.question ?? row.question,
            content: body.answer ?? row.content,
            title: body.question ?? row.title,
          }
        : row.type === 'text'
          ? { title: body.title ?? row.title, content: body.content ?? row.content }
          : { title: body.title ?? row.title };
    const updated = await this.prisma.knowledgeSource.update({
      where: { id: row.id },
      data: changesContent || row.type === 'text' ? { ...data, status: 'processing', error: null } : data,
    });
    if (changesContent || row.type === 'text') await this.enqueue(updated);
    return toSourceDto(updated);
  }

  /** Processes the source again, e.g. after a failure or to refresh an imported website. */
  async reprocess(auth: WorkspaceAuth, sourceId: string): Promise<KnowledgeSource> {
    const row = await this.find(auth, sourceId);
    const updated = await this.prisma.knowledgeSource.update({
      where: { id: row.id },
      data: { status: 'processing', error: null },
    });
    await this.enqueue(updated);
    return toSourceDto(updated);
  }

  async remove(auth: WorkspaceAuth, sourceId: string): Promise<void> {
    const row = await this.find(auth, sourceId);
    await this.prisma.knowledgeSource.delete({ where: { id: row.id } }); // chunks cascade
    if (row.storedName) await deleteFile(this.config, row.storedName);
  }

  /** Checks the file's real type from its bytes (not its name), stores it under a random name, queues parsing. */
  async upload(auth: WorkspaceAuth, file: { buffer: Buffer; originalname: string; size: number }): Promise<KnowledgeSource> {
    // The public demo is shared by strangers: no file hosting there.
    if ((await this.prisma.workspace.findUnique({ where: { id: auth.workspaceId }, select: { isDemo: true } }))?.isDemo) {
      throw new AppError(403, ErrorCode.DEMO_MODE, 'File uploads are switched off in the public demo. Add an FAQ or a page of text instead.');
    }
    const detected = await fileTypeFromBuffer(file.buffer);
    const ext = detected ? ALLOWED_FILES[detected.mime] : undefined;
    if (!detected || !ext) {
      throw new AppError(400, ErrorCode.FILE_REJECTED, 'Only PDF and Word (.docx) files can be uploaded.');
    }
    const storedName = `${randomUUID()}.${ext}`;
    await saveFile(this.config, storedName, file.buffer);
    const row = await this.prisma.knowledgeSource.create({
      data: {
        workspaceId: auth.workspaceId,
        type: 'file',
        title: displayName(file.originalname),
        storedName,
        mimeType: detected.mime,
        sizeBytes: file.size,
      },
    });
    await this.enqueue(row);
    return toSourceDto(row);
  }

  /** Records the import and queues it. The full address check (DNS, private ranges) happens in the worker. */
  async importUrl(auth: WorkspaceAuth, body: ImportUrlBody): Promise<KnowledgeSource> {
    let url: URL;
    try {
      url = checkUrlShape(body.url, this.config.NODE_ENV !== 'production');
    } catch (err) {
      throw new AppError(400, ErrorCode.URL_REJECTED, err instanceof UrlRejectedError ? err.message : 'Invalid address.', {
        url: err instanceof UrlRejectedError ? err.message : 'Invalid address',
      });
    }
    const row = await this.prisma.knowledgeSource.create({
      data: {
        workspaceId: auth.workspaceId,
        type: 'url',
        title: url.hostname,
        url: url.toString(),
        maxPages: body.maxPages,
      },
    });
    await this.enqueue(row);
    return toSourceDto(row);
  }

  /** The stored file of a source in this workspace, for download by owners and admins. */
  async file(auth: WorkspaceAuth, sourceId: string): Promise<{ path: string; name: string; mimeType: string }> {
    const row = await this.find(auth, sourceId);
    if (row.type !== 'file' || !row.storedName || !row.mimeType) throw notFound('File not found.');
    return { path: storedFilePath(this.config, row.storedName), name: row.title, mimeType: row.mimeType };
  }

  private async find(auth: WorkspaceAuth, sourceId: string): Promise<SourceRow> {
    const row = await this.prisma.knowledgeSource.findFirst({ where: { id: sourceId, workspaceId: auth.workspaceId } });
    if (!row) throw notFound('Knowledge not found.');
    return row;
  }

  private async enqueue(row: SourceRow): Promise<void> {
    await this.queue.add(
      'process',
      { workspaceId: row.workspaceId, sourceId: row.id },
      { attempts: 2, backoff: { type: 'fixed', delay: 10_000 }, removeOnComplete: true, removeOnFail: { age: 7 * 24 * 3600 } },
    );
  }
}
