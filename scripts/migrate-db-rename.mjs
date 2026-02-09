#!/usr/bin/env node
/**
 * migrate-db-rename.mjs
 *
 * One-time migration script: copies every collection from a SOURCE database
 * to a TARGET database on the same MongoDB cluster.
 *
 * Usage:
 *   node scripts/migrate-db-rename.mjs
 *
 * Required env vars:
 *   MONGODB_URI   — full connection string (e.g. mongodb+srv://user:pass@cluster0.xxx.mongodb.net/)
 *
 * Optional env vars:
 *   SOURCE_DB     — name of the database to copy FROM  (default: "test")
 *   TARGET_DB     — name of the database to copy TO    (default: "mobo")
 *
 * What it does:
 *   1. Connects to the cluster
 *   2. Lists all collections in SOURCE_DB
 *   3. For each collection, copies all documents to TARGET_DB
 *   4. Copies indexes (excluding _id) from source → target
 *   5. Prints a summary
 *
 * Safety:
 *   - Read-only on the source database (never drops or modifies it)
 *   - If a target collection already has documents, it SKIPS that collection
 *     (idempotent / safe to re-run)
 *   - Does NOT drop the old database — you do that manually after verifying
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('ERROR: MONGODB_URI environment variable is required.');
  console.error('Example: MONGODB_URI="mongodb+srv://user:pass@cluster0.xxx.mongodb.net/" node scripts/migrate-db-rename.mjs');
  process.exit(1);
}

const SOURCE_DB = process.env.SOURCE_DB || 'test';
const TARGET_DB = process.env.TARGET_DB || 'mobo';

if (SOURCE_DB === TARGET_DB) {
  console.error(`ERROR: SOURCE_DB and TARGET_DB are both "${SOURCE_DB}". Nothing to do.`);
  process.exit(1);
}

console.log(`\n📦 MongoDB Database Migration`);
console.log(`   Source: "${SOURCE_DB}"  →  Target: "${TARGET_DB}"`);
console.log(`   Cluster: ${MONGODB_URI.replace(/:([^:@]+)@/, ':***@')}\n`);

const client = new MongoClient(MONGODB_URI);

try {
  await client.connect();
  console.log('✅ Connected to cluster\n');

  const sourceDb = client.db(SOURCE_DB);
  const targetDb = client.db(TARGET_DB);

  // List all collections in source
  const collections = await sourceDb.listCollections().toArray();
  const collectionNames = collections
    .map((c) => c.name)
    .filter((name) => !name.startsWith('system.'));

  if (collectionNames.length === 0) {
    console.log(`⚠️  No collections found in "${SOURCE_DB}". Nothing to migrate.`);
    process.exit(0);
  }

  console.log(`Found ${collectionNames.length} collections in "${SOURCE_DB}":`);
  collectionNames.forEach((name) => console.log(`   • ${name}`));
  console.log('');

  const summary = { copied: [], skipped: [], errors: [] };

  for (const collName of collectionNames) {
    const srcColl = sourceDb.collection(collName);
    const tgtColl = targetDb.collection(collName);

    // Check if target already has data (skip if so — idempotent)
    const targetCount = await tgtColl.countDocuments({}, { limit: 1 });
    if (targetCount > 0) {
      const fullCount = await tgtColl.countDocuments();
      console.log(`⏭️  "${collName}" — target already has ${fullCount} docs, SKIPPING`);
      summary.skipped.push(collName);
      continue;
    }

    try {
      // Copy documents
      const docs = await srcColl.find({}).toArray();
      if (docs.length === 0) {
        console.log(`📭 "${collName}" — 0 documents (empty collection, creating anyway)`);
        // Ensure the collection exists even if empty
        await targetDb.createCollection(collName);
        summary.copied.push({ name: collName, count: 0 });
        continue;
      }

      await tgtColl.insertMany(docs, { ordered: false });
      console.log(`✅ "${collName}" — copied ${docs.length} documents`);

      // Copy indexes (skip the default _id index)
      const indexes = await srcColl.indexes();
      const customIndexes = indexes.filter((idx) => idx.name !== '_id_');
      for (const idx of customIndexes) {
        try {
          const { key, ...options } = idx;
          // Remove v and ns fields that shouldn't be passed to createIndex
          delete options.v;
          delete options.ns;
          await tgtColl.createIndex(key, options);
        } catch (indexErr) {
          // Index might already exist
          if (!indexErr.message?.includes('already exists')) {
            console.warn(`   ⚠️  Index "${idx.name}" on "${collName}": ${indexErr.message}`);
          }
        }
      }
      if (customIndexes.length > 0) {
        console.log(`   📑 Copied ${customIndexes.length} indexes`);
      }

      summary.copied.push({ name: collName, count: docs.length });
    } catch (err) {
      console.error(`❌ "${collName}" — ERROR: ${err.message}`);
      summary.errors.push({ name: collName, error: err.message });
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Source: "${SOURCE_DB}"  →  Target: "${TARGET_DB}"`);
  console.log(`Copied:  ${summary.copied.length} collections (${summary.copied.reduce((s, c) => s + c.count, 0)} total docs)`);
  console.log(`Skipped: ${summary.skipped.length} (already had data in target)`);
  console.log(`Errors:  ${summary.errors.length}`);

  if (summary.copied.length > 0) {
    console.log('\nCopied collections:');
    summary.copied.forEach((c) => console.log(`   ✅ ${c.name} (${c.count} docs)`));
  }
  if (summary.skipped.length > 0) {
    console.log('\nSkipped collections:');
    summary.skipped.forEach((name) => console.log(`   ⏭️  ${name}`));
  }
  if (summary.errors.length > 0) {
    console.log('\nFailed collections:');
    summary.errors.forEach((e) => console.log(`   ❌ ${e.name}: ${e.error}`));
  }

  console.log('\n' + '='.repeat(60));
  console.log('NEXT STEPS:');
  console.log('='.repeat(60));
  console.log(`1. Verify data in Atlas: open database "${TARGET_DB}" and check collections`);
  console.log(`2. On Render (production), set env var:  MONGODB_DBNAME=${TARGET_DB}`);
  console.log(`3. Redeploy the backend on Render`);
  console.log(`4. Verify /api/health returns OK and app works`);
  console.log(`5. Once confirmed, you can safely drop "${SOURCE_DB}" from Atlas`);
  console.log('');

} catch (err) {
  console.error('Fatal error:', err);
  process.exit(1);
} finally {
  await client.close();
}
