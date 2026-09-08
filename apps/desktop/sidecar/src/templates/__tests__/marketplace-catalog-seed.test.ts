// Kiểm file danh mục mẫu `docs/marketplace-catalog/catalog.json` (gói #37).
//
// File đó KHÔNG được app đọc — nó là bản để người dùng đẩy sang repo danh mục
// (`boykioyb/awog-templates`, xem hằng số trong `marketplace.ts`). Vì vậy sai sót
// trong nó chỉ lộ ra SAU khi xuất bản, lúc danh mục hiện thiếu entry mà không báo
// gì: `parseCatalog` cố ý LOẠI entry hỏng thay vì giết cả danh mục.
//
// Test này đóng đúng khoảng trống đó: nạp file thật rồi cho đi qua CHÍNH
// `parseCatalog`/`MAX_CATALOG_BYTES` của `marketplace.ts` và `parseGithubUrl` của
// `remote.ts` — không chép lại schema, không `JSON.parse` suông. Sửa schema mà
// quên sửa file mẫu ⇒ đỏ ở đây.
//
// Run: `npx vitest@2 run src/templates/__tests__/marketplace-catalog-seed.test.ts`
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MAX_CATALOG_BYTES, parseCatalog } from '../marketplace.js'
import { parseGithubUrl } from '../remote.js'

// __tests__ → templates → src → sidecar → desktop → apps → gốc repo
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../..')
const SEED_PATH = resolve(REPO_ROOT, 'docs/marketplace-catalog/catalog.json')

const seedBytes = readFileSync(SEED_PATH)

function parseSeed(): { templates: unknown[] } {
  let doc: unknown
  try {
    doc = JSON.parse(seedBytes.toString('utf8'))
  } catch (err) {
    throw new Error(`${SEED_PATH} is not valid JSON: ${err instanceof Error ? err.message : err}`)
  }
  const templates = (doc as { templates?: unknown }).templates
  if (!Array.isArray(templates)) throw new Error(`${SEED_PATH} has no templates[]`)
  return { templates }
}

const seed = parseSeed()

// Cùng một phép đo mà `getCatalogDoc` áp lên phản hồi HTTP.
function withinByteCap(buf: Buffer): boolean {
  return buf.byteLength <= MAX_CATALOG_BYTES
}

// Entry nào bị `parseCatalog` LOẠI — chạy từng entry một để thông báo nói được
// CHỖ nào sai, thay vì chỉ ra một con số đếm lệch.
function rejectedIds(templates: unknown[]): string[] {
  return templates
    .map((item, i) => {
      const id = (item as { id?: unknown }).id
      const label = typeof id === 'string' && id ? id : `<no id>`
      const kept = parseCatalog({ templates: [item] }).length === 1
      return kept ? null : `#${i} (${label})`
    })
    .filter((x): x is string => x !== null)
}

describe('file danh mục mẫu đi lọt bộ parser thật', () => {
  it('nằm dưới trần byte mà getCatalogDoc áp', () => {
    expect(withinByteCap(seedBytes)).toBe(true)
  })

  it('parseCatalog nhận hình dạng top-level và giữ lại ĐỦ mọi entry', () => {
    expect(rejectedIds(seed.templates)).toEqual([])
    expect(parseCatalog(seed).length).toBe(seed.templates.length)
  })

  it('công bố đúng ba bundle first-party của repo AWOG', () => {
    expect(parseCatalog(seed).map((e) => e.id)).toEqual([
      'awog-delivery-guild',
      'web-app-team',
      'spec-driven-planning',
    ])
  })

  it('mọi url cài được: parse trọn vẹn bằng chính parser của remote.ts', () => {
    for (const entry of parseCatalog(seed)) {
      // Ném ⇒ entry hiện ra trong danh mục nhưng chết lúc bấm Cài (-32602).
      const ref = parseGithubUrl(entry.url)
      expect(ref.owner).toBeTruthy()
      expect(ref.repo).toBeTruthy()
      // Ref rỗng ⇒ installer phải gọi thêm api.github.com chỉ để hỏi nhánh mặc định.
      expect(ref.ref).toBeTruthy()
      // Trỏ thẳng thư mục bundle, không phải gốc repo: gốc repo là "registry",
      // và `planSingleBundle` chỉ chịu khi ở đó có ĐÚNG một template.json.
      expect(ref.dirPath).toBeTruthy()
    }
  })

  it('mỗi entry khai loại entity — khai rỗng thì màn hình đồng ý báo mọi thứ là "không khai"', () => {
    for (const entry of parseCatalog(seed)) {
      expect(entry.kinds.length, `${entry.id} không khai kinds`).toBeGreaterThan(0)
    }
  })
})

// Chốt rằng ba phép kiểm trên THẬT SỰ chịu tải: làm hỏng bản sao của file mẫu
// theo đúng ba kiểu hỏng hay gặp và xác nhận từng phép bắt được.
describe('phép kiểm bắt được file mẫu hỏng', () => {
  it('thiếu một field bắt buộc ⇒ entry bị loại và tên nó hiện ra', () => {
    const broken = seed.templates.map((item, i) => {
      if (i !== 0) return item
      const { name: _name, ...rest } = item as Record<string, unknown>
      return rest
    })
    expect(rejectedIds(broken)).toEqual(['#0 (awog-delivery-guild)'])
  })

  it('sai hình dạng top-level ⇒ parseCatalog ném', () => {
    expect(() => parseCatalog({ entries: seed.templates })).toThrow(/shape not recognised/)
  })

  it('vượt trần byte ⇒ phép đo kích thước báo hỏng', () => {
    const bloated = Buffer.alloc(MAX_CATALOG_BYTES + 1, 0x20)
    expect(withinByteCap(bloated)).toBe(false)
  })
})
