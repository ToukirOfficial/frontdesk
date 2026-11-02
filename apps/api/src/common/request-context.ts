import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

interface RequestStore {
  requestId: string;
}

export const requestContext = new AsyncLocalStorage<RequestStore>();

/** Gives every request an id (kept if a valid one came from a proxy) and makes it visible to every log line. */
export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const incoming = req.get('x-request-id');
  const requestId = incoming && /^[A-Za-z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', requestId);
  requestContext.run({ requestId }, next);
};

export const currentRequestId = (): string | undefined => requestContext.getStore()?.requestId;
