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
import { classify, sensitiveReadOf } from '../../infra/classify.js'
import { runInfra, type InfraContext } from '../../infra/run.js'
import type { InfraTool } from '../../infra/types.js'
import { accountKindOf, decide, type InfraDecisionResult } from '../../infra/policy.js'
import { loadInfraPolicy } from '../../infra/policy-store.js'
import type { InfraDecision } from '../../infra/audit/store.js'
import { clampForLlm } from './output-budget.js'
import { buildArgs, listKeysOf, type InfraRow } from '../../infra/resources/spec.js'
import { allDescriptors, viewById } from '../../infra/resources/registry.js'
import {
  checkQueryString,
  checkWindow,
  estimateScan,
  getInsightsResults,
  insightsCostUsd,
  MAX_LOG_GROUPS,
  MAX_ROWS,
  startInsightsQuery,
  tailWindow,
  type InsightsRow,
} from '../../infra/aws/logs.js'
import { lastBytesFor, recordRun } from '../../infra/logs/library.js'

// Tên server MCP mà nhánh Claude SDK dùng để bắc cầu nhóm tool này
// (`mcp__awoginfra__aws_cli`). Khai ở đây để `bridged.ts` DẪN XUẤT thay vì chép tay.
export const INFRA_MCP_SERVER = 'awoginfra'

export const AWS_PROFILES_TOOL_NAME = 'aws_profiles'
export const AWS_CLI_TOOL_NAME = 'aws_cli'
export const KUBECTL_CLI_TOOL_NAME = 'kubectl_cli'
export const TF_CLI_TOOL_NAME = 'tf_cli'
export const INFRA_CONTEXT_TOOL_NAME = 'infra_context'
export const LOGS_QUERY_TOOL_NAME = 'logs_query'
export const LOGS_TAIL_TOOL_NAME = 'logs_tail_window'
// Mốc 3 việc 3.10 — agent đọc và lái được chính các VIEW mà màn Explorer đang hiện.
export const INFRA_VIEW_TOOL_NAME = 'infra_view'
export const INFRA_ACTION_TOOL_NAME = 'infra_action'

export const INFRA_TOOL_NAMES = [
  AWS_PROFILES_TOOL_NAME,
  AWS_CLI_TOOL_NAME,
  KUBECTL_CLI_TOOL_NAME,
  TF_CLI_TOOL_NAME,
  INFRA_CONTEXT_TOOL_NAME,
  LOGS_QUERY_TOOL_NAME,
  LOGS_TAIL_TOOL_NAME,
  INFRA_VIEW_TOOL_NAME,
  INFRA_ACTION_TOOL_NAME,
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
  kubectlCli: {
    description:
      'Run a kubectl command against the Kubernetes context pinned to this session. Pass the ' +
      'command as an ARRAY of arguments WITHOUT the leading "kubectl" — e.g. ' +
      '["get","pods","-A"]. There is no shell: pipes, redirects, quotes and $(…) are NOT ' +
      'interpreted. The context and namespace come from the session, so do NOT pass --context, ' +
      '--namespace, -n, --server or --kubeconfig — those calls are rejected. Read verbs are ' +
      '["get","describe","logs","events","top","explain","api-resources"]; anything else asks ' +
      'the user first. Ask the user to switch context instead of switching it yourself.',
    args:
      'kubectl arguments without the leading "kubectl", one array element per argument ' +
      '(e.g. ["get","pods","-o","wide"]).',
  },
  tfCli: {
    description:
      'Run a terraform command in the directory pinned to this session. Pass the command as an ' +
      'ARRAY of arguments WITHOUT the leading "terraform" — e.g. ["state","list"]. There is no ' +
      'shell. The directory comes from the session (`-chdir=` is inserted for you and ' +
      '`-chdir` inside args is rejected), so do NOT try to point it at another stack. Read ' +
      'verbs: validate, fmt -check, state list, state show, output, version. `plan`/`init` ask ' +
      'the user first; apply, destroy, import and state rm are blocked by default on ' +
      'production — show the user the command instead of trying to run it.',
    args:
      'terraform arguments without the leading "terraform", one array element per argument ' +
      '(e.g. ["state","show","aws_s3_bucket.web"]).',
  },
  infraContext: {
    description:
      'Show the infrastructure context pinned to this session: AWS profile/account/region, ' +
      'Kubernetes context/namespace, Terraform directory. Read-only — only the user can change ' +
      'it, from the context bar in the app.',
  },
  // ⚠ HAI TOOL DƯỚI ĐÂY TỐN TIỀN. CloudWatch Logs Insights tính theo GB quét, nên
  // chúng là lớp `write` (ma trận ⇒ luôn `ask`) và mô tả phải nói thẳng điều đó:
  // model dùng chúng như một cách TIỆN thay vì gọi `aws_cli logs filter-log-events`,
  // không phải như một cách rẻ.
  logsQuery: {
    description:
      'Run a CloudWatch Logs Insights query and return the rows. BILLABLE: CloudWatch charges ' +
      'per GB scanned, so always prefer the narrowest log group set, the shortest time window, ' +
      'and a `limit`. Returns how much was actually scanned. Requires the user to approve the ' +
      'call. Query syntax is the Insights one: "fields @timestamp, @message | filter … | ' +
      'sort @timestamp desc | limit 50".',
    args: 'Log group names, the Insights query string, and a start/end time.',
    startTime:
      'Start of the window: an ISO 8601 timestamp ("2026-09-13T09:00:00Z") or epoch seconds.',
    endTime:
      'End of the window: an ISO 8601 timestamp or epoch seconds. Newer than start. The window ' +
      'may not exceed 30 days.',
    limit: 'Maximum rows to return (1–1000, default 100).',
  },
  // ⚠ VÌ SAO CÓ `infra_view` KHI ĐÃ CÓ `aws_cli`. Hai cái KHÔNG thay nhau được.
  // `aws_cli` là đường thoát hiểm: model tự viết lệnh, tự đọc JSON thô, và tự
  // đoán xem trường nào là trường nào. `infra_view` trả về ĐÚNG những cột mà
  // người dùng đang thấy trên màn Explorer — nên câu "máy nào đang tắt" có cùng
  // một câu trả lời ở cả hai phía, và một view mới được thêm vào `resources/`
  // là agent biết dùng ngay mà không phải học lại tên trường JSON của dịch vụ đó.
  infraView: {
    description:
      'List the resources of one Explorer view and return the SAME columns the user sees on ' +
      'the Explorer screen. Use it instead of hand-writing `aws_cli` list/describe calls when ' +
      'the question is about a resource type Explorer has a view for (S3 buckets/objects, EC2 ' +
      'instances, Lambda, RDS, DynamoDB, SQS, SNS, ECR, Secrets, CloudFormation, Route53, ECS). ' +
      'Results are paged by the CLI token: pass `token` back to get the next page.',
    args: 'The view id, plus any values the view requires (e.g. bucket for s3.objects).',
    token: 'Pagination token from a previous call; omit for the first page.',
  },
  infraAction: {
    description:
      'Run a day-2 action on one resource, using the action ids Explorer declares (ec2.start, ' +
      'ec2.stop, ec2.reboot, ec2.terminate, s3.deleteObject). Replaces hand-written ' +
      '`aws_cli` write calls so the action name in the audit log is the one the user saw on ' +
      'screen. Destructive actions ask the user first and are blocked by default on production.',
    args: 'The view id, the action id, and the row (the resource you acted on).',
    row: 'The row object as returned by infra_view — it carries the ids the action needs.',
    values: 'Extra form values for actions that need them (e.g. an object key for presign).',
  },
  logsTail: {
    description:
      'Read the most recent CloudWatch log events in a short window — the cheap first look ' +
      'before writing an Insights query. BILLABLE (charged per GB scanned), needs the user to ' +
      'approve, and returns raw log lines, so keep the window short and the result set small.',
    args: 'Log group names plus how many minutes back to look.',
    minutes: 'How far back from now to read, in minutes (1–1440, default 15).',
    filterPattern:
      'Optional CloudWatch filter pattern, e.g. "?ERROR ?Exception". Empty reads every line.',
    limit: 'Maximum events to return (1–1000, default 100).',
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
  const pinned: string[] = []
  const available: string[] = []

  if (context.profile) {
    // "Account này có phải production không" là câu người dùng trả lời ở Settings,
    // nên phải đọc đúng chính sách trên đĩa — `defaultPolicy()` có danh sách
    // production RỖNG, tức mọi account sẽ hiện là thường.
    const kind = accountKindOf(await loadInfraPolicy(), context.accountId)
    pinned.push(
      `AWS profile: ${context.profile}`,
      `Account id: ${context.accountId ?? 'unknown'}`,
      `Region: ${context.region ?? 'not set (the CLI falls back to the profile default)'}`,
      `Account kind: ${
        kind === 'production' ? 'PRODUCTION — treat every change as high risk' : 'normal'
      }`,
    )
    available.push('aws_cli')
  } else {
    available.push('(no AWS account pinned — aws_cli is unavailable)')
  }

  if (context.cluster) {
    const kind = accountKindOf(await loadInfraPolicy(), undefined)
    pinned.push(
      `Kubernetes context: ${context.cluster}`,
      `Namespace: ${context.namespace ?? 'not set (kubectl uses the context default)'}`,
      // kubectl không có account id, nên cột production của ma trận luôn áp: lệnh
      // ghi phải hỏi, lệnh phá huỷ bị chặn. Nói ra để model không hứa hão.
      `Target kind: ${kind === 'production' ? 'treated as PRODUCTION (no account id to compare)' : 'normal'}`,
    )
    available.push('kubectl_cli')
  } else {
    available.push('(no Kubernetes context pinned — kubectl_cli is unavailable)')
  }

  if (context.workspace) {
    pinned.push(`Terraform directory: ${context.workspace}`)
    available.push('tf_cli')
  } else {
    available.push('(no Terraform directory pinned — tf_cli is unavailable)')
  }

  const head =
    pinned.length > 0
      ? ['Infrastructure context pinned to this session:']
      : [
          'No infrastructure context is pinned to this session, so infra commands are ' +
            'unavailable. Ask the user to pick one in the context bar before doing infra work.',
        ]

  return {
    text: [
      ...head,
      ...pinned.map((l) => `- ${l}`),
      `Tools available: ${available.join(' · ')}`,
      'This context is pinned by the user and applies to every infra command you run. You cannot ' +
        'change it; ask the user to switch it in the context bar.',
    ].join('\n'),
  }
}

/** Đủ để chạy MỘT lệnh hạ tầng và ghi đúng một dòng nhật ký. */
export type CliCall = {
  context: InfraContext
  gated?: boolean | undefined
  agentName?: string | undefined
  sessionId?: string | undefined
  messageId?: string | undefined
}

export type CliRunResult = { text: string; ok: boolean; exitCode: number | null }

type CliSpec = {
  /** Tên tool AWOG — cũng là `toolName` trong nhật ký, không phải tên binary. */
  toolName: string
  /** Câu trả về khi model gọi với mảng rỗng. */
  emptyArgs: string
  /** Gợi ý khi output vượt ngân sách context. */
  clampHint: string
  /** Nhãn trong dòng "đã thoát với mã …" (aws · kubectl · terraform). */
  label: string
}

/**
 * Lõi DÙNG CHUNG của `aws_cli` / `kubectl_cli` / `tf_cli`.
 *
 * Ba tool chỉ khác nhau ở nhãn, ngân sách và câu nhắc — còn bốn bước quyết định
 * (classify → decide → gate → runInfra → clamp) phải GIỐNG NHAU TUYỆT ĐỐI. Viết
 * ba bản sao là mở đường cho một bản quên `decide()` hoặc quên `sensitiveReadOf()`,
 * và đó là loại lỗi không ai thấy khi đọc diff.
 *
 * KHÔNG ném khi lệnh hỏng — exit code khác 0 là thông tin model cần đọc, không
 * phải tool crash. Chỉ hai đường trả về "không chạy": ma trận quyền CHẶN, hoặc
 * `runInfra` từ chối (cờ ghi đè / thiếu binary), và cả hai đều nói rõ vì sao.
 */
async function runPinnedCli(
  tool: InfraTool,
  args: readonly string[],
  call: CliCall,
  spec: CliSpec,
): Promise<CliRunResult> {
  // Fail fast ở biên: `args` rỗng chạy được, nhưng chỉ để nhận về nguyên trang
  // usage của CLI — một câu nói thẳng rẻ hơn cho context của model.
  if (args.length === 0) {
    return { ok: false, exitCode: null, text: spec.emptyArgs }
  }

  const cls = classify(tool, args)
  // Lệnh đọc trả NỘI DUNG log (`aws logs get-query-results`, `kubectl logs`, …) bị
  // siết lên `ask` ở production — cùng nguồn với cổng quyền (`permission.ts`).
  const sensitive = sensitiveReadOf(tool, args)
  // `accountId` CHỈ có nghĩa với AWS. `accountKindOf()` biến vắng-mặt thành
  // `production` (audit #1 F6), và với kubectl/terraform đó là chiều ĐÚNG: ma
  // trận chưa có khái niệm "cluster/workspace production", nên lệnh ghi của hai
  // công cụ này luôn phải hỏi, còn lệnh phá huỷ luôn bị chặn cho tới khi người
  // dùng tự nới ô tương ứng. Truyền accountId của AWS vào đây sẽ là lỗi theo
  // chiều ngược lại: một session ghim account AWS dev sẽ hạ nhầm một cluster
  // production của kubectl xuống `normal`.
  const decision = decide({
    policy: await loadInfraPolicy(),
    class: cls,
    accountId: tool === 'aws' ? call.context.accountId : undefined,
    ...(sensitive !== null ? { sensitiveRead: sensitive } : {}),
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
        `${decision.accountKind} targets (Settings → Infrastructure). Show the user the exact ` +
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
    tool,
    args,
    context: call.context,
    actor: actorOf(call.agentName),
    surface: 'session',
    toolName: spec.toolName,
    decision: auditDecisionOf(decision),
    sessionId: call.sessionId,
    messageId: call.messageId,
  })

  // Hỏng thì `stderr` mới là thứ đáng đọc; hỏng mà stderr rỗng (lệnh chỉ trả
  // exit code) thì vẫn đưa stdout ra chứ không trả về rỗng.
  const body = result.ok ? result.stdout : result.stderr || result.stdout
  const clamped = clampForLlm(body ? body.split('\n') : [], {
    maxTotalChars: INFRA_MAX_TOTAL_CHARS,
    hint: spec.clampHint,
  })
  const text = clamped.text || '(no output)'
  const tail = result.ok ? '' : `\n[${spec.label} exited ${result.exitCode ?? 'without a code'}]`
  return { ok: result.ok, exitCode: result.exitCode, text: `${text}${tail}` }
}

/**
 * Chạy một lệnh AWS trong ngữ cảnh của phiên.
 */
export async function runAwsCli(
  args: readonly string[],
  call: AwsCliCall,
): Promise<CliRunResult> {
  return runPinnedCli('aws', args, call, {
    toolName: AWS_CLI_TOOL_NAME,
    emptyArgs:
      'Pass at least one argument, e.g. ["s3api","list-buckets"]. The leading "aws" is added for you.',
    clampHint: 'narrow the command with --query, --max-items or a more specific resource id',
    label: 'aws',
  })
}

/**
 * Chạy một lệnh kubectl trong ĐÚNG context + namespace phiên đã ghim.
 *
 * Không có `--kubeconfig`/`--context`/`--namespace` trong args: cả ba bị
 * `infra.run.ts` từ chối trước lúc spawn, nên "đang trỏ vào cluster nào" là thứ
 * model không đổi được.
 */
export async function runKubectlCli(
  args: readonly string[],
  call: CliCall,
): Promise<CliRunResult> {
  return runPinnedCli('kubectl', args, call, {
    toolName: KUBECTL_CLI_TOOL_NAME,
    emptyArgs:
      'Pass at least one argument, e.g. ["get","pods","-A"]. The leading "kubectl" is added for you.',
    clampHint: 'narrow the command with -l <selector>, --field-selector or a single namespace',
    label: 'kubectl',
  })
}

/**
 * Chạy một lệnh terraform trong ĐÚNG thư mục phiên đã ghim.
 *
 * Thư mục đi vào bằng `-chdir=<đường dẫn tuyệt đối>` do sidecar chèn; model
 * không truyền được `-chdir` (bị từ chối) nên nó không tự đổi sang stack khác.
 * `apply`/`destroy`/`import`/`state rm` là lớp `destructive` ⇒ bị chặn ở mặc định
 * production của ma trận; người dùng nới được, và khi đó chúng vẫn phải qua cổng
 * duyệt từng lần.
 */
export async function runTfCli(args: readonly string[], call: CliCall): Promise<CliRunResult> {
  return runPinnedCli('terraform', args, call, {
    toolName: TF_CLI_TOOL_NAME,
    emptyArgs:
      'Pass at least one argument, e.g. ["validate"] or ["state","list"]. The leading "terraform" is added for you.',
    clampHint: 'narrow the command: `state list` then `state show <address>`, or `output <name>`',
    label: 'terraform',
  })
}

// ─── Tool log của agent (Mốc 2 việc 2.9) ─────────────────────────────────────
//
// VÌ SAO HAI TOOL RIÊNG thay vì để model gọi `aws_cli logs start-query`:
//   1. `aws_cli` trả về nguyên JSON của CLI — model phải tự bóc `queryId`, tự
//      poll, tự cộng `bytesScanned`. Việc đó tốn 3-5 lượt gọi cho MỘT câu hỏi, và
//      mỗi lượt là một dòng nhật ký.
//   2. Ước lượng GB phải chạy TRƯỚC khi tiêu tiền. `aws_cli` không có chỗ nào để
//      chèn bước đó; ở đây thì có, và nhật ký nhận được `estimatedUsd`.
//   3. Kết quả Insights là mảng cặp field/value, không phải bảng — bóc sẵn ở đây
//      rẻ hơn nhiều so với bắt model tự làm, và tránh được việc model bịa tên cột.
//
// Trần thời gian chờ: tool KHÔNG trả về trước khi truy vấn xong (trừ khi quá trần)
// vì model không làm được gì với một `queryId` trần. Trần dưới đây để một truy vấn
// quét nhầm log group khổng lồ không treo cả lượt.
const LOGS_TOOL_WAIT_MS = 45_000
const LOGS_TOOL_POLL_MS = 1_500

export type LogsCall = {
  context: InfraContext
  gated?: boolean | undefined
  agentName?: string | undefined
  sessionId?: string | undefined
  messageId?: string | undefined
}

export type LogsQueryArgs = {
  logGroups: string[]
  query: string
  startTime: string | number
  endTime: string | number
  limit?: number | undefined
}

export type LogsTailArgs = {
  logGroups: string[]
  minutes?: number | undefined
  filterPattern?: string | undefined
  limit?: number | undefined
}

/**
 * Nhận ISO 8601 hoặc epoch GIÂY (số, hoặc chuỗi toàn chữ số). Trả `null` khi
 * không đọc được — cố ý KHÔNG đoán: một cửa sổ thời gian đoán sai nghĩa là quét
 * nhầm dữ liệu và tính tiền cho nó.
 */
export function parseTimeArg(value: string | number): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null
    // Epoch giây (~1.7e9) hay mili-giây (~1.7e12)? Ngưỡng 1e11 nằm giữa hai
    // khoảng thật và không thể chạm tới bởi một mốc thời gian hợp lý nào.
    return value > 1e11 ? Math.floor(value) : Math.floor(value * 1000)
  }
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed)
    return n > 1e11 ? n : n * 1000
  }
  const parsed = Date.parse(trimmed)
  return Number.isNaN(parsed) ? null : parsed
}

/** Bảng kết quả ở dạng model đọc được: một dòng tiêu đề, một dòng mỗi bản ghi. */
function formatInsightsRows(rows: readonly InsightsRow[], maxChars: number): string {
  if (rows.length === 0) return '(no rows)'
  // Thứ tự cột lấy từ dòng ĐẦU rồi bổ sung cột mới gặp ở các dòng sau: Insights
  // không đảm bảo mọi dòng có cùng tập trường (`parse` có thể sinh trường mới).
  const columns: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key)
  }
  const lines = [columns.join('\t')]
  for (const row of rows) lines.push(columns.map((c) => row[c] ?? '').join('\t'))
  return clampForLlm(lines, {
    maxTotalChars: maxChars,
    hint: 'add a `limit`, tighten the time window, or filter more aggressively',
  }).text
}

/**
 * Chạy một câu Insights cho agent. Ước lượng GB TRƯỚC, chạy sau, rồi ghi số đo
 * vào lịch sử thư viện để lần sau ước lượng bằng số thật.
 */
export async function runLogsQuery(
  args: LogsQueryArgs,
  call: LogsCall,
): Promise<{ text: string; ok: boolean }> {
  const profile = call.context.profile
  if (!profile) {
    return { ok: false, text: 'No AWS account is pinned to this session, so log queries are unavailable. Ask the user to pick an account in the context bar.' }
  }
  if (args.logGroups.length === 0 || args.logGroups.length > MAX_LOG_GROUPS) {
    return { ok: false, text: `Pass between 1 and ${String(MAX_LOG_GROUPS)} log group names.` }
  }
  const queryCheck = checkQueryString(args.query)
  if (!queryCheck.ok) return { ok: false, text: `The query was rejected (${queryCheck.error}).` }

  const startMs = parseTimeArg(args.startTime)
  const endMs = parseTimeArg(args.endTime)
  if (startMs === null || endMs === null) {
    return { ok: false, text: 'startTime/endTime must be ISO 8601 timestamps or epoch seconds.' }
  }
  const window = checkWindow(startMs, endMs)
  if (!window.ok) return { ok: false, text: `The time window was rejected (${window.error}).` }

  const ctx = {
    profile,
    ...(call.context.region ? { region: call.context.region } : {}),
    surface: 'session' as const,
    actor: actorOf(call.agentName),
  }

  // ── Ước lượng TRƯỚC khi hỏi quyền: con số này là thứ người dùng cần thấy khi
  // quyết định, và nó rẻ (một `describe-log-groups` chỉ đọc metadata).
  const historyBytes = await lastBytesFor(args.query.trim())
  const estimate = await estimateScan({
    logGroups: args.logGroups,
    ...(historyBytes !== undefined ? { historyBytes } : {}),
    ...ctx,
  })
  if (!estimate.ok) return { ok: false, text: `Could not estimate the scan cost (${estimate.error}).` }

  const cls = classify('aws', ['logs', 'start-query'])
  const decision = decide({
    policy: await loadInfraPolicy(),
    class: cls,
    ...(call.context.accountId ? { accountId: call.context.accountId } : {}),
  })
  const costLine =
    `Estimated scan: ${formatBytes(estimate.value.bytes)} (~$${estimate.value.usd.toFixed(4)})` +
    `, basis: ${estimate.value.basis === 'history' ? 'measured on a previous identical query' : 'upper bound (total stored bytes)'}.`

  if (decision.mode === 'block') {
    return {
      ok: false,
      text: `Blocked by the infrastructure permission matrix on ${decision.accountKind} accounts. ${costLine} Tell the user, and let them run it from the Logs screen (Settings → Infrastructure to relax the matrix).`,
    }
  }
  if (decision.mode === 'ask' && call.gated !== true) {
    return {
      ok: false,
      text: `This needs a human to approve it and this surface has no approval prompt. ${costLine} Ask the user to run the query from the Logs screen, or approve it in a chat session.`,
    }
  }

  const started = await startInsightsQuery({
    logGroups: args.logGroups,
    query: args.query,
    startMs,
    endMs,
    ...(args.limit !== undefined ? { limit: Math.min(args.limit, MAX_ROWS) } : {}),
    estimatedUsd: estimate.value.usd,
    ...ctx,
  })
  if (!started.ok) return { ok: false, text: `The query could not be started: ${started.error}` }
  const queryId = started.value.queryId

  const deadline = Date.now() + LOGS_TOOL_WAIT_MS
  let poll = await getInsightsResults({ queryId, ...ctx })
  while (poll.ok && !isTerminal(poll.value.status) && Date.now() < deadline) {
    await sleep(LOGS_TOOL_POLL_MS)
    poll = await getInsightsResults({ queryId, ...ctx })
  }
  if (!poll.ok) return { ok: false, text: `The query failed: ${poll.error}` }

  await recordRun({
    query: args.query.trim(),
    logGroups: args.logGroups,
    windowSeconds: Math.max(1, Math.round((endMs - startMs) / 1000)),
    bytesScanned: poll.value.bytesScanned,
    estimatedUsd: estimate.value.usd,
    recordsMatched: poll.value.recordsMatched,
    status: poll.value.status,
  })

  if (!isTerminal(poll.value.status)) {
    return {
      ok: false,
      text: `The query is still running after ${String(LOGS_TOOL_WAIT_MS / 1000)}s (status ${poll.value.status}). ${costLine} Ask the user to open the Logs screen to see it finish.`,
    }
  }

  const scanned = formatBytes(poll.value.bytesScanned)
  const actualUsd = insightsCostUsd(poll.value.bytesScanned)
  const header =
    `status ${poll.value.status} · ${String(poll.value.rows.length)} rows · scanned ${scanned} (~$${actualUsd.toFixed(4)})` +
    ` · matched ${String(poll.value.recordsMatched)}`
  return { ok: true, text: `${header}\n${formatInsightsRows(poll.value.rows, INFRA_MAX_TOTAL_CHARS)}` }
}

/** Cửa sổ gần nhất — đường RẺ để nhìn log trước khi viết một câu Insights. */
export async function runLogsTail(
  args: LogsTailArgs,
  call: LogsCall,
): Promise<{ text: string; ok: boolean }> {
  const profile = call.context.profile
  if (!profile) {
    return { ok: false, text: 'No AWS account is pinned to this session, so log reads are unavailable.' }
  }
  if (args.logGroups.length === 0 || args.logGroups.length > MAX_LOG_GROUPS) {
    return { ok: false, text: `Pass between 1 and ${String(MAX_LOG_GROUPS)} log group names.` }
  }
  const minutes = Math.min(Math.max(args.minutes ?? 15, 1), 1440)
  const endMs = Date.now()
  const startMs = endMs - minutes * 60_000

  const ctx = {
    profile,
    ...(call.context.region ? { region: call.context.region } : {}),
    surface: 'session' as const,
    actor: actorOf(call.agentName),
  }

  // `filter-log-events` là lớp `read` nhưng TRẢ NỘI DUNG log ⇒ trên production
  // `decide()` siết lên `ask` (xem `sensitiveReadOf`). Kiểm ở đây để bề mặt nào
  // không có cổng duyệt cũng không lặng lẽ kéo log production vào context model.
  const decision = decide({
    policy: await loadInfraPolicy(),
    class: classify('aws', ['logs', 'filter-log-events']),
    ...(call.context.accountId ? { accountId: call.context.accountId } : {}),
    sensitiveRead: 'logs filter-log-events',
  })
  if (decision.mode === 'block') {
    return {
      ok: false,
      text: `Blocked by the infrastructure permission matrix on ${decision.accountKind} accounts. Ask the user to read these logs from the Logs screen instead.`,
    }
  }
  if (decision.mode === 'ask' && call.gated !== true) {
    return {
      ok: false,
      text:
        'Reading log contents on a production account needs a human to approve it, and this ' +
        'surface has no approval prompt. Ask the user to open the Logs screen.',
    }
  }

  const result = await tailWindow({
    logGroups: args.logGroups,
    startMs,
    endMs,
    ...(args.filterPattern !== undefined ? { filterPattern: args.filterPattern } : {}),
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
    ...ctx,
  })
  if (!result.ok) return { ok: false, text: `The log read failed: ${result.error}` }

  const lines = result.value.events.map(
    (e) => `${new Date(e.timestamp).toISOString()}  ${e.logStreamName}  ${e.message}`,
  )
  const body = clampForLlm(lines.length > 0 ? lines : ['(no events in this window)'], {
    maxTotalChars: INFRA_MAX_TOTAL_CHARS,
    hint: 'shorten the window, or pass a filterPattern to narrow the result',
  })
  const header = `${String(result.value.events.length)} events in the last ${String(minutes)}m${result.value.truncated ? ' (truncated by the CLI limit)' : ''}`
  return { ok: true, text: `${header}\n${body.text}` }
}

function isTerminal(status: string): boolean {
  return status === 'Complete' || status === 'Failed' || status === 'Cancelled' || status === 'Timeout'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}

// ─── Mốc 3: agent đọc/lái View của Explorer (task 3.10) ──────────────────────
//
// HAI TOOL NÀY KHÔNG MỞ ĐƯỜNG MỚI RA CLI. Cả hai dựng argv từ CÙNG file mô tả mà
// màn Explorer dùng (`infra/resources/aws-views.ts`) rồi gọi `runAwsCli()` —
// tức đúng bốn bước classify → decide → gate → runInfra → clamp của `aws_cli`.
// Không có bản sao thứ hai của chuỗi quyết định, nên không có bản sao thứ hai để
// quên `decide()`.
//
// VÌ SAO ĐI QUA `aws_cli` CHỨ KHÔNG QUA `resources/execute.ts`: `execute.ts` là
// đường của NGƯỜI BẤM, và nó dùng VÉ DUYỆT do sidecar phát (`runGated`). Agent
// không có vé — cổng của nó là hộp duyệt của phiên chat (`opts.gated`). Trộn hai
// cơ chế là cách để một lệnh hoặc bị hỏi hai lần, hoặc chạy không ai hỏi.

export type InfraViewInput = {
  view: string
  values?: Record<string, string> | undefined
  token?: string | undefined
}

export async function runInfraView(
  input: InfraViewInput,
  call: AwsCliCall,
): Promise<CliRunResult> {
  const spec = viewById(input.view)
  if (!spec) {
    return {
      ok: false,
      exitCode: null,
      text: `Unknown view "${input.view}". Known views: ${allDescriptors()
        .map((v) => v.id)
        .join(', ')}.`,
    }
  }
  const built = buildArgs(spec.list.args, input.values ?? {})
  if (!built.ok) {
    return {
      ok: false,
      exitCode: null,
      text: `${built.error} Required: ${(spec.list.required ?? []).map((f) => f.key).join(', ') || '(none)'}.`,
    }
  }
  const args = [...built.args, spec.list.pageSizeFlag, String(spec.list.pageSize)]
  if (input.token) args.push(spec.list.tokenFlag, input.token)

  const ran = await runAwsCli(args, call)
  if (!ran.ok) return ran

  // CLI trả JSON vì `infra.run` chèn `--output json`; JSON hỏng nghĩa là lệnh
  // không phải một lệnh `list` (model gõ nhầm view) — nói thẳng thay vì trả rỗng.
  let json: unknown
  try {
    json = JSON.parse(ran.text) as unknown
  } catch {
    return { ok: true, exitCode: ran.exitCode, text: ran.text }
  }
  const rows = spec.list.pick(json)
  const nextToken = ((): string => {
    const walk = (v: unknown, path: string): unknown => {
      let cur: unknown = v
      for (const part of path.split('.')) {
        if (typeof cur !== 'object' || cur === null) return undefined
        cur = (cur as Record<string, unknown>)[part]
      }
      return cur
    }
    const t = walk(json, spec.list.tokenPath)
    return typeof t === 'string' ? t : ''
  })()

  const cols = spec.columns.simple
  const body = rows.map((r) => cols.map((c) => r[c.key] ?? '').join('  '))
  const clamped = clampForLlm(body.length ? body : ['(no resources)'], {
    maxTotalChars: INFRA_MAX_TOTAL_CHARS,
    hint: 'pass a token to page, or narrow the view (e.g. a bucket/prefix)',
  })
  const header =
    `${spec.label} — ${String(rows.length)} row(s)` +
    (nextToken ? `\n[more rows available — call again with token="${nextToken}"]` : '')
  return {
    ok: true,
    exitCode: ran.exitCode,
    text: `${header}\n${cols.map((c) => c.label).join('  ')}\n${clamped.text}`,
  }
}

export type InfraActionInput = {
  view: string
  action: string
  row?: InfraRow | undefined
  values?: Record<string, string> | undefined
}

export async function runInfraAction(
  input: InfraActionInput,
  call: AwsCliCall,
): Promise<CliRunResult> {
  const spec = viewById(input.view)
  if (!spec) return { ok: false, exitCode: null, text: `Unknown view "${input.view}".` }
  const action = (spec.actions ?? []).find((a) => a.id === input.action)
  if (!action) {
    const known = (spec.actions ?? []).map((a) => a.id)
    return {
      ok: false,
      exitCode: null,
      text: known.length
        ? `Unknown action "${input.action}". Known actions for ${spec.id}: ${known.join(', ')}.`
        : `View ${spec.id} has no actions.`,
    }
  }
  // Hành động TẢI VỀ có đích ghi do sidecar ghép trong cache; đường của agent
  // không có bước đó (và không nên có: nó ghi file lên máy người dùng). Agent
  // muốn lấy nội dung thì đọc thẳng bằng `aws_cli`.
  if (action.download) {
    return {
      ok: false,
      exitCode: null,
      text: `"${action.id}" downloads a file and is only available from the Explorer screen.`,
    }
  }
  const values: Record<string, string> = { ...(input.row ?? {}), ...(input.values ?? {}) }
  // Cùng luật với đường người bấm: chỉ ô khai `list: true` mới tách thành nhiều
  // token (Mốc 4 — `--paths` của CloudFront invalidation).
  const built = buildArgs(action.args, values, { listKeys: listKeysOf(action.fields) })
  if (!built.ok) return { ok: false, exitCode: null, text: built.error }
  return runAwsCli(built.args, call)
}

// ─── Nhánh Pi: AgentTool ─────────────────────────────────────────────────────

const ProfilesParams = Type.Object({})
const ContextParams = Type.Object({})
const AwsCliParams = Type.Object({
  args: Type.Array(Type.String(), { description: INFRA_TOOL_TEXT.awsCli.args }),
})

const KubectlCliParams = Type.Object({
  args: Type.Array(Type.String(), { description: INFRA_TOOL_TEXT.kubectlCli.args }),
})

const TfCliParams = Type.Object({
  args: Type.Array(Type.String(), { description: INFRA_TOOL_TEXT.tfCli.args }),
})

const LogsQueryParams = Type.Object({
  logGroups: Type.Array(Type.String(), { description: INFRA_TOOL_TEXT.logsQuery.args }),
  query: Type.String({ description: 'CloudWatch Logs Insights query string.' }),
  startTime: Type.Union([Type.String(), Type.Number()], {
    description: INFRA_TOOL_TEXT.logsQuery.startTime,
  }),
  endTime: Type.Union([Type.String(), Type.Number()], {
    description: INFRA_TOOL_TEXT.logsQuery.endTime,
  }),
  limit: Type.Optional(Type.Number({ description: INFRA_TOOL_TEXT.logsQuery.limit })),
})

const InfraViewParams = Type.Object({
  view: Type.String({ description: INFRA_TOOL_TEXT.infraView.args }),
  values: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description: 'Values the view requires (e.g. { bucket: "my-bucket" } for s3.objects).',
    }),
  ),
  token: Type.Optional(Type.String({ description: INFRA_TOOL_TEXT.infraView.token })),
})

const InfraActionParams = Type.Object({
  view: Type.String({ description: INFRA_TOOL_TEXT.infraAction.args }),
  action: Type.String({ description: 'Action id, e.g. "ec2.stop".' }),
  row: Type.Optional(
    Type.Record(Type.String(), Type.String(), { description: INFRA_TOOL_TEXT.infraAction.row }),
  ),
  values: Type.Optional(
    Type.Record(Type.String(), Type.String(), { description: INFRA_TOOL_TEXT.infraAction.values }),
  ),
})

const LogsTailParams = Type.Object({
  logGroups: Type.Array(Type.String(), { description: INFRA_TOOL_TEXT.logsTail.args }),
  minutes: Type.Optional(Type.Number({ description: INFRA_TOOL_TEXT.logsTail.minutes })),
  filterPattern: Type.Optional(
    Type.String({ description: INFRA_TOOL_TEXT.logsTail.filterPattern }),
  ),
  limit: Type.Optional(Type.Number({ description: INFRA_TOOL_TEXT.logsTail.limit })),
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

  // Hai tool log CHỈ có mặt khi đã ghim profile — cùng luật với `aws_cli`: quảng
  // cáo một tool chắc chắn trả lỗi chỉ tốn của model một lượt gọi.
  const logsCall = {
    context: { ...context, profile },
    gated,
    agentName: opts.agentName,
    sessionId: opts.sessionId,
    messageId: opts.messageId,
  }

  const logsQueryTool: AgentTool<typeof LogsQueryParams, Record<string, never>> = {
    name: LOGS_QUERY_TOOL_NAME,
    label: 'CloudWatch Logs Insights',
    description: INFRA_TOOL_TEXT.logsQuery.description,
    parameters: LogsQueryParams,
    // Tuần tự: một truy vấn có thể park chờ người duyệt, và hai popup duyệt xen
    // nhau thì người dùng không còn biết mình đang duyệt lệnh nào.
    executionMode: 'sequential',
    async execute(_id, params): Promise<AgentToolResult<Record<string, never>>> {
      const { text } = await runLogsQuery(
        {
          logGroups: [...params.logGroups],
          query: params.query,
          startTime: params.startTime,
          endTime: params.endTime,
          ...(params.limit !== undefined ? { limit: params.limit } : {}),
        },
        logsCall,
      )
      return { content: [{ type: 'text', text }], details: {} }
    },
  }

  const logsTailTool: AgentTool<typeof LogsTailParams, Record<string, never>> = {
    name: LOGS_TAIL_TOOL_NAME,
    label: 'CloudWatch log tail',
    description: INFRA_TOOL_TEXT.logsTail.description,
    parameters: LogsTailParams,
    executionMode: 'sequential',
    async execute(_id, params): Promise<AgentToolResult<Record<string, never>>> {
      const { text } = await runLogsTail(
        {
          logGroups: [...params.logGroups],
          ...(params.minutes !== undefined ? { minutes: params.minutes } : {}),
          ...(params.filterPattern !== undefined ? { filterPattern: params.filterPattern } : {}),
          ...(params.limit !== undefined ? { limit: params.limit } : {}),
        },
        logsCall,
      )
      return { content: [{ type: 'text', text }], details: {} }
    },
  }

  tools.push(logsQueryTool as AgentTool, logsTailTool as AgentTool)

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

  // Mốc 3 (task 3.10): hai tool đọc/lái VIEW của Explorer. Cùng luật "chỉ có khi
  // đã ghim profile" với `aws_cli` — chúng dựng argv rồi gọi thẳng `runAwsCli`,
  // nên không có profile thì chúng cũng không chạy được.
  const viewTool: AgentTool<typeof InfraViewParams, Record<string, never>> = {
    name: INFRA_VIEW_TOOL_NAME,
    label: 'Infra view',
    description: INFRA_TOOL_TEXT.infraView.description,
    parameters: InfraViewParams,
    executionMode: 'sequential',
    async execute(_id, params): Promise<AgentToolResult<Record<string, never>>> {
      const { text } = await runInfraView(
        {
          view: params.view,
          ...(params.values !== undefined ? { values: { ...params.values } } : {}),
          ...(params.token !== undefined ? { token: params.token } : {}),
        },
        {
          context: { ...context, profile },
          gated,
          agentName: opts.agentName,
          sessionId: opts.sessionId,
          messageId: opts.messageId,
        },
      )
      return { content: [{ type: 'text', text }], details: {} }
    },
  }

  const actionTool: AgentTool<typeof InfraActionParams, Record<string, never>> = {
    name: INFRA_ACTION_TOOL_NAME,
    label: 'Infra action',
    description: INFRA_TOOL_TEXT.infraAction.description,
    parameters: InfraActionParams,
    // Tuần tự: một hành động ghi có thể park chờ người duyệt.
    executionMode: 'sequential',
    async execute(_id, params): Promise<AgentToolResult<Record<string, never>>> {
      const { text } = await runInfraAction(
        {
          view: params.view,
          action: params.action,
          ...(params.row !== undefined ? { row: { ...params.row } } : {}),
          ...(params.values !== undefined ? { values: { ...params.values } } : {}),
        },
        {
          context: { ...context, profile },
          gated,
          agentName: opts.agentName,
          sessionId: opts.sessionId,
          messageId: opts.messageId,
        },
      )
      return { content: [{ type: 'text', text }], details: {} }
    },
  }
  tools.push(viewTool as AgentTool, actionTool as AgentTool)

  // `kubectl_cli` CHỈ có mặt khi phiên đã ghim context — cùng luật với `aws_cli`.
  // `opts.context` (không phải bản có `profile`) vì kubectl không cần profile.
  if (context.cluster) {
    tools.push(
      buildCliTool(opts, {
        name: KUBECTL_CLI_TOOL_NAME,
        label: 'kubectl',
        description: INFRA_TOOL_TEXT.kubectlCli.description,
        params: KubectlCliParams,
        run: runKubectlCli,
      }),
    )
  }

  if (context.workspace) {
    tools.push(
      buildCliTool(opts, {
        name: TF_CLI_TOOL_NAME,
        label: 'terraform',
        description: INFRA_TOOL_TEXT.tfCli.description,
        params: TfCliParams,
        run: runTfCli,
      }),
    )
  }

  return tools
}

/**
 * Dựng hai tool CLI còn lại cho một ngữ cảnh. Tách khỏi `createInfraTools` để
 * phần advertise chỉ còn là một dòng mỗi tool — cùng luật "chỉ có mặt khi đã
 * ghim": quảng cáo một tool chắc chắn trả lỗi chỉ tốn của model một lượt gọi.
 */
function buildCliTool(
  opts: CreateInfraToolsOptions,
  spec: {
    name: string
    label: string
    description: string
    params: typeof AwsCliParams
    run: (args: readonly string[], call: CliCall) => Promise<CliRunResult>
  },
): AgentTool {
  const tool: AgentTool<typeof AwsCliParams, AwsCliDetails> = {
    name: spec.name,
    label: spec.label,
    description: spec.description,
    parameters: spec.params,
    executionMode: 'sequential',
    async execute(_id, params): Promise<AgentToolResult<AwsCliDetails>> {
      const { text, exitCode } = await spec.run(params.args, {
        context: opts.context,
        gated: opts.gated === true,
        agentName: opts.agentName,
        sessionId: opts.sessionId,
        messageId: opts.messageId,
      })
      return { content: [{ type: 'text', text }], details: { args: [...params.args], exitCode } }
    },
  }
  return tool as AgentTool
}
