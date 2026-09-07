// Full-text search across every session's message transcript.
//
// Local-first: folds each session JSONL (via listFullSessions) and scans message
// text for a case-insensitive substring match, returning one result per matched
// message with a snippet window. Backs the UI's Cmd+K search palette. Sessions
// come back newest-first (listFullSessions sorts by updatedAt), so results are
// already in recency order. This is the one path that still needs full
// transcripts (ADR 0048); it runs on-demand when the user searches, not at
// startup, so folding all files here is acceptable.
//
// PHIÊN ĐÃ LƯU TRỮ BỊ LOẠI MẶC ĐỊNH. Lưu trữ nghĩa là "giấu phiên này đi mà không xoá"
// (docs/features/session-lifecycle-ops.md), và `sessions.list` đã ẩn nó khỏi danh sách
// — nếu tìm kiếm vẫn lôi ra thì thao tác dọn dẹp của người dùng chỉ có tác dụng một
// nửa, đúng chỗ dễ gây bực nhất: một phiên vừa cất đi lại chen lên đầu kết quả vì nó
// mới nhất. Vì thế mặc định theo `sessions.list`, và `includeArchived: true` mở lại.
// Để không rơi vào bẫy ngược lại ("tìm mãi không thấy vì quên là đã lưu trữ"), câu trả
// lời KHÔNG im lặng: `archivedHidden` đếm số phiên đã lưu trữ có khớp nhưng bị giấu,
// đủ để UI nói "còn N phiên trong kho lưu trữ khớp" thay vì để người dùng đoán.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listFullSessions } from '../sessions/store.js'

const Params = z.object({
  query: z.string().min(2).max(200),
  limit: z.number().int().min(1).max(200).optional(),
  // Vắng ⇒ false: bỏ qua phiên đã lưu trữ (xem ghi chú đầu file).
  includeArchived: z.boolean().optional(),
})

const SNIPPET_BEFORE = 40
const SNIPPET_AFTER = 80

function makeSnippet(text: string, matchIdx: number, qlen: number): string {
  const start = Math.max(0, matchIdx - SNIPPET_BEFORE)
  const end = Math.min(text.length, matchIdx + qlen + SNIPPET_AFTER)
  const core = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${core}${end < text.length ? '…' : ''}`
}

export interface SessionSearchResult {
  sessionId: string
  sessionTitle: string
  projectId: string | null
  messageId: string
  role: 'user' | 'agent' | 'system'
  at: string
  snippet: string
}

register('sessions.search', async (raw) => {
  const params = Params.parse(raw)
  const q = params.query.trim()
  const needle = q.toLowerCase()
  const limit = params.limit ?? 50

  const includeArchived = params.includeArchived === true

  const sessions = await listFullSessions()
  const results: SessionSearchResult[] = []
  // Số PHIÊN đã lưu trữ có ít nhất một message khớp (không phải số message) — đây là
  // thứ UI cần để mời người dùng mở rộng phạm vi tìm. Là CẬN DƯỚI khi kết quả đã đầy
  // (`truncated`): lúc đó vòng lặp thoát sớm nên phần đuôi danh sách không được quét.
  let archivedHidden = 0

  outer: for (const session of sessions) {
    if (session.archived && !includeArchived) {
      // Vẫn quét, nhưng dừng ngay ở message khớp đầu tiên: chỉ cần biết phiên này có
      // khớp hay không. Transcript đã nằm sẵn trong RAM nên phần thêm là không đáng kể.
      if (session.messages.some((m) => (m.text ?? '').toLowerCase().includes(needle))) {
        archivedHidden += 1
      }
      continue
    }
    for (const msg of session.messages) {
      const text = msg.text ?? ''
      if (!text) continue
      const idx = text.toLowerCase().indexOf(needle)
      if (idx < 0) continue
      results.push({
        sessionId: session.id,
        sessionTitle: session.title,
        projectId: session.projectId,
        messageId: msg.id,
        role: msg.role,
        at: msg.at,
        snippet: makeSnippet(text, idx, needle.length),
      })
      if (results.length >= limit) break outer
    }
  }

  return { results, truncated: results.length >= limit, archivedHidden }
})
