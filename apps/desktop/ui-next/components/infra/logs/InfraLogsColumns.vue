<template>
  <span ref="triggerRef" class="lcol">
    <button
      class="btn sm"
      type="button"
      :disabled="all.length === 0"
      :aria-expanded="open"
      :title="t('infra.logs.columns.hint')"
      @click.stop="open = !open"
    >
      <Icon name="table" class="lcol-ic" />
      {{ t('infra.logs.columns.button', { shown: shownCount, total: all.length }) }}
    </button>

    <Teleport to="body">
      <template v-if="open">
        <div class="lcol-backdrop" @click="open = false" />
        <div ref="popRef" class="lcol-pop" :style="style" role="dialog" @click.stop>
          <div class="lcol-hd">
            <span class="lcol-ttl">{{ t('infra.logs.columns.title') }}</span>
            <button class="lcol-all" type="button" @click="showAll">
              {{ t('infra.logs.columns.showAll') }}
            </button>
          </div>

          <!-- Cột liệt kê theo ĐÚNG thứ tự bảng đang vẽ, không theo bảng chữ cái:
               người dùng đang nhìn cái bảng đó, và một danh sách xếp khác thứ tự
               bắt họ dịch qua lại trong đầu. -->
          <label v-for="c in all" :key="c" class="lcol-row">
            <input
              type="checkbox"
              :checked="!hidden.includes(c)"
              :disabled="!hidden.includes(c) && shownCount <= 1"
              @change="toggle(c)"
            />
            <span class="lcol-name">{{ c }}</span>
          </label>

          <!-- Ẩn hết thì bảng thành một khối trống không giải thích được, nên cột
               cuối cùng còn lại bị khoá. Nói ra lý do thay vì chỉ làm mờ ô tích. -->
          <p v-if="shownCount <= 1" class="lcol-note">{{ t('infra.logs.columns.lastOne') }}</p>
        </div>
      </template>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
// Chọn cột hiển thị cho bảng kết quả log.
//
// CỘT LÀ ĐỘNG. Insights trả về đúng những trường câu lệnh hỏi (`fields @timestamp,
// @message, @requestId…`) và chế độ Dòng mới nhất trả ba trường cố định, nên danh
// sách ở đây dựng từ CHÍNH kết quả đang xem chứ không phải một danh mục cứng.
//
// Lựa chọn được nhớ theo MÁY (localStorage), và nhớ theo TÊN cột. Một tên đã ẩn mà
// không có trong kết quả hiện tại thì im lặng bỏ qua — đổi câu lệnh không làm mất
// lựa chọn cũ, và cũng không dựng ra một cột không tồn tại.
import { useLogColumnPrefs } from '~/composables/useLogColumnPrefs'
import { usePopoverAnchor } from '~/composables/usePopoverAnchor'

const props = defineProps<{
  /** Mọi cột có trong kết quả, theo thứ tự bảng đang vẽ. */
  all: string[]
}>()

const { t } = useI18n()

const { hidden, toggle: toggleStored, showAll } = useLogColumnPrefs()

const open = ref(false)
const triggerRef = useTemplateRef<HTMLElement>('triggerRef')
const popRef = useTemplateRef<HTMLElement>('popRef')
const { style } = usePopoverAnchor(triggerRef, popRef, open, {
  align: 'right',
  width: 260,
  maxHeight: 360,
})

const shownCount = computed(() => props.all.filter((c) => !hidden.value.includes(c)).length)

function toggle(column: string): void {
  // Không cho tắt cột cuối cùng — xem ghi chú trong template.
  if (!hidden.value.includes(column) && shownCount.value <= 1) return
  toggleStored(column)
}
</script>

<style scoped>
.lcol {
  display: inline-flex;
}

.lcol-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
}

.lcol-backdrop {
  position: fixed;
  inset: 0;
  z-index: 128;
}

/* Teleported; `left` + `top`|`bottom` + `width` + `max-height` do
   `usePopoverAnchor` đặt inline. */
.lcol-pop {
  position: fixed;
  z-index: 129;
  overflow-y: auto;
  padding: 8px;
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  background: var(--bgEl);
  box-shadow: var(--shadow-md);
}

.lcol-hd {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 2px 4px 6px;
}

.lcol-ttl {
  flex: 1 1 auto;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
}

.lcol-all {
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--accent);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}

.lcol-all:hover {
  text-decoration: underline;
}

.lcol-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 4px;
  border-radius: var(--r-xs);
  cursor: pointer;
}

.lcol-row:hover {
  background: var(--bgHover);
}

.lcol-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  /* mono-ok: tên cột là tên TRƯỜNG của Insights, người dùng gõ lại vào câu lệnh */
  font-family: var(--code);
}

.lcol-note {
  margin: 4px 4px 0;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}
</style>
