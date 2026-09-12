# codex-spike — đo Codex `app-server` cho [ADR 0087](../../docs/decisions/0087-codex-app-server-as-openai-runtime.md)

Driver tối thiểu nói JSON-RPC 2.0 (NDJSON qua stdio) với `codex app-server`, để
tái lập các phép đo trong §S1 của ADR. **Không** phải code sản phẩm — không
import vào sidecar, không thêm dependency.

## Chuẩn bị

```bash
npm install @openai/codex@0.154.0            # hoặc dùng binary có sẵn trên máy
export CODEX_BIN=./node_modules/.bin/codex
export CODEX_HOME=$(mktemp -d)               # BẮT BUỘC: đừng mượn ~/.codex của người dùng
```

> Không set `CODEX_HOME` thì thread sẽ thừa kế MCP server, model provider và
> skills trong cấu hình Codex cá nhân của người chạy — đúng cái bẫy F4 ghi trong ADR.

## Chạy

```bash
node probe.mjs    # chỉ method read-only: initialize, auth, rate limits, models, skills, hooks, MCP
node turn.mjs     # 2 lượt model THẬT: dynamic tool + approval (deny) + turn/steer
```

`turn.mjs` tiêu tốn quota thật của account đang đăng nhập. Prompt cố tình tối thiểu.

## Sinh lại hợp đồng protocol

```bash
$CODEX_BIN app-server generate-ts          --out ./proto-ts --experimental
$CODEX_BIN app-server generate-json-schema --out ./proto-schema
```

`--experimental` là bắt buộc để thấy `ThreadStartParams.dynamicTools`.
