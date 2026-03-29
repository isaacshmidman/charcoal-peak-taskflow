#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_VERSION="$(tr -d '[:space:]' < "$PROJECT_ROOT/.nvmrc")"

platform_triplet() {
  local os arch

  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *)
      echo "Unsupported operating system: $(uname -s)" >&2
      return 1
      ;;
  esac

  case "$(uname -m)" in
    arm64|aarch64) arch="arm64" ;;
    x86_64) arch="x64" ;;
    *)
      echo "Unsupported architecture: $(uname -m)" >&2
      return 1
      ;;
  esac

  printf "%s-%s" "$os" "$arch"
}

expected_local_node_dir() {
  printf "%s/tools/node-v%s-%s" "$PROJECT_ROOT" "$NODE_VERSION" "$(platform_triplet)"
}

find_local_node_dir() {
  local expected_dir
  expected_dir="$(expected_local_node_dir)"
  if [[ -x "$expected_dir/bin/node" ]]; then
    printf "%s" "$expected_dir"
    return 0
  fi

  local first_match
  first_match="$(find "$PROJECT_ROOT/tools" -maxdepth 1 -type d -name 'node-v*' 2>/dev/null | sort | head -n 1 || true)"
  if [[ -n "$first_match" && -x "$first_match/bin/node" ]]; then
    printf "%s" "$first_match"
    return 0
  fi

  return 1
}

ensure_node_environment() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    return 0
  fi

  local local_node_dir
  local_node_dir="$(find_local_node_dir || true)"
  if [[ -n "$local_node_dir" ]]; then
    export PATH="$local_node_dir/bin:$PATH"
    return 0
  fi

  return 1
}
