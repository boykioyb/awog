// Nhật ký hoạt động hạ tầng — bản BỀN VỮNG, TRUY VẤN ĐƯỢC của
// `git/command-log.ts`.
//
// VÌ SAO TỒN TẠI. Ma trận quyền (ADR 0088 §5) cho agent chạy THẲNG một số lớp
// lệnh trên tài khoản thật. Điều đó chỉ chấp nhận được nếu bất cứ lúc nào cũng
// trả lời được câu: "app đã làm gì trên tài khoản của tôi, lúc nào, do ai bảo?"
// — nên mỗi hành động để lại ĐÚNG MỘT DÒNG, và dòng đó phải sống lâu hơn tiến
// trình đã sinh ra nó.
//
// VÌ SAO RING BUFFER KHÔNG ĐỦ. `git/command-log.ts` giữ 400 entry TRONG BỘ NHỚ
// sidecar: reload là mất, restart là mất, không lọc được, không hỏi lại được
// sau một tuần. Với git thì chấp nhận được — repo còn nguyên đó để soi lại.
// Với hạ tầng thì không: lệnh chạy trên tài khoản thật, tốn tiền thật, và
// "tuần trước ai scale service này" là câu hỏi bình thường. Nên ở đây là JSONL
// trên đĩa, append-only, xoay theo tháng, đọc NGƯỢC theo dòng (file một tháng
// có thể lớn, nạp cả file vào RAM chỉ để xem 200 dòng cuối là sai).
//
// LUẬT "AGENT KHÔNG XOÁ ĐƯỢC". File này KHÔNG export hàm nào dành cho agent
// gọi. `cleanInfraAudit`/`pruneExpired` là bề mặt của NGƯỜI dùng (màn Nhật ký +
// chính sách hết hạn ở Settings); tool catalogue của agent không bao giờ được
// map tới chúng, và không tồn tại tool `audit_clean`. Nếu agent dọn được nhật
// ký thì nhật ký không còn là bằng chứng. Bản thân việc dọn cũng là một hành
// động ⇒ nó tự ghi lại một dòng, và dòng đó NẰM NGOÀI phạm vi vừa xoá.
//
// REDACT TRƯỚC KHI CHẠM ĐĨA, không phải trước khi hiển thị: dùng lại
// `redactString()` của `sessions/redact.ts` — cùng bộ lọc 3 lớp mà transcript,
// tool I/O và nhật ký git đang dùng — nên một `--token …` lọt vào argv không
// bao giờ nằm trên đĩa dưới dạng đọc được (invariant #1).
//
// Đọc lại là dữ liệu L2: `queryInfraAudit` trả về đúng thứ đã clamp trên đĩa,
// và bề mặt nào đẩy nó vào prompt phải coi đó là DỮ LIỆU, không phải chỉ thị.

import { createReadStream } from 'node:fs'
import { open, mkdir, chmod, readdir, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { z } from 'zod'
import { redactString } from '../../sessions/redact.js'
import { log } from '../../util/logger.js'
import { awogHome, sanitizeChild } from '../../util/path.js'

// ─── Trần ────────────────────────────────────────────────────────────────────

const MAX_ARGV_ITEM_CHARS = 512
const MAX_SUMMARY_CHARS = 2000
const MAX_LINE_BYTES = 16 * 1024
const MAX_ARGV_ITEMS = 512
/** Độ dài summary còn giữ lại ở bước co entry cho vừa một dòng. */
const SHRUNK_SUMMARY_CHARS = 200

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 2000
const DEFAULT_RETENTION_DAYS = 90

const REVERSE_CHUNK_BYTES = 64 * 1024
// Một dòng đã bị chặn ở 16 KB lúc ghi, nên mảnh dài hơn ngần này là file bị sửa
// tay hoặc hỏng — không được để nó ăn hết RAM của lượt đọc ngược.
const MAX_PARTIAL_LINE_BYTES = 1024 * 1024
const MAX_WARN_PER_FILE = 3

const NEWLINE = 0x0a

// ─── Hình dạng một dòng ──────────────────────────────────────────────────────

// Bốn LỚP lệnh (ADR 0088 §5) — một nguồn duy nhất ở `infra/types.ts`. Re-export
// để người dùng store không phải import từ hai chỗ.
import type { InfraCommandClass } from '../types.js'
export type { InfraCommandClass }

export const INFRA_COMMAND_CLASSES = [
  'read',
  'write',
  'destructive',
  'context-switch',
] as const satisfies readonly InfraCommandClass[]

/** Bề mặt đã phát ra hành động — trả lời "bấm ở đâu ra lệnh này". */
export const INFRA_SURFACES = [
  'explorer',
  'logs',
  'graph',
  'playbook',
  'session',
  'terminal',
  'pipeline',
  'settings',
] as const

export type InfraSurface = (typeof INFRA_SURFACES)[number]

/**
 * Cổng quyền đã quyết gì. Phân biệt "bạn đồng ý" (`approved`) với "chế độ tự
 * động" (`auto`) là cả lý do của trường này.
 *
 * ADR 0088 §5 viết `bypass:temp`; ở đây dùng `bypass-temp` cho khớp lược đồ
 * task 0.6 và để giá trị không chứa dấu `:` (tránh nhầm với tiền tố của `actor`).
 */
export const INFRA_DECISIONS = ['auto', 'approved', 'denied', 'blocked', 'bypass-temp'] as const

export type InfraDecision = (typeof INFRA_DECISIONS)[number]

// `actor` là trường quan trọng nhất của cả file: AI BẢO LÀM. Bốn dạng hợp lệ —
// `human`, `agent:<tên>`, `playbook:<id>#<bước>`, `schedule:<id>` — được ép bằng
// regex chứ không phải quy ước miệng, vì một `actor` tự do sẽ nhanh chóng biến
// thành chuỗi vô nghĩa và bộ lọc "ai" ở màn Nhật ký mất tác dụng.
const ACTOR_RE =
  /^(?:human|agent:[A-Za-z0-9._-]{1,64}|playbook:[A-Za-z0-9._-]{1,64}#[0-9]{1,4}|schedule:[A-Za-z0-9._-]{1,64})$/

// Cố ý KHÔNG `.strict()`: một bản AWOG mới hơn thêm trường thì bản cũ đọc lại
// phải BỎ QUA trường lạ, không được coi cả dòng là hỏng.
const InfraAuditContextSchema = z.object({
  profile: z.string().max(200).optional(),
  accountId: z.string().max(64).optional(),
  region: z.string().max(64).optional(),
  cluster: z.string().max(200).optional(),
  namespace: z.string().max(200).optional(),
  workspace: z.string().max(500).optional(),
})

const InfraAuditResultSchema = z.object({
  exitCode: z.number().int().optional(),
  durationMs: z.number().nonnegative().optional(),
  bytesScanned: z.number().nonnegative().optional(),
  summary: z.string().optional(),
})

export const InfraAuditEntrySchema = z.object({
  at: z.string().datetime(),
  actor: z.string().regex(ACTOR_RE),
  sessionId: z.string().max(200).optional(),
  messageId: z.string().max(200).optional(),
  surface: z.enum(INFRA_SURFACES),
  /** Tool AWOG đã chạy (`aws_cli`, `infra_action`, `logs_query`) — KHÔNG phải tên binary. */
  tool: z.string().min(1).max(120),
  /** Đã redact, đã clamp. Không kèm tên binary dẫn đầu (khuôn của command-log). */
  argv: z.array(z.string()).max(MAX_ARGV_ITEMS),
  context: InfraAuditContextSchema,
  class: z.enum(INFRA_COMMAND_CLASSES),
  decision: z.enum(INFRA_DECISIONS),
  result: InfraAuditResultSchema,
  cost: z.object({ estimatedUsd: z.number().nonnegative().optional() }).optional(),
  /** Chỉ có mặt khi entry đã bị cắt vì vượt trần — vắng mặt = nguyên vẹn. */
  truncated: z.boolean().optional(),
})

export type InfraAuditEntry = z.infer<typeof InfraAuditEntrySchema>

/** Cái người gọi đưa vào: `at` do store tự đóng dấu, `truncated` do store tự quyết. */
export type InfraAuditInput = Omit<InfraAuditEntry, 'at' | 'truncated'> & {
  at?: string | undefined
}

export type InfraAuditFilter = {
  /** ISO. Bao gồm cả mốc. */
  since?: string | undefined
  /** ISO. Bao gồm cả mốc. */
  until?: string | undefined
  /** So khớp TUYỆT ĐỐI — `actor` vốn là chuỗi có cấu trúc. */
  actor?: string | undefined
  class?: InfraCommandClass | undefined
  decision?: InfraDecision | undefined
  /** Chuỗi con trong `argv`, không phân biệt hoa thường. */
  contains?: string | undefined
}

export type InfraAuditQuery = InfraAuditFilter & { limit?: number | undefined }

export type InfraAuditSummary = {
  total: number
  byClass: Record<InfraCommandClass, number>
  byDecision: Record<InfraDecision, number>
  /** Tổng `cost.estimatedUsd` của các entry khớp bộ lọc. */
  estimatedUsd: number
}

// ─── Đường dẫn ───────────────────────────────────────────────────────────────

const AUDIT_DIR = sanitizeChild('infra-audit')

export function infraAuditDir(): string {
  return join(awogHome(), AUDIT_DIR)
}

/** `at` đã qua schema nên luôn là ISO UTC ⇒ tháng cắt từ chuỗi là tháng UTC. */
function monthOf(atIso: string): string {
  return atIso.slice(0, 7)
}

function monthFile(month: string): string {
  return join(infraAuditDir(), sanitizeChild(`${month}.jsonl`))
}

const MONTH_FILE_RE = /^(\d{4})-(\d{2})\.jsonl$/

type MonthFile = { name: string; path: string; startMs: number; endMs: number }

/** Mới nhất trước. Bỏ qua `.tmp.` của lượt rewrite dở và mọi file lạ. */
async function listMonthFiles(): Promise<MonthFile[]> {
  let names: string[]
  try {
    names = await readdir(infraAuditDir())
  } catch (err) {
    if (isMissing(err)) return []
    throw err
  }
  const out: MonthFile[] = []
  for (const name of names) {
    const m = MONTH_FILE_RE.exec(name)
    if (!m) continue
    const year = Number(m[1])
    const month = Number(m[2])
    if (month < 1 || month > 12) continue
    out.push({
      name,
      path: join(infraAuditDir(), name),
      startMs: Date.UTC(year, month - 1, 1),
      endMs: Date.UTC(year, month, 1) - 1,
    })
  }
  out.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0))
  return out
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

// ─── Redact + clamp ──────────────────────────────────────────────────────────

// Cắt SAU khi redact, không bao giờ trước: cắt trước thì một token bị chặt đôi
// và bộ lọc không còn nhận ra hình dạng của nó nữa.
function clip(value: string, max: number): { text: string; cut: boolean } {
  if (value.length <= max) return { text: value, cut: false }
  return { text: `${value.slice(0, max - 1)}…`, cut: true }
}

function bytesOf(line: string): number {
  return Buffer.byteLength(line, 'utf8')
}

/**
 * Ép entry xuống dưới trần một dòng. Thứ tự co là có chủ ý: `summary` co trước
 * vì nó là phần diễn giải, `argv` co sau và co TỪ ĐUÔI vì phần đầu
 * (`ecs update-service`) mới là thứ trả lời "đã làm gì".
 */
function fitToLineCap(entry: InfraAuditEntry): { entry: InfraAuditEntry; line: string } {
  const first = JSON.stringify(entry)
  if (bytesOf(first) <= MAX_LINE_BYTES) return { entry, line: first }

  let out: InfraAuditEntry = { ...entry, truncated: true }
  const serialize = (e: InfraAuditEntry): { entry: InfraAuditEntry; line: string } | null => {
    const line = JSON.stringify(e)
    return bytesOf(line) <= MAX_LINE_BYTES ? { entry: e, line } : null
  }

  // Bước 1 — summary.
  if (out.result.summary !== undefined) {
    out = {
      ...out,
      result: { ...out.result, summary: clip(out.result.summary, SHRUNK_SUMMARY_CHARS).text },
    }
    const shrunk = serialize(out)
    if (shrunk) return shrunk
    // `summary: undefined` ⇒ JSON.stringify bỏ hẳn khoá.
    out = { ...out, result: { ...out.result, summary: undefined } }
    const dropped = serialize(out)
    if (dropped) return dropped
  }

  // Bước 2 — argv. Tìm nhị phân số phần tử giữ được: bỏ bớt phần tử luôn làm
  // dòng ngắn lại nên hàm "vừa/không vừa" đơn điệu. Tuyến tính ở đây tốn tới
  // vài trăm lần serialize một chuỗi trăm KB.
  const source = out.argv
  const withKeep = (keep: number): InfraAuditEntry => ({
    ...out,
    argv: [...source.slice(0, keep), `[+${source.length - keep} args truncated]`],
  })
  let lo = 0
  let hi = source.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (serialize(withKeep(mid))) lo = mid
    else hi = mid - 1
  }
  if (lo > 0) {
    const fitted = serialize(withKeep(lo))
    if (fitted) return fitted
  }

  // Đường cùng — `context`/`tool` tự nó đã quá khổ. Vẫn phải để lại một dòng:
  // mất dấu vết còn tệ hơn mất chi tiết.
  const minimal: InfraAuditEntry = {
    at: out.at,
    actor: out.actor,
    surface: out.surface,
    tool: clip(out.tool, 64).text,
    argv: ['[truncated]'],
    context: {},
    class: out.class,
    decision: out.decision,
    result: {},
    truncated: true,
  }
  return { entry: minimal, line: JSON.stringify(minimal) }
}

/**
 * Cờ CLI mà GIÁ TRỊ nằm ở PHẦN TỬ KẾ TIẾP của mảng argv.
 *
 * Vì sao cần một luật riêng: `redactString()` chạy trên TỪNG phần tử một, nên nó
 * chỉ thấy `--access-token` ở phần tử i và một chuỗi trần ở phần tử i+1 — hai
 * chuỗi rời không có ngữ cảnh nào nối chúng lại. Lớp lọc theo cặp `khoá=giá trị`
 * của `redact.ts` cần cả hai nằm trong CÙNG một chuỗi (`--token abc` của một dòng
 * lệnh), nên ở dạng mảng nó không khớp; và lớp lọc theo HÌNH DẠNG cố ý không bắt
 * chuỗi entropy cao trần (che thì nuốt luôn mọi SHA, mọi id). Kết quả: một token
 * SSO — chuỗi opaque không tiền tố — đi thẳng xuống đĩa dưới dạng đọc được.
 *
 * Đo được, không phải suy đoán: `aws sso list-accounts --access-token <token>`
 * (Mốc 1 A5) là lời gọi đầu tiên trong repo truyền credential qua argv.
 *
 * Che ở ĐÂY chứ không ở call site vì đây là cổng duy nhất mà mọi argv đi qua
 * trước khi chạm đĩa — call site quên che thì nhật ký hết là bằng chứng.
 */
const REDACTED_VALUE = '[redacted]'

const CREDENTIAL_ARG_FLAGS: readonly string[] = [
  '--access-token',
  '--session-token',
  '--refresh-token',
  '--auth-token',
  '--token',
  '--password',
  '--secret',
  '--secret-access-key',
  '--client-secret',
  '--api-key',
  '--apikey',
]

function isCredentialFlag(name: string): boolean {
  return CREDENTIAL_ARG_FLAGS.includes(name.toLowerCase())
}

/**
 * Thay giá trị đứng sau một cờ credential bằng placeholder. Giữ NGUYÊN tên cờ:
 * "đã truyền một access token ở đây" chính là thứ người đọc nhật ký cần biết.
 *
 * Phần tử kế tiếp mở đầu bằng `--` thì KHÔNG che — đó là cờ tiếp theo, tức cờ
 * credential này không mang giá trị rời (dạng `--password-stdin`), và che nhầm
 * một tên cờ chỉ làm dòng nhật ký khó đọc mà không thêm an toàn nào.
 */
function maskCredentialFlagValues(argv: readonly string[]): string[] {
  const out = [...argv]
  for (let i = 0; i < out.length; i++) {
    const raw = out[i]!
    const eq = raw.indexOf('=')
    if (eq > 0 && isCredentialFlag(raw.slice(0, eq))) {
      out[i] = `${raw.slice(0, eq)}=${REDACTED_VALUE}`
      continue
    }
    if (!isCredentialFlag(raw)) continue
    const next = out[i + 1]
    if (next === undefined || next.startsWith('--')) continue
    out[i + 1] = REDACTED_VALUE
    i++
  }
  return out
}

function buildEntry(input: InfraAuditInput): InfraAuditEntry {
  let cut = false

  const masked = maskCredentialFlagValues(input.argv)
  const dropped = Math.max(0, masked.length - (MAX_ARGV_ITEMS - 1))
  const source = dropped > 0 ? masked.slice(0, MAX_ARGV_ITEMS - 1) : masked
  const argv = source.map((arg) => {
    const clipped = clip(redactString(arg), MAX_ARGV_ITEM_CHARS)
    if (clipped.cut) cut = true
    return clipped.text
  })
  if (dropped > 0) {
    argv.push(`[+${dropped} args truncated]`)
    cut = true
  }

  let summary: string | undefined
  if (input.result.summary !== undefined) {
    const clipped = clip(redactString(input.result.summary), MAX_SUMMARY_CHARS)
    if (clipped.cut) cut = true
    summary = clipped.text
  }

  const candidate = {
    ...input,
    at: input.at ?? new Date().toISOString(),
    argv,
    result: { ...input.result, summary },
    ...(cut ? { truncated: true } : {}),
  }
  // `parse` (không phải `safeParse`): entry hỏng là lỗi lập trình ở call site,
  // và nuốt nó đi chính là chế độ hỏng mà file này sinh ra để chặn.
  return InfraAuditEntrySchema.parse(candidate)
}

// ─── Ghi ─────────────────────────────────────────────────────────────────────

// Một hàng đợi cho MỌI thao tác ghi. Không phải để tăng tốc: `cleanInfraAudit`
// viết lại cả file bằng tmp + rename, nên một lượt append xen vào giữa sẽ rơi
// vào bản cũ rồi bị rename đè mất — tức là mất đúng dòng nhật ký vừa ghi.
let writeChain: Promise<unknown> = Promise.resolve()

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task)
  writeChain = run.catch(() => undefined)
  return run
}

// mkdir + chmod chạy mỗi lần ghi: hành động hạ tầng là nhịp của con người (vài
// chục lần một ngày), nên hai syscall thừa không đáng kể — đổi lại quyền thư
// mục tự lành nếu ai đó nới nó ra bằng tay.
async function ensureDir(): Promise<void> {
  const dir = infraAuditDir()
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dir, 0o700)
}

/** Append thô, KHÔNG qua hàng đợi — chỉ gọi từ trong một task đã xếp hàng. */
async function appendEntry(input: InfraAuditInput): Promise<void> {
  const { entry, line } = fitToLineCap(buildEntry(input))
  await ensureDir()
  const fh = await open(monthFile(monthOf(entry.at)), 'a', 0o600)
  try {
    await fh.appendFile(`${line}\n`)
  } finally {
    await fh.close()
  }
}

/**
 * Ghi một hành động hạ tầng. Gọi tại MỘT điểm duy nhất (`infra.run`), không
 * phải tại call site — một bề mặt quên gọi là một quãng thời gian không ai kiểm
 * lại được.
 *
 * Cố ý KHÔNG nuốt lỗi: nếu không ghi được thì người gọi phải biết.
 */
export function recordInfraAction(input: InfraAuditInput): Promise<void> {
  return enqueue(() => appendEntry(input))
}

// ─── Đọc ─────────────────────────────────────────────────────────────────────

type ScanNotes = { file: string; bad: number }

function noteBad(notes: ScanNotes, line: string, why: string): null {
  notes.bad += 1
  if (notes.bad <= MAX_WARN_PER_FILE) {
    // Dòng hỏng có thể là một dòng ghi DỞ lúc crash ⇒ vẫn có thể mang bí mật.
    log.warn('infra-audit: skipping malformed line', {
      file: notes.file,
      why,
      preview: redactString(line.slice(0, 120)),
    })
  } else if (notes.bad === MAX_WARN_PER_FILE + 1) {
    log.warn('infra-audit: further malformed lines suppressed', { file: notes.file })
  }
  return null
}

// Dòng hỏng (người sửa tay, ghi dở lúc crash) chỉ làm mất CHÍNH nó — không bao
// giờ được làm hỏng cả lượt truy vấn.
function parseLine(line: string, notes: ScanNotes): InfraAuditEntry | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let raw: unknown
  try {
    raw = JSON.parse(trimmed)
  } catch {
    return noteBad(notes, trimmed, 'not JSON')
  }
  const res = InfraAuditEntrySchema.safeParse(raw)
  if (!res.success) {
    const why = res.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join(',')
    return noteBad(notes, trimmed, why)
  }
  return res.data
}

/**
 * Đọc ngược từng dòng, theo từng chunk từ CUỐI file. Giữ phần dòng dở dang dưới
 * dạng Buffer chứ không phải string: biên chunk cắt giữa một ký tự UTF-8
 * multibyte, decode sớm là hỏng ký tự đó.
 */
async function* readLinesReverse(file: string): AsyncGenerator<string> {
  const fh = await open(file, 'r')
  try {
    const stat = await fh.stat()
    let pos = stat.size
    let tail = Buffer.alloc(0)
    while (pos > 0) {
      const len = Math.min(REVERSE_CHUNK_BYTES, pos)
      pos -= len
      const buf = Buffer.alloc(len)
      const { bytesRead } = await fh.read(buf, 0, len, pos)
      const data = bytesRead === len ? buf : buf.subarray(0, bytesRead)
      const chunk = tail.length > 0 ? Buffer.concat([data, tail]) : data
      let end = chunk.length
      for (let i = chunk.length - 1; i >= 0; i--) {
        if (chunk[i] !== NEWLINE) continue
        if (end > i + 1) yield chunk.subarray(i + 1, end).toString('utf8')
        end = i
      }
      tail = chunk.subarray(0, end)
      if (tail.length > MAX_PARTIAL_LINE_BYTES) {
        log.warn('infra-audit: dropping an oversized unterminated line', { file })
        tail = Buffer.alloc(0)
      }
      if (bytesRead < len) {
        // Đọc thiếu trên file thường gần như không xảy ra; nếu xảy ra thì mọi
        // thứ bên trái đã lệch khung, dừng còn hơn trả dữ liệu sai.
        log.warn('infra-audit: short read, stopping the reverse scan', { file })
        break
      }
    }
    if (tail.length > 0) yield tail.toString('utf8')
  } finally {
    await fh.close()
  }
}

function parseTime(value: string | undefined, label: string): number | null {
  if (value === undefined) return null
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) throw new Error(`infra-audit: invalid ${label} timestamp: ${value}`)
  return ms
}

type TimeRange = { sinceMs: number | null; untilMs: number | null }

function rangeOf(filter: InfraAuditFilter): TimeRange {
  return { sinceMs: parseTime(filter.since, 'since'), untilMs: parseTime(filter.until, 'until') }
}

function monthInRange(file: MonthFile, range: TimeRange): boolean {
  if (range.untilMs !== null && file.startMs > range.untilMs) return false
  if (range.sinceMs !== null && file.endMs < range.sinceMs) return false
  return true
}

function matches(entry: InfraAuditEntry, filter: InfraAuditFilter, range: TimeRange): boolean {
  const atMs = Date.parse(entry.at)
  if (range.sinceMs !== null && atMs < range.sinceMs) return false
  if (range.untilMs !== null && atMs > range.untilMs) return false
  if (filter.actor !== undefined && entry.actor !== filter.actor) return false
  if (filter.class !== undefined && entry.class !== filter.class) return false
  if (filter.decision !== undefined && entry.decision !== filter.decision) return false
  if (filter.contains !== undefined && filter.contains.length > 0) {
    const needle = filter.contains.toLowerCase()
    if (!entry.argv.some((arg) => arg.toLowerCase().includes(needle))) return false
  }
  return true
}

/** Duyệt MỚI NHẤT TRƯỚC. `visit` trả `false` để dừng sớm (đủ `limit`). */
async function scanNewestFirst(
  filter: InfraAuditFilter,
  visit: (entry: InfraAuditEntry) => boolean,
): Promise<void> {
  const range = rangeOf(filter)
  const files = await listMonthFiles()
  for (const file of files) {
    if (!monthInRange(file, range)) continue
    const notes: ScanNotes = { file: file.path, bad: 0 }
    for await (const line of readLinesReverse(file.path)) {
      const entry = parseLine(line, notes)
      if (!entry || !matches(entry, filter, range)) continue
      if (!visit(entry)) return
    }
  }
}

/** Mới nhất trước — đúng thứ tự màn Nhật ký hiển thị. */
export async function queryInfraAudit(opts: InfraAuditQuery = {}): Promise<InfraAuditEntry[]> {
  const limit = Math.min(Math.max(1, Math.trunc(opts.limit ?? DEFAULT_LIMIT)), MAX_LIMIT)
  const out: InfraAuditEntry[] = []
  await scanNewestFirst(opts, (entry) => {
    out.push(entry)
    return out.length < limit
  })
  return out
}

export async function summarizeInfraAudit(
  opts: InfraAuditFilter = {},
): Promise<InfraAuditSummary> {
  const byClass = Object.fromEntries(INFRA_COMMAND_CLASSES.map((c) => [c, 0])) as Record<
    InfraCommandClass,
    number
  >
  const byDecision = Object.fromEntries(INFRA_DECISIONS.map((d) => [d, 0])) as Record<
    InfraDecision,
    number
  >
  let total = 0
  let estimatedUsd = 0
  await scanNewestFirst(opts, (entry) => {
    total += 1
    byClass[entry.class] += 1
    byDecision[entry.decision] += 1
    estimatedUsd += entry.cost?.estimatedUsd ?? 0
    return true
  })
  return { total, byClass, byDecision, estimatedUsd }
}

// ─── Dọn ─────────────────────────────────────────────────────────────────────

/**
 * Viết lại một file tháng, bỏ các dòng khớp bộ lọc. Trả về số dòng đã bỏ.
 *
 * Dòng HỎNG được GIỮ LẠI: bộ lọc không đánh giá được nó, nên xoá nó là xoá thứ
 * người dùng không yêu cầu xoá.
 */
async function rewriteFile(
  file: MonthFile,
  filter: InfraAuditFilter,
  range: TimeRange,
): Promise<number> {
  const tmp = `${file.path}.tmp.${process.pid}`
  const notes: ScanNotes = { file: file.path, bad: 0 }
  const out = await open(tmp, 'w', 0o600)
  let removed = 0
  let kept = 0
  const stream = createReadStream(file.path, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (!line.trim()) continue
      const entry = parseLine(line, notes)
      if (entry && matches(entry, filter, range)) {
        removed += 1
        continue
      }
      kept += 1
      await out.write(`${line}\n`)
    }
  } finally {
    rl.close()
    stream.destroy()
    await out.close()
  }
  if (removed === 0) {
    await unlink(tmp)
    return 0
  }
  if (kept === 0) {
    await unlink(tmp)
    await unlink(file.path)
    return removed
  }
  await rename(tmp, file.path)
  return removed
}

async function removeMatching(filter: InfraAuditFilter): Promise<number> {
  const range = rangeOf(filter)
  const files = await listMonthFiles()
  let removed = 0
  for (const file of files) {
    if (!monthInRange(file, range)) continue
    removed += await rewriteFile(file, filter, range)
  }
  return removed
}

function describeFilter(filter: InfraAuditFilter): string {
  const parts: string[] = []
  if (filter.since !== undefined) parts.push(`since=${filter.since}`)
  if (filter.until !== undefined) parts.push(`until=${filter.until}`)
  if (filter.actor !== undefined) parts.push(`actor=${filter.actor}`)
  if (filter.class !== undefined) parts.push(`class=${filter.class}`)
  if (filter.decision !== undefined) parts.push(`decision=${filter.decision}`)
  if (filter.contains !== undefined) parts.push(`contains=${filter.contains}`)
  return parts.length > 0 ? parts.join(' ') : 'everything'
}

/**
 * Dọn theo bộ lọc — bề mặt của NGƯỜI dùng (màn Nhật ký, sau hộp xác nhận nêu
 * đúng số dòng sẽ mất). KHÔNG BAO GIỜ map hàm này vào một tool cho agent.
 *
 * Xoá TRƯỚC, ghi dấu SAU, trong cùng một lượt của hàng đợi ghi: nhờ thứ tự đó,
 * dòng ghi việc dọn không bao giờ nằm trong phạm vi vừa bị xoá — kể cả khi bộ
 * lọc là "tất cả". Nếu dọn được sạch dấu vết thì nhật ký không còn là bằng
 * chứng, và cả file này mất lý do tồn tại.
 *
 * Ghi cả khi `removed === 0`: một lần thử dọn cũng là một hành động.
 */
export function cleanInfraAudit(filter: InfraAuditFilter = {}): Promise<{ removed: number }> {
  return enqueue(async () => {
    const removed = await removeMatching(filter)
    await appendEntry({
      actor: 'human',
      surface: 'settings',
      tool: 'infra_audit',
      argv: ['audit', 'clean'],
      context: {},
      class: 'destructive',
      decision: 'approved',
      result: { summary: `removed ${removed} entries, range ${describeFilter(filter)}` },
    })
    return { removed }
  })
}

/**
 * Tự hết hạn (mặc định 90 ngày) — chạy theo chính sách ở Settings, không phải
 * theo yêu cầu của agent. Cũng để lại dấu, với `actor: 'schedule:retention'` vì
 * người ra lệnh ở đây là chính sách chứ không phải một con người cụ thể.
 */
export function pruneExpired(
  days: number = DEFAULT_RETENTION_DAYS,
): Promise<{ removed: number }> {
  const span = Math.max(1, Math.trunc(days))
  const cutoff = new Date(Date.now() - span * 24 * 60 * 60 * 1000).toISOString()
  return enqueue(async () => {
    const removed = await removeMatching({ until: cutoff })
    if (removed > 0) {
      await appendEntry({
        actor: 'schedule:retention',
        surface: 'settings',
        tool: 'infra_audit',
        argv: ['audit', 'prune', '--days', String(span)],
        context: {},
        class: 'destructive',
        decision: 'auto',
        result: { summary: `removed ${removed} entries older than ${cutoff}` },
      })
    }
    return { removed }
  })
}
