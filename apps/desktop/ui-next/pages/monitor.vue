<template>
  <section
    class="flex min-w-0 flex-1 flex-col gap-4 overflow-auto px-5 pt-4 pb-7"
    data-page="monitor"
  >
    <!-- Header: chỉ tiêu đề + nhịp đo. Control của từng màn nằm trong màn đó. -->
    <div class="flex flex-wrap items-center gap-3">
      <div class="flex min-w-0 shrink-0 items-center gap-2.5">
        <Icon name="cpu" class="size-5 text-primary" />
        <div>
          <h1 class="text-lg font-semibold text-foreground">{{ t('monitor.title') }}</h1>
          <p class="text-sm text-muted-foreground">{{ subtitle }}</p>
        </div>
      </div>
    </div>

    <!-- Hai màn là hai TAB thật. Tab Đĩa nạp dữ liệu lần đầu qua openDisk(). -->
    <Tabs :model-value="view" @update:model-value="onTab">
      <TabsList>
        <TabsTrigger value="proc">
          <Icon name="cpu" />
          {{ t('monitor.view.proc') }}
        </TabsTrigger>
        <TabsTrigger value="disk">
          <Icon name="disk" />
          {{ t('monitor.view.disk') }}
        </TabsTrigger>
      </TabsList>
    </Tabs>

    <MonitorDisk
      v-if="view === 'disk'"
      :volumes="disk.volumes.value"
      :targets="disk.targets.value"
      :sizes="disk.sizes.value"
      :measuring="disk.measuring.value"
      :measured="disk.measured.value"
      :measure-done="disk.measureDone.value"
      :measure-total="disk.measureTotal.value"
      :all-measured="disk.allMeasured.value"
      :total-safe-kb="disk.totalSafeKb.value"
      :home="disk.home.value"
      :error="disk.error.value"
      :can-trash="disk.canTrash"
      :cleanup-actions="disk.cleanupActions.value"
      :cleanup-running="disk.cleanupRunning.value"
      @measure="disk.measureAll()"
      @open="disk.openTree"
      @trash="disk.trash"
      @cleanup="runCleanup"
      @reveal="disk.reveal"
      @copy-path="disk.copyPath"
      @menu="openFileMenu"
    />

    <!-- Quét sâu = drawer, không phải khối ở đáy trang: nó là luồng lần xuống
         nhiều cấp, mỗi cú bấm mà phải cuộn đi cuộn lại thì hỏng việc. -->
    <MonitorDiskDrawer
      v-if="disk.treePath.value"
      :path="disk.treePath.value"
      :entries="disk.treeEntries.value"
      :loading="disk.treeLoading.value"
      :last-path="disk.treeLastPath.value"
      :total="disk.treeTotal.value"
      :can-trash="disk.canTrash"
      :cached-at="disk.treeCachedAt.value"
      :can-go-up="disk.canGoUp.value"
      @open="disk.openTree"
      @up="disk.treeUp()"
      @rescan="disk.rescanTree()"
      @trash-current="disk.trashCurrent()"
      @close="disk.closeTree()"
      @trash="disk.trash"
      @reveal="disk.reveal"
      @copy-path="disk.copyPath"
      @menu="openFileMenu"
    />

    <!-- Menu chuột phải DÙNG CHUNG với tab Files của Sessions (`useFileContextMenu`
         chế độ `absolute`) — cùng một danh sách hàng, cùng một component. -->
    <AppContextMenu
      :open="disk.fileMenu.menu.value !== null"
      :position="disk.fileMenu.menu.value ?? { x: 0, y: 0 }"
      :items="disk.fileMenu.items.value"
      @close="disk.fileMenu.close"
      @select="disk.fileMenu.onSelect"
    />

    <!-- Điều kiện TƯỜNG MINH, không dùng `v-else`: drawer quét sâu nằm chen giữa
         hai khối này, mà `v-else` bắt buộc phải là anh em LIỀN KỀ của `v-if` —
         thêm một phần tử vào giữa là cặp đứt và khối tiến trình hiện cả ở tab Đĩa
         (lỗi đã đo). -->
    <template v-if="view === 'proc'">
      <!-- Toolbar của TAB, nên nằm DƯỚI thanh tab: control thuộc về nội dung tab
           mà đặt phía trên nó thì thứ tự đọc bị ngược. -->
      <!-- Bốn control (phạm vi · host · lọc · tạm dừng) không vừa một hàng ở bề rộng
           panel thường gặp: cho cả hàng xuống dòng, để Ô LỌC là thứ co. -->
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <!-- Phạm vi đo. SSH chỉ hiện khi CÓ kết nối đang mở: mục chọn dẫn tới một
             bảng rỗng là mục chọn nói dối. -->
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          class="shrink-0"
          :model-value="scope"
          @update:model-value="onScope"
        >
          <ToggleGroupItem value="awog">{{ t('monitor.scope.awog') }}</ToggleGroupItem>
          <ToggleGroupItem value="machine">{{ t('monitor.scope.machine') }}</ToggleGroupItem>
          <ToggleGroupItem v-if="sshTargets.length > 0" value="ssh">
            {{ t('monitor.scope.ssh') }}
          </ToggleGroupItem>
        </ToggleGroup>
        <AppSelect
          v-if="scope === 'ssh' && sshTargets.length > 1"
          v-model="sshConnId"
          :options="sshOptions"
          width="150px"
        />
        <!-- `ml-auto` nuốt hết khoảng trống còn lại ⇒ ô lọc + Tạm dừng dạt phải, còn
             các bộ chọn bên trái đứng yên tại chỗ dù tab nào. -->
        <div class="relative ml-auto w-56 min-w-0">
          <Icon
            name="search"
            class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input v-model="search" class="pl-8" :placeholder="t('monitor.search')" />
        </div>
        <Button variant="outline" @click="paused = !paused">
          <Icon :name="paused ? 'play' : 'stop'" />
          {{ paused ? t('monitor.resume') : t('monitor.pause') }}
        </Button>
      </div>

      <Alert v-if="error" variant="destructive" class="border-destructive/40 bg-destructive/10">
        <Icon name="alert" />
        <AlertDescription>{{ t('monitor.error', { msg: error }) }}</AlertDescription>
      </Alert>

      <!-- Tiến trình AWOG sót lại từ lần chạy trước: gần như luôn là rò rỉ, nên nó
         đứng TRÊN mọi thứ khác chứ không nằm lẫn trong bảng. -->
      <div
        v-if="scope !== 'ssh' && orphans.length > 0"
        class="flex flex-col gap-2 rounded-xl border border-destructive bg-destructive/10 px-3.5 py-3"
      >
        <div class="flex items-center gap-2 text-base text-destructive">
          <Icon name="alert" class="size-3.5" />
          <span>{{ t('monitor.orphans.title', { n: orphans.length }) }}</span>
        </div>
        <div class="text-sm text-muted-foreground">{{ t('monitor.orphans.desc') }}</div>
        <!-- Bảng nằm TRONG banner đã là một card — khử khung của bảng (class rơi xuống
             phần tử gốc của MonitorProcesses) để khỏi thành card lồng card. -->
        <MonitorProcesses
          class="border-0 bg-transparent p-0 shadow-none"
          :title="''"
          :rows="orphans"
          :killing="killing"
          :total-mem-kb="totalMemKb"
          :can-kill="canKill"
          :needs-force="needsForce"
          :session-titles="sessionTitles"
          @kill="kill"
        />
      </div>

      <!-- Máy: từng lõi CPU, load average, RAM thật + swap. Khác hàng thẻ bên dưới,
         vốn nói về TẬP đang xem. Ẩn ở phạm vi SSH — đó là máy khác. -->
      <MonitorSystem v-if="system" :sys="system" />

      <MonitorSummary
        :scope="scope"
        :host-label="activeSshLabel"
        :totals="totals"
        :gpu="gpu"
        :core-count="coreCount"
        :total-mem-kb="totalMemKb"
        :warming-up="warmingUp"
        :top="topProcess"
      />

      <MonitorSessions
        v-if="scope !== 'ssh'"
        :sessions="sessions"
        :total-mem-kb="totalMemKb"
        @open="openSession"
      />

      <div v-if="truncated" class="text-xs text-faint">{{ t('monitor.truncated') }}</div>

      <MonitorProcesses
        :title="t('monitor.processes.title')"
        :rows="processes"
        :killing="killing"
        :total-mem-kb="totalMemKb"
        :can-kill="canKill"
        :needs-force="needsForce"
        :session-titles="sessionTitles"
        :sort-key="sortKey"
        :sort-dir="sortDir"
        :grouped="groupByApp"
        :groups="appGroups"
        :expanded="expandedApps"
        sortable
        @kill="kill"
        @sort="toggleSort"
        @toggle-group="groupByApp = !groupByApp"
        @toggle-app="toggleApp"
        @kill-app="killApp"
      />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMonitorManager } from '~/composables/useMonitorManager'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'

const { t } = useI18n()

/** 'proc' = tiến trình · 'disk' = dung lượng đĩa. */
const view = ref<'proc' | 'disk'>('proc')
const disk = useDiskManager()

// Nạp danh sách ổ + ứng viên dọn ở lần mở đầu. KHÔNG tự đo dung lượng: `du` mất
// hàng chục giây, nên nó phải là một cú bấm có chủ ý chứ không phải thứ tự chạy
// mỗi lần người dùng liếc qua tab.
function openFileMenu(ev: MouseEvent, path: string, kind: 'file' | 'dir'): void {
  disk.fileMenu.open(ev, { path, kind })
}

/** Tra id ra hành động rồi mới chạy: UI chỉ gửi id, lệnh nằm ở sidecar. */
function runCleanup(id: string): void {
  const action = disk.cleanupActions.value.find((a) => a.id === id)
  if (action) void disk.runCleanup(action)
}

function openDisk(): void {
  view.value = 'disk'
  if (!disk.loaded.value) void disk.load()
}

function onTab(v: string | number): void {
  if (v === 'disk') openDisk()
  else view.value = 'proc'
}

const {
  processes,
  sessions,
  orphans,
  totals,
  gpu,
  system,
  coreCount,
  totalMemKb,
  warmingUp,
  topProcess,
  error,
  scope,
  sshConnId,
  sshTargets,
  truncated,
  paused,
  sortKey,
  sortDir,
  toggleSort,
  groupByApp,
  appGroups,
  expandedApps,
  toggleApp,
  killApp,
  search,
  killing,
  canKill,
  needsForce,
  kill,
} = useMonitorManager()

const sessionTitles = computed(() => new Map(sessions.value.map((s) => [s.sessionId, s.title])))

const activeSshLabel = computed(
  () => sshTargets.value.find((x) => x.connId === sshConnId.value)?.label ?? '',
)

const sshOptions = computed(() =>
  sshTargets.value.map((x) => ({ label: x.label, value: x.connId })),
)

// Bấm tab SSH: chọn luôn kết nối đầu tiên nếu chưa chọn gì — một tab dẫn tới
// trạng thái "chưa chọn" là một cú bấm thừa.
function pickSsh(): void {
  if (!sshConnId.value) sshConnId.value = sshTargets.value[0]?.connId ?? ''
  scope.value = 'ssh'
}

// ToggleGroup single trả `undefined` khi bấm lại mục đang chọn — bỏ qua để luôn
// còn đúng một phạm vi (như segment cũ).
function onScope(v: unknown): void {
  if (v === 'ssh') pickSsh()
  else if (v === 'awog' || v === 'machine') scope.value = v
}

const subtitle = computed(() => {
  if (paused.value) return t('monitor.paused')
  if (scope.value === 'ssh' && !sshConnId.value) return t('monitor.scope.noSsh')
  if (warmingUp.value) return t('monitor.warming')
  return t('monitor.subtitle', { count: totals.value.processCount })
})

function openSession(sessionId: string): void {
  void navigateTo(`/workbench?id=${encodeURIComponent(sessionId)}`)
}
</script>
