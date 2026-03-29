#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

if [[ ! -d "$PROJECT_ROOT/node_modules" ]]; then
  "$SCRIPT_DIR/setup.sh"
fi

if [[ "${1:-}" == "--e2e" ]]; then
  "$SCRIPT_DIR/npmw" run verify:all
else
  "$SCRIPT_DIR/npmw" run verify
fi
