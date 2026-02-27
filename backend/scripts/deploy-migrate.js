#!/usr/bin/env node
/**
 * Direct SQL migration runner — bypasses Prisma CLI entirely.
 * Used as fallback when `prisma migrate deploy` or `prisma db push`
 * fail due to hosted PostgreSQL permission restrictions.
 *
 * Usage: node scripts/deploy-migrate.js
 * Requires: DATABASE_URL env var with search_path set to target schema
 */

const { Client } = require("pg");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MIGRATIONS_DIR = path.join(__dirname, "../prisma/migrations");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log("Connected to database");

  // Show current search_path
  const spResult = await client.query("SHOW search_path");
  console.log("search_path:", spResult.rows[0].search_path);

  const schemaResult = await client.query("SELECT current_schema()");
  console.log("current_schema:", schemaResult.rows[0].current_schema);

  // Create _prisma_migrations table if not exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
      checksum VARCHAR(64) NOT NULL,
      finished_at TIMESTAMPTZ,
      migration_name VARCHAR(255) NOT NULL UNIQUE,
      logs TEXT,
      rolled_back_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ DEFAULT now(),
      applied_steps_count INTEGER DEFAULT 0
    )
  `);
  console.log("_prisma_migrations table ready");

  // Get sorted migration directories
  const dirs = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((d) => {
      const p = path.join(MIGRATIONS_DIR, d);
      return (
        fs.statSync(p).isDirectory() &&
        fs.existsSync(path.join(p, "migration.sql"))
      );
    })
    .sort();

  console.log(`Found ${dirs.length} migrations: ${dirs.join(", ")}`);

  let applied = 0;
  let skipped = 0;

  for (const dir of dirs) {
    // Check if already applied
    const exists = await client.query(
      `SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NOT NULL`,
      [dir]
    );
    if (exists.rows.length > 0) {
      console.log(`⏭️  ${dir} (already applied)`);
      skipped++;
      continue;
    }

    // Delete any failed/incomplete entries for this migration
    await client.query(
      `DELETE FROM "_prisma_migrations" WHERE migration_name = $1`,
      [dir]
    );

    const sqlFile = path.join(MIGRATIONS_DIR, dir, "migration.sql");
    const sql = fs.readFileSync(sqlFile, "utf8");
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");

    console.log(`🔧 Applying: ${dir}`);

    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("COMMIT");

      // Record as applied
      await client.query(
        `INSERT INTO "_prisma_migrations" (checksum, migration_name, finished_at, applied_steps_count) VALUES ($1, $2, now(), 1)`,
        [checksum, dir]
      );
      console.log(`✅ ${dir}`);
      applied++;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`❌ ${dir}: ${e.message}`);

      // For non-baseline migrations (which use IF NOT EXISTS),
      // try executing without transaction wrapper
      if (dir !== "0_baseline") {
        console.log(`   Retrying ${dir} without transaction...`);
        try {
          await client.query(sql);
          await client.query(
            `INSERT INTO "_prisma_migrations" (checksum, migration_name, finished_at, applied_steps_count) VALUES ($1, $2, now(), 1)`,
            [checksum, dir]
          );
          console.log(`✅ ${dir} (retry succeeded)`);
          applied++;
        } catch (e2) {
          console.error(`❌ ${dir} retry failed: ${e2.message}`);
          await client.end();
          process.exit(1);
        }
      } else {
        console.error(
          "Baseline migration failed — cannot continue. Error details above."
        );
        await client.end();
        process.exit(1);
      }
    }
  }

  await client.end();
  console.log(
    `\n✅ Migration complete: ${applied} applied, ${skipped} skipped`
  );
}

main().catch((e) => {
  console.error("Fatal error:", e.message);
  console.error(e.stack);
  process.exit(1);
});
