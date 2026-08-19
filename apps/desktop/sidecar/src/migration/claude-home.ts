// One-time boot migration (ADR 0070): AWOG used to keep its own copy of the
// three config kinds Claude Code has a native on-disk layout for, plus an
// isolated SDK config dir. Both are folded into the shared Claude home:
//
//   ~/.awog/{skills,agents,commands}       → <claudeHome>/{skills,agents,commands}
//   {project}/.awog/{skills,agents,commands} → {project}/.claude/{...}
//   ~/.awog/claude-sdk/projects/*          → <claudeHome>/projects/*
//
// and the emptied legacy dirs are removed, so there is exactly ONE home per kind
// afterwards. `.awog` keeps everything AWOG alone owns (sessions, credentials,
// projects, workflows, sources, hooks, rules, ssh/vpn, settings).
//
// Safety contract:
//   - MOVE, never copy-and-hope: an entry lands in the new home or stays put.
//   - The destination ALWAYS wins a name clash — it is the copy the Claude Code
//     CLI has been reading and writing. The legacy entry is only deleted when it
//     is byte-identical; when it differs it is parked under
//     ~/.awog/migrated-conflicts/<kind>/<tier>/<id> so no edit is ever destroyed.
//     <tier> is 'global' or the project folder's name: the SAME id routinely
//     exists in several tiers (one standard skill set copied into every project),
//     and a park path keyed by <kind>/<id> alone let only the first tier land.
//   - IDEMPOTENT by construction: the source dirs are gone after a successful
//     run, so later boots find nothing to do. No done-flag to get out of sync.
//   - BEST-EFFORT: any failure is logged and skipped. A migration must never
//     stop the sidecar from starting.

import { readdir, readFile, rename, rm, mkdir, stat, cp } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { awogHome, claudeHome, projectClaudeDir } from '../util/path.js'
import { log } from '../util/logger.js'
import { listProjects } from '../projects/store.js'

// The kinds that move. Anything not listed here stays in `.awog` — hooks live in
// a settings.json array upstream and rules have no Claude Code dir equivalent,
// so neither has a shared home to move into.
const SHARED_KINDS = ['skills', 'agents', 'commands'] as const

interface FsError extends Error {
  code?: string
}

function errCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null ? (err as FsError).code : undefined
}

const MAX_PARK_SLOTS = 99

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

// Move that survives a cross-device source dir (~/.awog and ~/.claude are
// normally the same volume, but CLAUDE_CONFIG_DIR can point anywhere).
async function movePath(from: string, to: string): Promise<void> {
  try {
    await rename(from, to)
  } catch (err) {
    if (errCode(err) !== 'EXDEV') throw err
    await cp(from, to, { recursive: true, force: true })
    await rm(from, { recursive: true, force: true })
  }
}

// Move `from` to `preferredTo`, or to the first free `preferredTo-N` if that name
// is taken; returns where it landed.
//
// Why this is not a plain rename: rename() onto an existing NON-EMPTY directory
// fails with ENOTEMPTY. That is precisely how the first cut of this migration
// stranded every project-tier entry whose id had already been parked by the
// global tier — the park slot was keyed by <kind>/<id>, so the second tier to
// reach the same id could never land, its `.awog` dir stayed non-empty, and the
// run retried and re-failed on every boot. Never merge into an occupied slot: a
// parked copy can be the only surviving version of the user's edit.
async function moveToFreeSlot(from: string, preferredTo: string): Promise<string> {
  for (let n = 1; n <= MAX_PARK_SLOTS; n += 1) {
    const to = n === 1 ? preferredTo : `${preferredTo}-${n}`
    // eslint-disable-next-line no-await-in-loop
    if (await pathExists(to)) continue
    // eslint-disable-next-line no-await-in-loop
    await movePath(from, to)
    return to
  }
  throw new Error(`no free park slot for ${preferredTo}`)
}

// Readable, filesystem-safe label for the tier an entry came from, so a parked
// copy is traceable to the project that owned it. Deliberately the folder name
// rather than a hash of the path — the user has to find their file in here. Two
// projects sharing a basename are separated by moveToFreeSlot's suffix instead.
function tierLabel(projectPath: string): string {
  const safe = basename(projectPath).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[.-]+/, '')
  return safe.length > 0 ? safe : 'project'
}

// Byte-compare a file or a whole directory tree. Used to decide whether a legacy
// entry losing a name clash can be dropped outright or must be preserved.
async function sameContent(a: string, b: string): Promise<boolean> {
  let sa
  let sb
  try {
    ;[sa, sb] = await Promise.all([stat(a), stat(b)])
  } catch {
    return false
  }
  if (sa.isDirectory() !== sb.isDirectory()) return false
  if (!sa.isDirectory()) {
    if (sa.size !== sb.size) return false
    const [ba, bb] = await Promise.all([readFile(a), readFile(b)])
    return ba.equals(bb)
  }
  const [ea, eb] = await Promise.all([readdir(a), readdir(b)])
  const na = ea.filter((n) => n !== '.DS_Store').sort()
  const nb = eb.filter((n) => n !== '.DS_Store').sort()
  if (na.length !== nb.length || na.some((n, i) => n !== nb[i])) return false
  for (const name of na) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await sameContent(join(a, name), join(b, name)))) return false
  }
  return true
}

interface KindResult {
  moved: number
  dropped: number
  parked: number
}

// Move every entry of one legacy kind dir into its shared counterpart, then
// remove the (now empty) legacy dir.
async function migrateKindDir(
  legacyDir: string,
  sharedDir: string,
  kind: string,
  // Which tier this dir belongs to ('global' or a project label). Only used to
  // namespace the park slot — see moveToFreeSlot.
  tier: string,
): Promise<KindResult | null> {
  let entries: string[]
  try {
    entries = await readdir(legacyDir)
  } catch {
    return null // nothing to migrate (the normal case after the first run)
  }
  const result: KindResult = { moved: 0, dropped: 0, parked: 0 }
  await mkdir(sharedDir, { recursive: true, mode: 0o700 })
  for (const name of entries) {
    if (name === '.DS_Store') continue
    const from = join(legacyDir, name)
    const to = join(sharedDir, name)
    try {
      // eslint-disable-next-line no-await-in-loop
      if (!(await pathExists(to))) {
        // eslint-disable-next-line no-await-in-loop
        await movePath(from, to)
        result.moved += 1
        continue
      }
      // Name clash: the shared copy is authoritative.
      // eslint-disable-next-line no-await-in-loop
      if (await sameContent(from, to)) {
        // eslint-disable-next-line no-await-in-loop
        await rm(from, { recursive: true, force: true })
        result.dropped += 1
        continue
      }
      const parkDir = join(awogHome(), 'migrated-conflicts', kind, tier)
      // eslint-disable-next-line no-await-in-loop
      await mkdir(parkDir, { recursive: true, mode: 0o700 })
      // eslint-disable-next-line no-await-in-loop
      const parkedTo = await moveToFreeSlot(from, join(parkDir, name))
      result.parked += 1
      log.warn('claude-home migration: kept the .claude copy, parked the differing .awog one', {
        kind,
        id: name,
        tier,
        parkedTo,
      })
    } catch (err) {
      log.warn('claude-home migration: entry failed, left in place', {
        kind,
        from,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  // Only remove the legacy dir once every entry has been dealt with; a leftover
  // (a failed entry above) keeps the dir and the next boot retries it.
  try {
    const left = (await readdir(legacyDir)).filter((n) => n !== '.DS_Store')
    if (left.length === 0) await rm(legacyDir, { recursive: true, force: true })
  } catch {
    // ignore — the dir is gone or unreadable, nothing more to do
  }
  return result
}

// Fold the isolated SDK config dir's transcripts into the shared home so
// existing Anthropic sessions keep resuming, then drop the dir wholesale (its
// other contents — plugins/, sessions/, tasks/, telemetry/, .claude.json — are
// per-config-dir CLI scratch that the shared home already has its own copy of).
async function migrateSdkStore(): Promise<number> {
  const legacyRoot = join(awogHome(), 'claude-sdk')
  const legacyProjects = join(legacyRoot, 'projects')
  const sharedProjects = join(claudeHome(), 'projects')
  let dirs: string[]
  try {
    dirs = await readdir(legacyProjects)
  } catch {
    // No transcripts to carry over — still drop the dir if it is lying around.
    if (await pathExists(legacyRoot)) await rm(legacyRoot, { recursive: true, force: true })
    return 0
  }
  await mkdir(sharedProjects, { recursive: true, mode: 0o700 })
  let moved = 0
  for (const dir of dirs) {
    if (dir === '.DS_Store') continue
    const from = join(legacyProjects, dir)
    const to = join(sharedProjects, dir)
    try {
      // eslint-disable-next-line no-await-in-loop
      if (!(await pathExists(to))) {
        // eslint-disable-next-line no-await-in-loop
        await movePath(from, to)
        moved += 1
        continue
      }
      // Both tools have sessions for this cwd — merge per session id. Ids are
      // UUIDs, so an existing name means it is already there; skip it.
      // eslint-disable-next-line no-await-in-loop
      for (const name of await readdir(from)) {
        const f = join(from, name)
        const t = join(to, name)
        // eslint-disable-next-line no-await-in-loop
        if (await pathExists(t)) continue
        // eslint-disable-next-line no-await-in-loop
        await movePath(f, t)
        moved += 1
      }
    } catch (err) {
      log.warn('claude-home migration: sdk transcript dir failed', {
        dir,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  try {
    await rm(legacyRoot, { recursive: true, force: true })
  } catch (err) {
    log.warn('claude-home migration: failed to remove legacy sdk config dir', {
      legacyRoot,
      err: err instanceof Error ? err.message : String(err),
    })
  }
  return moved
}

// Single in-flight run, shared by the boot sequence and by any RPC that must not
// observe a half-drained store. Whoever calls first starts it; everyone else
// awaits the same promise. Lazy (not a module-load side effect) so importing this
// module — e.g. from a list method — does not itself kick off filesystem work.
let inFlight: Promise<void> | null = null

export function migrateToClaudeHome(): Promise<void> {
  if (!inFlight) inFlight = run()
  return inFlight
}

async function run(): Promise<void> {
  const totals: KindResult = { moved: 0, dropped: 0, parked: 0 }
  const add = (r: KindResult | null): void => {
    if (!r) return
    totals.moved += r.moved
    totals.dropped += r.dropped
    totals.parked += r.parked
  }

  for (const kind of SHARED_KINDS) {
    // eslint-disable-next-line no-await-in-loop
    add(await migrateKindDir(join(awogHome(), kind), join(claudeHome(), kind), kind, 'global'))
  }

  // Project tiers. A project whose folder is gone is simply skipped — readdir
  // fails and migrateKindDir returns null.
  let projects: { path: string }[] = []
  try {
    projects = await listProjects()
  } catch (err) {
    log.warn('claude-home migration: project list unreadable, global tier only', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
  for (const project of projects) {
    for (const kind of SHARED_KINDS) {
      // eslint-disable-next-line no-await-in-loop
      add(
        await migrateKindDir(
          join(project.path, '.awog', kind),
          join(projectClaudeDir(project.path), kind),
          kind,
          tierLabel(project.path),
        ),
      )
    }
  }

  const sdkMoved = await migrateSdkStore()

  if (totals.moved || totals.dropped || totals.parked || sdkMoved) {
    log.info('claude-home migration done', { ...totals, sdkTranscriptsMoved: sdkMoved })
  }
}
