<template>
  <div class="lqe">
    <div class="lqe-head">
      <span class="lqe-label">{{ t('infra.logs.editor.label') }}</span>
      <span class="lqe-hint">{{ t('infra.logs.editor.hint') }}</span>
    </div>
    <textarea
      class="lqe-input"
      spellcheck="false"
      autocomplete="off"
      autocapitalize="off"
      :value="modelValue"
      :placeholder="placeholder"
      @input="onInput"
      @keydown="onKey"
    />
  </div>
</template>

<script setup lang="ts">
// Ô soạn câu Logs Insights (Mốc 2 việc 2.3).
//
// VÌ SAO KHÔNG DÙNG MONACO (2026-09-16). Bản trước nhúng `MonacoEditor` để tô cú
// pháp + gợi ý trường, nhưng dưới Vite dev nó liên tục hỏng: bundle monaco quá lớn
// làm pipeline transform "Maximum call stack size exceeded" + 404 chunk cache, và
// màn Logs kẹt ở "Đang nạp editor…". Câu Insights là một ô văn bản ngắn, không phải
// một file mã — nên một `<textarea>` monospace vừa đủ, nhẹ, và KHÔNG bao giờ dính
// lỗi tải bundle. Đây là đánh đổi có chủ đích: mất tô cú pháp + autocomplete trường,
// đổi lấy một ô luôn chạy.
defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  run: []
  cancel: []
}>()

const { t } = useI18n()

const placeholder = 'fields @timestamp, @message\n| sort @timestamp desc\n| limit 100'

function onInput(e: Event): void {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
}

// ── phím tắt 2.3 ───────────────────────────────────────────────────────────
// ⌘/Ctrl+Enter = chạy, ⌘/Ctrl+. = huỷ. Chỉ DỊCH phím thành sự kiện, không tự
// quyết chạy: `canRun`/`running` nằm ở `InfraLogs`, nên phím tắt không làm được
// việc mà nút đang vô hiệu không làm được — luật "AWOG không tự chạy" còn nguyên.
function onKey(e: KeyboardEvent): void {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
  const isRun = e.key === 'Enter'
  // Layout bàn phím không phải lúc nào cũng cho `e.key` là dấu chấm, nên soi thêm
  // `e.code`.
  const isCancel = e.key === '.' || e.code === 'Period'
  if (!isRun && !isCancel) return
  e.preventDefault()
  if (isRun) emit('run')
  else emit('cancel')
}
// Đổi câu lệnh từ BÊN NGOÀI (mẫu sẵn, lịch sử, chèn facet) chỉ cần cập nhật `:value`
// — `<textarea>` không giữ state riêng nên không cần đồng bộ tay như Monaco từng cần.
</script>

<style scoped>
.lqe {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.lqe-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 0 0 6px;
  flex-wrap: wrap;
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

/* Ô soạn câu dài ⇒ resize-y (luật textarea của *Editor.vue). */
.lqe-input {
  width: 100%;
  min-height: 108px;
  resize: vertical;
  padding: 9px 11px;
  border: 1px solid var(--border);
  border-radius: var(--r-btn);
  background: var(--bgEl);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-md);
  /* mono-ok: câu lệnh Logs Insights — cú pháp AWS, người dùng copy-paste được */
  font-family: var(--code);
  outline: none;
}

.lqe-input:focus {
  border-color: var(--accentBorder);
}

.lqe-input::placeholder {
  color: var(--textFaint);
}
</style>
