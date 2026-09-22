// Logtime persistence (ADR 0091 D-4). Một file JSON cho mỗi tháng:
//
//   ~/.awog/logtime/2026-09.json     — các ngày + dòng công của tháng đó
//   ~/.awog/logtime/settings.json    — mức giờ, bậc làm tròn, giờ nhắc, mapping
//
// Global-only, KHÔNG 2 tier như wiki/memory: giờ công thuộc về *người*, không
// thuộc về project — một ngày gồm nhiều project là ca thường chứ không phải ngoại lệ.
//
// Ghi atomic (tmp + rename) vì một tháng là một file: ghi dở giữa chừng là mất cả
// tháng chứ không phải mất một dòng.

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { RpcError } from '../transport/rpc.js'
import { emit } from '../transport/stdio.js'
import type {
  LogtimeEntry,
  LogtimeLink,
  LogtimeMonth,
  LogtimeSettings,
  LogtimeStatus,
  LogtimeTaskRef,
} from '../types/shared.js'

const DIR_NAME = sanitizeChild('logtime')
const MONTH_RE = /^\d{4}-\d{2}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_ENTRIES_PER_DAY = 40
const MAX_NOTE_CHARS = 2000

// Trần cứng của `worklog_create` phía PMS (hours 0.25–24). Giữ đúng ở biên ghi để
// một dòng không bao giờ ra tới MCP với giá trị server chắc chắn từ chối.
const MIN_HOURS = 0.25
const MAX_HOURS = 24

export const DEFAULT_SETTINGS: LogtimeSettings = {
  dailyHours: 8,
  roundStep: 0.5,
  remindAt: '17:30',
  remindEnabled: true,
  sourceIds: [],
  links: [],
}

function logtimeDir(): string {
  return join(awogHome(), DIR_NAME)
}

function monthFile(month: string): string {
  if (!MONTH_RE.test(month)) throw new RpcError(-32602, `Invalid month: ${month}`)
  return join(logtimeDir(), `${sanitizeChild(month)}.json`)
}

function settingsFile(): string {
  return join(logtimeDir(), 'settings.json')
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch (err) {
    if (isMissing(err)) return null
    // File hỏng (ghi dở từ bản cũ, sửa tay sai cú pháp) — không nuốt im lặng: một
    // tháng công biến mất là chuyện phải nhìn thấy.
    throw new RpcError(-32603, `Logtime file unreadable: ${file}`)
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(logtimeDir(), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    await rename(tmp, file)
  } catch (err) {
    await unlink(tmp).catch(() => {})
    throw err
  }
}

// ── Settings ─────────────────────────────────────────────────────────────────

function clampStep(value: unknown): number {
  const n = Number(value)
  // Ba bậc hợp lệ, khớp ràng buộc hours ≥ 0.25 của PMS.
  return n === 0.25 || n === 0.5 || n === 1 ? n : DEFAULT_SETTINGS.roundStep
}

function clampDaily(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.dailyHours
  return Math.min(MAX_HOURS, Math.max(0, Math.round(n * 4) / 4))
}

export async function loadSettings(): Promise<LogtimeSettings> {
  const raw = await readJson<Partial<LogtimeSettings>>(settingsFile())
  if (!raw) return { ...DEFAULT_SETTINGS }
  return {
    dailyHours: clampDaily(raw.dailyHours),
    roundStep: clampStep(raw.roundStep),
    remindAt: typeof raw.remindAt === 'string' ? raw.remindAt.slice(0, 5) : DEFAULT_SETTINGS.remindAt,
    remindEnabled: raw.remindEnabled !== false,
    sourceIds: Array.isArray(raw.sourceIds)
      ? raw.sourceIds.filter((s) => typeof s === 'string' && s.length > 0).slice(0, 50)
      : [],
    links: Array.isArray(raw.links)
      ? raw.links
          .filter((l) => l && typeof l.projectKey === 'string' && typeof l.sourceId === 'string')
          .slice(0, 200)
      : [],
  }
}

// exactOptionalPropertyTypes: field vắng mặt và field = undefined phải cùng nghĩa
// "giữ nguyên giá trị cũ", nên khai `| undefined` tường minh thay vì Partial<>.
export interface LogtimeSettingsInput {
  dailyHours?: number | undefined
  roundStep?: number | undefined
  remindAt?: string | undefined
  remindEnabled?: boolean | undefined
  sourceIds?: string[] | undefined
  links?: LogtimeLink[] | undefined
}

export async function saveSettings(input: LogtimeSettingsInput): Promise<LogtimeSettings> {
  const current = await loadSettings()
  const next: LogtimeSettings = {
    dailyHours: input.dailyHours === undefined ? current.dailyHours : clampDaily(input.dailyHours),
    roundStep: input.roundStep === undefined ? current.roundStep : clampStep(input.roundStep),
    remindAt: input.remindAt === undefined ? current.remindAt : String(input.remindAt).slice(0, 5),
    remindEnabled: input.remindEnabled === undefined ? current.remindEnabled : !!input.remindEnabled,
    sourceIds:
      input.sourceIds === undefined
        ? current.sourceIds
        : [...new Set(input.sourceIds.filter((s) => typeof s === 'string' && s.length > 0))].slice(
            0,
            50,
          ),
    links: input.links === undefined ? current.links : input.links.slice(0, 200),
  }
  await writeJsonAtomic(settingsFile(), next)
  return next
}

// Có dự án nào đã nối với PMS chưa — dùng để quyết định CÓ advertise bộ tool
// logtime cho một lượt chat hay không (chưa dùng Logtime thì không tốn token schema).
export async function hasLogtimeLinks(): Promise<boolean> {
  const settings = await loadSettings()
  return settings.links.some((l) => !!l.pmsProjectId)
}

// ── Tháng ────────────────────────────────────────────────────────────────────

export function monthOf(date: string): string {
  if (!DATE_RE.test(date)) throw new RpcError(-32602, `Invalid date: ${date}`)
  return date.slice(0, 7)
}

export async function loadMonth(month: string): Promise<LogtimeMonth> {
  const raw = await readJson<LogtimeMonth>(monthFile(month))
  if (!raw || typeof raw !== 'object') return { month, days: {} }
  return { month, days: raw.days && typeof raw.days === 'object' ? raw.days : {} }
}

// Dòng công đến từ UI (L1) — mọi field optional có thể là undefined tường minh.
export interface LogtimeEntryInput {
  id?: string | undefined
  projectKey: string
  note?: string | undefined
  hours: number
  task?: LogtimeTaskRef | undefined
  status?: LogtimeStatus | undefined
  worklogId?: string | undefined
  lockedAt?: string | undefined
  sourceRefId?: string | undefined
}

function normalizeEntry(raw: LogtimeEntryInput): LogtimeEntry {
  const hours = Number(raw.hours)
  if (!Number.isFinite(hours) || hours < MIN_HOURS || hours > MAX_HOURS) {
    throw new RpcError(-32602, `hours must be between ${MIN_HOURS} and ${MAX_HOURS}`)
  }
  if (typeof raw.projectKey !== 'string' || raw.projectKey.length === 0) {
    throw new RpcError(-32602, 'projectKey is required')
  }
  const id = typeof raw.id === 'string' && raw.id ? raw.id : `lt_${randomUUID()}`
  const status: LogtimeStatus =
    raw.status === 'posted' || raw.status === 'locked' ? raw.status : 'draft'
  return {
    id,
    projectKey: raw.projectKey,
    note: String(raw.note ?? '').slice(0, MAX_NOTE_CHARS),
    hours,
    ...(raw.task ? { task: raw.task } : {}),
    status,
    ...(raw.worklogId ? { worklogId: raw.worklogId } : {}),
    ...(raw.lockedAt ? { lockedAt: raw.lockedAt } : {}),
    ...(raw.sourceRefId ? { sourceRefId: raw.sourceRefId } : {}),
    updatedAt: Date.now(),
  }
}

// Ghi đè nguyên một ngày. UI luôn gửi cả ngày (ít dòng, và merge từng dòng ở hai
// nơi là cách chắc chắn nhất để hai bên lệch nhau).
export async function saveDay(
  date: string,
  entries: LogtimeEntryInput[],
  source: LogtimeChangeSource = 'user',
): Promise<LogtimeDayResult> {
  const month = monthOf(date)
  if (entries.length > MAX_ENTRIES_PER_DAY) {
    throw new RpcError(-32602, `Too many entries for one day (max ${MAX_ENTRIES_PER_DAY})`)
  }
  const doc = await loadMonth(month)
  const normalized = entries.map(normalizeEntry)
  if (normalized.length === 0) delete doc.days[date]
  else doc.days[date] = { entries: normalized }
  await writeJsonAtomic(monthFile(month), doc)
  emitChanged(date, source)
  return { date, entries: normalized }
}

export interface LogtimeDayResult {
  date: string
  entries: LogtimeEntry[]
}

// Gắn kết quả đẩy vào đúng dòng (worklogId + status). Đọc lại từ đĩa thay vì tin
// bản UI đang giữ: giữa lúc đẩy người dùng vẫn có thể đã sửa ngày khác.
export async function markPushed(
  date: string,
  results: { entryId: string; worklogId?: string }[],
): Promise<LogtimeDayResult> {
  const month = monthOf(date)
  const doc = await loadMonth(month)
  const day = doc.days[date]
  if (!day) return { date, entries: [] }
  const byId = new Map(results.map((r) => [r.entryId, r]))
  for (const entry of day.entries) {
    const hit = byId.get(entry.id)
    if (!hit?.worklogId) continue
    entry.worklogId = hit.worklogId
    entry.status = 'posted'
    entry.updatedAt = Date.now()
  }
  await writeJsonAtomic(monthFile(month), doc)
  emitChanged(date, 'push')
  return { date, entries: day.entries }
}

// ── Sự kiện ──────────────────────────────────────────────────────────────────
// Ai ghi cũng phát: phiên chat thêm một dòng thì trang /logtime đang mở phải thấy
// ngay, chứ không phải chờ người dùng bấm reload. `source` để UI biết có nên hiện
// thông báo hay không (thay đổi do chính mình gây ra thì không cần báo lại).

export type LogtimeChangeSource = 'user' | 'agent' | 'push' | 'pull'

export interface LogtimeChangedEvent {
  date: string
  month: string
  source: LogtimeChangeSource
}

function emitChanged(date: string, source: LogtimeChangeSource): void {
  const payload: LogtimeChangedEvent = { date, month: monthOf(date), source }
  emit('logtime.changed', payload)
}

// Cổng THÊM một dòng phía sidecar (ADR 0091 D-6). UI có bản gate riêng để phản hồi
// tức thì, nhưng đường của agent không đi qua UI nên luật phải sống ở đây nữa —
// nếu không, một phiên chat có thể khai 20h/ngày.
//
// ⚠ `saveDay` CỐ Ý không chặn trần: `logtime.pull` phải nhận được đúng những gì
// PMS có, kể cả khi tổng vượt mức người dùng vừa hạ xuống. Trần chỉ chặn đường
// THÊM MỚI.
export interface AddEntryOutcome {
  ok: boolean
  reason: 'ok' | 'full' | 'duplicate'
  added: number
  cut: boolean
  entry?: LogtimeEntry
  total: number
  budget: number
}

export async function addEntryGated(
  date: string,
  input: { projectKey: string; note: string; hours: number; task?: LogtimeTaskRef | undefined },
  source: LogtimeChangeSource = 'agent',
): Promise<AddEntryOutcome> {
  const settings = await loadSettings()
  const doc = await loadMonth(monthOf(date))
  const existing = doc.days[date]?.entries ?? []
  const total = existing.reduce((sum, e) => sum + e.hours, 0)
  const budget = settings.dailyHours
  const note = input.note.trim()

  if (existing.some((e) => e.projectKey === input.projectKey && e.note === note)) {
    return { ok: false, reason: 'duplicate', added: 0, cut: false, total, budget }
  }
  const left = Math.max(0, budget - total)
  if (left < MIN_HOURS) {
    return { ok: false, reason: 'full', added: 0, cut: false, total, budget }
  }
  const hours = Math.min(input.hours, left)
  const saved = await saveDay(
    date,
    [...existing, { projectKey: input.projectKey, note, hours, task: input.task }],
    source,
  )
  const entry = saved.entries[saved.entries.length - 1]
  return {
    ok: true,
    reason: 'ok',
    added: hours,
    cut: hours < input.hours,
    ...(entry ? { entry } : {}),
    total: total + hours,
    budget,
  }
}

// Xoá một dòng NHÁP theo id. Dòng đã đẩy/khoá không xoá bằng đường này — nó còn
// sống trên PMS, xoá ở AWOG chỉ làm hai bên lệch nhau.
export async function removeDraft(
  date: string,
  entryId: string,
  source: LogtimeChangeSource = 'agent',
): Promise<{ removed: boolean; reason?: string }> {
  const doc = await loadMonth(monthOf(date))
  const entries = doc.days[date]?.entries ?? []
  const target = entries.find((e) => e.id === entryId)
  if (!target) return { removed: false, reason: 'not found' }
  if (target.status !== 'draft') return { removed: false, reason: `entry is ${target.status}` }
  await saveDay(
    date,
    entries.filter((e) => e.id !== entryId),
    source,
  )
  return { removed: true }
}
