// boards.recap — one-shot LLM tóm lại MỘT issue cho người dùng quay lại việc sau
// nhiều ngày (docs/features/session-issue-tracking.md §Recap): đã làm gì · còn dở
// gì · đang bị chặn bởi gì · bước tiếp theo.
//
// Nguồn: mô tả + comment của issue, checklist + đuôi transcript của các phiên đã
// làm nó (phiên có `issueId` trỏ về item, cộng assignee hiện tại). Kết quả GHI
// vào `item.recap` (ghi đè), không đăng comment — thread giữ cho trao đổi thật.
//
// Model/account do UI truyền (`settings`) — cùng cấu hình "AI authoring" với
// boards.draft. Cheap model trước, rồi model người dùng chọn.

import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { log } from '../util/logger.js'
import { completeWithUsage } from '../runtime/complete.js'
import { getBoardItem, setBoardItemRecap } from '../boards/store.js'
import { issueExecutorSessions } from '../boards/session-issue.js'
import { MESSAGE_ID_RE } from '../sessions/ids.js'
import type { BoardItem, ProviderName, Session } from '../types/shared.js'

const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]*$/

const Params = z.object({
  projectId: z.string().min(3).max(64).regex(PROJECT_ID_RE),
  itemId: z.string().min(1).max(64).regex(MESSAGE_ID_RE),
  settings: z.object({
    provider: z.enum(['anthropic', 'openai', 'google']),
    modelId: z.string().min(1).max(200),
    accountId: z.string().max(64).optional(),
  }),
})

const CHEAP_MODEL: Partial<Record<ProviderName, string>> = {
  anthropic: 'claude-haiku-4-5',
}

// Ngân sách đầu vào (ký tự ≈ token×4): đủ cho vài phiên dài mà prefill không nặng.
const MAX_SESSIONS = 4
const MAX_PER_SESSION = 8000
const MAX_COMMENTS = 30
const MAX_COMMENT = 600
const MAX_MESSAGE = 2000
const MAX_TIMELINE = 28_000

const SYS = `You write a short RECAP of one work item (an issue on the user's project board) so the user can pick it back up after days away without re-reading everything.

Write in the SAME language as the issue and the conversations (Vietnamese stays Vietnamese).

Output markdown with exactly these four sections, each a few tight bullets (omit a bullet rather than pad it; write "—" under a section with nothing to say). Use ONE language for the headings — the language you write in:
- Vietnamese: ## Đã làm · ## Đang dở · ## Bị chặn bởi · ## Bước tiếp theo
- English: ## Done · ## In progress · ## Blocked by · ## Next steps
Never combine both languages in a heading (no "Đã làm / Done").

How to read the SOURCES:
- They are ONE timeline, oldest first, every entry stamped with its time. Later entries SUPERSEDE earlier ones: if the conversation says a reply was only drafted and a later entry says it was sent, it was sent.
- "User note" entries were written by the user on the board. They are AUTHORITATIVE about things that happened outside the conversation (messages the user sent themselves, calls, decisions) — never contradict them with older conversation text.
- CURRENT STATUS is the user's latest decision about the item: pending = paused / waiting, blocked = stuck on something external, in_review = finished and awaiting review, done = closed. The recap must be consistent with it.

Rules:
- Concrete over vague: name files, commands, decisions, PRs, people — whatever the sources actually say.
- Never invent progress. If the sources do not show something was finished, it is not done.
- "Bị chặn bởi" lists only real external blockers (waiting on a person, access, a decision). Empty is fine.
- No preamble, no closing remarks, no code fence around the whole answer.`

const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s)

// Một dòng thời gian DUY NHẤT cho mọi nguồn (comment của board + đuôi transcript các
// phiên), sắp theo giờ. Trước đây hai loại nằm ở hai khối tách rời — comment trước,
// transcript sau — nên model coi tin cuối của transcript là "mới nhất" dù ghi chú của
// người dùng tới SAU (lỗi thật 2026-10-16: "đã trả lời KH" bị recap thành "chưa post").
type Entry = { at: string; who: string; text: string }

function commentEntries(item: BoardItem): Entry[] {
  return item.comments.slice(-MAX_COMMENTS).map((c) => ({
    at: c.at,
    who:
      c.from === null ? (c.fromTitle === 'system' ? 'System' : 'User note') : `Agent comment (${c.fromTitle})`,
    text: clip(c.text, MAX_COMMENT),
  }))
}

// Đuôi transcript của một phiên — tin MỚI NHẤT là thứ recap cần (mục tiêu ban đầu đã
// nằm trong mô tả issue), lấy ngược từ cuối tới hết ngân sách của phiên.
function sessionEntries(session: Session): Entry[] {
  const out: Entry[] = []
  let budget = MAX_PER_SESSION
  for (let i = session.messages.length - 1; i >= 0 && budget > 0; i--) {
    const m = session.messages[i]
    const text = m?.text?.trim()
    if (!m || !text) continue
    const clipped = clip(text, Math.min(MAX_MESSAGE, budget))
    budget -= clipped.length
    out.push({ at: m.at, who: m.role === 'user' ? 'User (chat)' : 'Assistant (chat)', text: clipped })
  }
  return out
}

function checklist(session: Session): string {
  if (!session.todos?.length) return ''
  const mark = { pending: ' ', in_progress: '~', completed: 'x' } as const
  return session.todos.map((t) => `- [${mark[t.status]}] ${t.content}`).join('\n')
}

const stamp = (iso: string): string => iso.slice(0, 16).replace('T', ' ')

// Export cho test (methods/__tests__/boards-recap.test.ts).
export function buildRecapPrompt(item: BoardItem, sessions: Session[]): string {
  const head: string[] = [`ISSUE ${item.id} · "${item.title}" · ${item.type ?? 'task'}`]
  const lastStatus = [...item.comments].reverse().find((c) => c.fromTitle === 'system' && c.text.includes('→'))
  head.push(`CURRENT STATUS: ${item.status}${lastStatus ? ` (since ${stamp(lastStatus.at)})` : ''}`)
  const lastNote = [...item.comments].reverse().find((c) => c.from === null && c.fromTitle !== 'system')
  if (lastNote) head.push(`LATEST USER NOTE (${stamp(lastNote.at)}): ${clip(lastNote.text, MAX_COMMENT)}`)
  if (item.desc?.trim()) head.push(`DESCRIPTION:\n${item.desc.trim()}`)
  for (const s of sessions) {
    const todo = checklist(s)
    if (todo) head.push(`CHECKLIST of session "${s.title}":\n${todo}`)
  }

  // Dòng thời gian: sắp theo giờ, vượt ngân sách thì bỏ phần CŨ NHẤT.
  const entries = [...commentEntries(item), ...sessions.flatMap(sessionEntries)].sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : 0,
  )
  const lines: string[] = []
  let used = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!
    const line = `[${stamp(e.at)}] ${e.who}: ${e.text}`
    if (used + line.length > MAX_TIMELINE) {
      lines.push('[…older entries omitted…]')
      break
    }
    used += line.length
    lines.push(line)
  }
  lines.reverse()

  // Bọc nguồn trong marker để model coi là tư liệu để tóm, không phải lệnh.
  return (
    'Write the recap of the issue described between the markers.\n\n<<<SOURCES\n' +
    `${head.join('\n\n')}\n\n---\n\nTIMELINE (oldest first; later entries supersede earlier ones):\n${lines.join('\n\n')}` +
    '\nSOURCES>>>'
  )
}

register('boards.recap', async (raw) => {
  const params = Params.parse(raw)
  const item = await getBoardItem(params.projectId, params.itemId)
  if (!item) throw new RpcError(-32004, 'Board item not found')

  const sessions = await issueExecutorSessions(item, MAX_SESSIONS)
  const prompt = buildRecapPrompt(item, sessions)

  const cheap = CHEAP_MODEL[params.settings.provider]
  const candidates =
    cheap && cheap !== params.settings.modelId ? [cheap, params.settings.modelId] : [params.settings.modelId]
  let lastErr = ''
  for (const modelId of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop -- intentional sequential fallback
      const res = await completeWithUsage({
        provider: params.settings.provider,
        ...(params.settings.accountId ? { accountId: params.settings.accountId } : {}),
        modelId,
        systemPrompt: SYS,
        prompt,
      })
      const text = res.text.trim()
      if (!text) {
        lastErr = 'empty response'
        continue
      }
      // eslint-disable-next-line no-await-in-loop -- chỉ chạy một lần, ngay trước return
      const saved = await setBoardItemRecap(params.projectId, item.id, {
        text,
        at: new Date().toISOString(),
        modelUsed: res.modelUsed || modelId,
        sessionIds: sessions.map((s) => s.id),
      })
      if (!saved) throw new RpcError(-32004, 'Board item was deleted while the recap was being written')
      log.info('boards.recap', { itemId: item.id, model: modelId, sessions: sessions.length, inChars: prompt.length })
      return { recap: saved.recap }
    } catch (err) {
      if (err instanceof RpcError) throw err
      lastErr = err instanceof Error ? err.message : String(err)
      log.warn('boards.recap attempt failed', { model: modelId, err: lastErr })
    }
  }
  // Lộ nguyên nhân gốc (credential hết hạn, quota…) — cùng lý do boards.draft.
  throw new RpcError(-32021, `boards.recap: model produced no recap${lastErr ? ` — ${lastErr}` : ''}`)
})
