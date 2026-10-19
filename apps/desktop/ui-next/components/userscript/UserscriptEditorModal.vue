<template>
  <!-- KHÔNG dựng trên Dialog reka: reka bắt Esc ở capture phase của document nên Esc
       để đóng gợi ý / ô tìm của Monaco sẽ đóng luôn cả hộp; overlay tự dựng chỉ nhận
       Esc khi Monaco không giữ phím. -->
  <Teleport to="body">
    <!-- hook-ok: `.ovl.on` nằm trong OVERLAYS (useEmbeddedBrowser.ts); skin cũ bị utility đè hết -->
    <div v-if="open" :class="SCRIM" @click.self="emit('close')" @keydown.esc="emit('close')">
      <div
        class="flex h-[min(40rem,88vh)] w-[min(53.75rem,94vw)] flex-col gap-2.5 rounded-xl border bg-popover px-4.5 py-4 shadow-lg"
        role="dialog"
        aria-modal="true"
        @keydown="onKeydown"
      >
        <div class="flex items-center gap-2">
          <Icon name="code" />
          <span class="flex-1 text-lg text-foreground">
            {{ scriptId ? t('userscripts.editor.editTitle') : t('userscripts.editor.newTitle') }}
          </span>
          <Button
            variant="ghost"
            size="iconSm"
            class="text-dim"
            :title="t('common.close')"
            :aria-label="t('common.close')"
            @click="emit('close')"
          >
            <Icon name="x" />
          </Button>
        </div>

        <p class="m-0 text-sm text-dim">{{ t('userscripts.editor.hint') }}</p>

        <div class="min-h-0 flex-auto overflow-hidden rounded-lg border">
          <MonacoEditor
            v-if="source !== null"
            ref="editorRef"
            :path="modelPath"
            @ready="onEditorReady"
            @change="onEditorChange"
            @save="save"
          />
          <div v-else-if="loadError" :class="ERR">{{ loadError }}</div>
          <div v-else class="p-3 text-sm text-faint">{{ t('common.loading') }}</div>
        </div>

        <div v-if="saveError" :class="ERR" role="alert">{{ saveError }}</div>

        <div class="flex justify-end gap-2">
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

// Scrim: `ovl on` chỉ còn là hook cho OVERLAYS — skin cũ (vị trí, nền, căn, z) bị utility
// dưới đây đè. z-100 = band modal thường như `.ovl` cũ.
const SCRIM =
  'ovl on fixed inset-0 z-100 flex items-start justify-center bg-black/55 pt-[13vh] [-webkit-app-region:no-drag]'
const ERR = 'rounded-lg bg-destructive/10 px-2.5 py-2 text-sm whitespace-pre-wrap text-destructive'

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
