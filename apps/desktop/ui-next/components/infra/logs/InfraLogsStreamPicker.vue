<template>
  <div class="lsp">
    <div class="lsp-head">
      <span class="lsp-title">{{ t('infra.logs.streams.title') }}</span>
      <span class="lsp-count">{{ t('infra.logs.streams.count', { n: streams.length }) }}</span>
      <span class="lsp-gap" />
      <span class="lsp-hint">{{ t('infra.logs.streams.pickHint') }}</span>
    </div>

    <div v-if="error" class="lsp-error">{{ error }}</div>

    <div v-else class="lsp-list tblcard" role="listbox" aria-label="log streams">
      <!-- "Tất cả stream" là MỘT DÒNG của chính danh sách, không phải một chế độ
           riêng: người muốn xem gộp vẫn chỉ mất đúng một cú bấm như mọi dòng khác,
           và không phải học thêm một khái niệm nào. -->
      <button
        class="lsp-row all"
        type="button"
        role="option"
        :aria-selected="false"
        @click="emit('select', '')"
      >
        <Icon name="layers" class="lsp-row-ic" />
        <span class="lsp-row-main">
          <span class="lsp-row-name plain">{{ t('infra.logs.streams.all') }}</span>
          <span class="lsp-row-sub">{{ t('infra.logs.streams.allHint') }}</span>
        </span>
        <Icon name="chev-right" class="lsp-row-go" />
      </button>

      <p v-if="loading && streams.length === 0" class="lsp-empty">
        {{ t('infra.logs.streams.loading') }}
      </p>
      <p v-else-if="streams.length === 0" class="lsp-empty">
        {{ t('infra.logs.streams.empty') }}
      </p>

      <button
        v-for="s in streams"
        :key="s.name"
        class="lsp-row"
        type="button"
        role="option"
        :aria-selected="false"
        :title="s.name"
        @click="emit('select', s.name)"
      >
        <Icon name="file" class="lsp-row-ic" />
        <span class="lsp-row-main">
          <span class="lsp-row-name">{{ s.name }}</span>
          <span class="lsp-row-sub">{{ subtitleOf(s) }}</span>
        </span>
        <Icon name="chev-right" class="lsp-row-go" />
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

<style scoped>
.lsp {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1 1 auto;
  min-height: 0;
}

.lsp-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.lsp-title {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
}

.lsp-count,
.lsp-hint {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}

.lsp-count {
  font-variant-numeric: tabular-nums;
}

.lsp-gap {
  flex: 1 1 auto;
}

.lsp-error {
  padding: 6px 8px;
  border: 1px solid var(--danger);
  border-radius: var(--r-sm);
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

/* Danh sách lấp đầy panel và tự cuộn — `.tblcard` là da card dùng chung của khu
   `/infra` (app-shell.css), ở đây chỉ còn bố cục. */
.lsp-list {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.lsp-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 8px 11px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}

.lsp-row:last-child {
  border-bottom: 0;
}

.lsp-row:hover {
  background: var(--bgHover);
}

.lsp-row-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  color: var(--textDim);
}

.lsp-row.all .lsp-row-ic {
  color: var(--accent);
}

.lsp-row-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
}

.lsp-row-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  /* mono-ok: tên log stream là định danh tài nguyên, người dùng copy sang CLI */
  font-family: var(--code);
}

/* Dòng "Tất cả stream" là CÂU CHỮ, không phải định danh — nên không mono. */
.lsp-row-name.plain {
  font-family: inherit;
  font-weight: 600;
}

.lsp-row-sub {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}

.lsp-row-go {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
  color: var(--textFaint);
}

.lsp-empty {
  margin: 0;
  padding: 14px 11px;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
</style>
