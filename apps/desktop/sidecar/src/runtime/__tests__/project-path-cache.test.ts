// Đường dẫn project mà cổng quyền dùng để neo luật (nợ kỹ thuật, dọn 2026-09-09).
//
// Vì sao có file này: cổng quyền giải luật tầng project và MỌI đường dẫn tương đối
// theo `resolveSessionProjectPath`. Bản cũ cache theo `sessionId` và chỉ xoá lúc
// XOÁ PHIÊN, nên một phiên được trỏ sang project khác vẫn neo vào project CŨ cho
// tới khi khởi động lại sidecar — luật DENY tầng project của project mới không áp,
// và `Write(.env)` giải ra file trong thư mục sai.
//
// Bản vá bỏ hẳn tầng cache theo phiên (nó không tiết kiệm I/O nào: `sessionId →
// projectId` là O(1) trên map thường trú) và chỉ giữ `projectId → path`, thứ thật
// sự chạm đĩa. Cache còn lại có đúng một biến — đường dẫn của project — nên nó được
// xoá tường minh ở `projects.upsert` / `projects.delete`.
//
// Run: `npx vitest run src/runtime/__tests__/project-path-cache.test.ts`
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Nạp module SAU khi mock, và nạp LẠI mỗi test: cache là state cấp module.
async function load() {
  return import('../../sessions/permission-rules.js')
}

const projectPaths = new Map<string, string>()
const sessionProject = new Map<string, string | null>()

vi.mock('../../projects/store.js', () => ({
  loadProject: async (id: string) => {
    const path = projectPaths.get(id)
    return path ? { id, path } : null
  },
}))

vi.mock('../../sessions/session-manager.js', () => ({
  sessionManager: {
    getSessionProjectId: (id: string) =>
      sessionProject.has(id) ? sessionProject.get(id) : undefined,
  },
}))

let home: string
let originalHome: string | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-ppath-'))
  originalHome = process.env.HOME
  process.env.HOME = home
  projectPaths.clear()
  sessionProject.clear()
  vi.resetModules()
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  await rm(home, { recursive: true, force: true })
})

describe('resolveSessionProjectPath', () => {
  it('theo project HIỆN TẠI của phiên, không phải project lúc gọi lần đầu', async () => {
    const { resolveSessionProjectPath } = await load()
    projectPaths.set('p1', '/work/one')
    projectPaths.set('p2', '/work/two')
    sessionProject.set('ses-1', 'p1')
    await expect(resolveSessionProjectPath('ses-1')).resolves.toBe('/work/one')

    // Người dùng trỏ phiên sang project khác. Trước bản vá, dòng dưới vẫn trả
    // '/work/one' cho tới khi khởi động lại sidecar.
    sessionProject.set('ses-1', 'p2')
    await expect(resolveSessionProjectPath('ses-1')).resolves.toBe('/work/two')
  })

  it('phiên bỏ project ⇒ null, không giữ lại đường dẫn cũ', async () => {
    const { resolveSessionProjectPath } = await load()
    projectPaths.set('p1', '/work/one')
    sessionProject.set('ses-1', 'p1')
    await expect(resolveSessionProjectPath('ses-1')).resolves.toBe('/work/one')
    sessionProject.set('ses-1', null)
    await expect(resolveSessionProjectPath('ses-1')).resolves.toBeNull()
  })

  it('phiên không tồn tại ⇒ null', async () => {
    const { resolveSessionProjectPath } = await load()
    await expect(resolveSessionProjectPath('ses-nope')).resolves.toBeNull()
  })
})

describe('resolveProjectPathById + forgetProjectPath', () => {
  it('cache lần đọc đĩa — gate chạy trên mỗi lời gọi tool', async () => {
    const { resolveProjectPathById } = await load()
    projectPaths.set('p1', '/work/one')
    await expect(resolveProjectPathById('p1')).resolves.toBe('/work/one')
    // Đổi trên đĩa mà KHÔNG báo ⇒ vẫn đọc bản cache. Đây là hành vi cố ý, và
    // chính nó là lý do `projects.upsert` phải gọi forgetProjectPath.
    projectPaths.set('p1', '/work/moved')
    await expect(resolveProjectPathById('p1')).resolves.toBe('/work/one')
  })

  it('forgetProjectPath ⇒ lần sau đọc lại đường dẫn mới', async () => {
    const { resolveProjectPathById, forgetProjectPath } = await load()
    projectPaths.set('p1', '/work/one')
    await expect(resolveProjectPathById('p1')).resolves.toBe('/work/one')
    projectPaths.set('p1', '/work/moved')
    forgetProjectPath('p1')
    await expect(resolveProjectPathById('p1')).resolves.toBe('/work/moved')
  })

  it('phiên đọc theo cache đã xoá — hai đường dùng chung một cache', async () => {
    const { resolveSessionProjectPath, forgetProjectPath } = await load()
    projectPaths.set('p1', '/work/one')
    sessionProject.set('ses-1', 'p1')
    await expect(resolveSessionProjectPath('ses-1')).resolves.toBe('/work/one')
    projectPaths.set('p1', '/work/moved')
    forgetProjectPath('p1')
    await expect(resolveSessionProjectPath('ses-1')).resolves.toBe('/work/moved')
  })
})
