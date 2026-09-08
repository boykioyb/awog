// Một source KHÔNG được mang id trùng tên server MCP in-process của AWOG.
//
// Triệu chứng khi hàng rào này vắng mặt: nhánh Claude SDK gộp server của AWOG
// SAU CÙNG vào `options.mcpServers`, mà khoá của một server ngoài chính là source
// id — nên một source tên `awogterm`/`awog`/`awogwiki`… mất SẠCH tool, không một
// dòng cảnh báo. Người dùng thấy "đã kết nối" mà model không gọi được gì.
//
// Ba đường phải chặn/xử lý, test đủ ba:
//   1. RPC `source.upsert` (đường UI)
//   2. tool `source_create` của MODEL (dùng chung core cho cả hai runtime)
//   3. migration MCP cũ → source: đổi tên thay vì để xung đột im lặng
//
// Run: `npx vitest@2 run src/sources/__tests__/reserved-source-id.test.ts`
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AWOG_RESERVED_MCP_SERVER_NAMES } from '../../runtime/tools/bridged.js'
import { SURFACE_MCP_SERVER } from '../../runtime/tools/surface-tools.js'
import { TERMINAL_MCP_SERVER } from '../../runtime/tools/read-terminal-tool.js'
import { reservedSourceIdError } from '../reserved.js'
import { migratedSourceId, migrateMcpServersToSources } from '../migrate.js'
import { listSources } from '../store.js'
import { runSourceCreate } from '../../runtime/tools/source-tools.js'
import { dispatch } from '../../transport/rpc.js'
import '../../methods/source.upsert.js'

let home: string
let originalHome: string | undefined

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-reserved-src-'))
  originalHome = process.env.HOME
  // os.homedir() đọc $HOME trên POSIX → awogHome() trỏ vào temp dir.
  process.env.HOME = home
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  await rm(home, { recursive: true, force: true })
})

function mcpSourceConfig(id: string): Record<string, unknown> {
  return {
    id,
    slug: id,
    name: 'Someone else',
    provider: 'someone-else',
    enabled: true,
    type: 'mcp',
    timeoutMs: 30_000,
    trust: 'prompt',
    mcp: { transport: 'stdio', command: 'node' },
  }
}

async function sourceDirs(): Promise<string[]> {
  try {
    return (await readdir(join(home, '.awog', 'sources'), { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
}

describe('danh sách tên dành riêng dẫn xuất từ bảng bắc cầu', () => {
  it('phủ đúng những server AWOG thật sự gắn lên mcpServers', () => {
    // Dẫn xuất, không chép tay: đổi tên một server ⇒ danh sách tự đổi theo. Hai
    // hằng dưới đây là bản đối chiếu với server THẬT, không phải chuỗi trần.
    expect(AWOG_RESERVED_MCP_SERVER_NAMES).toContain(SURFACE_MCP_SERVER)
    expect(AWOG_RESERVED_MCP_SERVER_NAMES).toContain(TERMINAL_MCP_SERVER)
    expect(AWOG_RESERVED_MCP_SERVER_NAMES).toContain('awog')
    expect(AWOG_RESERVED_MCP_SERVER_NAMES).toContain('awogwiki')
    expect(AWOG_RESERVED_MCP_SERVER_NAMES).toContain('awogmemory')
    expect(AWOG_RESERVED_MCP_SERVER_NAMES).toContain('awogssh')
    // Không trùng lặp — nó là một tập tên, không phải một dòng cho mỗi tool.
    expect(new Set(AWOG_RESERVED_MCP_SERVER_NAMES).size).toBe(AWOG_RESERVED_MCP_SERVER_NAMES.length)
  })

  it('id của source mới (`<slug>_<hex>`) không bao giờ dính hàng rào', () => {
    expect(reservedSourceIdError('github_1a2b3c4d')).toBeNull()
    // Trùng tiền tố thôi thì không tính — chỉ khớp ĐÚNG mới là xung đột khoá.
    expect(reservedSourceIdError('awogterm-mcp')).toBeNull()
  })

  it('nói rõ TÊN NÀO bị chiếm', () => {
    const msg = reservedSourceIdError('awogterm')
    expect(msg).toContain('awogterm')
    expect(msg).toContain('reserved')
  })
})

describe('RPC source.upsert (đường UI) từ chối id dành riêng', () => {
  it('không ghi gì xuống đĩa và nêu lý do', async () => {
    await expect(
      dispatch('source.upsert', { source: mcpSourceConfig('awogterm'), mode: 'create' }),
    ).rejects.toThrow(/awogterm.*reserved/s)
    expect(await sourceDirs()).toEqual([])
  })

  it('vẫn nhận một id bình thường', async () => {
    await dispatch('source.upsert', { source: mcpSourceConfig('notion-abc'), mode: 'create' })
    expect(await sourceDirs()).toEqual(['notion-abc'])
  })
})

describe('tool source_create của MODEL bị chặn cùng một hàng rào', () => {
  it('từ chối id dành riêng, không persist', async () => {
    // Đường thứ hai để tạo source, và là đường KHÔNG có người ngồi duyệt — chặn
    // mỗi RPC là để hở đúng nửa nguy hiểm hơn.
    const r = await runSourceCreate({ ...mcpSourceConfig('awog'), slug: 'awog' })
    expect(r.isError).toBe(true)
    expect(r.text).toContain('awog')
    expect(r.text).toContain('reserved')
    expect(await sourceDirs()).toEqual([])
  })

  it('slug trùng tên dành riêng vẫn qua khi id tự sinh mang hậu tố hex', async () => {
    // Bỏ `id` ⇒ core tự sinh; với source mới nó là `<slug>_<hex>` nên KHÔNG dính.
    const raw = mcpSourceConfig('awogwiki')
    delete raw.id
    const r = await runSourceCreate(raw)
    expect(r.isError).toBe(false)
    // Thư mục theo slug vẫn là `awogwiki`, nhưng id — thứ làm khoá mcpServers —
    // đã có hậu tố hex nên không đụng server của AWOG.
    const cfg = JSON.parse(
      await readFile(join(home, '.awog', 'sources', 'awogwiki', 'config.json'), 'utf8'),
    ) as { id: string }
    expect(cfg.id).toMatch(/^awogwiki_[0-9a-f]{8}$/)
  })
})

describe('migration MCP cũ → source đổi tên id trùng', () => {
  it('id di trú trùng tên dành riêng được đổi, id thường giữ nguyên', async () => {
    const base = join(home, '.awog')
    await mkdir(join(base, 'mcp-servers'), { recursive: true })
    await writeFile(
      join(base, 'mcp-servers', 'awogterm.json'),
      JSON.stringify({
        id: 'awogterm',
        name: 'Legacy terminal bridge',
        transport: 'stdio',
        command: 'node',
        enabled: true,
        timeoutMs: 30_000,
        trust: 'prompt',
        autoStart: false,
      }),
    )
    await writeFile(
      join(base, 'mcp-servers', 'notion.json'),
      JSON.stringify({
        id: 'notion',
        name: 'Notion',
        transport: 'stdio',
        command: 'node',
        enabled: true,
        timeoutMs: 30_000,
        trust: 'prompt',
        autoStart: false,
      }),
    )

    await migrateMcpServersToSources(base)

    const sources = await listSources()
    const byName = new Map(sources.map((s) => [s.name, s]))
    // Đổi tên, chứ không bỏ qua: source vẫn còn, chỉ mang id khác.
    expect(byName.get('Legacy terminal bridge')?.id).toBe('awogterm-mcp')
    expect(byName.get('Legacy terminal bridge')?.slug).toBe('awogterm-mcp')
    // `provider` giữ id cũ để còn lần ngược được về nơi nó đến.
    expect(byName.get('Legacy terminal bridge')?.provider).toBe('awogterm')
    // Id không trùng thì KHÔNG được đụng vào — đó là thứ giữ keychain `<id>/<key>`
    // còn resolve được sau di trú.
    expect(byName.get('Notion')?.id).toBe('notion')
  })

  it('migratedSourceId là hàm thuần, chỉ đổi đúng tên trùng', () => {
    expect(migratedSourceId('notion')).toBe('notion')
    expect(migratedSourceId('awog')).toBe('awog-mcp')
  })
})
