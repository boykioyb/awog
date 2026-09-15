// `store.ts` — kho playbook 2 tier.
//
// Bốn tính chất, tất cả đều là chuyện "file trên đĩa có nói thật không":
//   · vòng `serialize → parse` giữ nguyên frontmatter và từng bước,
//   · `id` suy từ TÊN FILE và `tier` suy từ THƯ MỤC — không bao giờ đọc từ ruột
//     file (một file copy sang tier khác mà vẫn khai tier cũ là lời nói dối),
//   · cùng một id ở hai tier là HAI playbook khác nhau,
//   · một file hỏng vẫn HIỆN trong danh sách kèm `issues`, không biến mất im lặng.
//
// Run với vitest: `npx vitest run src/infra/playbook/__tests__/store.test.ts`
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let projectRoot = ''

// Tier project cần biết đường dẫn của project; `loadProject` là chỗ DUY NHẤT đi ra
// ngoài module này, nên chỉ nó bị thay.
vi.mock('../../../projects/store.js', () => ({
  loadProject: async (id: string) => (id === 'p1' ? { id: 'p1', path: projectRoot } : null),
}))

import { buildPlaybook } from '../schema.js'
import {
  deletePlaybook,
  globalPlaybooksRoot,
  listPlaybooks,
  parsePlaybookText,
  projectPlaybooksRoot,
  readPlaybook,
  savePlaybook,
  serializePlaybook,
  summarizePlaybook,
} from '../store.js'
import type { Playbook, PlaybookDraft } from '../schema.js'

let home: string
let originalHome: string | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-playbooks-'))
  projectRoot = await mkdtemp(join(tmpdir(), 'awog-project-'))
  originalHome = process.env.HOME
  // os.homedir() đọc $HOME trên POSIX → awogHome() trỏ vào temp dir.
  process.env.HOME = home
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  await rm(home, { recursive: true, force: true })
  await rm(projectRoot, { recursive: true, force: true })
})

function draft(over: Partial<PlaybookDraft> = {}): PlaybookDraft {
  return {
    name: 'Website tĩnh',
    description: 'Dựng một website tĩnh.',
    kind: 'instruction',
    variables: [
      { name: 'domain', label: 'Tên miền', required: true },
      { name: 'bucket', label: 'Bucket', required: false, default: 'web' },
    ],
    steps: [
      { id: 'b1-check', title: 'Bucket đã có chưa', verb: 'check', tool: 'aws', note: '', args: ['s3api', 'head-bucket', '--bucket', '{{bucket}}'] },
      { id: 'b1-do', title: 'Tạo bucket', verb: 'do', tool: 'aws', note: '', args: ['s3api', 'create-bucket', '--bucket', '{{bucket}}'] },
      { id: 'b1-verify', title: 'Bucket đã sẵn sàng', verb: 'verify', tool: 'aws', note: '', args: ['s3api', 'head-bucket', '--bucket', '{{bucket}}'] },
      { id: 'b1-rollback', title: 'Xoá bucket', verb: 'rollback', tool: 'aws', note: '', args: ['s3api', 'delete-bucket', '--bucket', '{{bucket}}'] },
    ],
    ...over,
  }
}

/** Chạy `parsePlaybookText` và khẳng định thành công, để test đọc như văn xuôi. */
function parse(raw: string, meta: { id: string; tier: 'global' | 'project' }): Playbook {
  const parsed = parsePlaybookText(raw, meta)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues))
  return parsed.playbook
}

function fileOf(root: string, id: string): string {
  return join(root, `${id}.md`)
}

describe('vòng serialize → parse', () => {
  it('giữ nguyên frontmatter và từng bước', () => {
    const pb = buildPlaybook(draft(), {
      id: 'static-site',
      tier: 'global',
      updatedAt: '2026-01-02T03:04:05.000Z',
    })
    const text = serializePlaybook(pb)

    // Frontmatter là thứ người dùng đọc và sửa tay — phải có THẬT, không phải suy
    // ra. Giá trị có dấu hai chấm/khoảng trắng được bộ ghi trích dẫn, nên khẳng
    // định bám theo đầu ra thật của `serializeFrontmatter`.
    expect(text.startsWith('---')).toBe(true)
    expect(text).toContain('name: "Website tĩnh"')
    expect(text).toContain('kind: instruction')
    expect(text).toContain('updatedAt: "2026-01-02T03:04:05.000Z"')

    const back = parse(text, { id: 'static-site', tier: 'global' })
    expect(back.steps).toEqual(pb.steps.map((s) => ({ ...s })))
    expect(back.variables).toEqual(pb.variables.map((v) => ({ ...v })))
    expect(back.name).toBe(pb.name)
    expect(back.description).toBe(pb.description)
    expect(back.kind).toBe(pb.kind)
    expect(back.updatedAt).toBe('2026-01-02T03:04:05.000Z')
  })

  it('`id`/`tier` của NGƯỜI GỌI thắng, kể cả khi ruột file nói khác', () => {
    const pb = buildPlaybook(draft(), { id: 'a', tier: 'global', updatedAt: '2026-01-01T00:00:00.000Z' })
    const back = parse(serializePlaybook(pb), { id: 'b', tier: 'project' })
    expect(back.id).toBe('b')
    expect(back.tier).toBe('project')
  })

  it('frontmatter do NGƯỜI DÙNG sửa tay (không trích dẫn) vẫn đọc được', () => {
    const handWritten = [
      '---',
      'name: Site của tôi',
      'description: ghi chú tự do',
      'kind: deployment',
      '---',
      '',
      '```json',
      JSON.stringify({
        variables: [],
        steps: [
          { id: 's1', title: 'Xem bucket', verb: 'check', tool: 'aws', note: '', args: ['s3api', 'list-buckets'] },
        ],
      }),
      '```',
      '',
    ].join('\n')

    const back = parse(handWritten, { id: 'hand', tier: 'global' })
    expect(back.name).toBe('Site của tôi')
    expect(back.kind).toBe('deployment')
    expect(back.steps).toHaveLength(1)
  })

  it('`kind` lạ rơi về `instruction` thay vì từ chối cả file', () => {
    const pb = buildPlaybook(draft(), { id: 'x', tier: 'global', updatedAt: '2026-01-01T00:00:00.000Z' })
    const text = serializePlaybook(pb).replace('kind: instruction', 'kind: whatever')
    expect(parse(text, { id: 'x', tier: 'global' }).kind).toBe('instruction')
  })
})

describe('hai tier là hai kho riêng', () => {
  it('cùng một id ở global và project là hai playbook khác nhau', async () => {
    await savePlaybook({ source: 'global', id: 'site', draft: draft({ name: 'Bản global' }) })
    await savePlaybook({
      source: 'project',
      projectId: 'p1',
      id: 'site',
      draft: draft({ name: 'Bản project' }),
    })

    const global = await readPlaybook('global', undefined, 'site')
    const project = await readPlaybook('project', 'p1', 'site')
    expect(global?.ok && global.playbook.name).toBe('Bản global')
    expect(project?.ok && project.playbook.name).toBe('Bản project')
    expect(project?.ok && project.playbook.tier).toBe('project')
  })

  it('đường dẫn hai tier tách hẳn nhau', () => {
    expect(globalPlaybooksRoot()).toBe(join(home, '.awog', 'playbooks'))
    expect(projectPlaybooksRoot(projectRoot)).toBe(join(projectRoot, '.awog', 'playbooks'))
  })

  it('`listPlaybooks` quét cả hai tier và gắn `source`/`projectId` đúng', async () => {
    await savePlaybook({ source: 'global', id: 'g-only', draft: draft({ name: 'G' }) })
    await savePlaybook({
      source: 'project',
      projectId: 'p1',
      id: 'p-only',
      draft: draft({ name: 'P' }),
    })

    const byId = new Map((await listPlaybooks(['p1'])).map((s) => [s.id, s]))
    expect(byId.get('g-only')?.source).toBe('global')
    expect(byId.get('p-only')?.source).toBe('project')
    expect(byId.get('p-only')?.projectId).toBe('p1')
    expect(byId.get('p-only')?.tier).toBe('project')
  })
})

describe('file hỏng không biến mất', () => {
  it('vẫn hiện trong danh sách, kèm `issues` và `canSubmit: false`', async () => {
    await savePlaybook({ source: 'global', id: 'good', draft: draft() })
    await mkdir(globalPlaybooksRoot(), { recursive: true })
    await writeFile(
      fileOf(globalPlaybooksRoot(), 'bad'),
      '---\nname: Bad\n---\n\n```json\n{ "steps": oops }\n```\n',
      'utf8',
    )

    const listed = await listPlaybooks()
    const bad = listed.find((s) => s.id === 'bad')
    expect(bad).toBeDefined()
    expect(bad?.issues.length).toBeGreaterThan(0)
    expect(bad?.canSubmit).toBe(false)
    expect(bad?.stepCount).toBe(0)
    expect(listed.find((s) => s.id === 'good')?.canSubmit).toBe(true)
  })

  it('`readPlaybook` trả `issues` chứ KHÔNG ném', async () => {
    await mkdir(globalPlaybooksRoot(), { recursive: true })
    await writeFile(fileOf(globalPlaybooksRoot(), 'bad'), 'không phải json', 'utf8')

    const parsed = await readPlaybook('global', undefined, 'bad')
    expect(parsed).not.toBeNull()
    expect(parsed?.ok).toBe(false)
    if (!parsed || parsed.ok) throw new Error('unreachable')
    expect(parsed.issues[0]?.code).toBe('playbook.error.badJson')
  })

  it('file không tồn tại ⇒ `null`, không phải ném', async () => {
    expect(await readPlaybook('global', undefined, 'nope')).toBeNull()
  })
})

describe('luật rollback KHÔNG chặn `save`', () => {
  it('lưu được bản nháp thiếu bước quay lui, và nói rõ nó chưa gửi duyệt được', async () => {
    const incomplete = draft({
      steps: [
        { id: 'd1', title: 'Tạo', verb: 'do', tool: 'aws', note: '', args: ['s3api', 'create-bucket', '--bucket', 'x'] },
      ],
    })
    const saved = await savePlaybook({ source: 'global', id: 'draft-only', draft: incomplete })
    expect(saved.id).toBe('draft-only')

    const summary = summarizePlaybook(saved, 'global')
    expect(summary.canSubmit).toBe(false)
    expect(summary.missingRollback).toEqual(['d1'])
    // Nhưng nó nằm trên đĩa, đọc lại được, để còn sửa tiếp.
    expect((await readPlaybook('global', undefined, 'draft-only'))?.ok).toBe(true)
  })

  it('lỗi CẤU TRÚC thì chặn `save` (placeholder méo)', async () => {
    const bad = draft({
      steps: [
        { id: 'd1', title: 'Tạo', verb: 'do', tool: 'aws', note: '', args: ['--bucket', '{{bad-name}}'] },
        { id: 'r1', title: 'Xoá', verb: 'rollback', tool: 'aws', note: '', args: ['s3api', 'delete-bucket'] },
      ],
    })
    await expect(savePlaybook({ source: 'global', id: 'broken', draft: bad })).rejects.toThrow()
  })

  it('id sai charset bị từ chối trước khi chạm đĩa', async () => {
    await expect(savePlaybook({ source: 'global', id: 'a/b', draft: draft() })).rejects.toThrow()
  })
})

describe('xoá', () => {
  it('xoá một playbook có thật, và xoá lần hai không ném', async () => {
    await savePlaybook({ source: 'global', id: 'temp', draft: draft() })
    await deletePlaybook('global', undefined, 'temp')
    expect(await readPlaybook('global', undefined, 'temp')).toBeNull()
    await expect(deletePlaybook('global', undefined, 'temp')).resolves.toBeUndefined()
  })

  it('KHÔNG xoá được playbook dựng sẵn — nó không nằm trên đĩa', async () => {
    await expect(deletePlaybook('builtin', undefined, 'static-site')).rejects.toThrow()
  })
})
