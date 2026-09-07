// Lưu bộ ca kiểm + lịch sử các lần chạy eval của MỘT skill:
//   ~/.awog/skill-evals/<source>__<projectId>__<id>.json
//
// Không thêm database (quy ước MVP): một file JSON một skill, ghi nguyên tử qua
// `.tmp` + rename, đọc thì validate bằng zod rồi mới trả ra (file trên đĩa là
// L1). Cùng khuôn với schedules/store.ts.
//
// Kết quả eval nằm ở `.awog` chứ không phải `.claude`: nó là dữ liệu AWOG-only,
// không phải config skill dùng chung với Claude Code CLI (ADR 0070).

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { SkillEvalCaseSchema, SkillEvalRunSchema, evalKey, MAX_CASES_PER_RUN } from './eval.js'
import type { SkillEvalCase, SkillEvalRun } from './eval.js'
import type { SkillSource } from '../types/shared.js'

const EVALS_DIR = sanitizeChild('skill-evals')

// Giữ lịch sử để so lần sau; 10 lần chạy là đủ để thấy xu hướng mà file không phình.
export const MAX_EVAL_RUNS = 10

export const SkillEvalRecordSchema = z.object({
  version: z.literal(1),
  skillId: z.string().min(1).max(64),
  source: z.enum(['global', 'project']),
  projectId: z.string().max(200).optional(),
  cases: z.array(SkillEvalCaseSchema).max(MAX_CASES_PER_RUN),
  // Mới nhất đứng đầu.
  runs: z.array(SkillEvalRunSchema).max(MAX_EVAL_RUNS),
})
export type SkillEvalRecord = z.infer<typeof SkillEvalRecordSchema>

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

function recordFile(id: string, source: SkillSource, projectId?: string): string {
  return join(awogHome(), EVALS_DIR, `${sanitizeChild(evalKey(id, source, projectId))}.json`)
}

export async function loadEvalRecord(
  id: string,
  source: SkillSource,
  projectId?: string,
): Promise<SkillEvalRecord | null> {
  const file = recordFile(id, source, projectId)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
  try {
    const res = SkillEvalRecordSchema.safeParse(JSON.parse(raw) as unknown)
    if (res.success) return res.data
    // File hỏng (sửa tay, phiên bản cũ) KHÔNG được làm chết trang: bỏ qua kèm log,
    // lần chạy kế tiếp sẽ ghi đè bằng bản hợp lệ.
    log.warn('skills.eval: invalid record file', {
      file,
      issues: res.error.issues.map((i) => `${i.path.join('.')}:${i.message}`),
    })
    return null
  } catch (err) {
    log.warn('skills.eval: failed to parse record', {
      file,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

export async function saveEvalRun(
  ref: { id: string; source: SkillSource; projectId?: string | undefined },
  cases: SkillEvalCase[],
  run: SkillEvalRun,
): Promise<SkillEvalRecord> {
  const previous = await loadEvalRecord(ref.id, ref.source, ref.projectId)
  const record: SkillEvalRecord = {
    version: 1,
    skillId: ref.id,
    source: ref.source,
    cases,
    runs: [run, ...(previous?.runs ?? [])].slice(0, MAX_EVAL_RUNS),
  }
  if (ref.projectId) record.projectId = ref.projectId

  const file = recordFile(ref.id, ref.source, ref.projectId)
  await mkdir(join(awogHome(), EVALS_DIR), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(record, null, 2), 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
  return record
}
