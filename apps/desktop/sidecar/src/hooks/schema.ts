// Hook config validation (ADR 0032). The on-disk JSON is L2 (semi-trusted: a
// project-tier file may come from a cloned repo) so every load re-validates
// here before the dispatcher will spawn anything. source/projectId/trusted/
// recentRuns are location- or runtime-derived and NOT part of the persisted
// shape — see hooks/store.ts.

import { z } from 'zod'

export const HOOK_EVENTS = [
  'task.before-start',
  'task.after-complete',
  'phase.before-run',
  'phase.after-run',
  'phase.before-approve',
  'phase.after-approve',
  'artifact.before-write',
  'artifact.after-write',
  'agent.before-prompt',
  'agent.after-response',
  'tool.before-call',
  'tool.after-call',
  'mcp.server-error',
  'session.reset',
] as const

// Events whose hook can abort the accompanying action (exit ≠ 0 → block). The
// dispatcher ignores a non-zero exit for any other event (ADR 0032 D-6).
export const BLOCKABLE_EVENTS = new Set([
  'task.before-start',
  'phase.before-run',
  'phase.before-approve',
  'artifact.before-write',
  'agent.before-prompt',
  'tool.before-call',
])

const MAX_TIMEOUT_MS = 300_000

export const HookConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  event: z.enum(HOOK_EVENTS),
  matcher: z.record(z.string(), z.string()).default({}),
  command: z.string().min(1),
  cwd: z.string().default('${workspace}'),
  timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).default(30_000),
  runMode: z.enum(['blocking', 'background']).default('blocking'),
  enabled: z.boolean().default(true),
  env: z.record(z.string(), z.string()).optional(),
})

export type HookConfig = z.infer<typeof HookConfigSchema>
