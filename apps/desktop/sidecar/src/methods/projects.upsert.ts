import { z } from 'zod'
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { homedir } from 'node:os'
import { register, RpcError } from '../transport/rpc.js'
import { saveProject, loadProject } from '../projects/store.js'
import type { Project } from '../types/shared.js'

// id is composed by the UI and used as the filename. We constrain shape here
// because filename safety in store.ts also depends on sanitizeChild rejecting
// '/', '\\', '..' but we tighten further: allow only [a-z0-9-].
const ProjectIdSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be lowercase alphanumeric and hyphens')

// Per-project LLM defaults (mirror of UI ProjectLlmDefaults). Validated at the
// boundary like the rest of the project payload; persisted as-is so new sessions
// can inherit it. `accountId` references an account in credentials.json — left
// unverified here (it may legitimately point at an account that gets removed
// later; the UI falls back to the provider's active account at session create).
const LlmDefaultsSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google']),
  modelId: z.string().min(1).max(200),
  // Optional: absent = the project follows the global thinking level. The UI only
  // pins it when it differs from the app default, so requiring it here rejected
  // every save where the two matched.
  level: z.enum(['low', 'medium', 'high', 'extra-high', 'max']).optional(),
  accountId: z.string().max(200).optional(),
  // MCP server whitelist new sessions inherit. undefined = all enabled servers.
  mcpServerIds: z.array(z.string().max(200)).max(200).optional(),
  // Response style (ADR 0046) new sessions inherit. undefined = "Normal".
  responseStyle: z.string().max(120).optional(),
  responseStyleNoMarkdown: z.boolean().optional(),
})

const ProjectSchema = z.object({
  id: ProjectIdSchema,
  name: z.string().min(1).max(120),
  path: z.string().min(1).max(4096),
  description: z.string().max(2000).default(''),
  gitRemote: z.string().max(2048).default(''),
  gitBranch: z.string().max(200).default(''),
  language: z.string().max(80).default(''),
  createdAt: z.string().max(60),
  color: z.string().max(40).optional(),
  llmDefaults: LlmDefaultsSchema.optional(),
  // gh account login (or '' for the active account). Length caps a gh login (39)
  // with headroom; '' is allowed (means "active account").
  githubAccount: z.string().max(60).optional(),
})

const Params = z.object({
  project: ProjectSchema,
  mode: z.enum(['create', 'update']),
})

// Expand a leading "~" so users can type "~/code/foo". We do not call into a
// shell so glob/$VAR are not expanded — that is intentional.
function expandHome(input: string): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/')) return resolve(homedir(), input.slice(2))
  return input
}

// Path validation guarantees the path exists, is a directory, and resolves to
// an absolute location without `..` slipping through. We do NOT scope it to a
// "workspace root" — a registered project can live anywhere the OS allows —
// but we still reject relative paths and `..` literals defensively.
async function validatePath(rawPath: string): Promise<string> {
  if (rawPath.includes('..')) {
    throw new RpcError(-32602, 'Path must not contain ".."')
  }
  const expanded = expandHome(rawPath)
  if (!isAbsolute(expanded)) {
    throw new RpcError(-32602, 'Path must be absolute (or start with "~/")')
  }
  const absolute = resolve(expanded)
  try {
    const s = await stat(absolute)
    if (!s.isDirectory()) {
      throw new RpcError(-32602, `Path is not a directory: ${absolute}`)
    }
  } catch (err) {
    if (err instanceof RpcError) throw err
    throw new RpcError(-32602, `Path does not exist: ${absolute}`)
  }
  return absolute
}

const GIT_REMOTE_RE = /^(https?:\/\/|ssh:\/\/|git@)[A-Za-z0-9._/:@~+-]+$/

function validateGitRemote(remote: string): void {
  if (!remote) return
  if (!GIT_REMOTE_RE.test(remote)) {
    throw new RpcError(-32602, 'gitRemote must use https://, ssh:// or git@ scheme')
  }
}

register('projects.upsert', async (raw) => {
  const params = Params.parse(raw)
  const incoming = params.project

  const existing = await loadProject(incoming.id)
  if (params.mode === 'create' && existing) {
    throw new RpcError(-32602, `Project id already exists: ${incoming.id}`)
  }
  if (params.mode === 'update' && !existing) {
    throw new RpcError(-32602, `Project not found: ${incoming.id}`)
  }

  const absolutePath = await validatePath(incoming.path)
  validateGitRemote(incoming.gitRemote)

  const project: Project = {
    id: incoming.id,
    name: incoming.name,
    path: absolutePath,
    description: incoming.description,
    gitRemote: incoming.gitRemote,
    gitBranch: incoming.gitBranch,
    language: incoming.language,
    createdAt: incoming.createdAt,
  }
  if (incoming.color !== undefined) project.color = incoming.color
  // Omitted on the incoming payload → dropped from the saved record (a "reset to
  // app default" from the UI sends the project without this field).
  if (incoming.llmDefaults !== undefined) {
    project.llmDefaults = {
      provider: incoming.llmDefaults.provider,
      modelId: incoming.llmDefaults.modelId,
    }
    // Omitted → dropped (the project keeps following the global thinking level).
    if (incoming.llmDefaults.level !== undefined) {
      project.llmDefaults.level = incoming.llmDefaults.level
    }
    if (incoming.llmDefaults.accountId !== undefined) {
      project.llmDefaults.accountId = incoming.llmDefaults.accountId
    }
    if (incoming.llmDefaults.mcpServerIds !== undefined) {
      project.llmDefaults.mcpServerIds = incoming.llmDefaults.mcpServerIds
    }
    if (incoming.llmDefaults.responseStyle !== undefined) {
      project.llmDefaults.responseStyle = incoming.llmDefaults.responseStyle
    }
    if (incoming.llmDefaults.responseStyleNoMarkdown !== undefined) {
      project.llmDefaults.responseStyleNoMarkdown = incoming.llmDefaults.responseStyleNoMarkdown
    }
  }
  // Omitted → dropped (inherit the app default). '' preserved (active account).
  if (incoming.githubAccount !== undefined) project.githubAccount = incoming.githubAccount

  await saveProject(project)
  return { project }
})
