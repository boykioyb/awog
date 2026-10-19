<template>
  <LibraryEntityModal
    :open="open && !!run"
    :title="`${schedule.name} · ${run ? when(run.startedAt) : ''}`"
    :width="760"
    @close="emit('close')"
  >
    <div v-if="run" class="srm">
      <div class="srm-grid">
        <span class="srm-k">{{ t('schedules.run.status') }}</span>
        <span class="srm-v srm-st">
          <span class="srm-dot" :style="{ background: statusColor(run.status) }" />
          {{ t('schedules.status.' + run.status) }}
        </span>
        <span class="srm-k">{{ t('schedules.run.started') }}</span>
        <span class="srm-v">{{ whenFull(run.startedAt) }}</span>
        <span class="srm-k">{{ t('schedules.run.finished') }}</span>
        <span class="srm-v">{{ run.finishedAt ? whenFull(run.finishedAt) : '—' }}</span>
        <span class="srm-k">{{ t('schedules.run.duration') }}</span>
        <span class="srm-v tnum">{{ duration }}</span>
        <span class="srm-k">{{ t('schedules.run.trigger') }}</span>
        <span class="srm-v">
          {{ t('schedules.trigger.' + run.trigger) }}
          <template v-if="run.catchUp">· {{ t('schedules.catchUp') }}</template>
        </span>
        <template v-if="commandLine">
          <span class="srm-k">{{ t('schedules.run.command') }}</span>
          <span class="srm-v srm-code">{{ commandLine }}</span>
        </template>
        <template v-if="run.message">
          <span class="srm-k">{{ t('schedules.run.message') }}</span>
          <span class="srm-v srm-msg">{{ run.message }}</span>
        </template>
      </div>

      <div class="srm-sec">
        <span>{{ t('schedules.log') }}</span>
        <span style="flex: 1" />
        <Button
          v-if="logText"
          variant="ghost"
          size="sm"
          :title="t('schedules.run.copyLog')"
          @click="copyText(logText)"
        >
          {{ t('schedules.run.copyLog') }}
        </Button>
      </div>
      <div v-if="logState === 'loading'" class="srm-empty">{{ t('schedules.run.logLoading') }}</div>
      <div v-else-if="logState === 'error'" class="srm-empty">
        {{ t('schedules.run.logError') }}
      </div>
      <div v-else-if="!logText" class="srm-empty">
        {{ run.status === 'running' ? t('schedules.run.logPending') : t('schedules.run.noLog') }}
      </div>
      <pre v-else class="srm-log">{{ logText }}</pre>
    </div>

    <template #footer>
      <Button
        v-if="run?.sessionId"
        variant="outline"
        size="sm"
        :title="t('schedules.openSession.hint')"
        @click="emit('open-session', run.sessionId)"
      >
        {{ t('schedules.openSession') }}
      </Button>
      <Button variant="default" size="sm" @click="emit('close')">{{ t('common.close') }}</Button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Chi tiết một lượt chạy (ADR 0082/0108): thông tin lượt + thông báo đầy đủ + log của job
// `command`. Run lấy từ prop `schedule` theo `runId` (không chụp bản sao), nên lượt đang
// chạy tự chuyển trạng thái khi store nạp lại theo `schedules.changed`; log được nạp lại
// đúng lúc lượt có log.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import Button from '~/components/ui/button/Button.vue'
import { useSchedulesStore, type Schedule } from '~/stores/schedules'
import { copyText } from '~/utils/clipboard'
import { formatWhen, statusColor } from './schedule-format'

const props = defineProps<{ open: boolean; schedule: Schedule; runId: string | null }>()
const emit = defineEmits<{ close: []; 'open-session': [sessionId: string] }>()

const { t, locale } = useI18n()
const store = useSchedulesStore()

const run = computed(() => props.schedule.runs.find((r) => r.id === props.runId) ?? null)
const when = (iso: string): string => formatWhen(iso, locale.value)
const whenFull = (iso: string): string => {
  const ms = Date.parse(iso)
  return Number.isNaN(ms)
    ? iso
    : new Date(ms).toLocaleString(locale.value === 'vi' ? 'vi-VN' : 'en-GB')
}

const duration = computed(() => {
  const r = run.value
  if (!r?.finishedAt) return '—'
  const s = (Date.parse(r.finishedAt) - Date.parse(r.startedAt)) / 1000
  return Number.isFinite(s) ? `${s.toFixed(1)}s` : '—'
})

const commandLine = computed(() => {
  const job = props.schedule.job
  return job.kind === 'command' ? [job.program, ...job.args].join(' ') : ''
})

const logText = ref('')
const logState = ref<'idle' | 'loading' | 'error'>('idle')

// Nạp log khi modal mở, và khi lượt đang chạy vừa có log (hasLog lật sang true).
watch(
  () => [props.open, run.value?.id, run.value?.hasLog] as const,
  async ([isOpen, id, hasLog]) => {
    logText.value = ''
    logState.value = 'idle'
    if (!isOpen || !id || !hasLog) return
    logState.value = 'loading'
    try {
      logText.value = await store.fetchRunLog(props.schedule.id, id)
      logState.value = 'idle'
    } catch {
      logState.value = 'error'
    }
  },
  { immediate: true },
)
</script>

<style scoped>
.srm {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.srm-grid {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 6px 14px;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
.srm-k {
  color: var(--textDim);
}
.srm-v {
  color: var(--text);
  min-width: 0;
  overflow-wrap: anywhere;
}
.srm-st {
  display: flex;
  align-items: center;
  gap: 7px;
}
.srm-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.srm-msg {
  white-space: pre-wrap;
}
.srm-code {
  /* mono-ok: dòng lệnh thật — người dùng copy chạy lại trong terminal */
  font-family: var(--code);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.srm-sec {
  display: flex;
  align-items: center;
  padding-top: 8px;
  box-shadow: inset 0 1px 0 var(--border);
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.srm-empty {
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.srm-log {
  margin: 0;
  max-height: 50vh;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  color: var(--text);
  /* mono-ok: output thật của lệnh — người dùng copy-paste để dò lỗi */
  font-family: var(--code);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}
</style>
