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
  await updateSessionMetadata(session.id, patch)
  return { session }
})
