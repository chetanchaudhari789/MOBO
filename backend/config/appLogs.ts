/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MOBO APPLICATION LOG LAYER  — CrowdStrike-Aligned Observability
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Implements the four log types recommended by CrowdStrike's Application Logs
 * guide (https://www.crowdstrike.com/cybersecurity-101/observability/application-logs/):
 *
 *   1. ACCESS / AUTHENTICATION / AUTHORIZATION LOGS
 *      Who logged in, accessed what, role-based operations, session lifecycle.
 *
 *   2. CHANGE LOGS
 *      Data mutations with actor, entity, before/after state, timestamp.
 *
 *   3. ERROR LOGS
 *      Categorized, severity-classified error events with context.
 *
 *   4. AVAILABILITY LOGS
 *      Startup, shutdown, health checks, database connectivity, uptime.
 *
 * All functions use the existing Winston logger (logger.ts) and logEvent()
 * for transport — no new Winston instances.  Production output goes to
 * domain-specific daily-rotated files in addition to combined.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */
import logger, {
  logEvent,
  authLog,
  securityLog,
  startupLog,
  dbLog,
  perfLog,
  getSystemMetrics,
  sanitize,
} from './logger.js';

// ═══════════════════════════════════════════════════════════════════════════════
//  1.  ACCESS / AUTHENTICATION / AUTHORIZATION LOGS
// ═══════════════════════════════════════════════════════════════════════════════

export type AuthEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'TOKEN_REFRESH'
  | 'TOKEN_REFRESH_FAILURE'
  | 'REGISTRATION'
  | 'REGISTRATION_FAILURE'
  | 'PASSWORD_CHANGE'
  | 'PASSWORD_CHANGE_FAILURE'
  | 'PROFILE_UPDATE'
  | 'SESSION_EXPIRED';

export interface AuthEventPayload {
  /** The authenticated user's ID (if available). */
  userId?: string;
  /** Roles associated with the user. */
  roles?: string[];
  /** Client IP address. */
  ip?: string;
  /** Identification used for auth — mobile, username, email. */
  identifier?: string;
  /** HTTP method if relevant. */
  method?: string;
  /** Route / resource path. */
  route?: string;
  /** Correlation / request ID. */
  requestId?: string;
  /** Why the event failed (for failure types). */
  reason?: string;
  /** User-agent header. */
  userAgent?: string;
  /** Any additional metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Log a structured authentication / authorization event.
 *
 * These logs are critical for:
 * - Re-tracing user actions across the system
 * - Investigating security incidents
 * - Analyzing user behaviour patterns
 * - Auditing regulatory compliance
 */
export function logAuthEvent(type: AuthEventType, payload: AuthEventPayload): void {
  const isFailure = type.includes('FAILURE') || type === 'SESSION_EXPIRED';
  const level = isFailure ? 'warn' : 'info';

  const message = formatAuthMessage(type, payload);

  logEvent(level, message, {
    domain: 'auth',
    eventCategory: 'authentication',
    eventName: type,
    userId: payload.userId,
    role: payload.roles?.join(','),
    ip: payload.ip,
    method: payload.method,
    route: payload.route,
    requestId: payload.requestId,
    metadata: {
      identifier: payload.identifier,
      userAgent: payload.userAgent,
      ...payload.metadata,
    },
  });
}

function formatAuthMessage(type: AuthEventType, p: AuthEventPayload): string {
  const who = p.identifier || p.userId || 'unknown';
  switch (type) {
    case 'LOGIN_SUCCESS':
      return `User ${who} logged in successfully`;
    case 'LOGIN_FAILURE':
      return `Login failed for ${who}: ${p.reason || 'invalid credentials'}`;
    case 'LOGOUT':
      return `User ${who} logged out`;
    case 'TOKEN_REFRESH':
      return `Token refreshed for user ${who}`;
    case 'TOKEN_REFRESH_FAILURE':
      return `Token refresh failed for ${who}: ${p.reason || 'invalid token'}`;
    case 'REGISTRATION':
      return `New user registered: ${who}`;
    case 'REGISTRATION_FAILURE':
      return `Registration failed for ${who}: ${p.reason || 'unknown'}`;
    case 'PASSWORD_CHANGE':
      return `Password changed for user ${who}`;
    case 'PASSWORD_CHANGE_FAILURE':
      return `Password change failed for ${who}: ${p.reason || 'unknown'}`;
    case 'PROFILE_UPDATE':
      return `Profile updated for user ${who}`;
    case 'SESSION_EXPIRED':
      return `Session expired for user ${who}`;
    default:
      return `Auth event ${type} for ${who}`;
  }
}

export type AccessEventType =
  | 'RESOURCE_ACCESS'
  | 'RESOURCE_DENIED'
  | 'ROLE_ACCESS'
  | 'ADMIN_ACTION';

export interface AccessEventPayload {
  userId?: string;
  roles?: string[];
  ip?: string;
  method?: string;
  route?: string;
  resource?: string;
  requestId?: string;
  statusCode?: number;
  duration?: number;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Log a resource access/authorization event.
 *
 * Use this for tracking:
 * - Who accessed specific resources (files, tables, endpoints)
 * - Authorization decisions (allowed / denied)
 * - Admin-level operations
 */
export function logAccessEvent(type: AccessEventType, payload: AccessEventPayload): void {
  const isDenied = type === 'RESOURCE_DENIED';
  const level = isDenied ? 'warn' : 'info';

  logEvent(level, `${type}: ${payload.method || 'ACCESS'} ${payload.resource || payload.route || 'unknown'}`, {
    domain: isDenied ? 'security' : 'http',
    eventCategory: 'authorization',
    eventName: type,
    userId: payload.userId,
    role: payload.roles?.join(','),
    ip: payload.ip,
    method: payload.method,
    route: payload.route,
    statusCode: payload.statusCode,
    duration: payload.duration,
    requestId: payload.requestId,
    metadata: {
      resource: payload.resource,
      userAgent: payload.userAgent,
      ...payload.metadata,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  2.  CHANGE LOGS
// ═══════════════════════════════════════════════════════════════════════════════

export type ChangeAction =
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'SOFT_DELETE'
  | 'RESTORE'
  | 'ROLE_CHANGE'
  | 'PERMISSION_CHANGE'
  | 'CONFIG_CHANGE'
  | 'STATUS_CHANGE'
  | 'BULK_OPERATION'
  // Business operations – ops
  | 'MEDIATOR_REJECTED'
  | 'BUYER_APPROVED'
  | 'USER_REJECTED'
  | 'ORDER_CLAIM_VERIFIED'
  | 'REQUIREMENT_VERIFIED'
  | 'ALL_STEPS_VERIFIED'
  | 'PROOF_REJECTED'
  | 'MISSING_PROOF_REQUESTED'
  | 'ORDER_UNSETTLED'
  | 'CAMPAIGN_DELETED'
  | 'SLOTS_ASSIGNED'
  | 'DEAL_PUBLISHED'
  | 'PAYOUT_PROCESSED'
  | 'PAYOUT_DELETED'
  | 'CAMPAIGN_COPIED'
  | 'OFFER_DECLINED'
  // Business operations – admin
  | 'CONFIG_UPDATED'
  | 'DEAL_DELETED'
  | 'USER_DELETED'
  | 'WALLET_DELETED'
  | 'STATUS_UPDATED'
  | 'ORDER_REACTIVATED'
  // Business operations – brand
  | 'AGENCY_PAYOUT'
  | 'CONNECTION_APPROVED'
  | 'CONNECTION_REJECTED'
  | 'AGENCY_REMOVED'
  | 'CAMPAIGN_CREATED'
  | 'CAMPAIGN_UPDATED'
  // Business operations – invites
  | 'INVITE_CREATED'
  | 'INVITE_REVOKED'
  | 'INVITE_DELETED'
  | 'MEDIATOR_INVITE_CREATED'
  | 'BUYER_INVITE_CREATED'
  // Business operations – tickets
  | 'TICKET_CREATED'
  | 'TICKET_STATUS_CHANGE'
  // Business operations – orders/products
  | 'ORDER_REDIRECT_CREATED';

export interface ChangeEventPayload {
  /** Who made the change. */
  actorUserId?: string;
  actorRoles?: string[];
  actorIp?: string;
  /** What was changed. */
  entityType: string;
  entityId?: string;
  action: ChangeAction;
  /** Before/after state for auditable comparison. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  /** Changed fields (for partial updates). */
  changedFields?: string[];
  /** Request context. */
  requestId?: string;
  /** Additional context. */
  metadata?: Record<string, unknown>;
}

/**
 * Log a data mutation / change event.
 *
 * Change logs help:
 * - Identify configuration changes that caused incidents
 * - Detect security events (new privileged users, permission changes)
 * - Maintain audit trails for compliance
 * - Support forensic investigation
 */
export function logChangeEvent(payload: ChangeEventPayload): void {
  const isSensitive =
    payload.action === 'ROLE_CHANGE' ||
    payload.action === 'PERMISSION_CHANGE' ||
    payload.action === 'DELETE';
  const level = isSensitive ? 'warn' : 'info';

  const actor = payload.actorUserId || 'system';
  const message = `${payload.action}: ${payload.entityType}${payload.entityId ? `#${payload.entityId}` : ''} by ${actor}`;

  logEvent(level, message, {
    domain: 'business',
    eventCategory: 'change',
    eventName: `CHANGE_${payload.action}`,
    userId: payload.actorUserId,
    role: payload.actorRoles?.join(','),
    ip: payload.actorIp,
    requestId: payload.requestId,
    metadata: {
      entityType: payload.entityType,
      entityId: payload.entityId,
      action: payload.action,
      changedFields: payload.changedFields,
      before: payload.before ? sanitize(payload.before) : undefined,
      after: payload.after ? sanitize(payload.after) : undefined,
      ...payload.metadata,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  3.  ERROR LOGS
// ═══════════════════════════════════════════════════════════════════════════════

export type ErrorCategory =
  | 'VALIDATION'
  | 'DATABASE'
  | 'NETWORK'
  | 'AUTHENTICATION'
  | 'AUTHORIZATION'
  | 'BUSINESS_LOGIC'
  | 'EXTERNAL_SERVICE'
  | 'SYSTEM'
  | 'CONFIGURATION';

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ErrorEventPayload {
  /** Error classification. */
  category: ErrorCategory;
  severity: ErrorSeverity;
  /** The original error (if available). */
  error?: Error | unknown;
  /** Human-readable description. */
  message: string;
  /** Error code (e.g. P2002, ECONNREFUSED). */
  errorCode?: string;
  /** What operation was being performed. */
  operation?: string;
  /** Request context. */
  requestId?: string;
  userId?: string;
  ip?: string;
  method?: string;
  route?: string;
  /** Impact assessment. */
  userFacing?: boolean;
  retryable?: boolean;
  /** Additional context. */
  metadata?: Record<string, unknown>;
}

/**
 * Log a categorized error event with severity classification.
 *
 * Error logs help:
 * - Identify issues before they become outages
 * - Track error frequency and patterns
 * - Prioritize fixes by impact
 * - Improve system resilience
 */
export function logErrorEvent(payload: ErrorEventPayload): void {
  const level = payload.severity === 'critical' || payload.severity === 'high' ? 'error' : 'warn';
  const err = payload.error instanceof Error ? payload.error : undefined;

  logEvent(level, payload.message, {
    domain: mapErrorCategoryToDomain(payload.category),
    eventCategory: 'error',
    eventName: `ERROR_${payload.category}`,
    errorCode: payload.errorCode || (err as any)?.code,
    stack: err?.stack,
    userId: payload.userId,
    ip: payload.ip,
    method: payload.method,
    route: payload.route,
    requestId: payload.requestId,
    metadata: {
      category: payload.category,
      severity: payload.severity,
      operation: payload.operation,
      errorName: err?.name,
      userFacing: payload.userFacing,
      retryable: payload.retryable,
      ...payload.metadata,
    },
  });
}

function mapErrorCategoryToDomain(
  category: ErrorCategory
): 'http' | 'auth' | 'db' | 'business' | 'system' | 'security' | 'ai' | 'realtime' {
  switch (category) {
    case 'DATABASE':
      return 'db';
    case 'AUTHENTICATION':
    case 'AUTHORIZATION':
      return 'security';
    case 'NETWORK':
    case 'EXTERNAL_SERVICE':
      return 'system';
    case 'BUSINESS_LOGIC':
    case 'VALIDATION':
      return 'business';
    case 'CONFIGURATION':
    case 'SYSTEM':
      return 'system';
    default:
      return 'system';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  4.  AVAILABILITY LOGS
// ═══════════════════════════════════════════════════════════════════════════════

export type AvailabilityEventType =
  | 'APPLICATION_STARTING'
  | 'APPLICATION_READY'
  | 'APPLICATION_SHUTDOWN_START'
  | 'APPLICATION_SHUTDOWN_COMPLETE'
  | 'DATABASE_CONNECTED'
  | 'DATABASE_DISCONNECTED'
  | 'DATABASE_RECONNECTED'
  | 'DATABASE_ERROR'
  | 'HEALTH_CHECK_PASS'
  | 'HEALTH_CHECK_FAIL'
  | 'DEPENDENCY_UP'
  | 'DEPENDENCY_DOWN'
  | 'MEMORY_WARNING'
  | 'CPU_WARNING';

export interface AvailabilityEventPayload {
  /** What's being reported. */
  component?: string;
  /** Current status. */
  status?: 'up' | 'down' | 'degraded' | 'starting' | 'stopping';
  /** Response time for health checks (ms). */
  responseTimeMs?: number;
  /** Uptime in seconds. */
  uptimeSeconds?: number;
  /** Additional metrics. */
  metadata?: Record<string, unknown>;
}

/**
 * Log an availability / health event.
 *
 * Availability logs help:
 * - Calculate SLA metrics (uptime reporting)
 * - Investigate unplanned shutdowns
 * - Confirm expected behaviour during maintenance windows
 * - Detect database connectivity issues early
 */
export function logAvailabilityEvent(
  type: AvailabilityEventType,
  payload: AvailabilityEventPayload = {}
): void {
  const isError =
    type === 'DATABASE_ERROR' ||
    type === 'DATABASE_DISCONNECTED' ||
    type === 'HEALTH_CHECK_FAIL' ||
    type === 'DEPENDENCY_DOWN' ||
    type === 'MEMORY_WARNING' ||
    type === 'CPU_WARNING';

  const level = isError ? 'error' : 'info';

  const message = formatAvailabilityMessage(type, payload);
  const metrics = getSystemMetrics();

  logEvent(level, message, {
    domain: 'system',
    eventCategory: 'availability',
    eventName: type,
    metadata: {
      component: payload.component,
      status: payload.status,
      responseTimeMs: payload.responseTimeMs,
      uptimeSeconds: payload.uptimeSeconds ?? Math.floor(process.uptime()),
      ...metrics,
      ...payload.metadata,
    },
  });
}

function formatAvailabilityMessage(type: AvailabilityEventType, p: AvailabilityEventPayload): string {
  const component = p.component || 'application';
  switch (type) {
    case 'APPLICATION_STARTING':
      return `${component} starting…`;
    case 'APPLICATION_READY':
      return `${component} is ready and accepting traffic`;
    case 'APPLICATION_SHUTDOWN_START':
      return `${component} shutting down…`;
    case 'APPLICATION_SHUTDOWN_COMPLETE':
      return `${component} shutdown complete`;
    case 'DATABASE_CONNECTED':
      return `Database connected (${p.responseTimeMs ?? '?'}ms)`;
    case 'DATABASE_DISCONNECTED':
      return `Database disconnected — ${p.status || 'down'}`;
    case 'DATABASE_RECONNECTED':
      return `Database reconnected (${p.responseTimeMs ?? '?'}ms)`;
    case 'DATABASE_ERROR':
      return `Database error: ${p.component || 'unknown'}`;
    case 'HEALTH_CHECK_PASS':
      return `Health check passed (${p.responseTimeMs ?? '?'}ms)`;
    case 'HEALTH_CHECK_FAIL':
      return `Health check failed: ${p.component || 'unknown'} — ${p.status || 'down'}`;
    case 'DEPENDENCY_UP':
      return `Dependency ${p.component || 'unknown'} is up`;
    case 'DEPENDENCY_DOWN':
      return `Dependency ${p.component || 'unknown'} is down`;
    case 'MEMORY_WARNING':
      return `Memory usage warning: ${p.metadata?.memoryMB || '?'}MB`;
    case 'CPU_WARNING':
      return `CPU usage warning`;
    default:
      return `Availability event: ${type}`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  5.  SECURITY EVENT LOGS (enhanced)
// ═══════════════════════════════════════════════════════════════════════════════

export type SecurityEventType =
  | 'BRUTE_FORCE_DETECTED'
  | 'SUSPICIOUS_PATTERN'
  | 'PRIVILEGE_ESCALATION_ATTEMPT'
  | 'RATE_LIMIT_HIT'
  | 'INVALID_TOKEN'
  | 'FORBIDDEN_ACCESS'
  | 'IP_BLOCKED'
  | 'CORS_VIOLATION'
  | 'INJECTION_ATTEMPT'
  | 'MALICIOUS_PAYLOAD';

export interface SecurityEventPayload {
  severity: 'low' | 'medium' | 'high' | 'critical';
  ip?: string;
  userId?: string;
  route?: string;
  method?: string;
  requestId?: string;
  /** What was detected. */
  pattern?: string;
  /** Where it was detected. */
  location?: string;
  /** How many times in current window. */
  attemptCount?: number;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Log a security-relevant event.
 *
 * Security logs help:
 * - Detect and respond to active attacks
 * - Identify brute-force / credential-stuffing campaigns
 * - Track privilege escalation attempts
 * - Feed SIEM / alerting pipelines
 */
export function logSecurityIncident(type: SecurityEventType, payload: SecurityEventPayload): void {
  const level = payload.severity === 'critical' || payload.severity === 'high' ? 'error' : 'warn';

  logEvent(level, `SECURITY: ${type} from ${payload.ip || 'unknown'}`, {
    domain: 'security',
    eventCategory: 'security_incident',
    eventName: type,
    userId: payload.userId,
    ip: payload.ip,
    method: payload.method,
    route: payload.route,
    requestId: payload.requestId,
    metadata: {
      severity: payload.severity,
      pattern: payload.pattern,
      location: payload.location,
      attemptCount: payload.attemptCount,
      userAgent: payload.userAgent,
      ...payload.metadata,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  6.  PERIODIC AVAILABILITY MONITOR
// ═══════════════════════════════════════════════════════════════════════════════

let availabilityInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start a periodic availability monitor that logs system health every interval.
 * Logs memory warnings if RSS exceeds the threshold.
 *
 * @param intervalMs - How often to check (default: 5 minutes)
 * @param memoryThresholdMB - RSS threshold to trigger memory warnings (default: 512MB)
 */
export function startAvailabilityMonitor(
  intervalMs = 5 * 60_000,
  memoryThresholdMB = 512
): void {
  if (availabilityInterval) return; // already running

  availabilityInterval = setInterval(() => {
    const metrics = getSystemMetrics();
    const uptimeSeconds = Math.floor(process.uptime());

    // Periodic health status
    logAvailabilityEvent('HEALTH_CHECK_PASS', {
      component: 'application',
      status: 'up',
      uptimeSeconds,
      metadata: {
        ...metrics,
        eventLoopLag: 'ok',
      },
    });

    // Memory warning check
    if (metrics.memoryMB > memoryThresholdMB) {
      logAvailabilityEvent('MEMORY_WARNING', {
        component: 'process',
        status: 'degraded',
        metadata: {
          ...metrics,
          thresholdMB: memoryThresholdMB,
        },
      });
    }
  }, intervalMs);

  availabilityInterval.unref(); // don't prevent process exit
}

/**
 * Stop the periodic availability monitor (for graceful shutdown).
 */
export function stopAvailabilityMonitor(): void {
  if (availabilityInterval) {
    clearInterval(availabilityInterval);
    availabilityInterval = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  7.  PERFORMANCE LOG HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

export interface PerformanceLogPayload {
  operation: string;
  durationMs: number;
  slowThresholdMs?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Log a performance measurement for any operation.
 * Automatically flags slow operations.
 */
export function logPerformance(payload: PerformanceLogPayload): void {
  const threshold = payload.slowThresholdMs ?? 500;
  const isSlow = payload.durationMs > threshold;
  const level = isSlow ? 'warn' : 'info';

  perfLog.log(level, `${payload.operation}: ${payload.durationMs}ms${isSlow ? ' [SLOW]' : ''}`, {
    operation: payload.operation,
    durationMs: payload.durationMs,
    slow: isSlow,
    threshold,
    ...payload.metadata,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  8.  DATABASE EVENT LOGGER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Log database lifecycle events (connection, disconnection, migration, query errors).
 */
export function logDatabaseEvent(
  type: 'CONNECTED' | 'DISCONNECTED' | 'RECONNECTED' | 'MIGRATION_APPLIED' | 'QUERY_ERROR' | 'SLOW_QUERY',
  payload: { durationMs?: number; error?: unknown; metadata?: Record<string, unknown> } = {}
): void {
  const isError = type === 'QUERY_ERROR' || type === 'DISCONNECTED';
  const level = isError ? 'error' : type === 'SLOW_QUERY' ? 'warn' : 'info';
  const err = payload.error instanceof Error ? payload.error : undefined;

  dbLog.log(level, `Database ${type.toLowerCase().replace(/_/g, ' ')}`, {
    domain: 'db',
    eventName: `DB_${type}`,
    durationMs: payload.durationMs,
    ...(err ? { errorName: err.name, errorMessage: err.message, stack: err.stack } : {}),
    ...payload.metadata,
  });
}
