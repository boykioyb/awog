<template>
  <LibraryEntityModal
    :open="open && !!run"
    :title="`${schedule.name} · ${run ? when(run.startedAt) : ''}`"
    :width="760"
    @close="emit('close')"
  >
    <div v-if="run" class="flex flex-col gap-3">
      <div class="grid grid-cols-[max-content_1fr] gap-x-3.5 gap-y-1.5 text-base">
        <span class="text-dim">{{ t('schedules.run.status') }}</span>
        <span class="flex min-w-0 items-center gap-1.5 text-foreground">
          <span class="size-2 flex-none rounded-full" :class="statusDotClass(run.status)" />
          {{ t('schedules.status.' + run.status) }}
        </span>
        <span class="text-dim">{{ t('schedules.run.started') }}</span>
        <span :class="VALUE">{{ whenFull(run.startedAt) }}</span>
        <span class="text-dim">{{ t('schedules.run.finished') }}</span>
        <span :class="VALUE">{{ run.finishedAt ? whenFull(run.finishedAt) : '—' }}</span>
        <span class="text-dim">{{ t('schedules.run.duration') }}</span>
        <span :class="VALUE" class="tabular-nums">{{ duration }}</span>
        <span class="text-dim">{{ t('schedules.run.trigger') }}</span>
        <span :class="VALUE">
          {{ t('schedules.trigger.' + run.trigger) }}
          <template v-if="run.catchUp">· {{ t('schedules.catchUp') }}</template>
        </span>
        <template v-if="commandLine">
          <span class="text-dim">{{ t('schedules.run.command') }}</span>
          <!-- mono-ok: dòng lệnh thật — người dùng copy chạy lại trong terminal -->
          <span :class="VALUE" class="font-mono text-sm">{{ commandLine }}</span>
        </template>
        <template v-if="run.message">
          <span class="text-dim">{{ t('schedules.run.message') }}</span>
          <span :class="VALUE" class="whitespace-pre-wrap">{{ run.message }}</span>
        </template>
      </div>

      <div class="flex flex-col gap-2">
        <Separator />
        <div class="flex items-center text-sm text-dim">
          <span>{{ t('schedules.log') }}</span>
          <span class="flex-1" />
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
      </div>
      <div v-if="logState === 'loading'" class="text-sm text-dim">
        {{ t('schedules.run.logLoading') }}
      </div>
      <div v-else-if="logState === 'error'" class="text-sm text-dim">
        {{ t('schedules.run.logError') }}
      </div>
      <div v-else-if="!logText" class="text-sm text-dim">
        {{ run.status === 'running' ? t('schedules.run.logPending') : t('schedules.run.noLog') }}
      </div>
      <!-- mono-ok: output thật của lệnh — người dùng copy-paste để dò lỗi -->
      <pre
        v-else
        class="m-0 max-h-[50vh] overflow-auto rounded-md border bg-muted px-3 py-2.5 font-mono text-sm wrap-anywhere whitespace-pre-wrap text-foreground select-text"
        >{{ logText }}</pre
      >
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
import Separator from '~/components/ui/separator/Separator.vue'
import { useSchedulesStore, type Schedule } from '~/stores/schedules'
import { copyText } from '~/utils/clipboard'
import { formatWhen, statusDotClass } from './schedule-format'

const props = defineProps<{ open: boolean; schedule: Schedule; runId: string | null }>()
const emit = defineEmits<{ close: []; 'open-session': [sessionId: string] }>()

const { t, locale } = useI18n()
const store = useSchedulesStore()

// Cột giá trị của lưới thông tin: co được trong ô 1fr và ngắt cả chuỗi dài không dấu cách
// (đường dẫn, dòng lệnh).
const VALUE = 'min-w-0 wrap-anywhere text-foreground'

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
