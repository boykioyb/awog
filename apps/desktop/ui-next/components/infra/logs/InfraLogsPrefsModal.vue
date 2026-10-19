<template>
  <!-- Dialog shadcn (reka) — tự portal ra body, khoá focus, Esc/bấm nền là đóng.
       `[role=dialog][data-state=open]` đã có trong OVERLAYS của trình duyệt nhúng. -->
  <Dialog :open="open" @update:open="(v: boolean) => !v && emit('close')">
    <DialogContent
      class="flex max-h-[78vh] w-[calc(100vw-2rem)] max-w-190 flex-col gap-3 px-4 pt-3.5 pb-3 sm:rounded-xl"
    >
      <DialogHeader class="shrink-0 pr-8">
        <DialogTitle class="text-lg font-semibold">{{ t('infra.logs.prefs.title') }}</DialogTitle>
      </DialogHeader>

      <!-- Hai cột như hộp thoại gốc; hẹp thì xếp chồng thay vì bóp cả hai thành khe. -->
      <div class="grid min-h-0 grid-cols-1 gap-4 overflow-auto sm:grid-cols-2">
        <!-- ── Trái: cách một dòng được mở ra ───────────────────────────────── -->
        <section class="flex min-w-0 flex-col gap-2">
          <h3 class="text-sm font-semibold">{{ t('infra.logs.prefs.rowSection') }}</h3>

          <!-- `@update` thu hẹp giá trị của reka (AcceptableValue) về đúng union. -->
          <RadioGroup
            :model-value="draft.rowMode"
            class="gap-2"
            @update:model-value="(v) => (v === 'pane' || v === 'inline') && (draft.rowMode = v)"
          >
            <Label
              v-for="m in ROW_MODES"
              :key="m"
              class="cursor-pointer items-start text-sm font-normal"
            >
              <RadioGroupItem :value="m" class="mt-0.5" />
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="text-sm">{{ t(`infra.logs.prefs.rowMode.${m}`) }}</span>
                <span class="text-xs leading-(--lh-sm) text-dim">
                  {{ t(`infra.logs.prefs.rowMode.${m}Desc`) }}
                </span>
              </span>
            </Label>
          </RadioGroup>

          <!-- Mở sẵn chỉ có nghĩa khi chi tiết nằm TRONG bảng; ở chế độ cửa sổ
               riêng thì "mở sẵn" sẽ là mở sẵn cái gì? Khoá lại thay vì cho bật
               một thứ không làm gì. -->
          <Label
            class="items-start pl-5.5 text-sm font-normal"
            :class="draft.rowMode !== 'inline' ? 'cursor-default opacity-50' : 'cursor-pointer'"
          >
            <Checkbox
              :model-value="draft.expandByDefault"
              class="mt-0.5"
              :disabled="draft.rowMode !== 'inline'"
              @update:model-value="draft.expandByDefault = $event === true"
            />
            <span class="text-sm">{{ t('infra.logs.prefs.expandByDefault') }}</span>
          </Label>

          <Label class="cursor-pointer items-start text-sm font-normal">
            <Checkbox
              :model-value="draft.wrapLines"
              class="mt-0.5"
              @update:model-value="draft.wrapLines = $event === true"
            />
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="text-sm">{{ t('infra.logs.prefs.wrapLines') }}</span>
              <span class="text-xs leading-(--lh-sm) text-dim">
                {{ t('infra.logs.prefs.wrapLinesDesc') }}
              </span>
            </span>
          </Label>
        </section>

        <!-- ── Phải: cột nào hiện ─────────────────────────────────────────────
             Vách ngăn giữa hai cột, đúng như bản gốc (xếp chồng thì thành vách ngang). -->
        <section
          class="flex min-w-0 flex-col gap-2 border-t pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4"
        >
          <h3 class="text-sm font-semibold">{{ t('infra.logs.prefs.columnsSection') }}</h3>

          <p v-if="all.length === 0" class="mt-1 text-xs leading-(--lh-sm) text-faint">
            {{ t('infra.logs.prefs.noColumns') }}
          </p>

          <!-- Cột liệt kê theo ĐÚNG thứ tự bảng đang vẽ, không theo bảng chữ cái:
               người dùng đang nhìn cái bảng đó, và một danh sách xếp khác thứ tự
               bắt họ dịch qua lại trong đầu. -->
          <Label
            v-for="c in all"
            :key="c"
            class="cursor-pointer border-b py-1.5 text-sm font-normal"
          >
            <!-- mono-ok: tên cột là tên TRƯỜNG của Insights, người dùng gõ lại vào câu lệnh -->
            <span class="flex-auto truncate font-mono text-xs leading-(--lh-sm)" :title="c">
              {{ c }}
            </span>
            <Checkbox
              :model-value="!draft.hiddenColumns.includes(c)"
              :disabled="!draft.hiddenColumns.includes(c) && shownCount <= 1"
              @update:model-value="toggleColumn(c)"
            />
          </Label>

          <!-- Ẩn hết thì bảng thành một khối trống không giải thích được, nên cột
               cuối cùng còn lại bị khoá. Nói ra lý do thay vì chỉ làm mờ ô tích. -->
          <p
            v-if="all.length > 0 && shownCount <= 1"
            class="mt-1 text-xs leading-(--lh-sm) text-faint"
          >
            {{ t('infra.logs.prefs.lastColumn') }}
          </p>
        </section>
      </div>

      <DialogFooter class="shrink-0 border-t pt-2">
        <Button type="button" variant="outline" @click="emit('close')">
          {{ t('common.cancel') }}
        </Button>
        <Button type="button" variant="default" @click="confirm">
          {{ t('common.confirm') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Hộp thoại "Tuỳ chọn hiển thị" của bảng log, theo khuôn Preferences của CloudWatch.
//
// SỬA TRÊN BẢN NHÁP. Mọi thay đổi ở đây chỉ vào bản nháp cục bộ và chỉ được ghi khi
// bấm Xác nhận — Huỷ phải thực sự huỷ. Đó cũng là lý do bản nháp được dựng lại mỗi
// lần mở: mở ra lần sau không được thấy tàn dư của lần trước đã bỏ.
import { useLogPrefs, type LogPrefs, type LogRowMode } from '~/composables/useLogPrefs'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  open: boolean
  /** Mọi cột có trong kết quả, theo thứ tự bảng đang vẽ. */
  all: string[]
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const { prefs, save } = useLogPrefs()

const ROW_MODES: LogRowMode[] = ['pane', 'inline']

function snapshot(): LogPrefs {
  return { ...prefs.value, hiddenColumns: [...prefs.value.hiddenColumns] }
}

const draft = ref<LogPrefs>(snapshot())

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) draft.value = snapshot()
  },
)

useEscToClose(
  computed(() => props.open),
  () => emit('close'),
)

const shownCount = computed(
  () => props.all.filter((c) => !draft.value.hiddenColumns.includes(c)).length,
)

function toggleColumn(column: string): void {
  const hidden = draft.value.hiddenColumns
  if (hidden.includes(column)) {
    draft.value.hiddenColumns = hidden.filter((c) => c !== column)
    return
  }
  // Không cho tắt cột cuối cùng — xem ghi chú trong template.
  if (shownCount.value <= 1) return
  draft.value.hiddenColumns = [...hidden, column]
}

function confirm(): void {
  save(draft.value)
  emit('close')
}
</script>
