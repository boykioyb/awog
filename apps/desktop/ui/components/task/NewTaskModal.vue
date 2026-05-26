<template>
  <BaseModal :open="true" title="New task" @close="emit('cancel')">
    <div class="p-4 space-y-4">
      <Field label="Project">
        <select v-model="projectId" class="w-full rounded px-2 py-1.5 text-xs" :style="inputStyle">
          <option v-if="projects.length === 0" value="">No projects — create one first</option>
          <option v-for="p in projects" :key="p.id" :value="p.id">
            {{ p.name }} — {{ p.path }}
          </option>
        </select>
        <div class="text-[10px] mt-1" :style="{ color: t.textDim }">
          Code changes will happen in this local repository
        </div>
      </Field>
      <Field label="Source">
        <div class="flex gap-1">
          <button
            v-for="s in sourceOptions"
            :key="s.id"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] transition"
            :style="{
              background: sourceType === s.id ? t.accent : t.bgInput,
              color: sourceType === s.id ? t.accentText : t.textMuted,
              border: `1px solid ${sourceType === s.id ? t.accent : t.border}`,
            }"
            @click="sourceType = s.id"
          >
            <component :is="s.icon" :size="11" />
            {{ s.label }}
          </button>
        </div>
      </Field>
      <Field v-if="sourceType === 'github'" label="GitHub Issue URL">
        <input
          v-model="githubUrl"
          placeholder="https://github.com/org/repo/issues/123"
          class="w-full rounded px-2 py-1.5 text-xs font-mono"
          :style="inputStyle"
          @input="onGithubUrlInput"
        />
      </Field>
      <Field v-if="sourceType === 'jira'" label="Jira Key">
        <input
          :value="jiraKey"
          placeholder="PROJ-1234"
          class="w-full rounded px-2 py-1.5 text-xs font-mono"
          :style="inputStyle"
          @input="jiraKey = ($event.target as HTMLInputElement).value.toUpperCase()"
        />
      </Field>
      <Field label="Title">
        <input v-model="title" class="w-full rounded px-2 py-1.5 text-xs" :style="inputStyle" />
      </Field>
      <Field label="Description">
        <textarea
          v-model="description"
          :rows="4"
          class="w-full rounded px-2 py-1.5 text-[11px] resize-none"
          :style="inputStyle"
        />
      </Field>
      <Field label="Workflow">
        <div class="space-y-1.5">
          <button
            v-for="wf in workflows"
            :key="wf.id"
            class="w-full text-left rounded px-3 py-2 transition flex items-start gap-2.5"
            :style="{
              background: workflowId === wf.id ? t.bgActive : t.bgInput,
              border: `1px solid ${workflowId === wf.id ? t.borderFocus : t.border}`,
            }"
            @click="workflowId = wf.id"
          >
            <div
              class="w-4 h-4 rounded-full flex-shrink-0 mt-0.5 flex items-center justify-center"
              :style="{
                border: `1.5px solid ${workflowId === wf.id ? t.accent : t.borderStrong}`,
              }"
            >
              <div
                v-if="workflowId === wf.id"
                class="w-2 h-2 rounded-full"
                :style="{ background: t.accent }"
              />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[12px] font-medium" :style="{ color: t.text }">
                {{ wf.name }}
              </div>
              <div class="text-[10px]" :style="{ color: t.textDim }">
                {{ wf.description }}
              </div>
            </div>
          </button>
        </div>
      </Field>
    </div>

    <template #footer>
      <button class="px-3 py-1.5 text-xs" :style="{ color: t.textMuted }" @click="emit('cancel')">
        Cancel
      </button>
      <button
        :disabled="!canSubmit"
        class="px-3 py-1.5 text-xs rounded font-medium"
        :style="{
          background: !canSubmit ? t.bgInput : t.accent,
          color: !canSubmit ? t.textFaint : t.accentText,
        }"
        @click="handleSubmit"
      >
        Create task
      </button>
    </template>
  </BaseModal>
</template>

<script setup lang="ts">
import { Github, Layers, FileText } from 'lucide-vue-next'
import type { TaskSource } from '~/types'

interface CreateTaskInput {
  title: string
  description: string
  source: TaskSource
  workflowId: string
  projectId: string
}

const emit = defineEmits<{
  save: [data: CreateTaskInput]
  cancel: []
}>()

const { t } = useTheme()
const store = useWorkspaceStore()

const projects = computed(() => store.projects)
const workflows = computed(() => store.workflows)

const sourceType = ref<'github' | 'jira' | 'manual'>('github')
const githubUrl = ref('')
const jiraKey = ref('')
const title = ref('')
const description = ref('')
const workflowId = ref(workflows.value[0]?.id || '')
const projectId = ref(projects.value[0]?.id || '')

const sourceOptions = [
  { id: 'github' as const, label: 'GitHub', icon: Github },
  { id: 'jira' as const, label: 'Jira', icon: Layers },
  { id: 'manual' as const, label: 'Manual', icon: FileText },
]

const inputStyle = computed(() => ({
  background: t.value.bgInput,
  border: `1px solid ${t.value.border}`,
  color: t.value.text,
  outline: 'none',
}))

const parseGithubUrl = (url: string) => {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/)
  if (m) return { repo: `${m[1]}/${m[2]}`, issueNumber: parseInt(m[3], 10), url }
  return null
}

const onGithubUrlInput = () => {
  const parsed = parseGithubUrl(githubUrl.value)
  if (parsed && !title.value) {
    title.value = `Issue #${parsed.issueNumber} in ${parsed.repo}`
  }
}

const canSubmit = computed(
  () =>
    !!title.value &&
    !!workflowId.value &&
    !!projectId.value &&
    (sourceType.value === 'manual' ||
      (sourceType.value === 'github' && !!githubUrl.value) ||
      (sourceType.value === 'jira' && !!jiraKey.value)),
)

const handleSubmit = () => {
  if (!canSubmit.value) return
  let source: TaskSource
  if (sourceType.value === 'github') {
    const parsed = parseGithubUrl(githubUrl.value)
    source = parsed
      ? { type: 'github', repo: parsed.repo, issueNumber: parsed.issueNumber, url: parsed.url }
      : { type: 'github', repo: 'unknown', issueNumber: 0, url: githubUrl.value }
  } else if (sourceType.value === 'jira') {
    source = { type: 'jira', key: jiraKey.value }
  } else {
    source = { type: 'manual' }
  }
  emit('save', {
    title: title.value,
    description: description.value,
    source,
    workflowId: workflowId.value,
    projectId: projectId.value,
  })
}
</script>
