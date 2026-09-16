<template>
  <!-- Kế hoạch triển khai — TAB của `/infra`, nhóm "Thay đổi" (chuyển vào 2026-09-15).
       Trước đó là một trang riêng `/playbooks` trên nav rail. Nó thuộc về đây: playbook
       là thứ TẠO RA thay đổi trên tài khoản, đứng cạnh Triển khai · Nhật ký · Báo cáo —
       và nó đọc cùng một ngữ cảnh AWS với mọi tab khác, thứ mà một trang riêng phải tự
       đi lấy.

       MỘT ROOT DUY NHẤT (`.pb-shell`). Khung `.infra-pane` của `/infra` tạo kiểu cho
       `> *`, nên một component nhiều root sẽ không nhận được kích thước. Hộp menu và hộp
       soạn vì thế nằm TRONG shell thay vì là anh em của nó; cả hai đều `position: fixed`
       / Teleport nên chỗ đứng trong cây DOM không đổi chỗ chúng hiện ra. -->
  <div class="pb-shell">
    <div class="itoolbar pb-top">
      <!-- Soạn kế hoạch mới. Menu chứ không phải một hành động: "trống" và "nhân
           bản bản đang mở" là hai điểm xuất phát rất khác nhau, và nhân bản là đường
           DUY NHẤT để có bản của riêng mình từ một bản dựng sẵn (bản dựng sẵn nằm
           trong mã, `-save` từ chối ghi vào đó).

           `@click.stop` bắt buộc: `ContextMenu` đóng bằng listener click trên
           `document`, nên mở bằng click trái mà không chặn nổi bọt thì nó đóng ngay
           trong cùng một nhịp. -->
      <button
        ref="newBtn"
        class="btn sm"
        type="button"
        :title="t('playbooks.toolbar.newWhy')"
        @click.stop="openNewMenu"
      >
        <Icon name="plus" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('playbooks.toolbar.new') }}
        <Icon name="chev" style="width: var(--icon-xs); height: var(--icon-xs)" />
      </button>

      <!-- Một con số, không chia theo trạng thái: playbook KHÔNG có status — status
           thuộc LƯỢT CHẠY (`PlaybookRun`), mà một playbook có thể có nhiều lượt với
           nhiều trạng thái khác nhau. Đếm theo status ở đây là gán nhãn cho nhầm
           đối tượng; trạng thái đọc ở màn chi tiết, nơi có lượt chạy thật. -->
      <span class="pb-counts">
        <span class="chip">{{ t('playbooks.count.total', { n: total }) }}</span>
      </span>

      <div class="itoolgrp iend">
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
          @edit="onEdit"
          @duplicate="onDuplicate"
          @delete="remove"
        />
      </div>
    </div>

    <ContextMenu
      :open="newMenuPos !== null"
      :position="newMenuPos ?? { x: 0, y: 0 }"
      :items="newMenuItems"
      @close="newMenuPos = null"
      @select="onNewMenuSelect"
    />

    <!-- Hộp soạn host Ở ĐÂY, không ở `AppGlobalHosts`: cả hai cú bấm mở nó (thanh công
       cụ và đầu màn chi tiết) nằm trong chính trang này. -->
    <PlaybookEditor @saved="afterEditorSaved" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import PlaybookDetail from '~/components/infra/playbook/PlaybookDetail.vue'
import PlaybookEditor from '~/components/infra/playbook/PlaybookEditor.vue'
import PlaybookList from '~/components/infra/playbook/PlaybookList.vue'
import { useI18n } from '~/composables/useI18n'
import { useInfraTabOpen } from '~/composables/useInfraTabOpen'
import { usePlaybookEditor } from '~/composables/usePlaybookEditor'
import { usePlaybooksManager } from '~/composables/usePlaybooksManager'
import { useShareExport } from '~/composables/useShareExport'
import type { MenuItem, MenuPos } from '~/composables/useContextMenu'

const { t } = useI18n()
const { request: requestTab } = useInfraTabOpen()
/** Bộ xuất dùng chung (6.5 · 6.7) — hộp thật được mount ở `AppGlobalHosts`. */
const { openShare } = useShareExport()

const {
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
  remove,
  afterEditorSaved,
} = usePlaybooksManager()

const { openBlank, openDuplicate, openEdit } = usePlaybookEditor()

// ── Soạn kế hoạch ───────────────────────────────────────────────────────────

/**
 * Menu của nút "Kế hoạch mới". Neo dưới NÚT chứ không dưới con trỏ: đây là menu của
 * một nút trên thanh công cụ, và người dùng mong nó rơi ngay dưới nút đó dù họ bấm
 * trúng mép nào.
 */
const newMenuPos = ref<MenuPos | null>(null)
const newBtn = useTemplateRef<HTMLElement>('newBtn')

const newMenuItems = computed<MenuItem[]>(() => [
  { id: 'blank', label: t('playbooks.toolbar.newBlank'), icon: 'plus' },
  {
    id: 'duplicate',
    label: t('playbooks.toolbar.newDuplicate'),
    icon: 'copy',
    // Không có bản nào đang mở thì không có gì để nhân bản — hàng vẫn hiện ra để
    // người dùng biết nó tồn tại, nhưng tắt.
    disabled: !current.value,
  },
])

function openNewMenu(): void {
  const el = newBtn.value
  if (!el) return
  const r = el.getBoundingClientRect()
  newMenuPos.value = { x: r.left, y: r.bottom + 4 }
}

function onNewMenuSelect(id: string): void {
  newMenuPos.value = null
  if (id === 'blank') {
    openBlank()
    return
  }
  const cur = current.value
  if (cur) openDuplicate(cur.playbook)
}

/** Sửa bản đang mở. Bản dựng sẵn không tới được đây — nút không hiện ở màn chi tiết. */
function onEdit(): void {
  const cur = current.value
  if (cur) openEdit(cur.playbook, cur.summary)
}

function onDuplicate(): void {
  const cur = current.value
  if (cur) openDuplicate(cur.playbook)
}

/**
 * Nút "cần dựng graph trước" chuyển sang tab Topology.
 *
 * Từ 2026-09-15 màn này NẰM TRONG `/infra` nên đây chỉ còn là một cú đổi tab —
 * không `navigateTo` nữa. Vẫn đi qua cầu nối mọc-module thay vì gọi thẳng
 * `selectTab` của trang: component con không cầm hàm của trang cha, và cầu nối đã
 * là đường mà Chi phí cũng dùng để xin tab này.
 *
 * Ảnh hưởng lan chỉ suy được từ graph kiến trúc, và màn này KHÔNG tự dựng graph sau
 * lưng người dùng — dựng graph là nhiều lệnh `aws`.
 */
function openGraph(): void {
  requestTab('graph')
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

/* Hàng công cụ: soạn mới · đếm · mức chi tiết · nạp lại. Bố cục + da ở `.itoolbar`
   (app-shell.css); `margin` giữ khoảng cách ngoài mà `padding` cũ cho. */
.pb-top {
  margin: 10px 16px 8px;
}

.pb-counts {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-width: 0;
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
