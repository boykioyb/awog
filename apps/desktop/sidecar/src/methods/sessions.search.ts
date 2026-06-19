// Full-text search across every session's message transcript.
//
// Local-first: folds each session JSONL (via listFullSessions) and scans message
// text for a case-insensitive substring match, returning one result per matched
// message with a snippet window. Backs the UI's Cmd+K search palette. Sessions
// come back newest-first (listFullSessions sorts by updatedAt), so results are
// already in recency order. This is the one path that still needs full
// transcripts (ADR 0048); it runs on-demand when the user searches, not at
// startup, so folding all files here is acceptable.

import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { listFullSessions } from '../sessions/store.js'

const Params = z.object({
  query: z.string().min(2).max(200),
  limit: z.number().int().min(1).max(200).optional(),
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

  const sessions = await listFullSessions()
  const results: SessionSearchResult[] = []

  outer: for (const session of sessions) {
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

  return { results, truncated: results.length >= limit }
})
