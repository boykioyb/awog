<template>
  <!-- Danh sách việc ĐANG chạm tới người dùng — mỗi phần tử là một `ReportItem`
       kind `impact` do `useInfraKubeReport()` xếp sẵn theo mức nặng.

       VÌ SAO KHỐI NÀY CÓ NÚT, CÒN "Nên xem" THÌ KHÔNG. Một dòng "pod X
       CrashLoopBackOff" mà không mở được log của nó là một dòng bắt người trực đi
       gõ lại tên pod vào terminal — đúng lúc họ vội nhất. Ba nút ở đây là ba thứ
       người ta làm tiếp theo trong 100% trường hợp: đọc log lần chạy TRƯỚC (log
       lần này thường trống vì container vừa restart), xem describe, hoặc vào
       thẳng terminal của pod.

       Component chỉ HIỂN THỊ: nó không biết `kube` là gì, chỉ bắn sự kiện lên cho
       `InfraKubeReport.vue` gọi controller. -->
  <div class="ikri">
    <div v-for="item in items" :key="item.key" class="ikri-i">
      <div class="ikri-row">
        <span class="ikri-chip" :class="`k-${item.kind}`">{{ item.label }}</span>
        <code v-if="item.object" class="ikri-obj" :title="item.object">{{ item.object }}</code>
        <span class="ikri-txt">{{ item.text }}</span>
      </div>

      <div v-if="item.pod" class="ikri-acts">
        <button type="button" class="btn sm" @click="emit('open-logs', item.pod)">
          {{ t('infra.kube.report.act.prevLogs') }}
        </button>
        <button type="button" class="btn sm" @click="emit('open-describe', item.pod)">
          {{ t('infra.kube.report.act.describe') }}
        </button>
        <button type="button" class="btn sm" @click="emit('open-terminal', item.pod)">
          {{ t('infra.kube.report.act.terminal') }}
        </button>
      </div>

      <!-- Lệnh chép được đi CÙNG dòng việc chứ không nằm trong một khối "lệnh gợi
           ý" riêng: nó chỉ có nghĩa với đúng đối tượng ngay phía trên. -->
      <div v-if="item.command" class="ikri-cmd">
        <code class="ikri-cmdt">{{ item.command }}</code>
        <button
          type="button"
          class="btn sm"
          :title="t('infra.kube.report.act.copyCmd')"
          @click="emit('copy-cmd', item.command)"
        >
          <Icon name="copy" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('infra.kube.report.act.copyCmd') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ReportItem } from '~/composables/useInfraKubeReport'

defineProps<{ items: ReportItem[] }>()

const emit = defineEmits<{
  (e: 'open-logs' | 'open-describe' | 'open-terminal', pod: string): void
  (e: 'copy-cmd', command: string): void
}>()

const { t } = useI18n()
</script>

<style scoped>
.ikri {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
/* Ngăn nhau bằng hairline, không bằng khung riêng: khối này đã nằm trong một
   `.icard`, thêm khung nữa là hai đường viền lồng nhau quanh cùng một nền trắng
   (xem ghi chú ở `InfraKubeReport.vue`). */
.ikri-i {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 10px 0;
}
.ikri-i:first-child {
  padding-top: 0;
}
.ikri-i:not(:first-child) {
  border-top: 1px solid var(--border);
}
.ikri-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
/* Màu chip đi theo `kind`, không phải theo component: cùng một hàng dùng cho ba
   nhóm (đang ảnh hưởng · sắp hỏng · nên xem), và tô đỏ hết thì "lệch phiên bản
   kubelet" hét ngang với "pod đang chết". */
.ikri-chip {
  flex: 0 0 auto;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: var(--bgEl);
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
}
.ikri-chip.k-impact {
  border-color: var(--dangerBorder);
  background: var(--dangerDim);
  color: var(--danger);
}
.ikri-chip.k-risk {
  border-color: var(--amberBorder);
  background: var(--amberDim);
  color: var(--amber);
}
.ikri-obj {
  color: var(--text);
  font-family: var(--code); /* mono-ok: tên object là thứ dán vào kubectl */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.ikri-txt {
  color: var(--textMuted);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ikri-acts {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.ikri-cmd {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
.ikri-cmdt {
  flex: 1 1 260px;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: var(--bgEl);
  color: var(--text);
  font-family: var(--code); /* mono-ok: đây là lệnh để dán vào terminal */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
