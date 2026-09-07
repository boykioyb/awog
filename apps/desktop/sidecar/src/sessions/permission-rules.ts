// Luật quyền gắn với NỘI DUNG lời gọi tool, không chỉ tên tool (ADR 0080).
//
// Lỗ hổng cũ: "always allow" nhớ theo `toolName`, nên cho phép `git status` một
// lần là MỌI lệnh Bash trong phiên được mở khoá (kể cả `rm -rf /`). Ở đây một
// luật khoá theo tham số quyết định mức nguy hiểm:
//
//   Bash(git status)        — đúng một lệnh, so khớp nguyên văn
//   Bash(npm run *)         — `*` là ký tự đại diện TƯỜNG MINH
//   Write(/abs/path/**)     — theo đường dẫn tuyệt đối
//   RunWorkflow             — tool không có tham số quyết định ⇒ luật trần theo tên
//
// Bốn ràng buộc bất di bất dịch:
//   1. Default-deny — không khớp ⇒ vẫn hỏi. Không có ký tự đại diện ngầm.
//   2. Không regex do người dùng nhập (ReDoS + khó đọc). Glob tự implement, có
//      test, độ dài bị chặn trên.
//   3. Lệnh chứa toán tử shell (`;` `&&` `||` `|` backtick `$( )` xuống dòng…)
//      KHÔNG BAO GIỜ khớp một luật lệnh đơn ⇒ `git status; rm -rf /` phải hỏi.
//   4. File luật trên đĩa là dữ liệu L1 KHÔNG TIN: validate TỪNG ENTRY bằng zod,
//      entry hỏng thì bỏ qua + log, không làm sập sidecar và KHÔNG kéo theo cả
//      file (một typo không được phép xoá sổ mọi luật DENY — xem F2 dưới).
//
// Ba tầng luật, áp theo thứ tự session → project → user; DENY luôn thắng ALLOW ở
// mọi tầng.
//
// ─── Đính chính bảo mật 2026-09-07 (infosec audit ADR 0080) ──────────────────
//
// F1 — Luật tầng "project" KHÔNG còn nằm trong repo. Trước đây tầng này đọc
//   `{project}/.awog/permission-rules.json`, tức một file DO NGƯỜI KHÁC COMMIT:
//   clone một repo có `{"rules":[{"rule":"Bash(*)"}]}` là mọi lệnh shell chạy
//   không hỏi. Giờ luật project nằm trong AWOG home, khoá theo băm của đường dẫn
//   tuyệt đối: `~/.awog/permission-rules/<sha256(path)[0..32]>.json`. Ngữ nghĩa
//   mới là "dự án này TRÊN MÁY NÀY" — cấp quyền không bao giờ đi theo git sang
//   máy người khác. File cũ trong repo bị BỎ QUA (chỉ log.warn, không migrate:
//   chính nội dung đó là thứ không đáng tin).
//
// F2 — Một entry hỏng không còn giết cả file: validate từng phần tử, giữ phần
//   còn lại. Và khi file hiện tại không parse được thì `saveRuleToFile` NÉM LỖI
//   thay vì ghi đè — trước đây nó coi file hỏng như rỗng rồi ghi đè, xoá vĩnh
//   viễn các luật DENY người dùng đã viết.
//
// F9 — Matcher tái sử dụng buffer DP (không cấp phát theo token), cache token
//   hoá pattern, quét MỘT lượt thay vì hai, và có trần công việc mỗi lần đánh
//   giá (vượt trần ⇒ 'ask', không bao giờ 'allow').

import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { awogHome } from '../util/path.js'
import { log } from '../util/logger.js'

// ─── Kiểu ────────────────────────────────────────────────────────────────────

export type PermissionRuleAction = 'allow' | 'deny'
export type PermissionRuleScope = 'session' | 'project' | 'user'
export type PermissionRuleDecision = 'allow' | 'deny' | 'ask'

// Loại "chủ thể" mà luật khoá vào: lệnh shell, đường dẫn file, hoặc không có
// (tool không mang tham số quyết định mức nguy hiểm ⇒ luật trần theo tên tool).
export type PermissionRuleKind = 'command' | 'path' | 'bare'

export interface RuleSubject {
  kind: PermissionRuleKind
  value: string
}

export interface ParsedPermissionRule {
  // Văn bản chuẩn hoá của luật — CHÍNH LÀ thứ hiện cho người dùng đọc trước khi
  // đồng ý (chống "đồng ý mù").
  text: string
  toolName: string
  // null khi kind === 'bare'.
  pattern: string | null
  kind: PermissionRuleKind
  action: PermissionRuleAction
}

// Một entry như nó nằm trên đĩa. `| undefined` tường minh vì tsconfig bật
// `exactOptionalPropertyTypes` và zod trả về field optional dạng `T | undefined`.
export interface StoredPermissionRule {
  rule: string
  action?: PermissionRuleAction | undefined
  createdAt?: string | undefined
}

// ─── Giới hạn (chặn ReDoS / file luật phình) ─────────────────────────────────

const MAX_TOOL_NAME = 128
const MAX_PATTERN = 512
const MAX_SUBJECT = 4096
const MAX_RULES_PER_FILE = 500
const MAX_STARS = 8
// Trần công việc cho MỘT lần đánh giá (F9). Cổng quyền chạy trên mọi lời gọi
// tool nên số luật được xét phải có trần cứng. Vượt trần ⇒ 'ask' (fail-safe:
// không bao giờ trả 'allow' từ một lượt quét dở dang).
const MAX_RULES_PER_EVAL = 1500
// Số pattern giữ trong cache token hoá. Vượt thì xoá sạch (cache đơn giản, không
// cần LRU: pattern trong một máy thật đếm bằng chục).
const MAX_TOKEN_CACHE = 512

// ─── Bảng tool → tham số quyết định mức nguy hiểm ────────────────────────────
// Chỉ tool ở hai bảng này mới được khoá theo nội dung. Tool khác giữ luật trần
// theo tên (blast radius hẹp hơn hẳn Bash / ghi file).

const COMMAND_ARG_KEYS: Record<string, readonly string[]> = {
  Bash: ['command'],
}

const PATH_ARG_KEYS: Record<string, readonly string[]> = {
  Write: ['file_path', 'path'],
  Edit: ['file_path', 'path'],
  MultiEdit: ['file_path', 'path'],
  NotebookEdit: ['notebook_path', 'file_path', 'path'],
}

// Tool ĐỌC có tham số đường dẫn (F3). Chúng KHÔNG bị cổng quyền chặn (đọc là
// không đột biến) nên ở đây chỉ phục vụ luật DENY: người dùng muốn viết
// `Read(/Users/x/.ssh/**)` với action `deny` để cấm agent đọc một vùng file.
// Khác hai bảng trên ở chỗ luật TRẦN vẫn hợp lệ (`Read` = cấm đọc mọi thứ) —
// `Bash` trần thì không, vì nó chính là lỗ hổng cũ viết lại bằng tay.
const READ_PATH_ARG_KEYS: Record<string, readonly string[]> = {
  Read: ['file_path', 'notebook_path', 'path'],
  Grep: ['path'],
  Glob: ['path'],
}

export function ruleKindOfTool(toolName: string): PermissionRuleKind {
  if (COMMAND_ARG_KEYS[toolName]) return 'command'
  if (PATH_ARG_KEYS[toolName]) return 'path'
  return 'bare'
}

// ─── Toán tử shell ───────────────────────────────────────────────────────────
// Bất kỳ ký tự nào dưới đây đều có thể biến MỘT lệnh thành NHIỀU lệnh, hoặc kéo
// dữ liệu từ nơi khác vào: `;` `&` `|` backtick `$` `<` `>` `(` `)` `{` `}` `\`
// `!`. Quét THÔ, không phân biệt trong/ngoài dấu nháy — cố ý: nhận nhầm chỉ dẫn
// tới "hỏi lại người dùng" (fail-safe), còn bỏ sót là leo thang quyền.
const SHELL_OPERATOR_RE = /[;&|`$<>(){}\\!]/

export function hasShellOperator(command: string): boolean {
  if (SHELL_OPERATOR_RE.test(command)) return true
  for (let i = 0; i < command.length; i += 1) {
    const code = command.charCodeAt(i)
    // Ký tự điều khiển (xuống dòng, CR, NUL…) — tab vẫn coi là khoảng trắng hợp lệ.
    if (code === 0x09) continue
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

// ─── Chuẩn hoá chủ thể ───────────────────────────────────────────────────────

// Lệnh: CHỈ cắt khoảng trắng hai đầu. Cố ý không gộp khoảng trắng bên trong —
// gộp lại là đổi ngữ nghĩa lệnh mà vẫn khớp luật cũ; lệch một khoảng trắng thì
// chỉ việc hỏi lại.
function normalizeCommand(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_SUBJECT) return null
  return trimmed
}

// Đường dẫn: đổi `\` → `/`, gộp `//`, bỏ `.`; PHẢI tuyệt đối và KHÔNG được chứa
// đoạn `..` (path traversal — xem invariant 2).
function normalizePathValue(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_SUBJECT) return null
  if (trimmed.includes('\0')) return null
  if (!isAbsolute(trimmed)) return null
  const slashed = trimmed.replace(/\\/g, '/')
  const parts = slashed.split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '..') return null
    if (part === '.') continue
    out.push(part)
  }
  // Giữ lại dấu `/` mở đầu (phần tử rỗng đầu tiên) của đường dẫn POSIX.
  const joined = out.join('/').replace(/\/{2,}/g, '/')
  return joined.length > 0 ? joined : '/'
}

// Giá trị đường dẫn đầu tiên dùng được trong `args` theo danh sách khoá.
function firstPathArg(keys: readonly string[], args: unknown): string | null {
  const bag = args && typeof args === 'object' ? (args as Record<string, unknown>) : null
  if (!bag) return null
  for (const key of keys) {
    const raw = bag[key]
    if (typeof raw !== 'string') continue
    return normalizePathValue(raw)
  }
  return null
}

// Chủ thể của lời gọi tool này, hoặc null khi tool CÓ tham số quyết định nhưng
// tham số không dùng được (thiếu, sai kiểu, chứa toán tử shell, đường dẫn tương
// đối). null ⇒ không luật nào khớp ⇒ luôn hỏi (default-deny).
export function ruleSubject(toolName: string, args: unknown): RuleSubject | null {
  const kind = ruleKindOfTool(toolName)
  if (kind === 'bare') return { kind, value: '' }
  const bag = args && typeof args === 'object' ? (args as Record<string, unknown>) : null
  if (!bag) return null
  const keys = kind === 'command' ? COMMAND_ARG_KEYS[toolName] : PATH_ARG_KEYS[toolName]
  for (const key of keys ?? []) {
    const raw = bag[key]
    if (typeof raw !== 'string') continue
    if (kind === 'command') {
      const cmd = normalizeCommand(raw)
      if (!cmd) return null
      // Lệnh ghép ⇒ không luật đơn nào được phép khớp.
      if (hasShellOperator(cmd)) return null
      return { kind, value: cmd }
    }
    const path = normalizePathValue(raw)
    if (!path) return null
    return { kind, value: path }
  }
  return null
}

// MỌI chủ thể mà một luật có thể khớp cho lời gọi này. Với tool đọc (Read/Grep/
// Glob) có hai: luật trần `Read` và luật đường dẫn `Read(/x/**)` — cả hai đều
// phải khớp được, nếu không luật DENY người dùng viết sẽ im lặng vô tác dụng
// (F3). null ⇒ giữ nguyên nghĩa default-deny của `ruleSubject`.
function matchSubjects(toolName: string, args: unknown): RuleSubject[] | null {
  const primary = ruleSubject(toolName, args)
  if (!primary) return null
  if (primary.kind !== 'bare') return [primary]
  const keys = READ_PATH_ARG_KEYS[toolName]
  if (!keys) return [primary]
  const path = firstPathArg(keys, args)
  return path ? [primary, { kind: 'path', value: path }] : [primary]
}

// ─── Phân tích văn bản luật ──────────────────────────────────────────────────

const TOOL_NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/

// `ToolName` hoặc `ToolName(pattern)`. Trả null cho mọi luật không hợp lệ —
// caller ghi log rồi BỎ QUA entry đó (file trên đĩa là L1 không tin).
export function parsePermissionRule(
  text: string,
  action: PermissionRuleAction = 'allow',
): ParsedPermissionRule | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > MAX_TOOL_NAME + MAX_PATTERN + 2) return null
  const open = trimmed.indexOf('(')
  const toolName = open === -1 ? trimmed : trimmed.slice(0, open)
  if (toolName.length > MAX_TOOL_NAME || !TOOL_NAME_RE.test(toolName)) return null
  const kind = ruleKindOfTool(toolName)

  if (open === -1) {
    // Luật trần chỉ hợp lệ cho tool không có tham số quyết định — nếu không,
    // `Bash` trần chính là lỗ hổng cũ được viết lại bằng tay.
    if (kind !== 'bare') return null
    return { text: toolName, toolName, pattern: null, kind, action }
  }

  if (!trimmed.endsWith(')')) return null
  const pattern = trimmed.slice(open + 1, -1)
  // Tool đọc có tham số đường dẫn: luật CÓ pattern đọc theo kind 'path' (F3).
  const patternKind: PermissionRuleKind =
    kind === 'bare' && READ_PATH_ARG_KEYS[toolName] ? 'path' : kind
  if (patternKind === 'bare') return null
  if (!pattern || pattern.length > MAX_PATTERN) return null
  if (hasControlChar(pattern)) return null
  if (countStars(pattern) > MAX_STARS) return null
  if (patternKind === 'path') {
    const normalized = normalizePattern(pattern)
    if (!normalized) return null
    return {
      text: `${toolName}(${normalized})`,
      toolName,
      pattern: normalized,
      kind: patternKind,
      action,
    }
  }
  return { text: `${toolName}(${pattern})`, toolName, pattern, kind: patternKind, action }
}

function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

function countStars(value: string): number {
  let n = 0
  for (const ch of value) if (ch === '*') n += 1
  return n
}

// Pattern đường dẫn: phải tuyệt đối hoặc mở đầu bằng ký tự đại diện, và KHÔNG
// được chứa `..` (một pattern như `/repo/../../etc/**` là path traversal đội lốt
// luật quyền).
function normalizePattern(pattern: string): string | null {
  const slashed = pattern.replace(/\\/g, '/')
  if (slashed.split('/').some((p) => p === '..')) return null
  if (!isAbsolute(slashed) && !slashed.startsWith('*')) return null
  return slashed.replace(/\/{2,}/g, '/')
}

// ─── Glob matcher ────────────────────────────────────────────────────────────
// Ngữ nghĩa:
//   kind 'command' — `*` khớp mọi ký tự (lệnh đã được bảo đảm không có toán tử).
//   kind 'path'    — `*` khớp mọi ký tự TRỪ `/`, `**` khớp cả `/`.
// Không hỗ trợ `?`, lớp ký tự, hay bất kỳ cú pháp regex nào: ngữ pháp càng nhỏ
// càng dễ audit.

type GlobToken = { kind: 'lit'; text: string } | { kind: 'star'; cross: boolean }

function tokenize(pattern: string, crossAll: boolean): GlobToken[] {
  const tokens: GlobToken[] = []
  let lit = ''
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] !== '*') {
      lit += pattern[i]
      continue
    }
    const double = pattern[i + 1] === '*'
    if (double) i += 1
    if (lit) {
      tokens.push({ kind: 'lit', text: lit })
      lit = ''
    }
    const cross = crossAll || double
    const last = tokens[tokens.length - 1]
    // Gộp các sao liền nhau: `***` ≡ `**`.
    if (last && last.kind === 'star') last.cross = last.cross || cross
    else tokens.push({ kind: 'star', cross })
  }
  if (lit) tokens.push({ kind: 'lit', text: lit })
  return tokens
}

// Token hoá là hàm thuần của (pattern, kind) và pattern lặp lại ở mọi lời gọi
// tool ⇒ nhớ lại (F9). Khoá có tiền tố kind vì `*` đổi nghĩa theo kind.
const TOKEN_CACHE = new Map<string, GlobToken[]>()

function tokensOf(pattern: string, kind: PermissionRuleKind): GlobToken[] {
  const key = `${kind} ${pattern}`
  const hit = TOKEN_CACHE.get(key)
  if (hit) return hit
  const tokens = tokenize(pattern, kind === 'command')
  if (TOKEN_CACHE.size >= MAX_TOKEN_CACHE) TOKEN_CACHE.clear()
  TOKEN_CACHE.set(key, tokens)
  return tokens
}

// Hai buffer DP dùng chung cho mọi lần so khớp (F9): matcher là hàm ĐỒNG BỘ nên
// không có hai lượt quét lồng nhau, và mỗi lượt tự xoá phần nó dùng (0..n).
// Trước đây mỗi token cấp phát một `Uint8Array` mới ⇒ 500 luật × 3 tầng × mỗi
// lời gọi tool là rất nhiều rác.
const DP_BUFFERS = [new Uint8Array(MAX_SUBJECT + 1), new Uint8Array(MAX_SUBJECT + 1)] as const

export function matchesPattern(pattern: string, value: string, kind: PermissionRuleKind): boolean {
  if (kind === 'bare') return pattern.length === 0
  if (value.length > MAX_SUBJECT || pattern.length > MAX_PATTERN) return false
  const tokens = tokensOf(pattern, kind)
  const n = value.length
  // Quy hoạch động: reachable[j] = "khớp hết token đã duyệt tới vị trí j".
  let cur = 0
  let reachable = DP_BUFFERS[cur]
  reachable.fill(0, 0, n + 1)
  reachable[0] = 1
  for (const token of tokens) {
    const next = DP_BUFFERS[cur === 0 ? 1 : 0]
    next.fill(0, 0, n + 1)
    if (token.kind === 'lit') {
      for (let j = 0; j <= n; j += 1) {
        if (!reachable[j]) continue
        if (value.startsWith(token.text, j)) next[j + token.text.length] = 1
      }
    } else {
      // `filled` giữ tiến độ đã tô để mỗi vị trí chỉ được duyệt một lần
      // (amortized O(n) cho mỗi sao — chặn đường bùng nổ kiểu ReDoS).
      let filled = 0
      for (let j = 0; j <= n; j += 1) {
        if (!reachable[j]) continue
        const start = Math.max(j, filled)
        for (let k = start; k <= n; k += 1) {
          next[k] = 1
          filled = k + 1
          if (!token.cross && value[k] === '/') break
        }
      }
    }
    cur = cur === 0 ? 1 : 0
    reachable = next
  }
  return reachable[n] === 1
}

// ─── Sinh luật gợi ý cho nút "Always allow" ──────────────────────────────────

// Luật SẼ được tạo nếu người dùng bấm "Always allow" cho lời gọi này — nguyên
// văn, không ký tự đại diện ngầm. null ⇒ KHÔNG được phép nhớ (lệnh ghép, thiếu
// tham số…) ⇒ UI không hiện nút.
export function suggestRuleText(toolName: string, args: unknown): string | null {
  if (!TOOL_NAME_RE.test(toolName) || toolName.length > MAX_TOOL_NAME) return null
  const subject = ruleSubject(toolName, args)
  if (!subject) return null
  // Chủ thể chứa `*` thật (vd `git add *`) sẽ bị đọc thành ký tự đại diện nếu
  // ghi thẳng vào luật ⇒ mở quyền rộng hơn thứ người dùng nhìn thấy. Ngữ pháp
  // không có cơ chế escape, nên trường hợp này không được gợi ý.
  if (subject.kind !== 'bare' && subject.value.includes('*')) return null
  const text = subject.kind === 'bare' ? toolName : `${toolName}(${subject.value})`
  // Đi qua đúng parser mà tầng lưu trữ dùng: nếu luật sinh ra không parse được
  // thì thà không gợi ý còn hơn ghi xuống một luật không bao giờ khớp.
  return parsePermissionRule(text) ? text : null
}

// ─── Tầng session (bộ nhớ tiến trình) ────────────────────────────────────────
// Luật session sống theo vòng đời sidecar, không bao giờ ghi xuống đĩa. Xoá khi
// xoá phiên (sessions/permissions.ts → clearSessionPermissions).

const SESSION_RULES = new Map<string, ParsedPermissionRule[]>()

export function addSessionRule(sessionId: string, rule: ParsedPermissionRule): void {
  const list = SESSION_RULES.get(sessionId)
  if (!list) {
    SESSION_RULES.set(sessionId, [rule])
    return
  }
  if (list.some((r) => r.text === rule.text && r.action === rule.action)) return
  // Cùng trần với tầng file: tầng session cũng phải có trần, nếu không một phiên
  // dài có thể phình danh sách luật vô hạn (F9).
  if (list.length >= MAX_RULES_PER_FILE) {
    log.warn('permission rules: session tier is full, rule dropped', {
      sessionId,
      rule: rule.text,
    })
    return
  }
  list.push(rule)
}

export function getSessionRules(sessionId: string): ParsedPermissionRule[] {
  return SESSION_RULES.get(sessionId) ?? []
}

export function clearSessionRules(sessionId: string): void {
  SESSION_RULES.delete(sessionId)
}

// ─── Tầng file (project + user) ──────────────────────────────────────────────

const RULE_FILE_NAME = 'permission-rules.json'
const PROJECT_RULE_DIR = 'permission-rules'

// Schema của MỘT entry. Cố ý KHÔNG có schema cho cả file: validate cả file là
// cách một typo xoá sổ mọi luật (F2). Cả file chỉ cần đúng một điều: `rules` là
// một mảng.
const StoredRuleSchema = z.object({
  rule: z.string().min(1).max(MAX_TOOL_NAME + MAX_PATTERN + 2),
  action: z.enum(['allow', 'deny']).optional(),
  createdAt: z.string().optional(),
})

export function userRuleFile(): string {
  return resolve(awogHome(), RULE_FILE_NAME)
}

// F1 — Luật tầng project sống trong AWOG home, KHÔNG trong repo.
//
// Khoá = 32 ký tự hex đầu của sha256 đường dẫn tuyệt đối đã chuẩn hoá:
//   - ổn định theo đường dẫn (cùng project ⇒ cùng file, qua mọi lần khởi động);
//   - là tên file an toàn theo cấu tạo (chỉ [0-9a-f]) — hàm KHÔNG BAO GIỜ nhận
//     đường dẫn thô làm tên file, nên không có đường path traversal;
//   - một chiều: nội dung thư mục không tiết lộ danh sách project.
// Đổi tên/di chuyển thư mục project ⇒ khoá khác ⇒ luật cũ không còn áp dụng
// (fail-safe: hỏi lại, không cấp nhầm quyền cho một thư mục khác).
export function projectRuleFile(projectPath: string): string | null {
  if (!projectPath || !isAbsolute(projectPath)) return null
  // `resolve` gộp `.`/`..` và bỏ dấu `/` thừa ⇒ nhiều cách viết cùng một project
  // cho ra cùng một khoá.
  const normalized = resolve(projectPath)
  const key = createHash('sha256').update(normalized).digest('hex').slice(0, 32)
  return resolve(awogHome(), PROJECT_RULE_DIR, `${key}.json`)
}

// Vị trí CŨ (trong repo) — chỉ còn dùng để cảnh báo, không bao giờ để nạp.
function legacyProjectRuleFile(projectPath: string): string {
  return resolve(projectPath, '.awog', RULE_FILE_NAME)
}

const LEGACY_CHECKED = new Set<string>()

// Cảnh báo đúng một lần mỗi project mỗi tiến trình nếu còn file luật cũ nằm
// trong repo. KHÔNG migrate: nội dung đó do bất kỳ ai commit vào repo cũng ghi
// được, tức là chính thứ không đáng tin (F1).
async function warnLegacyProjectRuleFile(projectPath: string): Promise<void> {
  if (LEGACY_CHECKED.has(projectPath)) return
  LEGACY_CHECKED.add(projectPath)
  const legacy = legacyProjectRuleFile(projectPath)
  try {
    await stat(legacy)
  } catch {
    return
  }
  log.warn(
    'permission rules: in-repo rule file IGNORED (rules committed to a repo are untrusted); project rules now live in AWOG home',
    { legacy, current: projectRuleFile(projectPath) },
  )
}

interface FileCacheEntry {
  // Lần cuối thực sự `stat` file. Trong TTL thì bỏ qua stat luôn — cổng quyền
  // giờ chạy trên MỌI lời gọi tool (F3) nên không được đọc đĩa mỗi lần.
  checkedAt: number
  mtimeMs: number
  size: number
  rules: ParsedPermissionRule[]
}

const FILE_CACHE = new Map<string, FileCacheEntry>()
const STAT_TTL_MS = 1000

type RawRuleFile =
  | { status: 'missing' }
  | { status: 'corrupt'; reason: string }
  | { status: 'ok'; entries: unknown[] }

// Đọc thô: chỉ đòi hỏi JSON hợp lệ + `rules` là mảng. Từng phần tử để nguyên
// dạng `unknown` — validate ở tầng trên, theo TỪNG entry.
async function readRawRuleFile(file: string): Promise<RawRuleFile> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { status: 'missing' }
    return { status: 'corrupt', reason: `unreadable: ${code ?? String(err)}` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    return { status: 'corrupt', reason: err instanceof Error ? err.message : 'invalid JSON' }
  }
  if (!parsed || typeof parsed !== 'object') return { status: 'corrupt', reason: 'not an object' }
  const rules = (parsed as { rules?: unknown }).rules
  if (!Array.isArray(rules)) return { status: 'corrupt', reason: '`rules` is not an array' }
  return { status: 'ok', entries: rules }
}

// Đọc + validate file luật. File thiếu / hỏng toàn phần ⇒ mảng rỗng: một file
// luật hỏng KHÔNG được phép làm sập gate, và cũng không được phép cho qua thứ
// gì. Entry hỏng lẻ ⇒ bỏ qua đúng entry đó, phần còn lại VẪN có hiệu lực (F2).
async function loadRuleFile(file: string): Promise<ParsedPermissionRule[]> {
  const now = Date.now()
  const cached = FILE_CACHE.get(file)
  if (cached && now - cached.checkedAt < STAT_TTL_MS) return cached.rules
  let mtimeMs = 0
  let size = 0
  try {
    const st = await stat(file)
    mtimeMs = st.mtimeMs
    size = st.size
  } catch {
    FILE_CACHE.delete(file)
    return []
  }
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
    cached.checkedAt = now
    return cached.rules
  }
  const raw = await readRawRuleFile(file)
  let rules: ParsedPermissionRule[] = []
  if (raw.status === 'corrupt') {
    log.warn('permission rules: rule file is corrupt, ignored (rules will not apply)', {
      file,
      reason: raw.reason,
    })
  } else if (raw.status === 'ok') {
    rules = parseRawEntries(raw.entries, file)
  }
  FILE_CACHE.set(file, { checkedAt: now, mtimeMs, size, rules })
  return rules
}

// Validate TỪNG phần tử. Một entry sai kiểu / sai cú pháp bị bỏ + log; các entry
// còn lại giữ nguyên hiệu lực — trước đây một typo làm rỗng cả file, tức là mọi
// luật DENY người dùng viết biến mất im lặng (fail-open).
function parseRawEntries(entries: unknown[], file: string): ParsedPermissionRule[] {
  const out: ParsedPermissionRule[] = []
  for (const entry of entries) {
    if (out.length >= MAX_RULES_PER_FILE) {
      log.warn('permission rules: file exceeds the rule cap, extra entries ignored', {
        file,
        cap: MAX_RULES_PER_FILE,
      })
      break
    }
    const validated = StoredRuleSchema.safeParse(entry)
    if (!validated.success) {
      log.warn('permission rules: skipped invalid entry', {
        file,
        issue: validated.error.issues[0]?.message ?? 'invalid',
      })
      continue
    }
    const parsed = parsePermissionRule(validated.data.rule, validated.data.action ?? 'allow')
    if (!parsed) {
      log.warn('permission rules: skipped malformed rule', { file, rule: validated.data.rule })
      continue
    }
    out.push(parsed)
  }
  return out
}

// Ghi atomic: viết file tạm cùng thư mục rồi rename (rename cùng volume là thao
// tác nguyên tử) — tránh để lại file luật cụt khi tiến trình chết giữa chừng.
// `projectPath` chỉ là ghi chú cho người đọc thư mục băm; KHÔNG bao giờ được
// dùng để giải ra đường dẫn file (khoá luôn tính từ đường dẫn thật lúc đọc).
async function writeRuleFileAtomic(
  file: string,
  rules: unknown[],
  projectPath?: string,
): Promise<void> {
  const doc = { version: 1, ...(projectPath ? { projectPath } : {}), rules }
  const body = `${JSON.stringify(doc, null, 2)}\n`
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`
  await mkdir(resolve(file, '..'), { recursive: true })
  await writeFile(tmp, body, { mode: 0o600 })
  await rename(tmp, file)
  FILE_CACHE.delete(file)
}

// Thêm một luật vào tầng file. Trùng (cùng text + action) thì no-op.
//
// File hiện tại không parse được ⇒ NÉM LỖI, không ghi đè (F2): đè lên một file
// hỏng là xoá vĩnh viễn các luật DENY người dùng đã viết. Người dùng phải tự mở
// file ra sửa — thông báo nói rõ đường dẫn.
export async function saveRuleToFile(
  file: string,
  rule: ParsedPermissionRule,
  projectPath?: string,
): Promise<{ saved: boolean }> {
  const raw = await readRawRuleFile(file)
  if (raw.status === 'corrupt') {
    throw new Error(
      `Permission rule file is corrupt, refusing to overwrite it (${raw.reason}): ${file}`,
    )
  }
  // Giữ NGUYÊN VĂN các entry đang có — kể cả entry hỏng: chúng vô hiệu lúc đọc,
  // nhưng xoá hộ người dùng thì không phải việc của hàm ghi.
  const entries: unknown[] = raw.status === 'ok' ? [...raw.entries] : []
  for (const entry of entries) {
    const validated = StoredRuleSchema.safeParse(entry)
    if (!validated.success) continue
    if (validated.data.rule === rule.text && (validated.data.action ?? 'allow') === rule.action) {
      return { saved: false }
    }
  }
  if (entries.length >= MAX_RULES_PER_FILE) {
    throw new Error(`Permission rule file is full (${MAX_RULES_PER_FILE} rules): ${file}`)
  }
  const next: StoredPermissionRule = {
    rule: rule.text,
    action: rule.action,
    createdAt: new Date().toISOString(),
  }
  entries.push(next)
  await writeRuleFileAtomic(file, entries, projectPath)
  return { saved: true }
}

// ─── Đường dẫn project của phiên ─────────────────────────────────────────────
// Nạp lười + cache: gate chạy trên mỗi lời gọi tool nên không được đọc đĩa dày.
// import động để module này (và test của nó) không kéo theo cả session manager.

const SESSION_PROJECT_PATH = new Map<string, string | null>()

export async function resolveSessionProjectPath(sessionId: string): Promise<string | null> {
  const cached = SESSION_PROJECT_PATH.get(sessionId)
  if (cached !== undefined) return cached
  let path: string | null = null
  try {
    const { sessionManager } = await import('./session-manager.js')
    const summary = sessionManager.getSessions().find((s) => s.id === sessionId)
    if (summary?.projectId) {
      const { loadProject } = await import('../projects/store.js')
      const project = await loadProject(summary.projectId)
      if (project?.path && isAbsolute(project.path)) path = project.path
    }
  } catch (err) {
    log.warn('permission rules: project path lookup failed', {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    })
  }
  SESSION_PROJECT_PATH.set(sessionId, path)
  return path
}

export function forgetSessionProjectPath(sessionId: string): void {
  SESSION_PROJECT_PATH.delete(sessionId)
}

// ─── Đánh giá ────────────────────────────────────────────────────────────────

export interface RuleQuery {
  toolName: string
  args: unknown
  sessionId?: string
  // Ghi đè đường dẫn project (test / caller đã biết sẵn). Bỏ trống ⇒ suy ra từ
  // phiên.
  projectPath?: string | null
}

function matchRule(
  rule: ParsedPermissionRule,
  subjects: readonly RuleSubject[],
  toolName: string,
): boolean {
  // Kiểm tra rẻ nhất trước: đại đa số luật không cùng tên tool ⇒ không chạm
  // matcher lần nào.
  if (rule.toolName !== toolName) return false
  for (const subject of subjects) {
    if (rule.kind !== subject.kind) continue
    if (rule.kind === 'bare') return true
    if (rule.pattern !== null && matchesPattern(rule.pattern, subject.value, rule.kind)) return true
  }
  return false
}

// Quyết định cho MỘT lời gọi tool. Không bao giờ ném: lỗi bất kỳ ⇒ 'ask'.
export async function evaluatePermissionRules(query: RuleQuery): Promise<PermissionRuleDecision> {
  try {
    const subjects = matchSubjects(query.toolName, query.args)
    if (!subjects) return 'ask'

    const tiers: ParsedPermissionRule[][] = []
    tiers.push(query.sessionId ? getSessionRules(query.sessionId) : [])

    const projectPath =
      query.projectPath !== undefined
        ? query.projectPath
        : query.sessionId
          ? await resolveSessionProjectPath(query.sessionId)
          : null
    if (projectPath) await warnLegacyProjectRuleFile(projectPath)
    const projectFile = projectPath ? projectRuleFile(projectPath) : null
    tiers.push(projectFile ? await loadRuleFile(projectFile) : [])
    tiers.push(await loadRuleFile(userRuleFile()))

    // MỘT lượt quét cho cả hai hành động (F9). DENY thắng bất kể thứ tự: gặp
    // DENY là trả về ngay, còn ALLOW chỉ được trả về sau khi đã quét HẾT — nên
    // một `deny` ở tầng user vẫn thắng một `allow` ở tầng session.
    let scanned = 0
    let allowed = false
    for (const tier of tiers) {
      for (const rule of tier) {
        scanned += 1
        if (scanned > MAX_RULES_PER_EVAL) {
          // Quét dở dang ⇒ có thể còn DENY chưa thấy ⇒ hỏi (không bao giờ allow).
          log.warn('permission rules: too many rules to evaluate, asking instead', {
            toolName: query.toolName,
            cap: MAX_RULES_PER_EVAL,
          })
          return 'ask'
        }
        if (!matchRule(rule, subjects, query.toolName)) continue
        if (rule.action === 'deny') return 'deny'
        allowed = true
      }
    }
    return allowed ? 'allow' : 'ask'
  } catch (err) {
    log.warn('permission rules: evaluation failed, falling back to ask', {
      toolName: query.toolName,
      err: err instanceof Error ? err.message : String(err),
    })
    return 'ask'
  }
}

// Ghi một luật vào đúng tầng. Trả về tầng THẬT SỰ đã ghi: xin 'project' mà phiên
// không thuộc project nào thì hạ xuống 'session' (không im lặng đánh rơi luật).
export async function persistRule(
  scope: PermissionRuleScope,
  rule: ParsedPermissionRule,
  ctx: { sessionId?: string; projectPath?: string | null },
): Promise<PermissionRuleScope> {
  if (scope === 'user') {
    await saveRuleToFile(userRuleFile(), rule)
    return 'user'
  }
  if (scope === 'project') {
    const projectPath =
      ctx.projectPath ?? (ctx.sessionId ? await resolveSessionProjectPath(ctx.sessionId) : null)
    const file = projectPath ? projectRuleFile(projectPath) : null
    if (file && projectPath) {
      await saveRuleToFile(file, rule, projectPath)
      return 'project'
    }
    log.warn('permission rules: no project for session, saving to session scope', {
      sessionId: ctx.sessionId,
    })
  }
  if (ctx.sessionId) addSessionRule(ctx.sessionId, rule)
  return 'session'
}
