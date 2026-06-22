<!--
  Full-width Issues / Pull Requests list with filters (ADR 0049). State filter
  options vary by kind (issue: open/closed/all; pr: open/closed/merged/all).
  Assignee filter is server-side (re-fetch). Search filters the fetched rows
  client-side by title/number. PR rows add Merged state color, a Draft chip, and
  `base ← head`.
-->
<template>
  <div class="flex flex-col h-full min-h-0">
    <!-- Filters -->
    <div class="flex items-center gap-2 flex-wrap px-1 pb-3">
      <div class="w-32">
        <AppSelect :model-value="stateFilter" @update:model-value="emit('update:state', $event)">
          <option v-for="opt in stateOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </option>
        </AppSelect>
      </div>
      <div class="w-48">
        <AppSelect
          :model-value="assigneeFilter"
          @update:model-value="emit('update:assignee', $event)"
        >
          <option value="">{{ tr('project.github.assignee_anyone') }}</option>
          <option value="@me">{{ tr('project.github.assignee_me') }}</option>
          <option v-for="login in knownAssignees" :key="login" :value="login">@{{ login }}</option>
        </AppSelect>
      </div>
      <div class="flex-1 min-w-[10rem]">
        <SearchInput
          :model-value="searchQuery"
          :placeholder="tr('project.github.search_placeholder')"
          @update:model-value="emit('update:search', $event)"
        />
      </div>
      <button
        class="p-1.5 rounded transition flex-shrink-0"
        :style="{ color: t.textDim }"
        :title="tr('project.github.refresh')"
        :disabled="loading"
        @click="emit('refresh')"
      >
        <RefreshCw :size="14" :class="loading ? 'animate-spin' : ''" />
      </button>
    </div>

    <!-- States -->
    <div class="flex-1 overflow-y-auto min-h-0">
      <div
        v-if="loading && items.length === 0"
        class="flex items-center justify-center gap-2 py-12 text-[1em]"
        :style="{ color: t.textDim }"
      >
        <Loader2 :size="14" class="animate-spin" />
        {{ tr('project.github.loading') }}
      </div>

      <div v-else-if="errorCode" class="py-10 px-4 text-center">
        <AlertTriangle :size="24" class="mx-auto mb-3" :style="{ color: t.warning }" />
        <div class="text-[1em] font-medium mb-1" :style="{ color: t.text }">
          {{ errorTitle }}
        </div>
        <div class="text-[1em] mb-3" :style="{ color: t.textDim }">{{ errorHint }}</div>
        <a
          v-if="errorCode === 'GH_NOT_FOUND'"
          class="text-[1em] underline cursor-pointer"
          :style="{ color: t.accent }"
          @click="openCliSite"
        >
          cli.github.com
        </a>
      </div>

      <div
        v-else-if="items.length === 0"
        class="py-12 text-center text-[1em]"
        :style="{ color: t.textFaint }"
      >
        {{ emptyText }}
      </div>

      <div v-else class="space-y-1.5 px-1">
        <button
          v-for="it in items"
          :key="it.number"
          class="w-full text-left rounded px-3 py-2.5 transition flex items-start gap-3"
          :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
          @click="emit('select', it.number)"
          @mouseenter="(e) => ((e.currentTarget as HTMLElement).style.borderColor = t.borderStrong)"
          @mouseleave="(e) => ((e.currentTarget as HTMLElement).style.borderColor = t.border)"
        >
          <span
            class="text-[12px] font-mono leading-none mt-1 flex-shrink-0"
            :style="{ color: t.textFaint }"
          >
            #{{ it.number }}
          </span>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <span
                class="text-[12px] font-medium leading-none px-1.5 py-0.5 rounded"
                :style="stateBadgeStyle(it.state)"
              >
                {{ stateLabel(it.state) }}
              </span>
              <span
                v-if="it.isDraft"
                class="text-[12px] leading-none px-1.5 py-0.5 rounded"
                :style="{ background: t.bgActive, color: t.textDim }"
              >
                {{ tr('project.github.draft') }}
              </span>
              <span class="text-[1em] truncate" :style="{ color: t.text }">{{ it.title }}</span>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <span
                v-for="lb in it.labels"
                :key="lb.name"
                class="text-[12px] leading-none px-1.5 py-0.5 rounded"
                :style="labelStyle(lb.color)"
              >
                {{ lb.name }}
              </span>
              <span
                v-if="kind === 'pr' && it.baseRefName && it.headRefName"
                class="text-[12px] font-mono leading-none inline-flex items-center gap-1"
                :style="{ color: t.textDim }"
              >
                {{ it.baseRefName }}
                <ArrowLeft :size="10" />
                {{ it.headRefName }}
              </span>
              <span class="text-[12px] leading-none" :style="{ color: t.textDim }">
                @{{ it.author.login }}
              </span>
              <span class="text-[12px] leading-none" :style="{ color: t.textFaint }">
                {{ formatTime(it.updatedAt) }}
              </span>
            </div>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { AlertTriangle, ArrowLeft, Loader2, RefreshCw } from 'lucide-vue-next'
import type { GhThreadKind, GhThreadState, GhThreadSummary } from '~/types'
import type { GhListState } from '~/composables/useProjectGh'
import { formatTime } from '~/utils/time'

const props = defineProps<{
  kind: GhThreadKind
  items: GhThreadSummary[]
  loading: boolean
  errorCode: string | null
  stateFilter: GhListState
  assigneeFilter: string
  knownAssignees: string[]
  searchQuery: string
}>()

const emit = defineEmits<{
  'update:state': [value: string]
  'update:assignee': [value: string]
  'update:search': [value: string]
  refresh: []
  select: [number: number]
}>()

const { t } = useTheme()
const { t: tr } = useI18n()
const sidecar = useSidecar()

const stateOptions = computed(() => {
  const base = [
    { value: 'open', label: tr('project.github.state_open') },
    { value: 'closed', label: tr('project.github.state_closed') },
  ]
  if (props.kind === 'pr') base.push({ value: 'merged', label: tr('project.github.state_merged') })
  base.push({ value: 'all', label: tr('project.github.state_all') })
  return base
})

const emptyText = computed(() =>
  props.kind === 'issue' ? tr('project.github.empty_issues') : tr('project.github.empty_prs'),
)

const errorTitle = computed(() => {
  switch (props.errorCode) {
    case 'GH_NOT_FOUND':
      return tr('project.github.err_not_found_title')
    case 'GH_NOT_AUTH':
      return tr('project.github.err_not_auth_title')
    case 'GH_NO_REPO':
      return tr('project.github.err_no_repo_title')
    default:
      return tr('project.github.err_generic_title')
  }
})

const errorHint = computed(() => {
  switch (props.errorCode) {
    case 'GH_NOT_FOUND':
      return tr('project.github.err_not_found_hint')
    case 'GH_NOT_AUTH':
      return tr('project.github.err_not_auth_hint')
    case 'GH_NO_REPO':
      return tr('project.github.err_no_repo_hint')
    default:
      return tr('project.github.err_generic_hint')
  }
})

const stateLabel = (state: GhThreadState): string => {
  if (state === 'MERGED') return tr('project.github.state_merged')
  if (state === 'CLOSED') return tr('project.github.state_closed')
  return tr('project.github.state_open')
}

// Closed = danger (red), Merged = info (distinct color so it reads apart from
// Open). Open uses the success accent on a neutral chip — the AWOG palette is
// monochrome and has no success-tinted background token.
const stateBadgeStyle = (state: GhThreadState): CSSProperties => {
  if (state === 'MERGED') return { background: t.value.infoBg, color: t.value.info }
  if (state === 'CLOSED') return { background: t.value.dangerBg, color: t.value.danger }
  return { background: t.value.bgActive, color: t.value.success }
}

// GitHub label colors are 6-hex (no #). They come from the gh API, not user UI
// input, and are only used as a tinted background — rendered through a style
// binding (no v-html). Fall back to the neutral chip if malformed.
const labelStyle = (hex: string): CSSProperties => {
  const valid = /^[0-9a-fA-F]{6}$/.test(hex)
  if (!valid) return { background: t.value.bgActive, color: t.value.textDim }
  return { background: `#${hex}22`, color: t.value.textMuted, border: `1px solid #${hex}55` }
}

const openCliSite = () => {
  sidecar.openExternal('https://cli.github.com').catch(() => {})
}
</script>
