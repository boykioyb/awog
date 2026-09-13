// Filesystem watcher for AWOG artifact directories. Emits debounced events
// when AGENT.md / SKILL.md / sources/<slug>/config.json change so the UI can
// auto-refresh without the user clicking 🔄 (Sprint 3 C1).
//
// Watch scope (ADR 0035 — `.awog` only; `.claude`/`.agents` are import sources):
//   - User-tier:  ~/.awog/{agents,skills,sources,hooks,rules,commands}
//   - Per-project dirs (added/removed dynamically as projects come and go):
//     {project}/.awog/{agents,skills,hooks,rules,commands}
//
// Events fired (sidecar.event):
//   agents.fs-changed     — agent file added/removed/modified
//   skills.fs-changed     — skill file added/removed/modified
//   sources.fs-changed    — source config/guide/permissions file changed (ADR 0060)
//   hooks.fs-changed      — hook config file added/removed/modified
//   rules.fs-changed      — rule file added/removed/modified
//   commands.fs-changed   — slash-command file added/removed/modified
//   wiki.fs-changed       — wiki page added/removed/modified (ADR 0073)
//   memory.fs-changed     — memory fact added/removed/modified (ADR 0073)
//   infra.fs-changed      — ~/.aws/{config,credentials} changed (ADR 0088, task 0.16)
//
// Each event payload: { tier?: string, path?: string, type: 'add'|'change'|'unlink' }
// UI subscribes once and re-hydrates the matching store on event arrival.

import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { emit } from './transport/stdio.js'
import { log } from './util/logger.js'
import { awogHome, claudeHome, projectClaudeDir } from './util/path.js'
import { listProjects } from './projects/store.js'
// The wiki index is cached per turn (wiki/inject.ts). Unlike the flat config
// kinds, a wiki is EXPECTED to change outside the app — the user edits a page in
// their own editor, or a `git pull` brings new pages — so the watcher, not just
// the mutating RPCs, has to drop that cache.
import { invalidateWikiCache } from './wiki/inject.js'
import { invalidateMemoryCache } from './memory/inject.js'
// Đường dẫn hai file cấu hình AWS — lấy từ chính module đọc chúng (`infra/aws`) chứ
// không dựng lại `join(homedir(), '.aws', …)` ở đây: nó honor `AWS_CONFIG_FILE` /
// `AWS_SHARED_CREDENTIALS_FILE`, và watcher mà nhìn một chỗ còn `infra.contexts` đọc
// chỗ khác thì UI đứng im đúng lúc file đổi.
import { awsConfigPath, awsCredentialsPath } from './infra/aws/profiles.js'

const DEBOUNCE_MS = 500
const RESCAN_PROJECTS_MS = 30_000 // re-check registered projects every 30s

type WatchKind =
  | 'agents'
  | 'skills'
  | 'sources'
  | 'hooks'
  | 'rules'
  | 'commands'
  | 'wiki'
  | 'memory'
  | 'ssh-hosts'
  | 'ssh-identities'
  | 'vpn-profiles'
  | 'infra'

interface Watcher {
  close: () => Promise<void> | void
}

interface ChokidarModule {
  watch: (
    paths: string | string[],
    options: Record<string, unknown>,
  ) => Watcher & {
    on: (event: string, handler: (path: string) => void) => void
  }
}

let chokidarModule: ChokidarModule | null = null
let chokidarLoadAttempted = false

async function getChokidar(): Promise<ChokidarModule | null> {
  if (chokidarLoadAttempted) return chokidarModule
  chokidarLoadAttempted = true
  try {
    // Dynamic import + cast — chokidar is a real dep but the typings have a
    // wide surface we don't need. Keeps watcher boot resilient if dep is
    // missing.
    const mod = await import('chokidar')
    chokidarModule = mod as unknown as ChokidarModule
    return chokidarModule
  } catch (err) {
    log.warn('watcher: chokidar dynamic import failed — fs auto-refresh disabled', {
      err: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

interface DirSpec {
  kind: WatchKind
  dir: string
  // chokidar traversal depth. Omitted = the flat-config default (3).
  depth?: number
}

// agents/skills/commands live in the SHARED `.claude` home (ADR 0070) so an edit
// made in the Claude Code CLI shows up in AWOG without an import; the rest are
// AWOG-owned and stay under `.awog`.
function userDirs(): DirSpec[] {
  return [
    { kind: 'agents', dir: join(claudeHome(), 'agents') },
    { kind: 'skills', dir: join(claudeHome(), 'skills') },
    { kind: 'commands', dir: join(claudeHome(), 'commands') },
    { kind: 'sources', dir: join(awogHome(), 'sources') },
    { kind: 'hooks', dir: join(awogHome(), 'hooks') },
    { kind: 'rules', dir: join(awogHome(), 'rules') },
    { kind: 'wiki', dir: join(awogHome(), 'wiki'), depth: 6 },
    { kind: 'memory', dir: join(awogHome(), 'memory') },
    { kind: 'ssh-hosts', dir: join(awogHome(), 'ssh-hosts') },
    { kind: 'ssh-identities', dir: join(awogHome(), 'ssh-identities') },
    { kind: 'vpn-profiles', dir: join(awogHome(), 'vpn-profiles') },
    ...awsDirs(),
  ]
}

// ─── `~/.aws` (ADR 0088, task 0.16) ──────────────────────────────────────────
// `aws sso login` / `aws configure` chạy NGOÀI app đổi danh sách profile, nên UI
// phải tươi theo mà không cần reload. Đường này khác mọi kind ở trên ba điểm, và
// cả ba đều có lý do:
//
//   1. `~/.aws` nằm NGOÀI workspace ⇒ `fs.*` chặn (ADR 0022). Đây là đường đọc
//      riêng của sidecar — nhưng nó chỉ đọc TÊN ĐƯỜNG DẪN: watcher không mở file,
//      không parse, không gửi nội dung đi đâu. UI nghe `infra.fs-changed` rồi gọi
//      `infra.contexts`, nơi parser allowlist-key đã vứt secret tại chỗ (§1).
//   2. Allowlist CỨNG đúng hai file. `~/.aws` còn chứa `sso/cache/*.json` và
//      `cli/cache/*.json` — token SSO thật, xoay liên tục. Watch cả cây vừa bắn
//      event rác vừa kể cho UI biết những file đó tồn tại. `depth: 0` chặn
//      traversal xuống thư mục con, `relevantFile('infra', …)` chặn nốt phần còn
//      lại ở cùng cấp.
//   3. Watch THƯ MỤC CHA chứ không watch thẳng hai file: `aws configure` tạo
//      `credentials` khi nó chưa tồn tại, mà chokidar bỏ qua im lặng một đường dẫn
//      ENOENT (nó không quay lại xem file có xuất hiện chưa). Watch thư mục thì
//      lần tạo đầu tiên cũng là một sự kiện `add` — đã đo.
//
// Giới hạn đã biết, cố ý không vá: nếu CHÍNH `~/.aws` chưa tồn tại lúc sidecar
// khởi động thì không có gì được watch, và lần `aws configure` đầu tiên trên máy
// đó chỉ hiện sau khi khởi động lại (hoặc lần kế tiếp UI gọi `infra.contexts`).
// Vá nó nghĩa là watch cả `$HOME` — cái giá quá đắt cho một lần trong đời máy, và
// mọi watcher khác trong file này cũng đúng như vậy.
function awsWatchedFiles(): string[] {
  return [awsConfigPath(), awsCredentialsPath()].map((p) => resolve(p))
}

function awsDirs(): DirSpec[] {
  // Hai file gần như luôn cùng một thư mục; env trỏ chúng đi hai nơi thì thành hai
  // watcher. Set để trường hợp thường không dựng hai watcher trên cùng `~/.aws`.
  const dirs = new Set(awsWatchedFiles().map((f) => dirname(f)))
  return [...dirs].map((dir) => ({ kind: 'infra' as const, dir, depth: 0 }))
}

function projectDirs(projectPath: string): DirSpec[] {
  return [
    { kind: 'agents', dir: join(projectClaudeDir(projectPath), 'agents') },
    { kind: 'skills', dir: join(projectClaudeDir(projectPath), 'skills') },
    { kind: 'commands', dir: join(projectClaudeDir(projectPath), 'commands') },
    { kind: 'hooks', dir: join(projectPath, '.awog', 'hooks') },
    { kind: 'rules', dir: join(projectPath, '.awog', 'rules') },
    { kind: 'wiki', dir: join(projectPath, '.awog', 'wiki'), depth: 6 },
    { kind: 'memory', dir: join(projectPath, '.awog', 'memory') },
  ]
}

interface WatcherEntry {
  spec: DirSpec
  watcher: Watcher
}

class AwogWatcher {
  private entries: WatcherEntry[] = []

  private debouncedEmit = new Map<WatchKind, NodeJS.Timeout>()

  private trackedProjectPaths = new Set<string>()

  private rescanTimer?: NodeJS.Timeout

  private chokidar: ChokidarModule | null = null

  async start(): Promise<void> {
    this.chokidar = await getChokidar()
    if (!this.chokidar) return
    for (const spec of userDirs()) {
      this.addWatcher(spec)
    }
    await this.reconcileProjectWatchers()
    this.rescanTimer = setInterval(() => {
      void this.reconcileProjectWatchers().catch((err: unknown) => {
        log.warn('watcher: project rescan failed', {
          err: err instanceof Error ? err.message : String(err),
        })
      })
    }, RESCAN_PROJECTS_MS)
  }

  async shutdown(): Promise<void> {
    if (this.rescanTimer) clearInterval(this.rescanTimer)
    await Promise.all(this.entries.map((e) => Promise.resolve(e.watcher.close())))
    this.entries = []
  }

  private addWatcher(spec: DirSpec): void {
    if (!this.chokidar) return
    // chokidar happily watches dirs that don't exist yet (uses fs.watchFile
    // fallback), but skip ones we can short-circuit to keep the log clean.
    // A project may have no `.claude/skills` (or no `.awog/rules`) yet — we
    // want to know if one appears later, so still register.
    try {
      const watcher = this.chokidar.watch(spec.dir, {
        ignoreInitial: true,
        // Flat kinds: <id>/AGENT.md or <id>/SKILL.md or <id>.md. A wiki is a real
        // tree, so it declares its own depth (ADR 0073 caps slugs at 5 levels).
        depth: spec.depth ?? 3,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
        followSymlinks: false,
      })
      const onChange = (path: string, type: 'add' | 'change' | 'unlink') => {
        // Filter: only fire for files we'd actually parse. Anything else
        // (.DS_Store, lock files, sibling images) is irrelevant.
        if (!relevantFile(spec.kind, path)) return
        if (spec.kind === 'wiki') invalidateWikiCache()
        if (spec.kind === 'memory') invalidateMemoryCache()
        this.scheduleEmit(spec.kind, { dir: spec.dir, path, type })
      }
      watcher.on('add', (p: string) => onChange(p, 'add'))
      watcher.on('change', (p: string) => onChange(p, 'change'))
      watcher.on('unlink', (p: string) => onChange(p, 'unlink'))
      watcher.on('error', (err: unknown) => {
        log.warn('watcher: chokidar error', {
          dir: spec.dir,
          err: err instanceof Error ? err.message : String(err),
        })
      })
      this.entries.push({ spec, watcher })
    } catch (err) {
      log.warn('watcher: failed to watch dir', {
        dir: spec.dir,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  private scheduleEmit(
    kind: WatchKind,
    payload: { dir: string; path: string; type: 'add' | 'change' | 'unlink' },
  ): void {
    // Coalesce multiple file events into a single UI re-hydrate. We don't
    // need per-file granularity in the event — the UI re-runs the full
    // hydrate RPC which is cheap.
    const prev = this.debouncedEmit.get(kind)
    if (prev) clearTimeout(prev)
    this.debouncedEmit.set(
      kind,
      setTimeout(() => {
        emit(`${kind}.fs-changed`, payload)
        this.debouncedEmit.delete(kind)
      }, DEBOUNCE_MS),
    )
  }

  private async reconcileProjectWatchers(): Promise<void> {
    let projects: { path: string }[] = []
    try {
      projects = await listProjects()
    } catch {
      // Best-effort — projects index unreadable means no project-tier
      // watchers, but user-tier still works.
      return
    }
    const currentPaths = new Set(projects.map((p) => p.path).filter((p) => existsSync(p)))

    // Remove watchers for projects that no longer exist.
    const toClose = this.entries.filter(
      (e) =>
        (e.spec.kind === 'agents' ||
          e.spec.kind === 'skills' ||
          e.spec.kind === 'hooks' ||
          e.spec.kind === 'rules' ||
          e.spec.kind === 'commands' ||
          e.spec.kind === 'wiki' ||
          e.spec.kind === 'memory') &&
        isProjectSubdir(e.spec.dir) &&
        !pathRegistered(e.spec.dir, currentPaths),
    )
    for (const entry of toClose) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.resolve(entry.watcher.close())
      this.entries = this.entries.filter((e) => e !== entry)
    }

    // Add watchers for new projects.
    for (const projectPath of currentPaths) {
      if (this.trackedProjectPaths.has(projectPath)) continue
      this.trackedProjectPaths.add(projectPath)
      for (const spec of projectDirs(projectPath)) {
        this.addWatcher(spec)
      }
    }
    // Drop tracked paths whose project is gone.
    for (const path of [...this.trackedProjectPaths]) {
      if (!currentPaths.has(path)) {
        this.trackedProjectPaths.delete(path)
      }
    }
  }
}

function relevantFile(kind: WatchKind, path: string): boolean {
  const lower = path.toLowerCase()
  if (lower.endsWith('/.ds_store')) return false
  if (kind === 'agents') return lower.endsWith('.md') || lower.endsWith('/agent.md')
  if (kind === 'skills') return lower.endsWith('skill.md')
  // sources: a per-source folder file we parse — config.json / guide.md /
  // permissions.json (atomic .tmp.<pid> writes are filtered by the suffix check).
  if (kind === 'sources') {
    return (
      lower.endsWith('/config.json') ||
      lower.endsWith('/guide.md') ||
      lower.endsWith('/permissions.json')
    )
  }
  // hooks: a hook config .json; never the run-log dir (.runs/*.jsonl) which
  // churns on every hook run, and never the atomic .json.tmp.<pid> writes.
  if (kind === 'hooks') return lower.endsWith('.json') && !lower.includes('/.runs/')
  // rules: a rule Markdown file (atomic .md.tmp.<pid> writes are filtered out).
  if (kind === 'rules') return lower.endsWith('.md')
  // commands: a slash-command Markdown file (atomic .md.tmp.<pid> filtered out).
  if (kind === 'commands') return lower.endsWith('.md')
  // wiki: any page in the tree (nested, unlike the flat kinds above); atomic
  // .md.tmp.<pid> writes are filtered by the suffix check.
  if (kind === 'wiki') return lower.endsWith('.md')
  // memory: one fact per .md file (atomic .md.tmp.<pid> writes filtered out).
  if (kind === 'memory') return lower.endsWith('.md')
  // ssh/vpn: a config .json (atomic .json.tmp.<pid> filtered out).
  if (kind === 'ssh-hosts' || kind === 'ssh-identities' || kind === 'vpn-profiles') {
    return lower.endsWith('.json') && !lower.includes('.tmp.')
  }
  // infra: ĐÚNG hai file cấu hình AWS, so bằng đường dẫn đầy đủ. So `lower` (đã
  // hạ chữ) sẽ nhận nhầm một `~/.aws/Config` khác trên filesystem phân biệt hoa
  // thường, nên nhánh này so nguyên văn với allowlist.
  if (kind === 'infra') return awsWatchedFiles().includes(resolve(path))
  return false
}

function isProjectSubdir(dir: string): boolean {
  // Project-tier dirs live under {project}/.awog (hooks, rules) or
  // {project}/.claude (agents, skills, commands — ADR 0070). The matching
  // user-tier dirs (direct children of ~/.awog or the Claude home) are NOT
  // projects.
  const home = homedir()
  if (dir.startsWith(`${home}/.awog/`)) return false
  if (dir.startsWith(`${claudeHome()}/`)) return false
  return dir.includes('/.awog/') || dir.includes('/.claude/')
}

function pathRegistered(dir: string, projectPaths: Set<string>): boolean {
  for (const p of projectPaths) {
    if (dir.startsWith(`${p}/`)) return true
  }
  return false
}

export const awogWatcher = new AwogWatcher()
