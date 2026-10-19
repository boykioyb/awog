<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex h-12.5 flex-none items-center gap-2.5 border-b px-5.5">
      <div class="grid size-6.5 flex-none place-items-center rounded-sm bg-primary/10 text-primary">
        <Icon name="clock" class="size-3.5" />
      </div>
      <div class="min-w-0 truncate text-lg font-semibold">{{ schedule.name }}</div>
      <Badge variant="outline" :class="schedule.enabled ? BADGE_ACC : 'text-muted-foreground'">
        {{ schedule.enabled ? t('schedules.state.on') : t('schedules.state.off') }}
      </Badge>
      <!-- Agent đề xuất (ADR 0108): công tắc mở form để xem lại, không bật thẳng. -->
      <Badge
        v-if="schedule.proposedBy"
        variant="outline"
        :class="BADGE_ACC"
        :title="t('schedules.state.proposed.hint')"
      >
        {{ t('schedules.state.proposed') }}
      </Badge>
      <!-- Lệnh chưa duyệt / đã đổi từ lần duyệt (ADR 0108): lượt chạy sẽ bị từ chối. -->
      <Badge
        v-if="schedule.job.kind === 'command' && !schedule.approved"
        variant="outline"
        class="border-destructive/40 bg-destructive/10 text-destructive"
        :title="t('schedules.state.unapproved.hint')"
      >
        {{ t('schedules.state.unapproved') }}
      </Badge>
      <span class="flex-1" />
      <!-- Controlled: `checked` bám prop; bấm chỉ emit `toggle` để page quyết định (lịch do
           agent đề xuất thì mở form duyệt thay vì lật thẳng). -->
      <Switch
        :checked="schedule.enabled"
        :title="schedule.enabled ? t('schedules.disable') : t('schedules.enable')"
        :aria-label="schedule.enabled ? t('schedules.disable') : t('schedules.enable')"
        @update:checked="emit('toggle')"
      />
      <Button
        :title="t('schedules.runNow')"
        :aria-label="t('schedules.runNow')"
        class="text-muted-foreground"
        variant="outline"
        size="iconMd"
        @click="emit('run')"
      >
        <Icon name="play" class="size-3.5" />
      </Button>
      <Button
        :title="t('schedules.edit')"
        :aria-label="t('schedules.edit')"
        class="text-muted-foreground"
        variant="outline"
        size="iconMd"
        @click="emit('edit')"
      >
        <Icon name="edit" class="size-3.5" />
      </Button>
      <Button
        :title="t('schedules.delete')"
        :aria-label="t('schedules.delete')"
        class="text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
        variant="outline"
        size="iconMd"
        @click="emit('delete')"
      >
        <Icon name="trash" class="size-3.5" />
      </Button>
    </div>

    <div class="flex-1 overflow-y-auto p-5.5">
      <!-- Giới hạn "app phải đang chạy" — nói ngay ở chỗ người dùng đặt lịch,
           không giấu trong tài liệu. -->
      <Alert class="mb-3.5 text-muted-foreground">
        <Icon name="info" />
        <AlertTitle class="line-clamp-none text-base font-normal text-foreground">
          {{ t('schedules.limit.title') }}
        </AlertTitle>
        <AlertDescription class="leading-(--lh-prose)">
          {{ t('schedules.limit.body') }}
        </AlertDescription>
      </Alert>

      <div class="grid grid-cols-[max-content_1fr] items-baseline gap-x-3 gap-y-2">
        <span class="text-sm text-dim">{{ t('schedules.trigger') }}</span>
        <span class="text-base text-foreground">{{ triggerLabel }}</span>
        <span class="text-sm text-dim">{{ t('schedules.job') }}</span>
        <span class="min-w-0 text-base wrap-anywhere text-foreground">{{ jobSummary }}</span>
        <span class="text-sm text-dim">{{ t('schedules.next') }}</span>
        <span class="text-base text-foreground">{{ nextLabel }}</span>
        <span class="text-sm text-dim">{{ t('schedules.last') }}</span>
        <span class="text-base text-foreground">{{ lastLabel }}</span>
      </div>

      <div class="mt-5 mb-2 text-xs font-medium text-muted-foreground">
        {{ t('schedules.history') }}
      </div>
      <div v-if="schedule.runs.length === 0" class="text-sm text-faint">
        {{ t('schedules.history.empty') }}
      </div>
      <div v-else class="divide-y border-t">
        <!-- Bấm cả dòng ⇒ modal chi tiết lượt chạy + log (ScheduleRunModal). Dòng là vùng
             bấm chứa nút "Mở phiên" bên trong nên không dùng Button bọc ngoài. -->
        <div
          v-for="run in schedule.runs"
          :key="run.id"
          class="flex cursor-pointer items-center gap-2 px-1.5 py-1.5 outline-none hover:bg-accent focus-visible:bg-accent"
          role="button"
          tabindex="0"
          :title="t('schedules.run.open')"
          @click="emit('open-run', run.id)"
          @keydown.enter="emit('open-run', run.id)"
        >
          <span class="size-2 flex-none rounded-full" :class="statusDotClass(run.status)" />
          <span class="text-base text-foreground">{{ t('schedules.status.' + run.status) }}</span>
          <span class="text-sm text-dim tabular-nums">{{ when(run.startedAt) }}</span>
          <Badge variant="outline" class="text-muted-foreground">
            {{ t('schedules.trigger.' + run.trigger) }}
          </Badge>
          <Badge v-if="run.catchUp" variant="outline" :class="BADGE_ACC">
            {{ t('schedules.catchUp') }}
          </Badge>
          <span class="flex-1" />
          <Button
            v-if="run.sessionId"
            :title="t('schedules.openSession.hint')"
            variant="outline"
            size="sm"
            @click.stop="emit('open-session', run.sessionId)"
          >
            {{ t('schedules.openSession') }}
          </Button>
          <span
            v-if="run.message"
            class="max-w-[45%] truncate text-xs text-dim"
            :title="run.message"
          >
            {{ run.message }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Chi tiết một lịch: biểu thức, việc sẽ chạy, mốc kế tiếp/lần cuối và vài lần
// chạy gần đây. Mọi hành động đều emit lên page — component này không gọi store.
import { computed } from 'vue'
import type { Schedule } from '~/stores/schedules'
import { useProjects } from '~/composables/useProjects'
import { describeTrigger, formatWhen, statusDotClass } from './schedule-format'
import Alert from '~/components/ui/alert/Alert.vue'
import AlertDescription from '~/components/ui/alert/AlertDescription.vue'
import AlertTitle from '~/components/ui/alert/AlertTitle.vue'
import Badge from '~/components/ui/badge/Badge.vue'
import Button from '~/components/ui/button/Button.vue'
import Switch from '~/components/ui/switch/Switch.vue'

const props = defineProps<{ schedule: Schedule }>()
const emit = defineEmits<{
  edit: []
  delete: []
  toggle: []
  run: []
  'open-session': [sessionId: string]
  'open-run': [runId: string]
}>()

const { t, locale } = useI18n()
const { projectName } = useProjects()

// Badge nhấn màu brand (đang bật, đề xuất, chạy bù) — cùng kiểu badge tier project ở Skills.
const BADGE_ACC = 'border-primary/40 bg-primary/10 text-primary'

const triggerLabel = computed(() => describeTrigger(props.schedule.trigger, t))
const when = (iso: string): string => formatWhen(iso, locale.value)

const jobSummary = computed(() => {
  const job = props.schedule.job
  if (job.kind === 'session-prompt') {
    const where = job.projectId ? ` · ${projectName(job.projectId)}` : ''
    return `${t('schedules.job.sessionPrompt')}${where} · ${job.settings.mode}`
  }
  if (job.kind === 'command') {
    return `${t('schedules.job.command')} · ${[job.program, ...job.args].join(' ')}`
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
</script>
