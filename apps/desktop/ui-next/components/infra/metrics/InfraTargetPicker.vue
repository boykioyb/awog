<template>
  <!-- Một ô lọc tài nguyên của màn Giám sát / Bảng điều khiển.
       Trước 2026-09-16 đây là một ô CHỮ TRẦN và người dùng hỏi thẳng "nhập tay thì
       biết nhập gì đâu" — đúng: giá trị mà CloudWatch muốn cho ALB là phần đuôi ARN
       (`app/<tên>/<mã>`), không phải cái tên ai cũng nghĩ tới.

       CHỌN LÀ ĐƯỜNG CHÍNH, gõ tay là đường lùi. Đường lùi KHÔNG bỏ được: danh sách
       đến từ `describe-*`, mà thiếu quyền đọc hai API đó là chuyện thường, và lúc
       ấy người dùng vẫn phải dán được giá trị họ có trong tay.

       DANH SÁCH KHÔNG TỰ NẠP. Mỗi lượt nạp là thêm lời gọi AWS, nên nó nằm sau một
       cú bấm và nút nói ra lệnh nó sắp chạy. -->
  <div class="itg-wrap">
    <div class="ilbl">{{ label }}</div>

    <div class="itg-row">
      <template v-if="manual">
        <input
          :value="model"
          class="itg-inp"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :placeholder="placeholder"
          :title="why"
          @input="onType"
          @keydown.enter="emit('submit')"
        />
        <button v-if="!group.error" class="itg-link" type="button" @click="manual = false">
          {{ t('infra.monitoring.target.pick') }}
        </button>
      </template>

      <template v-else>
        <AppSelect
          :model-value="model"
          :options="options"
          :placeholder="selectPlaceholder"
          width="240px"
          @update:model-value="onPick"
        />
        <button
          class="itg-icbtn"
          type="button"
          :disabled="loading || !hasAccount"
          :title="t('infra.monitoring.target.reloadWhy')"
          :aria-busy="loading"
          @click="emit('reload')"
        >
          <Icon name="refresh" class="itg-ic" :class="loading ? 'itg-spin' : ''" />
        </button>
      </template>
    </div>

    <p v-if="group.error" class="itg-err">
      {{ t('infra.monitoring.target.listFailed', { err: group.error }) }}
    </p>
  </div>
</template>

<script setup lang="ts">
// Lớp bind thuần. Danh sách + lượt nạp do cha cấp (`useInfraMonitorTargets`), vì
// hai picker trên cùng màn dùng CHUNG một lượt gọi RPC.
import { computed, ref, watch } from 'vue'
import AppSelect from '~/components/common/AppSelect.vue'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import type { MonitorTarget } from '~/composables/useInfraMonitorTargets'

const props = defineProps<{
  label: string
  placeholder: string
  why: string
  selectPlaceholder: string
  group: { items: MonitorTarget[]; error: string }
  loading: boolean
  hasAccount: boolean
}>()

const emit = defineEmits<{
  (e: 'reload'): void
  (e: 'submit'): void
}>()

const model = defineModel<string>({ required: true })
const { t } = useI18n()

/** Giá trị đánh dấu "gõ tay". Có khoảng trắng nên không thể trùng một dimension thật. */
const MANUAL = ' manual'

const manual = ref(false)

/**
 * Danh sách hỏng ⇒ ép về gõ tay, và KHÔNG cho quay lại: một picker rỗng mà bấm
 * mãi không ra gì thì tệ hơn một ô chữ.
 */
watch(
  () => props.group.error,
  (err) => {
    if (err) manual.value = true
  },
  { immediate: true },
)

const options = computed<AppSelectOption[]>(() => {
  const list: AppSelectOption[] = [{ label: t('infra.monitoring.target.any'), value: '' }]
  for (const item of props.group.items) list.push({ label: item.label, value: item.value })
  // Giá trị đang giữ mà không có trong danh sách (dán từ chỗ khác, hoặc danh sách
  // chưa nạp) vẫn phải HIỆN — nếu không thì mở picker ra là mất giá trị đang dùng.
  if (model.value && !props.group.items.some((i) => i.value === model.value)) {
    list.push({ label: model.value, value: model.value })
  }
  if (props.group.items.length === 0) {
    list.push({ label: t('infra.monitoring.target.notLoaded'), value: MANUAL, disabled: true })
  }
  list.push({ label: t('infra.monitoring.target.manual'), value: MANUAL })
  return list
})

function onPick(next: string): void {
  if (next === MANUAL) {
    manual.value = true
    return
  }
  model.value = next
}

function onType(e: Event): void {
  model.value = (e.target as HTMLInputElement).value
}
</script>

<style scoped>
.itg-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.itg-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Tự khai, KHÔNG mượn `.im-inp` của màn Giám sát: class đó `<style scoped>` nên
   nó không với được vào element của component con — dùng lại là được một ô input
   trơ theo mặc định trình duyệt. Hình dáng chép theo `.im-inp` để hai ô cạnh nhau
   (khoảng thời gian tự chọn và ô này) trông là một họ. */
.itg-inp {
  min-width: 200px;
  padding: 7px 9px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: var(--bgInput);
  color: var(--text);
  font-family: inherit;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.itg-inp:focus {
  outline: none;
  border-color: var(--accentBorder);
}

.itg-icbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}

.itg-icbtn:hover:not(:disabled) {
  background: var(--bgHover);
  color: var(--text);
}

.itg-icbtn:disabled {
  opacity: 0.5;
  cursor: default;
}

.itg-link {
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  white-space: nowrap;
}

.itg-err {
  margin: 0;
  max-width: 46ch;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--amber);
}

.itg-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.itg-spin {
  animation: itg-rot 1s linear infinite;
}

@keyframes itg-rot {
  to {
    transform: rotate(360deg);
  }
}
</style>
