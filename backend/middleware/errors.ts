import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import logger from '../config/logger.js';

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
  const requestId = String((res.locals as any)?.requestId || res.getHeader?.('x-request-id') || '').trim();

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
      requestId,
    });
    return;
  }

  // Validation errors should never be 500s.
  if (err instanceof z.ZodError) {
    const isProd = process.env.NODE_ENV === 'production';
    res.status(400).json({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid request',
        // In production, only expose user-facing field paths and messages (no internal schema details).
        details: isProd
          ? err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
          : err.issues,
      },
      requestId,
    });
    return;
  }

  // Common Mongoose failure when an endpoint expects an ObjectId but receives an invalid string.
  const anyErr = err as any;
  if (anyErr && anyErr.name === 'CastError') {
    res.status(400).json({
      error: {
        code: 'INVALID_ID',
        message: 'Invalid identifier format',
      },
      requestId,
    });
    return;
  }

  // Malformed JSON from express.json() / body-parser should never be a 500.
  // This commonly appears as a SyntaxError with type='entity.parse.failed'.
  if (
    anyErr &&
    (anyErr.type === 'entity.parse.failed' ||
      (anyErr instanceof SyntaxError && Number((anyErr as any).status) === 400))
  ) {
    res.status(400).json({
      error: {
        code: 'BAD_JSON',
        message: 'Malformed JSON body',
      },
      requestId,
    });
    return;
  }

  // Request body exceeds the configured limit (express.json's `limit` option).
  if (anyErr && anyErr.type === 'entity.too.large') {
    res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large. Please reduce the payload size.',
      },
      requestId,
    });
    return;
  }

  // MongoDB duplicate key error (E11000) — surface a clean 409 instead of a raw 500.
  if (anyErr && (Number(anyErr.code) === 11000 || Number(anyErr.errorResponse?.code) === 11000)) {
    res.status(409).json({
      error: {
        code: 'DUPLICATE_ENTRY',
        message: 'A record with this value already exists.',
      },
      requestId,
    });
    return;
  }

  const isProd = process.env.NODE_ENV === 'production';

  logger.error(`Unhandled error on ${req.method} ${req.originalUrl}`, {
    requestId: requestId || undefined,
    error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
  });

  const message = isProd ? 'Unexpected error' : err instanceof Error ? err.message : 'Unexpected error';
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message,
    },
    requestId,
  });
}
