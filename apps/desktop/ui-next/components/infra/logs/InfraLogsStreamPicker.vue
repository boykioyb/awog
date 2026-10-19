<template>
  <div class="flex min-h-0 flex-auto flex-col gap-2">
    <div class="flex items-baseline gap-2">
      <span class="text-sm font-semibold">{{ t('infra.logs.streams.title') }}</span>
      <span class="text-xs text-dim tabular-nums">
        {{ t('infra.logs.streams.count', { n: streams.length }) }}
      </span>
      <span class="flex-auto" />
      <span class="text-xs text-dim">{{ t('infra.logs.streams.pickHint') }}</span>
    </div>

    <Alert v-if="error" variant="destructive" class="border-destructive px-2 py-1.5">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <!-- Danh sách lấp đầy panel và tự cuộn. Nó nằm trong cột chính đã là một Card nên
         không tự mang khung (card trong card). -->
    <div
      v-else
      class="flex min-h-0 flex-auto flex-col overflow-y-auto"
      role="listbox"
      aria-label="log streams"
    >
      <!-- "Tất cả stream" là MỘT DÒNG của chính danh sách, không phải một chế độ
           riêng: người muốn xem gộp vẫn chỉ mất đúng một cú bấm như mọi dòng khác,
           và không phải học thêm một khái niệm nào. -->
      <!-- raw-ok: hàng list cả dòng là một vùng bấm (role=option), không phải nút -->
      <button
        class="flex w-full cursor-pointer items-center gap-2 border-b px-3 py-2 text-left text-foreground transition-colors last:border-b-0 hover:bg-accent"
        type="button"
        role="option"
        :aria-selected="false"
        @click="emit('select', '')"
      >
        <Icon name="layers" class="size-3.5 shrink-0 text-primary" />
        <span class="flex min-w-0 flex-auto flex-col gap-0.5">
          <!-- Dòng "Tất cả stream" là CÂU CHỮ, không phải định danh — nên không mono. -->
          <span class="truncate text-sm font-semibold">{{ t('infra.logs.streams.all') }}</span>
          <span class="text-xs text-dim">{{ t('infra.logs.streams.allHint') }}</span>
        </span>
        <Icon name="chev-right" class="size-3.5 shrink-0 text-faint" />
      </button>

      <p v-if="loading && streams.length === 0" class="px-3 py-3.5 text-sm text-dim">
        {{ t('infra.logs.streams.loading') }}
      </p>
      <p v-else-if="streams.length === 0" class="px-3 py-3.5 text-sm text-dim">
        {{ t('infra.logs.streams.empty') }}
      </p>

      <!-- raw-ok: hàng list cả dòng là một vùng bấm (role=option), không phải nút -->
      <button
        v-for="s in streams"
        :key="s.name"
        class="flex w-full cursor-pointer items-center gap-2 border-b px-3 py-2 text-left text-foreground transition-colors last:border-b-0 hover:bg-accent"
        type="button"
        role="option"
        :aria-selected="false"
        :title="s.name"
        @click="emit('select', s.name)"
      >
        <Icon name="file" class="size-3.5 shrink-0 text-dim" />
        <span class="flex min-w-0 flex-auto flex-col gap-0.5">
          <!-- mono-ok: tên log stream là định danh tài nguyên, người dùng copy sang CLI -->
          <span class="truncate font-mono text-sm">{{ s.name }}</span>
          <span class="text-xs text-dim">{{ subtitleOf(s) }}</span>
        </span>
        <Icon name="chev-right" class="size-3.5 shrink-0 text-faint" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// DANH SÁCH stream của nhóm log đang mở — nửa "chủ" của mô hình chủ–chi tiết mà
// người dùng chốt ngày 2026-09-17: nhóm log → chọn stream → mới đọc dòng log.
//
// Khối này đã đi qua ba chỗ trong hai ngày, và lý do đổi đáng ghi lại:
//   1. Cột trái, dưới danh sách nhóm log — bị đẩy khuất sau 34 nhóm của tài khoản.
//   2. Panel chính, một dải chip cuộn ngang — thấy được, nhưng vẫn chỉ là bộ lọc
//      của một bảng log đã hiện sẵn.
//   3. Nay: panel chính, danh sách đầy đủ, và KHÔNG có dòng log nào cho tới khi
//      chọn. Đổi lại một cú bấm, được cái người đọc thấy nhóm này có bao nhiêu
//      stream và stream nào vừa có event — thứ một bảng log gộp không nói ra.
//
// Chỉ ĐỌC metadata (`describe-log-streams`): mở danh sách không tính GB quét.
import type { AwsLogStream } from '~/composables/useAwsLogsApi'

defineProps<{
  streams: AwsLogStream[]
  loading: boolean
  error: string
}>()

const emit = defineEmits<{ select: [name: string] }>()

const { t } = useI18n()

/** Byte ⇒ đơn vị đọc được (giữ tại chỗ như GroupPicker — cùng một phép). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}

/**
 * Dòng phụ: event gần nhất + dung lượng.
 *
 * "Gần nhất" viết theo khoảng cách ("4 phút trước") chứ không phải mốc tuyệt đối:
 * câu hỏi khi đứng trước danh sách này là *"cái nào còn sống"*, và một cột giờ phút
 * bắt người đọc tự trừ trong đầu để trả lời.
 */
function subtitleOf(s: AwsLogStream): string {
  const size = formatBytes(s.storedBytes)
  if (!s.lastEventAt) return t('infra.logs.streams.noEvent', { size })
  return t('infra.logs.streams.lastEventAgo', { ago: agoOf(s.lastEventAt), size })
}

function agoOf(ms: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (sec < 60) return t('infra.logs.streams.agoSec', { n: sec })
  const min = Math.round(sec / 60)
  if (min < 60) return t('infra.logs.streams.agoMin', { n: min })
  const hour = Math.round(min / 60)
  if (hour < 24) return t('infra.logs.streams.agoHour', { n: hour })
  return t('infra.logs.streams.agoDay', { n: Math.round(hour / 24) })
}
</script>
