import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidecar, type UnlistenFn } from '~/composables/useSidecar'

// Rules store — dual-path live (instruction .md, 2-tier, ADR 0033). Markdown
// instruction files auto-injected into the system prompt of Sessions + Tasks,
// each with an `enabled` toggle. When the Electron bridge is available
// `loadRules()` scans the user/global tier + every passed project tier over IPC,
// and a `rules.fs-changed` subscription re-hydrates when files are touched
// outside the app; browser-dev seeds a small mock. Mirrors stores/skills.ts +
// stores/agents.ts dual-path pattern.

export type RuleSource = 'global' | 'project'

// Rule entity (mirror of sidecar Rule — apps/desktop/sidecar/src/types/shared.ts).
// NOT imported from the sidecar package; the store owns its own minimal slice.
export type Rule = {
  id: string
  source: RuleSource
  projectId?: string
  name: string
  description: string
  // The instruction text injected into the system prompt.
  body: string
  enabled: boolean
  // Glob patterns scoping the rule (ADR 0050). Non-empty → inject only when a
  // referenced path matches; empty/absent → always inject.
  globs?: string[]
  // Imported Claude Code file: not editable in AWOG, always injected.
  readOnly?: boolean
}

// Per-tier scan report (1 entry per scanned dir). Surfaces resolved paths +
// counts so a misconfigured HOME / missing dir is diagnosable.
export type RuleScanReport = {
  dir: string
  source: RuleSource
  found: number
  projectId?: string
}

// Draft a save accepts — every content field plus the storage metadata.
export type RuleInput = Rule

// Draft the LLM returns (rules.generate) — content only, no storage metadata.
export type RuleDraft = { name: string; description: string; body: string }

type RulesListResponse = { rules: Rule[]; reports?: RuleScanReport[] }
type RuleGenerateResponse = { rule: RuleDraft }

function mockRules(): Rule[] {
  return [
    {
      id: 'principles',
      source: 'project',
      projectId: 'awog',
      name: 'Principles',
      description: 'KISS / YAGNI / DRY / SRP',
      enabled: true,
      body: '# Principles\n\nKhi xung đột: KISS + YAGNI thắng DRY (chấp nhận trùng tạm).',
    },
    {
      id: 'typescript',
      source: 'project',
      projectId: 'awog',
      name: 'TypeScript',
      description: 'strict:true · cấm any',
      enabled: true,
      body: '# TypeScript\n\nstrict luôn bật. Cấm any → dùng unknown rồi narrow.',
    },
    {
      id: 'security',
      source: 'global',
      name: 'Security',
      description: '8 invariant AWOG',
      enabled: true,
      body: '# Security\n\nAPI key không rời sidecar; path sanitize; git scope = workspace.',
    },
    {
      id: 'nuxt-vue',
      source: 'global',
      name: 'Nuxt / Vue',
      description: 'Component / store / theme',
      enabled: false,
      body: '# Nuxt / Vue\n\n<script setup> luôn; defineProps type-only; theme qua useTheme().',
    },
  ]
}

// Composite identity — a rule is keyed by (source, projectId, id) so a project
// rule and a global rule can share an id without colliding.
const matchKey = (a: Rule, b: { source: RuleSource; projectId?: string; id: string }): boolean =>
  a.source === b.source &&
  (a.projectId ?? undefined) === (b.projectId ?? undefined) &&
  a.id === b.id

export const useRulesStore = defineStore('rules', () => {
  const sc = useSidecar()
  const available = computed(() => sc.available)

  const rules = ref<Rule[]>(sc.available ? [] : mockRules())
  const scanReports = ref<RuleScanReport[]>([])
  const loaded = ref(false)

  let unlisten: UnlistenFn | null = null

  // Stable composite key for list selection / dedupe.
  const ruleKey = (r: Pick<Rule, 'id' | 'source' | 'projectId'>): string =>
    `${r.source}|${r.projectId ?? ''}|${r.id}`

  const ruleByKey = (key: string): Rule | undefined => rules.value.find((r) => ruleKey(r) === key)

  // Scan the user/global tier + every passed project tier. Default scope is the
  // global tier only (the page passes projectIds when it has a project roster).
  async function loadRules(projectIds?: string[]): Promise<void> {
    if (!available.value) {
      loaded.value = true
      return
    }
    try {
      // Pass an explicit object (never `undefined`) — the IPC boundary maps
      // undefined params → null and the sidecar zod schema rejects null.
      const ids = projectIds ?? []
      const params = ids.length > 0 ? { projectIds: ids } : {}
      const res = await sc.request<RulesListResponse>('rules.list', params)
      rules.value = Array.isArray(res.rules) ? res.rules.map(normalize) : []
      scanReports.value = Array.isArray(res.reports) ? res.reports : []
    } catch (err) {
      console.warn('[rules] loadRules failed', err)
    } finally {
      loaded.value = true
      void subscribe()
    }
  }

  // Sidecar list may omit `source` (defaults to global tier); normalize so the
  // store always carries an explicit source for keying.
  function normalize(r: Rule): Rule {
    return { ...r, source: r.source ?? 'global' }
  }

  // Create-or-update. `previousId` (set when the slug changed) drives a rename on
  // disk. Returns the persisted rule. Browser-dev mutates the local list only.
  async function saveRule(data: RuleInput, previousId?: string): Promise<Rule> {
    const slugChanged = previousId !== undefined && previousId !== data.id
    const targetKey = { source: data.source, projectId: data.projectId, id: data.id }
    const isUpdate = slugChanged || rules.value.some((r) => matchKey(r, targetKey))

    if (available.value) {
      const params: Record<string, unknown> = { rule: data, mode: isUpdate ? 'update' : 'create' }
      if (slugChanged) params.previousId = previousId
      await sc.request('rules.upsert', params)
      if (slugChanged) {
        rules.value = rules.value.filter(
          (r) =>
            !matchKey(r, {
              source: data.source,
              projectId: data.projectId,
              id: previousId as string,
            }),
        )
      }
      const existing = rules.value.find((r) => matchKey(r, targetKey))
      if (existing) Object.assign(existing, data)
      else rules.value.push({ ...data })
      return data
    }

    // Browser-dev mock path.
    if (slugChanged) {
      rules.value = rules.value.filter(
        (r) =>
          !matchKey(r, {
            source: data.source,
            projectId: data.projectId,
            id: previousId as string,
          }),
      )
    }
    const existing = rules.value.find((r) => matchKey(r, targetKey))
    if (existing) Object.assign(existing, data)
    else rules.value.push({ ...data })
    return data
  }

  async function deleteRule(id: string, source: RuleSource, projectId?: string): Promise<void> {
    // Optimistic local removal (re-hydrate corrects it on fs-changed).
    rules.value = rules.value.filter((r) => !matchKey(r, { id, source, projectId }))
    if (!available.value) return
    try {
      const params: Record<string, unknown> = { id, source }
      if (projectId) params.projectId = projectId
      await sc.request('rules.delete', params)
    } catch (err) {
      console.warn('[rules] deleteRule failed', err)
    }
  }

  // Flip the `enabled` flag (auto-inject on/off). Optimistic; sidecar persists.
  async function toggleRule(id: string, source: RuleSource, projectId?: string): Promise<void> {
    const r = rules.value.find((x) => matchKey(x, { id, source, projectId }))
    if (!r) return
    r.enabled = !r.enabled
    if (!available.value) return
    try {
      const params: Record<string, unknown> = { id, source, enabled: r.enabled }
      if (projectId) params.projectId = projectId
      await sc.request('rules.toggle', params)
    } catch (err) {
      console.warn('[rules] toggleRule failed', err)
      r.enabled = !r.enabled // revert on failure
    }
  }

  // One-shot LLM draft from a natural-language prompt (rules.generate). Returns a
  // content-only draft (no `source`/`projectId`/`id` — the caller picks the tier
  // + slug). When `currentRule` is set the model REVISES instead of drafting.
  async function generateRule(
    prompt: string,
    accountId: string,
    currentRule?: { name: string; description: string; body: string },
  ): Promise<RuleDraft> {
    const params: Record<string, unknown> = { prompt, accountId }
    if (currentRule) params.currentRule = currentRule
    const res = await sc.request<RuleGenerateResponse>('rules.generate', params)
    return res.rule
  }

  async function subscribe(): Promise<void> {
    if (!available.value || unlisten) return
    try {
      unlisten = await sc.onEvent((evt) => {
        if (!evt || evt.type !== 'rules.fs-changed') return
        // Re-hydrate against the same project scope we last loaded. Project ids
        // are derived from the current list so the scan stays consistent.
        const ids = Array.from(
          new Set(rules.value.filter((r) => r.projectId).map((r) => r.projectId as string)),
        )
        void loadRules(ids)
      })
    } catch {
      unlisten = null
    }
  }

  return {
    // state
    rules,
    scanReports,
    loaded,
    available,
    // getters
    ruleKey,
    ruleByKey,
    // actions
    loadRules,
    saveRule,
    deleteRule,
    toggleRule,
    generateRule,
  }
})
