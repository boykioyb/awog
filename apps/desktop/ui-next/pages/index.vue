<template>
  <section class="flex min-w-0 flex-1 overflow-hidden" data-page="home">
    <div class="flex-1 overflow-y-auto p-5">
      <div class="grid grid-cols-1 gap-3.5 sm:grid-cols-6 lg:grid-cols-12">
        <!-- Needs attention (sessions awaiting reply/permission + tasks awaiting approval) -->
        <Card class="min-w-0 gap-0 p-4 sm:col-span-6 lg:col-span-8">
          <div class="mb-3 flex items-center gap-2">
            <Icon name="clock" class="text-muted-foreground" />
            <span class="text-sm text-muted-foreground">{{ t('home.attention.title') }}</span>
            <span class="ml-auto text-xs text-faint tabular-nums">
              {{ t('home.attention.count', { n: attentionItems.length }) }}
            </span>
          </div>
          <div v-if="!attentionReady" class="py-1.5 text-sm text-faint">{{ loadingLabel }}</div>
          <div v-else-if="!attentionItems.length" class="py-1.5 text-sm text-faint">
            {{ t('home.attention.empty') }}
          </div>
          <div v-else class="flex flex-col gap-2">
            <div
              v-for="item in attentionItems"
              :key="item.id"
              class="flex items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5"
            >
              <span
                class="grid size-7 shrink-0 place-items-center rounded-md bg-warning/20 text-warning"
              >
                <Icon :name="attentionIcon(item.kind)" class="size-3.5" />
              </span>
              <div class="min-w-0 flex-1">
                <div class="mb-0.5 truncate text-base font-semibold">{{ item.title }}</div>
                <div class="truncate text-sm text-muted-foreground">{{ item.sub }}</div>
              </div>
              <Button
                variant="outline"
                size="xs"
                class="shrink-0 border-selected-border text-primary"
                @click="navigateTo(item.to)"
              >
                {{ actionLabel(item.action) }}
              </Button>
            </div>
          </div>
        </Card>

        <!-- Running stat -->
        <Card class="min-w-0 gap-0 p-4 sm:col-span-3 lg:col-span-4">
          <div class="mb-2 text-xs text-muted-foreground">{{ t('home.running.label') }}</div>
          <div class="text-2xl font-semibold tracking-tight text-primary">
            {{ runningCount.total }}
          </div>
          <div class="mt-auto pt-2 text-xs text-faint tabular-nums">
            {{
              t('home.running.summary', {
                tasks: runningCount.tasks,
                sessions: runningCount.sessions,
                rate: formatTokens(usage.ratePerMin),
              })
            }}
          </div>
        </Card>

        <!-- Running tasks -->
        <Card class="min-w-0 gap-0 p-4 sm:col-span-6 lg:col-span-7">
          <div class="mb-3 flex items-center gap-2">
            <Icon name="play" class="text-muted-foreground" />
            <span class="text-sm text-muted-foreground">{{ t('home.running.title') }}</span>
            <span class="ml-auto text-xs text-faint tabular-nums">
              <Button variant="link" size="xs" class="h-auto p-0" @click="navigateTo('/tasks')">
                {{ t('home.openTasks') }}
              </Button>
            </span>
          </div>
          <div v-if="!tasks.loaded" class="py-1.5 text-sm text-faint">{{ loadingLabel }}</div>
          <div
            v-else-if="!runningTaskRows.length && !runningSessionRows.length"
            class="py-1.5 text-sm text-faint"
          >
            {{ t('home.running.empty') }}
          </div>
          <div v-else class="flex flex-col gap-3">
            <div v-for="row in runningTaskRows" :key="row.task.id">
              <div class="mb-1.5 flex items-center gap-2">
                <span
                  class="size-2 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
                />
                <span class="truncate text-base font-semibold">{{ row.task.title }}</span>
                <span class="ml-auto shrink-0 text-sm text-muted-foreground">
                  {{ row.progress.currentAgentId ?? '' }}
                </span>
              </div>
              <div class="mb-2 text-sm text-muted-foreground">
                {{ t('home.running.node') }}
                <b class="font-medium">
                  {{ row.progress.doneNodes }}/{{ row.progress.totalNodes }}
                </b>
                <template v-if="row.progress.currentSkill">
                  · "{{ row.progress.currentSkill }}"
                </template>
              </div>
              <Progress :model-value="row.progress.pct" class="h-1.5" />
              <div class="mt-1.5 flex justify-between text-xs text-faint tabular-nums">
                <span>{{ t('home.running.elapsed', { time: elapsed(row.task.createdAt) }) }}</span>
                <span>{{ row.progress.pct }}%</span>
              </div>
            </div>
            <!-- Running sessions: no node-level progress, so a lighter clickable row. -->
            <div
              v-for="s in runningSessionRows"
              :key="'ses-' + s.id"
              class="cursor-pointer"
              @click="openSession(s.id)"
            >
              <div class="mb-1.5 flex items-center gap-2">
                <span
                  class="size-2 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
                />
                <span class="truncate text-base font-semibold">{{ s.title }}</span>
                <span class="ml-auto shrink-0 text-sm text-muted-foreground">{{ s.model }}</span>
              </div>
              <div class="text-sm text-muted-foreground">
                {{ t('home.running.session', { project: projectName(s.project) }) }}
              </div>
            </div>
          </div>
        </Card>

        <!-- Activity sparkline -->
        <Card class="min-w-0 gap-0 p-4 sm:col-span-6 lg:col-span-5">
          <div class="mb-3 flex items-center gap-2">
            <Icon name="act" class="text-muted-foreground" />
            <span class="text-sm text-muted-foreground">{{ t('home.activity.title') }}</span>
            <span class="ml-auto text-xs text-faint tabular-nums">
              <Button variant="link" size="xs" class="h-auto p-0" @click="openActivity()">
                {{ t('home.open') }}
              </Button>
            </span>
          </div>
          <div v-if="!sparkline.length" class="py-1.5 text-sm text-faint">
            {{ t('home.activity.empty') }}
          </div>
          <template v-else>
            <div class="mt-1 flex h-14 items-end gap-1">
              <i
                v-for="(bar, i) in sparkline"
                :key="i"
                class="min-h-0.5 flex-1 rounded-t-sm bg-primary"
                :class="bar.hi ? 'opacity-85' : 'opacity-40'"
                :style="{ height: bar.height + '%' }"
              />
            </div>
            <div class="mt-3 flex items-baseline justify-between">
              <span class="text-xl font-semibold">
                {{ formatTokens(usage.today) }}
                <span class="text-xs font-medium text-muted-foreground">
                  {{ t('home.activity.today') }}
                </span>
              </span>
              <span class="text-xs text-muted-foreground tabular-nums">{{ deltaLabel }}</span>
            </div>
          </template>
        </Card>

        <!-- Provider rate limits (real % quota from account.usage; empty accounts hide themselves) -->
        <Card class="min-w-0 gap-0 p-4 sm:col-span-6 lg:col-span-12">
          <div class="mb-3 flex items-center gap-2">
            <Icon name="act" class="text-muted-foreground" />
            <span class="text-sm text-muted-foreground">{{ t('home.rateLimit.title') }}</span>
            <span class="ml-auto text-xs text-faint tabular-nums">
              <Button variant="link" size="xs" class="h-auto p-0" @click="openActivity()">
                {{ t('home.open') }}
              </Button>
            </span>
          </div>
          <div v-if="!rateLimitAccounts.length" class="py-1.5 text-sm text-faint">
            {{ t('home.rateLimit.empty') }}
          </div>
          <!-- Mỗi account một card đầy đủ như trang Activity — auto-fill để tile rộng
               xếp các card cạnh nhau. -->
          <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-3.5">
            <ActivityRateLimit v-for="acc in rateLimitAccounts" :key="acc.id" :account="acc" />
          </div>
        </Card>

        <!-- Recent sessions -->
        <Card class="min-w-0 gap-0 p-4 sm:col-span-6 lg:col-span-12">
          <div class="mb-3 flex items-center gap-2">
            <Icon name="sessions" class="text-muted-foreground" />
            <span class="text-sm text-muted-foreground">{{ t('home.recent.title') }}</span>
            <span class="ml-auto text-xs text-faint tabular-nums">
              <Button variant="link" size="xs" class="h-auto p-0" @click="navigateTo('/workbench')">
                {{ t('home.all') }}
              </Button>
            </span>
          </div>
          <div v-if="!recentSessions.length" class="py-1.5 text-sm text-faint">
            {{ t('home.recent.empty') }}
          </div>
          <div
            v-for="s in recentSessions"
            v-else
            :key="s.id"
            class="flex cursor-pointer items-center gap-3 border-t py-2 transition-colors hover:bg-accent"
            @click="openSession(s.id)"
          >
            <span class="size-2 shrink-0 rounded-full" :class="sessionDot(s.status)" />
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ s.title }}</span>
            <Badge variant="outline" class="text-muted-foreground">
              {{ projectName(s.project) }}
            </Badge>
            <Badge variant="outline" class="text-muted-foreground">{{ s.model }}</Badge>
            <span class="shrink-0 text-xs whitespace-nowrap text-faint tabular-nums">
              {{ sessionStatusLabel(s.status, s.when) }}
            </span>
          </div>
        </Card>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
// Home — bento dashboard wired to the live stores (Phase B–E). All chrome +
// dynamic strings go through i18n (t); entity content comes from the sessions /
// tasks / connections / agents / git stores via useHomeDashboard. Browser-dev
// (no Electron bridge) leaves every store empty, so the bento shows its empty
// empties out during dev. navigateTo + useI18n are Nuxt auto-imports.
import { computed } from 'vue'
import { useHomeDashboard } from '~/composables/useHomeDashboard'
import { useAccounts } from '~/composables/useAccounts'
import { isBoardSession } from '~/composables/useSessionsData'
import type { SessionStatus } from '~/composables/useSessionsData'

const { t } = useI18n()
const { openActivity } = useActivityModal()
// session.project holds the engine projectId — resolve it to the display name
// (mirrors SessionListItem); unknown ids fall back to the id itself.
const { projectName } = useProjects()

// Provider rate-limit accounts — only providers with a usage surface (Anthropic
// subscription / OpenAI Codex). Each ActivityRateLimit self-hides if its account
// reports no rate-limit data, so the tile shows only accounts that have a quota.
const { accounts } = useAccounts()
const rateLimitAccounts = computed(() =>
  accounts.value.filter((a) => a.provider === 'Anthropic' || a.provider === 'OpenAI'),
)
const {
  attentionItems,
  runningCount,
  runningTaskRows,
  runningSessionRows,
  usage,
  deltaPct,
  sparkline,
  sessions,
  tasks,
} = useHomeDashboard()

const loadingLabel = computed(() => t('home.time.now'))

// Attention queue is "ready" once both source stores have a first load. Sessions
// hydrate async over IPC; tasks gate on `loaded`.
const attentionReady = computed(() => tasks.loaded)

const attentionIcon = (kind: 'reply' | 'permission' | 'approval'): string =>
  kind === 'permission' ? 'shield' : kind === 'approval' ? 'check' : 'alert'

const actionLabel = (action: 'reply' | 'review' | 'approve'): string =>
  action === 'review'
    ? t('home.review')
    : action === 'approve'
      ? t('home.approve')
      : t('home.reply')

// Recent sessions: newest first (sessions list is already recency-ordered), cap 6.
// Phiên "của board" (run member/lead mang teamId, lone-agent origin:'board')
// ẩn khỏi đây giống danh sách session — chúng sống trong board/Teams.
const recentSessions = computed(() =>
  sessions.sessions.filter((s) => !isBoardSession(s)).slice(0, 6),
)

// Open a session from the recent list — set it active in the shared sessions
// store (singleton), then route to /sessions which renders `store.active`.
// Mirrors the sessions page's own `store.setActive` select.
function openSession(id: number) {
  sessions.setActive(id)
  navigateTo('/workbench')
}

const deltaLabel = computed(() => {
  const pct = Math.round(Math.abs(deltaPct.value) * 100)
  if (pct === 0) return t('home.activity.deltaFlat')
  return deltaPct.value > 0
    ? t('home.activity.deltaUp', { pct })
    : t('home.activity.deltaDown', { pct })
})

// Compact token formatting: 2_400_000 → "2.4M", 14_000 → "14k".
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

// Elapsed time from an ISO createdAt → short "Xm Ys" label.
function elapsed(iso: string): string {
  const start = Date.parse(iso)
  if (Number.isNaN(start)) return '—'
  const sec = Math.max(0, Math.floor((Date.now() - start) / 1000))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

// Chấm trạng thái ở hàng phiên gần đây — class màu ngữ nghĩa.
const sessionDot = (status: SessionStatus): string =>
  status === 'streaming'
    ? 'bg-primary'
    : status === 'awaiting' || status === 'error'
      ? 'bg-warning'
      : 'bg-faint'

const sessionStatusLabel = (status: SessionStatus, when: string): string =>
  t(`home.recent.status.${status}`, { when })
</script>
