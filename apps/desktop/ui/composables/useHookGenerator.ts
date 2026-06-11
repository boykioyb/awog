import type { Ref } from 'vue'
import type { Hook, HookEvent, HookRunMode } from '~/types'

export type HookDraft = Omit<Hook, 'id'> & { id: string }

const inferEvent = (prompt: string): HookEvent => {
  const lower = prompt.toLowerCase()
  if (/(approve|approval)/.test(lower)) {
    return lower.includes('before') ? 'phase.before-approve' : 'phase.after-approve'
  }
  if (/(write|format|prettier|save|file)/.test(lower)) {
    return lower.includes('before') ? 'artifact.before-write' : 'artifact.after-write'
  }
  if (/(complete|done|finish|notify|slack|email)/.test(lower)) return 'task.after-complete'
  if (/(start|begin|kick)/.test(lower)) return 'task.before-start'
  if (/(tool call|tool use|mcp)/.test(lower)) return 'tool.after-call'
  if (/(prompt|llm|model)/.test(lower)) return 'agent.before-prompt'
  if (/(reset|clear|session)/.test(lower)) return 'session.reset'
  return 'artifact.after-write'
}

const inferRunMode = (prompt: string, event: HookEvent): HookRunMode => {
  if (event.includes('before-')) return 'blocking'
  const lower = prompt.toLowerCase()
  if (/(block|prevent|reject|deny|validate|check)/.test(lower)) return 'blocking'
  return 'background'
}

const inferMatcher = (prompt: string, event: HookEvent): Record<string, string> => {
  const lower = prompt.toLowerCase()
  if (event.startsWith('artifact')) {
    if (/\.ts\b|typescript/.test(lower)) return { path: '**/*.{ts,vue}' }
    if (/\.md\b|markdown/.test(lower)) return { path: '**/*.md' }
    if (/\.py\b|python/.test(lower)) return { path: '**/*.py' }
    if (/\.json\b/.test(lower)) return { path: '**/*.json' }
  }
  if (event === 'task.after-complete' && /fail/.test(lower)) {
    return { status: 'failed' }
  }
  return {}
}

const inferCommand = (prompt: string, event: HookEvent): string => {
  const lower = prompt.toLowerCase()
  if (/prettier/.test(lower)) return 'pnpm exec prettier --write {{event.payload.path}}'
  if (/eslint|lint/.test(lower)) return 'pnpm exec eslint {{event.payload.path}}'
  if (/black|python format/.test(lower)) return 'black {{event.payload.path}}'
  if (/commit|git add/.test(lower)) {
    return 'git add -A && git commit -m "AWOG: {{event.event}}" --allow-empty'
  }
  if (/slack|webhook/.test(lower)) {
    return (
      'curl -X POST -H "Content-type: application/json" ' +
      '--data \'{"text":"AWOG: {{event.event}} {{event.taskId}}"}\' $SLACK_WEBHOOK'
    )
  }
  if (/notification|notify/.test(lower)) {
    return 'osascript -e \'display notification "{{event.event}}" with title "AWOG"\''
  }
  if (event.startsWith('artifact.before-write')) return 'node ./.awog/hooks/guard.mjs'
  return 'node ./.awog/hooks/run.mjs'
}

const slugify = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, 4)
    .join('-')
    .slice(0, 40) || 'new-hook'

const firstSentence = (prompt: string): string => {
  const m = prompt.match(/^[^.!?\n]+[.!?]?/)
  return m ? m[0].trim() : prompt.slice(0, 140)
}

const mockGenerate = (prompt: string): HookDraft => {
  const event = inferEvent(prompt)
  const runMode = inferRunMode(prompt, event)
  const id = slugify(prompt)
  const name = id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  return {
    id,
    name,
    description: firstSentence(prompt),
    event,
    matcher: inferMatcher(prompt, event),
    command: inferCommand(prompt, event),
    cwd: '${workspace}',
    timeoutMs: runMode === 'blocking' ? 10000 : 30000,
    runMode,
    enabled: true,
    env: {},
    recentRuns: [],
  }
}

interface HookGenerator {
  generate: (prompt: string) => Promise<HookDraft | null>
  edit: (prompt: string, current: Hook) => Promise<HookDraft | null>
  isGenerating: Ref<boolean>
  error: Ref<string | null>
}

interface GenerateResponse {
  hook: {
    name: string
    description: string
    event: HookEvent
    matcher: Record<string, string>
    command: string
    cwd: string
    timeoutMs: number
    runMode: HookRunMode
  }
}

// Build a HookDraft from the LLM config, preserving identity/runtime fields of
// the edited hook (id/enabled/env/source/projectId/recentRuns).
const fromConfig = (cfg: GenerateResponse['hook'], base: Hook | null): HookDraft => ({
  id: base?.id ?? slugify(cfg.name),
  name: cfg.name,
  description: cfg.description,
  event: cfg.event,
  matcher: cfg.matcher ?? {},
  command: cfg.command,
  cwd: cfg.cwd || '${workspace}',
  timeoutMs: cfg.timeoutMs ?? 30000,
  runMode: cfg.runMode ?? 'background',
  enabled: base?.enabled ?? true,
  env: base?.env ?? {},
  recentRuns: base?.recentRuns ?? [],
  ...(base?.source ? { source: base.source } : {}),
  ...(base?.projectId ? { projectId: base.projectId } : {}),
})

// LLM-backed (mock fallback) generator. `generate` drafts from scratch; `edit`
// revises an existing hook given the current hook as context.
export const useHookGenerator = (): HookGenerator => {
  const isGenerating = ref(false)
  const error = ref<string | null>(null)
  const sidecar = useSidecar()
  const settings = useSettingsStore()

  const mockEdit = (prompt: string, current: Hook): HookDraft => ({
    ...mockGenerate(prompt),
    id: current.id,
    enabled: current.enabled,
    env: current.env ?? {},
    recentRuns: current.recentRuns ?? [],
    ...(current.source ? { source: current.source } : {}),
    ...(current.projectId ? { projectId: current.projectId } : {}),
  })

  const run = async (prompt: string, current: Hook | null): Promise<HookDraft | null> => {
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
        await new Promise<void>((r) => setTimeout(r, 350))
        return current ? mockEdit(trimmed, current) : mockGenerate(trimmed)
      }
      try {
        const params: Record<string, unknown> = { prompt: trimmed, accountId: account.id }
        if (current) {
          params.currentHook = {
            name: current.name,
            description: current.description,
            event: current.event,
            matcher: current.matcher,
            command: current.command,
            cwd: current.cwd,
            timeoutMs: current.timeoutMs,
            runMode: current.runMode,
          }
        }
        const res = await sidecar.request<GenerateResponse>('hooks.generate', params)
        return fromConfig(res.hook, current)
      } catch (err) {
        console.warn('[hooks] LLM generate failed, falling back to mock', err)
        error.value = err instanceof Error ? err.message : String(err)
        return current ? mockEdit(trimmed, current) : mockGenerate(trimmed)
      }
    } finally {
      isGenerating.value = false
    }
  }

  return {
    generate: (prompt) => run(prompt, null),
    edit: (prompt, current) => run(prompt, current),
    isGenerating,
    error,
  }
}
