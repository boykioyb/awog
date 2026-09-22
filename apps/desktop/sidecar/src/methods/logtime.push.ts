import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadMonth, loadSettings, markPushed, monthOf } from '../logtime/store.js'
import { createWorklog } from '../logtime/mcp.js'
import { log } from '../util/logger.js'
import type { LogtimeEntry, LogtimePushResult } from '../types/shared.js'

// Đẩy các dòng NHÁP của một ngày lên PMS (ADR 0091 D-5).
//
// Gọi TUẦN TỰ chứ không Promise.all: lỗi giữa chừng phải quy được về đúng dòng
// nào, và không dội N request vào PMS một lúc. Dòng nào ghi được thì giữ
// `worklogId` ngay — chạy lại lần sau chỉ gửi phần còn thiếu chứ không nhân đôi.
//
// Cổng xác nhận nằm ở UI (hộp thoại 2 bước). Ở đây chỉ cưỡng chế phần máy kiểm
// được: dòng phải đang là nháp, dự án phải nối với một nguồn, nguồn phải ghi được.

const Params = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Không truyền = đẩy mọi dòng nháp của ngày.
  entryIds: z.array(z.string()).max(40).optional(),
})

function issueUrl(repo: string | undefined, issue: number | undefined): string | null {
  if (!repo || !issue) return null
  // Chỉ nhận link ISSUE — link PR làm server PMS trả `createError is not defined`
  // (đo 2026-09-18). Xem docs/features/logtime.md.
  return `https://github.com/${repo}/issues/${issue}`
}

register('logtime.push', async (raw) => {
  const { date, entryIds } = Params.parse(raw)
  const settings = await loadSettings()
  const doc = await loadMonth(monthOf(date))
  const day = doc.days[date]
  if (!day || day.entries.length === 0) throw new RpcError(-32602, `No entries for ${date}`)

  const wanted = entryIds ? new Set(entryIds) : null
  const targets: LogtimeEntry[] = day.entries.filter(
    (e) => e.status === 'draft' && (!wanted || wanted.has(e.id)),
  )
  const results: LogtimePushResult[] = []
  const pushed: { entryId: string; worklogId: string }[] = []

  for (const entry of targets) {
    const link = settings.links.find((l) => l.projectKey === entry.projectKey)
    if (!link?.pmsProjectId) {
      results.push({ entryId: entry.id, ok: false, error: 'project is not linked to a PMS project' })
      continue
    }
    const url = issueUrl(link.githubRepo, entry.task?.issue)
    try {
      // eslint-disable-next-line no-await-in-loop
      const created = await createWorklog(link.sourceId, {
        projectId: link.pmsProjectId,
        date,
        hours: entry.hours,
        note: entry.note,
        ...(entry.task?.id ? { taskIds: [entry.task.id] } : {}),
        ...(url ? { githubIssueUrls: [url] } : {}),
      })
      results.push({ entryId: entry.id, ok: true, worklogId: created.id })
      pushed.push({ entryId: entry.id, worklogId: created.id })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn('[logtime] push failed', { entryId: entry.id, err: message })
      results.push({ entryId: entry.id, ok: false, error: message.slice(0, 400) })
    }
  }

  // Ghi lại phần đã thành công dù có dòng lỗi — không có trạng thái "nửa vời".
  const saved = pushed.length > 0 ? await markPushed(date, pushed) : { date, entries: day.entries }
  return { date, results, entries: saved.entries }
})
