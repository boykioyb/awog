<template>
  <!-- Lấp đầy phần còn lại của cột trái: danh sách nhóm cao hết cỡ rồi mới cuộn,
       không để trống khoảng dưới. -->
  <div class="flex min-h-0 flex-auto flex-col gap-2">
    <div class="flex items-baseline justify-between gap-2">
      <span class="text-sm font-semibold">{{ t('infra.logs.groups.title') }}</span>
      <span v-if="mode === 'multi'" class="text-xs text-dim tabular-nums">
        {{ t('infra.logs.groups.picked', { n: picked.length, max: maxGroups }) }}
      </span>
      <span v-else class="text-xs text-dim tabular-nums">
        {{ t('infra.logs.groups.available', { n: shown.length }) }}
      </span>
    </div>

    <div class="flex items-center gap-1.5">
      <div class="relative min-w-0 flex-auto">
        <Icon
          name="search"
          class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint"
        />
        <Input
          :model-value="pattern"
          type="search"
          spellcheck="false"
          autocomplete="off"
          :placeholder="t('infra.logs.groups.searchPh')"
          class="h-ctrl-sm pl-8"
          @keydown.enter="emit('reload')"
          @update:model-value="onSearch"
        />
      </div>
      <Button type="button" :disabled="loading" variant="outline" size="sm" @click="emit('reload')">
        {{ loading ? t('infra.logs.groups.loading') : t('infra.logs.groups.reload') }}
      </Button>
    </div>

    <!-- Nhóm dùng gần đây lên trước khi CHƯA bấm nhóm nào — lối tắt vào việc hay làm. -->
    <div v-if="recent.length > 0 && !activeMarked" class="flex flex-wrap items-center gap-1">
      <span class="text-xs text-dim">{{ t('infra.logs.groups.recent') }}</span>
      <Button
        v-for="name in recent"
        :key="name"
        variant="outline"
        size="xs"
        class="h-auto max-w-full rounded-full px-2 py-1 font-normal text-muted-foreground shadow-none hover:border-input hover:bg-transparent hover:text-foreground"
        :title="name"
        @click="pick(name)"
      >
        <!-- mono-ok: tên log group là định danh tài nguyên, không phải câu văn -->
        <span class="max-w-60 truncate font-mono">{{ shortName(name) }}</span>
      </Button>
    </div>

    <Alert v-if="error" variant="destructive" class="border-destructive px-2 py-1.5">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <!-- Đang tải thì NÓI ra. Trước đây nhánh này chỉ ẩn dòng "không có nhóm log"
         khi `loading`, nên chỗ đó là một khoảng trắng không giải thích gì — và người
         mới mở màn không phân biệt được "đang nạp" với "tài khoản này trống". -->
    <p v-else-if="loading && shown.length === 0" class="p-3 text-sm text-dim">
      {{ t('infra.logs.groups.loading') }}
    </p>

    <p v-else-if="shown.length === 0" class="p-3 text-sm text-dim">
      {{ t('infra.logs.groups.empty') }}
    </p>

    <!-- Danh sách nhóm là CHIP, không phải hàng hai dòng có byte/hạn lưu: bấm một
         chip là tail nhóm đó ngay (mode tail), hoặc tick chọn (mode multi). Số đo
         dung lượng chuyển vào tooltip để chip mỏng, giảm mật độ. Cao hết phần còn
         lại của cột trái rồi mới cuộn. -->
    <div
      v-else
      class="flex min-h-24 flex-auto flex-wrap content-start gap-1 overflow-y-auto p-px"
      role="listbox"
      :aria-multiselectable="mode === 'multi'"
    >
      <!-- Trạng thái chọn = accent-tint (KHÔNG nền xám). -->
      <Button
        v-for="g in shown"
        :key="g.name"
        variant="outline"
        size="xs"
        class="h-auto max-w-full gap-1 rounded-full px-2 py-1 font-normal shadow-none [&_svg]:size-3 disabled:cursor-not-allowed disabled:opacity-40"
        :class="
          isOn(g.name)
            ? 'border-selected-border bg-selected text-primary hover:bg-selected hover:text-primary'
            : 'text-muted-foreground hover:border-input hover:bg-transparent hover:text-foreground'
        "
        role="option"
        :aria-selected="isOn(g.name)"
        :title="chipTitle(g)"
        :disabled="mode === 'multi' && !picked.includes(g.name) && picked.length >= maxGroups"
        @click="pick(g.name)"
      >
        <Icon :name="chipIcon(g.name)" />
        <!-- mono-ok: tên log group là định danh tài nguyên, không phải câu văn -->
        <span class="max-w-60 truncate font-mono">{{ shortName(g.name) }}</span>
        <Icon v-if="mode === 'multi' && picked.includes(g.name)" name="x" class="opacity-70" />
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Chọn nhóm log dưới dạng CHIP (Mốc 2 việc 2.1). Chỉ đọc metadata — mở không tốn
// một xu CloudWatch nào.
//
// Hai chế độ trên CÙNG một hình dáng chip:
//   · `tail`  (mặc định của màn) — bấm một chip = xem dòng mới nhất của nhóm đó ngay
//     (`filter-log-events`, rẻ). Chỉ một nhóm "đang xem" tại một thời điểm.
//   · `multi` (chế độ Insights nâng cao) — bấm để tick/bỏ, chọn nhiều nhóm cho một
//     truy vấn Insights. Trần `maxGroups` khớp `MAX_LOG_GROUPS` của sidecar.
import type { AwsLogGroup } from '~/composables/useAwsLogsApi'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const props = withDefaults(
  defineProps<{
    groups: AwsLogGroup[]
    mode?: 'tail' | 'multi'
    /** Nhóm đang tick (mode multi). */
    picked?: string[]
    /** Nhóm đang xem (mode tail). */
    active?: string
    recent: string[]
    pattern: string
    loading: boolean
    error: string
    maxGroups?: number
  }>(),
  { mode: 'tail', picked: () => [], active: '', maxGroups: 25 },
)

const emit = defineEmits<{
  toggle: [name: string]
  tail: [name: string]
  reload: []
  'update:pattern': [value: string]
}>()

const { t } = useI18n()
const maxGroups = computed(() => props.maxGroups)

// Lọc client-side theo ô tìm để thu hẹp TỨC THÌ, không phải chờ `reload` gọi mạng.
// `reload` vẫn còn cho lần nạp danh sách khác (tiền tố khác hẳn / danh sách cũ).
const shown = computed<AwsLogGroup[]>(() => {
  const q = props.pattern.trim().toLowerCase()
  if (!q) return props.groups
  return props.groups.filter((g) => g.name.toLowerCase().includes(q))
})

const activeMarked = computed(() =>
  props.mode === 'multi' ? props.picked.length > 0 : props.active.length > 0,
)

function isOn(name: string): boolean {
  return props.mode === 'multi' ? props.picked.includes(name) : props.active === name
}

function chipIcon(name: string): string {
  if (props.mode === 'multi') return props.picked.includes(name) ? 'check' : 'layers'
  return props.active === name ? 'eye' : 'layers'
}

function pick(name: string): void {
  if (props.mode === 'multi') emit('toggle', name)
  else emit('tail', name)
}

function onSearch(v: string): void {
  emit('update:pattern', v)
}

/**
 * Rút gọn tên hiển thị: bỏ tiền tố `/aws/<service>/` quen thuộc để lộ phần phân
 * biệt. Giữ nguyên tên gốc trong `title` (tooltip) — không đánh lừa người đọc.
 */
function shortName(name: string): string {
  const m = /^\/aws\/[^/]+\/(.+)$/.exec(name)
  return m && m[1] ? m[1] : name
}

function chipTitle(g: AwsLogGroup): string {
  const parts = [g.name, formatBytes(g.storedBytes)]
  parts.push(
    g.retentionDays !== null
      ? t('infra.logs.groups.retention', { d: g.retentionDays })
      : t('infra.logs.groups.noRetention'),
  )
  return parts.join('\n')
}

/** Byte ⇒ đơn vị đọc được (giữ tại chỗ: đây là con số chi phối quyết định chi phí). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}
</script>
