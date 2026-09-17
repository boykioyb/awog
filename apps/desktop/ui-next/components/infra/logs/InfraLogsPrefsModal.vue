<template>
  <Teleport to="body">
    <div v-if="open" class="ovl on" @click.self="emit('close')">
      <div class="lpf" role="dialog" aria-modal="true" aria-labelledby="lpf-ttl">
        <header class="lpf-hd">
          <span id="lpf-ttl" class="lpf-ttl">{{ t('infra.logs.prefs.title') }}</span>
          <button class="lpf-x" type="button" :title="t('common.close')" @click="emit('close')">
            <Icon name="x" class="lpf-x-ic" />
          </button>
        </header>

        <div class="lpf-body">
          <!-- ── Trái: cách một dòng được mở ra ───────────────────────────────── -->
          <section class="lpf-col">
            <h3 class="lpf-h3">{{ t('infra.logs.prefs.rowSection') }}</h3>

            <label v-for="m in ROW_MODES" :key="m" class="lpf-radio">
              <input v-model="draft.rowMode" type="radio" :value="m" name="lpf-rowmode" />
              <span class="lpf-radio-txt">
                <span class="lpf-radio-name">{{ t(`infra.logs.prefs.rowMode.${m}`) }}</span>
                <span class="lpf-radio-desc">{{ t(`infra.logs.prefs.rowMode.${m}Desc`) }}</span>
              </span>
            </label>

            <!-- Mở sẵn chỉ có nghĩa khi chi tiết nằm TRONG bảng; ở chế độ cửa sổ
                 riêng thì "mở sẵn" sẽ là mở sẵn cái gì? Khoá lại thay vì cho bật
                 một thứ không làm gì. -->
            <label class="lpf-check sub" :class="{ off: draft.rowMode !== 'inline' }">
              <input
                v-model="draft.expandByDefault"
                type="checkbox"
                :disabled="draft.rowMode !== 'inline'"
              />
              <span class="lpf-check-name">{{ t('infra.logs.prefs.expandByDefault') }}</span>
            </label>

            <label class="lpf-check">
              <input v-model="draft.wrapLines" type="checkbox" />
              <span class="lpf-check-txt">
                <span class="lpf-check-name">{{ t('infra.logs.prefs.wrapLines') }}</span>
                <span class="lpf-check-desc">{{ t('infra.logs.prefs.wrapLinesDesc') }}</span>
              </span>
            </label>
          </section>

          <!-- ── Phải: cột nào hiện ───────────────────────────────────────────── -->
          <section class="lpf-col lpf-cols">
            <h3 class="lpf-h3">{{ t('infra.logs.prefs.columnsSection') }}</h3>

            <p v-if="all.length === 0" class="lpf-none">
              {{ t('infra.logs.prefs.noColumns') }}
            </p>

            <!-- Cột liệt kê theo ĐÚNG thứ tự bảng đang vẽ, không theo bảng chữ cái:
                 người dùng đang nhìn cái bảng đó, và một danh sách xếp khác thứ tự
                 bắt họ dịch qua lại trong đầu. -->
            <label v-for="c in all" :key="c" class="lpf-colrow">
              <span class="lpf-colname" :title="c">{{ c }}</span>
              <input
                type="checkbox"
                :checked="!draft.hiddenColumns.includes(c)"
                :disabled="!draft.hiddenColumns.includes(c) && shownCount <= 1"
                @change="toggleColumn(c)"
              />
            </label>

            <!-- Ẩn hết thì bảng thành một khối trống không giải thích được, nên cột
                 cuối cùng còn lại bị khoá. Nói ra lý do thay vì chỉ làm mờ ô tích. -->
            <p v-if="all.length > 0 && shownCount <= 1" class="lpf-note">
              {{ t('infra.logs.prefs.lastColumn') }}
            </p>
          </section>
        </div>

        <footer class="lpf-ft">
          <button class="btn" type="button" @click="emit('close')">
            {{ t('common.cancel') }}
          </button>
          <button class="btn pri" type="button" @click="confirm">
            {{ t('common.confirm') }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Hộp thoại "Tuỳ chọn hiển thị" của bảng log, theo khuôn Preferences của CloudWatch.
//
// SỬA TRÊN BẢN NHÁP. Mọi thay đổi ở đây chỉ vào bản nháp cục bộ và chỉ được ghi khi
// bấm Xác nhận — Huỷ phải thực sự huỷ. Đó cũng là lý do bản nháp được dựng lại mỗi
// lần mở: mở ra lần sau không được thấy tàn dư của lần trước đã bỏ.
import { useLogPrefs, type LogPrefs, type LogRowMode } from '~/composables/useLogPrefs'

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

<style scoped>
.lpf {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: min(760px, calc(100vw - 32px));
  max-height: 78vh;
  margin-top: 6vh;
  padding: 14px 16px 12px;
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  background: var(--bgEl);
  box-shadow: var(--shadow-lg);
}

.lpf-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
}

.lpf-ttl {
  flex: 1 1 auto;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
}

.lpf-x {
  display: grid;
  place-items: center;
  padding: 4px;
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}

.lpf-x:hover {
  background: var(--bgHover);
  color: var(--text);
}

.lpf-x-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

/* Hai cột như hộp thoại gốc; hẹp thì xếp chồng thay vì bóp cả hai thành khe. */
.lpf-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  min-height: 0;
  overflow: auto;
}

@media (max-width: 640px) {
  .lpf-body {
    grid-template-columns: 1fr;
  }
}

.lpf-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

/* Vách ngăn giữa hai cột, đúng như bản gốc. */
.lpf-cols {
  padding-left: 16px;
  border-left: 1px solid var(--border);
}

@media (max-width: 640px) {
  .lpf-cols {
    padding-left: 0;
    border-left: 0;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }
}

.lpf-h3 {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 650;
}

.lpf-radio,
.lpf-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
}

.lpf-check.sub {
  padding-left: 22px;
}

.lpf-check.off {
  cursor: default;
  opacity: 0.5;
}

.lpf-radio-txt,
.lpf-check-txt {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.lpf-radio-name,
.lpf-check-name {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.lpf-radio-desc,
.lpf-check-desc {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.lpf-colrow {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}

.lpf-colname {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  /* mono-ok: tên cột là tên TRƯỜNG của Insights, người dùng gõ lại vào câu lệnh */
  font-family: var(--code);
}

.lpf-none,
.lpf-note {
  margin: 4px 0 0;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.lpf-ft {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex: 0 0 auto;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
</style>
