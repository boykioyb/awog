// Kênh CHUNG của một nhóm phiên (Session Teams, docs/features/session-teams.md
// §1.3 + §6) — JSONL append-only tại `~/.awog/team-runs/<teamRunId>/channel.jsonl`.
//
// Khác hộp thư 1-1 (`inbox.ts`): post vào channel là nói với CẢ ê-kíp — tail của
// kênh được inject vào lượt của mọi phiên trong nhóm (pull-based, xem
// sessions/team-context.ts), nên một post MẶC ĐỊNH không đánh thức ai. Ba hình
// thái có wake (đúng bảng re-trigger §6 của spec):
//   • member post CÓ mentions       → wake từng sessionId được mention (lead chỉ
//                                     tỉnh khi chính nó nằm trong mentions);
//   • member post KHÔNG mention     → wake lead (dedup 60s/rootId, in-memory);
//   • user post 'chat' CÓ mentions  → wake từng sessionId được mention — "@Dev"
//                                     là chủ đích gọi, không phải broadcast.
// Post của chính lead (`from === rootId`), user post KHÔNG mention (broadcast/
// 'note' = ghi chú, không lôi ai vào) và mọi entry kind 'eval'/'system' KHÔNG
// wake ai — 'eval' là nhật ký nhận định của lead, 'system' là thông báo máy
// (wave xong, merge xong…).
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
import { listSessionSummaries } from './store.js'
import { listBoardItems } from '../boards/store.js'
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
  channelWakeMarks.clear()
}

// ─── Marker "wake kênh → câu trả lời PHẢI lên kênh" ────────────────────────────
// Chỉ dẫn team_say trong tin wake là MỀM — model cứng đầu vẫn trả lời trong
// transcript riêng và kênh không bao giờ thấy (người hỏi ngồi chờ bubble trống).
// Marker này đóng lỗ đó một cách DETERMINISTIC: wakeMentions đánh dấu từng đích
// kèm rootId + itemId của entry gốc; send-message gọi mirrorCommReply khi lượt
// COMM của đích kết thúc → text lượt đó được ghi lên kênh như một 'chat' của
// chính phiên. Nếu model đã ngoan — team_say trong lượt đó — kênh đã có câu trả
// lời thật nên mirror bỏ qua để không đúp. Marker bị ghi đè bởi wake mới và hết
// hạn sau TTL: một reply rất muộn không được phép gán nhầm ngữ cảnh ping cũ.
const CHANNEL_WAKE_MARK_TTL_MS = 30 * 60 * 1000
// Trần nội dung mirror — dưới trần entry, đủ cho một câu trả lời trò chuyện.
const CHANNEL_MIRROR_CHARS = 2000
interface ChannelWakeMark {
  rootId: string
  itemId?: string
  at: number
}
const channelWakeMarks = new Map<string, ChannelWakeMark>()

// Đánh dấu đích vừa được wake — gọi SAU postSessionMessage thành công, chỉ từ
// wakeMentions (wake-lead không đánh dấu: lead re-evaluate, không phải trả lời
// một câu hỏi trực tiếp).
function markChannelWake(to: string, mark: Omit<ChannelWakeMark, 'at'>): void {
  channelWakeMarks.set(to, { ...mark, at: Date.now() })
}

// Được gọi khi một lượt comm kết thúc có text: nếu phiên này đang mang marker
// còn hạn → mirror text lên kênh gốc (tag item gốc nếu có) TRỪ KHI phiên đã
// tự post lên kênh sau mốc wake. Mọi lỗi nuốt tại chỗ — một mirror hỏng không
// được phép làm hỏng lượt vừa xong.
export async function mirrorCommReply(sessionId: string, text: string): Promise<void> {
  const mark = channelWakeMarks.get(sessionId)
  if (!mark) return
  channelWakeMarks.delete(sessionId)
  try {
    if (Date.now() - mark.at > CHANNEL_WAKE_MARK_TTL_MS) return
    const tail = await readChannelTail(mark.rootId, DEFAULT_CHANNEL_TAIL_CHARS)
    if (tail.some((e) => e.from === sessionId && Date.parse(e.at) >= mark.at)) return
    const clipped = text.trim().slice(0, CHANNEL_MIRROR_CHARS)
    if (!clipped) return
    const title = oneLineLabel(
      (await listSessionSummaries()).find((s) => s.id === sessionId)?.title ?? sessionId,
      MAX_TITLE_LEN,
    )
    await postChannelEntry(mark.rootId, {
      from: sessionId,
      fromTitle: title,
      kind: 'chat',
      text: clipped,
      ...(mark.itemId ? { itemId: mark.itemId } : {}),
    })
  } catch (err) {
    log.warn('channel reply mirror failed', {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    })
  }
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
// một đích tắc không kéo hỏng các đích còn lại. Tin phải nói RÕ trả lời bằng
// team_say (kèm item_id khi entry gắn item): không có chỉ dẫn này, phiên đích
// đọc như một DM và trả lời trong transcript riêng — người hỏi trên kênh
// không bao giờ thấy (cùng bệnh `[board]` ping của boards.comment đã vá).
async function wakeMentions(rootId: string, entry: TeamChannelEntry): Promise<void> {
  const text =
    `[channel] ${entry.fromTitle} mentioned you on the team channel` +
    `${entry.itemId ? ` about item ${entry.itemId}` : ''}: ` +
    `"${entry.text.slice(0, MENTION_WAKE_CHARS)}". ` +
    `Reply ON THE CHANNEL via team_say${entry.itemId ? ` (item_id: "${entry.itemId}")` : ''} — ` +
    'a reply inside this session is invisible to the channel: the asker and the rest of the team cannot see your transcript.'
  const titles = new Map((await listSessionSummaries()).map((s) => [s.id, s.title]))
  const receipts: string[] = []
  for (const to of entry.mentions ?? []) {
    const title = oneLineLabel(titles.get(to) ?? to, MAX_TITLE_LEN)
    try {
      await postSessionMessage({
        from: entry.from,
        to,
        text,
        // Wake trò chuyện: lượt mở ra là để trả lời nhanh trên kênh, không
        // phải để làm việc sâu — renderer kẹp cấu hình rẻ/nhanh cho lượt đó.
        comm: true,
      })
      const markTag = entry.itemId ?? entry.itemIds?.[0]
      markChannelWake(to, { rootId, ...(markTag ? { itemId: markTag } : {}) })
      receipts.push(
        activeSessionIds().includes(to)
          ? `"${title}" is mid-turn — will read after it finishes`
          : `delivered to "${title}"`,
      )
    } catch (err) {
      log.warn('channel mention wake failed', {
        rootId,
        from: entry.from,
        to,
        err: err instanceof Error ? err.message : String(err),
      })
      receipts.push(`"${title}" could not be reached`)
    }
  }
  // Vạch biên nhận — cùng khuôn system-comment của boards.comment: người dùng
  // thấy NGAY tin đã tới ai và người đó rảnh hay đang trong lượt, không phải
  // chờ tới khi member thật sự trả lời. kind 'system' ⇒ hiện như vạch chia
  // trong feed (tag item gốc để rơi đúng Discuss), không wake ai.
  if (receipts.length > 0) {
    const receiptTag = entry.itemId ?? entry.itemIds?.[0]
    try {
      await postChannelEntry(rootId, {
        from: null,
        fromTitle: 'system',
        kind: 'system',
        text: receipts.join(' · '),
        ...(receiptTag ? { itemId: receiptTag } : {}),
      })
    } catch (err) {
      log.warn('channel wake receipt failed', {
        rootId,
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
  const title = oneLineLabel(
    (await listSessionSummaries()).find((s) => s.id === rootId)?.title ?? rootId,
    MAX_TITLE_LEN,
  )
  let receipt: string
  try {
    await postSessionMessage({
      from: entry.from,
      to: rootId,
      text:
        `[channel] ${entry.fromTitle}: ${entry.text.slice(0, LEAD_WAKE_CHARS)}. ` +
        'If this needs a response, reply on the channel via team_say (item_id when it concerns an item) — ' +
        'your session transcript is invisible to the team.',
      comm: true,
    })
    // Lead được wake thật → đánh dấu để lượt comm của nó cũng mirror reply lên
    // kênh (reply của lead về một post member chính là đánh giá ê-kíp cần
    // thấy — không chỉ dựa vào model tự team_say).
    const tag = entry.itemId ?? entry.itemIds?.[0]
    markChannelWake(rootId, { rootId, ...(tag ? { itemId: tag } : {}) })
    receipt = `delivered to "${title}"`
  } catch (err) {
    log.warn('channel lead wake failed', {
      rootId,
      from: entry.from,
      err: err instanceof Error ? err.message : String(err),
    })
    receipt = `"${title}" could not be reached`
  }
  // Biên nhận chỉ ghi khi wake THẬT SỰ bắn (dedup/bận → không post — member
  // post rất thường xuyên, mỗi cái một vạch sẽ spam kênh). Tag item gốc hoặc
  // itemIds đầu — thẻ phụ cũng là "về item đó" nên biên nhận rơi đúng Discuss.
  const receiptTag = entry.itemId ?? entry.itemIds?.[0]
  try {
    await postChannelEntry(rootId, {
      from: null,
      fromTitle: 'system',
      kind: 'system',
      text: receipt,
      ...(receiptTag ? { itemId: receiptTag } : {}),
    })
  } catch (err) {
    log.warn('channel lead-wake receipt failed', {
      rootId,
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

// ─── API công khai ───────────────────────────────────────────────────────────

// Resolve @handles trong text của một USER post thành engineId trong roster của
// run (root + member). UI gửi mentions[] sẵn nhưng chỉ map được khi handle
// trùng title/slug(title) — handle dạng slug-tên-AGENT ("product-delivery-
// team-lead" trong khi title phiên lead chỉ là tên team), tên đặc ký
// ("QA/QC — Testing & Automation" → "@qa/qc-—-testing-&-automation") hay
// "@lead" rớt sạch → tin đi ra im lặng không ai bị gọi. Resolve lại ở đây để
// wake không lệ thuộc độ khớp của client; phạm vi chỉ trong roster của run
// nên handle lạ không đụng phiên ngoài. canon = bỏ dấu + gấp mọi cụm ký tự
// không phải chữ-số về '-' (giống boards/mentions.ts); token chứa ':'/'.'
// (ref/path) bị loại. Luật khớp một phiên: 'lead' ⇒ gốc · id phiên · canon
// title · verbatim "@Title" · agent.id nguyên văn/đuôi canon '-'+handle.
const CHANNEL_HANDLE_RE = /@([^\s@]{1,64})/gu
const stripMarks = (s: string): string =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '')
const canon = (s: string): string =>
  stripMarks(s.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function resolveChannelMentions(rootId: string, text: string): Promise<string[]> {
  const roster = (await listSessionSummaries()).filter(
    (s) => !s.archived && (s.id === rootId || s.teamRunId === rootId),
  )
  const handles = new Set(
    [...text.matchAll(CHANNEL_HANDLE_RE)]
      .map((m) => m[1] ?? '')
      .filter((raw) => /^[\p{L}\p{N}]/u.test(raw) && !raw.includes(':') && !raw.includes('.'))
      .map(canon)
      .filter((h) => h.length > 0),
  )
  if (handles.size === 0) return []
  const out: string[] = []
  for (const s of roster) {
    const title = s.title || ''
    const agentId = s.agent?.id
    const hit =
      [...handles].some(
        (h) =>
          h === s.id ||
          (h === 'lead' && s.id === rootId) ||
          (title.length > 0 && h === canon(title)) ||
          (!!agentId && (h === agentId || canon(agentId).endsWith(`-${h}`))),
      ) ||
      (title.length > 0 &&
        new RegExp(`@${escRe(title)}(?![\\w/-])`, 'i').test(text))
    if (hit) out.push(s.id)
  }
  return out
}

export async function postChannelEntry(
  rootId: string,
  input: {
    from: string | null
    fromTitle: string
    kind: TeamChannelKind
    text: string
    mentions?: string[]
    // Board item mà entry nói về (xem TeamChannelEntry.itemId) — tag tùy
    // chọn, sanitize lỏng: giá trị lạ bị bỏ thay vì làm hỏng một post.
    itemId?: string
  },
): Promise<TeamChannelEntry> {
  const text = redactString(input.text)
  if (!text.trim()) {
    throw new Error('channel entry text is empty; nothing was posted')
  }
  const mentions = sanitizeMentions(input.mentions, input.from)
  // USER post 'chat': resolve lại @handles trong text về roster của run —
  // mentions[] của client có thể rỗng dù text có tag (handle dạng slug-tên-
  // agent hoặc '@lead' — xem resolveChannelMentions). Hợp vào mentions trước
  // khi ghi entry để biên nhận/mirror/tag item đi theo đích ĐÚNG. Member post
  // giữ mentions tự truyền (agent đã chọn đích chủ đích qua team_say).
  if (input.from === null && input.kind === 'chat') {
    try {
      for (const id of await resolveChannelMentions(rootId, text)) {
        if (!mentions.includes(id)) mentions.push(id)
      }
    } catch (err) {
      log.warn('channel mention resolve failed', {
        rootId,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  const itemId = typeof input.itemId === 'string' && /^[\w-]{1,64}$/.test(input.itemId)
    ? input.itemId
    : undefined
  // Thẻ phụ: agent hay nhắc `bi-…` trong text mà quên truyền item_id — extract
  // mọi id được nhắc (trừ thẻ chính, dedup, trần 6) để Discuss của từng item
  // được nhắc đều nhận entry này. Không validate tồn tại — id không khớp item
  // nào đơn giản không hiện ở đâu.
  const storedText =
    text.length > MAX_CHANNEL_TEXT_LEN ? `${text.slice(0, MAX_CHANNEL_TEXT_LEN - 1)}…` : text
  const itemIds = [
    ...new Set(
      (storedText.match(/\bbi-[0-9a-f]{8,16}\b/g) ?? []).filter((id) => id !== itemId),
    ),
  ].slice(0, 6)
  // Member post không mang thẻ nào (text cũng không nhắc bi-…) → suy luận từ
  // board: item đang do ĐÚNG phiên đó đảm nhận — status trong vòng làm việc
  // (in_progress/in_review/changes/blocked) hoặc done (vừa xong vẫn là chủ đề
  // nóng); backlog/todo = chưa bắt tay, cancelled = bỏ. Trao đổi của member
  // mặc định là về việc mình đang cầm. LEAD (from === rootId) điều phối nhiều
  // item một lúc — suy ra một cái sẽ gán sai, nên lead untagged vẫn là trao
  // đổi chung; user (from=null) cũng bỏ qua. UI derive luật Y HỆT cho entry
  // cũ (stores/board.ts) — đổi ở đây thì đổi cả bên kia. Best-effort: board
  // đọc lỗi thì entry đi trần.
  if (!itemId && itemIds.length === 0 && input.from && input.from !== rootId) {
    try {
      const me = (await listSessionSummaries()).find((s) => s.id === input.from)
      if (me?.projectId) {
        const OWN = new Set(['in_progress', 'in_review', 'changes', 'blocked', 'done'])
        const busy = (await listBoardItems(me.projectId)).filter(
          (i) => i.assigneeSessionId === input.from && OWN.has(i.status),
        )
        itemIds.push(...busy.slice(0, 3).map((i) => i.id))
      }
    } catch (err) {
      log.warn('channel item inference failed', {
        rootId,
        from: input.from,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  const entry: TeamChannelEntry = {
    id: mintEntryId(),
    at: new Date().toISOString(),
    from: input.from,
    fromTitle: oneLineLabel(redactString(input.fromTitle), MAX_TITLE_LEN) || 'unknown',
    kind: input.kind,
    text: storedText,
    ...(mentions.length > 0 ? { mentions } : {}),
    ...(itemId ? { itemId } : {}),
    ...(itemIds.length > 0 ? { itemIds } : {}),
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

  // Re-trigger: post của MEMBER (from ≠ null, ≠ gốc) với kind chat/status wake
  // theo luật mention-or-lead. Post của NGƯỜI DÙNG (from === null) chỉ wake
  // khi kind 'chat' KÈM mentions — "@Dev" là chủ đích lôi đúng người đó vào;
  // broadcast không mention và 'note' (ghi chú) vẫn im lặng. eval = nhật định
  // của lead, system = thông báo máy — không loại nào tốn lượt wake của ai.
  const memberPost =
    input.from !== null &&
    input.from !== rootId &&
    (input.kind === 'chat' || input.kind === 'status')
  const userMentionPost =
    input.from === null && input.kind === 'chat' && (entry.mentions?.length ?? 0) > 0
  if (!memberPost && !userMentionPost) return entry

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
