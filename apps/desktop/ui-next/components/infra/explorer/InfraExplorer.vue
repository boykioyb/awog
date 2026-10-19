<template>
  <!-- Flex chứ không grid: bề rộng cột trái do người dùng kéo, mà grid thì mọi
       track phải khai báo trước. Tay kéo là một cột thật ở giữa. -->
  <div class="flex h-full min-h-0 items-stretch overflow-hidden px-4 pt-3 pb-3.5">
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
         cột phải, nơi nó không chiếm chỗ của bảng. -->
    <aside
      v-if="!sidebarCollapsed"
      class="flex min-h-0 shrink-0 flex-col"
      :style="{ width: `${sideW}px` }"
    >
      <div class="flex items-center gap-1.5 pb-1.5">
        <span class="min-w-0 flex-1 truncate text-xs font-semibold text-dim">
          {{ t('infra.explorer.side.title') }}
        </span>
        <Button
          type="button"
          :title="t('infra.explorer.pinned.collapse')"
          :aria-label="t('infra.explorer.pinned.collapse')"
          aria-expanded="true"
          class="size-6 shrink-0"
          variant="outline"
          size="iconSm"
          @click="setSidebarCollapsed(true)"
        >
          <Icon name="panel" />
        </Button>
      </div>
      <!-- Phần cuộn được tách khỏi hàng tiêu đề: danh mục đầy đủ dài hơn một
           màn, mà tiêu đề + nút "Tất cả dịch vụ" thì phải luôn ở trên. -->
      <div class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        <!-- Danh mục là một PANE của CHÍNH tab này, không phải tab riêng (2026-09-14:
             "khám phá là page con trong dịch vụ thôi chứ?"). Hai tab ngang hàng —
             một cái là danh mục, một cái là bảng — là hai tab nói về cùng một việc,
             mà tab danh mục thì không có dữ liệu nào của riêng nó.

             Nút này xuống HÀNG RIÊNG thay vì nằm cạnh tiêu đề: cột chỉ rộng
             180–220px, xếp thêm nút thu gọn vào cùng hàng là ba thứ tranh chỗ và
             tiêu đề sẽ là thứ bị cắt chữ. -->
        <Button
          type="button"
          class="w-full justify-center"
          variant="outline"
          size="sm"
          @click="emit('open-catalog')"
        >
          <Icon name="layers" />
          {{ t('infra.explorer.services.open') }}
        </Button>

        <!-- Một nhóm việc ("Máy chủ & tính toán"). Nhóm ghim cũng dùng đúng khuôn
             này — nó chỉ khác ở chỗ đứng đầu và lấy dữ liệu từ `pinned`. -->
        <section class="mt-1.5 flex flex-col gap-px">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            :class="GROUP_HEAD"
            :aria-expanded="!isFolded(PINNED_GROUP)"
            @click="toggleGroup(PINNED_GROUP)"
          >
            <Icon name="chev" :class="[CHEV, isFolded(PINNED_GROUP) && '-rotate-90']" />
            <span class="min-w-0 truncate">{{ t('infra.explorer.pinned.title') }}</span>
          </Button>
          <template v-if="!isFolded(PINNED_GROUP)">
            <Button
              v-for="s in pinnedEntries"
              :key="`pin:${s.id}`"
              variant="ghost"
              size="sm"
              :class="[NAV_ROW, entryActive(s) && NAV_ON]"
              :title="isConsoleEntry(s) ? t('infra.explorer.support.hint.console') : t(s.about)"
              type="button"
              @click="onEntry(s)"
            >
              <span class="min-w-0 flex-1 truncate text-left">{{ entryLabel(s) }}</span>
              <Icon v-if="isConsoleEntry(s)" name="external" class="text-faint" />
              <Icon v-else name="pin" class="text-primary" />
            </Button>
            <p v-if="!pinnedEntries.length" class="mx-0.5 my-1.5 text-xs text-faint">
              {{ t('infra.explorer.pinned.empty') }}
            </p>
          </template>
        </section>

        <!-- Cả danh mục, đúng thứ tự nhóm của sidecar ("Máy chủ & tính toán" …
             "Hạ tầng dạng mã"), không xếp lại theo bảng chữ cái. -->
        <section v-for="g in serviceGroups" :key="g.id" class="mt-1.5 flex flex-col gap-px">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            :class="GROUP_HEAD"
            :aria-expanded="!isFolded(g.id)"
            @click="toggleGroup(g.id)"
          >
            <Icon name="chev" :class="[CHEV, isFolded(g.id) && '-rotate-90']" />
            <span class="min-w-0 truncate">{{ t(`infra.explorer.group.${g.id}`) }}</span>
          </Button>
          <template v-if="!isFolded(g.id)">
            <Button
              v-for="s in g.services"
              :key="s.id"
              variant="ghost"
              size="sm"
              :class="[NAV_ROW, entryActive(s) && NAV_ON]"
              :title="isConsoleEntry(s) ? t('infra.explorer.support.hint.console') : t(s.about)"
              type="button"
              @click="onEntry(s)"
            >
              <span class="min-w-0 flex-1 truncate text-left">{{ entryLabel(s) }}</span>
              <Icon v-if="isConsoleEntry(s)" name="external" class="text-faint" />
              <Icon v-else-if="pinnedServices.includes(s.id)" name="pin" class="text-primary" />
            </Button>
          </template>
        </section>
      </div>
    </aside>

    <!-- Tay kéo giữa cột trái và bảng — cùng hình với tay kéo của Git/Wiki (vạch 1px,
         hover/kéo thành vạch accent 2px). Ẩn khi thu gọn: kéo một cột đang không
         hiện thì không có gì để kéo.

         `role="separator"` + `tabindex` + mũi tên: tay kéo của app vốn chỉ dùng
         được bằng chuột; ở đây thêm đường bàn phím vì bề rộng này quyết định bảng
         có đọc được hay không, mà không có cách chỉnh nào khác. -->
    <div
      v-if="!sidebarCollapsed"
      class="relative mx-1 w-1.5 shrink-0 cursor-col-resize self-stretch after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border hover:after:w-0.5 hover:after:bg-primary focus-visible:outline-hidden focus-visible:after:w-0.5 focus-visible:after:bg-primary"
      :class="rszDragging && 'after:w-0.5 after:bg-primary'"
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
    <main class="flex min-h-0 min-w-0 flex-1 flex-col">
      <!-- Đường mở lại cột dịch vụ sau khi thu gọn. Nằm ở ĐÂY, không nằm trong
           một thanh ray rỗng bên trái: nút này không chiếm chỗ của bảng, và nó
           vẫn hiện khi chưa chọn view nào (nhánh dưới). `self-start` để nút
           không kéo giãn hết chiều ngang. -->
      <Button
        v-if="sidebarCollapsed"
        type="button"
        :title="t('infra.explorer.pinned.expand')"
        :aria-label="t('infra.explorer.pinned.expand')"
        class="mb-2 shrink-0 self-start"
        variant="outline"
        size="sm"
        @click="setSidebarCollapsed(false)"
      >
        <Icon name="panel" />
        {{ t('infra.explorer.side.title') }}
      </Button>
      <template v-if="activeView">
        <header class="flex flex-wrap items-start gap-2.5 pb-2">
          <div class="min-w-50 flex-1">
            <h2 class="text-lg font-semibold text-foreground">{{ t(activeView.label) }}</h2>
            <p class="mt-0.5 text-xs text-dim">{{ t(activeView.about) }}</p>
          </div>
          <div class="flex shrink-0 flex-wrap items-center gap-1.5">
            <!-- Form nhỏ của view (task 3.6): tạo bucket/thư mục, tải lên, presign.
                 Nút cũng bị ẩn khi dò quyền từ chối (task 3.3) — lý do giống nút
                 ghi trên dòng. -->
            <Button
              v-for="f in activeView.forms"
              :key="f.id"
              type="button"
              :disabled="actionDenied(f.id)"
              :title="actionDenied(f.id) ? t('infra.explorer.denied') : t(f.consequence)"
              variant="outline"
              size="sm"
              @click="startForm(f)"
            >
              <Icon name="plus" />
              {{ t(f.label) }}
            </Button>
            <Button
              type="button"
              :disabled="!activeView.hasConsole"
              variant="outline"
              size="sm"
              @click="openConsole(selected)"
            >
              <Icon name="external" />
              {{ t('infra.explorer.console') }}
            </Button>
            <!-- Dock phiên thu nhỏ (task 3.5): dùng lại dock của app, mang theo
                 ngữ cảnh của đối tượng đang chọn. -->
            <Button
              type="button"
              :disabled="docking"
              variant="outline"
              size="sm"
              @click="minimizeSession"
            >
              <Icon name="minimize" />
              {{ t('infra.explorer.dock') }}
            </Button>
            <Button type="button" variant="outline" size="sm" @click="askScreen">
              <Icon name="sparkles" />
              {{ t('infra.explorer.ask') }}
            </Button>
          </div>
        </header>

        <!-- View cần tham số (vd s3.objects cần bucket) thì hỏi TRƯỚC khi gọi —
             không đoán một cái tên bucket rồi để AWS trả lỗi. Thanh là một card:
             ở theme sáng nền trang và nền panel gần như trùng nhau, một hàng ô trôi
             thẳng trên nền trang đọc ra thành các ô rời rạc. Căn ĐÁY vì nhãn nằm
             trên control. -->
        <form
          v-if="activeView.required.length"
          class="mb-2 flex shrink-0 flex-wrap items-end gap-2.5 rounded-xl border bg-card px-2.5 py-2 shadow-sm"
          @submit.prevent="reload()"
        >
          <label v-for="f in activeView.required" :key="f.key" class="flex flex-col gap-1">
            <span class="text-xs text-dim">{{ t(f.label) }}</span>
            <Input
              :model-value="viewValues[f.key] ?? ''"
              :placeholder="f.placeholder ?? ''"
              autocomplete="off"
              spellcheck="false"
              @update:model-value="viewValues[f.key] = $event"
            />
          </label>
          <Button type="submit" :disabled="loading" variant="default" size="sm">
            {{ t('infra.explorer.load') }}
          </Button>
          <Button v-if="inPrefixTree" type="button" variant="outline" size="sm" @click="goUpPrefix">
            <Icon name="chev-left" />
            {{ t('infra.explorer.up') }}
          </Button>
        </form>

        <!-- Cảnh báo của VIEW (Mốc 4, task 4.1): khác tooltip `about` ở chỗ nó
             phải đọc được TRƯỚC khi tin vào bảng — ACM bắt buộc `us-east-1` cho
             CloudFront, nên "bảng trống" ở region khác là câu trả lời sai. Màu cảnh
             báo chứ không phải màu lỗi: nó nói "bảng này có thể đang trả lời thiếu",
             không nói "vừa có gì hỏng". -->
        <Alert v-if="activeView.notice" :class="[NOTE, 'border-warning/40 bg-warning/10']">
          <Icon name="info" />
          <AlertDescription class="text-xs text-foreground">
            {{ t(activeView.notice) }}
          </AlertDescription>
        </Alert>

        <Alert v-if="probeVerdict === 'denied'" :class="NOTE">
          <Icon name="shield" />
          <AlertDescription class="text-xs">{{ t('infra.explorer.deniedNote') }}</AlertDescription>
        </Alert>
        <Alert v-if="lastDownload" :class="[NOTE, 'border-selected-border']">
          <Icon name="download" />
          <AlertDescription class="flex flex-wrap items-center gap-1.5 text-xs">
            {{ t('infra.explorer.downloaded') }}
            <Button type="button" variant="outline" size="sm" @click="previewDownload">
              {{ t('infra.explorer.preview') }}
            </Button>
          </AlertDescription>
        </Alert>

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

      <p v-else class="m-auto text-sm text-dim">{{ t('infra.explorer.pick') }}</p>
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
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
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

// Class lặp lại giữa nhóm ghim và các nhóm danh mục — gom một chỗ để hai bản không lệch.
/** Hàng tiêu đề nhóm: chữ nhỏ đậm, không nền khi hover (chỉ đổi màu chữ). */
const GROUP_HEAD =
  'h-auto justify-start gap-1 px-0.5 py-1 text-xs font-semibold text-dim hover:bg-transparent hover:text-foreground'
/** Mũi tên chỉ HƯỚNG của nhóm: `chev` của app là mũi tên xuống, nên trạng thái gập
 *  là xoay -90°. */
const CHEV = 'shrink-0 transition-transform duration-150'
/** Một mục dịch vụ. Nhãn tự cắt đuôi: tên view ("Certificate Manager") dài hơn cột
 *  180px, mà đẩy cột rộng ra chỉ vì một cái tên là lấy chỗ của bảng. */
const NAV_ROW =
  'h-auto w-full justify-start gap-1.5 border border-transparent px-2 py-1.5 font-normal text-muted-foreground hover:text-foreground'
/** Mục đang mở — accent-tint, không nền xám. */
const NAV_ON = 'border-selected-border bg-selected text-foreground hover:bg-selected'
/** Khuôn chung của các dải ghi chú phía trên bảng. */
const NOTE = 'mb-1.5 shrink-0 bg-muted px-2.5 py-1.5 text-xs'

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
