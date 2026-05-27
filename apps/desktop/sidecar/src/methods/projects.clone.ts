import { z } from 'zod'
import { execFile } from 'node:child_process'
import { stat, mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { homedir } from 'node:os'
import { register, RpcError } from '../transport/rpc.js'
import { saveProject, loadProject } from '../projects/store.js'
import { emit } from '../transport/stdio.js'
import { log } from '../util/logger.js'
import type { Project } from '../types/shared.js'

const GIT_REMOTE_RE = /^(https?:\/\/|ssh:\/\/|git@)[A-Za-z0-9._/:@~+-]+$/
const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]*$/

const Params = z.object({
  id: z.string().min(3).max(64).regex(PROJECT_ID_RE),
  name: z.string().min(1).max(120),
  gitRemote: z.string().min(1).max(2048),
  destPath: z.string().min(1).max(4096),
  language: z.string().max(80).default(''),
  description: z.string().max(2000).default(''),
  createdAt: z.string().max(60),
})

function expandHome(input: string): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/')) return resolve(homedir(), input.slice(2))
  return input
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

interface ExecError extends Error {
  code?: number
  stderr?: string
}

// Spawn git with arg array (no shell). Streams stderr as progress events so
// the UI can show "Cloning…" feedback. Rejects with stderr captured for the
// UI to surface a readable error.
async function gitClone(remote: string, dest: string, jobId: string): Promise<void> {
  await new Promise<void>((res, rej) => {
    const child = execFile(
      'git',
      ['clone', '--progress', '--', remote, dest],
      // cwd is the parent dir (guaranteed to exist) so any relative resolution
      // is unambiguous. Env: minimal — no GIT_ASKPASS prompts on stdin.
      {
        cwd: dirname(dest),
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
        },
      },
      (err, _stdout, stderr) => {
        if (err) {
          const e = err as ExecError
          e.stderr = stderr
          rej(e)
        } else {
          res()
        }
      },
    )
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      emit('project.clone.progress', { jobId, line: text })
    })
  })
}

// Resolve symbolic HEAD inside the freshly cloned repo. Falls back to 'main'
// if git is unhappy — non-fatal because clone already succeeded.
async function detectDefaultBranch(repoDir: string): Promise<string> {
  return new Promise<string>((res) => {
    execFile(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: repoDir },
      (err, stdout) => {
        if (err || !stdout) {
          res('main')
          return
        }
        res(stdout.trim() || 'main')
      },
    )
  })
}

register('projects.clone', async (raw) => {
  const params = Params.parse(raw)

  if (!GIT_REMOTE_RE.test(params.gitRemote)) {
    throw new RpcError(-32602, 'gitRemote must use https://, ssh:// or git@ scheme')
  }
  if (params.destPath.includes('..')) {
    throw new RpcError(-32602, 'destPath must not contain ".."')
  }
  const expanded = expandHome(params.destPath)
  if (!isAbsolute(expanded)) {
    throw new RpcError(-32602, 'destPath must be absolute (or start with "~/")')
  }
  const dest = resolve(expanded)

  if (await pathExists(dest)) {
    throw new RpcError(-32602, `Destination already exists: ${dest}`)
  }
  const parent = dirname(dest)
  if (!(await pathExists(parent))) {
    // Create the parent so users can clone into "~/code/new-org/new-repo" even
    // if "~/code/new-org" does not yet exist. We never auto-create `dest` —
    // git clone is the only thing that does that.
    try {
      await mkdir(parent, { recursive: true })
    } catch (err) {
      throw new RpcError(-32602, `Cannot create parent dir: ${parent}`, {
        cause: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (await loadProject(params.id)) {
    throw new RpcError(-32602, `Project id already exists: ${params.id}`)
  }

  const jobId = params.id
  emit('project.clone.started', { jobId, dest })
  try {
    await gitClone(params.gitRemote, dest, jobId)
  } catch (err) {
    const e = err as ExecError
    const message = e.stderr?.trim() || e.message || 'git clone failed'
    emit('project.clone.failed', { jobId, error: message })
    log.warn('projects.clone: git clone failed', { jobId, err: message })
    throw new RpcError(-32000, message)
  }

  const branch = await detectDefaultBranch(dest)
  const project: Project = {
    id: params.id,
    name: params.name,
    path: dest,
    description: params.description,
    gitRemote: params.gitRemote,
    gitBranch: branch,
    language: params.language,
    createdAt: params.createdAt,
  }
  await saveProject(project)
  emit('project.clone.completed', { jobId, project })

  return { project }
})
