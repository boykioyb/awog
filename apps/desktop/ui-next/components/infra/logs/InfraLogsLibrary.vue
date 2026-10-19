<template>
  <Tabs
    :model-value="current"
    class="flex min-h-0 flex-col gap-1.5"
    @update:model-value="(v) => (current = v as Tab)"
  >
    <TabsList :aria-label="t('infra.logs.library.title')" class="h-auto self-start">
      <TabsTrigger v-for="tab in TABS" :key="tab" :value="tab" class="px-2 py-1 text-xs">
        {{ t(`infra.logs.library.tab.${tab}`) }}
        <Badge
          v-if="countOf(tab) > 0"
          variant="secondary"
          class="rounded-sm px-1 py-0 tabular-nums"
        >
          {{ countOf(tab) }}
        </Badge>
      </TabsTrigger>
    </TabsList>

    <!-- Mẫu sẵn -->
    <TabsContent
      value="templates"
      class="mt-0 flex max-h-66 flex-col overflow-y-auto rounded-md border bg-card"
    >
      <!-- raw-ok: hàng list cả dòng là một vùng bấm, không phải nút -->
      <button
        v-for="tpl in templates"
        :key="tpl.id"
        class="relative flex w-full cursor-pointer flex-col gap-0.5 border-b px-2 py-1.5 text-left text-muted-foreground last:border-b-0 hover:bg-accent"
        type="button"
        @click="emit('apply', tpl.query, tpl.windowSeconds, tpl.id)"
      >
        <span class="truncate pr-5.5 text-sm text-foreground">
          {{ t(`infra.logs.library.template.${tpl.id}`) }}
        </span>
        <span class="truncate text-xs text-dim">{{ tpl.query }}</span>
        <span class="text-xs text-faint tabular-nums">{{ windowLabel(tpl.windowSeconds) }}</span>
      </button>
      <p v-if="templates.length === 0" class="px-2.5 py-3.5 text-center text-sm text-dim">
        {{ t('infra.logs.library.empty') }}
      </p>
    </TabsContent>

    <!-- Đã lưu -->
    <TabsContent
      value="saved"
      class="mt-0 flex max-h-66 flex-col overflow-y-auto rounded-md border bg-card"
    >
      <!-- Nút xoá lồng bên trong là span role=button vì HTML cấm lồng nút trong nút. -->
      <!-- raw-ok: hàng list cả dòng là một vùng bấm, không phải nút -->
      <button
        v-for="s in saved"
        :key="s.id"
        class="relative flex w-full cursor-pointer flex-col gap-0.5 border-b px-2 py-1.5 text-left text-muted-foreground last:border-b-0 hover:bg-accent"
        type="button"
        @click="emit('apply', s.query, s.windowSeconds, '')"
      >
        <span class="truncate pr-5.5 text-sm text-foreground">{{ s.name }}</span>
        <span class="truncate text-xs text-dim">{{ s.query }}</span>
        <span class="text-xs text-faint tabular-nums">
          <template v-if="s.lastBytesScanned !== undefined">
            {{ t('infra.logs.library.lastScan', { size: formatBytes(s.lastBytesScanned) }) }}
          </template>
        </span>
        <span
          class="absolute top-1.5 right-1.5 grid size-4.5 place-items-center rounded-sm text-faint hover:bg-muted hover:text-destructive"
          role="button"
          tabindex="0"
          :title="t('infra.logs.library.delete')"
          @click.stop="emit('delete', s.id)"
          @keydown.enter.stop="emit('delete', s.id)"
        >
          <Icon name="x" class="size-3" />
        </span>
      </button>
      <p v-if="saved.length === 0" class="px-2.5 py-3.5 text-center text-sm text-dim">
        {{ t('infra.logs.library.empty') }}
      </p>
    </TabsContent>

    <!-- Lịch sử -->
    <TabsContent
      value="history"
      class="mt-0 flex max-h-66 flex-col overflow-y-auto rounded-md border bg-card"
    >
      <div class="flex justify-end border-b px-2 py-1">
        <Button type="button" variant="outline" size="sm" @click="emit('clear-history')">
          {{ t('infra.logs.library.clearHistory') }}
        </Button>
      </div>
      <!-- raw-ok: hàng list cả dòng là một vùng bấm, không phải nút -->
      <button
        v-for="h in history"
        :key="h.id"
        class="relative flex w-full cursor-pointer flex-col gap-0.5 border-b px-2 py-1.5 text-left text-muted-foreground last:border-b-0 hover:bg-accent"
        type="button"
        @click="emit('apply', h.query, h.windowSeconds, '')"
      >
        <span class="truncate pr-5.5 text-sm text-foreground">{{ h.query }}</span>
        <span class="truncate text-xs text-dim">
          {{ fmtWhen(h.ranAt) }} · {{ h.status }} ·
          {{ t('infra.logs.library.scanned', { size: formatBytes(h.bytesScanned) }) }}
        </span>
      </button>
      <p v-if="history.length === 0" class="px-2.5 py-3.5 text-center text-sm text-dim">
        {{ t('infra.logs.library.empty') }}
      </p>
    </TabsContent>
  </Tabs>
</template>

<script setup lang="ts">
import Button from '~/components/ui/button/Button.vue'

// Thư viện query (Mốc 2 việc 2.4): mẫu sẵn · đã lưu · lịch sử.
//
// Ba tab, một khung. `lastScan` của câu đã lưu là con số ĐO ĐƯỢC của lần chạy gần
// nhất — nó vừa là thông tin, vừa là cơ sở để ước lượng GB lần sau (2.6), nên nó
// được hiện ngay trên dòng thay vì giấu trong chi tiết.
import type {
  AwsLogsHistoryEntry,
  AwsLogsTemplate,
  AwsSavedQuery,
} from '~/composables/useAwsLogsApi'

const props = defineProps<{
  templates: AwsLogsTemplate[]
  saved: AwsSavedQuery[]
  history: AwsLogsHistoryEntry[]
}>()

const emit = defineEmits<{
  apply: [query: string, windowSeconds: number, templateId: string]
  delete: [id: string]
  'clear-history': []
}>()

const { t } = useI18n()
type Tab = 'templates' | 'saved' | 'history'
const TABS: Tab[] = ['templates', 'saved', 'history']
const current = ref<Tab>('templates')

function countOf(tab: Tab): number {
  if (tab === 'templates') return props.templates.length
  if (tab === 'saved') return props.saved.length
  return props.history.length
}

function windowLabel(seconds: number): string {
  if (seconds < 3600) return t('infra.logs.window.minutes', { n: Math.round(seconds / 60) })
  if (seconds < 86_400) return t('infra.logs.window.hours', { n: Math.round(seconds / 3600) })
  return t('infra.logs.window.days', { n: Math.round(seconds / 86_400) })
}

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}
</script>
