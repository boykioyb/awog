// `infra.identity-check` — "profile này thật ra là ai" (`sts get-caller-identity`).
//
// Profile sai chỉ lộ ra khi gọi thử, và lộ ngay lúc vừa tạo thì rẻ hơn nhiều so
// với lúc đang chữa cháy (spec `aws-profile-manager.md`).
//
// HAI chế độ, loại trừ nhau (zod ép đúng một trong hai):
//   · `profile` — kiểm tra một profile ĐÃ GHI trên đĩa, ngữ cảnh đi bằng CỜ
//     (`--profile`, `--region`). Đây là đường cũ, không chạm secret.
//   · `secrets` — kiểm tra bộ khoá người dùng VỪA GÕ trong form sửa, TRƯỚC khi
//     ghi (nút "Kiểm tra" của AwsProfileEditor). Khoá đi bằng ENV của tiến trình
//     con: argv nhìn thấy được từ `ps` của mọi user và từ log kiểm toán, env thì
//     không (xem `InfraRunRequest.env`), và đó cũng là lý do KHÔNG truyền khoá
//     bằng cờ dù CLI có nhận. Không có nhánh nào cho agent: method này không
//     được map vào AgentTool, và `infra.run` của agent không có tham số `env`.
//
// KHÔNG BAO GIỜ NÉM khi lệnh trả exit code khác 0: "credential hỏng" là một kết
// quả hợp lệ mà UI phải hiện được, không phải sự cố của RPC.
//
// Đi qua `runInfra()` — cổng duy nhất ra CLI — nên argv KHÔNG tự mang
// `--profile`/`--region` (sidecar tự chèn; tự mang là bị từ chối), và lượt gọi
// tự để lại một dòng nhật ký. `decision: 'approved'` vì đây là nút người dùng
// vừa bấm: lệnh thuộc lớp `read`, và `classify.ts` đã chặn cứng nhóm lệnh phát
// credential nên `get-caller-identity` không thể in ra khoá. Giá trị khoá KHÔNG
// vào dòng nhật ký: `argv` chỉ có subcommand, `context` chỉ có region.
import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { INFRA_SURFACES } from '../infra/audit/store.js'
import { runInfra } from '../infra/run.js'

const Secrets = z.object({
  accessKeyId: z.string().min(1).max(256),
  secretAccessKey: z.string().min(1).max(256),
  sessionToken: z.string().min(1).max(8192).optional(),
})

const Params = z
  .object({
    profile: z.string().min(1).max(128).optional(),
    region: z.string().max(64).optional(),
    secrets: Secrets.optional(),
    surface: z.enum(INFRA_SURFACES).default('settings'),
  })
  .refine((p) => (p.profile === undefined) !== (p.secrets === undefined), {
    message: 'Provide exactly one of "profile" or "secrets"',
  })

// Chỉ ba trường AWOG dùng; `.passthrough()` mặc định của zod bị bỏ qua vì payload
// trả về phải là thứ ta tự dựng, không phải JSON của CLI đi thẳng lên UI.
const Identity = z.object({
  Account: z.string().max(64),
  Arn: z.string().max(2048),
  UserId: z.string().max(256),
})

const MAX_ERROR_CHARS = 600
// Lệnh có thể mở trình duyệt refresh SSO ⇒ rộng hơn mặc định 60s một chút.
const TIMEOUT_MS = 45_000

type Result =
  | { ok: true; accountId: string; arn: string; userId: string }
  | { ok: false; error: string }

type SecretInput = z.infer<typeof Secrets>

/**
 * Khoá ĐÃ GÕ trong form ⇒ CHỈ truyền bằng env, và chỉ ba tên biến chuẩn của AWS.
 * Không kèm `AWS_PROFILE`: `infraEnv()` chỉ chèn biến đó cho kubectl/terraform,
 * nên tiến trình `aws` này không có hai nguồn danh tính mâu thuẫn nhau.
 *
 * Export để test đo được hợp đồng này mà không phải spawn CLI thật.
 */
export function secretsEnv(secrets: SecretInput): Record<string, string> {
  return {
    AWS_ACCESS_KEY_ID: secrets.accessKeyId,
    AWS_SECRET_ACCESS_KEY: secrets.secretAccessKey,
    ...(secrets.sessionToken !== undefined ? { AWS_SESSION_TOKEN: secrets.sessionToken } : {}),
  }
}

/** Ngữ cảnh của lượt `sts get-caller-identity`: luôn đi bằng context, không argv. */
export function identityContext(
  profile: string | undefined,
  region: string | undefined,
): { profile?: string; region?: string } {
  return {
    ...(profile !== undefined ? { profile } : {}),
    ...(region !== undefined ? { region } : {}),
  }
}

/** Schema của RPC — export để test khẳng định luật "đúng một trong hai". */
export const IdentityCheckParams = Params

register('infra.identity-check', async (raw): Promise<Result> => {
  const p = Params.parse(raw)
  const env = p.secrets === undefined ? undefined : secretsEnv(p.secrets)

  const run = await runInfra({
    tool: 'aws',
    args: ['sts', 'get-caller-identity', '--output', 'json'],
    context: identityContext(p.profile, p.region),
    actor: 'human',
    surface: p.surface,
    toolName: 'identity_check',
    decision: 'approved',
    timeoutMs: TIMEOUT_MS,
    ...(env !== undefined ? { env } : {}),
  })

  // `stdout`/`stderr` đã được `runInfra` redact trước khi rời khỏi tiến trình con.
  if (!run.ok) {
    const detail = run.stderr.trim() || `aws exited with code ${String(run.exitCode)}`
    return { ok: false, error: detail.slice(0, MAX_ERROR_CHARS) }
  }

  let payload: unknown
  try {
    payload = JSON.parse(run.stdout)
  } catch {
    return { ok: false, error: 'Unexpected output from aws sts get-caller-identity' }
  }
  const parsed = Identity.safeParse(payload)
  if (!parsed.success) {
    return { ok: false, error: 'Unexpected output from aws sts get-caller-identity' }
  }
  return {
    ok: true,
    accountId: parsed.data.Account,
    arn: parsed.data.Arn,
    userId: parsed.data.UserId,
  }
})
