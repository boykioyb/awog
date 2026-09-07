<template>
  <LibraryEntityModal
    :open="open"
    :title="t('projectsInit.title')"
    :lock-scrim="busy || saving"
    :width="760"
    @close="emit('close')"
  >
    <div class="pid">
      <p class="pid-note">{{ t('projectsInit.intro') }}</p>

      <p v-if="!project.path" class="pid-warn">{{ t('projectsInit.noPath') }}</p>
      <p v-else-if="error" class="pid-warn">{{ error }}</p>

      <template v-if="draft !== null">
        <div class="pid-meta">
          <span>
            {{ t('projectsInit.scanSummary', { n: scan.fileCount, source: sourceLabel }) }}
          </span>
          <span v-if="scan.truncated" class="pid-warn">{{ t('projectsInit.truncated') }}</span>
        </div>
        <p v-if="claudeMdExists" class="pid-warn">
          {{ t('projectsInit.exists', { path: suggestedPath }) }}
        </p>
        <textarea v-model="draft" class="pid-ta" spellcheck="false" />
        <p class="pid-hint">{{ t('projectsInit.editHint') }}</p>
        <p v-if="savedPath" class="pid-ok">{{ t('projectsInit.saved', { path: savedPath }) }}</p>
      </template>
    </div>

    <template #footer>
      <span v-if="draft !== null" class="pid-target">
        {{ t('projectsInit.target', { path: suggestedPath }) }}
      </span>
      <button class="btn" :disabled="busy || saving" @click="emit('close')">
        {{ t('projectsInit.close') }}
      </button>
      <button v-if="draft !== null" class="btn" :disabled="busy || saving" @click="onCopy">
        <Icon :name="copied ? 'check' : 'copy'" />
        {{ copied ? t('projectsInit.copied') : t('projectsInit.copy') }}
      </button>
      <button class="btn" :disabled="!project.path || busy || saving" @click="onGenerate">
        <Icon name="refresh" :class="{ spin: busy }" />
        {{
          busy
            ? t('projectsInit.generating')
            : draft === null
              ? t('projectsInit.generate')
              : t('projectsInit.regenerate')
        }}
      </button>
      <button
        v-if="draft !== null"
        class="btn pri"
        :disabled="busy || saving || !draft.trim()"
        @click="onSave"
      >
        <Icon name="save" />
        {{ saving ? t('projectsInit.saving') : t('projectsInit.save') }}
      </button>
    </template>
  </LibraryEntityModal>
</template>

<script setup lang="ts">
// Sinh tài liệu dự án (`/init`) — quét repo qua `projects.initDocs` rồi hiện BẢN
// NHÁP CLAUDE.md để người dùng sửa trước khi lưu.
//
// Hai điều quan trọng về hành vi:
//   - Engine KHÔNG ghi đĩa. Nó chỉ trả markdown; đĩa chỉ bị chạm khi người dùng
//     bấm Lưu (đi qua `fs.writeFile`, gate assertInsideWorkspace).
//   - CLAUDE.md đang có KHÔNG bị ghi đè: sidecar đổi đích sang CLAUDE.draft.md
//     và modal nói rõ để người dùng tự trộn tay.
// Quét là một lượt gọi model có tính tiền, nên nó nằm sau một nút bấm tường
// minh chứ không tự chạy khi mở modal.
import { computed, ref, watch } from 'vue'
import LibraryEntityModal from '~/components/library/LibraryEntityModal.vue'
import { useSidecar } from '~/composables/useSidecar'
import type { Project } from '~/types'

interface InitDocsScan {
  fileCount: number
  truncated: boolean
  source: 'git' | 'walk'
}

interface InitDocsResponse {
  markdown: string
  model: string
  claudeMdExists: boolean
  suggestedPath: string
  scan: InitDocsScan
}

const props = defineProps<{ open: boolean; project: Project }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const sc = useSidecar()

const EMPTY_SCAN: InitDocsScan = { fileCount: 0, truncated: false, source: 'git' }

const draft = ref<string | null>(null)
const scan = ref<InitDocsScan>(EMPTY_SCAN)
const claudeMdExists = ref(false)
const suggestedPath = ref('CLAUDE.md')
const busy = ref(false)
const saving = ref(false)
const copied = ref(false)
const savedPath = ref<string | null>(null)
const error = ref<string | null>(null)

const sourceLabel = computed(() =>
  scan.value.source === 'git' ? t('projectsInit.source.git') : t('projectsInit.source.walk'),
)

const reset = () => {
  draft.value = null
  scan.value = EMPTY_SCAN
  claudeMdExists.value = false
  suggestedPath.value = 'CLAUDE.md'
  savedPath.value = null
  copied.value = false
  error.value = null
}

// Mỗi lần mở là một lượt mới — không giữ lại bản nháp của dự án trước.
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) reset()
  },
)

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const onGenerate = async () => {
  if (!props.project.path || busy.value) return
  busy.value = true
  error.value = null
  savedPath.value = null
  try {
    const res = await sc.request<InitDocsResponse>('projects.initDocs', {
      path: props.project.path,
    })
    draft.value = res.markdown
    scan.value = res.scan
    claudeMdExists.value = res.claudeMdExists
    suggestedPath.value = res.suggestedPath
  } catch (err) {
    error.value = t('projectsInit.failed', { message: message(err) })
  } finally {
    busy.value = false
  }
}

const onSave = async () => {
  const content = draft.value
  if (!content || !props.project.path || saving.value) return
  saving.value = true
  error.value = null
  try {
    await sc.request('fs.writeFile', {
      workspaceRoot: props.project.path,
      path: suggestedPath.value,
      content,
    })
    savedPath.value = suggestedPath.value
  } catch (err) {
    error.value = t('projectsInit.saveFailed', { message: message(err) })
  } finally {
    saving.value = false
  }
}

const onCopy = async () => {
  if (!draft.value) return
  await navigator.clipboard.writeText(draft.value)
  copied.value = true
  window.setTimeout(() => {
    copied.value = false
  }, 1500)
}
</script>

<style scoped>
.pid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pid-note,
.pid-hint {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
.pid-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.pid-warn {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--amber);
}
.pid-ok {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--green);
}
.pid-target {
  margin-right: auto;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}
.pid-ta {
  /* mono-ok: nội dung file markdown người dùng sẽ lưu ra đĩa / dán vào editor */
  font-family: var(--code);
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--text);
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 10px 12px;
  min-height: 22rem;
  resize: vertical;
}
.pid-ta:focus {
  outline: none;
  border-color: var(--accentBorder);
}
</style>
