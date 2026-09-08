// Tests cho danh mục template (gói #37). Chỉ phần THUẦN — không gọi mạng: mọi
// hàm bị test đều nhận dữ liệu vào và trả dữ liệu ra.
//
// Run: `npx vitest@2 run src/templates/__tests__/marketplace.test.ts`
import { describe, expect, it, vi } from 'vitest'
import { filterEntries, parseCatalog, planToken, undisclosedKinds } from '../marketplace.js'
import { parseGithubUrl, type PlannedBundle } from '../remote.js'
import { log } from '../../util/logger.js'

const OK_URL = 'https://github.com/acme/awog-templates/tree/main/bundles/web-team'

function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'web-team', name: 'Web team', url: OK_URL, ...over }
}

// ─── Danh mục là L1 ──────────────────────────────────────────────────────────

describe('parseCatalog treats the catalog as untrusted input', () => {
  it('keeps a well-formed entry and defaults the optional fields', () => {
    const [e] = parseCatalog({ templates: [entry()] })
    expect(e?.id).toBe('web-team')
    expect(e?.description).toBe('')
    expect(e?.kinds).toEqual([])
    expect(e?.tags).toEqual([])
  })

  it('rejects the whole document when the shape is wrong', () => {
    expect(() => parseCatalog({ nope: true })).toThrow(/shape not recognised/)
    expect(() => parseCatalog('a string')).toThrow(/shape not recognised/)
  })

  it('DROPS an entry whose url leaves github.com — the catalog never redirects us', () => {
    const raw = {
      templates: [
        entry({ id: 'evil-host', url: 'https://evil.example.com/bundle' }),
        entry({ id: 'evil-look-alike', url: 'https://github.com.evil.example.com/a/b' }),
        entry({ id: 'plain-http', url: 'http://github.com/a/b' }),
        entry({ id: 'loopback', url: 'https://127.0.0.1/a/b' }),
        entry({ id: 'file-scheme', url: 'file:///etc/passwd' }),
        entry({ id: 'not-a-url', url: 'github.com/a/b' }),
        entry(),
      ],
    }
    expect(parseCatalog(raw).map((e) => e.id)).toEqual(['web-team'])
  })

  it('drops a malformed entry without killing the rest of the catalog', () => {
    const raw = { templates: [{ id: 'no-name', url: OK_URL }, 42, null, entry()] }
    expect(parseCatalog(raw).map((e) => e.id)).toEqual(['web-team'])
  })

  it('keeps the first of two entries sharing an id', () => {
    const raw = { templates: [entry({ name: 'First' }), entry({ name: 'Second' })] }
    const out = parseCatalog(raw)
    expect(out).toHaveLength(1)
    expect(out[0]?.name).toBe('First')
  })

  it('rejects an unknown entity kind instead of passing it through', () => {
    const raw = { templates: [entry({ kinds: ['agent', 'mcp'] })] }
    expect(parseCatalog(raw)).toHaveLength(0)
  })
})

// ─── Danh mục và lớp cài phải đồng ý với nhau ────────────────────────────────

// Một entry hiện ra trong "Khám phá" mà `parseGithubUrl` không giải được = một
// nút Cài chỉ để báo lỗi. `parseCatalog` phải loại nó NGAY, và loại bằng CHÍNH
// hàm mà lớp cài chạy — không phải bằng một bản luật chép lại.
describe('parseCatalog drops every url the installer itself cannot parse', () => {
  const BLOB_URL = 'https://github.com/acme/awog-templates/blob/main/bundles/web-team'

  it('DROPS a /blob/ url at parse time — the old code only died at install time', () => {
    // Đây chính là lỗi người dùng từng thấy sau khi bấm Cài.
    expect(() => parseGithubUrl(BLOB_URL)).toThrow(/expected a \/tree\/<branch>\/<folder> link/)
    expect(parseCatalog({ templates: [entry({ id: 'blobby', url: BLOB_URL })] })).toEqual([])
  })

  it('names the dropped entry AND the reason in the log', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {})
    try {
      parseCatalog({ templates: [entry({ id: 'blobby', url: BLOB_URL }), entry()] })
      expect(warn).toHaveBeenCalledTimes(1)
      const [msg, meta] = warn.mock.calls[0] as [string, Record<string, unknown>]
      expect(msg).toMatch(/dropped/)
      expect(meta.entry).toBe('blobby')
      expect(meta.url).toBe(BLOB_URL)
      // Lý do lấy nguyên văn từ lớp cài, không diễn đạt lại.
      expect(String(meta.reason)).toContain('/tree/<branch>/<folder>')
    } finally {
      warn.mockRestore()
    }
  })

  it('still keeps the urls the installer accepts, including a bare repo root', () => {
    const root = 'https://github.com/acme/awog-templates'
    expect(parseGithubUrl(root).ref).toBe('')
    const raw = { templates: [entry({ id: 'root', url: root }), entry()] }
    expect(parseCatalog(raw).map((e) => e.id)).toEqual(['root', 'web-team'])
  })

  // Ghim hành vi THẬT của `parseGithubUrl`, đo chứ không đoán: không có "ref nhiều
  // segment" — segment ngay sau /tree/ LÀ ref, phần còn lại là đường dẫn thư mục.
  // Một ref thật sự có "/" chỉ diễn đạt được bằng %2F, và ca đó thì bị loại.
  it('treats the first segment after /tree/ as the ref, the rest as the folder', () => {
    const url = 'https://github.com/acme/repo/tree/a/b/dir'
    const ref = parseGithubUrl(url)
    expect(ref.ref).toBe('a')
    expect(ref.dirPath).toBe('b/dir')
    expect(parseCatalog({ templates: [entry({ url })] }).map((e) => e.url)).toEqual([url])
  })

  it('DROPS a percent-encoded multi-segment ref — the installer refuses it', () => {
    const url = 'https://github.com/acme/repo/tree/feature%2Fx/dir'
    expect(() => parseGithubUrl(url)).toThrow(/single-segment/)
    expect(parseCatalog({ templates: [entry({ url })] })).toEqual([])
  })
})

// ─── Lọc cục bộ (chạy được cả khi offline) ───────────────────────────────────

describe('filterEntries searches the fields the user can see', () => {
  const entries = parseCatalog({
    templates: [
      entry({ id: 'a', name: 'Web team', description: 'BA + dev', tags: ['web'] }),
      entry({ id: 'b', name: 'Data team', author: 'acme', tags: ['etl'] }),
    ],
  })

  it('returns everything for an empty query', () => {
    expect(filterEntries(entries, '   ')).toHaveLength(2)
  })

  it('matches name, tag and author case-insensitively', () => {
    expect(filterEntries(entries, 'WEB').map((e) => e.id)).toEqual(['a'])
    expect(filterEntries(entries, 'etl').map((e) => e.id)).toEqual(['b'])
    expect(filterEntries(entries, 'ACME').map((e) => e.id)).toEqual(['b'])
  })
})

// ─── Token đồng ý ────────────────────────────────────────────────────────────

function bundle(over: Partial<PlannedBundle> = {}): PlannedBundle {
  return {
    localId: 'web-team',
    name: 'Web team',
    description: '',
    bundleDir: 'bundles/web-team',
    entities: [{ kind: 'rule', id: 'style', file: 'rules/style.md' }],
    files: [
      {
        repoPath: 'bundles/web-team/rules/style.md',
        relPath: 'rules/style.md',
        size: 120,
        sha: 'aaaa',
        entityKey: 'rule/style',
      },
    ],
    overwriteExisting: false,
    ...over,
  }
}

describe('planToken binds consent to exactly what was shown', () => {
  it('is stable for the same plan regardless of file order', () => {
    const a = bundle({
      files: [
        { repoPath: 'x/1', relPath: '1', size: 1, sha: 'a', entityKey: 'rule/style' },
        { repoPath: 'x/2', relPath: '2', size: 2, sha: 'b', entityKey: 'rule/style' },
      ],
    })
    const b = bundle({ files: [...a.files].reverse() })
    expect(planToken(a, 'u')).toBe(planToken(b, 'u'))
  })

  it('changes when the source swaps a file body (same path, new blob sha)', () => {
    const before = bundle()
    const after = bundle({ files: [{ ...bundle().files[0]!, sha: 'bbbb' }] })
    expect(planToken(after, 'u')).not.toBe(planToken(before, 'u'))
  })

  it('changes when the source slips an extra HOOK into the bundle', () => {
    const before = bundle()
    const after = bundle({
      entities: [...before.entities, { kind: 'hook', id: 'pwn', file: 'hooks/pwn.json' }],
      files: [
        ...before.files,
        {
          repoPath: 'bundles/web-team/hooks/pwn.json',
          relPath: 'hooks/pwn.json',
          size: 40,
          sha: 'cccc',
          entityKey: 'hook/pwn',
        },
      ],
    })
    expect(planToken(after, 'u')).not.toBe(planToken(before, 'u'))
  })

  it('changes when the bundle folder itself moves', () => {
    expect(planToken(bundle(), 'u1')).not.toBe(planToken(bundle(), 'u2'))
  })
})

// ─── Cảnh báo "listing không khai" ───────────────────────────────────────────

describe('undisclosedKinds surfaces what the listing did not mention', () => {
  it('flags a hook in a bundle advertised as rules-only', () => {
    expect(
      undisclosedKinds(
        ['rule'],
        [
          { kind: 'rule', id: 'style', file: 'rules/style.md' },
          { kind: 'hook', id: 'pwn', file: 'hooks/pwn.json' },
        ],
      ),
    ).toEqual(['hook'])
  })

  it('is empty when the listing told the truth', () => {
    expect(
      undisclosedKinds(['rule', 'hook'], [{ kind: 'hook', id: 'h', file: 'hooks/h.json' }]),
    ).toEqual([])
  })

  it('treats an unadvertised listing as disclosing nothing', () => {
    expect(undisclosedKinds([], [{ kind: 'agent', id: 'a', file: 'agents/a.md' }])).toEqual(['agent'])
  })
})
