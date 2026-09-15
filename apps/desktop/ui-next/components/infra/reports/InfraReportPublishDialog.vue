<template>
  <!-- Hộp chọn LOẠI cho một bản báo cáo agent vừa viết (mốc 6.6 — điểm nối còn hở).
       Một host duy nhất: bên gọi nó là transcript, mà transcript có mặt ở cả cửa sổ
       chính lẫn cửa sổ phiên tách rời (AppGlobalHosts được mount ở cả hai).

       Hộp này KHÔNG sửa một chữ nào của bản báo cáo — nó chỉ trả lời "đây là loại
       nào", thứ mà transcript không mang theo. Sau khi chốt thì đóng hẳn và nhường
       cho hộp xuất, nơi có xem trước + lưu Wiki + gửi chat + xuất tệp. -->
  <Teleport to="body">
    <div v-if="open" class="ovl on" @click.self="closeReportPublish">
      <div class="irp" role="dialog" aria-modal="true">
        <header class="irp-hd">
          <Icon name="file" class="irp-hd-ic" />
          <span class="irp-ttl">{{ t('infra.report.publish.title') }}</span>
        </header>

        <p class="irp-sub">{{ t('infra.report.publish.subtitle') }}</p>

        <!-- Tiêu đề + độ dài: hai thứ duy nhất hộp này lấy từ lượt trả lời, nói ra
             để người dùng nhận ra mình đang cầm đúng bản nào. -->
        <div class="irp-subject">
          <span class="irp-name">{{ pending?.title }}</span>
          <span class="irp-size">
            {{ t('infra.report.publish.size', { n: pending?.body.length ?? 0 }) }}
          </span>
        </div>

        <p v-if="!sidecar.available" class="irp-state">
          {{ t('infra.report.noSidecar') }}
        </p>
        <p v-else-if="!kinds.length" class="irp-state">
          {{ t('infra.report.publish.loading') }}
        </p>

        <div v-else class="irp-opts">
          <button
            v-for="k in kinds"
            :key="k.kind"
            class="irp-opt"
            type="button"
            @click="chooseReportKind(k.kind)"
          >
            <span class="irp-opt-ttl">{{ t(k.labelKey) }}</span>
            <span class="irp-opt-hint">{{ t(k.aboutKey) }}</span>
          </button>
        </div>

        <footer class="irp-ft">
          <button class="btn" type="button" @click="closeReportPublish">
            {{ t('common.cancel') }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
// Hộp chọn loại báo cáo trước khi xuất. Danh mục loại do SIDECAR cấp
// (`infra.report-kinds`, cùng nguồn với nhịp chạy) — màn này không tự khai loại thứ
// năm, đúng luật của `InfraReports.vue`.
import { onMounted } from 'vue'
import { useInfraReportPublish } from '~/composables/useInfraReportPublish'
import { useShareExport } from '~/composables/useShareExport'
import { useSidecar } from '~/composables/useSidecar'

const { t } = useI18n()
const sidecar = useSidecar()
const { open, pending, chooseReportKind, closeReportPublish } = useInfraReportPublish()
const { kinds, loadReportKinds } = useShareExport()

onMounted(() => void loadReportKinds())

// Trạng thái mở nằm ở MỌC MODULE nên listener phải hỏi `open` chứ không thể dựa vào
// vòng đời của component này.
useEscToClose(
  () => open.value,
  () => closeReportPublish(),
)
</script>

<style scoped>
.irp {
  width: min(560px, calc(100vw - 32px));
  margin-top: 6vh;
  padding: 14px 16px 12px;
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-card);
  background: var(--bgEl);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.irp-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--textMuted);
}

.irp-hd-ic {
  width: var(--icon-md);
  height: var(--icon-md);
  flex: 0 0 auto;
  color: var(--accent);
}

.irp-ttl {
  color: var(--text);
  font-weight: 650;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}

.irp-sub {
  margin: 0;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
}

.irp-subject {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
}

.irp-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.irp-size {
  flex: 0 0 auto;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  font-variant-numeric: tabular-nums;
}

.irp-state {
  margin: 0;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.irp-opts {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.irp-opt {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 10px 11px;
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--bgPanel);
  color: var(--textMuted);
  text-align: left;
  cursor: pointer;
}

.irp-opt:hover {
  border-color: var(--accentBorder);
}

.irp-opt-ttl {
  color: var(--text);
  font-weight: 550;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.irp-opt-hint {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
}

.irp-ft {
  display: flex;
  justify-content: flex-end;
}
</style>
