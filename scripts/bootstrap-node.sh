#!/usr/bin/env bash
set -euo pipefail

source "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/_env.sh"

target_dir="$(expected_local_node_dir)"
archive_name="node-v${NODE_VERSION}-$(platform_triplet).tar.gz"
archive_path="$PROJECT_ROOT/tools/$archive_name"
download_url="https://nodejs.org/dist/v${NODE_VERSION}/${archive_name}"

if [[ -x "$target_dir/bin/node" ]]; then
  echo "Local Node runtime already available at $target_dir"
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to download Node.js" >&2
  exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
  echo "tar is required to extract Node.js" >&2
  exit 1
fi

mkdir -p "$PROJECT_ROOT/tools"

echo "Downloading Node.js v${NODE_VERSION} from $download_url"
curl -fsSL "$download_url" -o "$archive_path"

echo "Extracting Node.js into $PROJECT_ROOT/tools"
tar -xzf "$archive_path" -C "$PROJECT_ROOT/tools"

echo "Local Node runtime ready: $target_dir"
