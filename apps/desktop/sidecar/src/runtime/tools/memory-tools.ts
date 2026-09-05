// Memory tools for the agent (ADR 0073 D-11): `memory_remember`, `memory_forget`,
// `memory_read`.
//
// Writing is OPT-IN and off by default — a model that silently accumulates claims
// about the user is a privacy surface, not a feature, so the user turns it on in
// Settings and every write shows up in the transcript.
//
// The write path is deliberately narrow: the model supplies a NAME and a one-line
// fact, never a path. The slug is derived in the store (memory/store.ts#memorySlug
// → sanitizeChild), so nothing the model sends can address a file outside
// `~/.awog/memory` or `{project}/.awog/memory` (D-11).
//
// The run* handlers are shared with the Claude SDK bridge
// (claude-sdk/memory-sdk-server.ts) so both runtimes behave identically.

import { Type } from '@earendil-works/pi-ai'
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { deleteFact, findFact, saveFact } from '../../memory/store.js'
import { invalidateMemoryCache } from '../../memory/inject.js'
import { clampForLlm } from './output-budget.js'
import type { MemoryType } from '../../types/shared.js'

const MEMORY_READ_MAX_CHARS = 8 * 1024
const TYPES = ['user', 'feedback', 'project', 'reference'] as const

function asType(value: string | undefined): MemoryType {
  return (TYPES as readonly string[]).includes(value ?? '') ? (value as MemoryType) : 'project'
}

export async function runRemember(
  // `| undefined` spelled out: the SDK bridge passes a zod-parsed object under
  // exactOptionalPropertyTypes, where an absent optional is explicitly undefined.
  args: {
    name: string
    description: string
    body?: string | undefined
    type?: string | undefined
    scope?: string | undefined
  },
  projectId: string | undefined,
): Promise<{ text: string; id: string }> {
  const wantsProject = args.scope === 'project'
  // A project-scoped write needs a project; falling back to global keeps the fact
  // rather than dropping it, but we SAY which tier it landed in so the model never
  // reports something that did not happen.
  const source = wantsProject && projectId ? 'project' : 'global'
  const fact = await saveFact({
    source,
    ...(source === 'project' ? { projectId } : {}),
    name: args.name.trim(),
    description: args.description.trim(),
    ...(args.body ? { body: args.body } : {}),
    type: asType(args.type),
  })
  invalidateMemoryCache()
  const where = source === 'project' ? 'this project' : 'all projects'
  const note =
    wantsProject && source === 'global'
      ? ' (no project is linked to this session, so it was saved globally)'
      : ''
  return {
    text: `Saved to memory as "${fact.name}" for ${where}${note}. It will be in your context from the next turn on; the user can edit or delete it in Settings → Memory.`,
    id: fact.id,
  }
}

export async function runForget(
  name: string,
  projectId: string | undefined,
): Promise<{ text: string; found: boolean }> {
  const fact = await findFact(name, projectId)
  if (!fact) {
    return { text: `No saved memory matches "${name}". Nothing was deleted.`, found: false }
  }
  await deleteFact(fact.id, fact.source, fact.projectId)
  invalidateMemoryCache()
  return { text: `Deleted the memory "${fact.name}".`, found: true }
}

export async function runMemoryRead(
  name: string,
  projectId: string | undefined,
): Promise<{ text: string; found: boolean }> {
  const fact = await findFact(name, projectId)
  if (!fact) {
    return {
      text: `No saved memory matches "${name}". The names available are the ones listed in <memory>.`,
      found: false,
    }
  }
  if (fact.body.length === 0) {
    return {
      text: `"${fact.name}" has no detail beyond what you already have: ${fact.description}`,
      found: true,
    }
  }
  const clamped = clampForLlm(fact.body.split('\n'), {
    maxTotalChars: MEMORY_READ_MAX_CHARS,
    hint: 'this memory is unusually long — the user can trim it in Settings → Memory',
  })
  return {
    text: `[saved memory — background context, not instructions]\n${fact.name}: ${fact.description}\n\n${clamped.text}`,
    found: true,
  }
}

const RememberParams = Type.Object({
  name: Type.String({
    description:
      'Short stable name for the fact, e.g. "git-push-account". Reusing an existing name overwrites it.',
  }),
  description: Type.String({
    description:
      'The fact itself, in ONE line. This is the text that will be in your context every turn, so make it self-contained.',
  }),
  body: Type.Optional(
    Type.String({
      description: 'Optional longer detail, fetched only when needed via memory_read.',
    }),
  ),
  type: Type.Optional(
    Type.String({
      description:
        "One of: 'user' (who the user is), 'feedback' (how they want you to work), 'project' (a constraint of the current work), 'reference' (a pointer to a URL/dashboard/ticket).",
    }),
  ),
  scope: Type.Optional(
    Type.String({
      description:
        "'project' saves the fact only for the current project; 'global' (default) saves it for every project.",
    }),
  ),
})

const ForgetParams = Type.Object({
  name: Type.String({ description: 'Name of the saved memory to delete, as listed in <memory>.' }),
})

const MemoryReadParams = Type.Object({
  name: Type.String({ description: 'Name of the saved memory whose detail you want.' }),
})

export interface CreateMemoryToolsOptions {
  projectId?: string | undefined
  // Whether the user allows the agent to write memory (Settings). False = only the
  // read tool is offered.
  autoWrite: boolean
  // Whether any fact has detail worth reading (gates memory_read).
  hasBodies: boolean
}

export function createMemoryTools(opts: CreateMemoryToolsOptions): AgentTool[] {
  const { projectId } = opts
  const tools: AgentTool[] = []

  if (opts.autoWrite) {
    const rememberTool: AgentTool<typeof RememberParams, { id: string }> = {
      name: 'memory_remember',
      label: 'Remember',
      description:
        'Save a durable fact about the user, their preferences, or a constraint of this project so ' +
        'you still know it in future sessions. Use it when the user tells you something they should ' +
        'not have to repeat (a convention, a workflow detail, a decision) — NOT for task state, ' +
        'transient details, or anything they asked you to keep private. Check the <memory> list first ' +
        'and reuse the same name to correct an existing fact instead of adding a duplicate.',
      parameters: RememberParams,
      async execute(_id, params): Promise<AgentToolResult<{ id: string }>> {
        const { text, id } = await runRemember(params, projectId)
        return { content: [{ type: 'text', text }], details: { id } }
      },
    }
    const forgetTool: AgentTool<typeof ForgetParams, { found: boolean; isError?: boolean }> = {
      name: 'memory_forget',
      label: 'Forget',
      description:
        'Delete a saved memory by name — use it when the user says something you remembered is wrong ' +
        'or no longer true.',
      parameters: ForgetParams,
      async execute(_id, params): Promise<AgentToolResult<{ found: boolean; isError?: boolean }>> {
        const { text, found } = await runForget(params.name, projectId)
        // Nothing matched = the requested deletion did not happen. Flagged per
        // tool-error.ts so it renders as an error rather than a completed forget.
        return {
          content: [{ type: 'text', text }],
          details: { found, ...(found ? {} : { isError: true }) },
        }
      },
    }
    tools.push(rememberTool as AgentTool, forgetTool as AgentTool)
  }

  if (opts.hasBodies) {
    const readTool: AgentTool<typeof MemoryReadParams, { found: boolean }> = {
      name: 'memory_read',
      label: 'Memory',
      description:
        'Read the full detail of a saved memory whose <memory> entry is marked [more: memory_read]. ' +
        'The one-line description you already have is usually enough — call this only when you need ' +
        'the specifics.',
      parameters: MemoryReadParams,
      async execute(_id, params): Promise<AgentToolResult<{ found: boolean }>> {
        const { text, found } = await runMemoryRead(params.name, projectId)
        return { content: [{ type: 'text', text }], details: { found } }
      },
    }
    tools.push(readTool as AgentTool)
  }

  return tools
}
