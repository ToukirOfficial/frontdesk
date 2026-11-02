import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { currentRequestId } from './request-context.js';

/** Masked anywhere they appear in structured log params: a safety net, not a licence to log personal data. */
const REDACT = [
  'password',
  'token',
  'secret',
  'authorization',
  'cookie',
  'email',
  'phone',
  'key',
  'name',
  'code',
  'content',
  'message',
];

/** NestJS JSON logger that adds the request id to every line. */
export class JsonLogger extends ConsoleLogger {
  constructor(levels: LogLevel[] = ['error', 'warn', 'log']) {
    super({ json: true, logLevels: levels, redact: REDACT });
  }

  protected override getJsonLogObject(...args: Parameters<ConsoleLogger['getJsonLogObject']>) {
    const obj = super.getJsonLogObject(...args);
    const requestId = currentRequestId();
    return requestId ? { ...obj, requestId } : obj;
  }
}

export const makeLogger = (nodeEnv: string): ConsoleLogger | false =>
  nodeEnv === 'test'
    ? false
    : nodeEnv === 'production'
      ? new JsonLogger()
      : new JsonLogger(['error', 'warn', 'log', 'debug']);
