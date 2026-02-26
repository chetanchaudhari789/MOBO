import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import logger, { securityLog, logEvent } from '../config/logger.js';

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
  });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // requestId is kept for internal logging only — never exposed in API responses.
  const requestId = String((res.locals as any)?.requestId || res.getHeader?.('x-request-id') || '').trim();

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
    const isProd = process.env.NODE_ENV === 'production';
    res.status(400).json({
      error: {
        code: 'BAD_REQUEST',
        message: 'Please check your input and try again.',
        // In production, only expose user-facing field paths and messages (no internal schema details).
        details: isProd
          ? err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
          : err.issues,
      },
    });
    return;
  }

  // Malformed JSON from express.json() / body-parser should never be a 500.
  // This commonly appears as a SyntaxError with type='entity.parse.failed'.
  const anyErr = err as any;
  if (
    anyErr &&
    (anyErr.type === 'entity.parse.failed' ||
      (anyErr instanceof SyntaxError && Number((anyErr as any).status) === 400))
  ) {
    res.status(400).json({
      error: {
        code: 'BAD_JSON',
        message: 'The request body contains invalid JSON. Please check and try again.',
      },
    });
    return;
  }

  // Request body exceeds the configured limit (express.json's `limit` option).
  if (anyErr && anyErr.type === 'entity.too.large') {
    res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'The uploaded data is too large. Please reduce the file size and try again.',
      },
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
            message: 'This entry already exists. Please use a different value.',
          },
        });
        return;
      case 'P2025': // Record not found
        res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: 'The requested item was not found.',
          },
        });
        return;
      case 'P2003': // Foreign key constraint failure
        res.status(400).json({
          error: {
            code: 'INVALID_REFERENCE',
            message: 'The referenced item does not exist.',
          },
        });
        return;
      case 'P2024': // Connection pool timeout
        logger.error('Database connection pool timeout', { requestId, error: anyErr });
        res.status(503).json({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'We are experiencing high traffic. Please try again in a moment.',
          },
        });
        return;
      case 'P2010': // Raw query failed
      case 'P2022': // Column does not exist
      case 'P2023': // Inconsistent column data
        logger.error(`Database schema error ${prismaCode}`, { requestId, error: anyErr });
        res.status(500).json({
          error: {
            code: 'INTERNAL_SERVER_ERROR',
            message: 'A database configuration error occurred. Our team has been notified.',
          },
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
        message: 'The provided data is not valid. Please check and try again.',
      },
    });
    return;
  }

  // JWT-specific errors for better client-side handling
  if (anyErr?.name === 'TokenExpiredError') {
    res.status(401).json({
      error: {
        code: 'TOKEN_EXPIRED',
        message: 'Your session has expired. Please log in again.',
      },
    });
    return;
  }
  if (anyErr?.name === 'JsonWebTokenError') {
    securityLog.warn('Invalid JWT token attempt', { requestId, ip: req.ip, error: anyErr.message });
    res.status(401).json({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Your session is invalid. Please log in again.',
      },
    });
    return;
  }

  // Network/connectivity errors — surface as 503 so clients know to retry.
  const networkCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN']);
  if (anyErr?.code && networkCodes.has(String(anyErr.code))) {
    logger.error('Network error during request', { requestId, code: anyErr.code, error: anyErr.message });
    res.status(503).json({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'A downstream service is temporarily unreachable. Please try again shortly.',
      },
    });
    return;
  }

  logEvent('error', `Unhandled error on ${req.method} ${req.originalUrl}`, {
    domain: 'http',
    eventName: 'UNHANDLED_REQUEST_ERROR',
    requestId: requestId || undefined,
    method: req.method,
    route: req.originalUrl,
    ip: req.ip,
    stack: err instanceof Error ? err.stack : undefined,
    metadata: {
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: err instanceof Error ? err.message : String(err),
    },
  });

  const isProd = process.env.NODE_ENV === 'production';
  const message = isProd
    ? 'Something went wrong. Please try again later.'
    : (err instanceof Error ? err.message : String(err)) || 'Something went wrong. Please try again later.';
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message,
    },
  });
}
