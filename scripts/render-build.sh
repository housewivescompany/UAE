#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────
# Render Build Script
# Runs during every deploy after `npm install`.
#
# NOTE: The persistent disk (/data) is NOT available during
# the build phase — only at runtime. Migrations run
# automatically when the server starts (server.js imports
# migrate.js on boot). This script handles build-time-only
# tasks like native module compilation.
# ─────────────────────────────────────────────────────────

set -e

echo "▸ UAE build: dependencies installed"
echo "▸ UAE build: migrations will run at server startup (disk available at runtime only)"
echo "▸ UAE build: complete"
