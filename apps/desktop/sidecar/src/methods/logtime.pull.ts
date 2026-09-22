import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { register } from '../transport/rpc.js'
import { loadMonth, loadSettings, monthOf, saveDay } from '../logtime/store.js'
import { listWorklogs, type PmsWorklogRow } from '../logtime/mcp.js'
import { log } from '../util/logger.js'
import type { LogtimeEntry } from '../types/shared.js'

// Kéo worklog đã có trên PMS về (ADR 0091 D-3). Hành động CÓ CHỦ Ý, không chạy
// ngầm: nháp đang gõ dở bị PMS ghi đè là mất việc.
//
// Luật gộp: giữ nguyên mọi dòng `draft` của máy, thay toàn bộ phần `posted`/
// `locked` bằng những gì PMS nói. PMS là nguồn sự thật cho phần đã ghi.

const Params = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

register('logtime.pull', async (raw) => {
  const { from, to } = Params.parse(raw)
  const settings = await loadSettings()

  // (sourceId, pmsProjectId) → projectKey. Một nguồn được hỏi đúng một lần.
  const keyOf = new Map<string, string>()
  const sourceIds = new Set<string>()
  for (const link of settings.links) {
    if (!link.pmsProjectId) continue
    keyOf.set(`${link.sourceId}|${link.pmsProjectId}`, link.projectKey)
    sourceIds.add(link.sourceId)
  }

  const byDate = new Map<string, LogtimeEntry[]>()
  const errors: { sourceId: string; error: string }[] = []

  for (const sourceId of sourceIds) {
    let rows: PmsWorklogRow[] = []
    try {
      // eslint-disable-next-line no-await-in-loop
      rows = await listWorklogs(sourceId, from, to)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('[logtime] pull failed', { sourceId, err: message })
      errors.push({ sourceId, error: message.slice(0, 400) })
      continue
    }
    for (const row of rows) {
      const projectKey = keyOf.get(`${sourceId}|${row.projectId}`)
      // Dự án chưa nối → bỏ qua: hiện nó ra dưới một khoá bịa còn khó hiểu hơn.
      if (!projectKey) continue
      const task = row.tasks[0]
      const entry: LogtimeEntry = {
        id: `lt_${randomUUID()}`,
        projectKey,
        note: row.note,
        hours: row.hours,
        ...(task ? { task } : {}),
        status: row.lockedAt ? 'locked' : 'posted',
        worklogId: row.id,
        ...(row.lockedAt ? { lockedAt: row.lockedAt } : {}),
        updatedAt: Date.now(),
      }
      const list = byDate.get(row.date)
      if (list) list.push(entry)
      else byDate.set(row.date, [entry])
    }
  }

  // Ghi từng ngày: nháp của máy đứng trước, phần PMS nối sau.
  const days: { date: string; entries: LogtimeEntry[] }[] = []
  for (const [date, fromPms] of byDate) {
    // eslint-disable-next-line no-await-in-loop
    const doc = await loadMonth(monthOf(date))
    const drafts = (doc.days[date]?.entries ?? []).filter((e) => e.status === 'draft')
    // eslint-disable-next-line no-await-in-loop
    const saved = await saveDay(date, [...drafts, ...fromPms])
    days.push(saved)
  }

  return { days, errors, pulled: days.reduce((n, d) => n + d.entries.length, 0) }
})
