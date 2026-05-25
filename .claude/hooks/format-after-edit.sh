#!/usr/bin/env bash
# PostToolUse hook: chạy `prettier --write` trên file vừa được Claude Edit/Write,
# chỉ áp dụng cho file trong apps/desktop/ui/ với đuôi .ts/.vue/.js/.json/.md.
#
# Đầu vào: JSON từ Claude Code qua stdin, có field tool_input.file_path.
# Đầu ra: silent khi thành công; in lỗi (nếu có) ra stderr để Claude thấy.
#
# Không fail toàn bộ tool — exit 0 luôn, chỉ log warning.

set -u

# Đọc JSON payload từ stdin
PAYLOAD=$(cat || true)
FILE_PATH=$(printf '%s' "$PAYLOAD" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)

if [[ -z "${FILE_PATH:-}" ]]; then
  exit 0
fi

# Chỉ format file thuộc apps/desktop/ui/
case "$FILE_PATH" in
  */apps/desktop/ui/*) ;;
  *) exit 0 ;;
esac

# Chỉ format các đuôi Prettier hỗ trợ trong dự án này
case "$FILE_PATH" in
  *.ts|*.vue|*.js|*.cjs|*.mjs|*.json|*.md) ;;
  *) exit 0 ;;
esac

# Bỏ qua file generated / ignored
case "$FILE_PATH" in
  *"/.nuxt/"*|*"/.output/"*|*"/node_modules/"*|*"/dist/"*) exit 0 ;;
esac

UI_DIR="$(dirname "$FILE_PATH")"
# Lùi lên tới khi gặp package.json (gốc UI)
while [[ "$UI_DIR" != "/" && ! -f "$UI_DIR/package.json" ]]; do
  UI_DIR="$(dirname "$UI_DIR")"
done

if [[ ! -f "$UI_DIR/package.json" ]]; then
  exit 0
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[format-after-edit] pnpm not found, skipping" >&2
  exit 0
fi

# --loglevel warn để không spam stdout. Lỗi (nếu có) sẽ in ra stderr.
(cd "$UI_DIR" && pnpm exec prettier --write --log-level warn "$FILE_PATH") || {
  echo "[format-after-edit] prettier failed on $FILE_PATH" >&2
}

exit 0
