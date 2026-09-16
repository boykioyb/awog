<template>
  <div class="ixe">
    <!-- ── Cột trái: TOÀN BỘ danh mục, theo nhóm việc (2026-09-14) ───────────
         Trước đây cột này chỉ liệt kê dịch vụ ĐÃ GHIM (task 3.8). Yêu cầu mới:
         "đang chỉ hiển thị danh sách pin, tôi muốn hiển thị full danh sách, hiện
         thị theo group collapse" — nghĩa là câu hỏi "tài khoản này có gì" phải
         trả lời được ngay ở đây, không phải vòng qua mặt danh mục. Nhóm GHIM vẫn
         đứng đầu vì nó là lối tắt người dùng tự dựng.

         Cột này thu gọn được và kéo rộng được (2026-09-14: "bổ sung collapse
         sidebar, và resize"). Bảng EC2 có tới 5 cột nên cột trái 220px là chỗ đắt;
         nhưng tên view cần chỗ đọc nên không thể chốt cứng một con số.

         THU GỌN = KHÔNG VẼ CỘT, không phải "còn thanh ray 44px". Bản trước giữ
         một dải rỗng suốt chiều cao pane để đặt nút mở lại, và người dùng gọi
         đúng tên nó: "1 gap lớn" (ảnh chụp 2026-09-14). Nút mở lại nay nằm ở đầu
         cột phải (`.ixe-expand`), nơi nó không chiếm chỗ của bảng. -->
    <aside v-if="!sidebarCollapsed" class="ixe-side" :style="{ width: `${sideW}px` }">
      <div class="ixe-side-hd">
        <span class="ixe-side-ttl">{{ t('infra.explorer.side.title') }}</span>
        <button
          class="iconbtn ixe-side-toggle"
          type="button"
          :title="t('infra.explorer.pinned.collapse')"
          :aria-label="t('infra.explorer.pinned.collapse')"
          aria-expanded="true"
          @click="setSidebarCollapsed(true)"
        >
          <Icon name="panel" />
        </button>
      </div>
      <!-- Phần cuộn được tách khỏi hàng tiêu đề: danh mục đầy đủ dài hơn một
           màn, mà tiêu đề + nút "Tất cả dịch vụ" thì phải luôn ở trên. -->
      <div class="ixe-side-body">
        <!-- Danh mục là một PANE của CHÍNH tab này, không phải tab riêng (2026-09-14:
             "khám phá là page con trong dịch vụ thôi chứ?"). Hai tab ngang hàng —
             một cái là danh mục, một cái là bảng — là hai tab nói về cùng một việc,
             mà tab danh mục thì không có dữ liệu nào của riêng nó.

             Nút này xuống HÀNG RIÊNG thay vì nằm cạnh tiêu đề: cột chỉ rộng
             180–220px, xếp thêm nút thu gọn vào cùng hàng là ba thứ tranh chỗ và
             tiêu đề sẽ là thứ bị cắt chữ. -->
        <button class="btn sm ixe-catalog" type="button" @click="emit('open-catalog')">
          <Icon name="layers" />
          {{ t('infra.explorer.services.open') }}
        </button>

        <section class="ixe-grp">
          <button
            class="ixe-grp-hd"
            type="button"
            :aria-expanded="!isFolded(PINNED_GROUP)"
            @click="toggleGroup(PINNED_GROUP)"
          >
            <Icon name="chev" class="ixe-grp-chev" :class="{ open: !isFolded(PINNED_GROUP) }" />
            <span class="ixe-grp-ttl">{{ t('infra.explorer.pinned.title') }}</span>
          </button>
          <template v-if="!isFolded(PINNED_GROUP)">
            <button
              v-for="s in pinnedEntries"
              :key="`pin:${s.id}`"
              class="ixe-nav"
              :class="{ on: entryActive(s) }"
              :title="isConsoleEntry(s) ? t('infra.explorer.support.hint.console') : t(s.about)"
              type="button"
              @click="onEntry(s)"
            >
              <span class="ixe-nav-txt">{{ entryLabel(s) }}</span>
              <Icon v-if="isConsoleEntry(s)" name="external" class="ixe-nav-ic" />
              <Icon v-else name="pin" class="ixe-nav-pin" />
            </button>
            <p v-if="!pinnedEntries.length" class="ixe-side-empty">
              {{ t('infra.explorer.pinned.empty') }}
            </p>
          </template>
        </section>

        <!-- Cả danh mục, đúng thứ tự nhóm của sidecar ("Máy chủ & tính toán" …
             "Hạ tầng dạng mã"), không xếp lại theo bảng chữ cái. -->
        <section v-for="g in serviceGroups" :key="g.id" class="ixe-grp">
          <button
            class="ixe-grp-hd"
            type="button"
            :aria-expanded="!isFolded(g.id)"
            @click="toggleGroup(g.id)"
          >
            <Icon name="chev" class="ixe-grp-chev" :class="{ open: !isFolded(g.id) }" />
            <span class="ixe-grp-ttl">{{ t(`infra.explorer.group.${g.id}`) }}</span>
          </button>
          <template v-if="!isFolded(g.id)">
            <button
              v-for="s in g.services"
              :key="s.id"
              class="ixe-nav"
              :class="{ on: entryActive(s) }"
              :title="isConsoleEntry(s) ? t('infra.explorer.support.hint.console') : t(s.about)"
              type="button"
              @click="onEntry(s)"
            >
              <span class="ixe-nav-txt">{{ entryLabel(s) }}</span>
              <Icon v-if="isConsoleEntry(s)" name="external" class="ixe-nav-ic" />
              <Icon v-else-if="pinnedServices.includes(s.id)" name="pin" class="ixe-nav-pin" />
            </button>
          </template>
        </section>
      </div>
    </aside>

    <!-- Tay kéo giữa cột trái và bảng. Dùng lại `.grsz` của app (cùng tay kéo của
         Git/Wiki) chứ không vẽ tay cái thứ hai. Ẩn khi thu gọn: kéo một cột đang
         không hiện thì không có gì để kéo.

         `role="separator"` + `tabindex` + mũi tên: tay kéo của app vốn chỉ dùng
         được bằng chuột; ở đây thêm đường bàn phím vì bề rộng này quyết định bảng
         có đọc được hay không, mà không có cách chỉnh nào khác. -->
    <div
      v-if="!sidebarCollapsed"
      class="grsz ixe-rsz"
      :class="{ drag: rszDragging }"
      role="separator"
      aria-orientation="vertical"
      :aria-label="t('infra.explorer.pinned.resize')"
      :aria-valuemin="SIDEBAR_MIN"
      :aria-valuemax="SIDEBAR_MAX"
      :aria-valuenow="sideW"
      tabindex="0"
      @pointerdown="onRszDown"
      @keydown="onRszKey"
    />

    <!-- ── Cột phải: một view ─────────────────────────────────────────────── -->
    <main class="ixe-main">
      <!-- Đường mở lại cột dịch vụ sau khi thu gọn. Nằm ở ĐÂY, không nằm trong
           một thanh ray rỗng bên trái: nút này không chiếm chỗ của bảng, và nó
           vẫn hiện khi chưa chọn view nào (nhánh dưới). -->
      <button
        v-if="sidebarCollapsed"
        class="btn sm ixe-expand"
        type="button"
        :title="t('infra.explorer.pinned.expand')"
        :aria-label="t('infra.explorer.pinned.expand')"
        @click="setSidebarCollapsed(false)"
      >
        <Icon name="panel" />
        {{ t('infra.explorer.side.title') }}
      </button>
      <template v-if="activeView">
        <header class="ixe-hd">
          <div class="ixe-hd-txt">
            <h2 class="ixe-ttl">{{ t(activeView.label) }}</h2>
            <p class="ixe-about">{{ t(activeView.about) }}</p>
          </div>
          <div class="itoolgrp ixe-hd-acts">
            <!-- Form nhỏ của view (task 3.6): tạo bucket/thư mục, tải lên, presign.
                 Nút cũng bị ẩn khi dò quyền từ chối (task 3.3) — lý do giống nút
                 ghi trên dòng. -->
            <button
              v-for="f in activeView.forms"
              :key="f.id"
              class="btn sm"
              type="button"
              :disabled="actionDenied(f.id)"
              :title="actionDenied(f.id) ? t('infra.explorer.denied') : t(f.consequence)"
              @click="startForm(f)"
            >
              <Icon name="plus" />
              {{ t(f.label) }}
            </button>
            <button
              class="btn sm"
              type="button"
              :disabled="!activeView.hasConsole"
              @click="openConsole(selected)"
            >
              <Icon name="external" />
              {{ t('infra.explorer.console') }}
            </button>
            <!-- Dock phiên thu nhỏ (task 3.5): dùng lại dock của app, mang theo
                 ngữ cảnh của đối tượng đang chọn. -->
            <button class="btn sm" type="button" :disabled="docking" @click="minimizeSession">
              <Icon name="minimize" />
              {{ t('infra.explorer.dock') }}
            </button>
            <button class="btn sm" type="button" @click="askScreen">
              <Icon name="sparkles" />
              {{ t('infra.explorer.ask') }}
            </button>
          </div>
        </header>

        <!-- View cần tham số (vd s3.objects cần bucket) thì hỏi TRƯỚC khi gọi —
             không đoán một cái tên bucket rồi để AWS trả lỗi. -->
        <form
          v-if="activeView.required.length"
          class="itoolbar ifields ixe-params"
          @submit.prevent="reload()"
        >
          <label v-for="f in activeView.required" :key="f.key" class="ixe-param">
            <span class="ixe-param-lbl">{{ t(f.label) }}</span>
            <input
              :value="viewValues[f.key] ?? ''"
              class="ixe-param-input"
              :placeholder="f.placeholder ?? ''"
              autocomplete="off"
              spellcheck="false"
              @input="viewValues[f.key] = ($event.target as HTMLInputElement).value"
            />
          </label>
          <button class="btn pri sm" type="submit" :disabled="loading">
            {{ t('infra.explorer.load') }}
          </button>
          <button v-if="inPrefixTree" class="btn sm" type="button" @click="goUpPrefix">
            <Icon name="chev-left" />
            {{ t('infra.explorer.up') }}
          </button>
        </form>

        <!-- Cảnh báo của VIEW (Mốc 4, task 4.1): khác tooltip `about` ở chỗ nó
             phải đọc được TRƯỚC khi tin vào bảng — ACM bắt buộc `us-east-1` cho
             CloudFront, nên "bảng trống" ở region khác là câu trả lời sai. -->
        <div v-if="activeView.notice" class="ixe-warn notice">
          <Icon name="info" />
          {{ t(activeView.notice) }}
        </div>

        <div v-if="probeVerdict === 'denied'" class="ixe-warn">
          <Icon name="shield" />
          {{ t('infra.explorer.deniedNote') }}
        </div>
        <div v-if="lastDownload" class="ixe-warn ok">
          <Icon name="download" />
          {{ t('infra.explorer.downloaded') }}
          <button class="btn sm" type="button" @click="previewDownload">
            {{ t('infra.explorer.preview') }}
          </button>
        </div>

        <InfraResourceTable
          :columns="columns"
          :rows="visibleRows"
          :actions="activeView.actions"
          :loading="loading"
          :error="error"
          :loaded-at="loadedAt"
          :virtual="virtual"
          :has-detail="activeView.hasDetail"
          :has-console="activeView.hasConsole"
          :next-token="nextToken"
          :selected-id="selectedId"
          :action-denied="actionDenied"
          :search="search"
          @update:search="search = $event"
          @row="enterRow"
          @ask="askAbout"
          @console="openConsole"
          @reload="reload"
          @load-more="loadMore"
          @action="onRowAction"
        />

        <InfraResourceDetail
          :row="selected"
          :json="detailJson"
          :loading="detailLoading"
          :error="detailError"
          :has-detail="activeView.hasDetail"
          @ask="askAbout"
          @close="selected = null"
        />
      </template>

      <p v-else class="ixe-empty">{{ t('infra.explorer.pick') }}</p>
    </main>

    <InfraViewForm
      v-if="openForm"
      :form="openForm"
      :busy="actionBusy"
      @close="closeForm"
      @submit="onFormSubmit"
    />
  </div>
</template>

<script setup lang="ts">
// Màn Explorer (task 3.1–3.8). Component này chỉ BIND: toàn bộ state + RPC nằm ở
// `useInfraExplorer` (trang nào cũng vậy, khuôn `useInfraKube`).
import { computed, onMounted, ref, watch } from 'vue'
import { useInfraAskAgent } from '~/composables/useInfraAskAgent'
import { useInfraBubble } from '~/composables/useInfraBubble'
import { SIDEBAR_MAX, SIDEBAR_MIN, useInfraExplorer } from '~/composables/useInfraExplorer'
import { useMinimizeDock } from '~/composables/useMinimizeDock'
import { useResizable } from '~/composables/useResizable'
import { useToast } from '~/composables/useToast'
import type {
  InfraActionDescriptor,
  InfraCatalogService,
  InfraResourceRow,
} from '~/composables/useInfraResourcesApi'

const { t } = useI18n()
const {
  bootstrap,
  pinnedEntries,
  pinnedServices,
  serviceGroups,
  entryLabel,
  entryActive,
  isConsoleEntry,
  openServiceEntry,
  toggleGroup,
  isFolded,
  activeView,
  openView,
  columns,
  sidebarCollapsed,
  sidebarWidth,
  setSidebarCollapsed,
  setSidebarWidth,
  visibleRows,
  virtual,
  nextToken,
  loading,
  error,
  loadedAt,
  search,
  viewValues,
  reload,
  loadMore,
  selected,
  detailJson,
  detailLoading,
  detailError,
  enterRow,
  goUpPrefix,
  inPrefixTree,
  openForm,
  closeForm,
  startForm,
  runAction,
  actionBusy,
  formRow,
  lastDownload,
  previewDownload,
  actionDenied,
  probeVerdict,
  askAbout,
  openConsole,
} = useInfraExplorer()

// ── Cột trái: thu gọn + kéo rộng ─────────────────────────────────────────────
// Bề rộng HIỂN THỊ: thu gọn thì chỉ còn thanh ray 44px, nhưng số đã kéo vẫn nằm
// nguyên trong `sidebarWidth` để lần mở ra sau quay đúng chỗ cũ — ghi đè số cũ
// bằng 44px là mất công chỉnh của người dùng.
// Cột không còn "thu gọn còn thanh ray": thu gọn là KHÔNG vẽ cột (`v-if` ở
// template), nên bề rộng hiển thị luôn là số người dùng đã kéo.
const sideW = computed(() => sidebarWidth.value)

/** Khoá nhóm "đã ghim" ở cột trái — không phải id nhóm nào của danh mục. */
const PINNED_GROUP = 'pinned'

/**
 * Bấm một mục ở cột trái. Đích `tab` (Logs · Tổng quan · Kubernetes) do TRANG
 * đổi tab — composable không phát được `emit` của SFC, nên nhánh đó ở lại đây.
 */
function onEntry(service: InfraCatalogService): void {
  if (service.target.kind === 'tab') {
    emit('open-tab', service.target.tab)
    return
  }
  void openServiceEntry(service)
}

// Tay kéo dùng lại `useResizable` của app (cùng khuôn Git/Wiki) rồi đẩy số về
// composable để nó ghi localStorage — bề rộng chỉ có MỘT nguồn, không giữ bản sao.
// Hai chiều vì `useResizable` giữ ref riêng: kéo thì đẩy xuống, còn đổi bằng bàn
// phím thì phải kéo ref của nó theo, nếu không lần kéo sau sẽ nhảy về số cũ.
const {
  width: dragW,
  dragging: rszDragging,
  onPointerDown: onRszDown,
} = useResizable(sidebarWidth.value, { min: SIDEBAR_MIN, max: SIDEBAR_MAX })
watch(dragW, (w) => setSidebarWidth(w))
watch(sidebarWidth, (w) => {
  if (w !== dragW.value) dragW.value = w
})

/** Mũi tên đổi 10px, Shift+mũi tên 40px — cùng bước với các tay kéo khác của app. */
function onRszKey(e: KeyboardEvent): void {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  e.preventDefault()
  setSidebarWidth(sideW.value + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 40 : 10))
}

/**
 * Báo lên trang danh sách dòng ĐANG CÓ, để tab Dịch vụ tìm được cả dữ liệu chứ
 * không chỉ tên dịch vụ. Đẩy lên thay vì để trang với vào state của Explorer: một
 * chiều dữ liệu, không có vòng phụ thuộc giữa hai tab.
 */
watch(
  [visibleRows, activeView, viewValues],
  () => {
    const view = activeView.value
    if (!view) {
      emit('rows', [])
      return
    }
    const values = view.required.length ? { ...viewValues.value } : undefined
    emit(
      'rows',
      visibleRows.value.slice(0, 50).map((r) => ({
        viewId: view.id,
        label: view.label,
        name: r['name'] || r['id'] || '',
        ...(values ? { values } : {}),
      })),
    )
  },
  { deep: true },
)

const ask = useInfraAskAgent()
const bubble = useInfraBubble()
const dock = useMinimizeDock()
const toast = useToast()

const docking = ref(false)

onMounted(() => void bootstrap())

const selectedId = computed(() => {
  const row = selected.value
  return row ? (row['id'] ?? row['name'] ?? '') : ''
})

function askScreen(): void {
  const view = activeView.value
  if (!view) return
  void ask.askAgent(`[hạ tầng] ${t(view.label)} — ${t('infra.explorer.ask.screen')}`, t(view.label))
}

function onRowAction(payload: { action: InfraActionDescriptor; row: InfraResourceRow }): void {
  const { action, row } = payload

  // Hành động ĐIỀU HƯỚNG (Mốc 4): mở view con với tham số suy từ chính dòng.
  // Không có RPC nào ở đây — không có lệnh nào để chạy, và view con tự đi qua
  // cổng quyền khi nó gọi CLI.
  if (action.opensView) {
    const values: Record<string, string> = {}
    for (const [key, rowKey] of Object.entries(action.opensView.values)) {
      const v = row[rowKey]
      if (v !== undefined && v !== '') values[key] = v
    }
    openView(action.opensView.viewId, values)
    return
  }

  // Hành động cần thêm dữ liệu người dùng (Mốc 4): mở form với NGỮ CẢNH CỦA
  // DÒNG đã có, thay vì bắt người dùng chép lại id họ vừa bấm.
  if (action.fields.length > 0) {
    startForm(
      {
        id: action.id,
        label: action.label,
        consequence: action.consequence,
        danger: action.danger,
        confirm: action.confirm,
        iam: action.iam,
        typeNameField: null,
        fields: action.fields,
        // Có `fields` thì KHÔNG phải hành động điều hướng — nhánh `opensView`
        // phía trên đã bắt hết những cái như vậy rồi.
        opensView: null,
      },
      row,
    )
    return
  }

  const typeName = action.confirm === 'type-name' ? (row['name'] ?? '') : undefined
  void runAction({
    actionId: `row:${action.id}`,
    row,
    label: t(action.label),
    consequence: t(action.consequence),
    danger: action.danger,
    confirm: action.confirm,
    ...(typeName !== undefined ? { typeToConfirm: typeName } : {}),
    after: () => void reload(),
  })
}

function onFormSubmit(values: Record<string, string>): void {
  const form = openForm.value
  if (!form) return
  // Form mở từ một DÒNG gửi `row:<id>` kèm chính dòng đó; form cấp view gửi
  // `form:<id>`. Hai tiền tố này là hợp đồng với `runViewAction()` ở sidecar.
  const row = formRow.value
  void runAction({
    actionId: row ? `row:${form.id}` : `form:${form.id}`,
    ...(row ? { row } : {}),
    // Trộn giá trị của VIEW vào: `s3.putFolder` cần `{bucket}`, mà bucket là tham
    // số của view chứ không phải một ô trong form. Thiếu bước này thì sidecar báo
    // thiếu `bucket` — đúng, nhưng vô nghĩa với người dùng vì họ đã chọn nó rồi.
    values: { ...viewValues.value, ...values },
    label: t(form.label),
    consequence: t(form.consequence),
    danger: form.danger,
    confirm: form.confirm,
    after: () => {
      closeForm()
      void reload()
    },
  })
}

/**
 * "Thu nhỏ" (task 3.5) — đẩy PHIÊN HẠ TẦNG vào dock của app kèm chip ngữ cảnh
 * của đối tượng đang chọn. Dock là nơi duy nhất trong app biết cách đưa người
 * dùng trở lại một phiên, nên một màn tự vẽ "phiên đang chạy" của riêng nó sẽ là
 * bản sao thứ hai của cùng một ý tưởng.
 */
async function minimizeSession(): Promise<void> {
  if (docking.value) return
  docking.value = true
  try {
    const id = await bubble.ensureSession()
    if (id == null) return
    const view = activeView.value
    const name = selected.value?.['name'] || selected.value?.['id'] || ''
    const title = view
      ? name
        ? `${t(view.label)} — ${name}`
        : t(view.label)
      : t('infra.bubble.title')
    dock.minimize({
      id: `infra-session:${id}`,
      kind: 'session',
      icon: 'layers',
      title,
      sessionId: id,
    })
    toast.add({ title: t('infra.explorer.dock.done'), color: 'success' })
  } finally {
    docking.value = false
  }
}

const emit = defineEmits<{
  /** Nhảy sang tab khác của `/infra` (dịch vụ trỏ tới Logs/Kubernetes/Tài khoản…). */
  (e: 'open-tab', tab: 'logs' | 'kubernetes' | 'accounts' | 'overview'): void
  /** Mở PANE danh mục — nút "Tất cả dịch vụ" ở cột trái. */
  (e: 'open-catalog'): void
  (
    e: 'rows',
    rows: { viewId: string; label: string; name: string; values?: Record<string, string> }[],
  ): void
}>()

// Tab Dịch vụ mở một view bằng cách nhờ chính màn này — nó là nơi duy nhất có
// `openView()` (đặt giá trị, dò quyền, nạp trang đầu).
defineExpose({ openView })
</script>

<style scoped>
.ixe {
  /* Flex chứ không grid: bề rộng cột trái do người dùng kéo, mà grid thì mọi
     track phải khai báo trước trong CSS. Tay kéo là một cột thật ở giữa. */
  display: flex;
  align-items: stretch;
  padding: 12px 16px 14px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.ixe-side {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* Hàng tiêu đề đứng yên, chỉ phần danh mục cuộn: danh mục đầy đủ dài hơn một
   màn, còn nút "Tất cả dịch vụ" và nút thu gọn thì phải luôn với tới được. */
.ixe-side-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-height: 0;
  overflow-y: auto;
}

/* Tay kéo `.grsz` đã có CSS chung; ở đây chỉ thêm lề ngang để tổng khoảng hở vẫn
   là 14px như bản grid cũ (6px tay kéo + 4px mỗi bên). */
.ixe-rsz {
  margin: 0 4px;
}

.ixe-side-toggle {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
}

.ixe-side-hd {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 6px;
}

.ixe-side-ttl {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
}

.ixe-catalog {
  width: 100%;
  justify-content: center;
}

/* Một nhóm việc ("Máy chủ & tính toán"). Nhóm ghim cũng dùng đúng khuôn này —
   nó chỉ khác ở chỗ đứng đầu và lấy dữ liệu từ `pinned`, không phải từ danh mục. */
.ixe-grp {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-top: 6px;
}

.ixe-grp-hd {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 2px;
  border: 0;
  background: transparent;
  color: var(--textDim);
  font-family: var(--sans);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.ixe-grp-hd:hover {
  color: var(--text);
}

.ixe-grp-ttl {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Mũi tên chỉ HƯỚNG của nhóm: quay phải khi gập, quay xuống khi mở. `chev` của
   app là mũi tên xuống, nên trạng thái gập là `rotate(-90deg)`. */
.ixe-grp-chev {
  flex: 0 0 auto;
  width: var(--icon-sm);
  height: var(--icon-sm);
  transform: rotate(-90deg);
  transition: transform 0.12s ease;
}

.ixe-grp-chev.open {
  transform: none;
}

.ixe-nav {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 9px;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--textMuted);
  font-family: var(--sans);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  text-align: left;
  cursor: pointer;
}

/* Nhãn chiếm hết chỗ còn lại và tự cắt đuôi: tên view ("Certificate Manager") dài
   hơn cột 180px, mà đẩy cột rộng ra chỉ vì một cái tên là lấy chỗ của bảng. */
.ixe-nav-txt {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Dấu cho biết mục này mở ra Console AWS (không có màn riêng trong app). */
.ixe-nav-ic {
  flex: 0 0 auto;
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--textFaint);
}

/* Dấu GHIM trên mục nằm trong nhóm của nó — không phải nút bấm: ghim/bỏ ghim vẫn
   là việc của mặt danh mục, nơi có chỗ nói rõ nó sẽ đi đâu. */
.ixe-nav-pin {
  flex: 0 0 auto;
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--accent);
}

.ixe-nav:hover {
  color: var(--text);
}

.ixe-nav.on {
  background: var(--accentDim);
  border-color: var(--accentBorder);
  color: var(--text);
}

.ixe-side-empty {
  margin: 6px 2px;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.ixe-main {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}

/* Nút mở lại cột dịch vụ (chỉ có khi cột đang thu gọn). `align-self` để nó không
   kéo giãn hết chiều ngang của bảng. */
.ixe-expand {
  align-self: flex-start;
  flex: 0 0 auto;
  margin-bottom: 8px;
}

.ixe-hd {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  flex-wrap: wrap;
  padding-bottom: 8px;
}

.ixe-hd-txt {
  flex: 1;
  min-width: 200px;
}

.ixe-ttl {
  margin: 0;
  color: var(--text);
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  font-weight: 650;
}

.ixe-about {
  margin: 2px 0 0;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

/* Bố cục + da ở `.itoolbar` (app-shell.css); `margin-bottom` là lề riêng của màn. */
.ixe-params {
  margin-bottom: 8px;
}

.ixe-param {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.ixe-param-lbl {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.ixe-param-input {
  min-width: 220px;
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  color: var(--text);
  font-family: var(--sans);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  outline: none;
}

.ixe-warn {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgSubtle);
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}

.ixe-warn.ok {
  border-color: var(--accentBorder);
}

/* Cảnh báo của view (Mốc 4): đọc được, nhưng không phải màu của lỗi — nó nói
   "bảng này có thể đang trả lời thiếu", không nói "vừa có gì hỏng". */
.ixe-warn.notice {
  align-items: flex-start;
  border-color: var(--amberBorder);
  background: var(--amberDim);
  color: var(--text);
}

.ixe-empty {
  margin: auto;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
</style>
