// Disk accounting for ~/.awog/sessions, so the Storage screen can answer the two
// questions a growing session store raises: how heavy is it, and what can go.
//
// Measured on a real install before writing this (820 entries, 11 GB):
//   snapshots/      7.7 GB   70%   ← Rewind file-blobs (ADR 0038)
//   stray files     2.8 GB   26%   ← 198 *.bak / *.bloated-* left by an old fix
//   session.jsonl   654 MB    6%   ← the conversations themselves
//   attachments/    125 MB    1%
//
// The shape of that is what makes the cleanup actions worth having: snapshots
// prune WITHIN a session (20 newest kept, blobs GC'd) but never ACROSS sessions,
// so a finished session from three months ago still holds its twenty full
// workspace snapshots forever. Dropping those keeps every word of the
// conversation and reclaims the bulk.
import { readdir, stat, rm } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { listSessionSummaries } from '../sessions/store.js'
import { log } from '../util/logger.js'

export interface SessionUsage {
  id: string
  title: string
  projectId: string | null
  updatedAt: string | null
  transcriptBytes: number
  snapshotBytes: number
  attachmentBytes: number
  otherBytes: number
  totalBytes: number
}

export interface ProjectUsage {
  projectId: string | null
  count: number
  transcriptBytes: number
  snapshotBytes: number
  attachmentBytes: number
  otherBytes: number
  totalBytes: number
}

export interface StorageScan {
  totalBytes: number
  transcriptBytes: number
  snapshotBytes: number
  attachmentBytes: number
  otherBytes: number
  /** Files sitting directly under sessions/ that are not a session directory. */
  orphanBytes: number
  orphanCount: number
  orphanNames: string[]
  projects: ProjectUsage[]
  sessions: SessionUsage[]
}

async function dirBytes(dir: string): Promise<number> {
  let total = 0
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const p = join(dir, e.name)
    try {
      if (e.isDirectory()) total += await dirBytes(p)
      else if (e.isFile()) total += (await stat(p)).size
    } catch {
      // A file vanishing mid-scan is normal — a live session is writing.
    }
  }
  return total
}

async function fileBytes(p: string): Promise<number> {
  try {
    return (await stat(p)).size
  } catch {
    return 0
  }
}

export function sessionsRoot(): string {
  return join(awogHome(), 'sessions')
}

export async function scanStorage(): Promise<StorageScan> {
  const root = sessionsRoot()
  const summaries = await listSessionSummaries()
  const metaById = new Map(summaries.map((s) => [s.id, s]))

  let entries: Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    entries = []
  }

  const sessions: SessionUsage[] = []
  let orphanBytes = 0
  const orphanNames: string[] = []

  for (const e of entries) {
    const p = join(root, e.name)
    if (!e.isDirectory()) {
      // `ses-….jsonl.bak`, `…bloated-20260619.bak`, `.DS_Store` — debris from
      // past migrations. Not a session, so nothing in the app can reach it.
      orphanBytes += await fileBytes(p)
      orphanNames.push(e.name)
      continue
    }
    const [transcriptBytes, snapshotBytes, attachmentBytes, allBytes] = await Promise.all([
      fileBytes(join(p, 'session.jsonl')),
      dirBytes(join(p, 'snapshots')),
      dirBytes(join(p, 'attachments')),
      dirBytes(p),
    ])
    const meta = metaById.get(e.name)
    sessions.push({
      id: e.name,
      title: meta?.title ?? e.name,
      projectId: meta?.projectId ?? null,
      updatedAt: meta?.updatedAt ?? null,
      transcriptBytes,
      snapshotBytes,
      attachmentBytes,
      otherBytes: Math.max(0, allBytes - transcriptBytes - snapshotBytes - attachmentBytes),
      totalBytes: allBytes,
    })
  }

  sessions.sort((a, b) => b.totalBytes - a.totalBytes)

  const byProject = new Map<string, ProjectUsage>()
  for (const s of sessions) {
    const key = s.projectId ?? ''
    let p = byProject.get(key)
    if (!p) {
      p = {
        projectId: s.projectId,
        count: 0,
        transcriptBytes: 0,
        snapshotBytes: 0,
        attachmentBytes: 0,
        otherBytes: 0,
        totalBytes: 0,
      }
      byProject.set(key, p)
    }
    p.count++
    p.transcriptBytes += s.transcriptBytes
    p.snapshotBytes += s.snapshotBytes
    p.attachmentBytes += s.attachmentBytes
    p.otherBytes += s.otherBytes
    p.totalBytes += s.totalBytes
  }

  const sum = (pick: (s: SessionUsage) => number) => sessions.reduce((a, s) => a + pick(s), 0)
  return {
    totalBytes: sum((s) => s.totalBytes) + orphanBytes,
    transcriptBytes: sum((s) => s.transcriptBytes),
    snapshotBytes: sum((s) => s.snapshotBytes),
    attachmentBytes: sum((s) => s.attachmentBytes),
    otherBytes: sum((s) => s.otherBytes),
    orphanBytes,
    orphanCount: orphanNames.length,
    orphanNames: orphanNames.slice(0, 50),
    projects: [...byProject.values()].sort((a, b) => b.totalBytes - a.totalBytes),
    sessions,
  }
}

export interface PruneResult {
  freedBytes: number
  /** Sessions pruned, or files deleted — whichever the caller asked for. Not
      `sessionCount`: deleteOrphans returns FILES, and the name leaked into the
      UI as "199 sessions freed" when 199 loose files had been deleted. */
  count: number
}

/**
 * Drop the Rewind snapshot tree of sessions untouched for `olderThanDays`.
 * The conversation is never touched — only the workspace file-blobs that let
 * Rewind restore files, which is only useful in a session still being worked in.
 * `skipIds` keeps live sessions out of it.
 */
export async function pruneSnapshots(opts: {
  olderThanDays: number
  projectId?: string | null
  skipIds?: Set<string>
}): Promise<PruneResult> {
  const scan = await scanStorage()
  const cutoff = Date.now() - opts.olderThanDays * 86_400_000
  let freedBytes = 0
  let count = 0

  for (const s of scan.sessions) {
    if (s.snapshotBytes === 0) continue
    if (opts.skipIds?.has(s.id)) continue
    if (opts.projectId !== undefined && s.projectId !== opts.projectId) continue
    // No updatedAt = no header the app could read. Treat as stale rather than
    // immortal, or unreadable sessions become the one thing never cleanable.
    const touched = s.updatedAt ? Date.parse(s.updatedAt) : 0
    if (Number.isFinite(touched) && touched > cutoff) continue
    const dir = join(sessionsRoot(), sanitizeChild(s.id), 'snapshots')
    try {
      await rm(dir, { recursive: true, force: true })
      freedBytes += s.snapshotBytes
      count++
    } catch (err) {
      log.warn('storage: could not remove snapshots', { id: s.id, err: String(err) })
    }
  }
  return { freedBytes, count }
}

/** Delete the non-session files sitting directly under sessions/. */
export async function deleteOrphans(): Promise<PruneResult> {
  const root = sessionsRoot()
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return { freedBytes: 0, count: 0 }
  }
  let freedBytes = 0
  let count = 0
  for (const e of entries) {
    if (e.isDirectory()) continue
    const p = join(root, sanitizeChild(e.name))
    const size = await fileBytes(p)
    try {
      await rm(p, { force: true })
      freedBytes += size
      count++
    } catch (err) {
      log.warn('storage: could not remove orphan', { name: e.name, err: String(err) })
    }
  }
  return { freedBytes, count }
}
