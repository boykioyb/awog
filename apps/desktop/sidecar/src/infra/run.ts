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
import type { InfraDecision, InfraSurface } from './audit/store.js'
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
const CONFIG_PASSTHROUGH = ['AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE', 'KUBECONFIG']

function infraEnv(): NodeJS.ProcessEnv {
  const env = filteredShellEnv()
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
  const { tool, args, context, timeoutMs, maxOutputBytes } = req
  const cls = classify(tool, args)
  const startedAt = Date.now()

  const write = async (
    result: InfraRunResult,
    summary: string | undefined,
    decision: InfraDecision,
  ): Promise<void> => {
    await recordInfraAction({
      actor: req.actor,
      ...(req.sessionId !== undefined ? { sessionId: req.sessionId } : {}),
      ...(req.messageId !== undefined ? { messageId: req.messageId } : {}),
      surface: req.surface,
      tool: req.toolName,
      argv: [...args],
      context: {
        ...(context.profile !== undefined ? { profile: context.profile } : {}),
        ...(context.accountId !== undefined ? { accountId: context.accountId } : {}),
        ...(context.region !== undefined ? { region: context.region } : {}),
        ...(context.cluster !== undefined ? { cluster: context.cluster } : {}),
        ...(context.namespace !== undefined ? { namespace: context.namespace } : {}),
        ...(context.workspace !== undefined ? { workspace: context.workspace } : {}),
      },
      class: cls,
      decision,
      result: {
        ...(result.exitCode !== null ? { exitCode: result.exitCode } : {}),
        durationMs: result.durationMs,
        ...(summary !== undefined ? { summary } : {}),
      },
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
      execFile(
        bin,
        finalArgs,
        {
          env: infraEnv(),
          timeout: timeoutMs ?? DEFAULT_TIMEOUT_MS,
          maxBuffer: max * 4,
          windowsHide: true,
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
