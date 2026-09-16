// Cổng DUY NHẤT để AWOG chạy một lệnh hạ tầng (ADR 0088 §3, §4, §5).
//
// Mọi bề mặt — agent trong phiên, Explorer, resolver của graph, runner playbook —
// đều đi qua đây. Nhờ vậy chỉ có MỘT chỗ chèn ngữ cảnh, MỘT chỗ từ chối cờ ghi
// đè, và MỘT chỗ ghi nhật ký (task 0.6 yêu cầu ghi tại `infra.run`, không phải
// tại call site — call site quên ghi thì nhật ký hết là bằng chứng).
//
// Ba luật không có cờ tắt:
//   1. `args` là MẢNG, spawn KHÔNG qua shell ⇒ không `|`, `&&`, `$(…)`, không injection.
//   2. Ngữ cảnh do sidecar chèn; args tự mang cờ ghi đè ⇒ TỪ CHỐI trước khi spawn.
//      Đây là thứ biến "gợi ý" thành "chỉ định" (ADR 0088 §4).
//   3. Ghi nhật ký đúng một lần, kể cả khi lệnh hỏng hay bị chặn.
//
// `run.ts` KHÔNG tự quyết được phép chạy hay không — `decision` do ma trận quyền
// (task 0.7) truyền vào. Ở đây chỉ có hai loại từ chối cứng nằm NGOÀI ma trận: cờ
// ghi đè ngữ cảnh và thiếu binary.

import { execFile } from 'node:child_process'
import { log } from '../util/logger.js'
import { resolveInfraBinary, installHint } from './binary.js'
import { classify, findCredentialOp, findForbiddenFlag, findLeakyFlag } from './classify.js'
import { recordInfraAction } from './audit/store.js'
import type { InfraAuditEntry, InfraDecision, InfraSurface } from './audit/store.js'
import type { InfraCommandClass, InfraTool } from './types.js'
import { filteredShellEnv } from '../runtime/tools/shell.js'
import { redactString } from '../sessions/redact.js'

/** Ngữ cảnh đang ghim — sidecar chèn vào argv, người gọi không tự thêm cờ. */
export type InfraContext = {
  profile?: string | undefined
  region?: string | undefined
  /** Chỉ để ghi nhật ký; không thành cờ. */
  accountId?: string | undefined
  /** kubectl context. */
  cluster?: string | undefined
  namespace?: string | undefined
  /** Thư mục làm việc của terraform (`-chdir=`). */
  workspace?: string | undefined
}

export type InfraRunRequest = {
  tool: InfraTool
  args: readonly string[]
  context: InfraContext
  /** Ai bảo chạy: 'human' | 'agent:<tên>' | 'playbook:<id>#<bước>' | 'schedule:<id>'. */
  actor: string
  surface: InfraSurface
  /** Tên tool AWOG (`aws_cli`, `infra_action`…), KHÔNG phải tên binary. */
  toolName: string
  /** Ma trận quyền đã quyết gì. `run()` không tự suy ra. */
  decision: InfraDecision
  sessionId?: string | undefined
  messageId?: string | undefined
  timeoutMs?: number | undefined
  /** Trần mỗi luồng, mặc định 256 KiB. */
  maxOutputBytes?: number | undefined
  /**
   * Biến môi trường GHI ĐÈ cho riêng lời gọi này (trộn SAU `infraEnv()`).
   *
   * Hai người dùng, cả hai đều là module nội bộ của sidecar:
   *   · `console-login.ts` — chặn một file cấu hình mà CLI sẽ tự ghi (trỏ
   *     `AWS_CONFIG_FILE` vào file tạm để đường ghi vào `~/.aws` thật vẫn là
   *     `applyAwsIniEdits`).
   *   · `infra.identity-check` (nhánh `secrets`) — đưa bộ khoá người dùng VỪA
   *     GÕ vào form sửa cho `sts get-caller-identity`, để kiểm tra TRƯỚC khi
   *     ghi. Env chứ không phải cờ: argv của tiến trình con đọc được từ `ps`
   *     của mọi user và từ log kiểm toán, env thì không.
   *
   * Đường của AGENT (`infra.run` / `infra-tools.ts`) không có tham số này và
   * không được thêm: env là bề mặt đổi ngữ cảnh (invariant #7) y như `--profile`.
   */
  env?: Record<string, string> | undefined
  /**
   * Nhận output NGAY KHI tiến trình in ra, thay vì đợi nó kết thúc.
   *
   * Chỉ `console-login.ts` dùng: `aws login` in URL đăng nhập ra stdout rồi MỚI
   * chờ người dùng (tới 300s), nên UI chỉ hiện được URL đó nếu nó được đẩy lên
   * ngay lúc in. Đường của AGENT (`infra.run`/`infra-tools.ts`) không truyền
   * tham số này — output đầy đủ vẫn nằm trong `InfraRunResult` như cũ.
   *
   * Chuỗi nhận được ĐÃ qua `redactString` nhưng theo TỪNG mẩu: một bí mật bị
   * cắt đôi giữa hai mẩu thì regex không khớp được. Vì vậy callback này chỉ
   * dành cho việc bóc URL (không phải kênh hiển thị output), và người nhận
   * KHÔNG được chuyển nguyên văn nó cho UI.
   */
  onOutput?: ((chunk: string, stream: 'stdout' | 'stderr') => void) | undefined
  /** Hủy cứng: `AbortController` của người gọi (xem `console-login.ts`). */
  signal?: AbortSignal | undefined
  /**
   * Chi phí ĐÃ BIẾT TRƯỚC của lời gọi này, ghi vào dòng nhật ký.
   *
   * Chỉ `logs.ts` dùng: CloudWatch Insights tính tiền theo GB quét, và câu "lần
   * đó tốn bao nhiêu" phải trả lời được kể cả khi CLI không trả `bytesScanned`
   * (lệnh hỏng, người dùng huỷ). Con số ở đây là ƯỚC LƯỢNG đã hiện cho người
   * dùng trước khi họ bấm — không phải số đo.
   */
  cost?: { estimatedUsd?: number | undefined } | undefined
  /**
   * Ghi nhật ký cho lời gọi này. Mặc định `true` — và **chỉ lớp `read` mới được
   * phép đặt `false`**.
   *
   * Lý do tồn tại: vòng POLL của Insights gọi `get-query-results` mỗi ~1.5s do
   * CHÍNH APP sinh, không phải người dùng bấm. Ghi mỗi lần poll một dòng sẽ nhấn
   * chìm nhật ký — mà nhật ký là bằng chứng, tiếng ồn làm nó mất giá trị. Lệnh
   * `start-query` (dòng quyết định) vẫn được ghi đầy đủ.
   *
   * Hàng rào: `runInfra` TỰ ÉP về `true` cho mọi lớp khác `read`, nên không có
   * đường nào giấu một lệnh ghi hay phá huỷ. Xem `write()` bên dưới.
   */
  audit?: boolean | undefined
}

export type InfraRunResult = {
  ok: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
  /** Luồng đã bị cắt vì vượt trần. */
  truncated: boolean
  class: InfraCommandClass
  /** Có mặt khi bị từ chối trước lúc spawn. */
  rejected?: 'forbidden-flag' | 'binary-missing'
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_OUTPUT = 256 * 1024

// Cờ ghi đè theo TỪNG tool, bù cho danh sách chung ở `classify.ts` (nó cố tình
// không biết cờ riêng của tool nào). `--server` và alias ngắn `-n` của kubectl
// là lỗ invariant 7 nếu bỏ sót: cả hai đổi được đích mà lệnh thật sự chạm tới.
const EXTRA_FORBIDDEN: Record<InfraTool, readonly string[]> = {
  aws: ['--endpoint', '--cli-connect-timeout'],
  kubectl: ['--server', '-n', '-s', '--cluster', '--user', '--as', '--as-group', '--token'],
  terraform: ['-chdir'],
}

// Shorthand một chữ của kubectl (pflag) DÍNH LIỀN giá trị: `-nprod`, `-shttps://x`.
// So token nguyên vẹn sẽ trượt hết — lỗ này do infosec audit #1 chỉ ra.
const SHORT_FORBIDDEN: Record<InfraTool, readonly string[]> = {
  aws: [],
  kubectl: ['-n', '-s'],
  terraform: [],
}

/**
 * Ngữ cảnh đã ghim, đúng khuôn mà nhật ký nhận.
 *
 * Một chỗ dựng DUY NHẤT cho cả hai đường ra CLI: tool CLI (`aws_cli`…) ghi ở
 * `write()` dưới đây, còn `Bash("aws …")` ghi từ `runtime/permission.ts`. Hai bản
 * sao sẽ lệch nhau ở đúng chỗ tệ nhất — bộ lọc theo profile ở màn Nhật ký sẽ đọc
 * hai đường bằng hai khoá khác nhau, và câu "tuần này account đó bị chạm mấy lần"
 * trả lời thiếu.
 */
export function infraAuditContext(ctx: InfraContext | undefined): InfraAuditEntry['context'] {
  if (!ctx) return {}
  return {
    ...(ctx.profile !== undefined ? { profile: ctx.profile } : {}),
    ...(ctx.accountId !== undefined ? { accountId: ctx.accountId } : {}),
    ...(ctx.region !== undefined ? { region: ctx.region } : {}),
    ...(ctx.cluster !== undefined ? { cluster: ctx.cluster } : {}),
    ...(ctx.namespace !== undefined ? { namespace: ctx.namespace } : {}),
    ...(ctx.workspace !== undefined ? { workspace: ctx.workspace } : {}),
  }
}

function findExtraForbidden(tool: InfraTool, args: readonly string[]): string | null {
  for (const raw of args) {
    const name = raw.includes('=') ? raw.slice(0, raw.indexOf('=')) : raw
    if (EXTRA_FORBIDDEN[tool].includes(name)) return name
    // `-chdir=…` của terraform và `-n…` của kubectl: khớp theo tiền tố token.
    const short = SHORT_FORBIDDEN[tool].find((f) => raw.startsWith(f) && raw.length > f.length)
    if (short) return short
    const long = EXTRA_FORBIDDEN[tool].find((f) => f.startsWith('-') && raw.startsWith(f + '='))
    if (long) return long
  }
  return null
}

// Chèn cờ ngữ cảnh. terraform khác hai cái kia: `-chdir=` phải đứng TRƯỚC
// subcommand (`terraform -chdir=infra/prod plan`), đặt sau là lỗi cú pháp.
//
// CHỈ dùng cho lệnh MỘT-SHOT (không có `--`): nó APPEND cờ vào cuối argv. Lệnh có
// `--` (vd `kubectl exec … -- sh`) phải tự chèn cờ TRƯỚC `--` — xem `infra.kube-exec.ts`.
function withContext(tool: InfraTool, args: readonly string[], ctx: InfraContext): string[] {
  if (tool === 'terraform') {
    return ctx.workspace ? [`-chdir=${ctx.workspace}`, ...args] : [...args]
  }
  const out = [...args]
  if (tool === 'aws') {
    if (ctx.profile) out.push('--profile', ctx.profile)
    if (ctx.region) out.push('--region', ctx.region)
    return out
  }
  if (ctx.cluster) out.push('--context', ctx.cluster)
  if (ctx.namespace) out.push('--namespace', ctx.namespace)
  return out
}

// Env tối thiểu: dùng lại chính sách của Bash tool (`filteredShellEnv` — chỉ
// PATH/HOME/… và DO_NOT_TRACK, không mang credential của AWOG). Bù đúng ba biến
// CẤU HÌNH mà chính người dùng đặt: nếu ta đọc profile theo `AWS_CONFIG_FILE` mà
// CLI lại đọc `~/.aws/config` thì hai bên nói về hai tài khoản khác nhau.
const CONFIG_PASSTHROUGH = [
  'AWS_CONFIG_FILE',
  'AWS_SHARED_CREDENTIALS_FILE',
  'KUBECONFIG',
  // `aws login` để TOKEN trong thư mục này chứ không trong `~/.aws/config`, nên
  // profile AWOG ghi (`login_session = …`) chỉ dùng được nếu lần chạy sau của
  // CLI đọc đúng chỗ đó. Không luồn biến này xuống thì hai bên nói về hai thư mục
  // token khác nhau — đúng lỗi mà comment trên đã cảnh báo cho `AWS_CONFIG_FILE`.
  'AWS_LOGIN_CACHE_DIRECTORY',
]

/**
 * Env của tiến trình con. `context` vào đây CHỈ cho hai công cụ KHÔNG phải aws.
 *
 * Vì sao cần: `aws` nhận ngữ cảnh bằng CỜ (`--profile`/`--region`, xem
 * `withContext`) nên nó không cần env. Hai công cụ kia thì ngược lại:
 *
 *   · kubectl đọc credential của cluster qua chính kubeconfig. Với EKS, user block
 *     là một **exec plugin** `aws eks get-token` — plugin đó resolve credential
 *     từ env của TIẾN TRÌNH KUBECTL, không biết gì về profile phiên đã ghim. Không
 *     luồn `AWS_PROFILE` xuống thì hoặc plugin báo "Unable to locate credentials",
 *     hoặc tệ hơn: nó lặng lẽ lấy danh tính `[default]` của máy — tức lệnh chạy
 *     trên account KHÁC trong khi chip vẫn nói profile đã ghim (invariant #7).
 *     `aws eks update-kubeconfig` chỉ ghi `env: [AWS_PROFILE=…]` vào kubeconfig khi
 *     người dùng truyền `--profile` lúc sinh file, nên phần lớn file trên máy
 *     KHÔNG có khoá đó.
 *   · terraform: AWS provider đọc `AWS_PROFILE`/`AWS_REGION` từ env. Provider khai
 *     `profile = "…"` trong `.tf` vẫn thắng env (đúng thứ tự ưu tiên của chính
 *     terraform), nên luồn vào không ghi đè lựa chọn tường minh của stack.
 *
 * Chiều ngược lại thì KHÔNG: không có biến nào ở đây gỡ được ngữ cảnh đã ghim —
 * hai công cụ kia vẫn nhận `--context`/`-chdir=` từ argv do sidecar chèn.
 *
 * Giới hạn đã biết: nếu kubeconfig tự khai `exec.env: [AWS_PROFILE=other]` thì khoá
 * trong FILE thắng env của ta (kubectl chạy plugin với env đó). Ta cố ý KHÔNG đọc
 * khối `exec` (nó chứa đường dẫn lệnh + tham số), nên không cảnh báo được — đây là
 * lý do `--profile` lúc chạy `aws eks update-kubeconfig` là cách sạch nhất.
 *
 * `AWS_PROFILE` CỐ Ý không nằm trong allowlist env của `filteredShellEnv`: env của
 * tiến trình AWOG không được lặng lẽ quyết định lệnh chạy trên account nào. Nó chỉ
 * vào đây khi NGƯỜI DÙNG đã ghim một profile cho phiên.
 */
export function infraEnv(tool: InfraTool, context: InfraContext): NodeJS.ProcessEnv {
  const pinsAwsIdentity = tool !== 'aws' && (context.profile || context.region)
  const env = filteredShellEnv(
    pinsAwsIdentity ? { awsProfile: context.profile, awsRegion: context.region } : undefined,
  )
  for (const key of CONFIG_PASSTHROUGH) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

function clamp(text: string, max: number): { text: string; truncated: boolean } {
  const buf = Buffer.from(text, 'utf8')
  if (buf.byteLength <= max) return { text, truncated: false }
  return { text: buf.subarray(0, max).toString('utf8'), truncated: true }
}

/**
 * Chạy một lệnh hạ tầng. KHÔNG ném khi lệnh trả exit code khác 0 — đó là kết quả
 * hợp lệ (`ok: false`), người gọi cần đọc `stderr`. Chỉ ném khi chính lời gọi sai.
 */
export async function runInfra(req: InfraRunRequest): Promise<InfraRunResult> {
  const { tool, args, context, timeoutMs, maxOutputBytes, env, onOutput, signal } = req
  const cls = classify(tool, args)
  const startedAt = Date.now()

  // Chỉ lớp `read` mới được miễn ghi nhật ký; mọi lớp khác bị ép ghi. Đây là
  // điểm DUY NHẤT quyết định chuyện đó, nên không call site nào tự miễn được.
  // `audit: false` chỉ CÓ HIỆU LỰC với lớp `read`; mọi lớp khác bị ép ghi.
  const shouldAudit = req.audit !== false || cls !== 'read'

  const write = async (
    result: InfraRunResult,
    summary: string | undefined,
    decision: InfraDecision,
  ): Promise<void> => {
    if (!shouldAudit) return
    await recordInfraAction({
      actor: req.actor,
      ...(req.sessionId !== undefined ? { sessionId: req.sessionId } : {}),
      ...(req.messageId !== undefined ? { messageId: req.messageId } : {}),
      surface: req.surface,
      tool: req.toolName,
      argv: [...args],
      context: infraAuditContext(context),
      class: cls,
      decision,
      result: {
        ...(result.exitCode !== null ? { exitCode: result.exitCode } : {}),
        durationMs: result.durationMs,
        ...(summary !== undefined ? { summary } : {}),
      },
      ...(req.cost?.estimatedUsd !== undefined
        ? {
            cost: {
              estimatedUsd: req.cost.estimatedUsd,
            },
          }
        : {}),
    })
  }

  // ── Từ chối cứng 1: args tự mang cờ ghi đè ngữ cảnh, hoặc cờ rò credential ──
  // `--debug` in request đã ký (kèm session token) ra stderr, mà stderr đi vào cả
  // nhật ký lẫn context model — audit #1 xếp high. Từ chối cùng đường với cờ ngữ
  // cảnh vì hệ quả giống nhau: lệnh chạy nhưng để lại thứ không được phép để lại.
  // Lệnh phát credential bị từ chối CỨNG, ngoài ma trận (audit #1 F1): output của
  // chúng chính là khoá, và `--output text` vô hiệu hoá mọi lớp che.
  const credentialOp = findCredentialOp(tool, args)
  if (credentialOp) {
    const result: InfraRunResult = {
      ok: false,
      exitCode: null,
      stdout: '',
      stderr:
        `AWOG không chạy \`${credentialOp}\`: output của lệnh này CHÍNH LÀ credential, ` +
        'và nó sẽ đi vào nhật ký cùng ngữ cảnh của model. Mở terminal và tự chạy nếu bạn cần.',
      durationMs: 0,
      truncated: false,
      class: cls,
      rejected: 'forbidden-flag',
    }
    await write(result, `refused credential-emitting op ${credentialOp}`, 'blocked')
    return result
  }

  const forbidden =
    findForbiddenFlag(args) ?? findExtraForbidden(tool, args) ?? findLeakyFlag(args)
  if (forbidden) {
    const result: InfraRunResult = {
      ok: false,
      exitCode: null,
      stdout: '',
      stderr: `Cờ ${forbidden} bị từ chối: ngữ cảnh do phiên chỉ định, không ghi đè được.`,
      durationMs: 0,
      truncated: false,
      class: cls,
      rejected: 'forbidden-flag',
    }
    await write(result, `rejected flag ${forbidden}`, 'blocked')
    return result
  }

  // ── Từ chối cứng 2: không có binary ────────────────────────────────────────
  const bin = await resolveInfraBinary(tool)
  if (!bin) {
    const result: InfraRunResult = {
      ok: false,
      exitCode: null,
      stdout: '',
      stderr: `Không tìm thấy ${tool} trên máy. ${installHint(tool)}`,
      durationMs: 0,
      truncated: false,
      class: cls,
      rejected: 'binary-missing',
    }
    await write(result, `${tool} unavailable`, 'blocked')
    return result
  }

  const finalArgs = withContext(tool, args, context)
  const max = maxOutputBytes ?? DEFAULT_MAX_OUTPUT

  const raw = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      const child = execFile(
        bin,
        finalArgs,
        {
          env: { ...infraEnv(tool, context), ...env },
          timeout: timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: max * 4,
          windowsHide: true,
          ...(signal ? { signal } : {}),
        },
        (err, stdout, stderr) => {
          const code =
            err && typeof (err as { code?: unknown }).code === 'number'
              ? ((err as { code: number }).code as number)
              : err
                ? null
                : 0
          resolve({ code, stdout, stderr: stderr || (err ? err.message : '') })
        },
      )
      // `onOutput` là kênh PHỤ: `execFile` vẫn tự gom đủ stdout/stderr cho
      // callback trên, nên thêm listener ở đây không đổi kết quả trả về.
      if (onOutput) {
        for (const [stream, readable] of [
          ['stdout', child.stdout],
          ['stderr', child.stderr],
        ] as const) {
          readable?.setEncoding('utf8')
          readable?.on('data', (chunk: string) => {
            onOutput(redactString(chunk), stream)
          })
        }
      }
    },
  )

  // Redact TRƯỚC khi cắt, và trước khi hai luồng này đi bất cứ đâu (audit #1).
  // Thứ tự là load-bearing: cắt trước sẽ chặt đôi một token làm regex mất dấu —
  // đúng lỗi mà `audit/store.ts` đã tự đặt luật rồi `run.ts` lại phạm ở đường
  // `summary`. Và redact ở ĐÂY chứ không chỉ trong store, vì cùng hai chuỗi này
  // còn đi lên model qua `infra-tools.ts` và lên UI qua `infra.run` — store chỉ
  // che được bản của riêng nó. Lệnh hạ tầng in credential ra stdout là chuyện
  // bình thường (`sts assume-role`, `ecr get-login-password`).
  const out = clamp(redactString(raw.stdout), max)
  const errOut = clamp(redactString(raw.stderr), max)
  const result: InfraRunResult = {
    ok: raw.code === 0,
    exitCode: raw.code,
    stdout: out.text,
    stderr: errOut.text,
    durationMs: Date.now() - startedAt,
    truncated: out.truncated || errOut.truncated,
    class: cls,
  }

  await write(result, raw.code === 0 ? undefined : errOut.text.slice(0, 400), req.decision)
  if (!result.ok) log.warn(`infra.run: ${tool} exited ${String(raw.code)}`)
  return result
}
