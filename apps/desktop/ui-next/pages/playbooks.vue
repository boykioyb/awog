<template>
  <!-- /playbooks — Kế hoạch triển khai (Mốc 5, việc 5.5; spec docs/features/playbooks.md).
       Trang CHỈ bind: hai pane danh sách/chi tiết + thanh công cụ. Toàn bộ state,
       RPC và vòng "chặn → duyệt → gọi lại" nằm ở usePlaybooksManager() (khuôn
       page-controller). Trang đứng ngoài mọi phiên, giống /infra. -->
  <section class="page on" data-page="playbooks">
    <div class="pb-shell">
      <div class="pb-top">
        <!-- Soạn kế hoạch mới chưa thuộc mốc này (nguồn nháp tự động ở mốc sau) —
             nút hiện ra ở đúng chỗ nó sẽ nằm nhưng TẮT, và nói vì sao (luật 3). -->
        <button class="btn sm" type="button" disabled :title="t('playbooks.toolbar.newWhy')">
          <Icon name="plus" style="width: var(--icon-sm); height: var(--icon-sm)" />
          {{ t('playbooks.toolbar.new') }}
          <Icon name="chevron-down" style="width: var(--icon-xs); height: var(--icon-xs)" />
        </button>

        <!-- Một con số, không chia theo trạng thái: playbook KHÔNG có status — status
             thuộc LƯỢT CHẠY (`PlaybookRun`), mà một playbook có thể có nhiều lượt với
             nhiều trạng thái khác nhau. Đếm theo status ở đây là gán nhãn cho nhầm
             đối tượng; trạng thái đọc ở màn chi tiết, nơi có lượt chạy thật. -->
        <span class="pb-counts">
          <span class="chip">{{ t('playbooks.count.total', { n: total }) }}</span>
        </span>

        <span class="pb-top-gap" />

        <!-- Mức chi tiết (luật 1): Đơn giản giấu cột kỹ thuật sau mục gập, Kỹ thuật
             mở sẵn. Lựa chọn được NHỚ (localStorage, xử ở manager) nên lần sau mở
             lại vẫn đúng ý người dùng. -->
        <span class="pb-top-lbl" :title="t('playbooks.toolbar.modeWhy')">
          {{ t('playbooks.toolbar.modeLabel') }}
        </span>
        <div class="seg" role="tablist">
          <span
            :class="{ on: mode === 'simple' }"
            role="tab"
            :aria-selected="mode === 'simple'"
            @click="setMode('simple')"
          >
            {{ t('playbooks.toolbar.simple') }}
          </span>
          <span
            :class="{ on: mode === 'expert' }"
            role="tab"
            :aria-selected="mode === 'expert'"
            @click="setMode('expert')"
          >
            {{ t('playbooks.toolbar.expert') }}
          </span>
        </div>

        <button
          class="btn sm"
          type="button"
          :disabled="loading"
          :title="t('playbooks.toolbar.refresh')"
          @click="load"
        >
          <Icon
            name="refresh"
            :class="{ ikspin: loading }"
            style="width: var(--icon-sm); height: var(--icon-sm)"
          />
          {{ t('playbooks.toolbar.refresh') }}
        </button>
      </div>

      <div class="pb-body">
        <aside class="pb-side">
          <PlaybookList
            :groups="groups"
            :selected-key="selectedKey"
            :loading="loading"
            :error="error"
            @open="open"
            @refresh="load"
          />
        </aside>

        <div class="pb-pane">
          <PlaybookDetail
            :playbook="current?.playbook ?? null"
            :view="detailView"
            :loading="detailLoading"
            :error="detailError"
            @retry="reloadCurrent"
            @preflight="preflight"
            @submit="submit"
            @approve="approve"
            @run="runPlan"
            @rollback="rollback"
            @share="sharePlaybook"
            @share-run="shareRun"
            @resolve-impact="resolveImpact"
            @open-graph="openGraph"
            @set-variable="setVariable"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import PlaybookDetail from '~/components/infra/playbook/PlaybookDetail.vue'
import PlaybookList from '~/components/infra/playbook/PlaybookList.vue'
import { useI18n } from '~/composables/useI18n'
import { useInfraGraphOpen } from '~/composables/useInfraGraphOpen'
import { usePlaybooksManager } from '~/composables/usePlaybooksManager'
import { useShareExport } from '~/composables/useShareExport'

const { t } = useI18n()
const { request: requestGraphOpen } = useInfraGraphOpen()
/** Bộ xuất dùng chung (6.5 · 6.7) — hộp thật được mount ở `AppGlobalHosts`. */
const { openShare } = useShareExport()

const {
  mode,
  setMode,
  groups,
  total,
  loading,
  error,
  load,
  selectedKey,
  current,
  detailLoading,
  detailError,
  open,
  reloadCurrent,
  detailView,
  setVariable,
  preflight,
  submit,
  approve,
  runPlan,
  rollback,
  resolveImpact,
} = usePlaybooksManager()

/**
 * Nút "cần dựng graph trước" dẫn sang tab Topology của `/infra`. Ảnh hưởng lan chỉ
 * suy được từ graph kiến trúc, mà graph thuộc màn Hạ tầng (việc 5.x của workstream
 * khác) — trang này KHÔNG tự dựng graph sau lưng người dùng.
 *
 * Gieo yêu cầu vào cầu nối mọc-module TRƯỚC khi điều hướng: `/infra` nằm dưới
 * `<NuxtPage keepalive />` nên lần vào thứ hai nó không remount và cú `navigateTo`
 * trần sẽ trả người dùng về tab đang mở dở, không phải tab họ vừa xin.
 */
function openGraph(): void {
  requestGraphOpen()
  void navigateTo('/infra')
}

/**
 * Chia sẻ playbook (6.7) — mở hộp xuất cho bản đang xem.
 *
 * KHÔNG dựng bản xuất ở đây. `infra.share-export` đọc lại chính file playbook
 * trên đĩa theo `{source, projectId, id}` rồi mới dựng tài liệu, nên thứ người
 * dùng nhận là ảnh chụp của playbook thật — không phải bản sao client đang giữ
 * trong bộ nhớ, vốn có thể cũ hơn đĩa nếu file bị sửa ở cửa sổ khác.
 *
 * Mặc định mẫu `runbook` (người sẽ THỰC THI). Ai cần bản để duyệt thì đổi trong
 * hộp xuất — bản đó bị sidecar BUỘC che, không phải một tuỳ chọn tắt được.
 */
function sharePlaybook(): void {
  const s = current.value?.summary
  if (!s) return
  void openShare(
    {
      kind: 'playbook',
      id: s.id,
      source: s.source,
      ...(s.projectId ? { projectId: s.projectId } : {}),
      audience: 'runbook',
    },
    { label: current.value?.playbook.name ?? s.id },
  )
}

/**
 * Mẫu thứ ba — "báo cáo sau khi chạy". Đối tượng là BẢN GHI CHẠY chứ không phải
 * playbook: nó kể việc đã xảy ra (bước nào chạy, hỏng ở đâu), thứ mà bản thân
 * playbook không biết.
 */
function shareRun(): void {
  const r = detailView.value.run
  if (!r) return
  void openShare({ kind: 'run', id: r.id }, { label: current.value?.playbook.name ?? r.id })
}
</script>

<style scoped>
.pb-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
}

/* Hàng công cụ: soạn mới · đếm · mức chi tiết · nạp lại. `flex-wrap` vì cửa sổ hẹp
   thì cụm mức-chi-tiết + nạp lại xuống dòng, đường kẻ dưới vẫn là của cả hàng. */
.pb-top {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px 8px;
  flex: 0 0 auto;
  flex-wrap: wrap;
  row-gap: 8px;
  box-shadow: inset 0 -1px 0 var(--border);
}

.pb-counts {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-width: 0;
}

/* Đẩy cụm bên phải ra mép. Ở cửa sổ hẹp nó thành 0 khi đã xuống dòng. */
.pb-top-gap {
  flex: 1 1 auto;
}

.pb-top-lbl {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.pb-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

/* Cột danh sách hẹp, cố định; pane chi tiết lấp phần còn lại và tự cuộn. */
.pb-side {
  flex: 0 0 264px;
  min-width: 0;
  border-right: 1px solid var(--border);
}

.pb-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.pb-pane > * {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
</style>
