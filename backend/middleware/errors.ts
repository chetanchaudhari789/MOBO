import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${req.method} ${req.path}`,
    },
    requestId: String((res.locals as any)?.requestId || res.getHeader?.('x-request-id') || '').trim(),
  });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  // Validation errors should never be 500s.
  if (err instanceof z.ZodError) {
    res.status(400).json({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid request',
        details: err.issues,
      },
    });
    return;
  }

  // Common Mongoose failure when an endpoint expects an ObjectId but receives an invalid string.
  const anyErr = err as any;
  if (anyErr && anyErr.name === 'CastError') {
    res.status(400).json({
      error: {
        code: 'INVALID_ID',
        message: 'Invalid identifier',
        details: { path: anyErr.path, value: anyErr.value },
      },
    });
    return;
  }

  // Malformed JSON from express.json() / body-parser should never be a 500.
  // This commonly appears as a SyntaxError with type='entity.parse.failed'.
  if (anyErr && (anyErr.type === 'entity.parse.failed' || (anyErr instanceof SyntaxError && anyErr.status === 400))) {
    res.status(400).json({
      error: {
        code: 'BAD_JSON',
        message: 'Malformed JSON body',
      },
    });
    return;
  }

  const requestId = String((res.locals as any)?.requestId || res.getHeader?.('x-request-id') || '').trim();
  const isProd = process.env.NODE_ENV === 'production';

  // eslint-disable-next-line no-console
  console.error(
    `[${requestId || '-'}] Unhandled error on ${req.method} ${req.originalUrl}:`,
    err
  );

  const message = isProd ? 'Unexpected error' : err instanceof Error ? err.message : 'Unexpected error';
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message,
    },
    requestId,
  });
}
