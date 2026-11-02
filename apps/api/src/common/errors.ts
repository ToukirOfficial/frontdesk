import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ErrorCode, type ErrorBody } from '@frontdesk/shared';
import type { Response } from 'express';

/** An error with a stable machine-readable code. Throw this from services. */
export class AppError extends HttpException {
  constructor(
    status: number,
    override readonly errorCode: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
    readonly extraHeaders?: Record<string, string>,
  ) {
    super(message, status);
  }
}

export const notFound = (what = 'Not found.'): AppError => new AppError(404, ErrorCode.NOT_FOUND, what);
export const forbidden = (msg = 'You don’t have permission to do that.'): AppError =>
  new AppError(403, ErrorCode.FORBIDDEN, msg);
export const unauthenticated = (): AppError => new AppError(401, ErrorCode.UNAUTHENTICATED, 'Please log in.');

const DEFAULT_CODES: Record<number, ErrorCode> = {
  400: ErrorCode.VALIDATION_FAILED,
  401: ErrorCode.UNAUTHENTICATED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  413: ErrorCode.VALIDATION_FAILED,
  429: ErrorCode.RATE_LIMITED,
};

/** Every error leaves the API as { statusCode, errorCode, message, fields? }. Internals are never sent. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('Error');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') return;
    const res = host.switchToHttp().getResponse<Response>();
    let body: ErrorBody;

    if (exception instanceof AppError) {
      body = {
        statusCode: exception.getStatus(),
        errorCode: exception.errorCode,
        message: exception.message,
        ...(exception.fields ? { fields: exception.fields } : {}),
      };
      for (const [k, v] of Object.entries(exception.extraHeaders ?? {})) res.setHeader(k, v);
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const message =
        status >= 500
          ? 'Something went wrong.'
          : typeof raw === 'string'
            ? raw
            : typeof (raw as { message?: unknown }).message === 'string'
              ? (raw as { message: string }).message
              : exception.message;
      body = { statusCode: status, errorCode: DEFAULT_CODES[status] ?? ErrorCode.INTERNAL, message };
    } else {
      // Body-parser errors carry a status; anything else is a bug.
      const status = (exception as { status?: unknown }).status;
      if (typeof status === 'number' && status >= 400 && status < 500) {
        body = {
          statusCode: status,
          errorCode: DEFAULT_CODES[status] ?? ErrorCode.VALIDATION_FAILED,
          message: 'Invalid request body.',
        };
      } else {
        this.log.error(exception instanceof Error ? exception : String(exception));
        body = {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          errorCode: ErrorCode.INTERNAL,
          message: 'Something went wrong.',
        };
      }
    }
    if (res.headersSent) return;
    res.status(body.statusCode).json(body);
  }
}
