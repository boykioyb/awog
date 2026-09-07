// Tests cho doctor.ts — lớp THUẦN `inspectSkillContent` (mọi luật chẩn đoán).
//
// Chạy: `npx vitest@2 run src/skills/__tests__/doctor.test.ts` (vitest chưa nằm
// trong devDeps của sidecar — xem git/__tests__/discover.test.ts).
//
// Lớp I/O `diagnoseSkill` chỉ đọc đĩa rồi gọi hàm thuần này, nên test bám vào
// hàm thuần: không đụng HOME thật của máy chạy test.

import { describe, expect, it } from 'vitest'
import {
  BODY_THIN_CHARS,
  DESCRIPTION_MIN_CHARS,
  inspectSkillContent,
  type InspectInput,
  type SkillIssueRule,
} from '../doctor.js'

// Một SKILL.md "khoẻ mạnh" làm mốc: mọi test chỉ đổi đúng thứ nó muốn kiểm.
const GOOD_DESCRIPTION =
  'Use this when the user asks to fill in a PDF form or extract fields from a PDF file.'
const GOOD_BODY = `# PDF filler

Steps to follow when the user hands you a PDF:

1. Read the form fields with the helper script.
2. Map each answer onto its field name.
3. Write the filled document next to the original file.

Keep the original file untouched; always write a copy.`

function build(patch: Partial<InspectInput> = {}, frontmatter?: string): InspectInput {
  const fm =
    frontmatter ??
    ['---', 'name: Pdf Filler', `description: "${GOOD_DESCRIPTION}"`, '---'].join('\n')
  const raw = `${fm}\n${GOOD_BODY}\n`
  return {
    id: 'pdf-filler',
    source: 'global',
    raw,
    fileBytes: Buffer.byteLength(raw),
    assets: [],
    siblings: [{ id: 'pdf-filler', source: 'global', name: 'Pdf Filler' }],
    ...patch,
  }
}

const rules = (input: InspectInput): SkillIssueRule[] =>
  inspectSkillContent(input).issues.map((i) => i.rule)

describe('inspectSkillContent — skill khoẻ mạnh', () => {
  it('không báo vấn đề nào', () => {
    expect(rules(build())).toEqual([])
  })

  it('trả về thống kê đúng', () => {
    const { stats } = inspectSkillContent(build())
    expect(stats.descriptionChars).toBe(GOOD_DESCRIPTION.length)
    expect(stats.bodyChars).toBe(GOOD_BODY.length)
    expect(stats.assetFiles).toBe(0)
  })
})

describe('inspectSkillContent — frontmatter', () => {
  it('thiếu name và description là error', () => {
    const found = rules(build({}, ['---', 'icon: "📄"', '---'].join('\n')))
    expect(found).toContain('missing-name')
    expect(found).toContain('missing-description')
  })

  it('không có frontmatter thì cũng bắt được (parser trả data rỗng)', () => {
    const raw = GOOD_BODY
    const found = rules(build({ raw, fileBytes: Buffer.byteLength(raw) }))
    expect(found).toContain('missing-name')
    expect(found).toContain('missing-description')
  })

  it('id sai hình dạng là error', () => {
    expect(rules(build({ id: 'PDF Filler' }))).toContain('invalid-id')
  })

  it('key lạ (gõ nhầm) bị báo, key của Claude Code CLI thì không', () => {
    const withTypo = ['---', 'name: Pdf Filler', 'descriptio: nope', '---'].join('\n')
    const found = rules(build({}, withTypo))
    expect(found).toContain('unknown-frontmatter-key')

    const withCliKeys = [
      '---',
      'name: Pdf Filler',
      `description: "${GOOD_DESCRIPTION}"`,
      'allowed-tools: Bash',
      'license: MIT',
      '---',
    ].join('\n')
    expect(rules(build({}, withCliKeys))).not.toContain('unknown-frontmatter-key')
  })

  it('tên hiển thị lệch id chỉ là info', () => {
    const fm = ['---', 'name: Invoice Parser', `description: "${GOOD_DESCRIPTION}"`, '---'].join(
      '\n',
    )
    const { issues } = inspectSkillContent(build({}, fm))
    const mismatch = issues.find((i) => i.rule === 'name-id-mismatch')
    expect(mismatch?.severity).toBe('info')
    expect(mismatch?.params).toMatchObject({ id: 'pdf-filler' })
  })
})

describe('inspectSkillContent — mô tả', () => {
  it('mô tả quá ngắn bị báo kèm số ký tự', () => {
    const fm = ['---', 'name: Pdf Filler', 'description: Fills PDFs when asked.', '---'].join('\n')
    const { issues } = inspectSkillContent(build({}, fm))
    const short = issues.find((i) => i.rule === 'description-too-short')
    expect(short?.params).toMatchObject({ min: DESCRIPTION_MIN_CHARS })
    expect(Number(short?.params?.chars)).toBeLessThan(DESCRIPTION_MIN_CHARS)
  })

  it('mô tả không nêu điều kiện kích hoạt bị báo', () => {
    const fm = [
      '---',
      'name: Pdf Filler',
      'description: "A helper that fills PDF forms and extracts their fields for you."',
      '---',
    ].join('\n')
    expect(rules(build({}, fm))).toContain('description-no-trigger')
  })

  it('mô tả tiếng Việt có "khi" thì không bị báo thiếu điều kiện', () => {
    const fm = [
      '---',
      'name: Pdf Filler',
      'description: "Dùng khi người dùng cần điền biểu mẫu PDF hoặc trích xuất trường dữ liệu."',
      '---',
    ].join('\n')
    expect(rules(build({}, fm))).not.toContain('description-no-trigger')
  })

  it('mô tả quá dài bị báo', () => {
    const long = `Use this when ${'x'.repeat(600)}`
    const fm = ['---', 'name: Pdf Filler', `description: "${long}"`, '---'].join('\n')
    expect(rules(build({}, fm))).toContain('description-too-long')
  })
})

describe('inspectSkillContent — va chạm giữa các skill', () => {
  it('cùng id ở tier khác là shadowed-id', () => {
    const found = rules(
      build({
        source: 'project',
        projectId: 'p1',
        siblings: [
          { id: 'pdf-filler', source: 'project', projectId: 'p1', name: 'Pdf Filler' },
          { id: 'pdf-filler', source: 'global', name: 'Pdf Filler' },
        ],
      }),
    )
    expect(found).toContain('shadowed-id')
  })

  it('trùng TÊN với skill id khác là duplicate-name', () => {
    const { issues } = inspectSkillContent(
      build({
        siblings: [
          { id: 'pdf-filler', source: 'global', name: 'Pdf Filler' },
          { id: 'pdf-tools', source: 'global', name: 'pdf filler' },
        ],
      }),
    )
    expect(issues.find((i) => i.rule === 'duplicate-name')?.params).toMatchObject({
      otherId: 'pdf-tools',
    })
  })

  it('chính nó trong danh sách anh em không bị coi là trùng', () => {
    expect(rules(build())).not.toContain('shadowed-id')
  })
})

describe('inspectSkillContent — thân bài', () => {
  it('body rỗng là error', () => {
    const raw = ['---', 'name: Pdf Filler', `description: "${GOOD_DESCRIPTION}"`, '---', ''].join(
      '\n',
    )
    const found = rules(build({ raw, fileBytes: Buffer.byteLength(raw) }))
    expect(found).toContain('body-empty')
    expect(found).not.toContain('body-thin')
  })

  it('body quá mỏng là warn', () => {
    const thin = 'Fill the form when asked.'
    const raw = ['---', 'name: Pdf Filler', `description: "${GOOD_DESCRIPTION}"`, '---', thin].join(
      '\n',
    )
    const { issues } = inspectSkillContent(build({ raw, fileBytes: Buffer.byteLength(raw) }))
    const thinIssue = issues.find((i) => i.rule === 'body-thin')
    expect(thinIssue?.params).toMatchObject({ min: BODY_THIN_CHARS })
  })

  it('file quá lớn bị báo body-too-large', () => {
    expect(rules(build({ fileBytes: 64 * 1024 }))).toContain('body-too-large')
  })

  it('không đọc được thì chỉ báo unreadable và dừng', () => {
    const { issues, stats } = inspectSkillContent(build({ raw: null, fileBytes: 0 }))
    expect(issues.map((i) => i.rule)).toEqual(['unreadable'])
    expect(stats.bodyChars).toBe(0)
  })
})

describe('inspectSkillContent — link tới file trong thư mục skill', () => {
  const withRefs = (body: string, assets: { path: string; bytes: number }[] = []): InspectInput => {
    const raw = ['---', 'name: Pdf Filler', `description: "${GOOD_DESCRIPTION}"`, '---', body].join(
      '\n',
    )
    return build({ raw, fileBytes: Buffer.byteLength(raw), assets })
  }

  it('link markdown tới file không tồn tại là broken-link', () => {
    const { issues } = inspectSkillContent(
      withRefs('Run [the helper](scripts/fill.py) when the user asks.'),
    )
    expect(issues.find((i) => i.rule === 'broken-link')?.params).toMatchObject({
      target: 'scripts/fill.py',
    })
  })

  it('file có thật thì không báo', () => {
    const found = rules(
      withRefs('Run [the helper](scripts/fill.py) when the user asks.', [
        { path: 'scripts/fill.py', bytes: 400 },
      ]),
    )
    expect(found).not.toContain('broken-link')
  })

  it('path trong backtick cũng được kiểm khi nó trỏ vào thư mục kèm theo', () => {
    expect(rules(withRefs('Read `references/schema.json` first when needed.'))).toContain(
      'broken-link',
    )
    expect(rules(withRefs('Run `./setup.sh` when needed.'))).toContain('broken-link')
  })

  it('path của REPO người dùng trong backtick không bị báo nhảm', () => {
    const found = rules(withRefs('Open `src/index.ts` and `apps/desktop/app.vue` when asked.'))
    expect(found).not.toContain('broken-link')
  })

  it('nhưng vẫn báo khi thư mục kèm theo đó có thật', () => {
    const found = rules(withRefs('Open `src/index.ts` when asked.', [
      { path: 'src/other.ts', bytes: 10 },
    ]))
    expect(found).toContain('broken-link')
  })

  it('URL ngoài và anchor không bị coi là file', () => {
    const found = rules(
      withRefs('See [docs](https://example.com/a.html) and [top](#intro) when unsure.'),
    )
    expect(found).not.toContain('broken-link')
  })

  it('link ra ngoài thư mục skill bị báo riêng', () => {
    const found = rules(withRefs('Use [shared](../common/util.py) when needed.'))
    expect(found).toContain('link-outside-folder')
    expect(found).not.toContain('broken-link')
  })

  it('file kèm theo quá lớn chỉ là info', () => {
    const { issues } = inspectSkillContent(
      withRefs('Nothing to link here.', [{ path: 'model.bin', bytes: 5 * 1024 * 1024 }]),
    )
    const oversized = issues.find((i) => i.rule === 'oversized-asset')
    expect(oversized?.severity).toBe('info')
    expect(oversized?.params).toMatchObject({ path: 'model.bin' })
  })
})
