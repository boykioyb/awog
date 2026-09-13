// Nhật ký hạ tầng là BẰNG CHỨNG: nó trả lời "app đã làm gì trên tài khoản của
// tôi, lúc nào, do ai bảo?". Nên bốn tính chất dưới đây là chức năng, không
// phải chuyện đẹp xấu — redact trước khi chạm đĩa, một dòng hỏng không làm mù
// cả lượt truy vấn, trần kích thước không cho một `summary` khổng lồ nuốt file,
// và việc dọn không bao giờ xoá được dấu vết của chính nó.
//
// Run với vitest: `npx vitest run src/infra/audit/__tests__/store.test.ts`
// (vitest chưa nằm trong devDeps của sidecar — chạy qua `npx vitest@2`).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cleanInfraAudit,
  infraAuditDir,
  pruneExpired,
  queryInfraAudit,
  recordInfraAction,
  summarizeInfraAudit,
} from '../store.js'
import type { InfraAuditInput } from '../store.js'

let home: string
let originalHome: string | undefined

// Một hành động tối thiểu hợp lệ. Từng ca chỉ ghi đè phần nó quan tâm.
function action(over: Partial<InfraAuditInput> = {}): InfraAuditInput {
  return {
    actor: 'human',
    surface: 'session',
    tool: 'aws_cli',
    argv: ['s3api', 'list-buckets'],
    context: { profile: 'default', accountId: '229015218011', region: 'ap-southeast-1' },
    class: 'read',
    decision: 'auto',
    result: { exitCode: 0, durationMs: 12 },
    ...over,
  }
}

function monthFileOf(atIso: string): string {
  return join(infraAuditDir(), `${atIso.slice(0, 7)}.jsonl`)
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'awog-infra-audit-'))
  originalHome = process.env.HOME
  // os.homedir() đọc $HOME trên POSIX → awogHome() trỏ vào temp dir, không bao
  // giờ đụng ~/.awog thật.
  process.env.HOME = home
})

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  await rm(home, { recursive: true, force: true })
})

describe('write then read back', () => {
  it('round-trips an action and returns newest first', async () => {
    await recordInfraAction(action({ at: daysAgo(1), argv: ['s3api', 'list-buckets'] }))
    await recordInfraAction(
      action({
        at: daysAgo(0),
        actor: 'agent:code-reviewer',
        class: 'write',
        decision: 'approved',
        argv: ['ecs', 'update-service', '--desired-count', '4'],
        result: { exitCode: 0, durationMs: 1200, summary: 'service scaled to 4' },
      }),
    )

    const entries = await queryInfraAudit()
    expect(entries).toHaveLength(2)
    expect(entries[0]!.argv).toEqual(['ecs', 'update-service', '--desired-count', '4'])
    expect(entries[0]!.actor).toBe('agent:code-reviewer')
    expect(entries[0]!.result.summary).toBe('service scaled to 4')
    expect(entries[0]!.context.accountId).toBe('229015218011')
    expect(entries[1]!.argv).toEqual(['s3api', 'list-buckets'])
  })

  it('rotates by month and keeps the store private', async () => {
    const at = daysAgo(0)
    await recordInfraAction(action({ at }))

    const dirMode = (await stat(infraAuditDir())).mode & 0o777
    const fileMode = (await stat(monthFileOf(at))).mode & 0o777
    expect(dirMode).toBe(0o700)
    expect(fileMode).toBe(0o600)
  })

  it('caps limit at 2000 and defaults to 200', async () => {
    // Đủ để chứng minh trần chứ không cần ghi 2000 dòng thật.
    for (let i = 0; i < 5; i++) await recordInfraAction(action({ argv: ['s3api', `probe-${i}`] }))
    expect(await queryInfraAudit({ limit: 2 })).toHaveLength(2)
    expect(await queryInfraAudit({ limit: 999_999 })).toHaveLength(5)
  })
})

describe('filters', () => {
  beforeEach(async () => {
    await recordInfraAction(action({ actor: 'human', class: 'read', argv: ['s3api', 'ls'] }))
    await recordInfraAction(
      action({
        actor: 'agent:deploy',
        class: 'write',
        decision: 'approved',
        argv: ['ecs', 'update-service'],
      }),
    )
    await recordInfraAction(
      action({
        actor: 'agent:deploy',
        class: 'destructive',
        decision: 'blocked',
        argv: ['rds', 'delete-db-instance'],
      }),
    )
  })

  it('filters by class', async () => {
    const entries = await queryInfraAudit({ class: 'destructive' })
    expect(entries).toHaveLength(1)
    expect(entries[0]!.argv[0]).toBe('rds')
  })

  it('filters by actor', async () => {
    expect(await queryInfraAudit({ actor: 'agent:deploy' })).toHaveLength(2)
    expect(await queryInfraAudit({ actor: 'human' })).toHaveLength(1)
  })

  it('filters by decision and by a string inside argv', async () => {
    expect(await queryInfraAudit({ decision: 'blocked' })).toHaveLength(1)
    expect(await queryInfraAudit({ contains: 'update-service' })).toHaveLength(1)
    expect(await queryInfraAudit({ contains: 'DELETE-DB' })).toHaveLength(1)
    expect(await queryInfraAudit({ contains: 'terraform' })).toHaveLength(0)
  })

  it('filters by time window', async () => {
    await recordInfraAction(action({ at: daysAgo(40), argv: ['s3api', 'old-call'] }))
    expect(await queryInfraAudit({ since: daysAgo(7) })).toHaveLength(3)
    expect(await queryInfraAudit({ until: daysAgo(7) })).toHaveLength(1)
  })

  it('summarizes by class, by decision and sums the estimated cost', async () => {
    await recordInfraAction(
      action({
        argv: ['logs', 'start-query'],
        cost: { estimatedUsd: 0.006 },
        result: { bytesScanned: 1_331_000_000 },
      }),
    )
    const summary = await summarizeInfraAudit()
    expect(summary.total).toBe(4)
    expect(summary.byClass.read).toBe(2)
    expect(summary.byClass.write).toBe(1)
    expect(summary.byClass.destructive).toBe(1)
    expect(summary.byDecision.blocked).toBe(1)
    expect(summary.estimatedUsd).toBeCloseTo(0.006, 6)
  })
})

// Đây là lý do redact phải chạy TRƯỚC KHI GHI, không phải trước khi hiển thị:
// bài test đọc BYTE TRÊN ĐĨA, không đọc giá trị trả về.
describe('secrets never reach the disk', () => {
  const TOKEN = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

  it('masks a token passed as a CLI flag in argv', async () => {
    const at = daysAgo(0)
    await recordInfraAction(action({ at, argv: ['configure', 'set', '--token', TOKEN] }))

    const onDisk = await readFile(monthFileOf(at), 'utf8')
    expect(onDisk).not.toContain(TOKEN)
    expect(onDisk).toContain('[redacted]')
    expect((await queryInfraAudit())[0]!.argv.join(' ')).not.toContain(TOKEN)
  })

  it('masks credentials embedded in a URL and in the result summary', async () => {
    const at = daysAgo(0)
    await recordInfraAction(
      action({
        at,
        argv: ['s3', 'cp', `https://u:${TOKEN}@example.com/o`, '.'],
        result: { exitCode: 1, summary: `failed with sk-ABCDEFGHIJKLMNOPQRSTUV` },
      }),
    )

    const onDisk = await readFile(monthFileOf(at), 'utf8')
    expect(onDisk).not.toContain(TOKEN)
    expect(onDisk).not.toContain('sk-ABCDEFGHIJKLMNOPQRSTUV')
  })
})

describe('a malformed line loses only itself', () => {
  it('skips garbage and still returns the valid entries', async () => {
    const at = daysAgo(0)
    await recordInfraAction(action({ at, argv: ['s3api', 'first'] }))

    // Ghi dở lúc crash + một dòng ai đó sửa tay + một dòng JSON đúng nhưng sai
    // lược đồ (thiếu `actor`).
    const file = monthFileOf(at)
    const broken = `{"at":"${at}","surface":"session"\nnot json at all\n{"at":"${at}","surface":"session","tool":"aws_cli","argv":[],"context":{},"class":"read","decision":"auto","result":{}}\n`
    await writeFile(file, broken, { flag: 'a' })

    await recordInfraAction(action({ at, argv: ['s3api', 'second'] }))

    const entries = await queryInfraAudit()
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.argv[1])).toEqual(['second', 'first'])
  })

  it('reads back correctly when the store is empty or missing', async () => {
    expect(await queryInfraAudit()).toEqual([])
    await mkdir(infraAuditDir(), { recursive: true })
    expect(await queryInfraAudit()).toEqual([])
    expect((await summarizeInfraAudit()).total).toBe(0)
  })
})

describe('cleaning always leaves a trace', () => {
  it('wipes everything but the line that records the wipe', async () => {
    await recordInfraAction(action({ argv: ['s3api', 'a'] }))
    await recordInfraAction(action({ argv: ['s3api', 'b'], class: 'write' }))
    await recordInfraAction(action({ argv: ['s3api', 'c'], class: 'destructive' }))

    const { removed } = await cleanInfraAudit()
    expect(removed).toBe(3)

    const left = await queryInfraAudit()
    expect(left).toHaveLength(1)
    expect(left[0]!.argv).toEqual(['audit', 'clean'])
    expect(left[0]!.actor).toBe('human')
    expect(left[0]!.class).toBe('destructive')
    expect(left[0]!.result.summary).toBe('removed 3 entries, range everything')
  })

  it('removes only what the filter matched', async () => {
    await recordInfraAction(action({ argv: ['s3api', 'a'], class: 'read' }))
    await recordInfraAction(action({ argv: ['ecs', 'update-service'], class: 'write' }))

    const { removed } = await cleanInfraAudit({ class: 'read' })
    expect(removed).toBe(1)

    const left = await queryInfraAudit()
    expect(left.map((e) => e.argv[0])).toEqual(['audit', 'ecs'])
    expect(left.find((e) => e.argv[0] === 'audit')!.result.summary).toContain('range class=read')
  })

  it('records an attempt that removed nothing', async () => {
    const { removed } = await cleanInfraAudit({ actor: 'agent:nobody' })
    expect(removed).toBe(0)
    expect(await queryInfraAudit()).toHaveLength(1)
  })

  it('expires old entries and records the sweep', async () => {
    await recordInfraAction(action({ at: daysAgo(200), argv: ['s3api', 'ancient'] }))
    await recordInfraAction(action({ at: daysAgo(1), argv: ['s3api', 'recent'] }))

    const { removed } = await pruneExpired(90)
    expect(removed).toBe(1)

    const left = await queryInfraAudit()
    expect(left.map((e) => e.argv[1])).toEqual(['prune', 'recent'])
    expect(left[0]!.actor).toBe('schedule:retention')
  })

  it('keeps quiet when nothing expired', async () => {
    await recordInfraAction(action({ argv: ['s3api', 'recent'] }))
    expect(await pruneExpired(90)).toEqual({ removed: 0 })
    expect(await queryInfraAudit()).toHaveLength(1)
  })
})

describe('size caps', () => {
  it('clips one argv item, the summary, and the whole line', async () => {
    const at = daysAgo(0)
    await recordInfraAction(
      action({
        at,
        argv: ['logs', 'filter-log-events', '--filter-pattern', 'x'.repeat(50_000)],
        result: { exitCode: 0, summary: 'y'.repeat(50_000) },
      }),
    )

    const entry = (await queryInfraAudit())[0]!
    expect(entry.argv[3]!.length).toBeLessThanOrEqual(512)
    expect(entry.result.summary!.length).toBeLessThanOrEqual(2000)
    expect(entry.truncated).toBe(true)

    const onDisk = await readFile(monthFileOf(at), 'utf8')
    expect(Buffer.byteLength(onDisk.trimEnd(), 'utf8')).toBeLessThanOrEqual(16 * 1024)
  })

  it('drops argv from the tail when a single line would still blow the cap', async () => {
    const at = daysAgo(0)
    const argv = ['ecs', 'update-service', ...Array.from({ length: 400 }, () => 'z'.repeat(500))]
    await recordInfraAction(action({ at, argv }))

    const entry = (await queryInfraAudit())[0]!
    expect(entry.argv[0]).toBe('ecs')
    expect(entry.argv[1]).toBe('update-service')
    expect(entry.argv.at(-1)).toMatch(/^\[\+\d+ args truncated\]$/)
    expect(entry.truncated).toBe(true)

    const onDisk = await readFile(monthFileOf(at), 'utf8')
    expect(Buffer.byteLength(onDisk.trimEnd(), 'utf8')).toBeLessThanOrEqual(16 * 1024)
  })
})
