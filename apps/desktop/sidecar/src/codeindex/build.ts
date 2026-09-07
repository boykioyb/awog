// Dựng chỉ mục — TĂNG DẦN, có ngân sách, không bao giờ quét lại toàn bộ nếu
// không cần.
//
// Cách liệt kê file mượn nguyên của context/repo-scan.ts: `git ls-files --cached
// --others --exclude-standard -z` là đường nhanh và là cách duy nhất tôn trọng
// `.gitignore` mà không tự viết lại parser ignore; ngoài repo git thì đi bộ có
// chặn với SKIP_DIRS dùng chung. Khác biệt duy nhất: ở đây chỉ giữ file NGUỒN.
//
// "Tăng dần" = so mtime + size với bản đã lập chỉ mục. File không đổi thì tái
// dùng nguyên bản ghi cũ; chỉ file đổi mới bị parse lại. Nhờ vậy lần gọi thứ hai
// trong cùng một lượt chat gần như miễn phí.
//
// BẢO MẬT: mọi lần đọc đi qua assertInsideWorkspace (invariant #2); đi bộ KHÔNG
// theo symlink nên không thoát ra ngoài gốc. Nội dung file là L1 — module này
// chỉ TRÍCH toạ độ (path/line/tên), không bao giờ tự thực thi thứ đọc được.

import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'
import { assertInsideWorkspace } from '../git/path-sanitize.js'
import { runGit } from '../git/runner.js'
import { SKIP_DIRS } from '../fs/skip-dirs.js'
import { log } from '../util/logger.js'
import { parseSource } from './parser.js'
import { createResolver } from './resolver.js'
import { indexBytesOnDisk, loadIndex, saveIndex } from './store.js'
import {
  BUILD_DEADLINE_MS,
  CODE_INDEX_SCHEMA_VERSION,
  MAX_FILE_BYTES,
  MAX_INDEXED_FILES,
  type CodeFileIndex,
  type CodeIndex,
  type CodeIndexStats,
} from './types.js'

const SOURCE_EXT_RE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|vue)$/i
// File đã minify không có gì để đọc và làm phình chỉ mục.
const MINIFIED_RE = /\.min\.[cm]?js$/i
const MAX_WALK_DEPTH = 8
// Số file đọc song song. Cao hơn không nhanh hơn (I/O đĩa), thấp hơn thì lãng phí.
const READ_CONCURRENCY = 12
// Trong khoảng này, một lần gọi tiếp theo dùng lại bản trong RAM mà không stat
// lại cả cây. Đủ ngắn để model sửa file rồi hỏi lại vẫn thấy đúng.
const MEMO_TTL_MS = 10_000

export interface BuildResult {
  parsed: number
  reused: number
  skipped: number
  durationMs: number
  deadlineHit: boolean
  truncated: boolean
  source: 'git' | 'walk'
}

interface Memo {
  index: CodeIndex
  checkedAt: number
}

// Số root giữ chỉ mục trong RAM. Mỗi bản ~vài MB; sidecar sống cả phiên làm việc
// và người dùng mở nhiều project, nên Map này phải có trần chứ không được lớn mãi.
const MAX_MEMO_ROOTS = 4

const memo = new Map<string, Memo>()

// Giữ MAX_MEMO_ROOTS bản mới nhất, bỏ bản cũ nhất (LRU theo lần kiểm gần nhất).
function rememberIndex(root: string, index: CodeIndex): void {
  memo.set(root, { index, checkedAt: Date.now() })
  if (memo.size <= MAX_MEMO_ROOTS) return
  let oldestKey: string | null = null
  let oldestAt = Number.POSITIVE_INFINITY
  for (const [key, entry] of memo) {
    if (entry.checkedAt < oldestAt) {
      oldestAt = entry.checkedAt
      oldestKey = key
    }
  }
  if (oldestKey !== null) memo.delete(oldestKey)
}
// Hai lời gọi tool cùng lúc trên một root phải chia nhau MỘT lần dựng, không thì
// cả hai cùng parse cả cây rồi ghi đè nhau.
const inFlight = new Map<string, Promise<{ index: CodeIndex; result: BuildResult }>>()

// Chỉ mục hoá thư mục nhà là một cái bẫy: session không gắn project chạy với
// cwd = homedir (xem project_no_project_session_cwd_default), và ở đó "toàn bộ
// mã nguồn" là hàng trăm nghìn file của mọi repo người dùng từng clone.
function assertIndexableRoot(root: string): void {
  if (!isAbsolute(root)) throw new Error('code index root must be an absolute path')
  const abs = resolve(root)
  if (abs === resolve(homedir())) {
    throw new Error(
      'refusing to index the home directory — open a project first so the index has a real repo root',
    )
  }
}

async function listViaGit(root: string): Promise<string[] | null> {
  try {
    const res = await runGit(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      throwOnNonZero: false,
    })
    if (res.code !== 0) return null
    const files: string[] = []
    for (const rel of res.stdout.split('\0')) {
      if (rel === '' || !SOURCE_EXT_RE.test(rel) || MINIFIED_RE.test(rel)) continue
      files.push(rel)
      if (files.length >= MAX_INDEXED_FILES) break
    }
    return files
  } catch {
    return null
  }
}

async function listViaWalk(root: string): Promise<string[]> {
  const files: string[] = []
  const queue: { rel: string; depth: number }[] = [{ rel: '', depth: 0 }]
  while (queue.length > 0 && files.length < MAX_INDEXED_FILES) {
    const node = queue.shift()
    if (!node) break
    const absDir = assertInsideWorkspace(root, node.rel || '.')
    let dirents
    try {
      dirents = await readdir(absDir, { withFileTypes: true }) // eslint-disable-line no-await-in-loop
    } catch {
      continue
    }
    for (const dirent of dirents) {
      if (dirent.isSymbolicLink()) continue // không bao giờ theo symlink
      const childRel = node.rel ? `${node.rel}/${dirent.name}` : dirent.name
      if (dirent.isDirectory()) {
        if (!SKIP_DIRS.has(dirent.name) && node.depth + 1 <= MAX_WALK_DEPTH) {
          queue.push({ rel: childRel, depth: node.depth + 1 })
        }
        continue
      }
      if (!dirent.isFile()) continue
      if (!SOURCE_EXT_RE.test(dirent.name) || MINIFIED_RE.test(dirent.name)) continue
      files.push(childRel)
      if (files.length >= MAX_INDEXED_FILES) break
    }
  }
  return files
}

async function parseOne(root: string, rel: string): Promise<CodeFileIndex | null> {
  let abs: string
  try {
    abs = assertInsideWorkspace(root, rel)
  } catch {
    log.warn('codeindex: refusing to read outside root', { rel })
    return null
  }
  try {
    const st = await stat(abs)
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null
    const buf = await readFile(abs)
    // Một byte NUL từng làm ripgrep coi cả file là nhị phân rồi BỎ QUA IM LẶNG.
    // Ở đây ta vẫn parse: NUL trong nguồn TS là rác biên tập, không phải tín
    // hiệu "file nhị phân". Đó chính là loại chỗ mù mà chỉ mục này để bù.
    const text = buf.toString('utf8')
    const parsed = parseSource(text, rel)
    return {
      path: rel,
      mtimeMs: st.mtimeMs,
      size: st.size,
      decls: parsed.decls,
      imports: parsed.imports,
      refs: parsed.refs,
      partial: parsed.partial,
    }
  } catch {
    return null
  }
}

// Gắn `target` cho mọi import trỏ vào file trong repo.
function resolveTargets(files: CodeFileIndex[]): void {
  const resolver = createResolver(files.map((f) => f.path))
  for (const file of files) {
    for (const imp of file.imports) {
      const target = resolver.resolve(file.path, imp.spec)
      imp.target = target ?? undefined
    }
  }
}

async function build(root: string, previous: CodeIndex | null): Promise<{
  index: CodeIndex
  result: BuildResult
}> {
  const started = Date.now()
  const deadline = started + BUILD_DEADLINE_MS
  const fromGit = await listViaGit(root)
  const paths = fromGit ?? (await listViaWalk(root))
  const source: 'git' | 'walk' = fromGit ? 'git' : 'walk'

  const old = new Map((previous?.files ?? []).map((f) => [f.path, f]))
  const kept: CodeFileIndex[] = []
  const todo: string[] = []
  let reused = 0
  let skipped = 0

  // Bước 1: stat song song để biết file nào thực sự đổi.
  for (let i = 0; i < paths.length; i += READ_CONCURRENCY) {
    const batch = paths.slice(i, i + READ_CONCURRENCY)
    // eslint-disable-next-line no-await-in-loop
    const stats = await Promise.all(
      batch.map(async (rel) => {
        try {
          return { rel, st: await stat(assertInsideWorkspace(root, rel)) }
        } catch {
          return { rel, st: null }
        }
      }),
    )
    for (const { rel, st } of stats) {
      if (!st || !st.isFile()) {
        skipped++
        continue
      }
      if (st.size > MAX_FILE_BYTES) {
        skipped++
        continue
      }
      const before = old.get(rel)
      if (before && before.mtimeMs === st.mtimeMs && before.size === st.size) {
        kept.push(before)
        reused++
        continue
      }
      todo.push(rel)
    }
  }

  // Bước 2: parse phần đã đổi, dừng khi hết ngân sách thời gian.
  let parsed = 0
  let deadlineHit = false
  for (let i = 0; i < todo.length; i += READ_CONCURRENCY) {
    if (Date.now() > deadline) {
      deadlineHit = true
      break
    }
    const batch = todo.slice(i, i + READ_CONCURRENCY)
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(batch.map((rel) => parseOne(root, rel)))
    for (const file of results) {
      if (!file) {
        skipped++
        continue
      }
      kept.push(file)
      parsed++
    }
  }
  // Chạm ngân sách: giữ bản ghi CŨ của phần chưa parse kịp, để câu trả lời vẫn
  // có gì đó thay vì trống — nhưng mtime vẫn lệch nên lần sau nó được làm tiếp.
  if (deadlineHit) {
    const done = new Set(kept.map((f) => f.path))
    for (const rel of todo) {
      const before = old.get(rel)
      if (before && !done.has(rel)) kept.push(before)
    }
  }

  kept.sort((a, b) => a.path.localeCompare(b.path))
  resolveTargets(kept)

  const index: CodeIndex = {
    version: CODE_INDEX_SCHEMA_VERSION,
    root,
    builtAt: Date.now(),
    files: kept,
    skipped,
    truncated: paths.length >= MAX_INDEXED_FILES,
    source,
  }
  await saveIndex(index).catch((err: unknown) => {
    log.warn('codeindex: failed to save index', {
      root,
      err: err instanceof Error ? err.message : String(err),
    })
    return 0
  })

  return {
    index,
    result: {
      parsed,
      reused,
      skipped,
      durationMs: Date.now() - started,
      deadlineHit,
      truncated: index.truncated,
      source,
    },
  }
}

// Điểm vào duy nhất: trả về chỉ mục đã cập nhật cho `root`, dựng lại tăng dần
// nếu cần. `force` bỏ qua cả bộ nhớ đệm RAM lẫn bản trên đĩa.
export async function ensureIndex(
  root: string,
  opts: { force?: boolean } = {},
): Promise<{ index: CodeIndex; result: BuildResult }> {
  assertIndexableRoot(root)
  const abs = resolve(root)

  if (!opts.force) {
    const cached = memo.get(abs)
    if (cached && Date.now() - cached.checkedAt < MEMO_TTL_MS) {
      return {
        index: cached.index,
        result: {
          parsed: 0,
          reused: cached.index.files.length,
          skipped: cached.index.skipped,
          durationMs: 0,
          deadlineHit: false,
          truncated: cached.index.truncated,
          source: cached.index.source,
        },
      }
    }
  }

  const running = inFlight.get(abs)
  if (running && !opts.force) return running

  const task = (async () => {
    const previous = opts.force ? null : (memo.get(abs)?.index ?? (await loadIndex(abs)))
    const built = await build(abs, previous)
    rememberIndex(abs, built.index)
    return built
  })().finally(() => {
    inFlight.delete(abs)
  })
  inFlight.set(abs, task)
  return task
}

export async function indexStats(index: CodeIndex): Promise<CodeIndexStats> {
  let decls = 0
  let refNames = 0
  let imports = 0
  let internalEdges = 0
  let unresolvedInternal = 0
  for (const file of index.files) {
    decls += file.decls.length
    refNames += Object.keys(file.refs).length
    for (const imp of file.imports) {
      imports++
      if (imp.target) internalEdges++
      else if (!imp.external) unresolvedInternal++
    }
  }
  return {
    files: index.files.length,
    decls,
    refNames,
    imports,
    internalEdges,
    unresolvedInternal,
    skipped: index.skipped,
    truncated: index.truncated,
    builtAt: index.builtAt,
    bytesOnDisk: await indexBytesOnDisk(index.root),
  }
}

// Chỉ dùng trong test: xoá bộ nhớ đệm RAM để mỗi ca test bắt đầu sạch.
export function resetIndexMemo(): void {
  memo.clear()
  inFlight.clear()
}
