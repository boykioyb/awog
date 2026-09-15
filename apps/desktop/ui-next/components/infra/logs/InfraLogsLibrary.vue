<template>
  <div class="llb">
    <div class="llb-tabs" role="tablist" :aria-label="t('infra.logs.library.title')">
      <button
        v-for="tab in TABS"
        :key="tab"
        class="llb-tab"
        :class="{ on: current === tab }"
        type="button"
        role="tab"
        :aria-selected="current === tab"
        @click="current = tab"
      >
        {{ t(`infra.logs.library.tab.${tab}`) }}
        <span v-if="countOf(tab) > 0" class="llb-badge">{{ countOf(tab) }}</span>
      </button>
    </div>

    <!-- Mẫu sẵn -->
    <div v-if="current === 'templates'" class="llb-list">
      <button
        v-for="tpl in templates"
        :key="tpl.id"
        class="llb-row"
        type="button"
        @click="emit('apply', tpl.query, tpl.windowSeconds, tpl.id)"
      >
        <span class="llb-row-name">{{ t(`infra.logs.library.template.${tpl.id}`) }}</span>
        <span class="llb-row-sub">{{ tpl.query }}</span>
        <span class="llb-row-meta">{{ windowLabel(tpl.windowSeconds) }}</span>
      </button>
      <p v-if="templates.length === 0" class="llb-empty">{{ t('infra.logs.library.empty') }}</p>
    </div>

    <!-- Đã lưu -->
    <div v-else-if="current === 'saved'" class="llb-list">
      <button
        v-for="s in saved"
        :key="s.id"
        class="llb-row"
        type="button"
        @click="emit('apply', s.query, s.windowSeconds, '')"
      >
        <span class="llb-row-name">{{ s.name }}</span>
        <span class="llb-row-sub">{{ s.query }}</span>
        <span class="llb-row-meta">
          <template v-if="s.lastBytesScanned !== undefined">
            {{ t('infra.logs.library.lastScan', { size: formatBytes(s.lastBytesScanned) }) }}
          </template>
        </span>
        <span
          class="llb-row-x"
          role="button"
          tabindex="0"
          :title="t('infra.logs.library.delete')"
          @click.stop="emit('delete', s.id)"
          @keydown.enter.stop="emit('delete', s.id)"
        >
          <Icon name="x" class="llb-ic" />
        </span>
      </button>
      <p v-if="saved.length === 0" class="llb-empty">{{ t('infra.logs.library.empty') }}</p>
    </div>

    <!-- Lịch sử -->
    <div v-else class="llb-list">
      <div class="llb-histhead">
        <button class="btn sm" type="button" @click="emit('clear-history')">
          {{ t('infra.logs.library.clearHistory') }}
        </button>
      </div>
      <button
        v-for="h in history"
        :key="h.id"
        class="llb-row"
        type="button"
        @click="emit('apply', h.query, h.windowSeconds, '')"
      >
        <span class="llb-row-name">{{ h.query }}</span>
        <span class="llb-row-sub">
          {{ fmtWhen(h.ranAt) }} · {{ h.status }} ·
          {{ t('infra.logs.library.scanned', { size: formatBytes(h.bytesScanned) }) }}
        </span>
      </button>
      <p v-if="history.length === 0" class="llb-empty">{{ t('infra.logs.library.empty') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
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

<style scoped>
.llb {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}

.llb-tabs {
  display: flex;
  gap: 3px;
}

.llb-tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border: 1px solid transparent;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}

.llb-tab.on {
  border-color: var(--border);
  color: var(--text);
  background: var(--bgHover);
}

.llb-badge {
  padding: 0 5px;
  border-radius: var(--r-xs);
  background: var(--bgActive);
  color: var(--textDim);
  font-variant-numeric: tabular-nums;
}

.llb-list {
  display: flex;
  flex-direction: column;
  max-height: 264px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgEl);
}

.llb-histhead {
  display: flex;
  justify-content: flex-end;
  padding: 5px 7px;
  border-bottom: 1px solid var(--border);
}

.llb-row {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 6px 9px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--textMuted);
  text-align: left;
  cursor: pointer;
}

.llb-row:last-child {
  border-bottom: none;
}

.llb-row:hover {
  background: var(--bgHover);
}

.llb-row-name {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-right: 22px;
}

.llb-row-sub {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.llb-row-meta {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
  font-variant-numeric: tabular-nums;
}

.llb-row-x {
  position: absolute;
  top: 6px;
  right: 6px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: var(--r-xs);
  color: var(--textFaint);
}

.llb-row-x:hover {
  color: var(--danger);
  background: var(--bgActive);
}

.llb-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
}

.llb-empty {
  margin: 0;
  padding: 14px 10px;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  text-align: center;
}
</style>
