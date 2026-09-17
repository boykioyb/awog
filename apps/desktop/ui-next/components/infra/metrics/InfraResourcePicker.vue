<template>
  <!-- Ô chọn TÀI NGUYÊN của màn Giám sát — thứ quyết định màn vẽ bộ biểu đồ nào.

       VÌ SAO MỘT Ô, KHÔNG PHẢI HAI. Bản trước có hai ô ("ALB nào" + "EC2 nào"), cả
       hai mặc định rỗng, và truy vấn không kèm dimension thì CloudWatch trả rỗng —
       nên trạng thái mặc định của màn được BẢO ĐẢM là bốn khung trắng, trên một hạ
       tầng ECS thì trắng vĩnh viễn (ảnh người dùng 2026-09-17). Nay chọn tài nguyên
       là bước ĐẦU TIÊN, và loại của nó quyết định bộ biểu đồ.

       DANH SÁCH KHÔNG TỰ NẠP. Mỗi lượt dò là một loạt lời gọi AWS, nên nó nằm sau
       một cú bấm và nút nói ra lệnh nó sắp chạy. -->
  <div class="irp">
    <div class="ilbl">{{ t('infra.monitoring.target.heading') }}</div>

    <div class="irp-row">
      <AppSelect
        :model-value="modelValue?.id ?? ''"
        :options="options"
        :placeholder="placeholder"
        :disabled="!hasAccount"
        width="280px"
        @update:model-value="onPick"
      />

      <!-- Nút dò danh sách. Lỗi của `describe-*` phần lớn là tạm thời (token hết
           hạn), nên đường thử lại phải luôn có mặt — bản trước giấu nó trong một
           chế độ và biến `ExpiredToken` thành đường cụt. -->
      <button
        class="irp-icbtn"
        type="button"
        :disabled="loading || !hasAccount"
        :title="t('infra.monitoring.target.reloadWhy')"
        :aria-busy="loading"
        @click="emit('reload')"
      >
        <Icon name="refresh" class="irp-ic" :class="loading ? 'irp-spin' : ''" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Lớp bind thuần. Danh sách + lượt nạp do cha cấp (`useInfraMonitorTargets`).
//
// NHÓM DỰNG BẰNG OPTION BỊ KHOÁ. `AppSelect` nhận một danh sách phẳng; thêm khái
// niệm "nhóm" vào nó là sửa một component dùng ở hàng chục chỗ cho một màn. Một
// hàng `disabled` làm tiêu đề nhóm đọc ra đúng như vậy và không chọn được.
import { computed } from 'vue'
import AppSelect from '~/components/common/AppSelect.vue'
import type { AppSelectOption } from '~/components/common/AppSelect.vue'
import type { MonitorTarget } from '~/composables/useInfraMetrics'
import type { MonitorTargetGroup } from '~/composables/useInfraMonitorTargets'

const props = defineProps<{
  modelValue: MonitorTarget | null
  groups: MonitorTargetGroup[]
  loading: boolean
  loaded: boolean
  hasAccount: boolean
  /**
   * BẤT KỲ lỗi nào của lượt dò — cả lượt hỏng, hay từng nhóm hỏng. Có lỗi ⇒ danh
   * sách rỗng KHÔNG nói lên điều gì về tài khoản.
   *
   * ⚠ Nhận CÂU ĐÃ GỘP của cha, không phải riêng lỗi cả-lượt. Bản trước chỉ nhận
   * `fatal`, nên khi cả năm nhóm metric hỏng (lỗi nằm ở TỪNG nhóm, `fatal` rỗng)
   * ô này vẫn thản nhiên báo "tài khoản chưa có tài nguyên nào" ngay bên trên câu
   * lỗi giải thích điều ngược lại — ảnh người dùng 2026-09-17, lần thứ hai cùng
   * một kiểu nói dối trong một ngày.
   */
  problem: string
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: MonitorTarget | null): void
  (e: 'reload'): void
}>()

const { t } = useI18n()

/**
 * Câu trong ô khi chưa chọn gì. BỐN trạng thái khác nhau, và người dùng cần phân
 * biệt được cả bốn: chưa có tài khoản · chưa dò · dò hỏng · dò xong mà tài khoản
 * trống. Một câu "Chọn…" dùng chung là để người dùng bấm mãi vào danh sách rỗng.
 *
 * ⚠ NHÁNH `problem` PHẢI ĐỨNG TRƯỚC NHÁNH "TÀI KHOẢN TRỐNG" nhưng SAU nhánh "có
 * mục". Lượt dò hỏng cũng cho danh sách rỗng, và gộp hai thứ lại là để ô này khẳng
 * định "tài khoản của bạn không có gì" trong khi sự thật chỉ là ta chưa hỏi được —
 * người dùng sẽ đi tìm lỗi ở AWS (lỗi thật 2026-09-17). Nhưng hỏng MỘT PHẦN thì
 * vẫn còn mục để chọn, và lúc đó câu "không dò được" cũng sai nốt.
 */
const placeholder = computed(() => {
  if (!props.hasAccount) return t('infra.monitoring.target.noAccount')
  if (!props.loaded) return t('infra.monitoring.target.notLoaded')
  // CÓ GÌ ĐỂ CHỌN THÌ MỜI CHỌN — kể cả khi một phần lượt dò hỏng. Lỗi từng phần là
  // chuyện THƯỜNG ở tài khoản bị siết quyền: nhóm log nạp được hai chục mục trong
  // khi năm nhóm metric bị từ chối. Để nhánh lỗi thắng ở đây thì ô ghi "Không dò
  // được danh sách" ngay trên một danh sách đầy mục (ảnh người dùng 2026-09-17).
  // Câu lỗi vẫn hiện, nhưng nó đứng DƯỚI ô, đúng chỗ của nó.
  if (props.groups.length > 0) return t('infra.monitoring.target.choose')
  if (props.problem) return t('infra.monitoring.target.failed')
  return t('infra.monitoring.target.none')
})

/** Tiền tố của hàng tiêu đề — cũng là cách nhận ra nó lúc chọn (xem `onPick`). */
const HEAD = ' head:'

const options = computed<AppSelectOption[]>(() =>
  props.groups.flatMap((g) => [
    { label: t(`infra.monitoring.kind.${g.kind}`), value: `${HEAD}${g.kind}`, disabled: true },
    ...g.items.map((item) => ({
      // Chuỗi phụ (cluster của service, engine của DB) đi cùng NHÃN chứ không ẩn
      // vào tooltip: hai service trùng tên ở hai cluster là chuyện thường, và khi
      // đó cái tên một mình không chọn được.
      label: item.hint ? `${item.label} · ${item.hint}` : item.label,
      value: item.id,
    })),
  ]),
)

function onPick(id: string): void {
  if (id.startsWith(HEAD)) return
  for (const g of props.groups) {
    const hit = g.items.find((i) => i.id === id)
    if (hit) {
      emit('update:modelValue', hit)
      return
    }
  }
  emit('update:modelValue', null)
}
</script>

<style scoped>
.irp {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.irp-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.irp-icbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}

.irp-icbtn:hover:not(:disabled) {
  background: var(--bgHover);
  color: var(--text);
}

.irp-icbtn:disabled {
  opacity: 0.45;
  cursor: default;
}

.irp-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.irp-spin {
  animation: irp-rot 1s linear infinite;
}

@keyframes irp-rot {
  to {
    transform: rotate(360deg);
  }
}
</style>
