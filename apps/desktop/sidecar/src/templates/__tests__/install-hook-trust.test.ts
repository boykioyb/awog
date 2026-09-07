// Bề mặt nguy hiểm nhất của gói #37: một bundle tải từ danh mục có thể chứa
// **hook** (script chạy được) và **rule** (đi thẳng vào system prompt).
//
// Test này ghim ràng buộc: hook đến từ một bundle KHÔNG BAO GIỜ tự được trust.
// Nó phải nằm ở tier project (⇒ đi qua bản ghi trust trong AWOG home, ADR 0032
// D-8 + đính chính 2026-09-07) và dispatcher phải thấy `trusted: false` cho tới
// khi người dùng tự duyệt.
//
// Run: `npx vitest@2 run src/templates/__tests__/install-hook-trust.test.ts`
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listEnabledHooksForDispatch, listHooks } from '../../hooks/store.js'
import { installTemplate } from '../store.js'

const TEMPLATE_ID = 'from-catalog'
const HOOK_ID = 'catalog-hook'
const PROJECT_ID = 'proj-marketplace-test'

let home: string
let project: string
let originalHome: string | undefined

// Bundle y như thứ `templates.marketplaceInstall` ghi ra: manifest + entity file.
async function writeBundle(): Promise<void> {
  const dir = join(home, '.awog', 'templates', TEMPLATE_ID)
  await mkdir(join(dir, 'hooks'), { recursive: true })
  await mkdir(join(dir, 'rules'), { recursive: true })
  await writeFile(
    join(dir, 'hooks', `${HOOK_ID}.json`),
    JSON.stringify({
      id: HOOK_ID,
      name: 'Hook shipped by a third party',
      event: 'tool.before-call',
      command: 'touch /tmp/awog-pwned',
      enabled: true,
    }),
  )
  await writeFile(join(dir, 'rules', 'house-style.md'), '# House style\n')
  await writeFile(
    join(dir, 'template.json'),
    JSON.stringify({
      name: 'From the catalog',
      description: 'bundle with a hook in it',
      createdAt: new Date().toISOString(),
      entities: [
        { kind: 'hook', id: HOOK_ID, file: `hooks/${HOOK_ID}.json` },
        { kind: 'rule', id: 'house-style', file: 'rules/house-style.md' },
      ],
    }),
  )
}

async function registerProject(): Promise<void> {
  const dir = join(home, '.awog', 'projects')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, `${PROJECT_ID}.json`),
    JSON.stringify({ id: PROJECT_ID, name: 'marketplace test', path: project }),
  )
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-mkt-home-'))
  project = await mkdtemp(join(tmpdir(), 'awog-mkt-project-'))
  originalHome = process.env.HOME
  // os.homedir() đọc $HOME trên POSIX → awogHome() trỏ vào temp dir.
  process.env.HOME = home
  await registerProject()
  await writeBundle()
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  await rm(home, { recursive: true, force: true })
  await rm(project, { recursive: true, force: true })
})

describe('a hook that arrives inside a template bundle stays untrusted', () => {
  it('installs into the project tier and is NOT trusted', async () => {
    const result = await installTemplate(TEMPLATE_ID, PROJECT_ID)
    expect(result.installed.map((i) => `${i.kind}/${i.id}`)).toEqual([
      `hook/${HOOK_ID}`,
      'rule/house-style',
    ])

    // Hook đi vào `.awog` của project (AWOG-owned tier, ADR 0070) — không phải
    // `~/.awog/hooks` (tier global, nơi mọi hook mặc định được coi là trusted).
    await expect(stat(join(project, '.awog', 'hooks', `${HOOK_ID}.json`))).resolves.toBeTruthy()
    await expect(stat(join(home, '.awog', 'hooks', `${HOOK_ID}.json`))).rejects.toThrow()

    const { hooks } = await listHooks([PROJECT_ID])
    expect(hooks.find((h) => h.id === HOOK_ID)?.trusted).toBe(false)

    // Dispatcher là nơi duy nhất quyết định có spawn hay không — nó lọc
    // `h.trusted !== false`, nên untrusted ở đây nghĩa là không chạy.
    const dispatch = await listEnabledHooksForDispatch(PROJECT_ID)
    expect(dispatch.find((h) => h.id === HOOK_ID)?.trusted).toBe(false)
  })

  it('writes no trust record of its own', async () => {
    await installTemplate(TEMPLATE_ID, PROJECT_ID)
    // Không có bản ghi trust nào được sinh ra — trong repo lẫn trong AWOG home.
    await expect(stat(join(project, '.awog', '.trust.json'))).rejects.toThrow()
    await expect(stat(join(home, '.awog', 'hook-trust'))).rejects.toThrow()
  })
})
