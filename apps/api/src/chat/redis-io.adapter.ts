import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import type { AppConfig } from '../config.js';
import { redisOptions } from '../redis/redis.service.js';

export const SOCKET_PATH = '/api/socket.io';

/** Socket.IO over Redis pub/sub, so a message emitted on one API instance reaches sockets on all of them. */
export class RedisIoAdapter extends IoAdapter {
  private readonly pub: Redis;
  private readonly sub: Redis;

  constructor(app: INestApplicationContext, config: AppConfig) {
    super(app);
    this.pub = new Redis(redisOptions(config.REDIS_URL));
    this.sub = this.pub.duplicate();
    this.pub.on('error', () => undefined);
    this.sub.on('error', () => undefined);
    this.key = `${config.REDIS_PREFIX}:socket.io`;
  }

  private readonly key: string;

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      path: SOCKET_PATH,
      // The widget runs on customers' sites; origins are checked per workspace on connect.
      cors: { origin: true, credentials: false },
      maxHttpBufferSize: 16 * 1024,
      serveClient: false,
    } as ServerOptions) as Server;
    server.adapter(createAdapter(this.pub, this.sub, { key: this.key }));
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.all([this.pub.quit().catch(() => undefined), this.sub.quit().catch(() => undefined)]);
  }
}
