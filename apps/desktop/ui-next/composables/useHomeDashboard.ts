// Home dashboard orchestrator — derives the cross-store view the bento tiles bind
// to (attention queue, running counts, agent status, git summary, token usage).
// SoC: it only reads the live Pinia stores (sessions/tasks/connections/agents/git)
// + reaches the sidecar for the `dashboard.usage` metric. No fs/SDK access. The
// page (pages/index.vue) stays a thin template binding this composable's refs.
//
// Init: triggers each store's loader + the usage fetch on mount; refreshes usage
// on an interval and cleans it up via onScopeDispose (registered on the calling
// component instance).
import { computed, onScopeDispose, ref } from 'vue'
import { useSidecar } from '~/composables/useSidecar'
import { useSessionsStore } from '~/stores/sessions'
import { useTasksStore } from '~/stores/tasks'
import { useI18n } from '~/composables/useI18n'

// One item in the "needs your attention" queue. `kind` styles the icon; `action`
// labels the CTA; `to` is the route the CTA navigates to.
export type AttentionItem = {
  id: string
  kind: 'reply' | 'permission' | 'approval'
  title: string
  sub: string
  action: 'reply' | 'review' | 'approve'
  to: '/sessions' | '/tasks'
  // Sort key (ms epoch) — newest first.
  at: number
}

export type RunningCount = { total: number; tasks: number; sessions: number }

export type DashboardUsage = {
  today: number
  yesterday: number
  buckets: number[]
  ratePerMin: number
}

const USAGE_REFRESH_MS = 45_000

function mockUsage(): DashboardUsage {
  return {
    today: 2_400_000,
    yesterday: 2_030_000,
    buckets: [22, 38, 18, 46, 60, 34, 72, 88, 50, 64, 95, 40],
    ratePerMin: 14_000,
  }
}

export function useHomeDashboard() {
  const sc = useSidecar()
  const { t } = useI18n()
  const sessions = useSessionsStore()
  const tasks = useTasksStore()

  // ── Attention queue: sessions needing reply/permission/question + tasks
  // waiting for approval. Newest first. ──
  const attentionItems = computed<AttentionItem[]>(() => {
    const items: AttentionItem[] = []

    for (const s of sessions.sessions) {
      if (s.status !== 'awaiting') continue
      // Classify by the last assistant message's open block (perm vs question).
      const lastAssistant = [...s.msgs].reverse().find((m) => m.role === 'assistant')
      let kind: AttentionItem['kind'] = 'reply'
      let action: AttentionItem['action'] = 'reply'
      let sub = t('home.attention.sub.reply', { model: s.model })
      if (lastAssistant && lastAssistant.role === 'assistant') {
        const hasPerm = lastAssistant.blocks.some(
          (b) => b.kind === 'perm' && b.status === 'pending' && !b.cancelled,
        )
        const hasQuestion = lastAssistant.blocks.some(
          (b) => b.kind === 'question' && !b.answer && !b.cancelled,
        )
        if (hasPerm) {
          kind = 'permission'
          action = 'review'
          sub = t('home.attention.sub.permission')
        } else if (hasQuestion) {
          kind = 'reply'
          action = 'reply'
          sub = t('home.attention.sub.question', { model: s.model })
        }
      }
      items.push({
        id: `ses-${s.id}`,
        kind,
        title: s.title,
        sub,
        action,
        to: '/sessions',
        at: parseWhen(s.when),
      })
    }

    for (const task of tasks.awaitingTasks) {
      const prog = tasks.progressOf(task)
      items.push({
        id: `task-${task.id}`,
        kind: 'approval',
        title: task.title,
        sub: t('home.attention.sub.approval', { skill: prog.currentSkill ?? '' }),
        action: 'approve',
        to: '/tasks',
        at: parseIso(task.createdAt),
      })
    }

    return items.sort((a, b) => b.at - a.at)
  })

  // ── Running counts ──
  const runningCount = computed<RunningCount>(() => {
    const taskN = tasks.runningTasks.length
    const sessionN = sessions.sessions.filter((s) => s.status === 'streaming').length
    return { total: taskN + sessionN, tasks: taskN, sessions: sessionN }
  })

  // Running tasks (for the running tile), tagged with derived progress.
  const runningTaskRows = computed(() =>
    tasks.runningTasks.map((task) => ({ task, progress: tasks.progressOf(task) })),
  )

  // ── Usage metric (dashboard.usage) ──
  const usage = ref<DashboardUsage>(sc.available ? emptyUsage() : mockUsage())
  let usageTimer: ReturnType<typeof setInterval> | null = null

  async function fetchUsage(): Promise<void> {
    if (!sc.available) {
      usage.value = mockUsage()
      return
    }
    try {
      const res = await sc.request<DashboardUsage>('dashboard.usage')
      usage.value = {
        today: res.today ?? 0,
        yesterday: res.yesterday ?? 0,
        buckets: Array.isArray(res.buckets) ? res.buckets : [],
        ratePerMin: res.ratePerMin ?? 0,
      }
    } catch (err) {
      console.warn('[home] dashboard.usage failed', err)
    }
  }

  // today vs yesterday delta as a fraction (0.18 = +18%). 0 when no baseline.
  const deltaPct = computed<number>(() => {
    const y = usage.value.yesterday
    if (!y) return 0
    return (usage.value.today - y) / y
  })

  // Sparkline heights normalized 0..100 against the bucket max; index of the
  // tallest bucket gets the `hi` highlight.
  const sparkline = computed<{ height: number; hi: boolean }[]>(() => {
    const buckets = usage.value.buckets
    if (!buckets.length) return []
    const max = Math.max(...buckets, 1)
    const peak = buckets.indexOf(max)
    return buckets.map((v, i) => ({
      height: Math.max(3, Math.round((v / max) * 100)),
      hi: i === peak,
    }))
  })

  // ── Init ──
  void sessions.hydrate?.()
  void tasks.loadTasks()
  void fetchUsage()
  usageTimer = setInterval(() => void fetchUsage(), USAGE_REFRESH_MS)

  onScopeDispose(() => {
    if (usageTimer) {
      clearInterval(usageTimer)
      usageTimer = null
    }
  })

  return {
    attentionItems,
    runningCount,
    runningTaskRows,
    usage,
    deltaPct,
    sparkline,
    // store-backed loaded flags for skeletons
    sessions,
    tasks,
  }
}

function emptyUsage(): DashboardUsage {
  return { today: 0, yesterday: 0, buckets: [], ratePerMin: 0 }
}

// Parse a session `when` relative label ("3m" / "2h" / "vừa xong") back to a
// rough epoch for sorting. Best-effort: unknown → now.
function parseWhen(when: string): number {
  const now = Date.now()
  const m = /^(\d+)\s*([mhd])$/.exec(when.trim())
  if (!m) return now
  const n = Number(m[1])
  const unit = m[2]
  if (unit === 'm') return now - n * 60_000
  if (unit === 'h') return now - n * 3_600_000
  if (unit === 'd') return now - n * 86_400_000
  return now
}

function parseIso(iso: string): number {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? Date.now() : ms
}
