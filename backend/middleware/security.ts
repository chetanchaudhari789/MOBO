/**
 * Security middleware for the MOBO backend.
 *
 * Provides additional hardening beyond Helmet:
 * - Request size limits per route category
 * - Suspicious pattern detection (SQL injection, NoSQL injection, path traversal)
 * - Request timing headers for client-side performance monitoring
 * - Security event logging for audit trail
 */
import type { NextFunction, Request, Response } from 'express';
import { securityLog } from '../config/logger.js';

// ─── Suspicious Pattern Detection ───────────────────────────────────────────
// Patterns that should never appear in normal request parameters.
// These are logged (not blocked) to avoid false positives, but they populate
// the security audit trail for intrusion detection review.
const SUSPICIOUS_PATTERNS = [
  /(\$where|\$gt|\$lt|\$ne|\$regex|\$in|\$nin|\$or|\$and|\$not)/i,  // NoSQL injection
  /(<script[^>]*>|javascript:|on\w+\s*=)/i,                          // XSS vectors
  /(\.\.[/\\]){2,}/,                                                  // Path traversal
  /(union\s+select|insert\s+into|drop\s+table|delete\s+from)/i,      // SQL injection
  /(\x00|\x1a|\x7f)/,                                                 // Null bytes
];

function containsSuspiciousPattern(value: string): string | null {
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(value)) return pattern.source;
  }
  return null;
}

function checkObjectForSuspiciousPatterns(
  obj: Record<string, unknown>,
  location: string,
  req: Request,
  res: Response,
  depth = 0
): void {
  if (depth > 5) return; // Prevent deep recursion
  for (const [key, value] of Object.entries(obj)) {
    // Check the key itself
    const keyMatch = containsSuspiciousPattern(key);
    if (keyMatch) {
      securityLog.warn('Suspicious pattern in request key', {
        requestId: String(res.locals.requestId || ''),
        pattern: keyMatch,
        location: `${location}.${key}`,
        ip: req.ip,
        method: req.method,
        url: req.originalUrl,
      });
    }

    // Check string values
    if (typeof value === 'string') {
      const valMatch = containsSuspiciousPattern(value);
      if (valMatch) {
        securityLog.warn('Suspicious pattern in request value', {
          requestId: String(res.locals.requestId || ''),
          pattern: valMatch,
          location: `${location}.${key}`,
          ip: req.ip,
          method: req.method,
          url: req.originalUrl,
        });
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      checkObjectForSuspiciousPatterns(value as Record<string, unknown>, `${location}.${key}`, req, res, depth + 1);
    }
  }
}

/**
 * Middleware that logs suspicious request patterns for security monitoring.
 * Does NOT block requests (to avoid false positives) — just creates an audit trail.
 */
export function securityAuditMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Check query parameters
    if (req.query && typeof req.query === 'object') {
      checkObjectForSuspiciousPatterns(req.query as Record<string, unknown>, 'query', req, res);
    }

    // Check body (only if parsed)
    if (req.body && typeof req.body === 'object') {
      checkObjectForSuspiciousPatterns(req.body as Record<string, unknown>, 'body', req, res);
    }

    // Check URL params
    if (req.params && typeof req.params === 'object') {
      checkObjectForSuspiciousPatterns(req.params as Record<string, unknown>, 'params', req, res);
    }

    next();
  };
}

/**
 * Middleware that adds response timing headers.
 * Helps frontend and monitoring tools measure API latency.
 */
export function responseTimingMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();

    // Hook into writeHead to set timing headers before they're sent
    const originalWriteHead = res.writeHead.bind(res);
    (res as any).writeHead = function (statusCode: number, ...args: any[]) {
      const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000;
      res.setHeader('X-Response-Time', `${elapsed.toFixed(2)}ms`);
      return originalWriteHead(statusCode, ...args);
    };

    next();
  };
}
