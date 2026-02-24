/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MOBO GOD-LEVEL WINSTON LOGGING INTELLIGENCE LAYER
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Enterprise-grade, forensic-ready, distributed-intelligence-compatible
 * structured logging system built on Winston.
 *
 * Features:
 * ─────────────────────────────────────────────────────────────────────────────
 * • Structured JSON schema on every log entry (timestamp, correlationId, etc.)
 * • Daily log rotation (combined + error) via winston-daily-rotate-file
 * • Automatic sensitive data redaction engine
 * • Circular reference protection
 * • Payload size truncation safeguards
 * • Non-blocking, event-loop-safe logging
 * • Module-scoped child loggers for domain separation
 * • Colorful dev console / structured JSON production
 * • Silent mode in tests
 * • OpenTelemetry / ELK / Datadog compatible output
 * • Memory usage in structured metadata
 * • Log explosion prevention (rate-limited repetitive errors)
 *
 * Log Domains: http | auth | db | business | system | security | ai | realtime
 * Severity Levels: debug | info | http | warn | error (fatal = error + exit)
 * ─────────────────────────────────────────────────────────────────────────────
 */
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const { combine, timestamp, printf, errors, json, metadata } = winston.format;

// ─── Constants ───────────────────────────────────────────────────────────────
const SERVICE_NAME = 'mobo-backend';
const SERVICE_VERSION = process.env.npm_package_version || '0.1.0';
const HOSTNAME = os.hostname();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.LOG_DIR || path.resolve(__dirname, '..', 'logs');
const nodeEnv = process.env.NODE_ENV || 'development';
const isTest = nodeEnv === 'test';
const isProd = nodeEnv === 'production';

// Maximum payload size in log entries (prevents memory bombs)
const MAX_PAYLOAD_SIZE = 4096;
// Maximum depth for object serialization
const MAX_SERIALIZE_DEPTH = 6;

// ─── Ensure log directory exists ─────────────────────────────────────────────
try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch {
  // Best-effort — console-only logging is fine if dir creation fails
}

// ─── Sensitive Data Redaction Engine ─────────────────────────────────────────
const REDACTED = '[REDACTED]';
const SENSITIVE_KEYS = new Set([
  'password', 'passwd', 'pass', 'secret', 'token', 'accesstoken',
  'refreshtoken', 'authorization', 'cookie', 'set-cookie',
  'apikey', 'api_key', 'apisecret', 'api_secret',
  'jwt', 'jwtaccesssecret', 'jwtrefreshsecret',
  'privatekey', 'private_key', 'creditcard', 'credit_card',
  'ssn', 'cvv', 'cardnumber', 'card_number',
  'otp', 'pin', 'mpin', 'vapidprivatekey',
  'googleclientsecret', 'googleserviceaccountkey',
  'geminiapikey', 'databaseurl', 'mongodburi',
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase().replace(/[-_]/g, ''));
}

/**
 * Partially masks emails: jo***@example.com
 */
function maskEmail(email: string): string {
  const atIdx = email.indexOf('@');
  if (atIdx <= 2) return `***${email.slice(atIdx)}`;
  return `${email.slice(0, 2)}***${email.slice(atIdx)}`;
}

/**
 * Partially masks mobile numbers: ******7890
 */
function maskMobile(mobile: string): string {
  if (mobile.length <= 4) return '****';
  return '*'.repeat(mobile.length - 4) + mobile.slice(-4);
}

/**
 * Deep-clone and redact sensitive fields from an object.
 * Handles circular references and enforces depth/size limits.
 */
function sanitize(obj: unknown, depth = 0, seen = new WeakSet()): unknown {
  if (depth > MAX_SERIALIZE_DEPTH) return '[MAX_DEPTH]';
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    if (obj.length > MAX_PAYLOAD_SIZE) {
      return obj.slice(0, MAX_PAYLOAD_SIZE) + `...[truncated ${obj.length - MAX_PAYLOAD_SIZE} chars]`;
    }
    return obj;
  }

  if (typeof obj !== 'object') return obj;

  // Circular reference protection
  if (seen.has(obj as object)) return '[CIRCULAR]';
  seen.add(obj as object);

  if (Array.isArray(obj)) {
    if (obj.length > 100) {
      return [
        ...obj.slice(0, 100).map(item => sanitize(item, depth + 1, seen)),
        `...[${obj.length - 100} more items]`,
      ];
    }
    return obj.map(item => sanitize(item, depth + 1, seen));
  }

  if (obj instanceof Error) {
    return {
      name: obj.name,
      message: obj.message,
      stack: obj.stack,
      ...((obj as any).code ? { code: (obj as any).code } : {}),
    };
  }

  const result: Record<string, unknown> = {};
  const entries = Object.entries(obj as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED;
      continue;
    }
    // Mask emails and mobiles detected by key name
    if (typeof value === 'string') {
      if (key.toLowerCase().includes('email') && value.includes('@')) {
        result[key] = maskEmail(value);
        continue;
      }
      if (key.toLowerCase().includes('mobile') || key.toLowerCase() === 'phone') {
        result[key] = maskMobile(value);
        continue;
      }
    }
    result[key] = sanitize(value, depth + 1, seen);
  }
  return result;
}

// ─── System Metrics Helper ───────────────────────────────────────────────────
function getSystemMetrics() {
  const mem = process.memoryUsage();
  return {
    memoryMB: Math.round(mem.rss / 1024 / 1024),
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
  };
}

// ─── Log Explosion Prevention ────────────────────────────────────────────────
// Rate-limits identical error messages to prevent log storms.
const errorThrottleMap = new Map<string, { count: number; lastLogged: number }>();
const THROTTLE_WINDOW_MS = 60_000;
const THROTTLE_MAX_PER_WINDOW = 10;

function shouldThrottleError(message: string): { throttled: boolean; suppressed: number } {
  const now = Date.now();
  const key = message.slice(0, 200);
  const entry = errorThrottleMap.get(key);

  if (!entry || now - entry.lastLogged > THROTTLE_WINDOW_MS) {
    errorThrottleMap.set(key, { count: 1, lastLogged: now });
    return { throttled: false, suppressed: 0 };
  }

  entry.count++;
  if (entry.count <= THROTTLE_MAX_PER_WINDOW) {
    entry.lastLogged = now;
    return { throttled: false, suppressed: 0 };
  }

  const suppressed = entry.count - THROTTLE_MAX_PER_WINDOW;
  return { throttled: true, suppressed };
}

// Periodically clean up old throttle entries (every 5 minutes)
const _throttleCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of errorThrottleMap) {
    if (now - entry.lastLogged > THROTTLE_WINDOW_MS * 2) {
      errorThrottleMap.delete(key);
    }
  }
}, 5 * 60_000);
_throttleCleanup.unref();

// ─── Redaction Format ────────────────────────────────────────────────────────
const redactFormat = winston.format((info) => {
  if (info.metadata && typeof info.metadata === 'object') {
    info.metadata = sanitize(info.metadata) as Record<string, unknown>;
  }
  if (info.error && typeof info.error === 'object') {
    info.error = sanitize(info.error);
  }
  return info;
});

// ─── Structured Schema Enrichment ────────────────────────────────────────────
const structuredEnrich = winston.format((info) => {
  info.serviceName = SERVICE_NAME;
  info.environment = nodeEnv;
  info.version = SERVICE_VERSION;
  info.hostname = HOSTNAME;
  info.pid = process.pid;

  const meta = info.metadata as Record<string, unknown> | undefined;
  if (!info.correlationId) {
    info.correlationId = meta?.correlationId || meta?.requestId || undefined;
  }
  if (!info.requestId) {
    info.requestId = meta?.requestId || info.correlationId || undefined;
  }
  return info;
});

// ─── Error Throttle Format ───────────────────────────────────────────────────
const throttleFormat = winston.format((info) => {
  if (info.level === 'error' || info.level === 'warn') {
    const { throttled, suppressed } = shouldThrottleError(String(info.message));
    if (throttled) {
      if (suppressed % 100 === 0) {
        info.message = `[THROTTLED x${suppressed}] ${info.message}`;
        return info;
      }
      return false;
    }
  }
  return info;
});

// ─── Custom Dev Console Format ───────────────────────────────────────────────
const levelColors: Record<string, string> = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[36m',
  http: '\x1b[35m',
  debug: '\x1b[90m',
};
const reset = '\x1b[0m';
const bold = '\x1b[1m';
const dim = '\x1b[2m';

const devFormat = printf(({ level, message, timestamp: ts, module: mod, requestId, durationMs, domain, eventName, ...rest }: any) => {
  const color = levelColors[level] || '';
  const tag = mod ? `${dim}[${mod}]${reset} ` : '';
  const reqId = requestId ? `${dim}(${requestId?.slice?.(0, 8) || requestId})${reset} ` : '';
  const dur = typeof durationMs === 'number' ? ` ${dim}${durationMs}ms${reset}` : '';
  const evt = eventName ? ` ${dim}«${eventName}»${reset}` : '';
  const dom = domain ? `${dim}{${domain}}${reset} ` : '';

  const meta = rest.metadata && typeof rest.metadata === 'object' ? { ...rest.metadata } : {};
  for (const k of ['module', 'requestId', 'durationMs', 'domain', 'eventName', 'correlationId', 'traceId', 'service']) {
    delete meta[k];
  }
  const extra = Object.keys(meta).length
    ? `\n  ${dim}${JSON.stringify(meta, null, 2).replace(/\n/g, '\n  ')}${reset}`
    : '';

  return `${dim}${ts}${reset} ${color}${bold}${level.toUpperCase().padEnd(5)}${reset} ${dom}${tag}${reqId}${message}${evt}${dur}${extra}`;
});

// ─── Production JSON Format ──────────────────────────────────────────────────
const prodJsonFormat = combine(
  timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
  errors({ stack: true }),
  metadata({ fillExcept: ['message', 'level', 'timestamp', 'serviceName', 'environment', 'version', 'hostname', 'pid', 'correlationId', 'requestId'] }),
  structuredEnrich(),
  redactFormat(),
  throttleFormat(),
  json()
);

// ─── Dev Console Format ──────────────────────────────────────────────────────
const devConsoleFormat = combine(
  timestamp({ format: 'HH:mm:ss.SSS' }),
  errors({ stack: true }),
  metadata({ fillExcept: ['message', 'level', 'timestamp', 'module', 'requestId', 'durationMs', 'domain', 'eventName'] }),
  redactFormat(),
  devFormat
);

// ─── Transports ──────────────────────────────────────────────────────────────
const transports: winston.transport[] = [
  new winston.transports.Console({
    format: isProd ? prodJsonFormat : devConsoleFormat,
  }),
];

// Production: daily-rotated file transports
if (isProd) {
  transports.push(
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      format: prodJsonFormat,
      zippedArchive: true,
    }),
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '90d',
      format: prodJsonFormat,
      zippedArchive: true,
    })
  );
}

// ─── Logger Instance ─────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: isProd ? 'info' : 'debug',
  silent: isTest,
  defaultMeta: { service: SERVICE_NAME, pid: process.pid },
  transports,
  exitOnError: false,
});

export default logger;

// ─── Structured Event Logger ─────────────────────────────────────────────────

export interface LogEvent {
  domain: 'http' | 'auth' | 'db' | 'business' | 'system' | 'security' | 'ai' | 'realtime';
  eventCategory?: string;
  eventName: string;
  correlationId?: string;
  requestId?: string;
  traceId?: string;
  userId?: string;
  role?: string;
  ip?: string;
  method?: string;
  route?: string;
  statusCode?: number;
  duration?: number;
  errorCode?: string;
  stack?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Log a structured domain event with full schema compliance.
 */
export function logEvent(level: 'debug' | 'info' | 'warn' | 'error', message: string, event: LogEvent): void {
  const metrics = level === 'error' || level === 'warn' ? getSystemMetrics() : undefined;
  logger.log(level, message, {
    domain: event.domain,
    eventCategory: event.eventCategory,
    eventName: event.eventName,
    correlationId: event.correlationId,
    requestId: event.requestId,
    traceId: event.traceId,
    userId: event.userId,
    role: event.role,
    ip: event.ip,
    method: event.method,
    route: event.route,
    statusCode: event.statusCode,
    durationMs: event.duration,
    errorCode: event.errorCode,
    stack: event.stack,
    ...metrics ? { memoryMB: metrics.memoryMB, heapUsedMB: metrics.heapUsedMB } : {},
    ...event.metadata,
  });
}

// ─── Module-scoped Child Loggers ─────────────────────────────────────────────

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
export const businessLog = logger.child({ module: 'business' });

// ─── Exported Utilities ──────────────────────────────────────────────────────
export { sanitize, getSystemMetrics, maskEmail, maskMobile };
