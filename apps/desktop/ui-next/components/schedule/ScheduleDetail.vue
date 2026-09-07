<template>
  <div class="scd">
    <div class="dh">
      <div class="scd-icn">
        <Icon name="clock" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </div>
      <div class="dt">{{ schedule.name }}</div>
      <span class="tag" :class="{ acc: schedule.enabled }">
        {{ schedule.enabled ? t('schedules.state.on') : t('schedules.state.off') }}
      </span>
      <span style="flex: 1" />
      <span
        class="tog2"
        :class="{ off: !schedule.enabled }"
        :title="schedule.enabled ? t('schedules.disable') : t('schedules.enable')"
        @click="emit('toggle')"
      />
      <button class="iconbtn scd-act" :title="t('schedules.runNow')" @click="emit('run')">
        <Icon name="play" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
      <button class="iconbtn scd-act" :title="t('schedules.edit')" @click="emit('edit')">
        <Icon name="edit" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
      <button
        class="iconbtn scd-act scd-danger"
        :title="t('schedules.delete')"
        @click="emit('delete')"
      >
        <Icon name="trash" style="width: var(--icon-sm); height: var(--icon-sm)" />
      </button>
    </div>

    <div class="dscroll">
      <!-- Giới hạn "app phải đang chạy" — nói ngay ở chỗ người dùng đặt lịch,
           không giấu trong tài liệu. -->
      <div class="scd-note">
        <Icon name="info" style="width: var(--icon-sm); height: var(--icon-sm)" />
        <div>
          <div class="scd-note-t">{{ t('schedules.limit.title') }}</div>
          <div class="scd-note-b">{{ t('schedules.limit.body') }}</div>
        </div>
      </div>

      <div class="scd-grid">
        <span class="scd-k">{{ t('schedules.trigger') }}</span>
        <span class="scd-v">{{ triggerLabel }}</span>
        <span class="scd-k">{{ t('schedules.job') }}</span>
        <span class="scd-v">{{ jobSummary }}</span>
        <span class="scd-k">{{ t('schedules.next') }}</span>
        <span class="scd-v">{{ nextLabel }}</span>
        <span class="scd-k">{{ t('schedules.last') }}</span>
        <span class="scd-v">{{ lastLabel }}</span>
      </div>

      <div class="scd-sec">{{ t('schedules.history') }}</div>
      <div v-if="schedule.runs.length === 0" class="scd-empty">
        {{ t('schedules.history.empty') }}
      </div>
      <div v-for="run in schedule.runs" :key="run.id" class="scd-run">
        <span class="scd-dot" :style="{ background: statusColor(run.status) }" />
        <span class="scd-run-st">{{ t('schedules.status.' + run.status) }}</span>
        <span class="scd-run-at">{{ when(run.startedAt) }}</span>
        <span class="tag scd-run-tg">{{ t('schedules.trigger.' + run.trigger) }}</span>
        <span v-if="run.catchUp" class="tag acc">{{ t('schedules.catchUp') }}</span>
        <span style="flex: 1" />
        <button
          v-if="run.sessionId"
          class="btn sm"
          :title="t('schedules.openSession.hint')"
          @click="emit('open-session', run.sessionId)"
        >
          {{ t('schedules.openSession') }}
        </button>
        <span v-if="run.message" class="scd-run-msg" :title="run.message">{{ run.message }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Chi tiết một lịch: biểu thức, việc sẽ chạy, mốc kế tiếp/lần cuối và vài lần
// chạy gần đây. Mọi hành động đều emit lên page — component này không gọi store.
import { computed } from 'vue'
import type { Schedule, ScheduleRunStatus } from '~/stores/schedules'
import { useProjects } from '~/composables/useProjects'
import { describeTrigger, formatWhen } from './schedule-format'

const props = defineProps<{ schedule: Schedule }>()
const emit = defineEmits<{
  edit: []
  delete: []
  toggle: []
  run: []
  'open-session': [sessionId: string]
}>()

const { t, locale } = useI18n()
const { projectName } = useProjects()

const triggerLabel = computed(() => describeTrigger(props.schedule.trigger, t))
const when = (iso: string): string => formatWhen(iso, locale.value)

const jobSummary = computed(() => {
  const job = props.schedule.job
  if (job.kind === 'session-prompt') {
    const where = job.projectId ? ` · ${projectName(job.projectId)}` : ''
    return `${t('schedules.job.sessionPrompt')}${where} · ${job.settings.mode}`
  }
  return `${t('schedules.job.workflowTask')} · ${job.workflowId} · ${projectName(job.projectId)}`
})

const nextLabel = computed(() =>
  props.schedule.nextRunAt && props.schedule.enabled
    ? when(props.schedule.nextRunAt)
    : t('schedules.next.never'),
)

const lastLabel = computed(() => {
  const s = props.schedule
  if (!s.lastRunAt) return t('schedules.last.never')
  const status = s.lastStatus ? t(`schedules.status.${s.lastStatus}`) : ''
  return `${when(s.lastRunAt)} · ${status}`
})

function statusColor(status: ScheduleRunStatus): string {
  if (status === 'ok') return 'var(--accent)'
  if (status === 'error') return 'var(--danger)'
  if (status === 'running') return 'var(--warn)'
  return 'var(--textFaint)'
}
</script>

<style scoped>
.scd {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.scd-icn {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: var(--r-sm);
  background: var(--accentDim);
  color: var(--accent);
}
.scd-act {
  color: var(--textDim);
}
.scd-danger:hover {
  color: var(--danger);
  background: var(--dangerBg);
}
.scd-note {
  display: flex;
  gap: 9px;
  padding: 10px 12px;
  margin-bottom: 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--bgEl);
  color: var(--textDim);
}
.scd-note-t {
  color: var(--text);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
.scd-note-b {
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
}
.scd-grid {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 7px 12px;
  align-items: baseline;
}
.scd-k {
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.scd-v {
  color: var(--text);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
.scd-sec {
  margin: 20px 0 8px;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.scd-empty {
  color: var(--textFaint);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.scd-run {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 0;
  border-top: 1px solid var(--border);
}
.scd-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.scd-run-st {
  color: var(--text);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
.scd-run-at,
.scd-run-tg {
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.scd-run-msg {
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
</style>
