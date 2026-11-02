import { applyDecorators, HttpCode, SerializeOptions, StandardSchemaValidationPipe } from '@nestjs/common';
import { ErrorCode } from '@frontdesk/shared';
import type { z } from 'zod';
import { AppError } from './errors.js';

/** Declares a route's response schema: the serializer strips anything not in it (no leaked hashes or internals). */
export const Returns = (schema: z.ZodType, status = 200) => applyDecorators(HttpCode(status), SerializeOptions({ schema }));

/** Global input pipe: Zod via Standard Schema. Zod objects strip unknown fields. */
export const validationPipe = new StandardSchemaValidationPipe({
  exceptionFactory: (issues) => {
    const fields: Record<string, string> = {};
    for (const issue of issues) {
      const path = (issue.path ?? []).map((p) => (typeof p === 'object' ? String(p.key) : String(p))).join('.');
      fields[path || 'request'] ??= issue.message;
    }
    return new AppError(400, ErrorCode.VALIDATION_FAILED, 'Some fields need attention.', fields);
  },
});
