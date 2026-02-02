#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
# Render Build Script
# Runs during every deploy after `npm install`.
# Creates the DB directory if needed and runs migrations.
# ─────────────────────────────────────────────────────────

set -e

echo "▸ UAE build: running migrations..."

# Ensure the persistent disk directory exists (first deploy)
if [ -n "$DB_DIR" ]; then
  mkdir -p "$DB_DIR"
  echo "  DB_DIR = $DB_DIR"
fi

# Run migrations (idempotent — uses CREATE TABLE IF NOT EXISTS)
node src/db/migrate.js

echo "▸ UAE build: complete"
