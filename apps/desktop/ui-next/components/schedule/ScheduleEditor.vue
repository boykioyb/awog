<template>
  <LibraryEntityModal
    :open="open"
    :title="schedule ? t('schedules.form.editTitle') : t('schedules.form.newTitle')"
    :width="560"
    @close="emit('cancel')"
  >
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1.5">
        <Label class="text-sm font-medium text-foreground">{{ t('schedules.form.name') }}</Label>
        <Input v-model="name" :placeholder="t('schedules.form.namePh')" />
      </div>

      <!-- ── Loại việc ── -->
      <div class="flex flex-col gap-1.5">
        <Label class="text-sm font-medium text-foreground">{{ t('schedules.form.jobKind') }}</Label>
        <ToggleGroup
          type="single"
          :spacing="1"
          class="w-full rounded-lg bg-muted p-0.5"
          :model-value="jobKind"
          @update:model-value="(v) => v && (jobKind = v as ScheduleJob['kind'])"
        >
          <ToggleGroupItem value="session-prompt" :class="SEG_ITEM">
            {{ t('schedules.job.sessionPrompt') }}
          </ToggleGroupItem>
          <ToggleGroupItem value="workflow-task" :class="SEG_ITEM">
            {{ t('schedules.job.workflowTask') }}
          </ToggleGroupItem>
          <ToggleGroupItem value="command" :class="SEG_ITEM">
            {{ t('schedules.job.command') }}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      <template v-if="jobKind === 'session-prompt'">
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">
            {{ t('schedules.form.prompt') }}
          </Label>
          <Textarea
            v-model="prompt"
            class="min-h-24 resize-y text-base"
            :placeholder="t('schedules.form.promptPh')"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">
            {{ t('schedules.form.sessionTitle') }}
          </Label>
          <Input v-model="sessionTitle" :placeholder="t('schedules.form.sessionTitlePh')" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">
            {{ t('schedules.form.project') }}
          </Label>
          <AppSelect v-model="projectId" :options="projectOptions" width="100%" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">{{ t('schedules.form.mode') }}</Label>
          <AppSelect v-model="mode" :options="modeOptions" width="100%" />
          <div class="text-xs text-dim">{{ t('schedules.form.mode.hint') }}</div>
        </div>
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">{{ t('schedules.form.model') }}</Label>
          <!-- Chỉ đọc: cấu hình LLM chụp từ Settings → Defaults, không sửa ở form này. -->
          <div class="rounded-md border border-dashed px-2 py-1.5 text-sm text-dim">
            {{ modelSummary }}
          </div>
        </div>
      </template>

      <ScheduleCommandFields
        v-else-if="jobKind === 'command'"
        v-model:program="program"
        v-model:args-text="argsText"
        v-model:timeout-minutes="timeoutMinutes"
      />

      <template v-else>
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">
            {{ t('schedules.form.project') }}
          </Label>
          <AppSelect v-model="taskProjectId" :options="taskProjectOptions" width="100%" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">
            {{ t('schedules.form.workflow') }}
          </Label>
          <AppSelect v-model="workflowId" :options="workflowOptions" width="100%" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">
            {{ t('schedules.form.taskTitle') }}
          </Label>
          <Input v-model="taskTitle" />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label class="text-sm font-medium text-foreground">
            {{ t('schedules.form.description') }}
          </Label>
          <Textarea v-model="taskDescription" class="min-h-24 resize-y text-base" />
        </div>
      </template>

      <!-- ── Biểu thức lịch ── -->
      <ScheduleTriggerFields
        v-model:trigger-kind="triggerKind"
        v-model:interval-n="intervalN"
        v-model:interval-unit="intervalUnit"
        v-model:time="time"
        v-model:weekdays="weekdays"
      />

      <div class="flex items-center justify-between gap-1.5">
        <Label class="text-sm font-medium text-foreground">{{ t('schedules.form.enabled') }}</Label>
        <Switch
          :checked="enabled"
          :aria-label="t('schedules.form.enabled')"
          @update:checked="(v: boolean) => (enabled = v)"
        />
      </div>

      <div v-if="error" class="text-sm text-destructive">{{ error }}</div>
    </div>

    <template #footer>
      <Button variant="outline" size="sm" @click="emit('cancel')">
        {{ t('schedules.form.cancel') }}
      </Button>
      <Button variant="default" size="sm" @click="onSave">{{ t('schedules.form.save') }}</Button>
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
import ScheduleCommandFields from './ScheduleCommandFields.vue'
import ScheduleTriggerFields from './ScheduleTriggerFields.vue'
import { useProjects } from '~/composables/useProjects'
import { useSettingsStore } from '~/stores/settings'
import { useWorkflowsStore } from '~/stores/workflows'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import Label from '~/components/ui/label/Label.vue'
import Switch from '~/components/ui/switch/Switch.vue'
import Textarea from '~/components/ui/textarea/Textarea.vue'
import ToggleGroup from '~/components/ui/toggle-group/ToggleGroup.vue'
import ToggleGroupItem from '~/components/ui/toggle-group/ToggleGroupItem.vue'
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
const { confirm } = useConfirm()
const { projects } = useProjects()
const settings = useSettingsStore()
const workflowsStore = useWorkflowsStore()

const NO_PROJECT = ''

// Segmented control chọn loại việc — cùng kiểu CommandEditor, chia đều cả bề ngang.
const SEG_ITEM =
  'h-6 flex-1 px-2 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm'

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

// command — tham số nhập mỗi dòng một cái (không có shell để tách theo dấu cách)
const DEFAULT_TIMEOUT_MINUTES = 10
const program = ref('')
const argsText = ref('')
const timeoutMinutes = ref(DEFAULT_TIMEOUT_MINUTES)

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
      program.value = ''
      argsText.value = ''
      timeoutMinutes.value = DEFAULT_TIMEOUT_MINUTES
      triggerKind.value = 'daily'
      intervalN.value = 30
      intervalUnit.value = 'minutes'
      time.value = '09:00'
      weekdays.value = [1]
      return
    }
    name.value = s.name
    // Mở một đề xuất của agent là để duyệt và bật nó — Lưu xong thì lịch chạy luôn.
    enabled.value = s.proposedBy ? true : s.enabled
    jobKind.value = s.job.kind
    if (s.job.kind === 'session-prompt') {
      prompt.value = s.job.prompt
      sessionTitle.value = s.job.title ?? ''
      projectId.value = s.job.projectId ?? NO_PROJECT
      mode.value = s.job.settings.mode
      storedSettings.value = s.job.settings
    } else if (s.job.kind === 'command') {
      program.value = s.job.program
      argsText.value = s.job.args.join('\n')
      timeoutMinutes.value = s.job.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES
      storedSettings.value = null
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
  if (jobKind.value === 'command') {
    const timeout = Math.floor(timeoutMinutes.value)
    if (!program.value.trim().startsWith('/') || !(timeout >= 1 && timeout <= 60)) return null
    return {
      kind: 'command',
      program: program.value.trim(),
      args: argsText.value
        .split('\n')
        .map((a) => a.trim())
        .filter(Boolean),
      timeoutMinutes: timeout,
    }
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

async function onSave(): Promise<void> {
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
    const missing = {
      'session-prompt': 'schedules.form.needPrompt',
      'workflow-task': 'schedules.form.needWorkflow',
      command: 'schedules.form.needProgram',
    } as const
    error.value = t(missing[jobKind.value])
    return
  }
  if (job.kind === 'session-prompt' && !job.settings.accountId) {
    error.value = t('schedules.form.needAccount')
    return
  }
  // Lệnh chỉ được duyệt sau khi người dùng đọc đúng thứ sẽ chạy: program + MỖI arg một
  // dòng (nối bằng dấu cách thì không phân biệt được một arg có dấu cách với hai arg).
  if (job.kind === 'command') {
    const ok = await confirm({
      title: t('schedules.approve.title'),
      description: `${t('schedules.approve.body')}\n\n${[job.program, ...job.args].join('\n')}`,
      confirmLabel: t('schedules.approve.confirm'),
      kind: 'primary',
    })
    if (!ok) return
  }
  emit('save', {
    id: props.schedule?.id ?? slugify(name.value),
    name: name.value.trim(),
    enabled: enabled.value,
    trigger,
    job,
    ...(job.kind === 'command' ? { approve: true } : {}),
  })
}
</script>
