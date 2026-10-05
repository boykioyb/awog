// Team (squad) spec persistence — hai tầng khuôn workflows/agents
// (docs/features/session-teams.md §9):
//   global  → ~/.awog/teams/<id>.json            (đội dùng chung mọi project)
//   project → {project.path}/.awog/teams/<id>.json (đi theo repo, git-trackable)
//
// source + projectId suy ra từ vị trí file, KHÔNG ghi vào JSON — spec của
// project-tier commit lên repo được mà không ghi cứng project id của máy này.
// Ghi = atomic .tmp + rename; xoá = unlink. Team chỉ là SPEC — instance sống
// là cây phiên thường do `teams.run` materialize mỗi lần giao việc.

import { mkdir, readdir, readFile, writeFile, chmod, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { awogHome, sanitizeChild } from '../util/path.js'
import { log } from '../util/logger.js'
import { RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'
import type { SessionAgentRef, TeamSpec } from '../types/shared.js'

const TEAMS_DIR_NAME = sanitizeChild('teams')

// Trần member một team spec — enforce ở CẢ teams.upsert (ghi) lẫn đường
// materialize (teams.run preflight + materializeMember spawn lười). Lớn hơn
// MAX_CHILDREN của run-time fanout vì spec là danh sách người dùng tự duyệt,
// không phải phiên model tự đẻ.
export const MAX_TEAM_MEMBERS = 24

function globalTeamsDir(): string {
  return join(awogHome(), TEAMS_DIR_NAME)
}

function projectTeamsDir(projectPath: string): string {
  return join(projectPath, '.awog', TEAMS_DIR_NAME)
}

async function resolveTeamsDir(
  source: 'global' | 'project',
  projectId: string | undefined,
): Promise<string> {
  if (source === 'global') return globalTeamsDir()
  if (!projectId) throw new RpcError(-32602, 'Project team requires a projectId')
  const project = await loadProject(projectId)
  if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
  return projectTeamsDir(project.path)
}

function teamFile(dir: string, id: string): string {
  return join(dir, `${sanitizeChild(id)}.json`)
}

interface FsError extends Error {
  code?: string
}

function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

// Agent ref chỉ là con trỏ {id, source?, projectId?} — validate tối thiểu cấu
// trúc; agent lạ/đã xoá vẫn lưu được (resolve lúc chạy sẽ degrade nhẹ nhàng,
// đúng khuôn loadAgentFlexibly của spawn).
function cleanAgentRef(raw: unknown): SessionAgentRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id.trim()) return undefined
  const ref: SessionAgentRef = { id: r.id.trim() }
  if (r.source === 'global' || r.source === 'project') ref.source = r.source
  if (typeof r.projectId === 'string' && r.projectId) ref.projectId = r.projectId
  return ref
}

function parse(
  raw: string,
  file: string,
  source: 'global' | 'project',
  projectId: string | undefined,
): TeamSpec | null {
  try {
    const obj = JSON.parse(raw) as unknown
    if (!obj || typeof obj !== 'object') return null
    const t = obj as Record<string, unknown>
    if (typeof t.id !== 'string' || typeof t.name !== 'string') return null
    const members = Array.isArray(t.members) ? t.members : []
    const team: TeamSpec = {
      id: t.id,
      name: t.name,
      members: members
        .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
        .map((m) => ({
          title: typeof m.title === 'string' ? m.title : '',
          ...(cleanAgentRef(m.agent) ? { agent: cleanAgentRef(m.agent)! } : {}),
        })),
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : new Date().toISOString(),
      updatedAt: typeof t.updatedAt === 'string' ? t.updatedAt : new Date().toISOString(),
      source,
    }
    if (typeof t.desc === 'string' && t.desc) team.desc = t.desc
    // instructions: chỉ dẫn cấp đội gửi lead mỗi run — bỏ sót ở đây từng làm
    // spec ghi rồi mà list/run đọc về luôn trống.
    if (typeof t.instructions === 'string' && t.instructions.trim())
      team.instructions = t.instructions
    const lead = cleanAgentRef(t.lead)
    if (lead) team.lead = lead
    if (projectId) team.projectId = projectId
    return team
  } catch (err) {
    log.warn('teams: failed to parse', {
      file,
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

async function listFromDir(
  dir: string,
  source: 'global' | 'project',
  projectId: string | undefined,
): Promise<TeamSpec[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    if (!isMissing(err)) {
      log.warn('teams: listFromDir failed', {
        dir,
        err: err instanceof Error ? err.message : String(err),
      })
    }
    return []
  }
  const teams: TeamSpec[] = []
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    const file = join(dir, name)
    try {
      // eslint-disable-next-line no-await-in-loop
      const raw = await readFile(file, 'utf8')
      const team = parse(raw, file, source, projectId)
      if (team) teams.push(team)
    } catch (err) {
      log.warn('teams: failed to read file', {
        file,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return teams
}

async function listProjectTeams(projectId: string): Promise<TeamSpec[]> {
  const project = await loadProject(projectId)
  if (!project) return []
  return listFromDir(projectTeamsDir(project.path), 'project', projectId)
}

// projectIds = danh bạ project UI đã biết (khuôn listWorkflows/agents.list) —
// global luôn nạp, project-tier nạp theo từng id được đưa.
export async function listTeams(projectIds: string[] = []): Promise<TeamSpec[]> {
  const global = await listFromDir(globalTeamsDir(), 'global', undefined)
  const projectResults = await Promise.all(projectIds.map((id) => listProjectTeams(id)))
  const teams = [...global, ...projectResults.flat()]
  teams.sort((a, b) => a.name.localeCompare(b.name))
  return teams
}

export async function loadTeam(
  id: string,
  source: 'global' | 'project' = 'global',
  projectId?: string,
): Promise<TeamSpec | null> {
  const dir = await resolveTeamsDir(source, projectId)
  const file = teamFile(dir, id)
  try {
    const raw = await readFile(file, 'utf8')
    return parse(raw, file, source, projectId)
  } catch (err) {
    if (!isMissing(err)) throw err
    // Spec viết tay có thể lệch tên file ↔ id bên trong (khuôn AGENT.md:
    // identity sống trong frontmatter, không phải tên file). Quét một vòng
    // theo id đã parse trước khi kết luận không có.
    const all = await listFromDir(dir, source, projectId)
    return all.find((t) => t.id === id) ?? null
  }
}

export async function saveTeam(team: TeamSpec): Promise<void> {
  const source = team.source ?? 'global'
  const dir = await resolveTeamsDir(source, team.projectId)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = teamFile(dir, team.id)
  // Chỉ ghi SPEC — source/projectId suy ra từ đường dẫn.
  const persisted = {
    id: team.id,
    name: team.name,
    ...(team.desc ? { desc: team.desc } : {}),
    // Chuỗi rỗng coi như xoá — cùng ngữ nghĩa desc.
    ...(team.instructions?.trim() ? { instructions: team.instructions } : {}),
    ...(team.lead ? { lead: team.lead } : {}),
    members: team.members,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  }
  const tmp = `${file}.tmp.${process.pid}`
  await writeFile(tmp, JSON.stringify(persisted, null, 2), 'utf8')
  await chmod(tmp, 0o600)
  await rename(tmp, file)
}

export async function deleteTeam(
  id: string,
  source: 'global' | 'project' = 'global',
  projectId?: string,
): Promise<void> {
  const dir = await resolveTeamsDir(source, projectId)
  const file = teamFile(dir, id)
  try {
    await unlink(file)
    return
  } catch (err) {
    if (!isMissing(err)) throw err
  }
  // Fallback cùng lý do với loadTeam: spec viết tay có tên file ≠ id — quét
  // theo id đã parse, xoá theo tên file THẬT.
  await scanDelete(dir, id)
}

// Xoá bằng cách quét từng file khi cả id lẫn tên file đều lệch nhau.
async function scanDelete(dir: string, id: string): Promise<void> {
  let names: string[] = []
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.json'))
  } catch {
    return
  }
  for (const name of names) {
    const file = join(dir, name)
    try {
      const spec = parse(await readFile(file, 'utf8'), file, 'global', undefined)
      if (spec?.id === id) await unlink(file)
    } catch {
      // File đã mất giữa chừng — coi như đã xoá.
    }
  }
}
