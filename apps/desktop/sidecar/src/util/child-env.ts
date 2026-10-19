// Env cho tiến trình con do NGƯỜI DÙNG điều khiển (terminal, CLI tương tác, lệnh của lịch
// chạy) — bản gốc của bộ lọc trước đây chép ở terminal/manager.ts và sessions/cli-registry.ts.
//
// Hai lớp lọc:
//   • credential exact/suffix (invariant #1 — một shell hay một script không được
//     `env | grep` ra token mà người dùng export trong shell profile);
//   • cờ runtime của host: sidecar chạy bằng `electron --run-as-node`, nên
//     ELECTRON_RUN_AS_NODE / NODE_OPTIONS sẽ cướp mọi `node`/`electron` con.
// Nhánh claude KHÔNG đi qua đây — nó cần token trong env nên dùng buildSdkEnv.

const SENSITIVE_EXACT = new Set(['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'])
const SENSITIVE_SUFFIX = /(_TOKEN|_KEY|_SECRET)$/i
const HOST_RUNTIME_VARS = ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'ELECTRON_NO_ATTACH_CONSOLE']

export function envWithoutSecrets(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (SENSITIVE_EXACT.has(key) || SENSITIVE_SUFFIX.test(key)) continue
    if (HOST_RUNTIME_VARS.includes(key)) continue
    out[key] = value
  }
  return out
}
