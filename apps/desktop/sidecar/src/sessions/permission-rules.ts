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
//
// F11 — Cache file luật khoá theo DANH TÍNH file `(dev, ino, mtimeMs, ctimeMs,
//   size)` thay vì chỉ `(mtimeMs, size)`. Sửa file giữ nguyên kích thước trong
//   cùng một mili-giây trước đây phục vụ bản CŨ vô thời hạn — nguy hiểm nhất
//   theo chiều THU HỒI (gỡ một luật allow mà gate không thấy).
//
// F12 — Cờ `run_in_background` của `Bash` đổi hệ quả của lệnh (tiến trình
//   detached sống lâu hơn lượt) nên KHÔNG được ăn theo luật ALLOW viết cho bản
//   foreground. Luật DENY thì vẫn khớp — bật một cờ không được phép lách rào.

import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import { awogHome } from '../util/path.js'
import { log } from '../util/logger.js'
import { sessionsDir } from './jsonl.js'

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

// ─── Lời gọi "detached" (F12) ────────────────────────────────────────────────
// `Bash({ command, run_in_background: true })` chạy lệnh tách rời: nó SỐNG LÂU
// HƠN lượt (sessions/bg-registry.ts giữ shell lại để lượt sau đọc output), khác
// hẳn cùng chuỗi lệnh đó chạy foreground — cùng một `npm run dev`, một bên tắt
// khi lượt kết thúc, một bên ở lại.
//
// Chủ thể của luật vẫn CHỈ là chuỗi lệnh, cố ý: nhét cờ vào văn bản luật phải
// bịa thêm cú pháp (`Bash(npm run dev &background)`), mà mọi cú pháp bịa thêm
// đều đụng độ với một chuỗi lệnh thật viết y hệt và bắt người đọc luật học một
// quy ước nữa. Thay vào đó bất đối xứng theo hành động:
//   ALLOW — không áp cho lời gọi detached ⇒ luôn hỏi lại (và không có nút
//           "Always allow", vì không có luật nào an toàn để nhớ).
//   DENY  — vẫn áp ⇒ thêm một cờ không bao giờ lách được rào chắn.
const DETACHED_ARG_KEYS: Record<string, string> = {
  Bash: 'run_in_background',
}

export function isDetachedCall(toolName: string, args: unknown): boolean {
  const key = DETACHED_ARG_KEYS[toolName]
  if (!key) return false
  const bag = args && typeof args === 'object' ? (args as Record<string, unknown>) : null
  return bag?.[key] === true
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
  // Lời gọi detached không có luật nào an toàn để nhớ: luật chỉ mô tả chuỗi
  // lệnh, mà thứ được cấp ở đây là một tiến trình sống lâu hơn lượt (F12).
  if (isDetachedCall(toolName, args)) return null
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

// Luật đã park có còn mô tả ĐÚNG tham số sắp chạy không, sau khi người dùng ghi
// đè tham số (`updatedInput`) lúc trả lời (F13).
//
// Cổng quyền sinh luật từ args GỐC rồi mới áp `updatedInput`, nên nếu không
// kiểm tra thì "Always allow" có thể ghi xuống một luật mô tả lệnh người dùng
// ĐÃ ĐỌC trong khi thứ thật sự chạy là lệnh khác. Sinh lại văn bản luật từ args
// đã ghi đè bằng ĐÚNG hàm mà nút "Always allow" dùng rồi so nguyên văn:
//   - trùng ⇒ ghi đè không đụng tới chủ thể của luật ⇒ nhớ được;
//   - lệch (đổi lệnh, đổi đường dẫn, bật `run_in_background`, thiếu tham số) ⇒
//     KHÔNG nhớ gì cả, lần sau vẫn hỏi.
// Chiều hỏng luôn là "hỏi thêm", không bao giờ là "cấp thêm".
export function ruleMatchesOverriddenInput(rule: ParsedPermissionRule, input: unknown): boolean {
  return suggestRuleText(rule.toolName, input) === rule.text
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
  // Lần cuối thực sự ĐỌC + parse file (mốc của trần tuổi cache).
  loadedAt: number
  identity: string
  rules: ParsedPermissionRule[]
}

const FILE_CACHE = new Map<string, FileCacheEntry>()
const STAT_TTL_MS = 1000
// Trần tuổi của một mục cache: quá hạn thì đọc lại file BẤT KỂ danh tính có đổi
// hay không (F11). Chỉ là lưới an toàn cho trường hợp hệ thống tệp trả về danh
// tính y hệt cho hai nội dung khác nhau; chi phí là một lần đọc + parse mỗi 5s
// cho mỗi file luật đang được dùng.
const MAX_CACHE_AGE_MS = 5000

interface FileIdentityStat {
  dev: number
  ino: number
  mtimeMs: number
  ctimeMs: number
  size: number
}

// Danh tính của một file trên đĩa (F11).
//
// Trước đây khoá cache là `(mtimeMs, size)`. Hai lần ghi trong cùng một
// mili-giây, ra cùng số byte (đổi `Bash(aaa)` thành `Bash(bbb)`, gỡ một luật rồi
// thêm một luật dài bằng…) cho ra CÙNG khoá ⇒ gate phục vụ bản cũ vô thời hạn.
// Nguy hiểm nhất theo chiều thu hồi: người dùng gỡ một luật `allow` mà cổng
// quyền không bao giờ thấy.
//
// Thêm `dev + ino` và `ctimeMs` khép lỗ đó bằng hai cơ chế độc lập:
//   - Ghi kiểu atomic-rename (đường ghi DUY NHẤT của AWOG, và cũng là cách hầu
//     hết editor lưu file) tạo file mới ⇒ **ino luôn đổi**, không phụ thuộc đồng hồ.
//   - Ghi đè tại chỗ (`>>`, `sed -i` không backup) buộc POSIX cập nhật **ctime**
//     ⇒ đổi ngay cả khi mtime bị `utimes` giả lại y hệt và kích thước không đổi.
// Cố ý KHÔNG băm nội dung: cache này nằm trên đường nóng của mọi lời gọi tool,
// băm mỗi lần là đọc cả file mỗi lần — đúng thứ cache sinh ra để tránh.
function fileIdentity(st: FileIdentityStat): string {
  return `${st.dev}:${st.ino}:${st.mtimeMs}:${st.ctimeMs}:${st.size}`
}

type RawRuleFile =
  | { status: 'missing' }
  | { status: 'corrupt'; reason: string }
  // `projectPath` là ghi chú trong file (xem F1) — đọc lên CHỈ để ghi lại đúng
  // như cũ khi rewrite, KHÔNG BAO GIỜ để giải ra đường dẫn file.
  | { status: 'ok'; entries: unknown[]; projectPath?: string }

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
  const projectPath = (parsed as { projectPath?: unknown }).projectPath
  return {
    status: 'ok',
    entries: rules,
    ...(typeof projectPath === 'string' ? { projectPath } : {}),
  }
}

// Đọc + validate file luật. File thiếu / hỏng toàn phần ⇒ mảng rỗng: một file
// luật hỏng KHÔNG được phép làm sập gate, và cũng không được phép cho qua thứ
// gì. Entry hỏng lẻ ⇒ bỏ qua đúng entry đó, phần còn lại VẪN có hiệu lực (F2).
async function loadRuleFile(file: string): Promise<ParsedPermissionRule[]> {
  const now = Date.now()
  const cached = FILE_CACHE.get(file)
  // Cửa sổ "không stat" 1s: một chuỗi lời gọi tool liên tiếp không nện đĩa. Đổi
  // lại, một thay đổi trên đĩa chậm hiệu lực TỐI ĐA 1s — có trần và biết trước,
  // khác hẳn lỗ hổng F11 (chậm vô thời hạn).
  if (cached && now - cached.checkedAt < STAT_TTL_MS) return cached.rules
  let identity: string
  try {
    identity = fileIdentity(await stat(file))
  } catch {
    FILE_CACHE.delete(file)
    return []
  }
  if (cached && cached.identity === identity && now - cached.loadedAt < MAX_CACHE_AGE_MS) {
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
  FILE_CACHE.set(file, { checkedAt: now, loadedAt: now, identity, rules })
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
    // Lời gọi detached: quét vẫn chạy đủ (để DENY còn hiệu lực) nhưng ALLOW
    // không được chốt — cùng chuỗi lệnh, khác hệ quả (F12).
    const detached = isDetachedCall(query.toolName, query.args)

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
        if (!detached) allowed = true
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

// ─── Liệt kê / thu hồi luật (F10) ────────────────────────────────────────────
//
// Trước gói này không có đường nào để XEM hay GỠ một luật đã lưu: phải mở file
// JSON ra sửa tay, mà tên file tầng project là băm của đường dẫn nên người dùng
// gần như không tìm ra nó. Một cơ chế cấp quyền không thu hồi được thì không
// phải cơ chế cấp quyền.
//
// Hai nguyên tắc của phần này:
//   1. Đọc theo lối RỘNG hơn lúc đánh giá: một entry mà `parsePermissionRule`
//      từ chối (typo `"action": "alow"`, luật `Bash` trần…) vẫn được LIỆT KÊ,
//      đánh dấu `active: false`. Nó vô hiệu lúc gate chạy, nhưng người dùng phải
//      nhìn thấy để xoá được — nếu không, đúng những entry hỏng là thứ duy nhất
//      vẫn phải sửa tay.
//   2. Ghi theo đúng tinh thần F2: giữ NGUYÊN VĂN mọi entry không bị xoá, và
//      file hỏng toàn phần thì NÉM LỖI chứ không ghi đè.

export interface StoredRuleView {
  // Nguyên văn chuỗi luật ĐANG NẰM TRÊN ĐĨA — cũng chính là khoá lúc xoá.
  rule: string
  action: PermissionRuleAction
  createdAt?: string
  // false ⇒ entry này không parse được nên KHÔNG có hiệu lực (chỉ hiện để xoá).
  active: boolean
  // Chỉ có khi `active`.
  toolName?: string
  kind?: PermissionRuleKind
}

export type RuleFileListing =
  | { status: 'missing' }
  | { status: 'corrupt'; reason: string }
  | { status: 'ok'; rules: StoredRuleView[] }

// Đọc RỘNG một entry: chỉ đòi `rule` là chuỗi trong giới hạn độ dài. `action`
// đọc là 'deny' KHI VÀ CHỈ KHI đúng chuỗi 'deny' — mọi thứ khác về 'allow', y
// hệt cách đánh giá hiểu file (không bao giờ suy diễn ra một DENY không có
// thật, và cũng không bao giờ bỏ sót một DENY có thật).
interface LooseRuleEntry {
  rule: string
  action: PermissionRuleAction
  createdAt?: string
}

function looseEntryView(entry: unknown): LooseRuleEntry | null {
  if (!entry || typeof entry !== 'object') return null
  const bag = entry as Record<string, unknown>
  const rule = bag.rule
  if (typeof rule !== 'string') return null
  if (rule.length === 0 || rule.length > MAX_TOOL_NAME + MAX_PATTERN + 2) return null
  const action: PermissionRuleAction = bag.action === 'deny' ? 'deny' : 'allow'
  const createdAt = typeof bag.createdAt === 'string' ? bag.createdAt : undefined
  return { rule, action, ...(createdAt ? { createdAt } : {}) }
}

// Danh sách luật của MỘT file, dạng hiển thị. Cố ý KHÔNG đi qua `FILE_CACHE`:
// đây là trang cấu hình, phải đọc trạng thái thật của đĩa ngay tại thời điểm mở.
export async function listRulesInFile(file: string): Promise<RuleFileListing> {
  const raw = await readRawRuleFile(file)
  if (raw.status === 'missing') return { status: 'missing' }
  if (raw.status === 'corrupt') return { status: 'corrupt', reason: raw.reason }
  const rules: StoredRuleView[] = []
  for (const entry of raw.entries) {
    if (rules.length >= MAX_RULES_PER_FILE) break
    const view = looseEntryView(entry)
    if (!view) continue
    const strict = StoredRuleSchema.safeParse(entry)
    const parsed = strict.success
      ? parsePermissionRule(strict.data.rule, strict.data.action ?? 'allow')
      : null
    rules.push({
      rule: view.rule,
      action: view.action,
      ...(view.createdAt ? { createdAt: view.createdAt } : {}),
      active: parsed !== null,
      ...(parsed ? { toolName: parsed.toolName, kind: parsed.kind } : {}),
    })
  }
  return { status: 'ok', rules }
}

// Xoá mọi entry có ĐÚNG cặp (nguyên văn luật, action) này khỏi một file.
//
// So khớp là so chuỗi nguyên văn — không glob, không chuẩn hoá — nên không có
// đường nào để một lời gọi xoá lan sang luật khác (đặc biệt: xoá một ALLOW không
// bao giờ được phép gỡ mất một DENY cùng tên). Entry không khớp được ghi lại
// NGUYÊN VĂN, kể cả entry hỏng.
export async function deleteRuleFromFile(
  file: string,
  target: { rule: string; action: PermissionRuleAction },
): Promise<{ removed: number }> {
  const raw = await readRawRuleFile(file)
  if (raw.status === 'corrupt') {
    throw new Error(
      `Permission rule file is corrupt, refusing to rewrite it (${raw.reason}): ${file}`,
    )
  }
  if (raw.status === 'missing') return { removed: 0 }
  const kept: unknown[] = []
  let removed = 0
  for (const entry of raw.entries) {
    const view = looseEntryView(entry)
    if (view && view.rule === target.rule && view.action === target.action) {
      removed += 1
      continue
    }
    kept.push(entry)
  }
  // Không khớp gì ⇒ không rewrite: một thao tác xoá trượt không được phép động
  // vào file (và không được nuốt mất `version`/`projectPath` của bản gốc).
  if (removed === 0) return { removed: 0 }
  await writeRuleFileAtomic(file, kept, raw.projectPath)
  return { removed }
}

// Tầng session (bộ nhớ) — liệt kê theo phiên để trang cấu hình hiện được cả các
// quyền tạm thời, thứ trước đây hoàn toàn vô hình.
export function listSessionRuleTiers(): { sessionId: string; rules: ParsedPermissionRule[] }[] {
  const out: { sessionId: string; rules: ParsedPermissionRule[] }[] = []
  for (const [sessionId, rules] of SESSION_RULES) {
    if (rules.length > 0) out.push({ sessionId, rules: [...rules] })
  }
  return out
}

export function removeSessionRule(
  sessionId: string,
  text: string,
  action: PermissionRuleAction,
): number {
  const list = SESSION_RULES.get(sessionId)
  if (!list) return 0
  let removed = 0
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const rule = list[i]
    if (!rule || rule.text !== text || rule.action !== action) continue
    list.splice(i, 1)
    removed += 1
  }
  if (list.length === 0) SESSION_RULES.delete(sessionId)
  return removed
}

// ─── Gợi ý luật từ lịch sử (#40) ─────────────────────────────────────────────
//
// Hỏi đi hỏi lại cùng một lệnh là một vấn đề BẢO MẬT, không chỉ phiền: người bị
// hỏi quá nhiều sẽ bấm bừa, mà nút bấm bừa ở đây là nút cấp quyền. Nên phần này
// quét transcript đã lưu, đếm lệnh nào chạy đi chạy lại, rồi ĐỀ XUẤT đúng một
// luật nguyên văn cho lệnh đó.
//
// Bốn ràng buộc cứng:
//   1. Chỉ ĐỀ XUẤT. Không bao giờ tự ghi. Người dùng phải bấm, và thứ họ bấm
//      hiện nguyên văn trên màn hình.
//   2. Chỉ đề xuất luật mà `suggestRuleText` chấp nhận ⇒ lệnh có toán tử shell
//      KHÔNG BAO GIỜ được đề xuất, và không bao giờ sinh ký tự đại diện.
//   3. Chỉ đếm lời gọi ĐÃ CHẠY XONG (`status === 'done'`). Lời gọi bị người dùng
//      từ chối kết thúc ở trạng thái lỗi ⇒ không bao giờ lên thành gợi ý. Nói
//      cách khác: chỉ đề xuất ghi nhớ những việc người dùng ĐÃ đồng ý nhiều lần.
//   4. Quét có trần cứng (số phiên, cỡ file, tổng byte, số lời gọi) và đi bằng
//      fs bất đồng bộ.

// Trần quét. Đủ rộng để bắt được thói quen thật, đủ hẹp để không đọc cả ổ đĩa.
const SCAN_MAX_SESSIONS = 60
const SCAN_MAX_FILE_BYTES = 2 * 1024 * 1024
const SCAN_MAX_TOTAL_BYTES = 32 * 1024 * 1024
const SCAN_MAX_CALLS = 5000

// Ngưỡng "bị hỏi lặp lại". Rule of Three: một lần là ngẫu nhiên, ba lần là thói
// quen — và ba lần cũng là lúc người dùng bắt đầu bấm cho xong.
export const SUGGESTION_MIN_COUNT = 3
const SUGGESTION_LIMIT = 20
const SUGGESTION_MAX_PROJECTS = 5
const MAX_PARKED_SUGGESTIONS = 200

export interface HistoryToolCall {
  toolName: string
  args: Record<string, unknown>
  at?: string
  projectId?: string
}

export interface RuleCandidate {
  rule: string
  toolName: string
  kind: PermissionRuleKind
  count: number
  lastAt?: string
  projectIds: string[]
  // Tham số của lần gọi đầu tiên — chỉ dùng nội bộ để hỏi lại cổng quyền xem
  // luật này đã được phủ chưa. KHÔNG đi lên UI.
  args: Record<string, unknown>
}

export interface HistoryScanReport {
  sessions: number
  bytes: number
  // true khi đụng trần (còn phiên/lời gọi chưa quét). UI phải nói rõ, để người
  // dùng không hiểu nhầm danh sách này là "toàn bộ lịch sử".
  truncated: boolean
}

// Lệnh nâng quyền KHÔNG BAO GIỜ được đề xuất. Nâng quyền phải là quyết định có
// ý thức của từng lần chạy — đây là quy tắc hẹp và kiểm chứng được (so khớp
// đúng token đầu tiên), không phải một danh sách đen "lệnh nguy hiểm" (thứ luôn
// thiếu và tạo cảm giác an toàn giả).
const PRIVILEGE_COMMANDS = new Set(['sudo', 'doas', 'su', 'pkexec', 'runas'])

export function escalatesPrivilege(command: string): boolean {
  const first = command.trim().split(/\s+/)[0] ?? ''
  const base = first.slice(first.lastIndexOf('/') + 1)
  return PRIVILEGE_COMMANDS.has(base)
}

// Tên tool suy ngược từ một step đã lưu. Transcript KHÔNG lưu tên tool, chỉ lưu
// nhóm `tool` + payload `detail`, nên chỉ hai trường hợp suy ngược được mà
// KHÔNG mơ hồ:
//   tool 'terminal' + detail 'terminal' ⇒ Bash  (chỉ Bash sinh detail này)
//   tool 'write'    + detail 'file'     ⇒ Write (chỉ Write map sang 'write')
// Nhóm 'edit' gom cả Edit/MultiEdit/NotebookEdit nên bỏ qua: đoán sai tên tool
// là sinh ra một luật không bao giờ khớp — vô dụng và gây hiểu nhầm.
function historyCallOfStep(
  step: unknown,
): { toolName: string; args: Record<string, unknown> } | null {
  if (!step || typeof step !== 'object') return null
  const bag = step as Record<string, unknown>
  if (bag.kind !== 'tool') return null
  // Chỉ lời gọi CHẠY XONG. 'error' gồm cả trường hợp người dùng từ chối.
  if (bag.status !== 'done') return null
  const detail = bag.detail
  if (!detail || typeof detail !== 'object') return null
  const d = detail as Record<string, unknown>
  if (bag.tool === 'terminal' && d.kind === 'terminal' && typeof d.command === 'string') {
    return { toolName: 'Bash', args: { command: d.command } }
  }
  if (bag.tool === 'write' && d.kind === 'file' && typeof d.path === 'string') {
    return { toolName: 'Write', args: { file_path: d.path } }
  }
  return null
}

// Rút lời gọi tool từ nội dung một file `session.jsonl` (dòng 1 = header).
function historyCallsOfSessionFile(text: string, cap: number): HistoryToolCall[] {
  const out: HistoryToolCall[] = []
  const lines = text.split('\n')
  let projectId: string | undefined
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      // Dòng hỏng ⇒ bỏ đúng dòng đó (dữ liệu L1, không tin, không ném).
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    const bag = parsed as Record<string, unknown>
    if (i === 0) {
      if (typeof bag.projectId === 'string') projectId = bag.projectId
      continue
    }
    if (bag.role !== 'agent') continue
    const steps = Array.isArray(bag.steps) ? bag.steps : []
    const at = typeof bag.at === 'string' ? bag.at : undefined
    for (const step of steps) {
      if (out.length >= cap) return out
      const call = historyCallOfStep(step)
      if (!call) continue
      out.push({
        ...call,
        ...(at ? { at } : {}),
        ...(projectId ? { projectId } : {}),
      })
    }
  }
  return out
}

// Quét các phiên gần đây nhất. Có trần ở mọi chiều và đi bằng fs bất đồng bộ:
// mỗi file là một `await` nên vòng lặp sự kiện của sidecar không bị giữ, và
// tổng khối lượng đọc bị chặn trên bởi SCAN_MAX_TOTAL_BYTES.
export async function scanHistoryToolCalls(): Promise<{
  calls: HistoryToolCall[]
  report: HistoryScanReport
}> {
  const empty: HistoryScanReport = { sessions: 0, bytes: 0, truncated: false }
  const dir = sessionsDir()
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return { calls: [], report: empty }
  }
  const files: { file: string; mtimeMs: number; size: number }[] = []
  for (const name of entries) {
    // Không cần lọc "có phải thư mục không": `stat` trên file transcript bên
    // trong đã là phép lọc chặt hơn (mục nào không có nó thì bỏ qua).
    const file = resolve(dir, name, 'session.jsonl')
    try {
      // eslint-disable-next-line no-await-in-loop
      const st = await stat(file)
      files.push({ file, mtimeMs: st.mtimeMs, size: st.size })
    } catch {
      continue
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  let truncated = files.length > SCAN_MAX_SESSIONS
  const calls: HistoryToolCall[] = []
  let bytes = 0
  let sessions = 0
  for (const entry of files.slice(0, SCAN_MAX_SESSIONS)) {
    if (entry.size > SCAN_MAX_FILE_BYTES) {
      truncated = true
      continue
    }
    if (bytes + entry.size > SCAN_MAX_TOTAL_BYTES) {
      truncated = true
      break
    }
    let text: string
    try {
      // eslint-disable-next-line no-await-in-loop
      text = await readFile(entry.file, 'utf8')
    } catch {
      continue
    }
    bytes += entry.size
    sessions += 1
    const found = historyCallsOfSessionFile(text, SCAN_MAX_CALLS - calls.length)
    calls.push(...found)
    if (calls.length >= SCAN_MAX_CALLS) {
      truncated = true
      break
    }
  }
  return { calls, report: { sessions, bytes, truncated } }
}

// Đếm + xếp hạng. HÀM THUẦN — không đụng đĩa, không đụng cấu hình, nên toàn bộ
// tiêu chí đề xuất kiểm chứng được bằng test.
export function collectRuleCandidates(
  calls: readonly HistoryToolCall[],
  opts: { minCount?: number; limit?: number } = {},
): RuleCandidate[] {
  const minCount = Math.max(1, opts.minCount ?? SUGGESTION_MIN_COUNT)
  const limit = Math.max(1, opts.limit ?? SUGGESTION_LIMIT)
  const acc = new Map<string, RuleCandidate>()
  for (const call of calls) {
    // Đúng hàm mà nút "Always allow" dùng: lệnh ghép, đường dẫn tương đối, chủ
    // thể chứa `*` đều rơi ở đây.
    const text = suggestRuleText(call.toolName, call.args)
    if (!text) continue
    const parsed = parsePermissionRule(text)
    if (!parsed || parsed.pattern === null) continue
    // Luật trần quá rộng để đề xuất: gợi ý phải luôn là một chuỗi cụ thể.
    if (parsed.kind === 'bare') continue
    if (parsed.kind === 'command' && escalatesPrivilege(parsed.pattern)) continue
    const existing = acc.get(parsed.text)
    if (existing) {
      existing.count += 1
      if (call.at && (!existing.lastAt || call.at > existing.lastAt)) existing.lastAt = call.at
      if (
        call.projectId &&
        !existing.projectIds.includes(call.projectId) &&
        existing.projectIds.length < SUGGESTION_MAX_PROJECTS
      ) {
        existing.projectIds.push(call.projectId)
      }
      continue
    }
    acc.set(parsed.text, {
      rule: parsed.text,
      toolName: parsed.toolName,
      kind: parsed.kind,
      count: 1,
      ...(call.at ? { lastAt: call.at } : {}),
      projectIds: call.projectId ? [call.projectId] : [],
      args: call.args,
    })
  }
  return [...acc.values()]
    .filter((c) => c.count >= minCount)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      // Mới dùng gần đây hơn thì xếp trước; bằng nhau thì theo thứ tự chữ cái để
      // danh sách ổn định giữa hai lượt quét.
      const aAt = a.lastAt ?? ''
      const bAt = b.lastAt ?? ''
      if (aAt !== bAt) return aAt < bAt ? 1 : -1
      return a.rule.localeCompare(b.rule)
    })
    .slice(0, limit)
}

// ─── Park gợi ý ──────────────────────────────────────────────────────────────
// Cùng ràng buộc với ADR 0080 mục 5: NỘI DUNG luật không bao giờ đến từ payload
// UI. Lượt quét park luật đã parse dưới một id ngẫu nhiên; lúc người dùng bấm
// "thêm luật", UI chỉ gửi id + tầng. Một payload dựng tay do đó không ghi được
// `Bash(*)` vào file luật.

const SUGGESTION_PARK = new Map<string, ParsedPermissionRule>()

export function parkRuleSuggestion(rule: ParsedPermissionRule): string {
  if (SUGGESTION_PARK.size >= MAX_PARKED_SUGGESTIONS) SUGGESTION_PARK.clear()
  const id = randomBytes(8).toString('hex')
  SUGGESTION_PARK.set(id, rule)
  return id
}

export function getParkedRuleSuggestion(id: string): ParsedPermissionRule | null {
  return SUGGESTION_PARK.get(id) ?? null
}

export function clearParkedRuleSuggestions(): void {
  SUGGESTION_PARK.clear()
}

export interface RuleSuggestion {
  id: string
  rule: string
  toolName: string
  kind: PermissionRuleKind
  count: number
  lastAt?: string
  projectIds: string[]
}

// Quét lịch sử → đếm → BỎ những luật đã được phủ (đã allow hoặc đã deny) → park.
//
// `projectPaths` là bản đồ projectId → đường dẫn tuyệt đối do lớp RPC cấp: hàm
// này không tự đọc store project (SoC), và bản đồ chỉ dùng để hỏi đúng tầng
// project khi ứng viên chỉ đến từ MỘT project.
export async function suggestRulesFromHistory(
  opts: { projectPaths?: Record<string, string>; minCount?: number; limit?: number } = {},
): Promise<{ suggestions: RuleSuggestion[]; report: HistoryScanReport }> {
  const { calls, report } = await scanHistoryToolCalls()
  const candidates = collectRuleCandidates(calls, {
    ...(opts.minCount !== undefined ? { minCount: opts.minCount } : {}),
    ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
  })
  clearParkedRuleSuggestions()
  const suggestions: RuleSuggestion[] = []
  for (const candidate of candidates) {
    const only = candidate.projectIds.length === 1 ? candidate.projectIds[0] : undefined
    const projectPath = (only ? opts.projectPaths?.[only] : undefined) ?? null
    // eslint-disable-next-line no-await-in-loop
    const decision = await evaluatePermissionRules({
      toolName: candidate.toolName,
      args: candidate.args,
      projectPath,
    })
    // Đã có luật phủ (allow HOẶC deny) ⇒ không đề xuất nữa. Đặc biệt quan trọng
    // với deny: không bao giờ được rủ người dùng cấp lại thứ họ đã cấm.
    if (decision !== 'ask') continue
    const parsed = parsePermissionRule(candidate.rule)
    if (!parsed) continue
    suggestions.push({
      id: parkRuleSuggestion(parsed),
      rule: candidate.rule,
      toolName: candidate.toolName,
      kind: candidate.kind,
      count: candidate.count,
      ...(candidate.lastAt ? { lastAt: candidate.lastAt } : {}),
      projectIds: candidate.projectIds,
    })
  }
  return { suggestions, report }
}
