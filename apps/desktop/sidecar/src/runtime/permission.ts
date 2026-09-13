// Bridge AWOG's permission gate (canUseTool → parkPermissionRequest → UI) onto
// Pi's `beforeToolCall` hook (ADR 0029 item 3).
//
// The SAME canUseTool assembled in sessions.send-message.ts flows through
// RunNonStreamArgs and is invoked here, so the UI permission RPC + parking
// machinery is reused unchanged. We translate the result:
//   behavior 'allow' → return undefined (let the tool run); if updatedInput is
//     present, validate it, re-check it against DENY rules, then mutate the
//     validated args in place (Pi executes with `args`). See F13 below.
//   behavior 'deny'  → return { block: true, reason: message } so the loop emits
//     an error tool result instead of executing.
//
// Mode handling:
//   execute      → no gate at all (canUseTool is not even wired in this mode).
//   accept-edits → auto-allow Write/Edit; everything else still gated.
//   plan         → block all writes/exec (Write/Edit/Bash); reads allowed.
//   ask          → gate all writes/exec via canUseTool.
//
// Read-family tools (Read/Grep/Glob) never PROMPT — they are non-mutating — but a
// DENY rule still applies to them (see below).
//
// Remembered allowances (ADR 0080): "Always allow" no longer keys off the tool
// NAME. Every gated call is matched against permission RULES scoped to the call's
// content — `Bash(git status)`, `Write(/repo/src/**)` — evaluated session →
// project → user, with DENY beating ALLOW everywhere. Approving `git status` once
// therefore no longer unlocks `rm -rf /` for the rest of the session.
//
// "Everywhere" is literal since the 2026-09-07 security fix (F3): the rule lookup
// runs for EVERY tool call, ahead of every early return in this hook — read-family
// tools, `WebFetch`, `Task`, SSH tools and `mcp__*` tools included. Only the DENY
// half is consumed that early; ALLOW keeps its old position (it only ever skips a
// prompt, and no non-gated tool prompts anyway).
//
// An ALLOW rule also never covers a DETACHED call — `Bash(run_in_background: true)`
// leaves a process running past the turn, so it is asked every time even when the
// same command string is approved for the foreground (F12). DENY still covers it.
//
// Two more asymmetries landed with the 2026-09-08 audit:
//   F4 — a call the matcher cannot read AT ALL (compound/oversized command, missing
//        argument) no longer slips through `execute` / auto-approve / accept-edits
//        while a DENY rule for that tool exists: it is asked instead. See
//        `guardedByDeny` below for why this is deliberately narrow.
//   F5 — Tasks finally have a gate: `makeTaskToolGate` (deny-only, never prompts).
//
// Lệnh hạ tầng (ADR 0088, 2026-09-12):
//   - `aws_cli` / `tf_cli` / `kubectl_cli` / `infra_action` / `infra_context` đi
//     qua MA TRẬN quyền ở Settings (`infra/policy.ts`), không qua `AgentMode`.
//     Nhánh đó nằm TRƯỚC `execute` / auto-approve / accept-edits vì Settings là
//     trần và phiên chỉ siết thêm được (§5b) — cùng khuôn với nhánh SSH.
//   - `Bash(aws …)` vẫn đi đường cũ, nhưng KHÔNG nhớ được bằng "Always allow" và
//     không luật ALLOW nào phủ được (§6, task 0.14): mỗi lần gọi là một lần hỏi.
//
// Contract: beforeToolCall must NOT throw. Any error → fail safe = block, so a
// bug can never silently let an unapproved write through.

import type { BeforeToolCallResult } from '@earendil-works/pi-agent-core'
import type {
  CanUseTool,
  PermissionRuleSuggestion,
  PermissionUpdate,
} from './permission-types.js'
import type { AgentMode, SshApprovalMode } from '../types/shared.js'
import { allowSessionTool, isSessionToolAllowed } from '../sessions/permissions.js'
import { unbridgeAwogToolName } from './tools/bridged.js'
import {
  evaluatePermissionRules,
  isUnreadableUnderDeny,
  parsePermissionRule,
  resolveProjectPathById,
  suggestRuleText,
} from '../sessions/permission-rules.js'
// Chính sách của `Artifact` ở cùng nhà với bằng chứng đo được về cổng bật nó
// (claude-sdk/artifact.ts). File đó chỉ import `node:fs`/`node:path` + `awogHome`,
// KHÔNG import `@anthropic-ai/claude-agent-sdk`, nên dòng này không kéo SDK vào
// nhánh Pi — nhánh Pi cũng nạp chính module quyền này.
import {
  artifactPathViolation,
  isArtifactToolName,
  isGatedArtifactAction,
} from './claude-sdk/artifact.js'
import { isBrowserToolName, isMutatingBrowserAction } from './tools/browser-tool.js'
import { isDevServerToolName, isMutatingDevServerAction } from './tools/dev-server-tool.js'
import { SOURCE_MUTATING_TOOL_NAMES } from './tools/source-tools.js'
import { WIKI_MUTATING_TOOL_NAMES } from './tools/wiki-tools.js'
// Ma trận quyền hạ tầng (ADR 0088 §5). `classify` + `decide` là hàm THUẦN;
// `loadInfraPolicy` đọc đĩa nhưng đã tự phòng thủ (không bao giờ ném, có cache).
import { CONTEXT_BLOCKED_BINARIES, CONTEXT_SWITCH_CLASS, classify } from '../infra/classify.js'
import { decide } from '../infra/policy.js'
import { loadInfraPolicy } from '../infra/policy-store.js'
import { recordInfraAction } from '../infra/audit/store.js'
import type { InfraAccountKind, InfraMode } from '../infra/policy.js'
import type { InfraCommandClass, InfraTool } from '../infra/types.js'
import type { InfraContext } from '../infra/run.js'
import {
  AWS_CLI_TOOL_NAME,
  INFRA_CONTEXT_TOOL_NAME,
} from './tools/infra-tools.js'
import { log } from '../util/logger.js'

// Tools that mutate the workspace or execute code. Everything else is read-only
// and runs without a permission prompt.
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const EXEC_TOOLS = new Set(['Bash'])
// Tools that spawn durable background work (ADR 0055): RunWorkflow kicks off a
// Task. Gated like a mutation so it prompts in ask/accept-edits and runs only in
// execute mode (in plan mode it isn't even registered).
const SPAWN_TOOLS = new Set(['RunWorkflow'])
// SSH tools that act on the LINKED remote host (ADR 0064 P2), all gated via the
// per-session sshApprovalMode (NOT the general AgentMode). MUTATING = command /
// file write (higher consequence — also blocked in plan mode). READ = remote read
// / list; the user chose to gate these too (they can exfil sensitive remote files
// to the model), but they stay available in plan mode for investigation. In 'auto'
// mode the whole set runs without a prompt.
const SSH_MUTATING_TOOLS = new Set(['ssh_exec', 'ssh_terminal_run', 'ssh_write_file'])
const SSH_READ_TOOLS = new Set(['ssh_read_file', 'ssh_list_dir'])
const SSH_GATED_TOOLS = new Set([...SSH_MUTATING_TOOLS, ...SSH_READ_TOOLS])

// Resolve the bare SSH tool name from a raw name (`ssh_exec`, Pi path) OR its Claude
// SDK bridged form (`mcp__<server>__ssh_exec`, ssh-sdk-server.ts), else null. The
// anthropic provider exposes the SSH tools as an MCP server, so the gate must match
// both forms — otherwise a bridged SSH tool would slip past this gate and run
// UNGATED. Matched by exact name or `__<tool>` suffix (mirrors isSourceMutatingTool).
function sshToolName(name: string): string | null {
  for (const n of SSH_GATED_TOOLS) if (name === n || name.endsWith(`__${n}`)) return n
  return null
}
// Source setup tools that persist config (ADR 0060 P6): source_create writes a
// source config. Gated like a mutation so it prompts for approval in ask/
// accept-edits mode (source_list/source_test/source_oauth_trigger are not). No
// source tool takes a raw secret as an arg — api credentials are entered in the
// UI (invariant 1), so nothing secret transits this gate's permission event.
//
// A source-mutating tool under EITHER naming: the bare Pi name (`source_create`)
// or the Claude SDK-bridged form (`mcp__awog__source_create`). Matched precisely —
// the name IS the mutating name, or it ENDS WITH `__<mutating name>` (the SDK
// `mcp__<server>__<tool>` convention) — so it never over-matches an unrelated tool.
function isSourceMutatingTool(name: string): boolean {
  return SOURCE_MUTATING_TOOL_NAMES.some((n) => name === n || name.endsWith(`__${n}`))
}

// Wiki mutations (ADR 0073): the agent editing the user's own documentation. Gated
// like a file write — it prompts in ask/accept-edits, is hard-blocked in plan mode,
// and runs freely only in execute mode. Settings decides whether these tools exist
// at all; this decides each call. Matched under BOTH namings (bare Pi name and the
// SDK's `mcp__awogwiki__wiki_write`), or a bridged call would slip past UNGATED.
function isWikiMutatingTool(name: string): boolean {
  return WIKI_MUTATING_TOOL_NAMES.some((n) => name === n || name.endsWith(`__${n}`))
}

// browser_tool is one tool with mixed actions: navigate/click/fill mutate (gate);
// screenshot/extract are read-only (don't gate). Decided per-call from args.
function isGatedTool(name: string, args: unknown): boolean {
  // Khớp CẢ HAI cách gọi tên: tên trần của nhánh Pi và tên bắc cầu của nhánh
  // Claude SDK (`mcp__awogbrowser__browser_tool`). Chỉ so tên trần thì lời gọi bắc
  // cầu lọt qua cổng — kể cả trong plan mode, nơi đã hứa là read-only.
  if (isBrowserToolName(name)) return isMutatingBrowserAction(args)
  // Cùng khuôn, cùng lý do: `dev_server` cũng là một tool nhiều hành động, và chỉ
  // `stop` có hệ quả ra ngoài (giết một tiến trình mà người dùng đã phải duyệt lúc
  // khởi động). `list`/`start`/`logs` không gate — bắt duyệt cả việc đọc log là
  // cách nhanh nhất để rào chắn bị tắt.
  if (isDevServerToolName(name)) return isMutatingDevServerAction(args)
  // `Artifact` (parity #35) cũng là một tool nhiều hành động, nhưng chiều mặc định
  // của nó ĐẢO LẠI: thiếu `action` nghĩa là `publish`, tức đưa một trang lên mạng
  // với URL công khai. Nên `isGatedArtifactAction` liệt kê hành động CHỈ ĐỌC và
  // gate phần còn lại — xem lý do đầy đủ trong claude-sdk/artifact.ts. Không có
  // dòng này thì lời gọi rơi xuống `return` bên dưới thành `false` và thoát ở
  // `!builtInGated` — TRƯỚC nhánh plan mode, nên plan mode publish được ra internet
  // trong khi `Write` cùng phiên bị chặn cứng.
  if (isArtifactToolName(name)) return isGatedArtifactAction(args)
  return (
    WRITE_TOOLS.has(name) ||
    EXEC_TOOLS.has(name) ||
    SPAWN_TOOLS.has(name) ||
    SSH_GATED_TOOLS.has(name) ||
    isSourceMutatingTool(name) ||
    isWikiMutatingTool(name)
  )
}

// The "Always allow" suggestion for this call (ADR 0080), or null when the call
// cannot be turned into a rule that is safe to remember — a compound shell command
// (`git status; rm -rf /`), a Bash call with no `command` string, a relative or
// traversing file path, or a subject that itself contains `*`. Returning null
// hides the button, so the ONLY way past those calls is an explicit per-call yes.
function buildRuleSuggestion(
  toolName: string,
  args: unknown,
  sessionId: string | undefined,
): PermissionRuleSuggestion | null {
  // Lệnh hạ tầng chạy qua `Bash` không có luật nào an toàn để nhớ (ADR 0088 §6,
  // task 0.14): quyền của chúng thuộc về ma trận ở Settings, nơi nhìn thấy được
  // và hết hạn được. Trả null ⇒ không có nút "Always allow" ⇒ mỗi lần gọi là một
  // lần hỏi.
  // Quét cả chuỗi, không chỉ token đầu: `sh -c "aws s3 rb …"` mà vẫn hiện nút
  // "Always allow" thì luật ALLOW ghi xuống đĩa và phủ vĩnh viễn (audit #1 F2).
  const bashCommand = toolName === 'Bash' ? argBag(args)?.command : undefined
  const infraBinary =
    bashInfraBinary(toolName, args) ??
    (typeof bashCommand === 'string' ? anyInfraBinary(bashCommand) : null)
  if (infraBinary) {
    log.info('permission gate: no remembered rule for an infrastructure command', {
      toolName,
      binary: infraBinary,
    })
    return null
  }
  const rule = suggestRuleText(toolName, args)
  if (!rule) return null
  const parsed = parsePermissionRule(rule)
  if (!parsed) return null
  return {
    type: 'addRule',
    toolName,
    destination: 'session',
    rule: parsed.text,
    ruleKind: parsed.kind,
    action: 'allow',
    ...(sessionId ? { sessionId } : {}),
  }
}

// Per-source runtime gate resolved from each active source's trust +
// permissions.json (ADR 0060 P4). All fields optional + no-op when empty, so a
// turn with no P4 config leaves the gate's behaviour byte-identical to before.
export interface SourceGateConfig {
  // trust:'prompt' source ids — their `mcp__<id>__*` tools route through the
  // EXISTING ask-gate/park instead of running silently.
  promptSourceIds?: string[]
  // Per-source auto-scoped allowedMcpPatterns (mcp__<id>__.*<pat>) keyed by source
  // id. A source tool NOT matching its source's patterns is HARD-BLOCKED. This is
  // the enforcement backstop for the Pi path (where such tools are also filtered
  // from exposure) and the SOLE enforcement on the Claude SDK path (the SDK owns
  // MCP listing, so exposure can't be filtered there).
  toolPatterns?: Record<string, RegExp[]>
}

// The source id segment of a bridged tool name `mcp__<id>__<tool>`, or null for a
// built-in / non-source tool. `<id>` never contains `__` (SOURCE_ID_RE) so the
// first `__` after the prefix ends it.
function sourceIdOfTool(name: string): string | null {
  if (!name.startsWith('mcp__')) return null
  const rest = name.slice(5)
  const sep = rest.indexOf('__')
  return sep > 0 ? rest.slice(0, sep) : null
}

// ─── Lệnh hạ tầng (ADR 0088 §5, §5b, §6) ────────────────────────────────────
// Cổng cho `aws_cli` / `tf_cli` / `kubectl_cli` / `infra_action` / `infra_context`.
// Khác mọi nhánh khác ở một điểm: quyền KHÔNG đến từ `AgentMode` mà từ **ma trận
// cài đặt**, nên nhánh này nằm TRƯỚC `execute` / auto-approve / accept-edits —
// giống hệt nhánh SSH, và vì cùng một lý do: Settings là trần, không mode nào nới
// được (ADR 0088 §5b).

/** Tool AWOG gọi thẳng một CLI, và CLI đứng sau nó. */
// Tên lấy từ chính hằng số mà `infra-tools.ts` export — hardcode chuỗi ở đây thì
// một lần đổi tên tool sẽ ÂM THẦM gỡ cổng quyền (tool chạy, gate không nhận ra).
const INFRA_CLI_TOOLS: Record<string, InfraTool> = {
  [AWS_CLI_TOOL_NAME]: 'aws',
  tf_cli: 'terraform',
  kubectl_cli: 'kubectl',
}
// `infra_action` (task 3.10) lái màn Explorer nên CLI nằm trong chính args;
// `infra_context` là lời gọi đổi ngữ cảnh nội bộ — lớp của nó là hằng số, không
// suy được từ argv (xem CONTEXT_SWITCH_CLASS).
const INFRA_ACTION_TOOL = 'infra_action'
const INFRA_CONTEXT_TOOL = INFRA_CONTEXT_TOOL_NAME
const INFRA_GATED_TOOLS = [
  ...Object.keys(INFRA_CLI_TOOLS),
  INFRA_ACTION_TOOL,
  INFRA_CONTEXT_TOOL,
]

// Tên TRẦN của một tool hạ tầng, kể cả khi nó đến dưới dạng bắc cầu của nhánh
// Claude SDK (`mcp__awoginfra__aws_cli`) — khuôn của `sshToolName`. Chỉ so tên
// trần thì lời gọi bắc cầu đi vòng qua cả ma trận.
function infraToolName(name: string): string | null {
  for (const n of INFRA_GATED_TOOLS) if (name === n || name.endsWith(`__${n}`)) return n
  return null
}

const MAX_COMMAND_CHARS = 4000

function argBag(args: unknown): Record<string, unknown> | null {
  return args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : null
}

/** `args: string[]` của tool, hoặc null khi lời gọi không đọc được. */
function infraArgv(args: unknown): string[] | null {
  const bag = argBag(args)
  if (!bag) return null
  for (const key of ['args', 'argv']) {
    const raw = bag[key]
    if (Array.isArray(raw) && raw.every((v) => typeof v === 'string')) return [...raw]
  }
  return null
}

function infraCliOf(bare: string, args: unknown): InfraTool | null {
  const fixed = INFRA_CLI_TOOLS[bare]
  if (fixed) return fixed
  const raw = argBag(args)?.tool
  if (raw === 'aws' || raw === 'terraform' || raw === 'kubectl') return raw
  return null
}

/**
 * Dòng lệnh ĐÚNG NHƯ sẽ chạy, kể cả cờ ngữ cảnh mà sidecar chèn — prompt duyệt
 * phải cho thấy account/cluster thật, và câu từ chối phải là thứ người dùng
 * copy ra terminal chạy được (ADR 0088 §5, §6).
 *
 * ⚠ Đây là BẢN SAO có chủ đích của `withContext()` trong `infra/run.ts` (hàm đó
 * private và `run.ts` nằm ngoài phạm vi được sửa). Sửa luật chèn cờ ở đó thì
 * phải sửa luôn ở đây, nếu không prompt sẽ mô tả một lệnh khác với lệnh chạy.
 */
export function describeInfraCommand(
  tool: InfraTool,
  argv: readonly string[],
  ctx?: InfraContext | undefined,
): string {
  const parts: string[] = [tool]
  if (tool === 'terraform') {
    if (ctx?.workspace) parts.push(`-chdir=${ctx.workspace}`)
    parts.push(...argv)
  } else {
    parts.push(...argv)
    if (tool === 'aws') {
      if (ctx?.profile) parts.push('--profile', ctx.profile)
      if (ctx?.region) parts.push('--region', ctx.region)
    } else {
      if (ctx?.cluster) parts.push('--context', ctx.cluster)
      if (ctx?.namespace) parts.push('--namespace', ctx.namespace)
    }
  }
  const line = parts.join(' ')
  return line.length > MAX_COMMAND_CHARS ? `${line.slice(0, MAX_COMMAND_CHARS - 1)}…` : line
}

/** Mô tả gọn một lời gọi không có argv (`infra_action` dạng view/action). */
function describeOpaqueCall(bare: string, args: unknown): string {
  const bag = argBag(args)
  if (!bag) return bare
  const words = Object.entries(bag)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .map(([k, v]) => `${k}=${String(v)}`)
  const line = words.length > 0 ? `${bare} ${words.join(' ')}` : bare
  return line.length > MAX_COMMAND_CHARS ? `${line.slice(0, MAX_COMMAND_CHARS - 1)}…` : line
}

type InfraCall = { name: string; class: InfraCommandClass; command: string }


// `infra_context` đổi ngữ cảnh khi lời gọi mang field ghi (`set`/`profile`/…).
// Đọc thủ công vì args là dữ liệu L1 không tin: hình dạng lạ ⇒ coi như ĐANG ĐỔI
// (fail-safe — đoán sai theo chiều nới quyền mới là leo thang).
function isInfraContextSwitchCall(args: unknown): boolean {
  if (args === null || typeof args !== 'object') return false
  const keys = Object.keys(args as Record<string, unknown>)
  if (keys.length === 0) return false
  const READ_ONLY_KEYS = new Set(['sessionId', 'detail', 'verbose'])
  return keys.some((k) => !READ_ONLY_KEYS.has(k))
}

/** Lời gọi hạ tầng đã đọc được, hoặc null nếu tool này không phải tool hạ tầng. */
function readInfraCall(toolName: string, args: unknown, ctx?: InfraContext): InfraCall | null {
  const bare = infraToolName(toolName)
  if (!bare) return null
  if (bare === INFRA_CONTEXT_TOOL) {
    // ⚠ Ở pha này `infra_context` CHỈ ĐỌC ngữ cảnh đang ghim (xem `infra-tools.ts`),
    // nên nó là lớp `read`. Xếp `context-switch` sẽ khiến một lệnh thuần đọc đi hỏi
    // người dùng trên tài khoản production — phiền mà không mua được an toàn nào.
    // Khi tool này có thêm thao tác ĐỔI ngữ cảnh, nhánh đổi đó (và chỉ nhánh đó)
    // mới mang `CONTEXT_SWITCH_CLASS`; hàng `context-switch` của ma trận nằm chờ
    // sẵn cho lúc ấy.
    const switching = isInfraContextSwitchCall(args)
    return {
      name: bare,
      class: switching ? CONTEXT_SWITCH_CLASS : 'read',
      command: describeOpaqueCall(bare, args),
    }
  }
  const cli = infraCliOf(bare, args)
  const argv = infraArgv(args)
  // Không đọc được lời gọi ⇒ `write` (fail-safe, ADR 0088 §5): chi phí đoán sai
  // là một lần hỏi thừa, chiều ngược lại là chạy một lệnh ghi không ai kịp nhìn.
  if (!cli || !argv) {
    return { name: bare, class: 'write', command: describeOpaqueCall(bare, args) }
  }
  return { name: bare, class: classify(cli, argv), command: describeInfraCommand(cli, argv, ctx) }
}

/** Ngữ cảnh + trần của phiên mà cổng quyền áp cho lệnh hạ tầng. */
export interface InfraGateConfig {
  /** Ngữ cảnh phiên đang ghim (task 0.8). Vắng ⇒ prompt không nêu được account. */
  context?: InfraContext | undefined
  /**
   * Trần mà PHIÊN tự siết xuống (ADR 0088 §5b). Chỉ siết được, không nới được —
   * `decide()` cưỡng chế điều đó, ở đây chỉ truyền qua.
   */
  sessionFloor?: InfraMode | undefined
}

/** Payload kèm theo prompt duyệt — UI tô đỏ khi `accountKind === 'production'`. */
type InfraPromptPayload = {
  kind: 'infra'
  tool: string
  command: string
  commandClass: InfraCommandClass
  accountKind: InfraAccountKind
  mode: InfraMode
  reason: string
  /** Bypass tạm thời còn lại (giây) — UI đếm ngược; vắng ⇒ không có bypass. */
  bypassSecondsLeft?: number
  profile?: string
  accountId?: string
  region?: string
  context?: string
  namespace?: string
  workspace?: string
}

function infraPromptPayload(
  call: InfraCall,
  verdict: {
    mode: InfraMode
    reason: string
    accountKind: InfraAccountKind
    bypassSecondsLeft?: number
  },
  ctx: InfraContext | undefined,
): InfraPromptPayload {
  return {
    kind: 'infra',
    tool: call.name,
    command: call.command,
    commandClass: call.class,
    accountKind: verdict.accountKind,
    mode: verdict.mode,
    reason: verdict.reason,
    // Bypass tạm thời còn bao lâu — thẻ duyệt đếm ngược bằng số này. `decide()`
    // đã tính, không chuyển tiếp thì người duyệt không biết cửa còn mở mấy phút.
    ...(verdict.bypassSecondsLeft !== undefined
      ? { bypassSecondsLeft: verdict.bypassSecondsLeft }
      : {}),
    ...(ctx?.profile ? { profile: ctx.profile } : {}),
    ...(ctx?.accountId ? { accountId: ctx.accountId } : {}),
    ...(ctx?.region ? { region: ctx.region } : {}),
    ...(ctx?.cluster ? { context: ctx.cluster } : {}),
    ...(ctx?.namespace ? { namespace: ctx.namespace } : {}),
    ...(ctx?.workspace ? { workspace: ctx.workspace } : {}),
  }
}

function infraBlockReason(call: InfraCall, kind: InfraAccountKind): string {
  const where = kind === 'production' ? 'a PRODUCTION account' : 'this account'
  return `AWOG không chạy lệnh này — the infrastructure policy blocks ${call.class} commands on ${where}. Run it yourself if you mean to: ${call.command}. Change this in Settings → Infrastructure.`
}

// ─── `Bash(aws …)` (ADR 0088 §6, task 0.14) ─────────────────────────────────
// Lệnh hạ tầng chạy qua `Bash` KHÔNG được nhớ bằng nút "Always allow": có hai
// nguồn sự thật về quyền hạ tầng thì người dùng sẽ tin nhầm cái yếu hơn, và một
// luật `Bash(aws *)` cấp trọn quyền cloud bằng một cú bấm — thứ mà ma trận cố ý
// bắt phải mở ở nơi nhìn thấy được và hết hạn được.

// Tiền tố không phải là binary thật, chỉ là vỏ bọc. Bỏ qua chúng để
// `sudo aws …` / `AWS_PROFILE=prod aws …` không lách được danh sách.
const COMMAND_WRAPPERS = new Set(['sudo', 'doas', 'env', 'nohup', 'time', 'command', 'exec'])
const ENV_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/

/** Tên binary đứng đầu một chuỗi lệnh shell, đã bỏ đường dẫn và đuôi `.exe`. */
function leadingBinary(command: string): string | null {
  for (const token of command.trim().split(/\s+/)) {
    if (!token) continue
    if (ENV_ASSIGN_RE.test(token)) continue
    const base = (token.split(/[/\\]/).pop() ?? token).toLowerCase().replace(/\.exe$/, '')
    if (COMMAND_WRAPPERS.has(base)) continue
    return base
  }
  return null
}

/**
 * Binary hạ tầng mà lời gọi `Bash` này chạy, hoặc null. Chỉ soi token ĐẦU: quét
 * cả chuỗi sẽ bắt nhầm `git commit -m "fix aws creds"` và giấu nút "Always
 * allow" của một lệnh vô hại. Lệnh ghép (`a && aws …`) vốn đã không có nút đó —
 * `ruleSubject` từ chối mọi chuỗi có toán tử shell.
 */
function bashInfraBinary(toolName: string, args: unknown): string | null {
  if (toolName !== 'Bash') return null
  const command = argBag(args)?.command
  if (typeof command !== 'string') return null
  const bin = leadingBinary(command)
  return bin && CONTEXT_BLOCKED_BINARIES.includes(bin) ? bin : null
}


/**
 * Lệnh hạ tầng chạy qua `Bash` phải đi qua **cùng ma trận** với tool `aws_cli`
 * (ADR 0088 §6). Trước bản này chỉ có nút "Always allow" bị gỡ — còn `execute`
 * mode và auto-approve vẫn cho chạy thẳng, và không dòng nhật ký nào được ghi.
 * Infosec audit #1 bắt lỗ này ở 5/7 chiều rà soát độc lập.
 *
 * Tách argv từ chuỗi shell là việc KHÔNG thể làm đúng hoàn toàn, nên ở đây chỉ
 * cần đúng theo một chiều: đọc được sạch ⇒ phân lớp thật; đọc không sạch (có
 * toán tử shell, dấu nháy, thay thế lệnh) ⇒ ép `write`, tức luôn hỏi. Không có
 * nhánh nào dẫn tới `read` từ một chuỗi không chắc chắn.
 */
const SHELL_META_RE = /[|&;<>()$`\\"']/

/**
 * Binary hạ tầng ở BẤT KỲ vị trí nào trong chuỗi (audit #1 F2).
 *
 * `leadingBinary()` chỉ soi token đầu và bỏ qua wrapper, nên `sh -c "aws …"` trả
 * `"sh"`, `env -i aws …` trả `"-i"`, `timeout 60 aws …` trả `"timeout"` — cả ba
 * đều LỌT khỏi nhánh hạ tầng, và tệ hơn: nút "Always allow" mọc lại vì
 * `buildRuleSuggestion` hỏi cùng một hàm. Đo thật trên 9 dạng bọc: 7 lọt.
 *
 * Hàm này quét mọi token. Đắt hơn và bắt nhầm nhiều hơn (`git commit -m "fix aws"`),
 * nên CHỈ dùng cho quyết định "có phải lệnh hạ tầng không" — nơi bắt nhầm chỉ tốn
 * một lần hỏi — chứ không dùng để phân lớp.
 */
function anyInfraBinary(command: string): string | null {
  for (const token of command.split(/[\s"']+/)) {
    if (!token) continue
    const base = (token.split(/[/\\]/).pop() ?? token).toLowerCase().replace(/\.exe$/, '')
    if (CONTEXT_BLOCKED_BINARIES.includes(base)) return base
  }
  return null
}

function bashInfraCall(toolName: string, args: unknown): { tool: InfraTool; argv: string[]; clean: boolean } | null {
  if (toolName !== 'Bash') return null
  const rawCommand = argBag(args)?.command
  if (typeof rawCommand !== 'string') return null
  // Token đầu trước; không thấy thì quét cả chuỗi để bắt dạng bọc.
  const bin = bashInfraBinary(toolName, args) ?? anyInfraBinary(rawCommand)
  if (!bin) return null
  const tool = INFRA_CLI_TOOLS[`${bin}_cli`] ?? (bin === 'aws' || bin === 'kubectl' || bin === 'terraform' ? (bin as InfraTool) : null)
  if (!tool) return null // helm/gcloud/az: chưa có adapter — vẫn chặn always-allow, nhưng không phân lớp được
  const command = argBag(args)?.command
  if (typeof command !== 'string') return null
  const clean = !SHELL_META_RE.test(command)
  const tokens = command.trim().split(/\s+/).filter(Boolean)
  const idx = tokens.findIndex((t) => {
    const base = (t.split(/[/\\]/).pop() ?? t).toLowerCase().replace(/\.exe$/, '')
    return base === bin
  })
  return { tool, argv: idx >= 0 ? tokens.slice(idx + 1) : [], clean }
}


/**
 * Hai đường trên đĩa mà agent KHÔNG được ghi, ở bất kỳ mode nào (infosec audit #1):
 *   · `~/.awog/infra-policy.json` — chính ma trận quyền. Ghi được nó là tự mở
 *     toàn bộ cổng, và làm thế không để lại dấu vì `infra.policy.set` mới là
 *     đường có ghi nhật ký.
 *   · `~/.awog/infra-audit/` — nhật ký hoạt động. Sửa/xoá được bằng chứng thì
 *     bằng chứng hết là bằng chứng.
 *
 * Đây là hàng rào ĐỘ SÂU, không phải hàng rào kín: với `Bash` ta chỉ so chuỗi,
 * nên một script tự ghép đường dẫn vẫn lọt. Nó chặn đường thẳng và làm đường
 * vòng trở nên rõ ràng là cố ý — chốt thật nằm ở chỗ agent không nên có quyền
 * ghi vào `~/.awog` ngay từ đầu, việc của một mốc sau.
 */
const PROTECTED_PATH_RE = /infra-policy\.json|infra-audit[/\\]/

function touchesProtectedPath(toolName: string, args: unknown): boolean {
  const bag = argBag(args)
  if (!bag) return false
  if (toolName === 'Bash') {
    const command = bag.command
    return typeof command === 'string' && PROTECTED_PATH_RE.test(command)
  }
  if (!WRITE_TOOLS.has(toolName)) return false
  for (const key of ['file_path', 'path', 'notebook_path']) {
    const v = bag[key]
    if (typeof v === 'string' && PROTECTED_PATH_RE.test(v)) return true
  }
  return false
}

// ─── Approved argument override (`updatedInput`) ────────────────────────────
// Answering a prompt may carry `updatedInput`: the user edited the tool's args
// before approving. That is the user's own call to make, but it is L1 data from
// the UI payload and it lands in a mutation sink, so it gets two guards (F13):
//
//  1. Shape. `__proto__` / `constructor` / `prototype` are refused outright —
//     `target['__proto__'] = v` walks the prototype setter instead of defining a
//     key, i.e. prototype pollution rather than an arg override. A key cap keeps
//     an absurd payload out of the sink.
//  2. Rules. The decision above was made against the ORIGINAL args, so the
//     overridden args are re-checked against DENY rules before they are applied
//     (see promptViaUi) — otherwise approving `ls` and overriding the command
//     would walk straight past a `Bash(rm -rf /)` deny rule.
const UNSAFE_TOOL_ARG_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const MAX_TOOL_ARG_KEYS = 64

// Validated at the RPC boundary (methods/sessions.permission.ts) AND at this
// sink, on purpose: the RPC rejects a hostile payload loudly, the sink can never
// be reached by one even if another caller appears.
export function isSafeToolInputOverride(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  // `Object.keys` sees an own `__proto__` produced by JSON.parse, which is
  // exactly the shape this rejects.
  const keys = Object.keys(value)
  if (keys.length > MAX_TOOL_ARG_KEYS) return false
  return !keys.some((key) => UNSAFE_TOOL_ARG_KEYS.has(key))
}

// Which session / project the rule lookup is scoped to. Tasks have no session, so
// they pass `projectPath` straight through (F5).
type RuleScope = { sessionId?: string; projectPath?: string | null; cwd?: string }

function scopeQuery(scope: RuleScope): {
  sessionId?: string
  projectPath?: string | null
  cwd?: string
} {
  return {
    ...(scope.sessionId ? { sessionId: scope.sessionId } : {}),
    ...(scope.projectPath !== undefined ? { projectPath: scope.projectPath } : {}),
    // Chỉ truyền khi có giá trị THẬT: `evaluatePermissionRules` phân biệt
    // `cwd: undefined` (rơi về đường dẫn project) với `cwd: null` (không giải
    // đường dẫn tương đối nữa) — gửi nhầm `null` là âm thầm tắt một nửa luật.
    ...(scope.cwd ? { cwd: scope.cwd } : {}),
  }
}

// The tool name a DENY rule matched for these args, or null when nothing denies
// them. Checks the bridged SSH alias too (`mcp__<server>__ssh_exec` → `ssh_exec`),
// mirroring the main gate so one rule holds on both runtimes.
async function deniedToolName(
  toolName: string,
  args: unknown,
  scope: RuleScope,
): Promise<string | null> {
  const scoped = scopeQuery(scope)
  if ((await evaluatePermissionRules({ toolName, args, ...scoped })) === 'deny') return toolName
  // Tên TRẦN của một tool AWOG bắc cầu. Người dùng viết luật theo cái tên họ NHÌN
  // THẤY trong transcript (`dev_server`) — mà transcript đã gấp tên rồi — và theo
  // đúng cái tên `denyReason()` in ra. Không tra lại dạng trần ở đây thì cùng một
  // luật chặn được trên Pi và im lặng vô hiệu trên nhánh anthropic.
  //
  // `sshToolName` trước đây là ca đặc biệt cho riêng nhóm SSH; bảng dùng chung ở
  // `runtime/tools/bridged.ts` phủ cả nhóm đó nên nó không còn cần một nhánh riêng.
  const bare = unbridgeAwogToolName(toolName)
  if (bare !== toolName) {
    if ((await evaluatePermissionRules({ toolName: bare, args, ...scoped })) === 'deny') return bare
  }
  return null
}

// The message a blocked call carries back to the model. Names the tool the rule
// was written for so the user can find and edit it.
function denyReason(name: string): string {
  return `Blocked by a permission rule you configured for ${name}. Remove that rule from your permission rules under ~/.awog to change this.`
}

// Deny-only gate for the Task Execution Engine (F5). Tasks run UNATTENDED
// (ADR 0024 D-7) so there is nobody to prompt: this hook never asks, never
// remembers anything, and never grants — it only BLOCKS what the user already
// wrote down as a DENY rule. Before this, a task node and its subagents ran
// `Bash`/`Write` through no rule at all while Settings → Permissions listed those
// rules as if they applied everywhere.
//
// Residual, on purpose: a call the matcher cannot read (a compound command) is
// NOT escalated here the way it is in a session — there is no one to ask, and
// blocking every `cd x && npm test` because one Bash deny rule exists would break
// working workflows. Sessions keep the stricter treatment.
//
// Any internal failure degrades to `undefined` (the pre-F5 behaviour): this gate
// may only ever ADD blocks, never break a workflow that used to run.
export function makeTaskToolGate(projectId?: string, cwd?: string): BeforeToolCall {
  return async (context) => {
    const toolName = context.toolCall.name
    try {
      const projectPath = projectId ? await resolveProjectPathById(projectId) : null
      const denied = await deniedToolName(toolName, context.args, {
        projectPath,
        ...(cwd ? { cwd } : {}),
      })
      return denied ? { block: true, reason: denyReason(denied) } : undefined
    } catch (err) {
      log.warn('task tool gate: rule lookup failed, letting the call through', {
        toolName,
        err: err instanceof Error ? err.message : String(err),
      })
      return undefined
    }
  }
}

// The part of Pi's BeforeToolCallContext this gate actually reads — the tool's
// name, its call id, and its arguments. Declared as the minimum so the SAME gate
// serves a runtime that is not Pi: the Codex app-server (ADR 0087) hands us a
// tool call with no AgentContext and no assistant message behind it, and the
// alternative to widening this type was a second copy of the permission policy.
// Pi's own context still satisfies it, so its `beforeToolCall` slot is unchanged.
export interface ToolGateContext {
  toolCall: { name: string; id: string }
  args: unknown
}

export type BeforeToolCall = (
  context: ToolGateContext,
  signal?: AbortSignal,
) => Promise<BeforeToolCallResult | undefined>

// Wrap a beforeToolCall with per-turn hard caps (Pha 3 budget guard): once the
// turn makes more than `maxToolCalls` tool calls, or runs past `maxWallclockMs`,
// every further tool call is blocked — a runaway-loop / cost backstop independent
// of the permission mode. No-op (returns the inner hook unchanged) when no cap is
// set. The block reason surfaces to the model as a tool error, so it sees why and
// stops. `startedAtMs` is the turn start (caller-supplied so the clock is testable).
export function withTurnBudget(
  inner: BeforeToolCall,
  budget: { maxToolCalls?: number; maxWallclockMs?: number; maxCostUsd?: number } | undefined,
  startedAtMs: number,
  // USD đã tiêu TỪ ĐẦU LƯỢT, đo được tại thời điểm gọi. Chỉ nhánh Pi truyền: ở đó
  // AWOG tự chạy vòng lặp nên phải tự chặn, còn nhánh Claude SDK có `maxBudgetUsd`
  // của chính SDK làm việc này tử tế hơn (dừng giữa một lời gọi model, không phải
  // đợi tới tool call kế tiếp). Absent ⇒ chiều tiền không được kiểm.
  spentUsd?: () => number,
): BeforeToolCall {
  const maxCalls = budget?.maxToolCalls
  const maxMs = budget?.maxWallclockMs
  const maxUsd = spentUsd ? budget?.maxCostUsd : undefined
  if (
    (maxCalls == null || maxCalls <= 0) &&
    (maxMs == null || maxMs <= 0) &&
    (maxUsd == null || maxUsd <= 0)
  ) {
    return inner
  }
  let calls = 0
  return async (context, signal) => {
    calls += 1
    if (maxCalls != null && maxCalls > 0 && calls > maxCalls) {
      return {
        block: true,
        reason: `Turn tool-call budget exceeded (${maxCalls}). Stopped to prevent a runaway loop — raise the cap in session config to continue.`,
      }
    }
    if (maxMs != null && maxMs > 0 && Date.now() - startedAtMs > maxMs) {
      return {
        block: true,
        reason: `Turn time budget exceeded (${Math.round(maxMs / 1000)}s). Stopped — raise the cap in session config to continue.`,
      }
    }
    // Trần TIỀN: đo ở biên tool call vì đó là điểm dừng an toàn duy nhất AWOG có
    // trong vòng lặp Pi. Hệ quả đã biết: một lượt chỉ sinh chữ (không gọi tool nào)
    // không bị chặn ở đây — hàng rào trước-lượt của send-message mới chặn nó.
    if (maxUsd != null && maxUsd > 0 && spentUsd && spentUsd() >= maxUsd) {
      return {
        block: true,
        reason: `Turn cost budget exceeded ($${maxUsd.toFixed(2)}). Stopped — raise the cap in session config to continue.`,
      }
    }
    return inner(context, signal)
  }
}

export function makeBeforeToolCall(
  canUseTool: CanUseTool | undefined,
  mode: AgentMode,
  sessionId?: string,
  // Auto-approve (Settings → Sessions). When true, gated tools run WITHOUT a
  // permission prompt — the user opted into auto-approval for this session. Plan
  // mode still blocks writes/exec below (planning is read-only by design); auto-
  // approve only short-circuits the ask/accept-edits prompt path.
  autoApprove = false,
  // Per-source P4 gate (trust:'prompt' + allowedMcpPatterns). Absent/empty → no
  // behaviour change (default sources gate exactly as before). ADR 0060.
  sourceGate?: SourceGateConfig,
  // Per-session SSH approval mode (ADR 0064 P2). Governs the gated SSH tools
  // (ssh_exec / ssh_write_file) INDEPENDENTLY of `mode`/`autoApprove`. Default
  // 'prompt' (ask every call). Inert unless an SSH tool is actually registered
  // (only run-stream's Pi path pushes them when the session links a host).
  sshApprovalMode: SshApprovalMode = 'prompt',
  // Thư mục làm việc THẬT của lượt (ADR 0080, việc còn lại của lượt 2). Luật quyền
  // viết đường dẫn tương đối (`Write(.env)`) phải được giải theo đúng thư mục lệnh
  // sẽ chạy — một phiên kéo-thả folder khác, hay một node task chạy trong worktree
  // riêng, đều KHÔNG nằm ở đường dẫn project. Bỏ trống ⇒ rơi về đường dẫn project
  // như trước. Đường dẫn tương đối vẫn chỉ có hiệu lực theo chiều DENY dù gốc đến
  // từ đâu: gốc suy ra có thể sai, mà đoán sai theo chiều CẤP QUYỀN là leo thang.
  cwd?: string,
  // Ngữ cảnh hạ tầng đang ghim + trần của phiên (ADR 0088 §5b). Vắng mặt ⇒ nhánh
  // hạ tầng vẫn chạy (ma trận vẫn được áp) nhưng prompt không nêu được
  // account/region, và mọi lời gọi rơi vào cột `normal`. Người gọi nối vào ở task
  // 0.8 (`SessionHeader.infra`) và 0.12 (tool `aws_cli`).
  infraGate?: InfraGateConfig,
): BeforeToolCall {
  const promptSourceIds =
    sourceGate?.promptSourceIds && sourceGate.promptSourceIds.length > 0
      ? new Set(sourceGate.promptSourceIds)
      : null
  const toolPatterns = sourceGate?.toolPatterns
  // A source tool that violates its OWN source's allowedMcpPatterns (ADR 0060 P4).
  const violatesSourceScope = (name: string): boolean => {
    if (!toolPatterns) return false
    const id = sourceIdOfTool(name)
    if (!id) return false
    const pats = toolPatterns[id]
    if (!pats || pats.length === 0) return false
    return !pats.some((re) => re.test(name))
  }
  // A tool belonging to a trust:'prompt' source (ADR 0060 P4) → routes through the
  // ask-gate. False for built-in + non-prompt-source tools.
  const isPromptTrustTool = (name: string): boolean => {
    if (!promptSourceIds) return false
    const id = sourceIdOfTool(name)
    return id !== null && promptSourceIds.has(id)
  }
  return async (context, signal) => {
    const toolName = context.toolCall.name
    const toolUseId = context.toolCall.id

    // A DENY rule is a hard guardrail the user wrote down on purpose, so it beats
    // EVERY relaxation below — execute mode, auto-approve, accept-edits, the SSH
    // gate's own 'auto' mode, and an approved argument override alike.
    const denyBlock = (name: string): BeforeToolCallResult => ({
      block: true,
      reason: denyReason(name),
    })

    // "Beats every relaxation" used to hold only when a rule MATCHED, and every way
    // of dodging the matcher was a way of dodging DENY — in execute mode a dodge ran
    // SILENTLY (`rm -rf /data;` picks up a `;`, so no single-command rule can match
    // it). That was false assurance, which is worse than no feature (F4).
    //
    // So: when the gate cannot read this call as a rule subject AT ALL — compound
    // command, oversized command, missing argument — and the user has a DENY rule
    // for this very tool, none of the relaxations apply and the call is asked.
    // Memoised: at most one lookup per tool call, and only on a path that was about
    // to skip the prompt.
    //
    // Deliberately NOT extended to "subject readable but no rule matched": that
    // would turn one Bash deny rule into an ask-prompt for every Bash call in
    // execute mode, and a mode nobody can use protects nobody.
    let denyGuard: boolean | undefined
    const guardedByDeny = async (): Promise<boolean> => {
      if (denyGuard === undefined) {
        denyGuard = await isUnreadableUnderDeny({
          toolName,
          args: context.args,
          ...(sessionId ? { sessionId } : {}),
        })
        if (denyGuard) {
          log.warn('permission gate: unreadable call under a deny rule; asking instead', {
            toolName,
            mode,
          })
        }
      }
      return denyGuard
    }

    // Defer to the UI permission prompt (park) and translate the answer. Shared by
    // the general gated path and the SSH-tool path. `forceRemember` = remember on
    // the FIRST approval regardless of an "always allow" click (SSH 'session' mode);
    // when false, only an explicit "always allow" (updatedPermissions) is remembered.
    // Never throws — any failure fails safe as a block.
    const promptViaUi = async (
      forceRemember: boolean,
      // SSH tools override these: `rememberKey` scopes the remembered allowance per
      // (session, host, tool) (F2); `offerAlwaysAllow=false` hides the "Always allow"
      // button, which no-ops for the SSH gate (it consults sshApprovalMode, not the
      // general allowlist — a dead button in 'prompt' mode, F6).
      // Nhánh hạ tầng thêm `decisionReason` (payload có cấu trúc: dòng lệnh,
      // account, lớp lệnh) và `description` (dòng lệnh dạng chữ cho bề mặt không
      // biết gì về hạ tầng). Cả hai đi thẳng vào `session.permission-request`
      // (sessions.send-message.ts) nên không cần đổi gì ở tầng phiên.
      opts?: {
        rememberKey?: string
        offerAlwaysAllow?: boolean
        decisionReason?: unknown
        description?: string
      },
    ): Promise<BeforeToolCallResult | undefined> => {
      const rememberKey = opts?.rememberKey ?? toolName
      const offerAlwaysAllow = opts?.offerAlwaysAllow ?? true
      if (!canUseTool) {
        // No gate supplied but the mode wants one — fail safe (block) rather than
        // silently allowing an unapproved mutation.
        log.warn('runtime beforeToolCall: no canUseTool in a gated mode; blocking', {
          toolName,
          mode,
        })
        return { block: true, reason: 'No permission handler available — blocked.' }
      }
      try {
        // canUseTool takes an options bag; we supply the fields it reads. `signal`
        // ties the prompt to the turn abort; toolUseID identifies the call. A
        // non-empty `suggestions` array is what makes the UI offer the "Always
        // allow" button — and the suggestion now spells out the EXACT rule that
        // will be created (ADR 0080). No rule can be derived (compound shell
        // command, missing/relative path…) ⇒ empty array ⇒ no "Always allow"
        // button: this call has to be answered on its own merits.
        const input = (context.args ?? {}) as Record<string, unknown>
        const suggestion = offerAlwaysAllow
          ? buildRuleSuggestion(toolName, context.args, sessionId)
          : null
        const suggestions: PermissionUpdate[] = suggestion ? [suggestion] : []
        const result = await canUseTool(toolName, input, {
          signal: signal ?? new AbortController().signal,
          toolUseID: toolUseId,
          suggestions,
          ...(opts?.decisionReason !== undefined ? { decisionReason: opts.decisionReason } : {}),
          ...(opts?.description !== undefined ? { description: opts.description } : {}),
        })
        if (result.behavior === 'allow') {
          // "Always allow" for a GENERAL tool is persisted by sessions.permission
          // itself (it owns the destination tier), so nothing is remembered here.
          // This branch only serves the SSH gate, whose 'session' mode remembers
          // the first approval under its own opaque (session, host, tool) key.
          if (sessionId && forceRemember) allowSessionTool(sessionId, rememberKey)
          // Apply an approved input override by mutating the validated args object
          // in place — Pi executes the tool with `context.args`.
          const hasOverride = result.updatedInput !== undefined
          if (hasOverride && context.args && typeof context.args === 'object') {
            // The rules above were evaluated against the ORIGINAL args. The user
            // may rewrite them, but a DENY rule must survive that rewrite — else
            // approving `ls` and overriding the command past a `Bash(rm -rf /)`
            // deny rule is a one-click bypass of the user's own guardrail (F13).
            if (!isSafeToolInputOverride(result.updatedInput)) {
              log.warn('runtime beforeToolCall: rejected an unsafe input override; blocking', {
                toolName,
              })
              return { block: true, reason: 'Rejected an unsafe argument override — blocked.' }
            }
            // CÙNG `cwd` với đường chính: nếu chỗ này giải đường dẫn tương đối
            // theo một gốc khác, ghi đè tham số trở thành đường vòng qua đúng luật
            // DENY mà nhánh trên vừa áp.
            const denied = await deniedToolName(toolName, result.updatedInput, {
              ...(sessionId ? { sessionId } : {}),
              ...(cwd ? { cwd } : {}),
            })
            if (denied) return denyBlock(denied)
            const target = context.args as Record<string, unknown>
            for (const key of Object.keys(target)) delete target[key]
            for (const [key, value] of Object.entries(result.updatedInput)) {
              target[key] = value
            }
          }
          return undefined
        }
        return { block: true, reason: result.message || 'Denied by user.' }
      } catch (err) {
        // Never throw out of beforeToolCall. Treat any failure as a block.
        log.warn('runtime beforeToolCall error; blocking', {
          toolName,
          err: err instanceof Error ? err.message : String(err),
        })
        return { block: true, reason: 'Permission check failed — blocked.' }
      }
    }

    // Per-source Explore scoping (ADR 0060 P4): a source tool outside its own
    // permissions.json allowedMcpPatterns is HARD-BLOCKED regardless of mode — the
    // source scoped ITSELF to a read-only subset. Checked first so the block holds
    // even in execute mode. No-op unless a source declared patterns.
    if (violatesSourceScope(toolName)) {
      return {
        block: true,
        reason: `Blocked by source permissions: ${toolName} is outside this source's allowed tool set (permissions.json allowedMcpPatterns).`,
      }
    }

    // Persisted permission rules (ADR 0080), evaluated session → project → user.
    // Never throws (any failure degrades to 'ask').
    //
    // Evaluated HERE — before every early return below — because a DENY rule must
    // apply to EVERY tool, exactly as the ADR promises. Previously this ran after
    // the `!builtInGated && !promptTrust` short-circuit, so `Read`, `Grep`, `Glob`,
    // `WebFetch`, `Task` and every `mcp__*` tool never reached it: a rule like
    // `{"rule":"WebFetch","action":"deny"}` parsed fine and did nothing (F3).
    const ruleDecision = await evaluatePermissionRules({
      toolName,
      args: context.args,
      ...(sessionId ? { sessionId } : {}),
      ...(cwd ? { cwd } : {}),
    })

    if (ruleDecision === 'deny') return denyBlock(toolName)

    // Và tra thêm tên TRẦN của một tool bắc cầu. Người dùng viết luật theo cái tên
    // họ NHÌN THẤY trong transcript (`dev_server`) — transcript đã gấp tên rồi — và
    // theo đúng cái tên `denyReason()` in ra. Thiếu bước này thì cùng một luật chặn
    // được trên Pi và im lặng vô hiệu trên nhánh anthropic.
    //
    // CHỈ chiều DENY, cố ý: đây là rào chắn người dùng tự dựng, còn chiều ALLOW thì
    // giữ nguyên tên đang chạy — một luật cấp quyền không nên nở ra thêm cách viết.
    const bareName = unbridgeAwogToolName(toolName)
    if (bareName !== toolName) {
      const bareDeny = await evaluatePermissionRules({
        toolName: bareName,
        args: context.args,
        ...(sessionId ? { sessionId } : {}),
        ...(cwd ? { cwd } : {}),
      })
      if (bareDeny === 'deny') return denyBlock(bareName)
    }

    // SSH tools (ADR 0064 P2): act on the session's LINKED remote host. Gating is
    // MANDATORY and driven ONLY by the per-session sshApprovalMode — NOT the session
    // AgentMode / autoApprove — so it's checked BEFORE the general `execute`/
    // `autoApprove` short-circuits and neither can bypass it. Plan mode blocks the
    // MUTATING tools (a remote command / write is not read-only) but leaves the READ
    // tools to the approval flow (remote reads aid investigation, like local reads).
    const sshName = sshToolName(toolName)
    if (sshName) {
      // A rule is written against the BARE tool name (`ssh_exec`); the anthropic
      // path calls the same tool bridged as `mcp__<server>__ssh_exec`. Evaluate the
      // bare alias too, before sshApprovalMode is consulted — otherwise the same
      // DENY rule would hold on one runtime and be ignored on the other (F3).
      if (sshName !== toolName) {
        const aliasDecision = await evaluatePermissionRules({
          toolName: sshName,
          args: context.args,
          ...(sessionId ? { sessionId } : {}),
          ...(cwd ? { cwd } : {}),
        })
        if (aliasDecision === 'deny') return denyBlock(sshName)
      }
      if (mode === 'plan' && SSH_MUTATING_TOOLS.has(sshName)) {
        return {
          block: true,
          reason: `Blocked in plan mode: ${sshName} mutates the remote host and is not allowed while planning.`,
        }
      }
      // No F4 guard here: SSH tools carry no rule subject (they are 'bare' kind), so
      // their calls are always readable and the guard could never fire.
      if (sshApprovalMode === 'auto') return undefined
      // Scope the remembered allowance per (session, host, BARE tool name), reading
      // the host from THIS call's `host` arg (unified model — the tool targets any
      // host). So approving ssh_exec on host A never auto-approves it on host B, and
      // the Pi + SDK forms of the same tool share one allowance. ssh_terminal_run has
      // no host arg (drives the watched shell) → keyed by name alone.
      const hostArg = (context.args as { host?: string } | undefined)?.host
      const sshKey = hostArg ? `${sshName}@${hostArg}` : sshName
      if (sshApprovalMode === 'session' && sessionId && isSessionToolAllowed(sessionId, sshKey)) {
        return undefined
      }
      // 'prompt' (every call) or 'session' first-use → park. 'session' remembers on
      // approval (forceRemember); 'prompt' never does. No "Always allow" button: the
      // SSH gate keys off sshApprovalMode, not the general allowlist (F6).
      return promptViaUi(sshApprovalMode === 'session', {
        rememberKey: sshKey,
        offerAlwaysAllow: false,
      })
    }

    // Lệnh hạ tầng (ADR 0088 §5, §5b): quyền đến từ MA TRẬN ở Settings, không từ
    // `AgentMode`. Đặt ở đây — trước `execute` / auto-approve / accept-edits —
    // chính là luật "Settings là trần": không mode nào nới được ô đã đặt ở
    // Settings, và phiên chỉ siết thêm được (`sessionFloor`).
    const infraCall = readInfraCall(toolName, context.args, infraGate?.context)
    if (infraCall) {
      // plan mode là read-only theo lời hứa, nên nó chặn CỨNG mọi lớp không phải
      // `read` trước khi hỏi ma trận — giống nhánh SSH. Nếu để ma trận quyết thì
      // một ô `auto` sẽ cho lệnh ghi chạy giữa lúc đang lập kế hoạch, trong khi
      // `Write` cùng phiên bị chặn.
      if (mode === 'plan' && infraCall.class !== 'read') {
        return {
          block: true,
          reason: `Blocked in plan mode: ${infraCall.command} is a ${infraCall.class} command and is not allowed while planning.`,
        }
      }
      // Cổng quyền KHÔNG được ném (hợp đồng đầu file). Đọc chính sách đã tự
      // phòng thủ; nhánh catch ở đây là lưới cuối và nó rơi về "hỏi", không rơi
      // về "cho chạy".
      let verdict: { mode: InfraMode; reason: string; accountKind: InfraAccountKind }
      try {
        const policy = await loadInfraPolicy()
        verdict = decide({
          policy,
          class: infraCall.class,
          ...(infraGate?.context?.accountId ? { accountId: infraGate.context.accountId } : {}),
          ...(infraGate?.sessionFloor ? { sessionFloor: infraGate.sessionFloor } : {}),
        })
      } catch (err) {
        log.warn('permission gate: infra policy lookup failed, asking instead', {
          toolName,
          err: err instanceof Error ? err.message : String(err),
        })
        verdict = { mode: 'ask', reason: 'matrix', accountKind: 'normal' }
      }

      if (verdict.mode === 'block') {
        return { block: true, reason: infraBlockReason(infraCall, verdict.accountKind) }
      }
      // 'auto' = ô ma trận (hoặc bypass tạm thời) cho chạy thẳng. Nhật ký vẫn có
      // đúng một dòng — `infra.run` ghi tại chỗ chạy, không phải tại cổng này.
      if (verdict.mode === 'auto') return undefined
      // 'ask' — park chờ người duyệt. Không có nút "Always allow": nhớ được một
      // lệnh hạ tầng là dựng nguồn sự thật thứ hai cạnh ma trận (ADR 0088 §6).
      return promptViaUi(false, {
        offerAlwaysAllow: false,
        decisionReason: infraPromptPayload(infraCall, verdict, infraGate?.context),
        description: infraCall.command,
      })
    }

    // `Artifact` mang một ĐƯỜNG DẪN CỤC BỘ ra khỏi máy thành trang có URL lưu bền.
    // Chặn ở đây, TRƯỚC mọi nới lỏng theo mode: `execute` và auto-approve đi vòng
    // qua lời hỏi theo đúng thiết kế, nên "đã hỏi rồi" không phải hàng rào cuối cho
    // một thao tác không thu hồi được. Lý do đầy đủ + vì sao `out_dir` KHÔNG bị bó
    // nằm ở claude-sdk/artifact.ts.
    if (isArtifactToolName(toolName)) {
      const violation = artifactPathViolation(context.args, cwd)
      if (violation) {
        log.warn('permission gate: blocking Artifact upload of a path outside scope', {
          toolName,
          reason: violation.reason,
        })
        return {
          block: true,
          reason:
            violation.reason === 'awog-home'
              ? `Blocked: ${violation.path} is inside AWOG's own config directory, which holds credentials. Artifact publishes file contents to a shareable URL, so this path can never be uploaded.`
              : `Blocked: ${violation.path} is outside this session's working directory and the scratchpad. Artifact publishes file contents to a shareable URL — copy the file into the workspace if you meant to publish it.`,
        }
      }
    }

    // Chặn trước mọi thứ khác: không mode nào, không luật ALLOW nào, không
    // auto-approve nào nới được đường ghi vào ma trận quyền và nhật ký.
    if (touchesProtectedPath(toolName, context.args)) {
      return {
        block: true,
        reason:
          'AWOG không cho ghi vào chính sách quyền hạ tầng hoặc nhật ký hoạt động. ' +
          'Đổi ma trận ở Settings → Hạ tầng; nhật ký chỉ người dùng dọn được.',
      }
    }

    const builtInGated = isGatedTool(toolName, context.args)
    const promptTrust = isPromptTrustTool(toolName)

    // Non-mutating built-in tool AND not a trust:'prompt' source tool: always allow
    // (a DENY rule for it was already applied above).
    if (!builtInGated && !promptTrust) return undefined

    // ── Lệnh hạ tầng chạy qua `Bash` (ADR 0088 §6) ────────────────────────────
    // Đặt TRƯỚC execute/auto-approve: nếu để sau, `execute` mode trả `undefined`
    // và lệnh chạm tài khoản thật chạy thẳng, không ai hỏi và không dòng nhật ký
    // nào — chính lỗ mà infosec audit #1 tìm ra ở 5/7 chiều.
    const bashInfra = bashInfraCall(toolName, context.args)
    if (bashInfra) {
      // Chuỗi shell không đọc sạch được ⇒ ép `write` (luôn hỏi). Không có đường
      // nào từ một chuỗi không chắc chắn dẫn tới `read`.
      const cls = bashInfra.clean ? classify(bashInfra.tool, bashInfra.argv) : 'write'
      let verdict: { mode: InfraMode; reason: string; accountKind: InfraAccountKind }
      try {
        const policy = await loadInfraPolicy()
        // ⚠ KHÔNG chấm theo account đang ghim (audit #1 F3). `Bash` chưa nhận được
        // `AWS_PROFILE` (bash-tool.ts vẫn gọi `filteredShellEnv()` trần), nên lệnh
        // thật chạy bằng profile `default` — mà ADR 0088 tự viết: "`default` rất
        // thường là production". Chấm theo account ghim sẽ in ra thẻ duyệt một cái
        // tên account mà lệnh KHÔNG chạm tới: duyệt nhầm có chứng cứ giả, tệ hơn là
        // không có chứng cứ. Nên tới khi env được luồn xuống, nhánh này luôn dùng
        // cột `production` — cột siết hơn — và không nêu account nào cả.
        verdict = decide({
          policy,
          class: cls,
          accountId: '__unverified__',
          ...(infraGate?.sessionFloor ? { sessionFloor: infraGate.sessionFloor } : {}),
        })
        verdict = { ...verdict, accountKind: 'production' }
      } catch {
        // Cổng quyền không được ném: chính sách đọc hỏng ⇒ rơi về "hỏi".
        verdict = { mode: 'ask', reason: 'matrix', accountKind: 'normal' }
      }
      if (mode === 'plan' && cls !== 'read') {
        return { block: true, reason: `Blocked in plan mode: ${toolName} is not allowed while planning.` }
      }
      // Ghi nhật ký cho ĐƯỜNG BASH (audit #1 F5). `runInfra()` không tham gia đường
      // này mà nhật ký lại được ghi ở đó, nên trước bản vá mọi lệnh hạ tầng chạy
      // qua `Bash` — kể cả lệnh vừa được duyệt, kể cả lớp phá huỷ — không để lại
      // dòng nào. Câu "app đã làm gì trên account của tôi" vì thế trả lời SAI theo
      // hướng trấn an. Ghi cả khi verdict là `auto`.
      const noteBash = (decision: 'auto' | 'approved' | 'blocked'): void => {
        void recordInfraAction({
          actor: 'agent:assistant',
          ...(sessionId ? { sessionId } : {}),
          surface: 'session',
          tool: 'Bash',
          argv: bashInfra.argv,
          context: {},
          class: cls,
          decision,
          result: { summary: String(argBag(context.args)?.command ?? '').slice(0, 400) },
        }).catch(() => {
          /* nhật ký hỏng không được chặn cổng quyền — lỗi đã log ở tầng store */
        })
      }

      if (verdict.mode === 'block') {
        noteBash('blocked')
        return {
          block: true,
          reason: infraBlockReason(
            { name: toolName, class: cls, command: String(argBag(context.args)?.command ?? '') },
            verdict.accountKind,
          ),
        }
      }
      if (verdict.mode === 'ask') {
        noteBash('approved')
        // Cùng payload với tool `aws_cli` nên thẻ duyệt vẽ được account/lớp lệnh —
        // trước bản này đường Bash chỉ ra một thẻ trơn, người duyệt không biết
        // lệnh chạm tài khoản nào. `offerAlwaysAllow: false`: lệnh hạ tầng không
        // bao giờ nhớ được (task 0.14).
        return promptViaUi(false, {
          offerAlwaysAllow: false,
          // `undefined` ngữ cảnh: xem chú thích F3 ở trên — không in account mà lệnh
          // sẽ không chạm tới. Thẻ duyệt vẫn có dòng lệnh đầy đủ và lớp lệnh.
          decisionReason: infraPromptPayload(
            { name: toolName, class: cls, command: String(argBag(context.args)?.command ?? '') },
            verdict,
            undefined,
          ),
        })
      }
      noteBash('auto')
      // `auto`: rơi xuống, đi tiếp đường thường bên dưới.
    }

    // execute mode: no gate (the user opted into full access) — unless the gate
    // cannot read this call while a DENY rule for the tool exists (F4).
    if (mode === 'execute' && !(await guardedByDeny())) return undefined

    // plan mode: block every write/exec — planning is read-only. Only the built-in
    // write/exec set is hard-blocked; a trust:'prompt' source tool (not a write)
    // still routes through the ask path below so a read can be approved. Checked
    // BEFORE auto-approve so plan mode stays read-only even with auto-approve on.
    if (mode === 'plan' && builtInGated) {
      return { block: true, reason: `Blocked in plan mode: ${toolName} is not allowed while planning.` }
    }

    // An ALLOW rule matched this call's CONTENT (this exact command / this file),
    // not merely its tool name — skip the prompt.
    //
    // Trừ lệnh hạ tầng chạy qua `Bash` (ADR 0088 §6, task 0.14): một luật
    // `Bash(aws …)` — dù được ghi từ trước lúc có ma trận, hay viết tay — không
    // được phủ chúng, nếu không sẽ có hai nguồn sự thật về quyền hạ tầng và người
    // dùng tin nhầm cái yếu hơn. Nút "Always allow" đã bị gỡ ở `buildRuleSuggestion`;
    // dòng này bịt nốt đường luật CŨ, nên mỗi lần gọi là một lần hỏi.
    const infraBash = bashInfraBinary(toolName, context.args)
    if (ruleDecision === 'allow' && !infraBash) return undefined

    // Auto-approve (Settings → Sessions): allow gated tools without prompting. Sits
    // after the plan-mode block (planning stays read-only) but before the ask path.
    // Same F4 guard as execute mode.
    if (autoApprove && !(await guardedByDeny())) return undefined

    // accept-edits: auto-allow file edits; other gated tools (Bash) still prompt.
    if (mode === 'accept-edits' && WRITE_TOOLS.has(toolName) && !(await guardedByDeny())) {
      return undefined
    }

    // ask (and accept-edits for Bash): defer to the UI permission prompt.
    return promptViaUi(false)
  }
}
