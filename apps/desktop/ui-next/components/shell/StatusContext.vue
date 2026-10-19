<template>
  <!-- Popover (portal ra <body>, mở LÊN trên vì thanh ghim ở đáy cửa sổ). Màu từng
       đoạn thanh là màu chú giải theo hạng mục, đến từ useSessionContextUsage (dữ
       liệu), nên đi qua :style chứ không phải class. -->
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <!-- Số "274k/1.00M" ngắn + cố định, không cắt `…` — chip này không co. -->
      <StatusChip class="shrink-0 gap-2" :title="t('sessions.detail.contextUsage')">
        <span class="flex h-1.5 w-18.5 overflow-hidden rounded-full bg-muted">
          <i
            v-for="s in barSegments"
            :key="s.key"
            class="h-full"
            :style="{ width: `${s.pct}%`, background: s.color }"
          />
        </span>
        <span class="text-xs text-dim tabular-nums">{{ tokLabel }}/{{ limitLabel }}</span>
      </StatusChip>
    </PopoverTrigger>
    <PopoverContent side="top" align="end" :side-offset="8" class="w-71 p-3.5">
      <div class="mb-2 flex justify-between gap-2.5 text-sm whitespace-nowrap text-dim">
        <span class="truncate">{{ t('sessions.detail.contextWindow') }}</span>
        <span class="shrink-0 text-xs tabular-nums">
          {{ tokLabel }} / {{ limitLabel }} · {{ Math.round(pct) }}%
        </span>
      </div>
      <!-- mono-ok: model id, e.g. claude-sonnet-4-5 -->
      <div class="mt-0.5 mb-2 font-mono text-sm text-dim">{{ model }}</div>
      <div
        v-if="sessionCost != null"
        class="-mt-1 mb-2 flex items-center justify-between gap-2 text-sm text-dim"
      >
        <span>{{ t('sessions.detail.cat.cost') }}</span>
        <span class="text-xs tabular-nums">{{ fmtUsd(sessionCost) }}</span>
      </div>
      <span class="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        <i
          v-for="s in barSegments"
          :key="s.key"
          class="h-full"
          :style="{ width: `${s.pct}%`, background: s.color }"
        />
      </span>

      <!-- Bảng hạng mục kiểu `/context` của Claude Code. -->
      <div class="mt-2.5 flex flex-col">
        <div class="flex items-center gap-2 pt-0.5 pb-1 text-sm text-faint">
          <!-- Ô trống cùng cỡ ô màu để cột nhãn thẳng hàng với các hàng bên dưới. -->
          <span class="size-2.25 shrink-0" />
          <span class="min-w-0 flex-1 truncate">{{ t('sessions.detail.cat.category') }}</span>
          <span class="min-w-14 shrink-0 text-right">{{ t('sessions.detail.cat.tokens') }}</span>
          <span class="min-w-12 shrink-0 text-right">{{ t('sessions.detail.cat.usage') }}</span>
        </div>
        <Separator class="mb-0.5" />
        <div v-for="row in catRows" :key="row.key" class="flex items-center gap-2 py-0.5">
          <span class="size-2.25 shrink-0 rounded-xs" :style="{ background: row.color }" />
          <span class="min-w-0 flex-1 truncate text-foreground">{{ row.label }}</span>
          <span class="min-w-14 shrink-0 text-right text-sm text-dim tabular-nums">
            {{ formatTokenCount(row.tokens) }}
          </span>
          <span class="min-w-12 shrink-0 text-right text-sm text-faint tabular-nums">
            {{ pctLabel(row) }}
          </span>
        </div>
      </div>

      <!-- Expandable detail: bulk-loaded memory files + custom agents. -->
      <template v-for="sec in sections" :key="sec.key">
        <Separator class="mt-2" />
        <Collapsible
          :open="openSections.has(sec.key)"
          class="pt-1.5"
          @update:open="toggleSection(sec.key)"
        >
          <CollapsibleTrigger as-child>
            <Button
              variant="ghost"
              size="xs"
              class="h-auto w-full justify-start gap-1.5 px-0 py-0.5 text-sm font-normal text-faint hover:bg-transparent hover:text-foreground"
            >
              <Icon
                name="chev"
                class="size-3! transition-transform motion-reduce:transition-none"
                :class="openSections.has(sec.key) && 'rotate-90'"
              />
              {{ sec.label }}
              <span class="ml-auto text-sm text-dim tabular-nums">{{ sec.items.length }}</span>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent class="mt-1 flex max-h-46 flex-col overflow-y-auto">
            <div v-for="it in sec.items" :key="it.label" class="flex items-center gap-2 py-0.5">
              <!-- mono-ok: path of an injected context file -->
              <span class="min-w-0 flex-1 truncate font-mono text-sm text-dim">{{ it.label }}</span>
              <span class="shrink-0 text-right text-sm text-faint tabular-nums">
                {{ formatTokenCount(it.tokens) }}
              </span>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </template>

      <!-- Footer action: /compact — summarise older turns to free budget (ADR 0047),
           same RPC as the composer's `/compact`. Locked + spinner while it runs. -->
      <template v-if="canCompact">
        <Separator class="mt-2.5 mb-2" />
        <Button
          variant="outline"
          size="sm"
          class="w-full font-normal"
          :disabled="isCompacting"
          :title="t('sessions.detail.compactHint')"
          @click="onCompact"
        >
          <Icon
            :name="isCompacting ? 'refresh' : 'foldv'"
            :class="isCompacting && 'animate-spin motion-reduce:animate-none'"
          />
          {{ isCompacting ? t('sessions.composer.compacting') : t('sessions.detail.compact') }}
        </Button>
      </template>
    </PopoverContent>
  </Popover>
</template>

<script setup lang="ts">
// Context-window chip + breakdown popover for the global status bar — renders the
// active session's `/context`-style usage (moved here from the SessionDetail
// header). All math lives in useSessionContextUsage; this owns only the popover
// open state + the two expandable bulk-load sections.
import { computed, ref } from 'vue'
import type { Session } from '~/composables/useSessionsData'
import type { CatRow } from '~/composables/useSessionContextUsage'
import { formatTokenCount } from '~/utils/context-window'

const props = defineProps<{ session: Session }>()
const { t } = useI18n()
const store = useSessionsStore()

const {
  fmtUsd,
  sessionCost,
  model,
  tokLabel,
  limitLabel,
  pct,
  barSegments,
  catRows,
  memoryFilesList,
  agentsList,
} = useSessionContextUsage(() => props.session)

const open = ref(false)

// Hai mục bung/gập (memory files · custom agents) — chỉ hiện mục có dữ liệu.
type SectionKey = 'memory' | 'agents'
const sections = computed(() =>
  [
    {
      key: 'memory' as SectionKey,
      label: t('sessions.detail.cat.memoryFilesSection'),
      items: memoryFilesList.value,
    },
    {
      key: 'agents' as SectionKey,
      label: t('sessions.detail.cat.agentsSection'),
      items: agentsList.value,
    },
  ].filter((sec) => sec.items.length),
)
const openSections = ref(new Set<SectionKey>())
function toggleSection(key: SectionKey) {
  const next = new Set(openSections.value)
  if (!next.delete(key)) next.add(key)
  openSections.value = next
}

function pctLabel(row: CatRow): string {
  return row.pct < 0.05 ? '0%' : `${row.pct.toFixed(1)}%`
}

// Manual `/compact` from the context popover — only for a live (engine-backed)
// session; the store guards overlapping calls + drives `compacting`.
const canCompact = computed(() => !!props.session.engineId)
const isCompacting = computed(() => props.session.compacting === true)
function onCompact() {
  if (isCompacting.value) return
  void store.compactSession(props.session.id).then((r) => {
    if (r === 'compacted')
      useToast().add({ title: t('sessions.command.notice.compacted'), color: 'success' })
    else if (r === 'nothing')
      useToast().add({ title: t('sessions.command.notice.nothingToCompact'), color: 'info' })
    else useToast().add({ title: t('sessions.command.notice.compactFailed'), color: 'error' })
  })
}
</script>
