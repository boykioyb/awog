import { z } from 'zod'
import { register, RpcError } from '../transport/rpc.js'
import { loadSkill, renameSkill, saveSkill } from '../skills/store.js'
import type { Skill, SkillSource } from '../types/shared.js'

// id is the folder name on disk. Same constraints as project ids — keeps
// path traversal impossible without relying on sanitizeChild alone.
const SkillIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'id must be lowercase alphanumeric and hyphens')

const SkillSourceSchema: z.ZodType<SkillSource> = z.enum([
  'global',
  'user-claude',
  'user-agents',
  'project-claude',
  'project-agents',
])

const USER_SOURCES: SkillSource[] = ['global', 'user-claude', 'user-agents']
const isUserSource = (s: SkillSource): boolean => USER_SOURCES.includes(s)

const StringArray = z.array(z.string().min(1).max(200)).max(50).optional()

const SkillSchema = z.object({
  id: SkillIdSchema,
  source: SkillSourceSchema,
  projectId: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  body: z.string().max(64_000).default(''),
  globs: StringArray,
  alwaysAllow: StringArray,
  icon: z.string().max(2048).optional(),
  requiredSources: StringArray,
})

const Params = z.object({
  skill: SkillSchema,
  mode: z.enum(['create', 'update']),
  previousId: SkillIdSchema.optional(),
})

register('skills.upsert', async (raw) => {
  const params = Params.parse(raw)
  const incoming = params.skill

  if (!isUserSource(incoming.source) && !incoming.projectId) {
    throw new RpcError(-32602, `Source ${incoming.source} requires projectId`)
  }
  if (isUserSource(incoming.source) && incoming.projectId) {
    throw new RpcError(-32602, `projectId must be omitted for user-level source ${incoming.source}`)
  }

  if (params.previousId && params.previousId !== incoming.id) {
    if (params.mode !== 'update') {
      throw new RpcError(-32602, 'previousId only valid in update mode')
    }
    const existing = await loadSkill(params.previousId, incoming.source, incoming.projectId)
    if (!existing) {
      throw new RpcError(-32602, `Skill not found: ${params.previousId}`)
    }
    await renameSkill(params.previousId, incoming.id, incoming.source, incoming.projectId)
  } else {
    const existing = await loadSkill(incoming.id, incoming.source, incoming.projectId)
    if (params.mode === 'create' && existing) {
      throw new RpcError(-32602, `Skill id already exists: ${incoming.id}`)
    }
    if (params.mode === 'update' && !existing) {
      throw new RpcError(-32602, `Skill not found: ${incoming.id}`)
    }
  }

  const skill: Skill = {
    id: incoming.id,
    source: incoming.source,
    name: incoming.name,
    description: incoming.description,
    body: incoming.body,
  }
  if (incoming.projectId) skill.projectId = incoming.projectId
  if (incoming.globs && incoming.globs.length > 0) skill.globs = incoming.globs
  if (incoming.alwaysAllow && incoming.alwaysAllow.length > 0) {
    skill.alwaysAllow = incoming.alwaysAllow
  }
  if (incoming.icon) skill.icon = incoming.icon
  if (incoming.requiredSources && incoming.requiredSources.length > 0) {
    skill.requiredSources = incoming.requiredSources
  }

  await saveSkill(skill)
  return { skill }
})
