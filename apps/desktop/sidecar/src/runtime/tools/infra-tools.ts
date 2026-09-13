// Tool hạ tầng của agent — ADR 0088 §4, task 0.12.
//
//   aws_profiles   — liệt kê profile có trên máy (tên · region · kind)   (không gate)
//   aws_cli        — chạy một lệnh AWS trong ĐÚNG account phiên đã ghim   (gated)
//   infra_context  — đọc ngữ cảnh đang ghim                              (chỉ đọc)
//
// VÌ SAO LÀ TOOL CHỨ KHÔNG PHẢI ENV. Tiêm `AWS_PROFILE` rồi để model gõ `Bash`
// chỉ tạo ra một *mặc định*: model vẫn viết được `aws --profile prod …` hay
// `AWS_PROFILE=prod aws …` và thoát khỏi account người dùng đã chọn. Tool có
// ghim mới là "chỉ định" — `args` là MẢNG nên không có shell (không `|`, `&&`,
// `$(…)`), và cờ ngữ cảnh do sidecar chèn ở `infra/run.ts`, ai tự mang cờ đó
// thì bị TỪ CHỐI trước lúc spawn.
//
// FILE NÀY KHÔNG SPAWN GÌ CẢ. Mọi thứ đi qua `runInfra()`: một chỗ chèn cờ, một
// chỗ từ chối cờ ghi đè, một chỗ ghi nhật ký. Ở đây chỉ còn ba việc — dựng ngữ
// cảnh, quyết định có được chạy không, và clamp output trước khi nó vào context
// của model.
//
// INVARIANT #1. Không đường nào ở đây chạm tới giá trị secret:
// `listAwsProfiles()` chỉ trả metadata, và tiến trình con tự resolve credential
// từ `~/.aws` qua TÊN profile. Không key nào đi vào tool arg, tool result, log
// hay nhật ký.
//
// Các hàm `run*` là lõi DÙNG CHUNG cho hai runtime: nhánh Pi dựng AgentTool ở
// cuối file, nhánh Claude SDK dựng server MCP in-process từ cùng những hàm này
// (claude-sdk/infra-sdk-server.ts) — logic quyết định + clamp nằm đúng một chỗ.

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { listAwsProfiles } from '../../infra/aws/profiles.js'
import { classify } from '../../infra/classify.js'
import { runInfra, type InfraContext } from '../../infra/run.js'
import { accountKindOf, decide, type InfraDecisionResult } from '../../infra/policy.js'
import { loadInfraPolicy } from '../../infra/policy-store.js'
import type { InfraDecision } from '../../infra/audit/store.js'
import { clampForLlm } from './output-budget.js'

// Tên server MCP mà nhánh Claude SDK dùng để bắc cầu nhóm tool này
// (`mcp__awoginfra__aws_cli`). Khai ở đây để `bridged.ts` DẪN XUẤT thay vì chép tay.
export const INFRA_MCP_SERVER = 'awoginfra'

export const AWS_PROFILES_TOOL_NAME = 'aws_profiles'
export const AWS_CLI_TOOL_NAME = 'aws_cli'
export const INFRA_CONTEXT_TOOL_NAME = 'infra_context'

export const INFRA_TOOL_NAMES = [
  AWS_PROFILES_TOOL_NAME,
  AWS_CLI_TOOL_NAME,
  INFRA_CONTEXT_TOOL_NAME,
] as const

// Output của `aws` là JSON không giới hạn (`describe-instances` trên một account
// thật dễ vài MB). `runInfra` đã chặn ở 256 KiB mỗi luồng — đó là hàng rào bộ
// nhớ; đây là hàng rào CONTEXT, cùng ngân sách với nhóm SSH.
const INFRA_MAX_TOTAL_CHARS = 64 * 1024

// Mọi chuỗi model ĐỌC, ở đúng một chỗ — nhánh Pi dựng schema TypeBox từ đây,
// nhánh Claude SDK dựng schema zod từ đây. Hai bản mô tả lệch nhau nghĩa là hai
// runtime dạy model hai luật khác nhau về cùng một tool.
export const INFRA_TOOL_TEXT = {
  awsProfiles: {
    description:
      'List the AWS profiles configured on this machine: name, default region, and credential ' +
      'kind (sso / assume-role / process / static). Names and metadata only — never keys or ' +
      'tokens. Use it to tell the user which accounts exist; you cannot switch to one yourself.',
  },
  awsCli: {
    description:
      'Run an AWS CLI command against the account pinned to this session. Pass the command as an ' +
      'ARRAY of arguments WITHOUT the leading "aws" — e.g. ["s3api","list-buckets"]. There is no ' +
      'shell: pipes, redirects, globs, quotes, && and $(…) are NOT interpreted, so build the ' +
      'arguments yourself. The account and region come from the session, so do NOT pass ' +
      '--profile, --region, --endpoint-url, --no-verify-ssl or any other flag that changes what ' +
      'the command targets — those calls are rejected. Ask the user to switch context instead.',
    args:
      'AWS CLI arguments without the leading "aws", one array element per argument ' +
      '(e.g. ["ec2","describe-instances","--max-items","20"]).',
  },
  infraContext: {
    description:
      'Show the infrastructure context pinned to this session: AWS profile, account id, region, ' +
      'and whether the account is marked production. Read-only — only the user can change it, ' +
      'from the context bar in the app.',
  },
} as const

// ─── Ngữ cảnh + danh tính người gọi ──────────────────────────────────────────

// Ngữ cảnh dùng thẳng `InfraContext` của `infra/run.ts` — cùng lý do mà
// `types/shared.ts` chỉ re-export nó cho `Session.infra`: một bản sao rút gọn ở
// đây là một bản sẽ lệch pha với thứ `runInfra()` thật sự chèn vào argv.

/**
 * Đủ để chạy MỘT lệnh và ghi đúng một dòng nhật ký. `profile` bắt buộc: chưa
 * ghim profile thì `aws_cli` không được advertise, nên tới được đây là đã có.
 */
export type AwsCliCall = {
  context: InfraContext & { profile: string }
  /** Bề mặt này có cổng quyền chạy trước không — xem CreateInfraToolsOptions.gated. */
  gated?: boolean | undefined
  /** Tên agent — nhật ký phải trả lời được "ai bảo chạy". */
  agentName?: string | undefined
  sessionId?: string | undefined
  messageId?: string | undefined
}

export interface CreateInfraToolsOptions {
  /**
   * Bề mặt gọi tool này CÓ cổng quyền chạy trước (`makeBeforeToolCall` park lượt
   * và hỏi người dùng) hay không. Chỉ phiên chat mới có.
   *
   * ⚠ audit #1 F4: bản đầu coi mọi lớp `ask` là "đã có người duyệt" vì cổng đã
   * park — đúng trên bề mặt chat, SAI ở task node: `makeTaskToolGate` là deny-only,
   * không có nhánh hạ tầng, nên lệnh lớp `ask` sẽ chạy KHÔNG ai duyệt và nhật ký
   * còn ghi `approved` — tức nói dối. Bề mặt không có cổng thì phải tự từ chối.
   */
  gated?: boolean | undefined
  /** Ngữ cảnh phiên đang ghim (task 0.8). Chưa ghim gì thì mọi trường vắng mặt. */
  context: InfraContext
  agentName?: string | undefined
  sessionId?: string | undefined
  messageId?: string | undefined
}

// `actor` của nhật ký là chuỗi có CẤU TRÚC (`agent:[A-Za-z0-9._-]{1,64}`, ép
// bằng schema). Tên agent là dữ liệu người dùng đặt — "Code Reviewer", tiếng
// Việt có dấu — nên phải nắn trước, không thì `recordInfraAction` ném và làm
// hỏng cả lượt chỉ vì một cái tên có dấu cách.
function actorOf(agentName: string | undefined): string {
  const slug = (agentName ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  // Phiên chat không gắn agent nào vẫn là model chạy lệnh — `assistant` nói đúng
  // điều đó, còn `unknown` thì gợi ý là ta đã đánh mất thông tin.
  return `agent:${slug.slice(0, 64) || 'assistant'}`
}

/**
 * Ma trận quyền đã quyết gì, dưới dạng nhật ký ghi được.
 *
 * `ask` ⇒ `approved`: cổng quyền (`runtime/permission.ts`, task 0.7) chạy TRƯỚC
 * `execute` và park lời gọi cho tới khi người dùng bấm — tới được đây nghĩa là
 * đã có người duyệt. Phân biệt `auto` với `approved` chính là để trả lời được
 * "app tự chạy hay tôi đã đồng ý" khi đọc lại nhật ký.
 */
function auditDecisionOf(decision: InfraDecisionResult): InfraDecision {
  if (decision.reason === 'bypass') return 'bypass-temp'
  return decision.mode === 'auto' ? 'auto' : 'approved'
}

// ─── Lõi dùng chung cho hai runtime ──────────────────────────────────────────

/**
 * Liệt kê profile. KHÔNG gate: chỉ có tên + metadata, không giá trị secret nào.
 * `pinned` là profile phiên đang ghim, đánh dấu để model khỏi phải đoán.
 */
export async function runAwsProfiles(pinned?: string | undefined): Promise<{ text: string }> {
  const profiles = await listAwsProfiles()
  if (profiles.length === 0) {
    return {
      text:
        'No AWS profiles found in ~/.aws/config or ~/.aws/credentials. Ask the user to add an ' +
        'account in AWOG (Settings → Infrastructure) or with `aws configure`.',
    }
  }
  const lines = profiles.map((p) => {
    const mark = pinned && p.name === pinned ? '  ← pinned to this session' : ''
    return `${p.name}  —  region ${p.region ?? 'not set'}  ·  ${p.kind}${mark}`
  })
  const clamped = clampForLlm(lines, {
    maxTotalChars: INFRA_MAX_TOTAL_CHARS,
    hint: 'ask the user which account they mean',
  })
  return { text: clamped.text }
}

/** Đọc ngữ cảnh đang ghim. Đổi ngữ cảnh là việc của NGƯỜI dùng (ADR 0088 §7). */
export async function runInfraContext(context: InfraContext): Promise<{ text: string }> {
  if (!context.profile) {
    return {
      text:
        'No infrastructure context is pinned to this session, so infra commands are unavailable. ' +
        'Ask the user to pick an AWS account in the context bar before doing infra work.',
    }
  }
  // "Account này có phải production không" là câu người dùng trả lời ở Settings,
  // nên phải đọc đúng chính sách trên đĩa — `defaultPolicy()` có danh sách
  // production RỖNG, tức mọi account sẽ hiện là thường.
  const kind = accountKindOf(await loadInfraPolicy(), context.accountId)
  const lines = [
    `AWS profile: ${context.profile}`,
    `Account id: ${context.accountId ?? 'unknown'}`,
    `Region: ${context.region ?? 'not set (the CLI falls back to the profile default)'}`,
    `Account kind: ${kind === 'production' ? 'PRODUCTION — treat every change as high risk' : 'normal'}`,
    'This context is pinned by the user and applies to every infra command you run. You cannot ' +
      'change it; ask the user to switch accounts in the context bar.',
  ]
  return { text: lines.join('\n') }
}

/**
 * Chạy một lệnh AWS trong ngữ cảnh của phiên.
 *
 * KHÔNG ném khi lệnh hỏng — exit code khác 0 là thông tin model cần đọc, không
 * phải tool crash. Chỉ hai đường trả về "không chạy": ma trận quyền CHẶN, hoặc
 * `runInfra` từ chối (cờ ghi đè / thiếu binary), và cả hai đều nói rõ vì sao.
 */
export async function runAwsCli(
  args: readonly string[],
  call: AwsCliCall,
): Promise<{ text: string; ok: boolean; exitCode: number | null }> {
  // Fail fast ở biên: `args` rỗng chạy được, nhưng chỉ để nhận về nguyên trang
  // usage của AWS CLI — một câu nói thẳng rẻ hơn cho context của model.
  if (args.length === 0) {
    return {
      ok: false,
      exitCode: null,
      text: 'Pass at least one argument, e.g. ["s3api","list-buckets"]. The leading "aws" is added for you.',
    }
  }

  const cls = classify('aws', args)
  // CÙNG một nguồn chính sách với cổng quyền (`permission.ts` cũng gọi
  // `loadInfraPolicy()`), không phải `defaultPolicy()`: hai nguồn thì một lệnh
  // người dùng vừa duyệt ở cổng có thể bị chặn lại ở đây — đúng cái lỗi "hai
  // nguồn sự thật về quyền hạ tầng" mà ADR 0088 §6 cấm.
  const decision = decide({
    policy: await loadInfraPolicy(),
    class: cls,
    accountId: call.context.accountId,
  })

  // Chặn = hiện lệnh cho NGƯỜI tự chạy, không phải im lặng bỏ qua. Ở đường chạy
  // thật, cổng quyền đã chặn từ trước — nhánh này là phòng thủ chiều sâu cho bề
  // mặt nào gọi lõi mà không đi qua cổng. Không ghi nhật ký ở đây: nhật ký
  // thuộc về `infra.run` (ADR 0088, task 0.6), và lệnh này chưa từng chạy.
  if (decision.mode === 'block') {
    return {
      ok: false,
      exitCode: null,
      text:
        `Blocked by the infrastructure permission matrix: ${cls} commands are not allowed on ` +
        `${decision.accountKind} accounts (Settings → Infrastructure). Show the user the exact ` +
        `command so they can run it themselves, or ask them to relax the matrix.`,
    }
  }

  // Lớp `ask` trên bề mặt KHÔNG có cổng quyền (task node, playbook runner) ⇒ từ
  // chối. Đây là audit #1 F4: chạy tiếp ở đó nghĩa là lệnh chạy không ai duyệt,
  // và `auditDecisionOf` sẽ ghi `approved` — nhật ký nói dối còn tệ hơn không ghi.
  if (decision.mode === 'ask' && call.gated !== true) {
    return {
      ok: false,
      exitCode: null,
      text:
        `This ${cls} command needs a human to approve it, and this surface has no approval ` +
        `prompt. Ask the user to run it from a chat session, or relax the matrix in ` +
        `Settings → Infrastructure.`,
    }
  }

  const result = await runInfra({
    tool: 'aws',
    args,
    context: call.context,
    actor: actorOf(call.agentName),
    surface: 'session',
    toolName: AWS_CLI_TOOL_NAME,
    decision: auditDecisionOf(decision),
    sessionId: call.sessionId,
    messageId: call.messageId,
  })

  // Hỏng thì `stderr` mới là thứ đáng đọc; hỏng mà stderr rỗng (lệnh chỉ trả
  // exit code) thì vẫn đưa stdout ra chứ không trả về rỗng.
  const body = result.ok ? result.stdout : result.stderr || result.stdout
  const clamped = clampForLlm(body ? body.split('\n') : [], {
    maxTotalChars: INFRA_MAX_TOTAL_CHARS,
    hint: 'narrow the command with --query, --max-items or a more specific resource id',
  })
  const text = clamped.text || '(no output)'
  const tail = result.ok ? '' : `\n[aws exited ${result.exitCode ?? 'without a code'}]`
  return { ok: result.ok, exitCode: result.exitCode, text: `${text}${tail}` }
}

// ─── Nhánh Pi: AgentTool ─────────────────────────────────────────────────────

const ProfilesParams = Type.Object({})
const ContextParams = Type.Object({})
const AwsCliParams = Type.Object({
  args: Type.Array(Type.String(), { description: INFRA_TOOL_TEXT.awsCli.args }),
})

interface AwsCliDetails {
  args: string[]
  exitCode: number | null
}

/**
 * Nhóm tool hạ tầng cho một lượt.
 *
 * `aws_cli` CHỈ có mặt khi phiên đã ghim profile — cùng luật với nhóm SSH (không
 * có host thì không advertise): quảng cáo một tool không chạy được chỉ tốn của
 * model một lượt gọi để phát hiện ra điều đó. `aws_profiles` + `infra_context`
 * thì luôn có, vì đúng lúc chưa ghim gì mới cần chúng để nói cho người dùng biết
 * họ đang thiếu bước nào.
 */
export function createInfraTools(opts: CreateInfraToolsOptions): AgentTool[] {
  const gated = opts.gated === true
  const { context } = opts

  const profilesTool: AgentTool<typeof ProfilesParams, Record<string, never>> = {
    name: AWS_PROFILES_TOOL_NAME,
    label: 'AWS profiles',
    description: INFRA_TOOL_TEXT.awsProfiles.description,
    parameters: ProfilesParams,
    executionMode: 'sequential',
    async execute(): Promise<AgentToolResult<Record<string, never>>> {
      const { text } = await runAwsProfiles(context.profile)
      return { content: [{ type: 'text', text }], details: {} }
    },
  }

  const contextTool: AgentTool<typeof ContextParams, Record<string, never>> = {
    name: INFRA_CONTEXT_TOOL_NAME,
    label: 'Infra context',
    description: INFRA_TOOL_TEXT.infraContext.description,
    parameters: ContextParams,
    executionMode: 'sequential',
    async execute(): Promise<AgentToolResult<Record<string, never>>> {
      const { text } = await runInfraContext(context)
      return { content: [{ type: 'text', text }], details: {} }
    },
  }

  const tools: AgentTool[] = [profilesTool as AgentTool, contextTool as AgentTool]

  const profile = context.profile
  if (!profile) return tools

  const awsTool: AgentTool<typeof AwsCliParams, AwsCliDetails> = {
    name: AWS_CLI_TOOL_NAME,
    label: 'AWS CLI',
    description: INFRA_TOOL_TEXT.awsCli.description,
    parameters: AwsCliParams,
    // Tuần tự: một lệnh hạ tầng có thể park chờ người duyệt, và hai prompt duyệt
    // xen nhau thì người dùng không còn biết mình đang duyệt lệnh nào.
    executionMode: 'sequential',
    async execute(_id, params): Promise<AgentToolResult<AwsCliDetails>> {
      const { text, exitCode } = await runAwsCli(params.args, {
        context: { ...context, profile },
        gated,
        agentName: opts.agentName,
        sessionId: opts.sessionId,
        messageId: opts.messageId,
      })
      return { content: [{ type: 'text', text }], details: { args: [...params.args], exitCode } }
    },
  }
  tools.push(awsTool as AgentTool)
  return tools
}
