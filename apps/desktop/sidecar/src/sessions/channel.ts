// Kênh CHUNG của một nhóm phiên (Session Teams, docs/features/session-teams.md
// §1.3 + §6) — JSONL append-only tại `~/.awog/team-runs/<teamRunId>/channel.jsonl`.
//
// Khác hộp thư 1-1 (`inbox.ts`): post vào channel là nói với CẢ ê-kíp — tail của
// kênh được inject vào lượt của mọi phiên trong nhóm (pull-based, xem
// sessions/team-context.ts), nên một post MẶC ĐỊNH không đánh thức ai. Chỉ hai
// hình thái có wake (đúng bảng re-trigger §6 của spec):
//   • member post CÓ mentions    → wake từng sessionId được mention (lead chỉ
//                                  tỉnh khi chính nó nằm trong mentions);
//   • member post KHÔNG mention  → wake lead (dedup 60s/rootId, in-memory).
// Post của chính lead (`from === rootId`), của người dùng (`from === null`) và
// mọi entry kind 'eval'/'note'/'system' KHÔNG wake ai — 'note' là ghi chú của
// người dùng (không bao giờ wake, xem TeamChannelKind), 'eval' là nhật ký nhận
// định của lead, 'system' là thông báo máy (wave xong, merge xong…).
//
// Ghi = appendFile + trần kích thước: file vượt ~200KB ⇒ đọc lại, giữ các dòng
// MỚI NHẤT vừa dưới trần, rewrite nguyên tử (tmp + rename + chmod 600 — cùng
// khuôn boards/store.ts). Hai writer của cùng một nhóm có thể `await` xen nhau,
// nên append + truncate đi qua một hàng đợi promise per rootId — giống
// withBoardLock của board, kênh là điểm gặp của mọi member.
//
// Wake = postSessionMessage trên đường hộp thư sẵn có: member↔lead là group edge
// nên tin đi trọn pipeline dedup/hop của inbox, rồi renderer tự giao+chạy. Mọi
// đường wake đều BEST-EFFORT: entry đã ghi xong thì một wake tắc chỉ đáng
// log.warn, KHÔNG được làm postChannelEntry throw.

import { appendFile, chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { awogHome, sanitizeChild } from '../util/path.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import { redactString } from './redact.js'
import { oneLineLabel, postSessionMessage } from './inbox.js'
import { activeSessionIds } from './runner.js'
import type { TeamChannelEntry, TeamChannelKind } from '../types/shared.js'

// Trần nội dung MỘT entry — đủ cho một báo cáo/hoạt động, không đủ để đổ nguyên
// transcript một phiên lên kênh chung (cùng trần MAX_TEXT_LEN của inbox).
export const MAX_CHANNEL_TEXT_LEN = 4000
// Trần dung lượng FILE (~200KB theo spec). Khi vượt, rewrite giữ tail.
const MAX_CHANNEL_BYTES = 200 * 1024
// Sau khi chạm trần, rewrite chỉ giữ tail vừa ~80% trần — cắt sát nút sẽ khiến
// MỖI post sau đều phải truncate lại (O(n) đọc+ghi mỗi append).
const TRIM_TARGET_BYTES = Math.floor(MAX_CHANNEL_BYTES * 0.8)
// Tail mặc định khi đọc lên để inject — đủ ngữ cảnh, nhỏ hơn một màn hình prompt.
export const DEFAULT_CHANNEL_TAIL_CHARS = 4000
// Nhãn hiển thị là một dòng phẳng — cùng trần của danh bạ hộp thư.
const MAX_TITLE_LEN = 80
// Dedup wake-lead: cùng một gốc không bị ping quá một lần / 60s.
const LEAD_WAKE_DEDUP_MS = 60 * 1000
// Trần số mention trên một post — wake là đắt tiền.
const MAX_MENTIONS = 16
// Độ dài thân tin wake qua hộp thư: mention 500 (người được gọi cần đủ ngữ cảnh),
// lead-wake 300 (lead đọc lại channel qua <team> inject + channel_read).
const MENTION_WAKE_CHARS = 500
const LEAD_WAKE_CHARS = 300
// Session id theo charset đã siết ở sessions.setGroup / sessions.delete —
// mentions là sessionId nên áp đúng trần đó (L1 sạch sớm, không vào path sink
// nhưng đi vào JSONL + context của người khác).
const SESSION_ID_RE = /^[a-z0-9-]+$/

const RUNS_DIR_NAME = sanitizeChild('team-runs')

function channelDir(rootId: string): string {
  return join(awogHome(), RUNS_DIR_NAME, sanitizeChild(rootId))
}

function channelFile(rootId: string): string {
  return join(channelDir(rootId), 'channel.jsonl')
}

// ─── Hàng đợi ghi nối tiếp per rootId ────────────────────────────────────────
// Một nhịp hỏng không được làm kẹt cả hàng (catch(() => {}) trước khi nối), và
// entry được gỡ khi hàng rỗng để map không phình theo số nhóm từng đụng tới —
// y hệt writeQueues của boards/store.ts.
const writeQueues = new Map<string, Promise<unknown>>()

function withChannelLock<T>(rootId: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(rootId) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(fn)
  writeQueues.set(rootId, next)
  void next.finally(() => {
    if (writeQueues.get(rootId) === next) writeQueues.delete(rootId)
  })
  return next
}

// Dedup wake-lead — in-memory theo rootId (spec §6: "lead đã wake trong 60s →
// bỏ qua"). Mất khi restart chỉ có nghĩa lead bị ping thêm đúng một lần.
const leadWakeAt = new Map<string, number>()

// Dùng cho test: xoá sạch state dedup để hai bài test liên tiếp không ăn cửa sổ
// 60s của nhau.
export function __resetChannelDedup(): void {
  leadWakeAt.clear()
}

function mintEntryId(): string {
  return `tch-${randomBytes(6).toString('hex')}`
}

// File đã vượt trần ⇒ giữ các dòng MỚI NHẤT vừa trong TRIM_TARGET_BYTES và
// rewrite nguyên tử. Entry bị cắt mất là entry CŨ NHẤT — channel là bản tin
// chạy, tail mới là phần có giá trị (đúng hướng boards dọn file hỏng).
async function trimChannelFile(rootId: string, file: string): Promise<void> {
  const raw = await readFile(file, 'utf8')
  const lines = raw.split('\n').filter((l) => l.length > 0)
  const kept: string[] = []
  let size = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    const len = Buffer.byteLength(lines[i] as string, 'utf8') + 1
    if (size + len > TRIM_TARGET_BYTES && kept.length > 0) break
    kept.unshift(lines[i] as string)
    size += len
  }
  if (kept.length === lines.length) return
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, kept.join('\n') + '\n', 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
  log.info('channel file trimmed to newest entries', {
    rootId,
    droppedLines: lines.length - kept.length,
  })
}

// Một entry do MODEL viết sẽ quay lại context của mọi member qua tail inject —
// khử bí mật TẠI ĐÂY một lần (cùng triết lý cleanDesc của boards), và chuẩn hoá
// mentions về sessionId hợp lệ, bỏ trùng + bỏ tự-mention trước khi ghi.
function sanitizeMentions(raw: string[] | undefined, from: string | null): string[] {
  if (!raw || raw.length === 0) return []
  const out: string[] = []
  for (const m of raw) {
    if (typeof m !== 'string' || !SESSION_ID_RE.test(m)) continue
    if (m === from || out.includes(m)) continue
    out.push(m)
    if (out.length >= MAX_MENTIONS) break
  }
  return out
}

// ─── Wake (re-trigger) ───────────────────────────────────────────────────────

// Báo từng session được mention qua hộp thư — mỗi đích một try/catch riêng để
// một đích tắc không kéo hỏng các đích còn lại.
async function wakeMentions(rootId: string, entry: TeamChannelEntry): Promise<void> {
  for (const to of entry.mentions ?? []) {
    try {
      await postSessionMessage({
        from: entry.from,
        to,
        text: `[channel] ${entry.fromTitle}: ${entry.text.slice(0, MENTION_WAKE_CHARS)}`,
      })
    } catch (err) {
      log.warn('channel mention wake failed', {
        rootId,
        from: entry.from,
        to,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

// Wake lead khi member post KHÔNG mention ai — lead re-evaluate board + channel.
// Dedup 60s theo rootId + bỏ qua khi lead đang chạy một lượt (tin chỉ xếp thừa).
// Mốc dedup được đánh TRƯỚC khi gọi: một hộp thư tắc dai dẳng (lead lưu trữ…)
// cũng không được phân rã thành retry mỗi post.
async function wakeLead(rootId: string, entry: TeamChannelEntry): Promise<void> {
  const now = Date.now()
  if (now - (leadWakeAt.get(rootId) ?? 0) < LEAD_WAKE_DEDUP_MS) return
  if (activeSessionIds().includes(rootId)) return
  leadWakeAt.set(rootId, now)
  try {
    await postSessionMessage({
      from: entry.from,
      to: rootId,
      text: `[channel] ${entry.fromTitle}: ${entry.text.slice(0, LEAD_WAKE_CHARS)}`,
    })
  } catch (err) {
    log.warn('channel lead wake failed', {
      rootId,
      from: entry.from,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

// ─── API công khai ───────────────────────────────────────────────────────────

export async function postChannelEntry(
  rootId: string,
  input: {
    from: string | null
    fromTitle: string
    kind: TeamChannelKind
    text: string
    mentions?: string[]
  },
): Promise<TeamChannelEntry> {
  const text = redactString(input.text)
  if (!text.trim()) {
    throw new Error('channel entry text is empty; nothing was posted')
  }
  const mentions = sanitizeMentions(input.mentions, input.from)
  const entry: TeamChannelEntry = {
    id: mintEntryId(),
    at: new Date().toISOString(),
    from: input.from,
    fromTitle: oneLineLabel(redactString(input.fromTitle), MAX_TITLE_LEN) || 'unknown',
    kind: input.kind,
    text:
      text.length > MAX_CHANNEL_TEXT_LEN
        ? `${text.slice(0, MAX_CHANNEL_TEXT_LEN - 1)}…`
        : text,
    ...(mentions.length > 0 ? { mentions } : {}),
  }

  await withChannelLock(rootId, async () => {
    const file = channelFile(rootId)
    await mkdir(channelDir(rootId), { recursive: true, mode: 0o700 })
    await appendFile(file, JSON.stringify(entry) + '\n', 'utf8')
    const st = await stat(file).catch(() => null)
    if (st && st.size > MAX_CHANNEL_BYTES) await trimChannelFile(rootId, file)
  })

  // Phát cho renderer append feed (spec §7) — sau khi entry đã nằm trên đĩa.
  emit('channel.appended', { rootId, entry })

  // Re-trigger: chỉ post của MEMBER (from ≠ null, ≠ gốc) với kind chat/status.
  // eval = nhật định của lead, note = ghi chú người dùng, system = thông báo máy
  // — không loại nào được phép tốn một lượt wake của ai.
  const wakeable =
    input.from !== null &&
    input.from !== rootId &&
    (input.kind === 'chat' || input.kind === 'status')
  if (!wakeable) return entry

  if ((entry.mentions?.length ?? 0) > 0) await wakeMentions(rootId, entry)
  else await wakeLead(rootId, entry)
  return entry
}

// Đọc tail của kênh: duyệt NGƯỢC từ entry mới nhất, gom cho tới khi cán trần
// maxChars (đếm theo độ dài text — xấp xỉ trần prompt, spec §2), rồi trả lại
// THEO THỨ TỰ THỜI GIAN. File vắng / hỏng / rootId xấu ⇒ [] — đây là đường đọc
// cho context inject, một kênh không đọc được chỉ có nghĩa "không có gì mới".
export async function readChannelTail(
  rootId: string,
  maxChars: number = DEFAULT_CHANNEL_TAIL_CHARS,
): Promise<TeamChannelEntry[]> {
  let raw: string
  try {
    raw = await readFile(channelFile(rootId), 'utf8')
  } catch {
    return []
  }
  const entries: TeamChannelEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    try {
      const e = JSON.parse(line) as TeamChannelEntry
      if (
        typeof e.id === 'string' &&
        typeof e.at === 'string' &&
        typeof e.text === 'string' &&
        typeof e.fromTitle === 'string'
      ) {
        entries.push(e)
      }
    } catch {
      // Dòng hỏng (sửa tay / ghi dở) bị bỏ qua, không kéo sập cả tail.
    }
  }
  const out: TeamChannelEntry[] = []
  let chars = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as TeamChannelEntry
    if (out.length > 0 && chars + e.text.length > maxChars) break
    out.unshift(e)
    chars += e.text.length
  }
  return out
}
