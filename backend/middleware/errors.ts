import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import logger, { securityLog } from '../config/logger.js';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true; // Distinguishes expected errors from programming bugs
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

  // Prisma-specific error handling for clean, actionable API responses.
  if (anyErr?.constructor?.name === 'PrismaClientKnownRequestError' || anyErr?.code?.startsWith?.('P')) {
    const prismaCode = String(anyErr.code || '');
    switch (prismaCode) {
      case 'P2002': // Unique constraint violation
        res.status(409).json({
          error: {
            code: 'DUPLICATE_ENTRY',
            message: 'A record with this value already exists.',
          },
          requestId,
        });
        return;
      case 'P2025': // Record not found
        res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'The requested record was not found.',
          },
          requestId,
        });
        return;
      case 'P2003': // Foreign key constraint failure
        res.status(400).json({
          error: {
            code: 'INVALID_REFERENCE',
            message: 'Referenced record does not exist.',
          },
          requestId,
        });
        return;
      case 'P2024': // Connection pool timeout
        logger.error('Database connection pool timeout', { requestId, error: anyErr });
        res.status(503).json({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Service temporarily unavailable. Please try again.',
          },
          requestId,
        });
        return;
      default:
        // Log unknown Prisma errors but fall through to generic handler
        logger.error(`Prisma error ${prismaCode}`, { requestId, error: anyErr });
        break;
    }
  }

  // Prisma validation errors (P2000-series client validation)
  if (anyErr?.constructor?.name === 'PrismaClientValidationError') {
    logger.error('Prisma validation error', { requestId, error: anyErr });
    res.status(400).json({
      error: {
        code: 'BAD_REQUEST',
        message: 'Invalid data provided.',
      },
      requestId,
    });
    return;
  }

  // JWT-specific errors for better client-side handling
  if (anyErr?.name === 'TokenExpiredError') {
    res.status(401).json({
      error: {
        code: 'TOKEN_EXPIRED',
        message: 'Authentication token has expired. Please refresh or login again.',
      },
      requestId,
    });
    return;
  }
  if (anyErr?.name === 'JsonWebTokenError') {
    securityLog.warn('Invalid JWT token attempt', { requestId, ip: req.ip, error: anyErr.message });
    res.status(401).json({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Authentication token is invalid.',
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
