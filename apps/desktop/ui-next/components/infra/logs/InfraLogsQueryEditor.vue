<template>
  <div class="flex min-h-0 flex-col">
    <div class="flex flex-wrap items-baseline gap-2 pb-1.5">
      <span class="text-sm font-semibold text-foreground">{{ t('infra.logs.editor.label') }}</span>
      <span class="text-xs text-dim">{{ t('infra.logs.editor.hint') }}</span>
    </div>
    <!-- Ô soạn câu dài ⇒ resize-y (luật textarea của *Editor.vue).
         mono-ok: câu lệnh Logs Insights — cú pháp AWS, người dùng copy-paste được -->
    <Textarea
      class="min-h-27 resize-y rounded-lg bg-card px-3 py-2 font-mono text-sm leading-(--lh-md) placeholder:text-faint"
      spellcheck="false"
      autocomplete="off"
      autocapitalize="off"
      :model-value="modelValue"
      :placeholder="placeholder"
      @update:model-value="(v: string | number) => emit('update:modelValue', String(v))"
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
// Đổi câu lệnh từ BÊN NGOÀI (mẫu sẵn, lịch sử, chèn facet) chỉ cần cập nhật `modelValue`
// — `Textarea` không giữ state riêng nên không cần đồng bộ tay như Monaco từng cần.
</script>
