#!/usr/bin/env bash
# Hook utility: chạy ESLint check (không fix) trên frontend.
# Gọi thủ công, hoặc wire vào Stop hook trong .claude/settings.json
# để nhắc Claude trước khi báo task xong.
#
# Exit code 0 = sạch, != 0 = còn lỗi (Claude sẽ thấy và fix).

set -u

UI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/apps/desktop/ui"

if [[ ! -f "$UI_DIR/package.json" ]]; then
  echo "[lint-check] UI package not found at $UI_DIR" >&2
  exit 0
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[lint-check] pnpm not found, skipping" >&2
  exit 0
fi

cd "$UI_DIR" && pnpm exec eslint . --ext .ts,.vue,.js,.cjs --max-warnings 0
