/* eslint-disable no-template-curly-in-string */
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
  const m = prompt.trim().match(/^[^.!?\n]+[.!?]?/)
  return m ? m[0].trim() : prompt.trim().slice(0, 140)
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

export const useHookGenerator = () => {
  const isGenerating = ref(false)
  const error = ref<string | null>(null)

  const generate = async (prompt: string): Promise<HookDraft | null> => {
    const trimmed = prompt.trim()
    if (!trimmed) {
      error.value = 'Prompt cannot be empty'
      return null
    }
    isGenerating.value = true
    error.value = null
    try {
      await new Promise((resolve) => {
        setTimeout(resolve, 400)
      })
      return mockGenerate(trimmed)
    } finally {
      isGenerating.value = false
    }
  }

  return { generate, isGenerating, error }
}
