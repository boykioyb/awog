import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../util/logger.js', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))

const files = await import('../files.js')

describe('sanitizeFileName', () => {
  it('bỏ ký tự đường dẫn, điều khiển, chuỗi ..', () => {
    expect(files.sanitizeFileName('../../etc/passwd')).toBe('_._etc_passwd')
    expect(files.sanitizeFileName('a\\b\u0000c.txt')).toBe('a_b_c.txt')
    expect(files.sanitizeFileName('..')).toBe('file')
    expect(files.sanitizeFileName('', 'F0123ABCD')).toBe('F0123ABCD')
    expect(files.sanitizeFileName('.hidden')).toBe('hidden')
  })

  it('cắt 120 ký tự nhưng giữ đuôi', () => {
    const out = files.sanitizeFileName(`${'x'.repeat(300)}.xlsx`)
    expect(out.length).toBe(120)
    expect(out.endsWith('.xlsx')).toBe(true)
  })
})

describe('projectSafeFileName', () => {
  it('thêm tiền tố slack- cho file chỉ dẫn agent và mọi tên bắt đầu bằng dấu chấm', () => {
    for (const [name, want] of [
      ['CLAUDE.md', 'slack-CLAUDE.md'],
      ['claude.md', 'slack-claude.md'],
      ['Claude.Local.md', 'slack-Claude.Local.md'],
      ['AGENTS.md', 'slack-AGENTS.md'],
      ['GEMINI.md', 'slack-GEMINI.md'],
      ['copilot-instructions.md', 'slack-copilot-instructions.md'],
      ['.cursorrules', 'slack-.cursorrules'],
      ['.clinerules', 'slack-.clinerules'],
      ['.mcp.json', 'slack-.mcp.json'],
      ['.env', 'slack-.env'],
    ] as const) {
      expect(files.projectSafeFileName(name), name).toBe(want)
    }
  })

  it('giữ nguyên tên file bình thường', () => {
    for (const name of ['report.pdf', 'CLAUDE.md.txt', 'my-AGENTS.md', 'notes.md']) {
      expect(files.projectSafeFileName(name)).toBe(name)
    }
  })
})

describe('toSlackFile', () => {
  const base = {
    id: 'F0123ABCD',
    name: 'shot.png',
    mimetype: 'image/png',
    filetype: 'png',
    size: 1000,
    url_private: 'https://files.slack.com/files-pri/T-F/shot.png',
    thumb_360: 'https://files.slack.com/files-tmb/x_360.png',
    thumb_360_w: 360,
    thumb_360_h: 200,
    thumb_720: 'https://files.slack.com/files-tmb/x_720.png',
    thumb_720_w: 720,
    thumb_720_h: 400,
    permalink: 'https://malme.slack.com/files/U/F0123ABCD/shot.png',
  }

  it('ảnh đọc được: thumb 720, không lộ URL tải', () => {
    const f = files.toSlackFile(base, true)
    expect(f.kind).toBe('image')
    expect(f.thumb).toEqual({ size: 720, width: 720, height: 400 })
    expect(f.unavailable).toBeNull()
    expect(JSON.stringify(f)).not.toContain('files-pri')
    expect(JSON.stringify(f)).not.toContain('files-tmb')
  })

  it('thiếu files:read ⇒ no_access, không hứa thumbnail', () => {
    const f = files.toSlackFile(base, false)
    expect(f.unavailable).toBe('no_access')
    expect(f.thumb).toBeNull()
  })

  it('file liên kết ngoài ⇒ external, không thumb, externalUrl chỉ khi https', () => {
    const ext = files.toSlackFile(
      { ...base, is_external: true, external_url: 'https://drive.google.com/file/d/x' },
      true,
    )
    expect(ext.unavailable).toBe('external')
    expect(ext.thumb).toBeNull()
    expect(ext.externalUrl).toBe('https://drive.google.com/file/d/x')
    expect(
      files.toSlackFile({ ...base, mode: 'external', external_url: 'javascript:alert(1)' }, true)
        .externalUrl,
    ).toBeNull()
    expect(files.toSlackFile({ ...base, filetype: 'remote' }, true).unavailable).toBe('external')
    // File thường không mang externalUrl.
    expect(files.toSlackFile(base, true).externalUrl).toBeNull()
  })

  it('đã xoá / quá 200 MB / snippet / office', () => {
    expect(files.toSlackFile({ id: 'F0123ABCD', mode: 'tombstone' }, true).unavailable).toBe('deleted')
    expect(files.toSlackFile({ ...base, size: 300 * 1024 * 1024 }, true).unavailable).toBe('too_large')
    const snip = files.toSlackFile({ id: 'F0123ABCD', mode: 'snippet', preview: 'x'.repeat(30_000) }, true)
    expect(snip.kind).toBe('snippet')
    expect(snip.preview?.length).toBe(20_000)
    expect(files.fileKind({ id: 'F1', filetype: 'xlsx', mimetype: 'application/octet-stream' })).toBe('office')
    expect(files.fileKind({ id: 'F1', mimetype: 'application/pdf' })).toBe('pdf')
    expect(files.fileKind({ id: 'F1', mimetype: 'video/mp4' })).toBe('video')
    expect(files.fileKind({ id: 'F1', mimetype: 'application/zip', filetype: 'zip' })).toBe('other')
  })
})

describe('sweepSlackFileCache', () => {
  let home = ''
  let originalHome: string | undefined

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'awog-slack-files-'))
    originalHome = process.env.HOME
    process.env.HOME = home
  })

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    await rm(home, { recursive: true, force: true })
  })

  it('xoá file không mở quá 30 ngày, giữ file mới', async () => {
    const team = join(home, '.awog', 'slack', 'files', 'T01JC3E81SB')
    const now = Date.now()
    const old = new Date(now - 31 * 24 * 60 * 60_000)
    await mkdir(join(team, 'F0LDFILE1'), { recursive: true })
    await writeFile(join(team, 'F0LDFILE1', 'a.pdf'), 'x')
    await utimes(join(team, 'F0LDFILE1', 'a.pdf'), old, old)
    await mkdir(join(team, 'FNEWFILE1'), { recursive: true })
    await writeFile(join(team, 'FNEWFILE1', 'b.pdf'), 'x')
    await mkdir(join(team, 'thumbs'), { recursive: true })
    await writeFile(join(team, 'thumbs', 'F0LDFILE1-360.png'), 'x')
    await utimes(join(team, 'thumbs', 'F0LDFILE1-360.png'), old, old)
    await writeFile(join(team, 'thumbs', 'FNEWFILE1-360.png'), 'x')

    const removed = await files.sweepSlackFileCache(now)
    expect(removed).toBe(2)
    expect((await readdir(team)).sort()).toEqual(['FNEWFILE1', 'thumbs'])
    expect(await readdir(join(team, 'thumbs'))).toEqual(['FNEWFILE1-360.png'])
  })

  it('không có thư mục cache thì không ném', async () => {
    await expect(files.sweepSlackFileCache()).resolves.toBe(0)
  })
})
