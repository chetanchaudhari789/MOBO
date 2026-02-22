/**
 * Centralized Winston logger for the MOBO backend.
 *
 * Features:
 * - Colorful, human-readable console output in development
 * - Structured JSON logs in production (for log aggregators)
 * - Request ID correlation via `requestId` metadata
 * - Module-scoped child loggers via `logger.child({ module: 'auth' })`
 * - Timestamp + level + module + message in every log line
 * - Silent mode in tests to keep output clean
 */
import winston from 'winston';

const { combine, timestamp, printf, errors, json, metadata } = winston.format;

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

const logger = winston.createLogger({
  level: isProd ? 'info' : 'debug',
  silent: isTest, // No noise during vitest runs
  defaultMeta: {},
  transports: [
    new winston.transports.Console({
      format: isProd
        ? combine(
            timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
            errors({ stack: true }),
            metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
            json()
          )
        : combine(
            timestamp({ format: 'HH:mm:ss.SSS' }),
            errors({ stack: true }),
            metadata({ fillExcept: ['message', 'level', 'timestamp', 'module', 'requestId', 'durationMs'] }),
            devFormat
          ),
    }),
  ],
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
