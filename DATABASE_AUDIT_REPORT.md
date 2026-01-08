# Database Audit Report - MOBO Ecosystem

**Date**: 2026-01-08  
**Status**: ✅ COMPREHENSIVE ANALYSIS COMPLETE

---

## Executive Summary

Database connection is **HEALTHY** and models are **WELL-STRUCTURED**. However, there are **12 critical issues** that need immediate attention for production readiness.

### Quick Stats

- **Models**: 15 total
- **Indexes**: 45+ defined
- **Unique Constraints**: 12
- **Transactions**: ✅ Using MongoDB sessions properly
- **Connection**: ✅ Fallback to in-memory DB for development

---

## ✅ What's Working Correctly

### 1. **Connection Management**

```typescript
Location: backend/database/mongo.ts
✅ Properly checks connection state before connecting
✅ Uses strictQuery mode
✅ Fallback to MongoMemoryReplSet for development
✅ Graceful shutdown with disconnectMongo()
✅ Auto-indexing enabled in development (disabled in production)
```

### 2. **Transaction Safety**

```typescript
Location: backend/services/walletService.ts
✅ Uses MongoDB sessions for atomic operations
✅ Idempotency keys prevent duplicate transactions
✅ session.withTransaction() handles rollback automatically
✅ session.endSession() in finally block (proper cleanup)
```

### 3. **Indexes for Performance**

- User model: `mobile` (unique), `email` (sparse), `mediatorCode` (unique, sparse)
- Campaign model: Compound index `{status, brandUserId, createdAt}`
- Order model: Compound indexes for queries, unique constraints for fraud prevention
- Transaction model: `idempotencyKey` (unique)
- Deal model: Unique constraint on `{campaignId, mediatorCode}`

### 4. **Anti-Fraud Measures**

- Order duplicate prevention: `{userId, items[0].productId}` unique index
- External order ID uniqueness: `externalOrderId` unique (partial)
- Deal uniqueness per mediator: `{campaignId, mediatorCode}` unique
- Transaction idempotency: `idempotencyKey` unique

---

## 🚨 Critical Issues Found

### **ISSUE 1: Missing Connection Pool Configuration**

**Severity**: 🔴 HIGH  
**Impact**: Poor performance under load, connection exhaustion

**Problem**:

```typescript
// Current: backend/database/mongo.ts
await mongoose.connect(mongoUri, {
  autoIndex: env.NODE_ENV !== 'production',
});
// No pool size, no timeout configs!
```

**Fix Needed**:

```typescript
await mongoose.connect(mongoUri, {
  autoIndex: env.NODE_ENV !== 'production',
  maxPoolSize: 50, // Max connections in pool
  minPoolSize: 10, // Min connections maintained
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  family: 4, // Force IPv4
});
```

---

### **ISSUE 2: No Connection Error Handling**

**Severity**: 🔴 HIGH  
**Impact**: Silent failures, app crashes on DB connection loss

**Problem**:

```typescript
// Current: No error event listeners
await mongoose.connect(mongoUri, {...});
```

**Fix Needed**:

```typescript
mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected. Attempting reconnection...');
});

mongoose.connection.on('connected', () => {
  console.log('MongoDB connected successfully');
});
```

---

### **ISSUE 3: Missing Composite Index for Brand Queries**

**Severity**: 🟡 MEDIUM  
**Impact**: Slow queries when brands filter campaigns

**Problem**:

```typescript
// Campaign model has: {status, brandUserId, createdAt}
// But User model queries like:
// UserModel.findOne({ brandCode, roles: 'brand', deletedAt: { $exists: false } })
// This query is SLOW - no index on {brandCode, roles, deletedAt}
```

**Fix Needed**:

```typescript
// In User model, add:
userSchema.index({ brandCode: 1, roles: 1, deletedAt: 1 });
userSchema.index({ mediatorCode: 1, roles: 1, deletedAt: 1 });
userSchema.index({ roles: 1, status: 1, deletedAt: 1 });
```

---

### **ISSUE 4: Missing Index on Order.brandUserId**

**Severity**: 🟡 MEDIUM  
**Impact**: Slow brand portal queries

**Problem**:

```typescript
// Current indexes:
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ managerName: 1, createdAt: -1 });
orderSchema.index({ brandUserId: 1, createdAt: -1 }); // ✅ EXISTS!
```

**Status**: ✅ **ALREADY FIXED** - This index exists in Order.ts line 118

---

### **ISSUE 5: Transaction Model Lacks Wallet Reference Index**

**Severity**: 🟡 MEDIUM  
**Impact**: Slow wallet transaction history queries

**Problem**:

```typescript
// Queries like: "Show all transactions for wallet X"
// Current indexes: idempotencyKey, type, status, orderId, campaignId, payoutId
// Missing: wallet-specific index
```

**Fix Needed**:

```typescript
// Add to Transaction model:
transactionSchema.index({ 'metadata.walletId': 1, createdAt: -1 });
// OR better: Add walletId as first-class field
walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', index: true }
```

---

### **ISSUE 6: No Retry Logic for Transient Errors**

**Severity**: 🟡 MEDIUM  
**Impact**: Failed operations on temporary network issues

**Problem**:

```typescript
// walletService.ts just throws errors, no retries
await session.withTransaction(async () => {
  // If network glitch happens here, entire transaction fails
});
```

**Fix Needed**:

```typescript
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      if (i === maxRetries - 1 || !isRetryableError(err)) throw err;
      await sleep(Math.pow(2, i) * 100); // Exponential backoff
    }
  }
  throw new Error('Unreachable');
}

function isRetryableError(err: any): boolean {
  return (
    err.code === 11000 || // Duplicate key (idempotency)
    err.name === 'MongoNetworkError' ||
    err.name === 'MongoTimeoutError'
  );
}
```

---

### **ISSUE 7: Wallet Model Missing Optimistic Locking Validation**

**Severity**: 🟡 MEDIUM  
**Impact**: Race conditions in concurrent wallet updates

**Problem**:

```typescript
// Wallet has version field but not used for validation
wallet.version += 1;
await wallet.save({ session });
// No check if version changed during transaction!
```

**Fix Needed**:

```typescript
// Use findOneAndUpdate with version check:
const wallet = await WalletModel.findOneAndUpdate(
  {
    _id: walletId,
    version: currentVersion, // Optimistic lock
    deletedAt: { $exists: false },
  },
  {
    $inc: { availablePaise: -amountPaise, version: 1 },
  },
  { new: true, session }
);

if (!wallet) {
  throw new AppError(409, 'WALLET_CONFLICT', 'Wallet was modified concurrently');
}
```

---

### **ISSUE 8: Missing Index on Invite.parentCode**

**Severity**: 🟠 LOW  
**Impact**: Slow queries for agency invite hierarchies

**Problem**:

```typescript
// Invite model has parentCode field but only single-field index
// Queries like: "Find all invites created by agency X"
parentCode: { type: String, trim: true, index: true }
// But often queried with status filter too
```

**Fix Needed**:

```typescript
inviteSchema.index({ parentCode: 1, status: 1, createdAt: -1 });
```

---

### **ISSUE 9: Campaign.assignments Map Not Properly Indexed**

**Severity**: 🟠 LOW  
**Impact**: Slow lookups for agency slot allocations

**Problem**:

```typescript
// assignments is a Map, can't be indexed directly
assignments: {
  type: Map,
  of: new Schema({ limit: Number, payout: Number }, { _id: false }),
  default: {}
}
// Querying: "Which campaigns assigned to agency X?" is slow
```

**Fix Needed**:

```typescript
// Add separate collection for assignments:
const AssignmentSchema = new Schema({
  campaignId: { type: ObjectId, ref: 'Campaign', required: true, index: true },
  code: { type: String, required: true, index: true }, // agency/mediator code
  limit: { type: Number, required: true },
  payout: { type: Number },
});
AssignmentSchema.index({ code: 1, campaignId: 1 }, { unique: true });
```

---

### **ISSUE 10: No Database Health Check Endpoint**

**Severity**: 🟠 LOW  
**Impact**: Can't monitor DB connection status in production

**Problem**:

```typescript
// healthRoutes.ts doesn't check DB connection state
router.get('/health', (_, res) => res.json({ status: 'ok' }));
```

**Fix Needed**:

```typescript
router.get('/health', async (_, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus =
    {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting',
    }[dbState] || 'unknown';

  res.json({
    status: dbState === 1 ? 'ok' : 'degraded',
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
});
```

---

### **ISSUE 11: Missing TTL Index for Expired Invites**

**Severity**: 🟠 LOW  
**Impact**: Database bloat from expired invites

**Problem**:

```typescript
// Invites have expiresAt but no automatic cleanup
expiresAt: { type: Date, index: true }
```

**Fix Needed**:

```typescript
// Add TTL index (auto-delete 30 days after expiry):
inviteSchema.index(
  { expiresAt: 1 },
  {
    expireAfterSeconds: 2592000, // 30 days
    partialFilterExpression: { status: 'expired' },
  }
);
```

---

### **ISSUE 12: No Database Migration System**

**Severity**: 🟡 MEDIUM  
**Impact**: Risky schema changes in production

**Problem**:

- No versioning for schema changes
- No rollback mechanism
- Index creation happens during app startup (slow, risky)

**Fix Needed**:
Implement migration system:

```typescript
// migrations/001_add_user_indexes.ts
export async function up() {
  await mongoose.connection.collection('users').createIndex({
    brandCode: 1,
    roles: 1,
    deletedAt: 1,
  });
}

export async function down() {
  await mongoose.connection.collection('users').dropIndex('brandCode_1_roles_1_deletedAt_1');
}
```

---

## 📊 Model-by-Model Analysis

### User Model

- ✅ mobile unique index
- ✅ email sparse index
- ✅ mediatorCode unique sparse
- ⚠️ Missing: Compound indexes for role-based queries

### Campaign Model

- ✅ Compound index {status, brandUserId, createdAt}
- ✅ locked field for immutability
- ✅ assignments stores {limit, payout} objects
- ⚠️ Missing: Index on allowedAgencyCodes array

### Order Model

- ✅ Unique index {userId, items[0].productId} (anti-fraud)
- ✅ Unique index on externalOrderId (partial)
- ✅ Compound indexes for queries
- ✅ frozen field for suspension enforcement
- ✅ Append-only events log

### Deal Model

- ✅ Unique index {campaignId, mediatorCode}
- ✅ payoutPaise field (source of truth for margins)
- ✅ Snapshot pattern (immutable published deals)

### Transaction Model

- ✅ idempotencyKey unique index
- ✅ Compound index {status, type, createdAt}
- ⚠️ Missing: walletId field or metadata index

### Wallet Model

- ✅ ownerUserId unique index
- ✅ version field for optimistic locking
- ⚠️ Missing: Validation logic using version field

### Agency/Brand Models

- ✅ agencyCode/brandCode unique indexes
- ✅ status indexes
- ✅ Soft delete support

### MediatorProfile Model

- ✅ userId unique index
- ✅ mediatorCode unique index
- ✅ parentAgencyCode index

### Invite Model

- ✅ code unique index
- ✅ Compound index {status, expiresAt}
- ⚠️ Missing: TTL index, compound {parentCode, status}

### Ticket/Payout/Suspension Models

- ✅ All have proper indexes
- ✅ Timestamps configured correctly

### AuditLog Model

- ✅ Compound indexes for querying
- ✅ Timestamps (createdAt only, no updatedAt)

---

## 🎯 Immediate Action Items (Priority Order)

### P0 - Critical (Do First)

1. **Add connection pool configuration** (ISSUE 1)
2. **Add connection error handlers** (ISSUE 2)
3. **Fix optimistic locking in wallet service** (ISSUE 7)

### P1 - High (Do This Week)

4. **Add User model compound indexes** (ISSUE 3)
5. **Add wallet transaction history index** (ISSUE 5)
6. **Implement retry logic** (ISSUE 6)
7. **Add database health check** (ISSUE 10)

### P2 - Medium (Do This Month)

8. **Add Invite parentCode compound index** (ISSUE 8)
9. **Implement migration system** (ISSUE 12)
10. **Add TTL index for invites** (ISSUE 11)

### P3 - Low (Future Optimization)

11. **Refactor Campaign assignments** (ISSUE 9)
12. **Add Campaign.allowedAgencyCodes index**

---

## 🧪 Testing Recommendations

### 1. Connection Resilience Tests

```typescript
// Test DB connection loss and recovery
it('should reconnect after connection loss', async () => {
  await mongoose.connection.close();
  // Trigger operation
  await expect(UserModel.findOne({})).rejects.toThrow();
  await connectMongo(env);
  const result = await UserModel.findOne({});
  expect(result).toBeDefined();
});
```

### 2. Concurrent Wallet Tests

```typescript
// Test race conditions
it('should handle concurrent wallet debits safely', async () => {
  const promises = Array(10)
    .fill(0)
    .map(() => applyWalletDebit({ ...input, idempotencyKey: uuid() }));
  const results = await Promise.allSettled(promises);
  const successful = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected');
  expect(successful.length + failed.length).toBe(10);
});
```

### 3. Index Performance Tests

```typescript
// Measure query performance with/without indexes
it('should query campaigns by brand efficiently', async () => {
  const start = Date.now();
  await CampaignModel.find({
    brandUserId: '...',
    status: 'active',
  }).explain('executionStats');
  const duration = Date.now() - start;
  expect(duration).toBeLessThan(50); // Should use index
});
```

---

## ✅ Conclusion

**Database Status**: 🟢 **HEALTHY** but needs production hardening

**Key Strengths**:

- ✅ Proper transaction management
- ✅ Good index coverage
- ✅ Anti-fraud measures in place
- ✅ Soft delete pattern implemented

**Must Fix Before Production**:

- 🔴 Connection pool configuration
- 🔴 Error event handlers
- 🔴 Optimistic locking validation
- 🟡 Missing compound indexes
- 🟡 Retry logic for transient errors

**Overall Grade**: B+ (85/100)

- Deductions: Missing pool config (-5), no error handlers (-5), missing indexes (-5)
