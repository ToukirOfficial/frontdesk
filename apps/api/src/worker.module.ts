import { type DynamicModule, Module } from '@nestjs/common';
import type { AppConfig } from './config.js';
import { CoreModule } from './core.module.js';
import { createEmbedder, EMBEDDER } from './ai/embeddings.js';
import { APP_CONFIG } from './config.js';
import { KnowledgeProcessor } from './knowledge/knowledge.processor.js';
import { VectorStore } from './knowledge/vector-store.js';
import { MailProcessor } from './mail/mail.processor.js';

/** The background worker (src/worker.ts): everything slow runs here, never inside a request. */
@Module({})
export class WorkerModule {
  static forConfig(config: AppConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [CoreModule.forConfig(config)],
      providers: [
        MailProcessor,
        KnowledgeProcessor,
        VectorStore,
        { provide: EMBEDDER, useFactory: createEmbedder, inject: [APP_CONFIG] },
      ],
    };
  }
}
