/**
 * Centralized Winston logger for the MOBO backend.
 *
 * Features:
 * - Colorful, human-readable console output in development
 * - Structured JSON logs in production (for log aggregators like Datadog, ELK, CloudWatch)
 * - File transport in production for persistent log storage with daily rotation
 * - Request ID correlation via `requestId` metadata
 * - Module-scoped child loggers via `logger.child({ module: 'auth' })`
 * - Timestamp + level + module + message in every log line
 * - Silent mode in tests to keep output clean
 * - Separate error log file for critical issue tracking
 */
import winston from 'winston';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const { combine, timestamp, printf, errors, json, metadata } = winston.format;

// ─── Resolve log directory ──────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.LOG_DIR || path.resolve(__dirname, '..', 'logs');

// Ensure log directory exists (production file transports write here)
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch {
  // Best-effort — if we can't create logs dir, console-only logging is fine.
}

// ─── Custom colorful dev format ──────────────────────────────────────────────
const levelColors: Record<string, string> = {
  error: '\x1b[31m',   // red
  warn: '\x1b[33m',    // yellow
  info: '\x1b[36m',    // cyan
  http: '\x1b[35m',    // magenta
  debug: '\x1b[90m',   // gray
};
const reset = '\x1b[0m';
const bold = '\x1b[1m';
const dim = '\x1b[2m';

const devFormat = printf(({ level, message, timestamp: ts, module: mod, requestId, durationMs, ...rest }: any) => {
  const color = levelColors[level] || '';
  const tag = mod ? `${dim}[${mod}]${reset} ` : '';
  const reqId = requestId ? `${dim}(${requestId})${reset} ` : '';
  const dur = typeof durationMs === 'number' ? ` ${dim}${durationMs}ms${reset}` : '';

  // Strip metadata wrapper added by metadata() format
  const meta = rest.metadata && typeof rest.metadata === 'object' ? { ...rest.metadata } : {};
  delete meta.module;
  delete meta.requestId;
  delete meta.durationMs;
  const extra = Object.keys(meta).length
    ? `\n  ${dim}${JSON.stringify(meta, null, 2).replace(/\n/g, '\n  ')}${reset}`
    : '';

  return `${dim}${ts}${reset} ${color}${bold}${level.toUpperCase().padEnd(5)}${reset} ${tag}${reqId}${message}${dur}${extra}`;
});

// ─── Logger creation ─────────────────────────────────────────────────────────
const nodeEnv = process.env.NODE_ENV || 'development';
const isTest = nodeEnv === 'test';
const isProd = nodeEnv === 'production';

const prodJsonFormat = combine(
  timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  errors({ stack: true }),
  metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
  json()
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: isProd
      ? prodJsonFormat
      : combine(
          timestamp({ format: 'HH:mm:ss.SSS' }),
          errors({ stack: true }),
          metadata({ fillExcept: ['message', 'level', 'timestamp', 'module', 'requestId', 'durationMs'] }),
          devFormat
        ),
  }),
];

// Production file transports: combined log + separate error log
if (isProd) {
  transports.push(
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      format: prodJsonFormat,
      maxsize: 10 * 1024 * 1024, // 10MB per file
      maxFiles: 14,              // Keep 14 rotated files (~140MB max)
      tailable: true,
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      format: prodJsonFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 30,              // Keep 30 rotated error logs
      tailable: true,
    })
  );
}

const logger = winston.createLogger({
  level: isProd ? 'info' : 'debug',
  silent: isTest, // No noise during vitest runs
  defaultMeta: { service: 'mobo-backend', pid: process.pid },
  transports,
  // Prevent unhandled errors from crashing the logger
  exitOnError: false,
});

export default logger;

// ─── Convenience child loggers for common modules ────────────────────────────
// Usage: import { httpLog } from './config/logger.js';
// httpLog.info('GET /api/orders -> 200', { durationMs: 42, requestId: '...' });

export const httpLog = logger.child({ module: 'http' });
export const authLog = logger.child({ module: 'auth' });
export const dbLog = logger.child({ module: 'db' });
export const realtimeLog = logger.child({ module: 'realtime' });
export const aiLog = logger.child({ module: 'ai' });
export const orderLog = logger.child({ module: 'orders' });
export const walletLog = logger.child({ module: 'wallet' });
export const notifLog = logger.child({ module: 'notifications' });
export const migrationLog = logger.child({ module: 'migration' });
export const seedLog = logger.child({ module: 'seed' });
export const startupLog = logger.child({ module: 'startup' });
export const securityLog = logger.child({ module: 'security' });
export const cronLog = logger.child({ module: 'cron' });
