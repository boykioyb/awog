<template>
  <LibraryEntityModal
    :open="open"
    :title="schedule ? t('schedules.form.editTitle') : t('schedules.form.newTitle')"
    :width="560"
    @close="emit('cancel')"
  >
    <div class="sef">
      <div class="sef-field">
        <label class="sef-label">{{ t('schedules.form.name') }}</label>
        <input v-model="name" class="sef-input" :placeholder="t('schedules.form.namePh')" />
      </div>

      <!-- ── Loại việc ── -->
      <div class="sef-field">
        <label class="sef-label">{{ t('schedules.form.jobKind') }}</label>
        <div class="seg sef-seg">
          <span :class="{ on: jobKind === 'session-prompt' }" @click="jobKind = 'session-prompt'">
            {{ t('schedules.job.sessionPrompt') }}
          </span>
          <span :class="{ on: jobKind === 'workflow-task' }" @click="jobKind = 'workflow-task'">
            {{ t('schedules.job.workflowTask') }}
          </span>
        </div>
      </div>

      <template v-if="jobKind === 'session-prompt'">
        <div class="sef-field">
          <label class="sef-label">{{ t('schedules.form.prompt') }}</label>
          <textarea
            v-model="prompt"
            class="sef-input sef-area"
            :placeholder="t('schedules.form.promptPh')"
          />
        </div>
        <div class="sef-field">
          <label class="sef-label">{{ t('schedules.form.sessionTitle') }}</label>
          <input
            v-model="sessionTitle"
            class="sef-input"
            :placeholder="t('schedules.form.sessionTitlePh')"
          />
        </div>
        <div class="sef-field">
          <label class="sef-label">{{ t('schedules.form.project') }}</label>
          <AppSelect v-model="projectId" :options="projectOptions" width="100%" />
        </div>
        <div class="sef-field">
          <label class="sef-label">{{ t('schedules.form.mode') }}</label>
          <AppSelect v-model="mode" :options="modeOptions" width="100%" />
          <div class="sef-hint">{{ t('schedules.form.mode.hint') }}</div>
        </div>
        <div class="sef-field">
          <label class="sef-label">{{ t('schedules.form.model') }}</label>
          <div class="sef-static">{{ modelSummary }}</div>
        </div>
      </template>

      <template v-else>
        <div class="sef-field">
          <label class="sef-label">{{ t('schedules.form.project') }}</label>
          <AppSelect v-model="taskProjectId" :options="taskProjectOptions" width="100%" />
        </div>
        <div class="sef-field">
          <label class="sef-label">{{ t('schedules.form.workflow') }}</label>
          <AppSelect v-model="workflowId" :options="workflowOptions" width="100%" />
        </div>
        <div class="sef-field">
          <label class="sef-label">{{ t('schedules.form.taskTitle') }}</label>
          <input v-model="taskTitle" class="sef-input" />
        </div>
        <div class="sef-field">
          <label class="sef-label">{{ t('schedules.form.description') }}</label>
          <textarea v-model="taskDescription" class="sef-input sef-area" />
        </div>
      </template>

      <!-- ── Biểu thức lịch ── -->
      <div class="sef-field">
        <label class="sef-label">{{ t('schedules.trigger') }}</label>
        <div class="seg sef-seg">
          <span :class="{ on: triggerKind === 'interval' }" @click="triggerKind = 'interval'">
            {{ t('schedules.kind.interval') }}
          </span>
          <span :class="{ on: triggerKind === 'daily' }" @click="triggerKind = 'daily'">
            {{ t('schedules.kind.daily') }}
          </span>
          <span :class="{ on: triggerKind === 'weekly' }" @click="triggerKind = 'weekly'">
            {{ t('schedules.kind.weekly') }}
          </span>
        </div>
      </div>

      <div v-if="triggerKind === 'interval'" class="sef-field">
        <label class="sef-label">{{ t('schedules.form.every') }}</label>
        <div class="sef-row">
          <input v-model.number="intervalN" type="number" min="1" class="sef-input sef-num" />
          <AppSelect v-model="intervalUnit" :options="unitOptions" width="130px" />
        </div>
      </div>

      <div v-else class="sef-field">
        <label class="sef-label">{{ t('schedules.form.time') }}</label>
        <input v-model="time" class="sef-input sef-num" placeholder="09:00" />
      </div>

      <div v-if="triggerKind === 'weekly'" class="sef-field">
        <label class="sef-label">{{ t('schedules.form.weekdays') }}</label>
        <div class="sef-days">
          <button
            v-for="d in WEEKDAYS"
            :key="d"
            type="button"
            class="sef-day"
            :class="{ on: weekdays.includes(d) }"
            @click="toggleWeekday(d)"
          >
            {{ t('schedules.day.' + d) }}
          </button>
        </div>
      </div>

      <label class="sef-check">
        <input v-model="enabled" type="checkbox" />
        {{ t('schedules.form.enabled') }}
      </label>

      <div v-if="error" class="sef-err">{{ error }}</div>
    </div>

    <template #footer>
      <button class="btn sm" @click="emit('cancel')">{{ t('schedules.form.cancel') }}</button>
      <button class="btn sm pri" @click="onSave">{{ t('schedules.form.save') }}</button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Form tạo/sửa một lịch chạy (ADR 0082).
//
// Cấu hình LLM (provider / model / mức suy luận / tài khoản) KHÔNG sửa ở đây:
// lịch mới chụp lại từ Settings → Defaults, lịch cũ giữ nguyên bản đã chụp và
// chỉ hiện ra để đọc. Riêng CHẾ ĐỘ QUYỀN thì sửa được, vì nó là thứ quyết định
// một lượt chạy không người trực được phép làm gì.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import AppSelect from '~/components/common/AppSelect.vue'
import { useProjects } from '~/composables/useProjects'
import { useSettingsStore } from '~/stores/settings'
import { useWorkflowsStore } from '~/stores/workflows'
import type {
  Schedule,
  ScheduleInput,
  ScheduleJob,
  ScheduleSessionSettings,
  ScheduleTrigger,
} from '~/stores/schedules'

const props = defineProps<{ open: boolean; schedule: Schedule | null }>()
const emit = defineEmits<{ save: [ScheduleInput]; cancel: [] }>()

const { t } = useI18n()
const { projects } = useProjects()
const settings = useSettingsStore()
const workflowsStore = useWorkflowsStore()

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const
const NO_PROJECT = ''

const name = ref('')
const enabled = ref(true)
const jobKind = ref<ScheduleJob['kind']>('session-prompt')

// session-prompt
const prompt = ref('')
const sessionTitle = ref('')
const projectId = ref(NO_PROJECT)
const mode = ref<ScheduleSessionSettings['mode']>('execute')

// workflow-task
const taskProjectId = ref('')
const workflowId = ref('')
const taskTitle = ref('')
const taskDescription = ref('')

// trigger
const triggerKind = ref<ScheduleTrigger['kind']>('daily')
const intervalN = ref(30)
const intervalUnit = ref<'minutes' | 'hours'>('minutes')
const time = ref('09:00')
const weekdays = ref<number[]>([1])

const error = ref('')

// Bản chụp LLM của lịch đang sửa; null khi tạo mới (sẽ lấy từ Settings lúc lưu).
const storedSettings = ref<ScheduleSessionSettings | null>(null)

const projectOptions = computed(() => [
  { label: t('schedules.form.projectNone'), value: NO_PROJECT },
  ...projects.value.map((p) => ({ label: p.name, value: p.id })),
])

const taskProjectOptions = computed(() =>
  projects.value.map((p) => ({ label: p.name, value: p.id })),
)

// Workflow của tier global + tier của đúng project đang chọn (workflow của
// project khác không chạy được cho task này).
const workflowOptions = computed(() =>
  workflowsStore.workflows
    .filter((w) => w.source !== 'project' || w.projectId === taskProjectId.value)
    .map((w) => ({ label: w.name, value: w.id })),
)

// CHỈ 'execute' và 'plan'. `ask` / `accept-edits` sẽ PARK ở tool call đầu tiên
// cần quyền, mà một lượt chạy theo lịch thì không có ai trả lời — hộp xin quyền
// được phát ra lúc không cửa sổ nào biết phiên đó tồn tại, nên lượt chạy treo
// vĩnh viễn và giữ luôn lịch (xem ADR 0082 §Bảo mật). Mode lạ trong file lịch
// cũ vẫn được giữ trong danh sách để không bị nuốt mất khi mở form ra sửa.
const SCHEDULABLE_MODES = ['execute', 'plan'] as const
const modeOptions = computed(() => {
  const values: ScheduleSessionSettings['mode'][] = [...SCHEDULABLE_MODES]
  if (!values.includes(mode.value)) values.unshift(mode.value)
  return values.map((m) => ({ label: m, value: m }))
})

const unitOptions = computed(() => [
  { label: t('schedules.form.unit.minutes'), value: 'minutes' },
  { label: t('schedules.form.unit.hours'), value: 'hours' },
])

const modelSummary = computed(() => {
  const s = storedSettings.value ?? defaultSessionSettings()
  return `${s.provider} · ${s.modelId} · ${s.level}`
})

// Bản chụp LLM cho một lịch MỚI: theo Settings → Defaults, kèm tài khoản mà mọi
// creator khác trong app cũng dùng (resolveCreatorAccount).
function defaultSessionSettings(): ScheduleSessionSettings {
  const d = settings.defaults
  const acct = settings.resolveCreatorAccount()
  const base: ScheduleSessionSettings = {
    provider: d.provider,
    modelId: d.modelId,
    level: d.thinkingLevel,
    mode: mode.value,
  }
  if (acct.accountId) base.accountId = acct.accountId
  return base
}

function toggleWeekday(d: number): void {
  weekdays.value = weekdays.value.includes(d)
    ? weekdays.value.filter((x) => x !== d)
    : [...weekdays.value, d].sort((a, b) => a - b)
}

// Nạp lại form mỗi lần modal mở: một modal dùng lại cho cả tạo lẫn sửa nên
// state cũ phải bị xoá sạch, không để rò từ lần mở trước.
watch(
  () => [props.open, props.schedule] as const,
  ([isOpen]) => {
    if (!isOpen) return
    error.value = ''
    void workflowsStore.loadWorkflows(projects.value.map((p) => p.id))
    const s = props.schedule
    if (!s) {
      name.value = ''
      enabled.value = true
      jobKind.value = 'session-prompt'
      prompt.value = ''
      sessionTitle.value = ''
      projectId.value = NO_PROJECT
      mode.value = 'execute'
      storedSettings.value = null
      taskProjectId.value = projects.value[0]?.id ?? ''
      workflowId.value = ''
      taskTitle.value = ''
      taskDescription.value = ''
      triggerKind.value = 'daily'
      intervalN.value = 30
      intervalUnit.value = 'minutes'
      time.value = '09:00'
      weekdays.value = [1]
      return
    }
    name.value = s.name
    enabled.value = s.enabled
    jobKind.value = s.job.kind
    if (s.job.kind === 'session-prompt') {
      prompt.value = s.job.prompt
      sessionTitle.value = s.job.title ?? ''
      projectId.value = s.job.projectId ?? NO_PROJECT
      mode.value = s.job.settings.mode
      storedSettings.value = s.job.settings
    } else {
      taskProjectId.value = s.job.projectId
      workflowId.value = s.job.workflowId
      taskTitle.value = s.job.title
      taskDescription.value = s.job.description
      storedSettings.value = null
    }
    triggerKind.value = s.trigger.kind
    if (s.trigger.kind === 'interval') {
      const m = s.trigger.everyMinutes
      const asHours = m % 60 === 0 && m >= 60
      intervalUnit.value = asHours ? 'hours' : 'minutes'
      intervalN.value = asHours ? m / 60 : m
    } else {
      time.value = s.trigger.time
      if (s.trigger.kind === 'weekly') weekdays.value = [...s.trigger.weekdays]
    }
  },
  { immediate: true },
)

// Slug id ổn định từ tên. Charset khớp SCHEDULE_ID_RE ở sidecar; id của lịch đã
// có thì GIỮ NGUYÊN (đổi tên không được đẻ ra một lịch thứ hai).
function slugify(raw: string): string {
  const base = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return base || `sch-${Date.now().toString(36)}`
}

function buildTrigger(): ScheduleTrigger | null {
  if (triggerKind.value === 'interval') {
    const n = Math.floor(intervalN.value)
    if (!Number.isFinite(n) || n < 1) return null
    const minutes = intervalUnit.value === 'hours' ? n * 60 : n
    return minutes > 7 * 24 * 60 ? null : { kind: 'interval', everyMinutes: minutes }
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time.value)) return null
  if (triggerKind.value === 'daily') return { kind: 'daily', time: time.value }
  if (weekdays.value.length === 0) return null
  return { kind: 'weekly', weekdays: [...weekdays.value], time: time.value }
}

function buildJob(): ScheduleJob | null {
  if (jobKind.value === 'session-prompt') {
    if (!prompt.value.trim()) return null
    const settingsSnapshot: ScheduleSessionSettings = storedSettings.value
      ? { ...storedSettings.value, mode: mode.value }
      : defaultSessionSettings()
    const job: ScheduleJob = {
      kind: 'session-prompt',
      prompt: prompt.value.trim(),
      settings: settingsSnapshot,
    }
    if (sessionTitle.value.trim()) job.title = sessionTitle.value.trim()
    if (projectId.value) job.projectId = projectId.value
    return job
  }
  if (!taskProjectId.value || !workflowId.value) return null
  return {
    kind: 'workflow-task',
    workflowId: workflowId.value,
    projectId: taskProjectId.value,
    title: taskTitle.value.trim() || name.value.trim(),
    description: taskDescription.value.trim(),
  }
}

function onSave(): void {
  error.value = ''
  if (!name.value.trim()) {
    error.value = t('schedules.form.needName')
    return
  }
  const trigger = buildTrigger()
  if (!trigger) {
    error.value =
      triggerKind.value === 'weekly' && weekdays.value.length === 0
        ? t('schedules.form.needWeekday')
        : t('schedules.form.needName')
    return
  }
  const job = buildJob()
  if (!job) {
    error.value =
      jobKind.value === 'session-prompt'
        ? t('schedules.form.needPrompt')
        : t('schedules.form.needWorkflow')
    return
  }
  if (job.kind === 'session-prompt' && !job.settings.accountId) {
    error.value = t('schedules.form.needAccount')
    return
  }
  emit('save', {
    id: props.schedule?.id ?? slugify(name.value),
    name: name.value.trim(),
    enabled: enabled.value,
    trigger,
    job,
  })
}
</script>

<style scoped>
.sef {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sef-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.sef-label {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.sef-input {
  width: 100%;
  padding: 7px 9px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  color: var(--text);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-family: inherit;
}
.sef-input:focus {
  outline: none;
  border-color: var(--accentBorder);
}
.sef-area {
  resize: vertical;
  min-height: 6rem;
}
.sef-num {
  width: 110px;
}
.sef-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sef-seg {
  width: 100%;
}
.sef-static {
  padding: 7px 9px;
  border: 1px dashed var(--border);
  border-radius: var(--r-sm);
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.sef-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.sef-days {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.sef-day {
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
}
.sef-day.on {
  border-color: var(--accentBorder);
  background: var(--accentDim);
  color: var(--accent);
}
.sef-check {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--text);
  cursor: pointer;
}
.sef-err {
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
</style>
