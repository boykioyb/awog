<template>
  <!-- Tab "Bảng điều khiển" của `/infra` (Mốc 6, M4).
       HAI MẶT, MỘT TAB: danh sách bảng (mặc định) và một bảng đang mở. Không phải hai
       tab vì chúng là hai bước của cùng một việc — và không phải hai route vì bảng
       đang mở mang theo số liệu vừa nạp, thứ sẽ mất nếu điều hướng.

       HAI MẶT, MỘT KHUÔN. Cả hai mặt xếp theo đúng thứ tự của mọi màn trong nhóm
       (Giám sát · Chi phí): header đứng yên ở trên, thân cuộn ở dưới. Trước
       2026-09-16 mặt danh sách có header còn mặt đang-mở thì không — tên bảng bị
       nhét vào giữa thanh công cụ như một mục flex, nên nó trôi theo chỗ hàng gãy
       và hai mặt của CÙNG MỘT TAB trông như hai màn của hai người viết khác nhau
       (ảnh người dùng 2026-09-16).

       LUẬT KHÔNG TỰ CHẠY của `useInfraMetrics` áp nguyên ở đây: mở một bảng chỉ ĐỌC
       FILE, và chỉ cú bấm "Nạp" mới gọi `infra.metrics-query`. Danh sách thì nạp lúc
       mount — nó cũng chỉ là đọc thư mục, không chạm CLI, không tốn tiền. -->
  <div class="idb">
    <!-- ── Mặt danh sách ───────────────────────────────────────────────────── -->
    <template v-if="!opened">
      <header class="idb-hd is-stacked">
        <div class="idb-hd-txt">
          <h2 class="idb-ttl">{{ t('infra.dashboard.title') }}</h2>
          <p class="idb-sub">{{ t('infra.dashboard.subtitle') }}</p>
        </div>
        <button class="btn sm" type="button" :disabled="listLoading" @click="refresh()">
          <Icon name="refresh" class="idb-ic" :class="listLoading ? 'idb-spin' : ''" />
          {{ t('infra.dashboard.refresh') }}
        </button>
      </header>

      <div class="idb-body">
        <p v-if="!sidecarAvailable" class="idb-state">{{ t('infra.dashboard.noSidecar') }}</p>
        <p v-else-if="listError" class="ierr">{{ listError }}</p>
        <p v-else-if="listLoading && summaries.length === 0" class="idb-state">
          {{ t('infra.dashboard.loading') }}
        </p>

        <!-- Danh sách KHÔNG BAO GIỜ rỗng thật: ba bản dựng sẵn luôn có mặt. Nhánh này
             chỉ chạy khi sidecar trả về rỗng, tức là có gì đó sai — nói ra thay vì để
             một khoảng trắng. -->
        <p v-else-if="summaries.length === 0" class="idb-state">
          {{ t('infra.dashboard.empty') }}
        </p>

        <ul v-else class="idb-list">
          <li
            v-for="s in summaries"
            :key="`${s.source}:${s.projectId ?? ''}:${s.id}`"
            class="icard idb-card"
          >
            <div class="idb-card-hd">
              <h3 class="idb-name">{{ s.name }}</h3>
              <span class="idb-badge" :class="`is-${s.source}`">{{ sourceLabel(s) }}</span>
            </div>

            <p v-if="s.description" class="idb-desc">{{ s.description }}</p>

            <p class="idb-meta">
              {{ t('infra.dashboard.counts', { c: s.chartCount, s: s.seriesCount }) }}
            </p>

            <!-- File hỏng vẫn được LIỆT KÊ, kèm lý do. Bỏ nó khỏi danh sách là để người
                 dùng đi tìm một bảng họ biết chắc mình đã tạo mà không hiểu vì sao mất. -->
            <ul v-if="s.issues.length > 0" class="idb-issues">
              <li v-for="(iss, i) in s.issues" :key="i" class="idb-issue">
                <Icon name="alert" class="idb-ic" />
                <span>{{ issueText(iss) }}</span>
              </li>
            </ul>

            <div class="idb-acts">
              <button
                class="btn sm pri"
                type="button"
                :disabled="openLoading || s.issues.length > 0"
                @click="open(s)"
              >
                <Icon name="act" class="idb-ic" />
                {{ t('infra.dashboard.open') }}
              </button>
              <button
                v-if="s.source !== 'builtin'"
                class="btn sm"
                type="button"
                :title="t('infra.dashboard.delete')"
                @click="remove(s)"
              >
                <Icon name="trash" class="idb-ic" />
                {{ t('infra.dashboard.delete') }}
              </button>
            </div>
          </li>
        </ul>

        <p v-if="openError" class="ierr">{{ openError }}</p>
      </div>
    </template>

    <!-- ── Mặt một bảng đang mở ────────────────────────────────────────────── -->
    <template v-else>
      <!-- Nút quay lại đứng TRƯỚC tiêu đề, cùng khuôn với `InfraServicesCatalog` —
           mặt khác của cùng cách đọc: bấm vào chỗ mình vừa đi qua. -->
      <header class="idb-hd">
        <button class="btn sm" type="button" @click="back()">
          <Icon name="chev-left" class="idb-ic" />
          {{ t('infra.dashboard.back') }}
        </button>
        <div class="idb-hd-txt">
          <h2 class="idb-ttl">{{ opened.name }}</h2>
        </div>
        <span v-if="readOnly" class="idb-badge is-builtin">
          {{ t('infra.dashboard.readOnly') }}
        </span>
      </header>

      <div class="itoolbar ifields idb-tool">
        <div class="ifield">
          <div class="ilbl">{{ t('infra.monitoring.window.label') }}</div>
          <InfraTimeRange v-model="win" :default-seconds="3 * 3600" />
        </div>

        <!-- Hai ô tài nguyên: cùng vai trò với màn Giám sát, và được GIEO từ
             `targetValue` của chính bảng lúc mở. Bảng nào không dùng tài nguyên nào
             thì ô đó đứng yên — `dimensionsFor` bỏ qua giá trị rỗng. -->
        <InfraTargetPicker
          v-model="targets.lb"
          :label="t('infra.monitoring.target.lb')"
          :placeholder="t('infra.monitoring.target.lbPh')"
          :why="t('infra.monitoring.target.lbWhy')"
          :select-placeholder="t('infra.monitoring.target.any')"
          :group="pickerLbs"
          :loading="pickerLoading"
          :has-account="hasAccount"
          @reload="loadTargets(true)"
          @submit="load(false)"
        />

        <InfraTargetPicker
          v-model="targets.instance"
          :label="t('infra.monitoring.target.instance')"
          :placeholder="t('infra.monitoring.target.instancePh')"
          :why="t('infra.monitoring.target.instanceWhy')"
          :select-placeholder="t('infra.monitoring.target.any')"
          :group="pickerInstances"
          :loading="pickerLoading"
          :has-account="hasAccount"
          @reload="loadTargets(true)"
          @submit="load(false)"
        />

        <!-- MỘT nhóm, không phải hai mục rời của thanh flex — cùng lỗi đã sửa ở màn
             Giám sát (b0f2729): rời nhau thì hàng gãy được ở GIỮA chúng và "Nạp lại"
             rơi xuống hàng dưới, bỏ nút chính đứng một mình. -->
        <div class="itoolgrp">
          <button
            type="button"
            class="btn pri"
            :disabled="loading || !hasAccount"
            :aria-busy="loading"
            @click="load(false)"
          >
            <Icon name="play" class="idb-ic" />
            {{ t('infra.monitoring.load') }}
          </button>
          <button
            type="button"
            class="btn"
            :disabled="loading || !loadedAt"
            :title="t('infra.monitoring.reloadHint')"
            @click="reload()"
          >
            <Icon name="refresh" class="idb-ic" :class="loading ? 'idb-spin' : ''" />
            {{ t('infra.monitoring.reload') }}
          </button>
        </div>

        <!-- Lưu/Hoàn tác chỉ hiện khi bản làm việc ĐÃ LỆCH file. Một nút "Lưu" luôn
             sáng trên một bảng chưa sửa gì là mời người dùng ghi đè vô cớ. Nhóm
             RIÊNG với Nạp/Nạp lại: hai việc khác nhau (ghi file · lấy số liệu), và
             nhóm riêng cũng là chỗ hàng được phép gãy khi cửa sổ hẹp. -->
        <div v-if="dirty" class="itoolgrp">
          <button type="button" class="btn pri" :disabled="saving" @click="save()">
            <Icon name="check" class="idb-ic" />
            {{ t('infra.dashboard.save') }}
          </button>
          <button type="button" class="btn" :disabled="saving" @click="undoRemove()">
            <Icon name="revert" class="idb-ic" />
            {{ t('infra.dashboard.undo') }}
          </button>
        </div>
      </div>

      <!-- Lỗi dò danh sách đứng NGOÀI thanh công cụ (flex-wrap): một đoạn văn nằm
           trong đó quyết định hàng gãy ở đâu và làm vỡ bố cục — lỗi thật ở màn
           Giám sát 2026-09-16. Một dòng, toàn văn trong `title`. -->
      <p v-if="pickerError" class="idb-targeterr" :title="pickerError">
        {{ t('infra.monitoring.target.listFailed', { err: pickerError }) }}
      </p>

      <!-- Hai ô tài nguyên ở đây là ĐÚNG hai ô của màn Giám sát, nên chúng cần đúng
           dòng giải thích đó. Thiếu nó thì màn này lặp lại câu hỏi người dùng đã
           hỏi ở màn kia ("nhập tay thì biết nhập gì đâu"), chỉ muộn hơn một tab. -->
      <p class="idb-targethint" :title="t('infra.monitoring.target.hintWhy')">
        {{ t('infra.monitoring.target.hint') }}
      </p>

      <div class="idb-status">
        <span class="ihint">
          {{ t('infra.monitoring.window.showing', { span: windowLabel }) }}
          <template v-if="loadedAt">
            · {{ t('infra.monitoring.loadedAt', { t: atLabel }) }}
            ·
            {{
              calls > 0 ? t('infra.monitoring.calls', { n: calls }) : t('infra.monitoring.zeroCost')
            }}
          </template>
        </span>
        <span v-if="windowDirty && loadedAt" class="iwarn">
          {{ t('infra.monitoring.window.dirty') }}
        </span>
        <span v-if="dirty" class="iwarn">{{ t('infra.dashboard.dirty') }}</span>
      </div>

      <div class="idb-body">
        <InfraEmpty
          v-if="!hasAccount"
          :title="t('infra.empty.noProfile.title')"
          :hint="t('infra.empty.noProfile.hint.charts')"
          action="accounts"
          :action-label="t('infra.empty.noProfile.action')"
        />
        <p v-else-if="error" class="ierr">{{ error }}</p>

        <div class="idb-grid">
          <MetricChart
            v-for="c in charts"
            :key="c.key"
            :title="c.title"
            :kind="c.kind"
            :unit="c.unit"
            :series="c.series"
            :window="windowRef"
            :window-seconds="windowSeconds"
            :period-seconds="periodSeconds"
            :incidents="[]"
            :threshold="null"
            :loading="loading"
            :removable="!readOnly && canRemove"
            @remove="removeChart(c.key)"
          />
        </div>

        <!-- Luật 4 của infra-README: chip câu hỏi. DƯỚI lưới biểu đồ, cùng chỗ với
             màn Giám sát và màn Chi phí — chúng hỏi về thứ vừa đọc xong, nên đứng
             trên nó là mời hỏi trước khi có gì để nhìn. Tắt khi bảng chưa nạp số
             liệu: "có gì bất thường" trên một bảng trống thì không có câu trả lời. -->
        <div class="idb-ask">
          <span class="idb-asklbl">{{ t('infra.dashboard.title') }}</span>
          <button
            v-for="s in askSuggestions"
            :key="s.key"
            type="button"
            class="idb-chip"
            :disabled="!hasSnapshot"
            @click="ask(s.text)"
          >
            {{ s.text }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Lớp bind của tab Bảng điều khiển (Mốc 6, M4). Mọi state + RPC nằm ở
// `useInfraDashboards()` — khuôn page-controller của .claude/rules/nuxt-vue.md.
//
// DÙNG LẠI `MetricChart`, KHÔNG FORK. Biểu đồ ở đây vẽ đúng thứ màn Giám sát vẽ; khác
// duy nhất là ở đó có chuỗi nút cảnh báo còn ở đây có nút bỏ biểu đồ — và đó chính là
// việc của ba cờ `showAlarm`/`pinnable`/`removable`.
//
// DÙNG LẠI KHOÁ `infra.monitoring.*` cho khoảng thời gian, tài nguyên và hai nút nạp:
// đó là CÙNG một khái niệm hiển thị cùng một chữ. Nhân đôi chúng dưới `infra.dashboard.*`
// là hai bản dịch sẽ trôi khỏi nhau ngay lần sửa câu chữ đầu tiên.
import { computed, onMounted } from 'vue'
import { useConfirm } from '~/composables/useConfirm'
import { useInfraDashboards } from '~/composables/useInfraDashboards'
import { formatAxisTime } from '~/composables/useInfraMetrics'
import { useInfraMonitorTargets } from '~/composables/useInfraMonitorTargets'
import InfraTargetPicker from '~/components/infra/metrics/InfraTargetPicker.vue'
import InfraTimeRange from '~/components/infra/InfraTimeRange.vue'
import type {
  DashboardIssue,
  DashboardRef,
  DashboardSummary,
} from '~/composables/useInfraDashboards'

const { t } = useI18n()
const { confirm } = useConfirm()

const {
  context,
  hasAccount,
  sidecarAvailable,
  summaries,
  listLoading,
  listError,
  refresh,
  opened,
  openedRef,
  openLoading,
  openError,
  openDashboard,
  closeDashboard,
  targets,
  win,
  windowSeconds,
  windowLabel,
  windowDirty,
  windowRef,
  periodSeconds,
  loading,
  error,
  loadedAt,
  calls,
  load,
  reload,
  charts,
  dirty,
  canRemove,
  removeChart,
  undoRemove,
  saving,
  save,
  deleteDashboard,
  askSuggestions,
  hasSnapshot,
  ask,
} = useInfraDashboards()

// Cùng picker với màn Giám sát; cache cấp module theo (profile, region) nên mở màn
// này sau màn kia thì danh sách đã sẵn, không dò lại.
const {
  loading: pickerLoading,
  loadBalancers: pickerLbs,
  instances: pickerInstances,
  load: loadTargets,
} = useInfraMonitorTargets(
  () => context.value.profile ?? '',
  () => context.value.region ?? '',
  'dashboards',
)

/** Lỗi dò danh sách, gộp hai nhóm — cùng luật với màn Giám sát. */
const pickerError = computed<string>(() => {
  const errs = [pickerLbs.value.error, pickerInstances.value.error].filter((e) => e !== '')
  return [...new Set(errs)].join(' · ')
})

// Đọc thư mục, không chạm CLI và không tốn tiền — nên nạp được ngay khi tab mount.
// Đây KHÔNG phải ngoại lệ của luật không-tự-chạy: luật đó nói về `metrics-query`.
onMounted(() => {
  if (sidecarAvailable.value) void refresh()
})

/** Bản dựng sẵn chỉ đọc: không có nút bỏ biểu đồ, và cú lưu sẽ bị sidecar từ chối. */
const readOnly = computed(() => openedRef.value?.source === 'builtin')

const atLabel = computed(() => (loadedAt.value ? formatAxisTime(loadedAt.value, 86_400) : ''))

function sourceLabel(s: DashboardSummary): string {
  if (s.source === 'builtin') return t('infra.dashboard.source.builtin')
  return t(`infra.dashboard.tier.${s.tier}`)
}

/**
 * `code` là khoá dịch được, `message` là chi tiết kỹ thuật tiếng Anh do zod sinh (đường
 * dẫn trường + lý do). Ghép cả hai: câu dịch nói CHUYỆN GÌ, phần đuôi nói CHỖ NÀO.
 */
function issueText(iss: DashboardIssue): string {
  const head = t(iss.code)
  return iss.message ? `${head} — ${iss.message}` : head
}

function refOf(s: DashboardSummary): DashboardRef {
  return { source: s.source, id: s.id, ...(s.projectId ? { projectId: s.projectId } : {}) }
}

function open(s: DashboardSummary): void {
  void openDashboard(refOf(s))
}

function back(): void {
  closeDashboard()
}

async function remove(s: DashboardSummary): Promise<void> {
  const ok = await confirm({
    title: t('infra.dashboard.deleteConfirm.title', { name: s.name }),
    description: t('infra.dashboard.deleteConfirm.body'),
    confirmLabel: t('infra.dashboard.delete'),
    kind: 'danger',
  })
  if (!ok) return
  await deleteDashboard(refOf(s))
}
</script>

<style scoped>
.idb {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  height: 100%;
  min-height: 0;
  /* KHÔNG cuộn ở đây. Cuộn là việc của `.idb-body`, cùng luật với `.im`/`.im-body`
     của màn Giám sát: cuộn cả màn thì thanh công cụ — và cái nút "Nạp" trên đó —
     trôi khỏi màn hình đúng lúc người dùng đang đọc biểu đồ và muốn đổi khoảng. */
  overflow: hidden;
}

.idb-hd {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

/* Mặt danh sách có tiêu đề HAI dòng (tên + câu mô tả), nên nút bên phải phải căn
   theo dòng tiêu đề chứ không theo giữa cả khối — căn giữa thì nút trôi xuống
   ngang đoạn văn và không còn thuộc về tiêu đề nào. Mặt đang-mở chỉ có một dòng
   nên giữ căn giữa. */
.idb-hd.is-stacked {
  align-items: flex-start;
}

.idb-hd-txt {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.idb-ttl {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  color: var(--text);
}

.idb-sub {
  margin: 0;
  max-width: 72ch;
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--textDim);
}

/* Thân cuộn của CẢ HAI mặt. `min-height: 0` là thứ bắt buộc, không phải trang trí:
   thiếu nó thì một flex item lấy chiều cao nội dung làm sàn và khối này không bao
   giờ cuộn, nó chỉ đẩy dài ra khỏi khung. */
.idb-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 4px;
}

.idb-state {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-md);
  color: var(--textDim);
}

.idb-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.idb-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
}

.idb-card-hd {
  display: flex;
  align-items: center;
  gap: 8px;
}

.idb-name {
  margin: 0;
  flex: 1;
  min-width: 0;
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--text);
}

/* MỘT khuôn pill cho cả hai chỗ dùng: nhãn nguồn trên thẻ danh sách và nhãn
   "chỉ đọc" trên header bảng đang mở. Trước đây là hai class (`.idb-badge` và
   `.idb-ro`) khai y hệt nhau — hai bản sao là hai chỗ để trôi khỏi nhau. */
.idb-badge {
  flex-shrink: 0;
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}

.idb-badge.is-builtin {
  border-color: var(--accentBorder);
  color: var(--accent);
}

.idb-desc {
  margin: 0;
  flex: 1;
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--textMuted);
}

.idb-meta {
  margin: 0;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
}

.idb-issues {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.idb-issue {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  color: var(--danger);
}

.idb-acts {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

/* Bố cục + da ở `.itoolbar` (app-shell.css). */

/* Cũng là một class mượn: `.im-status` chỉ tồn tại trong `<style scoped>` của
   `InfraMonitoring.vue`, nên hàng trạng thái ở đây vốn không có flex và không có
   gap — câu "đang xem 3h" và hai câu cảnh báo dính vào nhau thành một dòng chữ. */
.idb-status {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  flex-shrink: 0;
}

/* HAI cột cố định, cùng luật với `.im-grid`. `auto-fit minmax(340px, 1fr)` cũ cho
   ba cột ở bề rộng thường: ba biểu đồ chuỗi thời gian rộng ~380px đứng cạnh nhau
   và biểu đồ thứ tư rơi xuống hàng dưới một mình (ảnh người dùng 2026-09-16). */
.idb-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.idb-targeterr {
  margin: 2px 0 0;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
  color: var(--amber);
}

.idb-targethint {
  margin: 2px 0 0;
  flex-shrink: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-xs);
  line-height: var(--lh-prose);
  color: var(--textFaint);
}

.idb-ask {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.idb-asklbl {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--textFaint);
}

.idb-chip {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 4px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  cursor: pointer;
}

.idb-chip:hover:not(:disabled) {
  border-color: var(--accentBorder);
  color: var(--accent);
}

.idb-chip:disabled {
  opacity: 0.45;
  cursor: default;
}

/* `--icon-sm`, KHÔNG `--icon-xs`: nút làm mới bên trong `InfraTargetPicker` đứng
   ngay cạnh nút "Nạp" của màn này và dùng 14px. 12px ở đây làm hai icon cạnh nhau
   trên CÙNG một hàng lệch cỡ. */
.idb-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex-shrink: 0;
}

.idb-spin {
  animation: idb-rot 1s linear infinite;
}

@keyframes idb-rot {
  to {
    transform: rotate(360deg);
  }
}

/* Cửa sổ hẹp: lưới nhường về một cột — cùng ngưỡng với màn Giám sát, vì cùng
   biểu đồ và cùng bề rộng tối thiểu để đọc được trục thời gian. */
@media (max-width: 1180px) {
  .idb-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
