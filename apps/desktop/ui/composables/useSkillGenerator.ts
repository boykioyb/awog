// Skill draft generator. Tries the real LLM via the sidecar
// (`skills.generate` → claude-agent-sdk one-shot call); falls back to a local
// slug-based mock when no sidecar or no active account is available (browser
// dev mode, or before the user has connected an Anthropic account).

import type { Ref } from 'vue'
import type { Skill } from '~/types'
import { STOP_WORDS } from '~/utils/stop-words'

export type SkillDraft = Omit<Skill, 'id'> & { id?: string }

interface SkillGenerator {
  generate: (prompt: string) => Promise<SkillDraft | null>
  // Revise an existing skill: LLM is given the current skill as context plus
  // the user's edit instruction. Mock fallback: tweaks body by appending the
  // edit prompt so the UX is still usable offline.
  edit: (prompt: string, current: Skill) => Promise<SkillDraft | null>
  isGenerating: Ref<boolean>
  error: Ref<string | null>
}

interface GenerateResponse {
  skill: {
    id: string
    name: string
    description: string
    body: string
    icon?: string
    globs?: string[]
    alwaysAllow?: string[]
    requiredSources?: string[]
  }
}

const slugifyName = (prompt: string): string => {
  const firstLine = prompt.split('\n')[0] ?? ''
  const words = firstLine
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .slice(0, 4)
  return words.length ? words.join('-') : 'new-skill'
}

const firstSentence = (prompt: string): string => {
  const m = prompt.match(/^[^.!?\n]+[.!?]?/)
  return m ? m[0].trim() : prompt.slice(0, 140)
}

// Local fallback when no LLM is reachable. Keeps the prompt creator usable in
// browser dev / before account connect — at least slugifies the prompt and
// drops the raw text into the body.
const mockDraft = (prompt: string): SkillDraft => ({
  id: slugifyName(prompt),
  source: 'global',
  name: slugifyName(prompt)
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase()),
  description: firstSentence(prompt),
  body: prompt,
})

export const useSkillGenerator = (): SkillGenerator => {
  const isGenerating = ref(false)
  const error = ref<string | null>(null)
  const sidecar = useSidecar()
  const settings = useSettingsStore()

  const generate = async (prompt: string): Promise<SkillDraft | null> => {
    const trimmed = prompt.trim()
    if (!trimmed) {
      error.value = 'Prompt cannot be empty'
      return null
    }
    isGenerating.value = true
    error.value = null
    try {
      const account = settings.activeAccount('anthropic')
      if (!sidecar.available || !account) {
        // Add a small delay so the UI's "generating" state is visible.
        await new Promise<void>((r) => {
          setTimeout(r, 350)
        })
        return mockDraft(trimmed)
      }
      try {
        const res = await sidecar.request<GenerateResponse>('skills.generate', {
          prompt: trimmed,
          accountId: account.id,
        })
        return {
          id: res.skill.id,
          source: 'global',
          name: res.skill.name,
          description: res.skill.description,
          body: res.skill.body,
          icon: res.skill.icon,
          globs: res.skill.globs,
          alwaysAllow: res.skill.alwaysAllow,
          requiredSources: res.skill.requiredSources,
        }
      } catch (err) {
        console.warn('[skills] LLM generate failed, falling back to mock', err)
        error.value = err instanceof Error ? err.message : String(err)
        return mockDraft(trimmed)
      }
    } finally {
      isGenerating.value = false
    }
  }

  const edit = async (prompt: string, current: Skill): Promise<SkillDraft | null> => {
    const trimmed = prompt.trim()
    if (!trimmed) {
      error.value = 'Edit instruction cannot be empty'
      return null
    }
    isGenerating.value = true
    error.value = null
    // Strip source/projectId from the payload — those are storage metadata, not
    // skill content the LLM should see or reason about.
    const currentSkillPayload = {
      id: current.id,
      name: current.name,
      description: current.description,
      body: current.body,
      icon: current.icon,
      globs: current.globs,
      alwaysAllow: current.alwaysAllow,
      requiredSources: current.requiredSources,
    }
    try {
      const account = settings.activeAccount('anthropic')
      if (!sidecar.available || !account) {
        await new Promise<void>((r) => {
          setTimeout(r, 350)
        })
        // Mock fallback: append the edit instruction as a "Revision note" line
        // so the user can at least see SOMETHING change without LLM access.
        return {
          ...current,
          body: `${current.body}\n\n<!-- Edit requested: ${trimmed} -->`,
        }
      }
      try {
        const res = await sidecar.request<GenerateResponse>('skills.generate', {
          prompt: trimmed,
          accountId: account.id,
          currentSkill: currentSkillPayload,
        })
        return {
          id: res.skill.id,
          source: current.source,
          projectId: current.projectId,
          name: res.skill.name,
          description: res.skill.description,
          body: res.skill.body,
          icon: res.skill.icon,
          globs: res.skill.globs,
          alwaysAllow: res.skill.alwaysAllow,
          requiredSources: res.skill.requiredSources,
        }
      } catch (err) {
        console.warn('[skills] LLM edit failed', err)
        error.value = err instanceof Error ? err.message : String(err)
        return null
      }
    } finally {
      isGenerating.value = false
    }
  }

  return { generate, edit, isGenerating, error }
}
