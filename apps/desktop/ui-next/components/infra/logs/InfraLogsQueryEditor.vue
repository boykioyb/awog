<template>
  <div class="lqe" @keydown.capture="onKeyCapture">
    <div class="lqe-head">
      <span class="lqe-label">{{ t('infra.logs.editor.label') }}</span>
      <span class="lqe-hint">{{ t('infra.logs.editor.hint') }}</span>
    </div>
    <div class="lqe-host">
      <MonacoEditor ref="editorRef" path="insights-query" @ready="onReady" @change="onChange" />
      <div v-if="!ready" class="lqe-loading">{{ t('infra.logs.editor.loading') }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Ô soạn câu Logs Insights (Mốc 2 việc 2.3). Dùng lại `MonacoEditor` multi-tab của
// app (ADR 0021) với ĐÚNG MỘT model `insights-query` — không dựng editor riêng,
// vì bản đó đã lo theme theo token của app, worker nội bộ, và ⌘S.
//
// Tokenizer + gợi ý trường sống ở `utils/monaco-insights.ts`. Ở đây chỉ nối dây:
// đăng ký ngôn ngữ một lần, rồi đồng bộ hai chiều giữa `modelValue` và model.
import MonacoEditor from '~/components/common/MonacoEditor.vue'
import type { MonacoEditorHandle } from '~/components/editor/types'
import { loadMonaco } from '~/utils/monaco-loader'
import { INSIGHTS_LANGUAGE_ID, registerInsightsLanguage } from '~/utils/monaco-insights'

const props = defineProps<{
  modelValue: string
  /** Tên trường lấy từ kết quả đã chạy — nguồn gợi ý (2.3). */
  fields?: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  run: []
  cancel: []
}>()

const { t } = useI18n()
const MODEL_PATH = 'insights-query'

const editorRef = useTemplateRef<MonacoEditorHandle>('editorRef')
const ready = ref(false)
// `fields` đọc qua getter chứ không chụp lại: provider của Monaco sống lâu hơn
// một lần render, nên nó phải luôn thấy danh sách MỚI NHẤT.
const fields = computed(() => props.fields ?? [])

async function onReady(): Promise<void> {
  const monaco = await loadMonaco()
  registerInsightsLanguage(monaco, () => fields.value)
  editorRef.value?.openFile(MODEL_PATH, props.modelValue, INSIGHTS_LANGUAGE_ID)
  ready.value = true
}

function onChange(payload: { path: string; value: string }): void {
  if (payload.path !== MODEL_PATH) return
  emit('update:modelValue', payload.value)
}

// Đổi câu lệnh từ BÊN NGOÀI (bấm mẫu sẵn, bấm lịch sử, chèn facet) phải vào được
// editor. `setValue` không phát `change` nên không tạo vòng lặp hai chiều.
watch(
  () => props.modelValue,
  (value) => {
    if (!ready.value) return
    if (editorRef.value?.getValue(MODEL_PATH) === value) return
    editorRef.value?.setValue(MODEL_PATH, value)
  },
)

// ── phím tắt 2.3 ───────────────────────────────────────────────────────────
// Bắt ở pha CAPTURE ngay trên wrapper này thay vì đăng ký vào Monaco: Monaco gắn
// handler trên các node con của nó, nên capture ở đây chạy TRƯỚC, và
// `stopPropagation()` giữ cho nó không kịp chèn ký tự. Nhờ vậy `MonacoEditor` —
// vốn dùng chung với editor code của app — vẫn không phải sửa một dòng nào.
//
// Ở đây chỉ DỊCH phím thành sự kiện, không tự quyết định chạy: `canRun`/`running`
// nằm ở `InfraLogs`. Nhờ vậy phím tắt không thể làm được việc mà nút bấm đang bị
// vô hiệu không làm được — luật "AWOG không tự chạy" vẫn còn nguyên.
function onKeyCapture(e: KeyboardEvent): void {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
  const isRun = e.key === 'Enter'
  // Layout bàn phím không phải lúc nào cũng cho `e.key` là dấu chấm, nên soi thêm
  // `e.code`.
  const isCancel = e.key === '.' || e.code === 'Period'
  if (!isRun && !isCancel) return
  e.preventDefault()
  e.stopPropagation()
  if (isRun) emit('run')
  else emit('cancel')
}
</script>

<style scoped>
.lqe {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 auto;
}

.lqe-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 0 0 6px;
}

.lqe-label {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--text);
}

.lqe-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}

.lqe-host {
  position: relative;
  flex: 1 1 auto;
  min-height: 132px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  overflow: hidden;
  background: var(--bgEl);
}

.lqe-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
</style>
