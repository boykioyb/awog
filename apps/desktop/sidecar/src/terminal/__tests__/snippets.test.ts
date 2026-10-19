// Snippet của terminal (terminal/snippets.ts + runtime/tools/terminal-snippet-tools.ts).
//
// Vì sao có file này: đây là chỗ AGENT ghi vào thư viện lệnh của người dùng và GÕ LỆNH
// vào shell họ đang mở. Sai phạm vi là agent của project này sửa / chạy snippet của
// project khác; sai cổng quyền là một lệnh chạy trong shell người dùng mà không ai duyệt.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let home = ''
vi.mock('../../util/logger.js', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))
vi.mock('../../util/path.js', () => ({ awogHome: () => home }))
const emitted: { event: string; payload: unknown }[] = []
vi.mock('../../transport/stdio.js', () => ({
  emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
}))
const written: { id: string; data: string }[] = []
let openTerminals: { terminalId: string; createdAt: number }[] = []
vi.mock('../manager.js', () => ({
  listTerminalsForWorkspace: () => openTerminals,
  terminalManager: { write: (id: string, data: string) => written.push({ id, data }) },
}))
vi.mock('../../sessions/store.js', () => ({
  loadSession: async (id: string) => ({ projectId: id === 'ses-noproj' ? null : 'proj-a' }),
}))

const { listSnippets, upsertSnippet, importSnippets, deleteSnippet } = await import('../snippets.js')
const tools = await import('../../runtime/tools/terminal-snippet-tools.js')
const { TERMINAL_SNIPPET_MUTATING_TOOL_NAMES } = tools

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-term-snippets-'))
  emitted.length = 0
  written.length = 0
  openTerminals = []
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

describe('store', () => {
  it('tạo / sửa / xoá và phát terminalSnippets.changed mỗi lần ghi', async () => {
    const a = await upsertSnippet({ name: ' Build ', command: 'pnpm build\n', project: 'proj-a' })
    expect(a.name).toBe('Build')
    expect(a.command).toBe('pnpm build')
    await upsertSnippet({ id: a.id, name: 'Build all', command: 'pnpm -r build', project: 'proj-a' })
    expect((await listSnippets())[0]?.name).toBe('Build all')
    await deleteSnippet(a.id)
    expect(await listSnippets()).toEqual([])
    expect(emitted.filter((e) => e.event === 'terminalSnippets.changed')).toHaveLength(3)
  })

  it('file hỏng ⇒ coi như rỗng; entry hỏng bị bỏ, entry lành giữ lại', async () => {
    const file = join(home, 'terminal-snippets.json')
    await writeFile(file, '{not json', 'utf8')
    expect(await listSnippets()).toEqual([])
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        snippets: [
          { id: 'tsnip-ok-1', name: 'ok', command: 'ls', project: null },
          { id: 'tsnip-bad-1', name: '', command: 'ls', project: null },
        ],
      }),
      'utf8',
    )
    expect((await listSnippets()).map((s) => s.id)).toEqual(['tsnip-ok-1'])
    // Ghi tiếp không làm sống lại entry hỏng, và file mới có version.
    await upsertSnippet({ name: 'more', command: 'pwd', project: null })
    const parsed = JSON.parse(await readFile(file, 'utf8')) as { version: number; snippets: unknown[] }
    expect(parsed.version).toBe(1)
    expect(parsed.snippets).toHaveLength(2)
  })

  it('import chỉ chạy khi thư viện còn rỗng (reload / hai cửa sổ không nhân đôi)', async () => {
    const legacy = [
      { id: 'tsnip-abc-1', name: 'Dev', command: 'pnpm dev', project: null },
      { id: 'bad id', name: 'x', command: 'y', project: null },
    ]
    expect(await importSnippets(legacy)).toEqual({ imported: 1 })
    expect(await importSnippets(legacy)).toEqual({ imported: 0 })
    expect(await listSnippets()).toHaveLength(1)
  })
})

describe('tool — phạm vi project', () => {
  it('list chỉ thấy snippet của project này + Global', async () => {
    await upsertSnippet({ name: 'mine', command: 'a', project: 'proj-a' })
    await upsertSnippet({ name: 'other', command: 'b', project: 'proj-b' })
    await upsertSnippet({ name: 'shared', command: 'c', project: null })
    const r = await tools.runSnippetList('proj-a')
    expect(r.text).toContain('mine')
    expect(r.text).toContain('shared')
    expect(r.text).not.toContain('other')
  })

  it('không sửa / xoá / chạy được snippet của project khác', async () => {
    const other = await upsertSnippet({ name: 'other', command: 'rm -rf dist', project: 'proj-b' })
    openTerminals = [{ terminalId: 't1', createdAt: 1 }]
    expect((await tools.runSnippetSave('proj-a', { id: other.id, name: 'x', command: 'y' })).isError).toBe(true)
    expect((await tools.runSnippetDelete('proj-a', { id: other.id })).isError).toBe(true)
    expect((await tools.runSnippetRun('/w', 'proj-a', { id: other.id })).isError).toBe(true)
    expect(written).toEqual([])
    expect(await listSnippets()).toHaveLength(1)
  })

  it('phiên không có project ⇒ lưu vào Global dù xin scope project', async () => {
    const r = await tools.runSnippetSave(null, { name: 'g', command: 'echo hi', scope: 'project' })
    expect(r.isError).toBeUndefined()
    expect((await listSnippets())[0]?.project).toBeNull()
  })
})

describe('tool — run', () => {
  it('gõ lệnh + newline vào terminal mở gần nhất của workspace', async () => {
    const s = await upsertSnippet({ name: 'test', command: 'pnpm test', project: 'proj-a' })
    openTerminals = [
      { terminalId: 't-new', createdAt: 2 },
      { terminalId: 't-old', createdAt: 1 },
    ]
    const r = await tools.runSnippetRun('/w', 'proj-a', { id: s.id })
    expect(r.isError).toBeUndefined()
    expect(written).toEqual([{ id: 't-new', data: 'pnpm test\n' }])
  })

  it('không có terminal nào mở ⇒ lỗi, không ghi gì', async () => {
    const s = await upsertSnippet({ name: 'test', command: 'pnpm test', project: null })
    const r = await tools.runSnippetRun('/w', 'proj-a', { id: s.id })
    expect(r.isError).toBe(true)
    expect(written).toEqual([])
  })

  it('terminalId không thuộc workspace ⇒ lỗi', async () => {
    const s = await upsertSnippet({ name: 'test', command: 'pnpm test', project: null })
    openTerminals = [{ terminalId: 't1', createdAt: 1 }]
    const r = await tools.runSnippetRun('/w', 'proj-a', { id: s.id, terminalId: 'elsewhere' })
    expect(r.isError).toBe(true)
    expect(written).toEqual([])
  })
})

describe('cổng quyền', () => {
  it('save / delete / run nằm trong danh sách gate; list thì không', () => {
    expect([...TERMINAL_SNIPPET_MUTATING_TOOL_NAMES].sort()).toEqual([
      'terminal_snippet_delete',
      'terminal_snippet_run',
      'terminal_snippet_save',
    ])
  })
})
