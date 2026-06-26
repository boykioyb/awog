import { z } from 'zod'
import { register } from '../transport/rpc.js'
import { createSession, updateSessionMetadata } from '../sessions/store.js'
import type { Session, SessionSettings } from '../types/shared.js'

// Legacy migration: 'standard' → 'low' so JSONL persisted pre-rename still parses.
const ThinkingLevelSchema = z.preprocess(
  (v) => (v === 'standard' ? 'low' : v),
  z.enum(['low', 'medium', 'high', 'extra-high', 'max']),
)

const SessionSettingsSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google']),
  modelId: z.string(),
  level: ThinkingLevelSchema,
  mode: z.enum(['ask', 'accept-edits', 'plan', 'execute']),
  accountId: z.string().optional(),
  // Response style (ADR 0046) — persisted per session so it survives restart.
  responseStyle: z.string().optional(),
  responseStyleNoMarkdown: z.boolean().optional(),
})

const SessionMessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(['user', 'agent', 'system']),
    text: z.string(),
    at: z.string(),
  })
  .passthrough()

const SessionSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  projectId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  pinned: z.boolean().optional(),
  invitedAgentIds: z.array(z.string()),
  messages: z.array(SessionMessageSchema),
  pendingAgentIds: z.array(z.string()),
  settings: SessionSettingsSchema,
  disabledTools: z.array(z.string()).optional(),
  mcpServerIds: z.array(z.string()).optional(),
  // Task this session was opened to discuss (ADR 0055). Set at create time for a
  // "Discuss in session" session; absent for a normal chat.
  aboutTaskId: z.string().optional(),
  // GitHub issue/PR URL this session was opened from ("New session" on a row).
  aboutGhUrl: z.string().optional(),
})

const Params = z.object({
  session: SessionSchema,
  mode: z.enum(['create', 'update-metadata']),
})

// exactOptionalPropertyTypes: zod yields T | undefined for .optional(); rebuild
// settings/session so undefined fields are not assigned at all.
function toSessionSettings(parsed: z.infer<typeof SessionSettingsSchema>): SessionSettings {
  const base: SessionSettings = {
    provider: parsed.provider,
    modelId: parsed.modelId,
    level: parsed.level,
    mode: parsed.mode,
  }
  if (parsed.accountId !== undefined) base.accountId = parsed.accountId
  if (parsed.responseStyle !== undefined) base.responseStyle = parsed.responseStyle
  if (parsed.responseStyleNoMarkdown !== undefined) {
    base.responseStyleNoMarkdown = parsed.responseStyleNoMarkdown
  }
  return base
}

function toSession(parsed: z.infer<typeof SessionSchema>): Session {
  const base: Session = {
    id: parsed.id,
    title: parsed.title,
    projectId: parsed.projectId,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    invitedAgentIds: parsed.invitedAgentIds,
    // Cast: passthrough yields permissive shape; runner consumes only the
    // declared fields and treats messages as read-only here we just persist.
    messages: parsed.messages as unknown as Session['messages'],
    pendingAgentIds: parsed.pendingAgentIds,
    settings: toSessionSettings(parsed.settings),
  }
  if (parsed.pinned !== undefined) base.pinned = parsed.pinned
  if (parsed.disabledTools !== undefined) base.disabledTools = parsed.disabledTools
  if (parsed.mcpServerIds !== undefined) base.mcpServerIds = parsed.mcpServerIds
  if (parsed.aboutTaskId !== undefined) base.aboutTaskId = parsed.aboutTaskId
  if (parsed.aboutGhUrl !== undefined) base.aboutGhUrl = parsed.aboutGhUrl
  return base
}

register('sessions.upsert', async (raw) => {
  const params = Params.parse(raw)
  const session = toSession(params.session)

  if (params.mode === 'create') {
    await createSession(session)
    return { session }
  }

  // update-metadata: derive patch from the canonical fields. Messages are not
  // updated via this method (use sessions.sendMessage for that).
  const patch: Parameters<typeof updateSessionMetadata>[1] = {
    title: session.title,
    projectId: session.projectId,
    settings: session.settings,
    invitedAgentIds: session.invitedAgentIds,
  }
  if (session.pinned !== undefined) patch.pinned = session.pinned
  if (session.disabledTools !== undefined) patch.disabledTools = session.disabledTools
  if (session.mcpServerIds !== undefined) patch.mcpServerIds = session.mcpServerIds
  if (session.aboutTaskId !== undefined) patch.aboutTaskId = session.aboutTaskId
  if (session.aboutGhUrl !== undefined) patch.aboutGhUrl = session.aboutGhUrl
  await updateSessionMetadata(session.id, patch)
  return { session }
})
