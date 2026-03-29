#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_env.sh"

if ! ensure_node_environment; then
  "$SCRIPT_DIR/bootstrap-node.sh"
fi

"$SCRIPT_DIR/npmw" ci
