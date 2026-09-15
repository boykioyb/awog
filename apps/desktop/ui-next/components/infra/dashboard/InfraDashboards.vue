<template>
  <!-- Tab "Bảng điều khiển" của `/infra` (Mốc 6, M4).
       HAI MẶT, MỘT TAB: danh sách bảng (mặc định) và một bảng đang mở. Không phải hai
       tab vì chúng là hai bước của cùng một việc — và không phải hai route vì bảng
       đang mở mang theo số liệu vừa nạp, thứ sẽ mất nếu điều hướng.

       LUẬT KHÔNG TỰ CHẠY của `useInfraMetrics` áp nguyên ở đây: mở một bảng chỉ ĐỌC
       FILE, và chỉ cú bấm "Nạp" mới gọi `infra.metrics-query`. Danh sách thì nạp lúc
       mount — nó cũng chỉ là đọc thư mục, không chạm CLI, không tốn tiền. -->
  <div class="idb">
    <!-- ── Mặt danh sách ───────────────────────────────────────────────────── -->
    <template v-if="!opened">
      <header class="idb-hd">
        <div class="idb-hd-txt">
          <h2 class="idb-ttl">{{ t('infra.dashboard.title') }}</h2>
          <p class="idb-sub">{{ t('infra.dashboard.subtitle') }}</p>
        </div>
        <button class="btn sm" type="button" :disabled="listLoading" @click="refresh()">
          <Icon name="refresh" class="idb-ic" :class="listLoading ? 'idb-spin' : ''" />
          {{ t('infra.dashboard.refresh') }}
        </button>
      </header>

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
          class="idb-card"
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
    </template>

    <!-- ── Mặt một bảng đang mở ────────────────────────────────────────────── -->
    <template v-else>
      <div class="idb-tool">
        <button class="btn sm" type="button" @click="back()">
          <Icon name="chev-left" class="idb-ic" />
          {{ t('infra.dashboard.back') }}
        </button>

        <div class="idb-open-name">
          <span class="idb-open-ttl">{{ opened.name }}</span>
          <span v-if="readOnly" class="idb-ro">{{ t('infra.dashboard.readOnly') }}</span>
        </div>

        <div class="ifield">
          <div class="ilbl">{{ t('infra.monitoring.window.label') }}</div>
          <div class="seg">
            <span
              v-for="p in windowPresets"
              :key="p"
              :class="{ on: windowPreset === p }"
              role="button"
              :aria-pressed="windowPreset === p"
              @click="windowPreset = p"
            >
              {{ t(`infra.monitoring.window.preset.${p}`) }}
            </span>
          </div>
        </div>

        <!-- Hai ô tài nguyên: cùng vai trò với màn Giám sát, và được GIEO từ
             `targetValue` của chính bảng lúc mở. Bảng nào không dùng tài nguyên nào
             thì ô đó đứng yên — `dimensionsFor` bỏ qua giá trị rỗng. -->
        <div class="ifield">
          <div class="ilbl">{{ t('infra.monitoring.target.lb') }}</div>
          <input
            v-model="targets.lb"
            class="idb-inp"
            type="text"
            autocomplete="off"
            spellcheck="false"
            @keydown.enter="load(false)"
          />
        </div>
        <div class="ifield">
          <div class="ilbl">{{ t('infra.monitoring.target.instance') }}</div>
          <input
            v-model="targets.instance"
            class="idb-inp"
            type="text"
            autocomplete="off"
            spellcheck="false"
            @keydown.enter="load(false)"
          />
        </div>

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

        <!-- Lưu/Hoàn tác chỉ hiện khi bản làm việc ĐÃ LỆCH file. Một nút "Lưu" luôn
             sáng trên một bảng chưa sửa gì là mời người dùng ghi đè vô cớ. -->
        <template v-if="dirty">
          <button type="button" class="btn pri" :disabled="saving" @click="save()">
            <Icon name="check" class="idb-ic" />
            {{ t('infra.dashboard.save') }}
          </button>
          <button type="button" class="btn" :disabled="saving" @click="undoRemove()">
            <Icon name="revert" class="idb-ic" />
            {{ t('infra.dashboard.undo') }}
          </button>
        </template>
      </div>

      <div class="im-status">
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

      <p v-if="!hasAccount" class="ierr">{{ t('infra.monitoring.noProfile') }}</p>
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
import type {
  DashboardIssue,
  DashboardRef,
  DashboardSummary,
} from '~/composables/useInfraDashboards'

const { t } = useI18n()
const { confirm } = useConfirm()

const {
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
  windowPreset,
  windowPresets,
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
} = useInfraDashboards()

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
  gap: 12px;
  padding: 14px 16px;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
}

.idb-hd {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.idb-hd-txt {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.idb-ttl {
  margin: 0;
  font-size: var(--fs-lg);
  line-height: var(--lh-lg);
  color: var(--text);
}

.idb-sub {
  margin: 0;
  max-width: 68ch;
  font-size: var(--fs-sm);
  line-height: var(--lh-prose);
  color: var(--textDim);
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
  border: 1px solid var(--border);
  border-radius: var(--r-card);
  background: var(--bgPanel);
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

.idb-tool {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}

.idb-open-name {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.idb-open-ttl {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  color: var(--text);
}

.idb-ro {
  padding: 1px 7px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}

.idb-inp {
  width: 200px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.idb-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 10px;
}

.idb-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
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
</style>
