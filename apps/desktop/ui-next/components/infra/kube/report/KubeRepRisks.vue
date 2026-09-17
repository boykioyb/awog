<template>
  <!-- "Sắp hỏng" — các `ReportItem` kind `risk`: hạn mức sắp hết, autoscaler đã kịch
       trần, PDB chặn drain, node đã đặt chỗ gần hết.

       KHÔNG CÓ NÚT Ở ĐÂY, khác hẳn khối "Đang ảnh hưởng người dùng". Không việc nào
       trong nhóm này sửa được bằng một cú bấm (sửa quota là sửa YAML, nới HPA là
       đổi manifest), nên một hàng nút chỉ làm hai khối trông giống nhau trong khi
       chúng đòi hai mức khẩn cấp khác nhau.

       Rỗng thì vẫn nói MỘT câu: im lặng thì người đọc không phân biệt được "không
       có rủi ro nào" với "chưa đọc được bảng nào". -->
  <div class="ikrk">
    <p v-if="items.length === 0" class="ihint">{{ t('infra.kube.report.riskClear') }}</p>

    <ul v-else class="ikrk-list">
      <li v-for="item in items" :key="item.key" class="ikrk-i">
        <span class="ikrk-chip">{{ item.label }}</span>
        <code class="ikrk-obj" :title="item.object">{{ item.object }}</code>
        <span class="ikrk-txt">{{ item.text }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { ReportItem } from '~/composables/useInfraKubeReport'

defineProps<{ items: ReportItem[] }>()

const { t } = useI18n()
</script>

<style scoped>
.ikrk {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.ikrk-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.ikrk-i {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
  padding: 8px 0;
}
.ikrk-i:first-child {
  padding-top: 0;
}
.ikrk-i:not(:first-child) {
  border-top: 1px solid var(--border);
}
.ikrk-chip {
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid var(--amberBorder);
  border-radius: var(--r-pill);
  background: var(--amberDim);
  color: var(--amber);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.ikrk-obj {
  color: var(--text);
  font-family: var(--code); /* mono-ok: tên object là thứ dán vào kubectl */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.ikrk-txt {
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
</style>
