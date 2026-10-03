// One-time boot migration (ADR 0070): AWOG used to keep its own copy of the
// config kinds Claude Code has a native on-disk layout for, plus an isolated
// SDK config dir. Both are folded into the shared Claude home:
//
//   ~/.awog/{skills,commands}            → <claudeHome>/{skills,commands}
//   {project}/.awog/{skills,commands}      → {project}/.claude/{...}
//   ~/.awog/claude-sdk/projects/*          → <claudeHome>/projects/*
//
// `agents` is deliberately NOT migrated: Agents is an AWOG-native system again
// (`~/.awog/agents` + `{project}/.awog/agents`) and must not drain into the
// shared Claude home — nor does it import the `.claude` roster back.
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
import { parseFrontmatter } from '../skills/frontmatter.js'
import { listProjects } from '../projects/store.js'

// The kinds that move. Anything not listed here stays in `.awog` — hooks live in
// a settings.json array upstream and rules have no Claude Code dir equivalent,
// so neither has a shared home to move into; agents are AWOG-native under
// `.awog` by product decision (see header).
const SHARED_KINDS = ['skills', 'commands'] as const
type SharedKind = (typeof SHARED_KINDS)[number]

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

// ── Agent rescue: stranded .claude files → .awog ─────────────────────────────
// Agents lived in the shared `.claude` home between ADR 0070 shipping and the
// return to an AWOG-native home (`{~,project}/.awog/agents`). Files AWOG wrote
// in that window are stranded — the scanner only reads `.awog`, so team specs
// point at agents that no longer resolve and member pickers render blank.
//
// A flat `<id>.md` is rescued when it is provably AWOG-authored: it carries an
// AWOG-only frontmatter key — `role`, `accountId`, `provider`, `mcpServerIds`,
// `skillIds`, `repos` (`name`/`description`/`model`/`tools` exist in the native
// Claude Code format too, so they cannot distinguish) — OR its id is referenced
// by an AWOG team spec (lead/member agent bound with no distinguishing
// frontmatter). Directories are NEVER touched — `<id>/AGENT.md` is the CLI's
// own layout that AWOG only ever wrote as flat files. An existing `.awog` copy
// always wins: the stranded file is parked under migrated-conflicts/ rather
// than overwriting or being deleted.
const AGENT_MARKER_KEYS = ['role', 'accountId', 'provider', 'mcpServerIds', 'skillIds', 'repos']

interface TeamAgentRefJson {
  id?: unknown
  source?: unknown
  projectId?: unknown
}

interface TeamSpecJson {
  lead?: TeamAgentRefJson
  members?: { agent?: TeamAgentRefJson }[]
}

// Agent ids team specs bind, bucketed by the agents dir the ref resolves to.
// Key '' = the global tier; otherwise the project's absolute path.
async function referencedAgentIds(
  projects: { id: string; path: string }[],
): Promise<Map<string, Set<string>>> {
  const refs = new Map<string, Set<string>>()
  const pathOf = new Map(projects.map((p) => [p.id, p.path]))
  const push = (bucket: string, id: string): void => {
    let set = refs.get(bucket)
    if (!set) refs.set(bucket, (set = new Set()))
    set.add(id)
  }
  const specDirs: { dir: string; specProjectId?: string }[] = [
    { dir: join(awogHome(), 'teams') },
    ...projects.map((p) => ({ dir: join(p.path, '.awog', 'teams'), specProjectId: p.id })),
  ]
  for (const { dir, specProjectId } of specDirs) {
    let names: string[]
    try {
      // eslint-disable-next-line no-await-in-loop
      names = await readdir(dir)
    } catch {
      continue // no teams dir in this tier
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      let spec: TeamSpecJson
      try {
        // eslint-disable-next-line no-await-in-loop
        spec = JSON.parse(await readFile(join(dir, name), 'utf8')) as TeamSpecJson
      } catch {
        continue // not JSON / not a spec — skip
      }
      for (const ref of [spec.lead, ...(spec.members ?? []).map((m) => m.agent)]) {
        const id = typeof ref?.id === 'string' ? ref.id : ''
        if (!id) continue
        if (ref?.source === 'project') {
          // The ref's own projectId wins; fall back to the spec file's tier.
          const pid =
            typeof ref.projectId === 'string' && ref.projectId ? ref.projectId : specProjectId
          const path = pid ? pathOf.get(pid) : undefined
          if (path) push(path, id)
        } else {
          push('', id)
        }
      }
    }
  }
  return refs
}

// Move the AWOG-authored flat `<id>.md` files of one legacy agents dir into its
// `.awog` counterpart. `referenced` = ids team specs point at in this tier.
async function rescueAgentsDir(
  legacyDir: string,
  awogDir: string,
  referenced: ReadonlySet<string>,
  tier: string,
): Promise<KindResult> {
  const result: KindResult = { moved: 0, dropped: 0, parked: 0 }
  let names: string[]
  try {
    names = (await readdir(legacyDir, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name)
  } catch {
    return result // no legacy agents dir — the normal case
  }
  if (!names.length) return result
  await mkdir(awogDir, { recursive: true, mode: 0o700 })
  for (const name of names) {
    const id = name.slice(0, -'.md'.length)
    const from = join(legacyDir, name)
    try {
      if (!referenced.has(id)) {
        // eslint-disable-next-line no-await-in-loop
        const { data } = parseFrontmatter(await readFile(from, 'utf8'))
        if (!AGENT_MARKER_KEYS.some((k) => data[k] !== undefined)) continue
      }
      const to = join(awogDir, name)
      // eslint-disable-next-line no-await-in-loop
      if (!(await pathExists(to))) {
        // eslint-disable-next-line no-await-in-loop
        await movePath(from, to)
        result.moved += 1
        continue
      }
      // The .awog copy is authoritative — drop a byte-identical stranded file,
      // park a differing one so no edit is ever destroyed.
      // eslint-disable-next-line no-await-in-loop
      if (await sameContent(from, to)) {
        // eslint-disable-next-line no-await-in-loop
        await rm(from, { force: true })
        result.dropped += 1
        continue
      }
      const parkDir = join(awogHome(), 'migrated-conflicts', 'agents', tier)
      // eslint-disable-next-line no-await-in-loop
      await mkdir(parkDir, { recursive: true, mode: 0o700 })
      // eslint-disable-next-line no-await-in-loop
      const parkedTo = await moveToFreeSlot(from, join(parkDir, name))
      result.parked += 1
      log.warn('agents rescue: .awog copy kept, parked the stranded .claude one', {
        id,
        tier,
        parkedTo,
      })
    } catch (err) {
      log.warn('agents rescue: entry failed, left in place', {
        from,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return result
}

async function rescueAwogAgents(projects: { id: string; path: string }[]): Promise<KindResult> {
  const totals: KindResult = { moved: 0, dropped: 0, parked: 0 }
  const add = (r: KindResult): void => {
    totals.moved += r.moved
    totals.dropped += r.dropped
    totals.parked += r.parked
  }
  const refs = await referencedAgentIds(projects)
  add(
    await rescueAgentsDir(
      join(claudeHome(), 'agents'),
      join(awogHome(), 'agents'),
      refs.get('') ?? new Set(),
      'global',
    ),
  )
  for (const project of projects) {
    // eslint-disable-next-line no-await-in-loop
    add(
      await rescueAgentsDir(
        join(projectClaudeDir(project.path), 'agents'),
        join(project.path, '.awog', 'agents'),
        refs.get(project.path) ?? new Set(),
        tierLabel(project.path),
      ),
    )
  }
  return totals
}

// Per-kind gates. skills/agents/commands.list must not serve a half-drained store
// of THEIR kind — but they have no reason to wait on the other two kinds, nor on
// the SDK transcript move, which is hundreds of unrelated directory renames. One
// promise for the whole run made opening the Skills page during a first-run
// migration block on all of it. Each gate resolves as soon as its own kind is
// drained across every tier. 'agents' gates on the .claude→.awog rescue, not on
// SHARED_KINDS.
type GatedKind = SharedKind | 'agents'
const kindGates = new Map<GatedKind, { promise: Promise<void>; open: () => void }>()

function kindGate(kind: GatedKind): { promise: Promise<void>; open: () => void } {
  let g = kindGates.get(kind)
  if (!g) {
    let open!: () => void
    const promise = new Promise<void>((resolve) => {
      open = resolve
    })
    g = { promise, open }
    kindGates.set(kind, g)
  }
  return g
}

export function migrateToClaudeHome(): Promise<void> {
  if (!inFlight) inFlight = run()
  return inFlight
}

// What the list methods await: this kind is drained, nothing else is promised.
// Starts the run if the boot kick has not already (a list can be served before
// the boot sequence gets here).
export function awaitKindMigration(kind: GatedKind): Promise<void> {
  void migrateToClaudeHome()
  return kindGate(kind).promise
}

async function run(): Promise<void> {
  const totals: KindResult = { moved: 0, dropped: 0, parked: 0 }
  const add = (r: KindResult | null): void => {
    if (!r) return
    totals.moved += r.moved
    totals.dropped += r.dropped
    totals.parked += r.parked
  }

  // Project tiers are read up front so the loop below can finish one KIND across
  // every tier before opening that kind's gate. A project whose folder is gone is
  // simply skipped — readdir fails and migrateKindDir returns null.
  let projects: { id: string; path: string }[] = []
  try {
    projects = await listProjects()
  } catch (err) {
    log.warn('claude-home migration: project list unreadable, global tier only', {
      err: err instanceof Error ? err.message : String(err),
    })
  }

  try {
    for (const kind of SHARED_KINDS) {
      try {
        // eslint-disable-next-line no-await-in-loop
        add(await migrateKindDir(join(awogHome(), kind), join(claudeHome(), kind), kind, 'global'))
        for (const project of projects) {
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
      } finally {
        // Open on the way out even if this kind threw: a waiting list must never
        // hang on a migration failure. Resolving twice is a no-op.
        kindGate(kind).open()
      }
    }
    // Agent rescue — inside the same try so ANY failure above still reaches the
    // finally that opens the 'agents' gate (a hanging agents.list is worse than
    // a missing rescue). The rescue itself never throws: per-dir failures are
    // logged + skipped.
    try {
      const rescued = await rescueAwogAgents(projects)
      if (rescued.moved || rescued.dropped || rescued.parked) {
        log.info('agents rescue done', { ...rescued })
      }
    } catch (err) {
      log.warn('agents rescue failed', {
        err: err instanceof Error ? err.message : String(err),
      })
    }
  } finally {
    for (const kind of SHARED_KINDS) kindGate(kind).open()
    kindGate('agents').open()
  }

  // Deliberately AFTER every gate is open: no list waits on this.
  const sdkMoved = await migrateSdkStore()

  if (totals.moved || totals.dropped || totals.parked || sdkMoved) {
    log.info('claude-home migration done', { ...totals, sdkTranscriptsMoved: sdkMoved })
  }
}
