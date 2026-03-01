#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────
# Migration Safety Checker — CI gate for Prisma migrations
# Fails the build if migrations contain destructive operations
# that haven't been explicitly approved.
# ──────────────────────────────────────────────────────────────────
set -euo pipefail

MIGRATIONS_DIR="prisma/migrations"
EXIT_CODE=0
ERRORS=""

echo "🔍 Scanning migrations for unsafe operations..."

for migration_file in $(find "$MIGRATIONS_DIR" -name "migration.sql" -type f | sort); do
  migration_name=$(basename "$(dirname "$migration_file")")

  # Skip baseline — it was already applied
  if [[ "$migration_name" == "0_baseline" ]]; then
    continue
  fi

  echo "  Checking: $migration_name"

  # ── Dangerous: DROP TABLE ──
  if grep -qiE '^\s*DROP\s+TABLE' "$migration_file"; then
    ERRORS+="❌ [$migration_name] Contains DROP TABLE — requires manual approval\n"
    EXIT_CODE=1
  fi

  # ── Dangerous: DROP COLUMN ──
  if grep -qiE 'DROP\s+COLUMN' "$migration_file"; then
    ERRORS+="❌ [$migration_name] Contains DROP COLUMN — use expand-contract pattern\n"
    EXIT_CODE=1
  fi

  # ── Dangerous: ALTER COLUMN ... TYPE (without shadow column) ──
  if grep -qiE 'ALTER\s+COLUMN.*TYPE' "$migration_file"; then
    ERRORS+="⚠️  [$migration_name] Contains ALTER COLUMN TYPE — verify backward compatibility\n"
    EXIT_CODE=1
  fi

  # ── Dangerous: RENAME COLUMN ──
  if grep -qiE 'RENAME\s+COLUMN' "$migration_file"; then
    ERRORS+="❌ [$migration_name] Contains RENAME COLUMN — use dual-write pattern instead\n"
    EXIT_CODE=1
  fi

  # ── Dangerous: DROP TYPE (enum) ──
  if grep -qiE '^\s*DROP\s+TYPE' "$migration_file"; then
    ERRORS+="❌ [$migration_name] Contains DROP TYPE — verify no running code uses this enum\n"
    EXIT_CODE=1
  fi

  # ── Dangerous: NOT NULL without DEFAULT ──
  if grep -qiE 'SET\s+NOT\s+NULL' "$migration_file"; then
    # Check if there's a SET DEFAULT before the SET NOT NULL
    if ! grep -qiE 'SET\s+DEFAULT' "$migration_file"; then
      ERRORS+="❌ [$migration_name] Contains SET NOT NULL without SET DEFAULT — will fail on existing rows\n"
      EXIT_CODE=1
    fi
  fi

  # ── Dangerous: ADD COLUMN ... NOT NULL (without DEFAULT) ──
  if grep -qiP 'ADD\s+COLUMN\s+\S+\s+\S+.*NOT\s+NULL(?!.*DEFAULT)' "$migration_file"; then
    ERRORS+="❌ [$migration_name] Contains ADD COLUMN NOT NULL without DEFAULT — will fail on existing rows\n"
    EXIT_CODE=1
  fi

  # ── Warning: CREATE INDEX without CONCURRENTLY on production tables ──
  if grep -qiE '^\s*CREATE\s+INDEX\s' "$migration_file"; then
    if ! grep -qiE 'CREATE\s+INDEX\s+CONCURRENTLY' "$migration_file"; then
      ERRORS+="⚠️  [$migration_name] CREATE INDEX without CONCURRENTLY — may lock table in production\n"
      # Warning only, don't fail
    fi
  fi

  # ── Dangerous: TRUNCATE ──
  if grep -qiE '^\s*TRUNCATE' "$migration_file"; then
    ERRORS+="❌ [$migration_name] Contains TRUNCATE — data loss!\n"
    EXIT_CODE=1
  fi

  # ── Dangerous: DELETE without WHERE ──
  if grep -qiE '^\s*DELETE\s+FROM\s+\S+\s*;' "$migration_file"; then
    ERRORS+="❌ [$migration_name] Contains DELETE without WHERE clause — data loss!\n"
    EXIT_CODE=1
  fi
done

echo ""

if [ $EXIT_CODE -ne 0 ]; then
  echo "════════════════════════════════════════════════"
  echo "  MIGRATION SAFETY CHECK FAILED"
  echo "════════════════════════════════════════════════"
  echo ""
  echo -e "$ERRORS"
  echo ""
  echo "To approve a destructive migration, add a comment to the SQL:"
  echo "  -- @approved-destructive: <reason>"
  echo ""
  echo "Or override in CI with: MIGRATION_ALLOW_DESTRUCTIVE=true"
  echo ""

  # Allow override via env var for intentional destructive migrations
  if [ "${MIGRATION_ALLOW_DESTRUCTIVE:-false}" = "true" ]; then
    echo "⚠️  MIGRATION_ALLOW_DESTRUCTIVE=true — proceeding despite warnings"
    exit 0
  fi

  exit 1
else
  echo "✅ All migrations passed safety checks"
fi
