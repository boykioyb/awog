// Đọc output của job nền do runtime Claude SDK sở hữu (nợ kỹ thuật, dọn 2026-09-09).
//
// Vì sao có file này: trên nhánh Claude SDK, job nền chạy TRONG tiến trình CLI nên
// AWOG không sở hữu file log nào — modal "View output" của người dùng luôn hiện hộp
// rỗng, và ghi chú trong repo nói đó là chuyện "vĩnh viễn". Không đúng cho SHELL:
// CLI tự ghi `<taskId>.output` và nêu đường dẫn trong tool_result, và run-stream ĐÃ
// đọc file đó để đẩy tail vào transcript. Việc thiếu chỉ là ghi đường dẫn ấy vào
// registry để đường của NGƯỜI DÙNG đọc cùng một file.
//
// Ranh giới phải giữ: task subagent (`local_agent`) thật sự không có file — nó
// không được ghi `externalOutputFile`, và hộp rỗng ở đó vẫn là câu trả lời đúng.
//
// Run: `npx vitest run src/sessions/__tests__/external-bg-output.test.ts`
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  noteExternalOutputFile,
  readBackground,
  registerExternalBackground,
  settleExternalBackground,
  listBackground,
} from '../bg-registry.js'

let home: string
let originalHome: string | undefined
let tasksDir: string
const sessionId = 'ses-ext-bg'

// `readTaskOutputTail` chỉ nhận file tên đúng `<taskId>.output`, nằm trong một thư
// mục `tasks/`, và thư mục thật phải ở trong temp hoặc `~/.awog`. Dựng đúng hình đó.
async function writeTaskOutput(taskId: string, text: string): Promise<string> {
  const file = join(tasksDir, `${taskId}.output`)
  await writeFile(file, text)
  return file
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-extbg-'))
  originalHome = process.env.HOME
  process.env.HOME = home
  tasksDir = join(home, '.awog', 'tasks')
  await mkdir(tasksDir, { recursive: true })
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  await rm(home, { recursive: true, force: true })
})

describe('shell nền của nhánh Claude SDK', () => {
  it('đọc được output sau khi biết đường dẫn CLI ghi', async () => {
    registerExternalBackground({ sessionId, shellId: 'task-1', command: 'pnpm test' })
    // Trước khi biết đường dẫn: rỗng, và cờ `external` nói WHY cho UI.
    const before = readBackground(sessionId, 'task-1', { markRead: false, raw: true })
    expect(before).toMatchObject({ external: true, output: '' })

    const file = await writeTaskOutput('task-1', 'ok 1 - it works\n')
    noteExternalOutputFile({ sessionId, shellId: 'task-1', file })

    const after = readBackground(sessionId, 'task-1', { markRead: false, raw: true })
    expect(after?.output).toContain('ok 1 - it works')
    expect(after?.external).toBe(true)
  })

  it('đọc được CẢ SAU KHI xong — job xong mà mất log thì modal vô dụng', async () => {
    registerExternalBackground({ sessionId, shellId: 'task-2', command: 'pnpm build' })
    const file = await writeTaskOutput('task-2', 'build finished\n')
    noteExternalOutputFile({ sessionId, shellId: 'task-2', file })
    settleExternalBackground({ sessionId, shellId: 'task-2', status: 'exited', exitCode: 0 })

    const read = readBackground(sessionId, 'task-2', { markRead: false, raw: true })
    expect(read?.output).toContain('build finished')
    expect(read?.status).toBe('exited')
  })

  it('task subagent thành công vẫn bị bỏ — nó không có file, giữ lại chỉ làm phình danh sách', () => {
    registerExternalBackground({ sessionId, shellId: 'task-3', command: 'review the diff' })
    settleExternalBackground({ sessionId, shellId: 'task-3', status: 'exited', exitCode: 0 })
    expect(listBackground(sessionId).find((s) => s.shellId === 'task-3')).toBeUndefined()
  })

  it('task THẤT BẠI ở lại dù không có file — chip của nó cũng ở lại', () => {
    registerExternalBackground({ sessionId, shellId: 'task-4', command: 'review the diff' })
    settleExternalBackground({ sessionId, shellId: 'task-4', status: 'exited', exitCode: 1 })
    expect(listBackground(sessionId).find((s) => s.shellId === 'task-4')).toBeDefined()
  })

  it('đường dẫn không hợp lệ ⇒ rỗng, không đọc bừa', async () => {
    registerExternalBackground({ sessionId, shellId: 'task-5', command: 'x' })
    // Tên file không khớp taskId ⇒ `readTaskOutputTail` từ chối trước mọi I/O.
    const wrong = join(tasksDir, 'somethingelse.output')
    await writeFile(wrong, 'secret')
    noteExternalOutputFile({ sessionId, shellId: 'task-5', file: wrong })
    expect(readBackground(sessionId, 'task-5', { markRead: false, raw: true })?.output).toBe('')
  })

  it('không ghi đường dẫn cho một shell KHÔNG phải external', () => {
    // Job của chính AWOG có log riêng; ghi đè bằng file của CLI sẽ trỏ sai chỗ.
    noteExternalOutputFile({ sessionId, shellId: 'nope', file: join(tasksDir, 'nope.output') })
    expect(readBackground(sessionId, 'nope', { markRead: false, raw: true })).toBeNull()
  })
})
