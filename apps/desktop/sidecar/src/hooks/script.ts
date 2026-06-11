// Edit the SCRIPT FILE a hook command runs (e.g. format-after-edit.sh), not
// just the command string. The script path is detected from the command and
// resolved relative to the hook's workspace; reads/writes are restricted to the
// recognised hook directories so this can't read/write arbitrary files:
//   {workspace}/.claude/hooks  ·  {workspace}/.awog/hooks
//   ~/.claude/hooks            ·  ~/.awog/hooks
//
// `workspace` = the project path for project/claude-* tiers, else the home dir.

import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { RpcError } from '../transport/rpc.js'
import { loadProject } from '../projects/store.js'
import type { HookSource } from '../types/shared.js'

const SCRIPT_EXT = /\.(sh|bash|zsh|mjs|cjs|js|ts|py|rb|pl)$/i
const MAX_BYTES = 256 * 1024

interface FsError extends Error {
  code?: string
}
function isMissing(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as FsError).code === 'ENOENT'
}

// First token in the shell command that looks like a script file path.
export function detectScriptToken(command: string): string | null {
  const tokens = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  for (const raw of tokens) {
    const t = raw.replace(/^['"]|['"]$/g, '')
    if (SCRIPT_EXT.test(t)) return t
  }
  return null
}

async function workspaceFor(source: HookSource, projectId: string | undefined): Promise<string> {
  if (source === 'project' || source === 'claude-project' || source === 'claude-local') {
    if (!projectId) throw new RpcError(-32602, 'Project hook requires a projectId')
    const project = await loadProject(projectId)
    if (!project) throw new RpcError(-32602, `Project not found: ${projectId}`)
    return project.path
  }
  return homedir()
}

function resolveToken(token: string, workspace: string): string {
  let t = token
    .replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, workspace)
    .replace(/\$\{?workspace\}?/g, workspace)
  if (t.startsWith('~/')) t = join(homedir(), t.slice(2))
  return isAbsolute(t) ? resolve(t) : resolve(workspace, t)
}

// Allowed iff the resolved absolute path sits inside a recognised hook dir.
function isAllowed(abs: string, workspace: string): boolean {
  const home = homedir()
  const dirs = [
    resolve(workspace, '.claude', 'hooks'),
    resolve(workspace, '.awog', 'hooks'),
    resolve(home, '.claude', 'hooks'),
    resolve(home, '.awog', 'hooks'),
  ]
  return dirs.some((d) => abs === d || abs.startsWith(d + sep))
}

async function resolveHookScript(
  command: string,
  source: HookSource,
  projectId: string | undefined,
): Promise<{ path: string; abs: string } | null> {
  const token = detectScriptToken(command)
  if (!token) return null
  const workspace = await workspaceFor(source, projectId)
  const abs = resolveToken(token, workspace)
  if (!isAllowed(abs, workspace)) return null
  return { path: token, abs }
}

export interface HookScript {
  path: string
  content: string
  exists: boolean
}

// Returns null when the command references no editable script (or it's outside
// the allowed dirs) — the UI hides the Script section then.
export async function readHookScript(
  command: string,
  source: HookSource,
  projectId: string | undefined,
): Promise<HookScript | null> {
  const r = await resolveHookScript(command, source, projectId)
  if (!r) return null
  try {
    const buf = await readFile(r.abs)
    if (buf.includes(0)) return { path: r.path, content: '', exists: true } // binary — don't edit
    return { path: r.path, content: buf.subarray(0, MAX_BYTES).toString('utf8'), exists: true }
  } catch (err) {
    if (isMissing(err)) return { path: r.path, content: '', exists: false }
    throw err
  }
}

export async function writeHookScript(
  command: string,
  source: HookSource,
  projectId: string | undefined,
  content: string,
): Promise<string> {
  const r = await resolveHookScript(command, source, projectId)
  if (!r) throw new RpcError(-32602, 'Command references no editable script')
  if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) {
    throw new RpcError(-32602, `Script too large (> ${MAX_BYTES} bytes)`)
  }
  await mkdir(dirname(r.abs), { recursive: true })
  await writeFile(r.abs, content, 'utf8')
  // Shell scripts must stay executable.
  if (/\.(sh|bash|zsh)$/i.test(r.abs)) await chmod(r.abs, 0o755).catch(() => {})
  return r.path
}
