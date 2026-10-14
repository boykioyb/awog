<template>
  <Teleport to="body">
    <div v-if="open" class="ovl on" @click.self="emit('close')" @keydown.esc="emit('close')">
      <div class="use-card" role="dialog" aria-modal="true" @keydown="onKeydown">
        <div class="use-head">
          <Icon name="code" class="icn" />
          <span class="use-title">
            {{ scriptId ? t('userscripts.editor.editTitle') : t('userscripts.editor.newTitle') }}
          </span>
          <button
            type="button"
            class="use-x"
            :title="t('common.close')"
            :aria-label="t('common.close')"
            @click="emit('close')"
          >
            <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
          </button>
        </div>

        <p class="use-hint">{{ t('userscripts.editor.hint') }}</p>

        <div class="use-body">
          <MonacoEditor
            v-if="source !== null"
            ref="editorRef"
            :path="modelPath"
            @ready="onEditorReady"
            @change="onEditorChange"
            @save="save"
          />
          <div v-else-if="loadError" class="use-err">{{ loadError }}</div>
          <div v-else class="use-loading">{{ t('common.loading') }}</div>
        </div>

        <div v-if="saveError" class="use-err" role="alert">{{ saveError }}</div>

        <div class="use-foot">
          <Button variant="outline" size="sm" :disabled="busy" @click="emit('close')">
            {{ t('common.cancel') }}
          </Button>
          <Button variant="default" size="sm" :disabled="busy || source === null" @click="save">
            {{ busy ? t('common.saving') : t('common.save') }}
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Soạn / sửa một userscript trong Monaco (docs/features/browser-userscripts.md).
//
// Nguồn đầy đủ (kể cả khối `// ==UserScript==`) là thứ DUY NHẤT người dùng sửa — metadata
// do sidecar parse lúc lưu, nên không có form riêng nào có thể lệch khỏi header. Lỗi parse
// (thiếu @name, quá cỡ…) do sidecar ném và hiện ngay dưới editor; modal không đóng.
//
// Monaco là API mệnh lệnh: nguồn được đẩy VÀO lúc mở (openFile) và kéo RA qua `change`.
// Model key có tiền tố `__userscript__/` + id để không chung undo stack với file thật.
import { defineAsyncComponent } from 'vue'
import type { MonacoEditorHandle } from '~/components/editor/types'
import type { UserscriptItem } from '~/types'
import Button from '~/components/ui/button/Button.vue'
import { buildUserscriptTemplate, useUserscripts } from '~/composables/useUserscripts'
import { sidecarErrorText } from '~/composables/useSidecar'

// Monaco chỉ tải khi modal thực sự mở (cùng lý do với WikiEditor).
const MonacoEditor = defineAsyncComponent(() => import('~/components/common/MonacoEditor.vue'))

const props = withDefaults(
  defineProps<{
    open: boolean
    // Có id ⇒ sửa script đó; vắng ⇒ tạo mới.
    scriptId?: string | null
    // Nguồn khởi tạo khi tạo mới (vd mẫu đã điền @match của tab hiện tại).
    initialSource?: string | null
  }>(),
  { scriptId: null, initialSource: null },
)

const emit = defineEmits<{
  close: []
  saved: [item: UserscriptItem]
}>()

const { t } = useI18n()
const api = useUserscripts()

const editorRef = useTemplateRef<MonacoEditorHandle>('editorRef')
// null = chưa có nguồn để hiện (đang tải script cũ); chuỗi (kể cả rỗng) = đã có.
const source = ref<string | null>(null)
const ready = ref(false)
const busy = ref(false)
const loadError = ref('')
const saveError = ref('')

// Mỗi lần mở là một model mới (khoá theo lần mở) để nội dung sửa dở của lần trước không
// sống lại qua cache model của Monaco.
const session = ref(0)
const modelPath = computed(
  () => `__userscript__/${props.scriptId ?? 'new'}-${session.value}.user.js`,
)

const pushSource = (): void => {
  if (!ready.value || source.value === null) return
  editorRef.value?.openFile(modelPath.value, source.value, 'javascript')
}

const onEditorReady = (): void => {
  ready.value = true
  pushSource()
}

const onEditorChange = (payload: { path: string; value: string }): void => {
  if (payload.path === modelPath.value) source.value = payload.value
}

const begin = async (): Promise<void> => {
  session.value++
  ready.value = false
  saveError.value = ''
  loadError.value = ''
  source.value = null
  if (!props.scriptId) {
    source.value = props.initialSource ?? buildUserscriptTemplate()
    return
  }
  try {
    source.value = await api.get(props.scriptId)
  } catch (err) {
    loadError.value = sidecarErrorText(err)
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) void begin()
  },
  { immediate: true },
)
watch(source, (v, prev) => {
  // Lần đầu có nguồn (null → chuỗi): editor có thể đã sẵn sàng trước.
  if (prev === null && v !== null) nextTick(pushSource)
})

const save = async (): Promise<void> => {
  if (busy.value || source.value === null) return
  busy.value = true
  saveError.value = ''
  try {
    const item = await api.save(source.value, props.scriptId ?? undefined)
    if (item.warnings.length) {
      useToast().add({
        title: t('userscripts.toast.savedWarnings', { count: item.warnings.length }),
        color: 'warning',
      })
    }
    emit('saved', item)
    emit('close')
  } catch (err) {
    saveError.value = sidecarErrorText(err)
  } finally {
    busy.value = false
  }
}

// ⌘S ngoài Monaco; trong Monaco thì Monaco giữ phím và phát `save`.
const onKeydown = (event: KeyboardEvent): void => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void save()
  }
}
</script>

<style scoped>
.use-card {
  width: min(860px, 94vw);
  height: min(640px, 88vh);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 18px;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
}
.use-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.use-title {
  flex: 1;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  color: var(--text);
}
.use-x {
  display: flex;
  align-items: center;
  padding: 4px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.use-x:hover {
  background: var(--bgHover);
  color: var(--text);
}
.use-hint {
  margin: 0;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.use-body {
  flex: 1 1 auto;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  overflow: hidden;
}
.use-body :deep(.mehost) {
  height: 100%;
}
.use-loading {
  padding: 12px;
  color: var(--textFaint);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.use-err {
  padding: 8px 10px;
  border-radius: var(--r-btn);
  background: var(--dangerBg);
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  white-space: pre-wrap;
}
.use-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
