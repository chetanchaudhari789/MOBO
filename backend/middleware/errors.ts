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
  });
}

export function errorHandler(
  err: unknown,
  _req: Request,
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

  const message = err instanceof Error ? err.message : 'Unexpected error';
  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message,
    },
  });
}
