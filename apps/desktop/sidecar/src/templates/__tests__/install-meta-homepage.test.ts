// `homepage` sống sót qua bước cài — nhưng chỉ khi nó là link bấm được an toàn.
//
// Trang chủ do người xuất bản danh mục (người lạ) khai, và UI biến nó thành một
// cú bấm mở trình duyệt hệ thống. Nó đi vào `.install.json` lúc cài rồi được đọc
// lại mỗi lần liệt kê template, nên phải lọc ở CẢ HAI CHIỀU:
//   ghi — đừng để một `javascript:` nằm sẵn trên đĩa chờ được bấm;
//   đọc — file nằm trong thư mục người dùng (sửa tay được) và bản app cũ có thể
//         đã ghi một homepage chưa qua lọc; đúng lý do `readCache` của
//         marketplace.ts phải lọc lại.
//
// Run: `npx vitest@2 run src/templates/__tests__/install-meta-homepage.test.ts`
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  INSTALL_META_NAME,
  readInstallMeta,
  writeInstallMeta,
  type TemplateInstallMeta,
} from '../install-meta.js'
import { getTemplate } from '../store.js'

const OK_HOMEPAGE = 'https://example.com/awog-web-team'

// Link người lạ khai mà KHÔNG được phép thành một cú bấm.
const BAD_HOMEPAGES: ReadonlyArray<[string, string]> = [
  ['javascript', 'javascript:alert(document.cookie)'],
  ['data', 'data:text/html,<script>alert(1)</script>'],
  ['file', 'file:///etc/passwd'],
  ['plain http', 'http://example.com/'],
  ['loopback', 'https://127.0.0.1/admin'],
  ['private IP', 'https://192.168.1.1/reboot'],
  ['not a URL', 'example.com'],
]

let bundleDir: string

function meta(over: Partial<TemplateInstallMeta> = {}): TemplateInstallMeta {
  return {
    sourceUrl: 'https://github.com/acme/awog-templates/tree/main/bundles/web-team',
    sourceRef: 'main',
    installedAt: '2026-09-08T00:00:00.000Z',
    entities: { 'skill/review': { 'skills/review/SKILL.md': 'a'.repeat(40) } },
    ...over,
  }
}

// Ghi thẳng JSON, bỏ qua `writeInstallMeta` — mô phỏng file do bản app CŨ ghi
// hoặc do người dùng sửa tay.
async function writeRawMeta(raw: Record<string, unknown>): Promise<void> {
  await writeFile(join(bundleDir, INSTALL_META_NAME), JSON.stringify(raw, null, 2), 'utf8')
}

beforeEach(async () => {
  bundleDir = await mkdtemp(join(tmpdir(), 'awog-install-meta-'))
})

afterEach(async () => {
  await rm(bundleDir, { recursive: true, force: true })
})

describe('install meta carries the homepage through the install step', () => {
  it('round-trips a https homepage', async () => {
    await writeInstallMeta(bundleDir, meta({ homepage: OK_HOMEPAGE }))
    expect((await readInstallMeta(bundleDir))?.homepage).toBe(OK_HOMEPAGE)
  })

  it('has no homepage field when the install declares none', async () => {
    await writeInstallMeta(bundleDir, meta())
    const read = await readInstallMeta(bundleDir)
    expect(read?.homepage).toBeUndefined()
    // Không tự sinh ra `"homepage": null` trên đĩa.
    expect(await readFile(join(bundleDir, INSTALL_META_NAME), 'utf8')).not.toContain('homepage')
  })

  // Tương thích ngược: `.install.json` do bản app trước khi có field này ghi ra.
  it('reads a meta file written before the field existed', async () => {
    await writeRawMeta({
      sourceUrl: 'https://github.com/acme/awog-templates/tree/main/bundles/web-team',
      sourceRef: 'main',
      installedAt: '2026-01-01T00:00:00.000Z',
      version: '1.2.0',
      entities: {},
    })
    const read = await readInstallMeta(bundleDir)
    expect(read?.sourceUrl).toContain('github.com')
    expect(read?.version).toBe('1.2.0')
    expect(read?.homepage).toBeUndefined()
  })
})

describe('a homepage that is not a safe link is dropped in BOTH directions', () => {
  it.each(BAD_HOMEPAGES)('never writes a %s homepage to disk', async (_label, homepage) => {
    await writeInstallMeta(bundleDir, meta({ homepage }))
    const onDisk = await readFile(join(bundleDir, INSTALL_META_NAME), 'utf8')
    expect(onDisk).not.toContain(homepage)
    // Chỉ field rụng — bản cài vẫn dùng được.
    const read = await readInstallMeta(bundleDir)
    expect(read?.sourceRef).toBe('main')
    expect(read?.homepage).toBeUndefined()
  })

  it.each(BAD_HOMEPAGES)('never returns a %s homepage already on disk', async (_l, homepage) => {
    await writeRawMeta({ ...meta(), homepage })
    const read = await readInstallMeta(bundleDir)
    // Meta vẫn đọc được (homepage hỏng KHÔNG giết bản cài) — chỉ field rụng.
    expect(read?.sourceRef).toBe('main')
    expect(read?.homepage).toBeUndefined()
  })
})

// Chặng cuối: field phải đi tiếp lên payload mà UI đọc (`TemplateDetail.vue`),
// nếu không thì cài xong vẫn chẳng có gì để hiện.
describe('an installed template carries its homepage up to the UI payload', () => {
  const TEMPLATE_ID = 'web-team'
  let home: string
  let originalHome: string | undefined

  async function writeBundle(installMeta: Record<string, unknown>): Promise<void> {
    const dir = join(home, '.awog', 'templates', TEMPLATE_ID)
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'template.json'),
      JSON.stringify({ name: 'Web team', description: 'bundle', entities: [] }),
    )
    await writeFile(join(dir, INSTALL_META_NAME), JSON.stringify(installMeta))
  }

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'awog-tpl-home-'))
    originalHome = process.env.HOME
    // os.homedir() đọc $HOME trên POSIX → awogHome() trỏ vào temp dir.
    process.env.HOME = home
  })

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    await rm(home, { recursive: true, force: true })
  })

  it('exposes a https homepage on the template', async () => {
    await writeBundle({ ...meta(), homepage: OK_HOMEPAGE })
    expect((await getTemplate(TEMPLATE_ID))?.homepage).toBe(OK_HOMEPAGE)
  })

  it('exposes no homepage when the one on disk is not a safe link', async () => {
    await writeBundle({ ...meta(), homepage: 'javascript:alert(1)' })
    const tpl = await getTemplate(TEMPLATE_ID)
    // Template vẫn đọc được — chỉ field rụng.
    expect(tpl?.name).toBe('Web team')
    expect(tpl?.homepage).toBeUndefined()
  })
})
