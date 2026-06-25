import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'

// Skills store — dual-path live (SKILL.md 5-tier, ADR 0013). When the Electron
// bridge is available `loadSkills()` scans the user/global tier + every passed
// project tier over IPC, and an `skills.fs-changed` subscription re-hydrates when
// files are touched outside the app; browser-dev seeds a small mock. Mirrors
// stores/agents.ts + stores/connections.ts dual-path pattern.
//
// This is the REFERENCE store the sibling library features (agents, commands,
// rules, hooks, connections) mirror: inline slice types, readonly-state + named
// async actions, mock seed gated on `!sc.available`.

export type SkillSource = 'global' | 'project'

// Skill entity (mirror of sidecar Skill — apps/desktop/sidecar/src/types/shared.ts).
// NOT imported from the sidecar package; the store owns its own minimal slice.
export type Skill = {
  id: string
  source: SkillSource
  projectId?: string
  name: string
  description: string
  body: string
  globs?: string[]
  alwaysAllow?: string[]
  icon?: string
  requiredSources?: string[]
}

// Per-tier scan report (1 entry per scanned dir). Surfaces resolved paths +
// counts so a misconfigured HOME / missing dir is diagnosable.
export type SkillScanReport = {
  dir: string
  source: SkillSource
  found: number
}

// Draft a save accepts — every content field plus the storage metadata.
export type SkillInput = Skill

type SkillsListResponse = { skills: Skill[]; reports?: SkillScanReport[] }
type SkillUpsertResponse = { skill: Skill }

function mockSkills(): Skill[] {
  return [
    {
      id: 'design-ui-ux',
      source: 'project',
      projectId: 'awog',
      name: 'design-ui-ux',
      description: 'UI/UX design intelligence cho AWOG',
      body: '# Skill: Design UI/UX (AWOG desktop)\n\nDesign intelligence — chọn style/màu/typography, dựng component, tự review.\n\n## Khi nào dùng\nBắt buộc khi task chạm bố cục, quyết định thị giác, pattern tương tác, chất lượng UX.',
    },
    {
      id: 'write-adr',
      source: 'global',
      name: 'write-adr',
      description: 'Author an Architecture Decision Record',
      body: '# write-adr\n\nAuthor an ADR with Context / Decision / Consequences.',
    },
    {
      id: 'security-audit',
      source: 'global',
      name: 'security-audit',
      description: '21-rule vulnerability catalog',
      body: '# security-audit\n\nApply the 21-rule catalog + AWOG invariants. Output findings.',
    },
    {
      id: 'implement-feature',
      source: 'global',
      name: 'implement-feature',
      description: 'Implement một dev task end-to-end',
      body: '# implement-feature\n\nRead spec/ADR → code theo coding-guide → lint + typecheck.',
    },
    {
      id: 'review-pr',
      source: 'global',
      name: 'review-pr',
      description: 'Code review trên diff/PR',
      body: '# review-pr\n\nVerify architecture fit, AWOG invariants, security, perf.',
    },
  ]
}

// Composite identity — a skill is keyed by (source, projectId, id) so a project
// skill and a global skill can share an id without colliding.
const matchKey = (a: Skill, b: { source: SkillSource; projectId?: string; id: string }): boolean =>
  a.source === b.source &&
  (a.projectId ?? undefined) === (b.projectId ?? undefined) &&
  a.id === b.id

export const useSkillsStore = defineStore('skills', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const skills = ref<Skill[]>(sc.available ? [] : mockSkills())
  const scanReports = ref<SkillScanReport[]>([])
  const loaded = ref(false)

  let unlisten: UnlistenFn | null = null

  // Stable composite key for list selection / dedupe.
  const skillKey = (s: Pick<Skill, 'id' | 'source' | 'projectId'>): string =>
    `${s.source}|${s.projectId ?? ''}|${s.id}`

  const skillByKey = (key: string): Skill | undefined =>
    skills.value.find((s) => skillKey(s) === key)

  // Scan the user/global tier + every passed project tier. Default scope is the
  // global tier only (siblings pass projectIds when they have a project roster).
  async function loadSkills(projectIds?: string[]): Promise<void> {
    if (!available.value) {
      loaded.value = true
      return
    }
    try {
      // Pass an explicit object (never `undefined`) — the IPC boundary maps
      // undefined params → null and the sidecar zod schema rejects null.
      const ids = projectIds ?? []
      const params = ids.length > 0 ? { projectIds: ids } : {}
      const res = await sc.request<SkillsListResponse>('skills.list', params)
      skills.value = Array.isArray(res.skills) ? res.skills : []
      scanReports.value = Array.isArray(res.reports) ? res.reports : []
    } catch (err) {
      console.warn('[skills] loadSkills failed', err)
    } finally {
      loaded.value = true
      void subscribe()
    }
  }

  // Create-or-update. `previousId` (set when the slug changed) drives a rename on
  // disk. Returns the persisted skill. Browser-dev mutates the local list only.
  async function saveSkill(data: SkillInput, previousId?: string): Promise<Skill> {
    const slugChanged = previousId !== undefined && previousId !== data.id
    const targetKey = { source: data.source, projectId: data.projectId, id: data.id }
    const isUpdate = slugChanged || skills.value.some((s) => matchKey(s, targetKey))

    if (available.value) {
      const params: Record<string, unknown> = { skill: data, mode: isUpdate ? 'update' : 'create' }
      if (slugChanged) params.previousId = previousId
      const res = await sc.request<SkillUpsertResponse>('skills.upsert', params)
      if (slugChanged) {
        skills.value = skills.value.filter(
          (s) =>
            !matchKey(s, {
              source: data.source,
              projectId: data.projectId,
              id: previousId as string,
            }),
        )
      }
      const existing = skills.value.find((s) => matchKey(s, res.skill))
      if (existing) Object.assign(existing, res.skill)
      else skills.value.push(res.skill)
      return res.skill
    }

    // Browser-dev mock path.
    if (slugChanged) {
      skills.value = skills.value.filter(
        (s) =>
          !matchKey(s, {
            source: data.source,
            projectId: data.projectId,
            id: previousId as string,
          }),
      )
    }
    const existing = skills.value.find((s) => matchKey(s, targetKey))
    if (existing) Object.assign(existing, data)
    else skills.value.push({ ...data })
    return data
  }

  async function deleteSkill(id: string, source: SkillSource, projectId?: string): Promise<void> {
    // Optimistic local removal (re-hydrate corrects it on fs-changed).
    skills.value = skills.value.filter((s) => !matchKey(s, { id, source, projectId }))
    if (!available.value) return
    try {
      const params: Record<string, unknown> = { id, source }
      if (projectId) params.projectId = projectId
      await sc.request('skills.delete', params)
    } catch (err) {
      console.warn('[skills] deleteSkill failed', err)
    }
  }

  // Duplicate a skill into a new slug (`-copy` suffix, deduped). Same tier. The
  // copy is created via saveSkill in create mode.
  async function duplicateSkill(source: Skill): Promise<Skill> {
    const base = `${source.id}-copy`
    let candidate = base
    let n = 2
    while (
      skills.value.some((s) =>
        matchKey(s, { source: source.source, projectId: source.projectId, id: candidate }),
      )
    ) {
      candidate = `${base}-${n}`
      n += 1
    }
    const copy: SkillInput = { ...source, id: candidate, name: `${source.name} (copy)` }
    return saveSkill(copy)
  }

  // One-shot LLM draft from a natural-language prompt (skills.generate). Returns
  // a draft (no `source`/`projectId` — the editor picks the tier). Throws on
  // failure so the caller can fall back to a local mock.
  async function generateSkill(
    prompt: string,
    accountId: string,
    currentSkill?: Partial<Skill>,
  ): Promise<Skill> {
    const params: Record<string, unknown> = { prompt, accountId }
    if (currentSkill) params.currentSkill = currentSkill
    const res = await sc.request<SkillUpsertResponse>('skills.generate', params)
    return res.skill
  }

  async function subscribe(): Promise<void> {
    if (!available.value || unlisten) return
    try {
      unlisten = await sc.onEvent((evt) => {
        if (!evt || evt.type !== 'skills.fs-changed') return
        // Re-hydrate against the same project scope we last loaded. Project ids
        // are derived from the current list so the scan stays consistent.
        const ids = Array.from(
          new Set(skills.value.filter((s) => s.projectId).map((s) => s.projectId as string)),
        )
        void loadSkills(ids)
      })
    } catch {
      unlisten = null
    }
  }

  return {
    // state
    skills,
    scanReports,
    loaded,
    available,
    // getters
    skillKey,
    skillByKey,
    // actions
    loadSkills,
    saveSkill,
    deleteSkill,
    duplicateSkill,
    generateSkill,
  }
})
