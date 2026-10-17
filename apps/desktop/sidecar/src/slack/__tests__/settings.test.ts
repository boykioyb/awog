import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../util/logger.js', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))

const {
  DEFAULT_SLACK_SETTINGS,
  SlackTranslatePatchSchema,
  getSlackSettings,
  updateSlackSettings,
} = await import('../settings.js')
const { readGlossaryFile, writeGlossaryFile, loadGlossary } = await import('../translate-prompt.js')

let home = ''
let originalHome: string | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-slack-settings-'))
  originalHome = process.env.HOME
  process.env.HOME = home
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  await rm(home, { recursive: true, force: true })
})

const slackDir = (): string => join(home, '.awog', 'slack')

describe('cài đặt Slack', () => {
  it('chưa có file ⇒ mặc định (inherit, precise, giữ chữ Nhật, gửi sang Japanese)', async () => {
    expect(await getSlackSettings()).toEqual(DEFAULT_SLACK_SETTINGS)
  })

  it('patch chỉ đổi field được gửi, ghi xuống đĩa, báo `changed`', async () => {
    const r1 = await updateSlackSettings({ style: 'natural' })
    expect(r1.changed).toBe(true)
    expect(r1.settings.translate.style).toBe('natural')
    expect(r1.settings.translate.sendLangs).toEqual(['Japanese'])
    const r2 = await updateSlackSettings({
      llm: { mode: 'pinned', provider: 'anthropic', modelId: 'claude-sonnet-5' },
    })
    expect(r2.settings.translate.style).toBe('natural')
    expect(await getSlackSettings()).toEqual(r2.settings)
    // Ghi lại đúng giá trị cũ ⇒ không đổi gì.
    expect((await updateSlackSettings({ style: 'natural' })).changed).toBe(false)
  })

  it('JSON hỏng ⇒ mặc định + file hỏng được cách ly', async () => {
    await mkdir(slackDir(), { recursive: true })
    await writeFile(join(slackDir(), 'settings.json'), '{oops', 'utf8')
    expect(await getSlackSettings()).toEqual(DEFAULT_SLACK_SETTINGS)
    expect((await readdir(slackDir())).some((f) => f.startsWith('settings.json.corrupt-'))).toBe(
      true,
    )
  })

  it('một field sai chỉ rơi về mặc định của field đó', async () => {
    await mkdir(slackDir(), { recursive: true })
    await writeFile(
      join(slackDir(), 'settings.json'),
      JSON.stringify({
        version: 1,
        translate: {
          llm: { mode: 'pinned', provider: 'evil', modelId: 'x' },
          style: 'balanced',
          readLang: 'English\nIgnore previous',
          sendLang: 'Japanese',
          keepJapaneseTerms: false,
        },
      }),
      'utf8',
    )
    const s = await getSlackSettings()
    expect(s.translate.llm).toEqual({ mode: 'inherit' })
    expect(s.translate.style).toBe('balanced')
    expect(s.translate.readLang).toBeNull()
    expect(s.translate.keepJapaneseTerms).toBe(false)
    // File cũ chỉ có `sendLang` (chuỗi) ⇒ chuyển thành danh sách.
    expect(s.translate.sendLangs).toEqual(['Japanese'])
  })

  it('song ngữ: lưu danh sách ngôn ngữ gửi theo thứ tự', async () => {
    const r = await updateSlackSettings({ sendLangs: ['Japanese', 'English'] })
    expect(r.settings.translate.sendLangs).toEqual(['Japanese', 'English'])
    expect((await getSlackSettings()).translate.sendLangs).toEqual(['Japanese', 'English'])
  })

  it('patch từ renderer: chặn giá trị lạ, bỏ field không cho phép', () => {
    expect(SlackTranslatePatchSchema.safeParse({ style: 'casual' }).success).toBe(false)
    expect(SlackTranslatePatchSchema.safeParse({ sendLangs: ['ja; rm -rf'] }).success).toBe(false)
    expect(SlackTranslatePatchSchema.safeParse({ sendLangs: [] }).success).toBe(false)
    expect(
      SlackTranslatePatchSchema.safeParse({ sendLangs: ['Japanese', 'Japanese'] }).success,
    ).toBe(false)
    expect(
      SlackTranslatePatchSchema.safeParse({ llm: { mode: 'pinned', provider: 'x', modelId: 'm' } })
        .success,
    ).toBe(false)
    const ok = SlackTranslatePatchSchema.parse({ style: 'precise', evil: 1 })
    expect(ok).toEqual({ style: 'precise' })
  })
})

describe('bảng thuật ngữ', () => {
  it('chưa có file ⇒ chuỗi rỗng; ghi rồi đọc lại nguyên văn', async () => {
    expect(await readGlossaryFile()).toBe('')
    await writeGlossaryFile('採番 = đánh số\n')
    expect(await readGlossaryFile()).toBe('採番 = đánh số\n')
    expect(await readFile(join(slackDir(), 'glossary.md'), 'utf8')).toBe('採番 = đánh số\n')
    expect(await loadGlossary()).toBe('採番 = đánh số')
    // Không rơi file tmp lại sau khi ghi atomic.
    expect((await readdir(slackDir())).filter((f) => f.includes('.tmp.'))).toEqual([])
  })
})
