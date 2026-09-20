<template>
  <section class="page on monpage" data-page="monitor">
    <!-- Header: chỉ tiêu đề + nhịp đo. Control của từng màn nằm trong màn đó. -->
    <div class="monhd">
      <div class="monhdl">
        <Icon name="cpu" class="monhdic" />
        <div>
          <div class="monhdt">{{ t('monitor.title') }}</div>
          <div class="fd">{{ subtitle }}</div>
        </div>
      </div>
    </div>

    <!-- Hai màn là hai TAB thật: thanh tab chạy hết bề ngang, tab đang mở có gạch
         accent 2px dưới chân. Cố ý KHÔNG dùng `.ptab` sẵn có — tab active của nó
         tô nền xám `--bgActive`, kiểu đã bị bác cho control chọn (xem quy ước
         selection = accent-tint trong nuxt-vue.md). -->
    <div class="montabs" role="tablist">
      <button
        class="montab"
        :class="{ on: view === 'proc' }"
        role="tab"
        :aria-selected="view === 'proc'"
        @click="view = 'proc'"
      >
        <Icon name="cpu" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('monitor.view.proc') }}
      </button>
      <button
        class="montab"
        :class="{ on: view === 'disk' }"
        role="tab"
        :aria-selected="view === 'disk'"
        @click="openDisk()"
      >
        <Icon name="disk" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('monitor.view.disk') }}
      </button>
    </div>

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
    <ContextMenu
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
      <div class="monbar">
        <!-- Phạm vi đo. SSH chỉ hiện khi CÓ kết nối đang mở: mục chọn dẫn tới một
             bảng rỗng là mục chọn nói dối. -->
        <div class="seg">
          <span :class="{ on: scope === 'awog' }" role="button" @click="scope = 'awog'">
            {{ t('monitor.scope.awog') }}
          </span>
          <span :class="{ on: scope === 'machine' }" role="button" @click="scope = 'machine'">
            {{ t('monitor.scope.machine') }}
          </span>
          <span
            v-if="sshTargets.length > 0"
            :class="{ on: scope === 'ssh' }"
            role="button"
            @click="pickSsh()"
          >
            {{ t('monitor.scope.ssh') }}
          </span>
        </div>
        <AppSelect
          v-if="scope === 'ssh' && sshTargets.length > 1"
          v-model="sshConnId"
          :options="sshOptions"
          width="150px"
        />
        <div class="srch monsrch">
          <Icon name="search" style="width: var(--icon-sm); height: var(--icon-sm)" />
          <input v-model="search" :placeholder="t('monitor.search')" />
        </div>
        <button class="btn" @click="paused = !paused">
          <Icon
            :name="paused ? 'play' : 'stop'"
            style="width: var(--icon-sm); height: var(--icon-sm)"
          />
          {{ paused ? t('monitor.resume') : t('monitor.pause') }}
        </button>
      </div>

      <div v-if="error" class="monerr">
        <Icon name="alert" style="width: var(--icon-sm); height: var(--icon-sm)" />
        {{ t('monitor.error', { msg: error }) }}
      </div>

      <!-- Tiến trình AWOG sót lại từ lần chạy trước: gần như luôn là rò rỉ, nên nó
         đứng TRÊN mọi thứ khác chứ không nằm lẫn trong bảng. -->
      <div v-if="scope !== 'ssh' && orphans.length > 0" class="monorph">
        <div class="monorphh">
          <Icon name="alert" style="width: var(--icon-sm); height: var(--icon-sm)" />
          <span>{{ t('monitor.orphans.title', { n: orphans.length }) }}</span>
        </div>
        <div class="monorphd">{{ t('monitor.orphans.desc') }}</div>
        <MonitorProcesses
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

      <div v-if="truncated" class="moncap">{{ t('monitor.truncated') }}</div>

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

const subtitle = computed(() => {
  if (paused.value) return t('monitor.paused')
  if (scope.value === 'ssh' && !sshConnId.value) return t('monitor.scope.noSsh')
  if (warmingUp.value) return t('monitor.warming')
  return t('monitor.subtitle', { count: totals.value.processCount })
})

function openSession(sessionId: string): void {
  void navigateTo(`/sessions?id=${encodeURIComponent(sessionId)}`)
}
</script>

<style scoped>
.monpage {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 18px 20px 28px;
  overflow: auto;
}
/* ⚠ KHÔNG dùng `justify-content: space-between`: nó đẩy cả nhóm control sang sát
   mép phải, nên bộ chọn "Tiến trình | Đĩa" TRÔI NGANG cả nghìn pixel khi đổi tab
   (tab Đĩa không có bộ lọc/Tạm dừng nên nhóm ngắn lại). Người dùng phải dò chuột
   đi tìm đúng cái nút vừa bấm. Nhóm control bám ngay sau tiêu đề; chỉ ô lọc và
   nút Tạm dừng mới trôi sang phải. */
.monhd {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.monhdl {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 0 0 auto;
}
.monhdic {
  width: var(--icon-lg);
  height: var(--icon-lg);
  color: var(--accent);
}
.monhdt {
  font-size: var(--fs-xl);
  line-height: var(--lh-xl);
  color: var(--text);
}
/* Bốn control (phạm vi · host · lọc · tạm dừng) không vừa một hàng ở bề rộng
   panel thường gặp (611px đo được): nút "Tạm dừng" bị cắt mất một nửa. Cho cả
   hàng xuống dòng được, ghim hai đầu ở kích thước thật và để Ô LỌC là thứ co —
   nó là thứ duy nhất trong hàng chịu được việc hẹp đi. */
.monbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}
.monbar > .seg {
  flex: 0 0 auto;
}
.monsrch {
  /* `margin-left: auto` nuốt hết khoảng trống còn lại ⇒ ô lọc + Tạm dừng dạt phải,
     còn các bộ chọn bên trái đứng yên tại chỗ dù tab nào. */
  margin-left: auto;
  flex: 0 1 220px;
  min-width: 0;
}
.moncap {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}
/* Thanh tab. Gạch accent 2px dưới chân tab đang mở — quy ước selection của repo
   (accent-tint + thanh accent), không phải nền xám đặc. */
.montabs {
  display: flex;
  align-items: stretch;
  gap: 2px;
  box-shadow: inset 0 -1px 0 var(--border);
}
.montab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: var(--textDim);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition:
    color 0.12s,
    border-color 0.12s;
}
.montab:hover:not(.on) {
  color: var(--text);
}
.montab.on {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
.monerr {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--r-sm);
  background: var(--dangerBg);
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.monorph {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--danger);
  border-radius: var(--r-card);
  background: var(--dangerBg);
}
.monorphh {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--danger);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
/* Bảng nhúng trong banner mồ côi đã nằm TRONG một card rồi — để nguyên skin
   `.tile` là card lồng card (nền trắng nổi trên nền đỏ, hai lớp bo góc). Khử
   khung con, giữ lại bố cục. */
.monorph :deep(.monsec) {
  background: transparent;
  border: none;
  box-shadow: none;
  padding: 0;
}
.monorphd {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textDim);
}
</style>
