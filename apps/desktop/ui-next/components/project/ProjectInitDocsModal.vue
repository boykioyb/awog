<template>
  <LibraryEntityModal
    :open="open"
    :title="t('projectsInit.title')"
    :lock-scrim="busy || saving"
    :width="760"
    @close="emit('close')"
  >
    <div class="flex flex-col gap-3">
      <p class="text-sm text-dim">{{ t('projectsInit.intro') }}</p>

      <p v-if="!project.path" class="text-sm text-warning">{{ t('projectsInit.noPath') }}</p>
      <p v-else-if="error" class="text-sm text-warning">{{ error }}</p>

      <template v-if="draft !== null">
        <div class="flex flex-wrap gap-2.5 text-xs text-dim">
          <span>
            {{ t('projectsInit.scanSummary', { n: scan.fileCount, source: sourceLabel }) }}
          </span>
          <span v-if="scan.truncated" class="text-sm text-warning">
            {{ t('projectsInit.truncated') }}
          </span>
        </div>
        <p v-if="claudeMdExists" class="text-sm text-warning">
          {{ t('projectsInit.exists', { path: suggestedPath }) }}
        </p>
        <!-- mono-ok: nội dung file markdown người dùng sẽ lưu ra đĩa / dán vào editor -->
        <Textarea
          :model-value="draft"
          class="min-h-88 resize-y font-mono"
          spellcheck="false"
          @update:model-value="draft = String($event)"
        />
        <p class="text-sm text-dim">{{ t('projectsInit.editHint') }}</p>
        <p v-if="savedPath" class="text-sm text-success">
          {{ t('projectsInit.saved', { path: savedPath }) }}
        </p>
      </template>
    </div>

    <template #footer>
      <span v-if="draft !== null" class="mr-auto text-xs text-dim">
        {{ t('projectsInit.target', { path: suggestedPath }) }}
      </span>
      <Button :disabled="busy || saving" variant="outline" @click="emit('close')">
        {{ t('projectsInit.close') }}
      </Button>
      <Button v-if="draft !== null" :disabled="busy || saving" variant="outline" @click="onCopy">
        <Icon :name="copied ? 'check' : 'copy'" />
        {{ copied ? t('projectsInit.copied') : t('projectsInit.copy') }}
      </Button>
      <Button :disabled="!project.path || busy || saving" variant="outline" @click="onGenerate">
        <Icon name="refresh" :class="{ 'animate-spin': busy }" />
        {{
          busy
            ? t('projectsInit.generating')
            : draft === null
              ? t('projectsInit.generate')
              : t('projectsInit.regenerate')
        }}
      </Button>
      <Button
        v-if="draft !== null"
        :disabled="busy || saving || !draft.trim()"
        variant="default"
        @click="onSave"
      >
        <Icon name="save" />
        {{ saving ? t('projectsInit.saving') : t('projectsInit.save') }}
      </Button>
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
import Button from '~/components/ui/button/Button.vue'
import Textarea from '~/components/ui/textarea/Textarea.vue'

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
